from dataclasses import replace
import json
from pathlib import Path

import numpy as np
import pytest
from autoresearch.engine import feedback_context
from evoresearch import ridge_tasks
from evoresearch.task_registry import registry, TaskRegistry, template_by_id, baseline_code, check_code
from contracts.domain import IngestionStatus
from autoresearch.config import Settings
from evoresearch.api import create_app
from fastapi.testclient import TestClient


def test_registry_is_extensible_and_returns_independent_metadata():
    new = TaskRegistry()
    original = registry.get("diabetes-ridge-v1")
    custom = replace(original, contract=replace(original.contract, template_id="third-party-test"))
    new.register(custom)
    assert new.get("third-party-test").validate(custom.baseline()) == {"alpha": 1.0}
    with pytest.raises(ValueError):
        new.register(custom)
    description = new.describe("third-party-test")
    description["allowed_parameters"].clear()
    assert new.describe("third-party-test")["allowed_parameters"]
    assert template_by_id("missing") is None
    with pytest.raises(ValueError):
        baseline_code("missing")


@pytest.mark.parametrize("source", [
    ridge_tasks.BASELINE + "\nimport os\n",
    ridge_tasks.BASELINE.replace("alpha=1.0", "alpha=True"),
    ridge_tasks.BASELINE.replace("alpha=1.0", "alpha=0"),
    ridge_tasks.BASELINE.replace("alpha=1.0", "alpha=1001"),
    ridge_tasks.BASELINE.replace("solver='cholesky'", "solver='svd'"),
    ridge_tasks.BASELINE.replace("alpha=1.0", "alpha=__import__('os').getpid()"),
])
def test_model_boundary_rejects_extra_code(source):
    with pytest.raises(ValueError):
        check_code("diabetes-ridge-v1", source)


def test_regression_splits_and_train_only_scaling(tmp_path):
    manifest = ridge_tasks.prepare_data("diabetes-ridge-v1", tmp_path)
    splits = [set(x) for x in manifest["split_indices"].values()]
    assert all(not a & b for i, a in enumerate(splits) for b in splits[i + 1:])
    assert sum(map(len, splits)) == 442
    assert np.allclose(np.load(tmp_path / "train_x.npy").mean(axis=0), 0, atol=1e-10)
    (tmp_path / "test_x.npy").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="integrity"):
        ridge_tasks.prepare_data("diabetes-ridge-v1", tmp_path)


def test_time_series_target_ranges_never_overlap(tmp_path):
    manifest = ridge_tasks.prepare_data("etth1-ridge-v1", tmp_path)
    assert manifest["scaler_fit_rows"] == [0, 8640]
    previous_end = 0
    for split in ("train", "validation", "test"):
        lo, hi = manifest["target_ranges"][split]
        starts = manifest["target_starts"][split]
        assert lo >= previous_end
        assert min(starts) >= lo and max(starts) + 24 <= hi
        previous_end = hi
        assert np.load(tmp_path / f"{split}_x.npy").shape[1] == 48 * 7
        assert np.load(tmp_path / f"{split}_y.npy").shape[1] == 24


def test_feedback_never_includes_test_or_confirmation_metrics():
    template = template_by_id("diabetes-ridge-v1")
    project = {"template_id": template["id"], "goal": "minimize validation error", "plan": {"template": template}}
    context = feedback_context(project, {"rmse": 50}, [{"ordinal": 0, "metrics": {"rmse": 49},
                                "test_metrics": {"rmse": 1}, "confirmation": {"rmse": 2}}], ridge_tasks.BASELINE)
    assert context["task_id"] == template["id"]
    assert "test_metrics" not in context["history"][0]
    assert "confirmation" not in context["history"][0]
    assert context["primary_metric"] == "validation_rmse"


def test_graphiti_visibility_contract():
    assert IngestionStatus.INDEX_PENDING is IngestionStatus.VISIBILITY_PENDING
    assert IngestionStatus.INDEXED is IngestionStatus.RETRIEVABLE
    from contracts.ports import KnowledgeIndexPort
    assert hasattr(KnowledgeIndexPort, "verify_retrievable")
    assert not hasattr(KnowledgeIndexPort, "sync")


def test_catalog_and_cross_task_http_validation(tmp_path):
    client = TestClient(create_app(Settings(tmp_path, runner="local_trusted", provider="feedback_demo"),
                                  "task-tests-local-service-token"))
    assert client.get("/api/templates").status_code == 401
    client.headers["Authorization"] = "Bearer task-tests-local-service-token"
    catalog = client.get("/api/templates").json()
    assert {t["task_family"] for t in catalog} == {"image_classification", "time_series_forecasting", "tabular_regression"}
    for key in ["etth1-ridge-v1", "diabetes-ridge-v1"]:
        template = template_by_id(key)
        body = {"task": {"task_id": key, "project_id": "p1", "template_id": key,
                         "objective": "Minimize validation error", "metric_key": template["primary_metric"],
                         "metric_direction": "minimize", "budget": {"max_trials": 2, "max_seconds": 300},
                         "allowed_edit_paths": ["model.py"], "use_history": False}}
        body["task"]["metric_direction"] = "maximize"
        assert client.post("/api/experiments", json=body).status_code == 422
        body["task"]["metric_direction"] = "minimize"
        response = client.post("/api/experiments", json=body)
        assert response.status_code == 202
        assert client.post('/api/experiments/' + response.json()["run_id"] + '/stop').json()["status"] == "stopped"


def test_ridge_execution_cache_and_output_integrity(tmp_path):
    settings = Settings(tmp_path / "store", runner="local_trusted", provider="feedback_demo")
    data, attempt = tmp_path / "data", tmp_path / "attempt"
    ridge_tasks.prepare_data("diabetes-ridge-v1", data)
    arguments = (settings, attempt, data, ridge_tasks.BASELINE, 7, "validation", 30, lambda: None)
    result = ridge_tasks.execute(*arguments, primary_metric="rmse")
    assert result["status"] == "valid"
    assert not (attempt / "inputs/validation_y.npy").exists()
    assert not (attempt / "inputs/test_y.npy").exists()
    assert ridge_tasks.execute(*arguments, primary_metric="rmse") == result
    (attempt / "output/predictions.npy").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="output_integrity"):
        ridge_tasks.execute(*arguments, primary_metric="rmse")
