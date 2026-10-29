import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

from autoresearch.config import Settings
from autoresearch.engine import Engine, feedback_context, feedback_demo
from autoresearch.mvp import TASK_NOTES, build_plan, run_plan, validate_plan
from autoresearch.store import Store
from autoresearch.templates import BASELINE, TEMPLATE, validate_code


def plan_for(home, **budget):
    settings = Settings(home, runner="local_trusted", provider="feedback_demo")
    return settings, build_plan(settings, "Improve validation accuracy", {**TEMPLATE["defaults"], **budget})


def test_plan_checks_without_training_and_blocks_missing_model(tmp_path, monkeypatch):
    for key in ("AUTORESEARCH_MODEL_BASE_URL", "AUTORESEARCH_MODEL", "AUTORESEARCH_MODEL_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    settings = Settings(tmp_path, runner="local_trusted", provider="openai_compatible")
    plan = build_plan(settings, "Improve validation accuracy", TEMPLATE["defaults"])
    assert plan["status"] == "blocked" and not tmp_path.joinpath("runs").exists()
    with pytest.raises(ValueError, match="运行条件不足"):
        run_plan(settings, plan, plan["sha256"])
    assert not tmp_path.joinpath("state.sqlite3").exists()


def test_changed_or_unconfirmed_plan_cannot_start(tmp_path):
    settings, plan = plan_for(tmp_path)
    with pytest.raises(ValueError, match="未确认"):
        run_plan(settings, plan, "wrong-version")
    changed = copy.deepcopy(plan)
    changed["budget"]["rounds"] += 1
    with pytest.raises(ValueError, match="已经修改"):
        run_plan(settings, changed, plan["sha256"])
    assert not tmp_path.joinpath("state.sqlite3").exists()
    settings.provider = "openai_compatible"
    with pytest.raises(ValueError, match="模型配置已变化"):
        validate_plan(plan, settings, plan["sha256"])


def test_notes_and_feedback_only_include_development_evidence(tmp_path):
    _, plan = plan_for(tmp_path)
    project = {"goal": plan["goal"], "plan": plan}
    context = feedback_context(project, {"accuracy": 0.8}, [
        {"ordinal": 0, "status": "valid", "metrics": {"accuracy": 0.9}, "final_evaluation": {"secret_test": 0.99}}
    ], BASELINE)
    assert context["task_notes"] == TASK_NOTES
    assert "secret_test" not in json.dumps(context)


def test_demo_proposal_preserves_supplied_best_parameters():
    parent = BASELINE.replace("(32,)", "(48,)").replace("alpha=0.001", "alpha=0.01")
    context = feedback_context({"goal": "Improve accuracy", "plan": {"task_notes": TASK_NOTES}},
                               {"accuracy": 0.8}, [{"ordinal": 0, "status": "valid", "delta": 0.1}], parent)
    proposal = feedback_demo(context)
    actual, previous = validate_code(proposal["code"]), validate_code(parent)
    assert actual["max_iter"] == 120
    assert {k: v for k, v in actual.items() if k != "max_iter"} == {k: v for k, v in previous.items() if k != "max_iter"}
    assert proposal["feedback_ordinals"] == [0]


def test_changed_method_material_requires_a_new_confirmed_plan(tmp_path, monkeypatch):
    settings, plan = plan_for(tmp_path)
    notes = copy.deepcopy(TASK_NOTES)
    notes["method_hypotheses"].append("Changed method material")
    monkeypatch.setattr("autoresearch.mvp.TASK_NOTES", notes)
    with pytest.raises(ValueError, match="资料已变化"):
        validate_plan(plan, settings, plan["sha256"])
    assert not tmp_path.joinpath("state.sqlite3").exists()


def test_unknown_source_reference_is_not_accepted(tmp_path, monkeypatch):
    def fake_valid(settings, root, data, code, seed, split, timeout, check):
        check()
        return {"status": "valid", "metrics": {"accuracy": 0.8, "macro_f1": 0.8}, "code_sha256": "fixture"}
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    settings, plan = plan_for(tmp_path, rounds=2)
    store = Store(tmp_path)
    project = store.create_project("local-mvp", {"goal": plan["goal"], "budget": plan["budget"], "plan": plan})
    store.enqueue(project["id"])
    Engine(settings, store, lambda context: {"hypothesis": "test", "rationale": "fixture", "code": BASELINE,
                                           "source_ids": ["invented-paper"]}).run(store.claim())
    trials = store.trials(store.runs(project["id"])[0]["id"])
    assert len(trials) == 2 and all(t["status"] == "model_failed" for t in trials)
    assert all(t["error"] == "invalid_proposal_source_reference" for t in trials)


def test_keyboard_interrupt_preserves_resumable_state(tmp_path, monkeypatch):
    def interrupted(*args):
        raise KeyboardInterrupt()
    monkeypatch.setattr("autoresearch.engine.execute", interrupted)
    settings, plan = plan_for(tmp_path)
    store = Store(tmp_path)
    project = store.create_project("local-mvp", {"goal": plan["goal"], "budget": plan["budget"], "plan": plan})
    store.enqueue(project["id"])
    run = store.claim()
    Engine(settings, store).run(run)
    assert store.run(run["id"])["status"] == "interrupted"
    assert (tmp_path / "runs" / run["id"] / "report.md").is_file()


def test_real_mvp_cli_run_duplicate_start_and_export(tmp_path):
    root = (Path(__file__).resolve().parents[2] / "packages/autoresearch")
    env = dict(os.environ, PYTHONUTF8="1", PYTHONPATH=str(root / "src"))
    home, plan_path = tmp_path / "state", tmp_path / "plan.json"
    def command(*args):
        result = subprocess.run([sys.executable, "-m", "autoresearch", *args], cwd=root, env=env,
                                capture_output=True, text=True, encoding="utf-8", timeout=180)
        assert result.returncode == 0, result.stderr + result.stdout
        return json.loads(result.stdout)
    preview = command("plan", "--home", str(home), "--goal", "Improve validation accuracy",
                      "--out", str(plan_path), "--runner", "local_trusted", "--provider", "feedback_demo", "--rounds", "2")
    assert preview["status"] == "ready" and not home.exists()
    args = ("run", "--home", str(home), "--plan", str(plan_path), "--confirm", preview["confirm"])
    result = command(*args)
    assert result["run"]["status"] == "completed" and len(result["trials"]) == 2
    assert result["trials"][1]["attempts"][0]["feedback_ordinals_declared"] == [0]
    assert result["trials"][0]["attempts"][0]["source_ids_declared"] == ["mlp-parameters"]
    assert command(*args)["run"]["id"] == result["run"]["id"]
    assert len(Store(home).runs(result["run"]["project_id"])) == 1
    assert command("status", "--home", str(home), "--run-id", result["run"]["id"])["run"]["status"] == "completed"
    destination = tmp_path / "research.zip"
    command("export", "--home", str(home), "--run-id", result["run"]["id"], "--out", str(destination))
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None and {"plan.json", "report.md", "run_summary.json"} <= set(archive.namelist())
        assert not any("private_data" in name for name in archive.namelist())
        exported_arrays = [name for name in archive.namelist() if "/output/" in name]
        assert exported_arrays and all(name.endswith(("/predictions.npy", "/labels.npy")) for name in exported_arrays)
    review_output = tmp_path / "review.json"
    run_root = home / "runs" / result["run"]["id"]
    review_args = [sys.executable, str(root / "scripts/review_run.py"), "--run-root", str(run_root), "--out", str(review_output)]
    reviewed = subprocess.run(review_args, cwd=root, env=env, capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert reviewed.returncode == 0, reviewed.stderr
    assert json.loads(review_output.read_text(encoding="utf-8"))["status"] == "verified"
    contexts = list(run_root.glob("trials/*/proposal-*/context.json"))
    originals = {path: path.read_bytes() for path in contexts}
    changed = json.loads(contexts[0].read_text(encoding="utf-8"))
    changed["direction"] = "minimize"
    contexts[0].write_text(json.dumps(changed), encoding="utf-8")
    rejected_direction = subprocess.run(review_args, cwd=root, env=env, capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert rejected_direction.returncode == 2 and "feedback_direction" in rejected_direction.stderr
    for path, original in originals.items():
        legacy = json.loads(original)
        legacy.pop("direction")
        path.write_text(json.dumps(legacy), encoding="utf-8")
    legacy_reviewed = subprocess.run(review_args, cwd=root, env=env, capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert legacy_reviewed.returncode == 0, legacy_reviewed.stderr
    for path, original in originals.items():
        path.write_bytes(original)
    report_bytes = (run_root / "report.md").read_bytes()
    unsafe_output = subprocess.run(review_args[:-1] + [str(run_root / "report.md")], cwd=root, env=env, capture_output=True, timeout=15)
    assert unsafe_output.returncode == 2 and (run_root / "report.md").read_bytes() == report_bytes
    predictions = run_root / "experiments/baseline-validation-7/output/predictions.npy"
    predictions.write_bytes(predictions.read_bytes() + b"tampered")
    rejected = subprocess.run(review_args, cwd=root, env=env, capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert rejected.returncode == 2 and "prediction_hash" in rejected.stderr
    assert json.loads(review_output.read_text(encoding="utf-8"))["status"] == "failed"


def test_plan_confirmation_is_separate_from_resume_history(tmp_path, monkeypatch):
    calls = []

    def counting(*args):
        calls.append(args[1].name)
        args[-1]()
        return {"status": "valid", "metrics": {"accuracy": 0.8, "macro_f1": 0.8}, "code_sha256": "fixture"}

    monkeypatch.setattr("autoresearch.engine.execute", counting)
    settings, plan = plan_for(tmp_path, rounds=2)
    store, run = run_plan(settings, plan, plan["sha256"])
    record = run["plan_confirmation"]
    assert record["review_status"] == "pending_review"
    assert record["plan_sha256"] == plan["sha256"]
    assert record["confirmed_at"] is None
    assert "resume_history" not in run
    done, elapsed = len(calls), run["elapsed"]
    _, filled = run_plan(settings, plan, plan["sha256"], confirmer="童宇昕", opinion="同意按该计划版本执行")
    assert filled["id"] == run["id"] and filled["llm_calls"] == run["llm_calls"] and filled["elapsed"] == elapsed
    assert len(calls) == done
    assert filled["plan_confirmation"]["review_status"] == "confirmed"
    assert filled["plan_confirmation"]["recorded_at"] == record["recorded_at"]
    assert filled["plan_confirmation"]["confirmed_at"]
    store.update(filled["id"], status="cancelled", stop_reason="user_stop")
    store.resume(filled["id"])
    resumed = store.run(filled["id"])
    assert resumed["status"] == "queued" and "stop_reason" not in resumed
    assert resumed["plan_confirmation"]["plan_sha256"] == plan["sha256"]
    assert isinstance(resumed["resume_history"][0]["resumed_at"], float)
    assert resumed["resume_history"][0]["resumed_at"] != resumed["plan_confirmation"]["confirmed_at"]
