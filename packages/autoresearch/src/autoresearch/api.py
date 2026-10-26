import hashlib
import hmac
import io
import json
from pathlib import Path
import sqlite3
import time
import zipfile

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings
from .http_view import STATUS_CATALOG, plan_digest, present_project, present_run, template_by_id, template_catalog
from .mvp import build_plan_confirmation, merge_plan_confirmation, save_plan_confirmation
from .store import Store
from .templates import TEMPLATE


class Budget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rounds: int = Field(default=3, ge=2, le=10)
    total_seconds: int = Field(default=1800, ge=10, le=3600)
    experiment_seconds: int = Field(default=120, ge=1, le=120)
    max_llm_calls: int = Field(default=12, ge=1, le=40)


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_id: str = "digits-mlp-v1"
    goal: str = Field(min_length=3, max_length=2000)
    editable_paths: list[str] = Field(default_factory=lambda: ["model.py"])
    budget: Budget = Field(default_factory=Budget)


class StartInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_plan: bool
    confirmer: str = Field(default="", max_length=64)
    opinion: str = Field(default="", max_length=2000)


def create_app(settings=None):
    settings = settings or Settings.from_env()
    store = Store(settings.home)
    app = FastAPI(title="ShenZhi AutoResearch", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.state.store, app.state.settings = store, settings

    async def owner(request: Request):
        auth = request.headers.get("authorization", "")
        expected = "Bearer " + settings.demo_token
        token_ok = bool(auth) and len(auth) == len(expected) and hmac.compare_digest(auth, expected)
        if settings.team_auth:
            if token_ok:
                return "team"
            raise HTTPException(401, "Invalid team token")
        if settings.demo_auth and request.client and request.client.host in {"127.0.0.1", "::1"} and token_ok:
            return "local-demo"
        if len(settings.signing_secret) < 32:
            raise HTTPException(503, "Platform authentication is not configured")
        user, ts, signature = [request.headers.get(k, "") for k in ("x-shenzhi-user", "x-shenzhi-timestamp", "x-shenzhi-signature")]
        try:
            if not user or len(user) > 128 or abs(time.time() - int(ts)) > 300:
                raise ValueError()
            path = request.url.path + ("?" + request.url.query if request.url.query else "")
            body_hash = hashlib.sha256(await request.body()).hexdigest()
            payload = "\n".join((request.method, path, ts, user, body_hash))
            expected = hmac.new(settings.signing_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(401, "Invalid platform signature")
        return user

    def project_for(pid, user):
        project = store.project(pid)
        if not project or project["owner"] != user:
            raise HTTPException(404, "Project not found")
        return project

    def run_for(rid, user):
        run = store.run(rid)
        if not run:
            raise HTTPException(404, "Run not found")
        project_for(run["project_id"], user)
        return run

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "version": "0.1.0",
            "provider": settings.provider,
            "runner": settings.runner,
            "platform_connected": False,
            "auth": "team_bearer" if settings.team_auth else ("demo_loopback" if settings.demo_auth else "platform_signature"),
            "single_worker": True,
            "statuses": STATUS_CATALOG,
        }

    @app.get("/api/templates")
    def templates(user=Depends(owner)):
        result = template_catalog()
        if settings.runner != "local_trusted":
            for item in result:
                if item["id"] == "dlinear-etth1-v1":
                    item.update(runnable=False, unavailable_reason="当前DLinear模板需要local_trusted执行环境。")
        return result

    @app.get("/api/projects")
    def projects(user=Depends(owner)):
        result = []
        for project in store.projects(user):
            runs = []
            for run in store.runs(project["id"]):
                summary = present_run(store, run)
                summary.pop("forecast", None)
                summary["trials"] = [{key: trial.get(key) for key in ("ordinal", "status", "metrics")}
                                     for trial in store.trials(run["id"])]
                runs.append(summary)
            result.append(present_project(project, runs))
        return result

    @app.post("/api/projects", status_code=201)
    def create_project(body: ProjectInput, user=Depends(owner)):
        template = template_by_id(body.template_id)
        if template is None:
            raise HTTPException(422, "Unsupported template")
        if not template["runnable"] or (body.template_id == "dlinear-etth1-v1" and settings.runner != "local_trusted"):
            raise HTTPException(422, "Template is listed for clients but is not executable")
        if body.editable_paths != template["editable_paths"]:
            raise HTTPException(422, "Unsupported modification scope")
        value = body.model_dump()
        value["plan"] = {"goal": body.goal, "editable_paths": body.editable_paths, "rounds": body.budget.rounds, "flow": ["baseline", "proposal", "experiment", "feedback", "confirmation", "final_evaluation", "report"], "metric": template["primary_metric"], "direction": template["direction"], "template_version": template["version"], "template": template}
        return present_project(store.create_project(user, value))

    @app.get("/api/projects/{pid}")
    def get_project(pid, user=Depends(owner)):
        project = project_for(pid, user)
        return present_project(project, [present_run(store, item) for item in store.runs(pid)])

    @app.post("/api/projects/{pid}/runs", status_code=202)
    def start(pid, body: StartInput, user=Depends(owner)):
        project = project_for(pid, user)
        if not body.confirm_plan:
            raise HTTPException(422, "Confirm the plan before starting")
        try:
            build_plan_confirmation(plan_digest(project), body.confirmer, body.opinion)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        try:
            run = store.enqueue(pid)
        except sqlite3.IntegrityError:
            raise HTTPException(409, "An active run already exists")
        digest = plan_digest(project)
        merged = merge_plan_confirmation(run.get("plan_confirmation"), digest, body.confirmer, body.opinion)
        if merged != run.get("plan_confirmation"):
            run = save_plan_confirmation(store, run["id"], merged)
        return present_run(store, run)

    @app.get("/api/runs/{rid}")
    def get_run(rid, user=Depends(owner)):
        return present_run(store, run_for(rid, user), include_details=True)

    @app.post("/api/runs/{rid}/stop")
    def stop(rid, user=Depends(owner)):
        run_for(rid, user)
        return present_run(store, store.stop(rid))

    @app.post("/api/runs/{rid}/resume", status_code=202)
    def resume(rid, user=Depends(owner)):
        run = run_for(rid, user)
        project = project_for(run["project_id"], user)
        if run["status"] not in {"interrupted", "cancelled"}:
            raise HTTPException(409, "Only interrupted or stopped runs can resume")
        if run["elapsed"] >= project["budget"]["total_seconds"]:
            raise HTTPException(409, "Total time budget is exhausted")
        try:
            return present_run(store, store.resume(rid))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Project has another active run")

    def artifact_path(item):
        root = (settings.home / "runs" / item["run"]).resolve()
        path = (root / item["path"]).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
            raise HTTPException(404, "Artifact unavailable")
        return path

    @app.get("/api/artifacts/{aid}")
    def download(aid, user=Depends(owner)):
        item = store.artifact_by_id(aid)
        if not item:
            raise HTTPException(404, "Artifact not found")
        run_for(item["run"], user)
        return FileResponse(artifact_path(item), filename=Path(item["path"]).name, media_type="application/octet-stream")

    @app.get("/api/runs/{rid}/export")
    def export(rid, user=Depends(owner)):
        run = run_for(rid, user)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("export_state.json", json.dumps(run, ensure_ascii=False, indent=2))
            for item in store.artifacts(rid):
                archive.write(artifact_path(item), item["path"])
        return Response(buffer.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{rid}.zip"'})

    web = Path(__file__).parent / "web"
    app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
