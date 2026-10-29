import json
import time
from pathlib import Path

import pytest

from autoresearch.config import Halt, Settings
from autoresearch.engine import Engine, feedback_context
from autoresearch.store import Store
from autoresearch.templates import BASELINE, TEMPLATE, prepare_data, validate_code
from autoresearch.worker import WorkerLock


def setup_run(tmp_path, budget=None):
    settings = Settings(tmp_path, runner="local_trusted", provider="feedback_demo")
    store = Store(tmp_path)
    project = store.create_project("alice", {"goal": "Improve validation accuracy", "template_id": TEMPLATE["id"], "budget": {**TEMPLATE["defaults"], **(budget or {})}})
    store.enqueue(project["id"])
    return settings, store, store.claim()


@pytest.mark.parametrize("repeat", range(3))
def test_three_real_end_to_end_runs(tmp_path, repeat):
    settings, store, run = setup_run(tmp_path)
    Engine(settings, store).run(run)
    result = store.run(run["id"])
    assert result["status"] == "completed", result
    trials = store.trials(run["id"])
    assert len(trials) == 3 and all(t["status"] == "valid" for t in trials)
    assert all(t["code_sha256"] and t["attempts"][0]["predictions_sha256"] for t in trials)
    root = settings.home / "runs" / run["id"]
    contexts = sorted(root.glob("trials/*/proposal-0/context.json"))
    assert len(contexts) == 3
    for index, path in enumerate(contexts):
        context = json.loads(path.read_text(encoding="utf-8"))
        assert len(context["history"]) == index
        assert "final_evaluation" not in json.dumps(context)
    assert len(result["confirmation"]["pairs"]) == len(result["final_evaluation"]["pairs"]) == 3
    assert result["llm_calls"] == 3
    assert root.joinpath("report.md").is_file()
    assert not any("private_data" in a["path"] for a in store.artifacts(run["id"]))
    assert root.joinpath("experiments/baseline-validation-7/code/model.py").read_text(encoding="utf-8") == BASELINE


def fake_valid(settings, root, data, code, seed, split, timeout, check):
    check()
    root.mkdir(parents=True, exist_ok=True)
    return {"status": "valid", "metrics": {"accuracy": 0.8, "macro_f1": 0.8}, "code_sha256": "test-sha", "seed": seed, "split": split}


def test_no_improvement_is_complete(tmp_path, monkeypatch):
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    settings, store, run = setup_run(tmp_path)
    Engine(settings, store).run(run)
    result = store.run(run["id"])
    assert result["status"] == "completed" and not result["confirmation"]["improved"]
    assert all(t["delta"] == 0 for t in store.trials(run["id"]))


@pytest.mark.parametrize("metric,direction,baseline,scores,winner", [
    ("accuracy", "maximize", 0.8, [0.85, 0.9, 0.83], 1),
    ("mse", "minimize", 1.0, [0.8, 0.7, 0.9], 1),
    ("mse", "minimize", 0.5, [0.6, 0.7, 0.8], None),
    ("mse", "minimize", 0.5, [0.5, 0.5, 0.5], None),
])
def test_metric_direction_controls_iteration_and_confirmation(tmp_path, monkeypatch, metric, direction, baseline, scores, winner):
    # Controlled scores exercise the loop; this does not run a DLinear model.
    codes = [BASELINE.replace("(32,)", f"({width},)") for width in (48, 64, 80)]
    contexts = []

    def propose(context):
        contexts.append(context)
        return {"hypothesis": "controlled", "rationale": "controlled feedback test", "code": codes[len(contexts) - 1]}

    def controlled(settings, root, data, code, seed, split, timeout, check):
        check()
        root.mkdir(parents=True, exist_ok=True)
        score = baseline if code == BASELINE else scores[codes.index(code)]
        return {"status": "valid", "metrics": {metric: score}, "code_sha256": "controlled-sha",
                "seed": seed, "split": split}

    monkeypatch.setattr("autoresearch.engine.execute", controlled)
    settings = Settings(tmp_path, runner="local_trusted", provider="feedback_demo")
    store = Store(tmp_path)
    template = {**TEMPLATE, "primary_metric": metric, "direction": direction}
    project = store.create_project("alice", {"goal": "Metric direction test", "template_id": TEMPLATE["id"],
                                            "budget": TEMPLATE["defaults"], "plan": {"template": template}})
    store.enqueue(project["id"])
    run = store.claim()
    Engine(settings, store, propose).run(run)
    result = store.run(run["id"])
    assert result["status"] == "completed", result
    trials = store.trials(run["id"])
    assert [t["delta"] for t in trials] == pytest.approx([score - baseline for score in scores])
    assert all(c["primary_metric"] == "validation_" + metric and c["direction"] == direction for c in contexts)
    assert contexts[0]["current_code"] == BASELINE
    assert contexts[1]["current_code"] == (codes[0] if winner is not None else BASELINE)
    assert contexts[2]["current_code"] == (codes[1] if winner is not None else BASELINE)
    root = settings.home / "runs" / run["id"]
    frozen = json.loads((root / "frozen.json").read_text(encoding="utf-8"))
    assert frozen["candidate_ordinal"] == winner and frozen["primary_metric"] == metric
    expected_delta = 0 if winner is None else scores[winner] - baseline
    assert result["confirmation"]["mean_delta"] == pytest.approx(expected_delta)
    assert result["confirmation"]["improved"] == (winner is not None)
    assert result["final_evaluation"]["mean_delta"] == pytest.approx(expected_delta)
    report = (root / "report.md").read_text(encoding="utf-8")
    assert ("越高越好" if direction == "maximize" else "越低越好") in report
    assert ("验证准确率" if metric == "accuracy" else "验证MSE") in report


@pytest.mark.parametrize("failure_key", ["baseline-validation-7", "trial-0-attempt-0-validation-7", "baseline-validation-17", "final-baseline-7"])
def test_termination_failure_stops_entire_run(tmp_path, monkeypatch, failure_key):
    calls = []
    reason = "terminate_failed:injected_process_still_alive"

    def controlled(*args):
        calls.append(args[1].name)
        if calls[-1] == failure_key:
            return {"status": "timeout", "error": reason, "code_sha256": "failed-attempt"}
        return fake_valid(*args)

    monkeypatch.setattr("autoresearch.engine.execute", controlled)
    settings, store, run = setup_run(tmp_path)
    Engine(settings, store).run(run)
    result = store.run(run["id"])
    assert result["status"] == "failed" and result["stage"] == "termination_failed"
    assert result["error"] == reason and calls[-1] == failure_key
    assert calls.count(failure_key) == 1
    if failure_key.startswith("trial-"):
        trials = store.trials(run["id"])
        assert len(trials) == 1 and len(trials[0]["attempts"]) == 1
        assert trials[0]["attempts"][0]["code_sha256"] == "failed-attempt"
    report = (settings.home / "runs" / run["id"] / "report.md").read_text(encoding="utf-8")
    assert reason in report


def test_proposal_termination_failure_is_not_repaired(tmp_path, monkeypatch):
    calls, proposals = [], []
    reason = "terminate_failed:injected_provider_process_still_alive"

    def controlled(*args):
        calls.append(args[1].name)
        return fake_valid(*args)

    def broken(context):
        proposals.append(context)
        raise TimeoutError(reason)

    monkeypatch.setattr("autoresearch.engine.execute", controlled)
    settings, store, run = setup_run(tmp_path)
    Engine(settings, store, broken).run(run)
    result = store.run(run["id"])
    assert result["status"] == "failed" and result["stage"] == "termination_failed"
    assert result["error"] == reason
    assert calls == ["baseline-validation-7"] and len(proposals) == 1
    assert store.trials(run["id"])[0]["attempts"][0]["error"] == reason


def test_ordinary_experiment_timeout_still_allows_repair(tmp_path, monkeypatch):
    def controlled(*args):
        if args[1].name == "trial-0-attempt-0-validation-7":
            return {"status": "timeout", "error": "experiment_timeout"}
        return fake_valid(*args)

    monkeypatch.setattr("autoresearch.engine.execute", controlled)
    settings, store, run = setup_run(tmp_path)
    Engine(settings, store).run(run)
    assert store.run(run["id"])["status"] == "completed"
    assert len(store.trials(run["id"])[0]["attempts"]) == 2


def test_invalid_modification_and_single_repair(tmp_path, monkeypatch):
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    settings, store, run = setup_run(tmp_path)
    def proposer(context):
        return {"hypothesis": "bad code", "rationale": "fixture", "code": "import os\nos.system('bad')"}
    Engine(settings, store, proposer).run(run)
    trials = store.trials(run["id"])
    assert len(trials) == 3 and all(t["status"] == "check_failed" for t in trials)
    assert all(len(t["attempts"]) == 2 for t in trials)
    assert store.run(run["id"])["llm_calls"] == 6


def test_failed_attempt_repaired_and_context_records_reason(tmp_path, monkeypatch):
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    settings, store, run = setup_run(tmp_path)
    contexts = []
    def proposer(context):
        contexts.append(context)
        return {"hypothesis": "repair", "rationale": "fixture", "code": BASELINE if context["repair_error"] else "print('forbidden')"}
    Engine(settings, store, proposer).run(run)
    assert all(t["status"] == "valid" and len(t["attempts"]) == 2 for t in store.trials(run["id"]))
    assert contexts[1]["repair_error"]


def test_model_call_budget(tmp_path, monkeypatch):
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    settings, store, run = setup_run(tmp_path, {"max_llm_calls": 1})
    Engine(settings, store).run(run)
    assert store.run(run["id"])["status"] == "budget_exhausted"
    assert store.run(run["id"])["llm_calls"] == 1


def test_model_failure_is_not_experiment_failure(tmp_path, monkeypatch):
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    settings, store, run = setup_run(tmp_path)
    def broken(context):
        raise ValueError("model_call_failed")
    Engine(settings, store, broken).run(run)
    assert all(t["status"] == "model_failed" for t in store.trials(run["id"]))


def test_stop_and_resume_completed_trial_not_repeated(tmp_path, monkeypatch):
    calls = []
    def controlled(*args):
        calls.append(args[1].name)
        if args[1].name == "trial-1-attempt-0-validation-7":
            store.stop(run["id"])
            args[-1]()
        return fake_valid(*args)
    monkeypatch.setattr("autoresearch.engine.execute", controlled)
    settings, store, run = setup_run(tmp_path)
    Engine(settings, store).run(run)
    assert store.run(run["id"])["status"] == "cancelled"
    stopped_elapsed = store.run(run["id"])["elapsed"]
    assert store.trials(run["id"])[0]["terminal"]
    monkeypatch.setattr("autoresearch.engine.execute", fake_valid)
    store.resume(run["id"])
    Engine(settings, store).run(store.claim())
    assert store.run(run["id"])["status"] == "completed"
    assert store.run(run["id"])["llm_calls"] == 3
    completed = store.run(run["id"])
    assert "stop_reason" not in completed and "error" not in completed
    assert len(completed["resume_history"]) == 1
    event = completed["resume_history"][0]
    assert event["previous_status"] == "cancelled" and event["stop_reason"] == "user_stop"
    assert event["elapsed"] == stopped_elapsed and completed["elapsed"] >= stopped_elapsed
    assert "停止或失败原因：user_stop" not in (settings.home / "runs" / run["id"] / "report.md").read_text(encoding="utf-8")


def test_total_budget_before_any_work(tmp_path):
    settings, store, run = setup_run(tmp_path, {"total_seconds": 10})
    store.update(run["id"], elapsed=11)
    Engine(settings, store).run(store.run(run["id"]))
    assert store.run(run["id"])["status"] == "budget_exhausted"
    assert not store.trials(run["id"])


def test_recovery_marks_interrupted_and_worker_exclusive(tmp_path):
    settings, store, run = setup_run(tmp_path)
    with WorkerLock(tmp_path / "worker.lock"):
        with pytest.raises(RuntimeError):
            with WorkerLock(tmp_path / "worker.lock"):
                pass
    store.recover()
    assert store.run(run["id"])["status"] == "interrupted"


def test_test_evidence_never_in_feedback():
    context = feedback_context({"goal": "abc"}, {"accuracy": 0.8}, [{"ordinal": 0, "status": "valid", "metrics": {"accuracy": 0.9}, "final_evaluation": {"secret_test": 0.99}}], BASELINE)
    assert "secret_test" not in json.dumps(context)


def test_fixed_disjoint_split_and_integrity(tmp_path):
    manifest = prepare_data(tmp_path)
    indices = manifest["split_indices"]
    sets = [set(indices[k]) for k in ("train", "validation", "test")]
    assert sum(map(len, sets)) == 1797
    assert not sets[0] & sets[1] and not sets[0] & sets[2] and not sets[1] & sets[2]
    assert prepare_data(tmp_path) == manifest
    (tmp_path / "train_y.npy").write_bytes(b"changed")
    with pytest.raises(ValueError, match="data_integrity"):
        prepare_data(tmp_path)


@pytest.mark.parametrize("source", [BASELINE + "\nprint('x')", BASELINE.replace("random_state=seed", "random_state=99"), BASELINE.replace("(32,)", "(10000,)"), BASELINE.replace("alpha=0.001", "alpha=__import__('os').system('x')"), BASELINE.replace("def build_model(seed):", "@print('x')\ndef build_model(seed):"), BASELINE.replace("max_iter=80", "max_iter=10000")])
def test_code_boundary(source):
    with pytest.raises(ValueError):
        validate_code(source)
