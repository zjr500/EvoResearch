import hashlib
import hmac
import io
import json
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest

from autoresearch.api import create_app
from autoresearch.config import Settings
from autoresearch.store import Store


@pytest.fixture
def api(tmp_path):
    settings = Settings(tmp_path, runner="local_trusted", provider="feedback_demo", signing_secret="a" * 40)
    return TestClient(create_app(settings)), settings


def signed(user, method, path, body=b"", timestamp=None):
    timestamp = str(timestamp or int(time.time()))
    payload = "\n".join((method, path, timestamp, user, hashlib.sha256(body).hexdigest()))
    return {"x-shenzhi-user": user, "x-shenzhi-timestamp": timestamp, "x-shenzhi-signature": hmac.new(b"a" * 40, payload.encode(), hashlib.sha256).hexdigest(), "content-type": "application/json"}


def request(client, user, method, path, body=None):
    raw = json.dumps(body).encode() if body is not None else b""
    return client.request(method, path, content=raw, headers=signed(user, method, path, raw))


def project(client):
    return request(client, "alice", "POST", "/api/projects", {"goal": "Improve validation accuracy"}).json()


def test_auth_owner_confirmation_and_duplicates(api):
    client, settings = api
    assert client.get("/api/templates").status_code == 401
    p = project(client)
    assert request(client, "bob", "GET", "/api/projects/" + p["id"]).status_code == 404
    path = "/api/projects/" + p["id"] + "/runs"
    assert request(client, "alice", "POST", path, {"confirm_plan": False}).status_code == 422
    first = request(client, "alice", "POST", path, {"confirm_plan": True})
    second = request(client, "alice", "POST", path, {"confirm_plan": True})
    assert first.status_code == second.status_code == 202
    assert first.json()["id"] == second.json()["id"]
    rid = first.json()["id"]
    assert request(client, "bob", "POST", f"/api/runs/{rid}/stop").status_code == 404
    assert request(client, "alice", "POST", f"/api/runs/{rid}/stop").json()["status"] == "cancelled"
    assert request(client, "alice", "POST", f"/api/runs/{rid}/resume").json()["status"] == "queued"
    assert request(client, "alice", "POST", f"/api/runs/{rid}/resume").status_code == 409


def test_signed_body_cannot_be_modified_and_expiry(api):
    client, _ = api
    body = b'{"goal":"abc"}'
    headers = signed("alice", "POST", "/api/projects", body)
    assert client.post("/api/projects", content=b'{"goal":"different"}', headers=headers).status_code == 401
    assert client.get("/api/templates", headers=signed("alice", "GET", "/api/templates", timestamp=int(time.time())-600)).status_code == 401


@pytest.mark.parametrize("body", [{"goal": "abc", "owner": "bob"}, {"goal": "abc", "editable_paths": ["../evaluator.py"]}, {"goal": "abc", "template_id": "other"}, {"goal": "abc", "budget": {"rounds": 500}}, {"goal": "abc", "budget": {"total_seconds": 0}}])
def test_reject_invalid_project(api, body):
    assert request(api[0], "alice", "POST", "/api/projects", body).status_code == 422


def test_export_only_registered_artifacts(api):
    client, settings = api
    p = project(client)
    store = Store(settings.home)
    run = store.enqueue(p["id"])
    root = settings.home / "runs" / run["id"]
    root.mkdir(parents=True)
    (root / "report.md").write_text("valid report")
    (root / "secret.npy").write_text("private labels")
    store.artifact(run["id"], root / "report.md", "report")
    result = request(client, "alice", "GET", f"/api/runs/{run['id']}/export")
    archive = zipfile.ZipFile(io.BytesIO(result.content))
    assert "report.md" in archive.namelist() and "secret.npy" not in archive.namelist()
    aid = store.artifacts(run["id"])[0]["id"]
    assert request(client, "bob", "GET", "/api/artifacts/" + aid).status_code == 404
    assert request(client, "alice", "GET", "/api/artifacts/" + aid).content == b"valid report"


def test_project_list_includes_compact_run_results_without_detail_fanout(api):
    client, settings = api
    project_id = project(client)["id"]
    store = Store(settings.home)
    run = store.enqueue(project_id)
    store.trial(run["id"], 0, {"status": "valid", "metrics": {"accuracy": .97},
                              "code": "private candidate source", "attempts": []})
    store.update(run["id"], forecast={"actual": [1, 2], "predicted": [1, 2]})
    listed = request(client, "alice", "GET", "/api/projects").json()
    assert len(listed) == 1
    summary = listed[0]["runs"][0]
    assert summary["id"] == run["id"]
    assert summary["trials"] == [{"ordinal": 0, "status": "valid", "metrics": {"accuracy": .97}}]
    assert "forecast" not in summary and "artifacts" not in summary
    assert "private candidate source" not in json.dumps(summary)
    assert request(client, "bob", "GET", "/api/projects").json() == []
    detail = request(client, "alice", "GET", "/api/runs/" + run["id"]).json()
    assert detail["trials"][0]["code"] == "private candidate source"
    assert detail["forecast"]["actual"] == [1, 2]


def test_concurrent_start_single_active_run(tmp_path):
    store = Store(tmp_path)
    pid = store.create_project("alice", {"goal": "abc"})["id"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        ids = list(pool.map(lambda _: store.enqueue(pid)["id"], range(12)))
    assert len(set(ids)) == 1 and len(store.runs(pid)) == 1


def test_demo_auth_loopback_only(tmp_path):
    settings = Settings(tmp_path, demo_auth=True)
    app = create_app(settings)
    headers = {"authorization": "Bearer local-demo-only"}
    local = TestClient(app, client=("127.0.0.1", 5000))
    remote = TestClient(app, client=("203.0.113.1", 5000))
    assert local.get("/api/templates", headers=headers).status_code == 200
    assert remote.get("/api/templates", headers=headers).status_code == 503


def test_templates_expose_both_metric_directions(api):
    client, _ = api
    listed = request(client, "alice", "GET", "/api/templates").json()
    by_id = {item["id"]: item for item in listed}
    assert by_id["digits-mlp-v1"]["primary_metric"] == "accuracy"
    assert by_id["digits-mlp-v1"]["direction"] == "maximize"
    assert by_id["digits-mlp-v1"]["runnable"] is True
    assert by_id["dlinear-etth1-v1"]["primary_metric"] == "mse"
    assert by_id["dlinear-etth1-v1"]["direction"] == "minimize"
    assert by_id["dlinear-etth1-v1"]["runnable"] is True
    created = request(client, "alice", "POST", "/api/projects", {"goal": "降低验证集MSE", "template_id": "dlinear-etth1-v1", "editable_paths": ["models/DLinear.py"]})
    assert created.status_code == 201
    assert created.json()["plan"]["template"]["confirmation_seeds"] == [2021, 2022, 2023]
    assert created.json()["metric"]["direction"] == "minimize"
    assert request(client, "alice", "POST", "/api/projects", {"goal": "降低验证集MSE", "template_id": "dlinear-etth1-v1", "editable_paths": ["model.py"]}).status_code == 422


def test_dlinear_not_offered_on_unsupported_runner(tmp_path):
    client = TestClient(create_app(Settings(tmp_path, runner="docker", signing_secret="a" * 40)))
    templates = request(client, "alice", "GET", "/api/templates").json()
    assert next(t for t in templates if t["id"] == "dlinear-etth1-v1")["runnable"] is False


def test_run_view_has_status_progress_and_metric(api):
    client, _ = api
    created = project(client)
    assert created["metric"]["primary_metric"] == "accuracy"
    assert created["metric"]["direction"] == "maximize"
    started = request(client, "alice", "POST", "/api/projects/" + created["id"] + "/runs", {"confirm_plan": True, "confirmer": "童宇昕", "opinion": "确认启动"})
    assert started.status_code == 202
    body = started.json()
    assert body["status"] == "queued"
    assert body["status_label"] == "排队中"
    assert body["progress"]["stage"] == "queued"
    assert body["progress"]["queue_position"] == 1
    assert body["metric"]["comparison"] == "higher_is_better"
    assert body["proposal_calls"]["count"] == 0
    assert "run_id" not in body["snapshot"]
    assert body["plan_confirmation"]["confirmer"] == "童宇昕"
    fetched = request(client, "alice", "GET", "/api/runs/" + body["id"]).json()
    assert fetched["trials"] == []
    assert fetched["status_label"] == "排队中"


def test_team_token_allows_remote_client(tmp_path):
    settings = Settings(tmp_path, demo_auth=True, team_auth=True, demo_token="team-token-0123456789")
    app = create_app(settings)
    remote = TestClient(app, client=("203.0.113.8", 5000))
    ok = remote.get("/api/templates", headers={"authorization": "Bearer team-token-0123456789"})
    assert ok.status_code == 200
    assert {item["direction"] for item in ok.json()} == {"maximize", "minimize"}
    assert remote.get("/api/templates", headers={"authorization": "Bearer wrong-token-value"}).status_code == 401
    health = remote.get("/health").json()
    assert health["auth"] == "team_bearer"
    assert any(item["status"] == "budget_exhausted" and item["label"] == "预算用尽" for item in health["statuses"])
