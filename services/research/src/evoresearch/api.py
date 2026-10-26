import hmac
import os
from dataclasses import asdict

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from autoresearch.config import Settings

from .adapter import AutoResearchAdapter, TaskConflict
from .models import StartInput
from .workflow import ResearchWorkflowService
from .workflow import KnowledgeUnavailable
from .papers import PaperInput, PaperConflict, enqueue as enqueue_paper
from .task_registry import template_catalog


def create_app(settings: Settings | None = None, token: str | None = None) -> FastAPI:
    token = token if token is not None else os.environ.get("EVORESEARCH_TOKEN", "")
    if len(token) < 24 or any(not 33 <= ord(c) <= 126 for c in token):
        raise ValueError("EVORESEARCH_TOKEN must contain at least 24 ASCII characters")
    adapter = AutoResearchAdapter(settings or Settings.from_env())
    workflow = ResearchWorkflowService(adapter)
    app = FastAPI(title="EvoResearch phase 5", version="0.5.0")
    app.state.adapter = adapter

    def authenticate(authorization: str = Header(default="")):
        if not hmac.compare_digest(authorization.encode(), ("Bearer " + token).encode()):
            raise HTTPException(401, "Invalid service token")

    @app.exception_handler(TaskConflict)
    async def conflict(_, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(PaperConflict)
    async def paper_conflict(_,exc):
        return JSONResponse(status_code=409,content={'detail':str(exc)})

    @app.exception_handler(KnowledgeUnavailable)
    async def knowledge_unavailable(_,exc):
        return JSONResponse(status_code=503,content={'detail':str(exc)})

    @app.exception_handler(ValueError)
    async def invalid(_, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return JSONResponse(status_code=404, content={"detail": "Run not found"})

    @app.get("/health")
    def health():
        return {"status": "ok", "phase": 5, "worker_managed_separately": True}

    @app.post('/api/papers',status_code=202,dependencies=[Depends(authenticate)])
    def ingest_paper(body: PaperInput):
        return enqueue_paper(adapter.store,body)

    @app.get('/api/knowledge/records/{record_id}',dependencies=[Depends(authenticate)])
    def knowledge_record(record_id: str,project_id: str):
        import json
        with adapter.store.connect() as con:
            row=con.execute('SELECT * FROM evo_knowledge WHERE record_id=? AND project_id=?',(record_id,project_id)).fetchone()
        if not row: raise HTTPException(404,'Knowledge record not found')
        return dict(row) | {'body':json.loads(row['body'])}

    @app.get('/api/knowledge/search', dependencies=[Depends(authenticate)])
    def search_knowledge(project_id: str = Query(min_length=1,max_length=200),
                         query: str = Query(min_length=1,max_length=2000),
                         limit: int = Query(default=8,ge=1,le=50)):
        from .graphiti_adapter import GraphitiAdapter
        backend=None
        try:
            backend=GraphitiAdapter.from_env(adapter.store)
            return [asdict(e) for e in backend.retrieve_joint(query,project_id,limit)]
        except Exception:
            raise HTTPException(503,'Knowledge backend unavailable') from None
        finally:
            if backend:
                backend.close()

    @app.get("/api/templates", dependencies=[Depends(authenticate)])
    def templates():
        return [{**item, "runnable": adapter.settings.runner in item["supported_runners"]
                 and item["runnable"]} for item in template_catalog()]

    @app.post("/api/experiments", status_code=202, dependencies=[Depends(authenticate)])
    def start(body: StartInput):
        return asdict(workflow.start_research(body.task.to_domain()))

    @app.get("/api/experiments/{run_id}", dependencies=[Depends(authenticate)])
    def status(run_id: str):
        return adapter.snapshot(run_id)

    @app.post("/api/experiments/{run_id}/stop", dependencies=[Depends(authenticate)])
    def stop(run_id: str):
        accepted = workflow.stop_research(run_id)
        return {"accepted": accepted, **adapter.snapshot(run_id)}

    return app

