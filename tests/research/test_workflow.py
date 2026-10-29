from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from autoresearch.config import Settings
from contracts.domain import ExperimentBudget, ExperimentTask, RunStatus
from evoresearch.adapter import AutoResearchAdapter, TaskConflict
from evoresearch.api import create_app

TOKEN = "phase5-tests-only-not-a-secret-token"


def test_no_implicit_knowledge_enhancement(tmp_path):
    client = TestClient(create_app(Settings(tmp_path), TOKEN))
    client.headers['Authorization'] = 'Bearer ' + TOKEN
    payload = json.loads((Path(__file__).parents[2] / 'examples/start.json').read_text())
    del payload['task']['use_history']
    assert client.post('/api/experiments', json=payload).status_code == 422


@pytest.fixture
def task():
    return ExperimentTask("t1", "p1", "digits-mlp-v1", "Improve validation accuracy",
                          "accuracy", "maximize", ExperimentBudget(2, 300), ("model.py",), False)


@pytest.fixture
def adapter(tmp_path):
    return AutoResearchAdapter(Settings(tmp_path, runner="local_trusted", provider="feedback_demo"))


def test_start_is_atomic_and_idempotent_across_process_restarts(adapter, task):
    with ThreadPoolExecutor(max_workers=6) as pool:
        receipts = list(pool.map(lambda _: adapter.start(task, []), range(12)))
    assert len({r.run_id for r in receipts}) == 1
    reopened = AutoResearchAdapter(adapter.settings)
    assert reopened.start(task, []).run_id == receipts[0].run_id
    with adapter.store.connect() as con:
        assert con.execute("SELECT count(*) FROM projects").fetchone()[0] == 1
        assert con.execute("SELECT count(*) FROM runs").fetchone()[0] == 1
    with pytest.raises(TaskConflict):
        adapter.start(replace(task, objective="different objective"), [])
    # Separate business projects may legitimately use the same task id.
    assert adapter.start(replace(task, project_id="p2"), []).run_id != receipts[0].run_id


@pytest.mark.parametrize("changes", [
    {"metric_key": "test_accuracy"}, {"metric_direction": "minimize"},
    {"allowed_edit_paths": ("../model.py",)}, {"use_history": True},
    {"budget": ExperimentBudget(2, 300, 1)}, {"budget": ExperimentBudget(True, 300)},
    {"budget": ExperimentBudget(2, 0)}, {"objective": "   "},
])
def test_invalid_tasks_do_not_create_work(adapter, task, changes):
    with pytest.raises(ValueError):
        adapter.start(replace(task, **changes), [])
    with adapter.store.connect() as con:
        assert con.execute("SELECT count(*) FROM runs").fetchone()[0] == 0


@pytest.mark.parametrize("raw, expected", [
    ("queued", "queued"), ("running", "running"), ("cancelling", "running"),
    ("cancelled", "stopped"), ("budget_exhausted", "stopped"),
    ("failed", "failed"), ("completed", "completed"), ("interrupted", "interrupted"),
])
def test_status_mapping_retains_engine_state(adapter, task, raw, expected):
    receipt = adapter.start(task, [])
    adapter.store.update(receipt.run_id, status=raw)
    assert adapter.status(receipt.run_id).value == expected
    assert adapter.snapshot(receipt.run_id)["engine_status"] == raw


def test_stop_and_recover(adapter, task):
    first = adapter.start(task, [])
    assert adapter.stop(first.run_id)
    assert adapter.status(first.run_id) == RunStatus.STOPPED
    assert not adapter.stop(first.run_id)
    second = adapter.start(replace(task, task_id="t2"), [])
    adapter.store.claim()
    assert adapter.stop(second.run_id)
    assert adapter.snapshot(second.run_id)["engine_status"] == "cancelling"
    adapter.store.recover()
    assert adapter.status(second.run_id) == RunStatus.INTERRUPTED


def test_unmapped_engine_runs_cannot_be_accessed(adapter):
    project = adapter.store.create_project("someone_else", {})
    run = adapter.store.enqueue(project["id"])
    with pytest.raises(KeyError):
        adapter.stop(run["id"])


def test_http_boundary(tmp_path):
    app = create_app(Settings(tmp_path, runner="local_trusted", provider="feedback_demo"), TOKEN)
    client = TestClient(app)
    payload = json.loads((Path(__file__).parents[2] / "examples/start.json").read_text())
    assert client.get("/health").status_code == 200
    assert client.post("/api/experiments", json=payload).status_code == 401
    client.headers["Authorization"] = "Bearer " + TOKEN
    result = client.post("/api/experiments", json=payload)
    assert result.status_code == 202
    rid = result.json()["run_id"]
    assert client.post("/api/experiments", json=payload).json()["run_id"] == rid
    assert client.get(f"/api/experiments/{rid}").json()["project_id"] == "research-demo"
    payload["task"]["objective"] = "A conflicting objective"
    assert client.post("/api/experiments", json=payload).status_code == 409
    payload["task"]["budget"]["max_trials"] = "2"
    assert client.post("/api/experiments", json=payload).status_code == 422
    assert client.post(f"/api/experiments/{rid}/stop").json()["status"] == "stopped"
    assert client.get("/api/experiments/unknown").status_code == 404
    assert client.post("/api/experiments/unknown/stop").status_code == 404


def test_missing_knowledge_fails_without_silent_downgrade(tmp_path, monkeypatch):
    client = TestClient(create_app(Settings(tmp_path), TOKEN))
    client.headers["Authorization"] = "Bearer " + TOKEN
    payload = json.loads((Path(__file__).parents[2] / "examples/start.json").read_text())
    del payload["task"]["use_history"]
    monkeypatch.delenv("GRAPHITI_PASSWORD", raising=False)
    monkeypatch.delenv("GRAPHITI_LLM_API_KEY", raising=False)
    monkeypatch.delenv("GRAPHITI_LLM_KEY_FILE", raising=False)
    assert client.post("/api/experiments", json=payload).status_code == 503


def test_token_required(tmp_path):
    with pytest.raises(ValueError):
        create_app(Settings(tmp_path), "")
