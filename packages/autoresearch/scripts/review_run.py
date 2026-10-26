"""Recalculate a completed local run from retained predictions and labels.

This is a developer handoff check, not a teammate's independent acceptance.
It reads the full local run; the ordinary export intentionally omits arrays.
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys
import tempfile

import numpy as np

from autoresearch.mvp import fingerprint
from autoresearch.store import atomic_json
from autoresearch.templates import BASELINE, digest, prepare_data, validate_code


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def metrics(labels, predictions):
    require(labels.shape == predictions.shape and labels.ndim == 1, "prediction_shape")
    require(np.isfinite(predictions).all() and np.isin(predictions, np.arange(10)).all(), "invalid_predictions")
    scores = []
    for label in np.union1d(labels, predictions):
        tp = int(np.sum((labels == label) & (predictions == label)))
        fp = int(np.sum((labels != label) & (predictions == label)))
        fn = int(np.sum((labels == label) & (predictions != label)))
        scores.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0)
    return {"accuracy": float(np.mean(labels == predictions)), "macro_f1": statistics.mean(scores)}


def same_metrics(actual, recorded):
    require(set(actual) == set(recorded), "metric_fields")
    require(all(abs(actual[key] - recorded[key]) < 1e-12 for key in actual), "metric_mismatch")


def review(root):
    root = root.resolve()
    summary, plan, manifest = (read(root / name) for name in ("run_summary.json", "plan.json", "data_manifest.json"))
    require(summary["status"] == "completed", "run_not_completed")
    require(plan["sha256"] == fingerprint(plan), "plan_hash")
    require(plan["baseline_sha256"] == hashlib.sha256(BASELINE.encode()).hexdigest(), "baseline_version")
    data = root / "private_data"
    require(read(data / "manifest.json") == manifest, "data_manifest_mismatch")
    with tempfile.TemporaryDirectory(prefix="autoresearch-review-") as temporary:
        require(prepare_data(Path(temporary)) == manifest, "data_not_from_fixed_template")
    for name, expected in manifest["files"].items():
        path = (data / name).resolve()
        require(path.is_relative_to(data.resolve()) and path.is_file() and not path.is_symlink(), "data_path")
        require(digest(path) == expected, "data_hash:" + name)
    experiments = {}
    for folder in sorted((root / "experiments").iterdir()):
        result = read(folder / "result.json")
        require(result["status"] == "valid", "experiment_not_valid:" + folder.name)
        model = folder / "code/model.py"
        require(digest(model) == result["code_sha256"], "code_hash:" + folder.name)
        validate_code(model.read_text(encoding="utf-8"))
        for name, expected in result["input_sha256"].items():
            path = (folder / "inputs" / name).resolve()
            require(path.is_relative_to((folder / "inputs").resolve()), "input_path")
            require(digest(path) == expected, "input_hash:" + folder.name)
            source = result["split"] + "_x.npy" if name == "eval_x.npy" else name
            require(expected == manifest["files"][source], "input_not_from_fixed_split:" + folder.name)
        predictions = folder / "output/predictions.npy"
        labels = data / (result["split"] + "_y.npy")
        require(digest(predictions) == result["predictions_sha256"], "prediction_hash:" + folder.name)
        calculated = metrics(np.load(labels, allow_pickle=False), np.load(predictions, allow_pickle=False))
        same_metrics(calculated, result["metrics"])
        experiments[folder.name] = {"seed": result["seed"], "split": result["split"], "metrics": calculated,
                                   "code": model.relative_to(root).as_posix(), "code_sha256": result["code_sha256"],
                                   "result": (folder / "result.json").relative_to(root).as_posix(),
                                   "predictions": predictions.relative_to(root).as_posix(), "predictions_sha256": digest(predictions),
                                   "labels": labels.relative_to(root).as_posix(), "labels_sha256": digest(labels),
                                   "stdout": (folder / "stdout.log").relative_to(root).as_posix(),
                                   "stderr": (folder / "stderr.log").relative_to(root).as_posix()}
    baseline = experiments["baseline-validation-7"]["metrics"]
    same_metrics(baseline, summary["baseline"])
    trials = []
    notes_sources = {s["id"] for s in plan["task_notes"]["sources"]}
    history_fields = {"ordinal", "hypothesis", "status", "metrics", "delta", "error", "code_sha256"}
    for ordinal in range(plan["budget"]["rounds"]):
        trial_root = root / "trials" / str(ordinal)
        trial = read(trial_root / "trial.json")
        require(trial["terminal"] and trial["status"] == "valid", "trial_not_valid")
        best = max([t for t in trials if t["delta"] > 0], key=lambda t: t["metrics"]["accuracy"], default=None)
        parent = best["code"] if best else BASELINE
        expected_history = [{k: t[k] for k in history_fields if k in t} for t in trials]
        for attempt in trial["attempts"]:
            number = attempt["attempt"]
            proposal_root = trial_root / f"proposal-{number}"
            context, proposal = read(proposal_root / "context.json"), read(proposal_root / "proposal.json")
            feedback_fields = {"goal", "primary_metric", "fixed_baseline", "allowed_parameters", "editable_paths", "current_code", "history", "repair_error", "task_notes"}
            require(set(context) in (feedback_fields, feedback_fields | {"direction"}), "feedback_fields")
            require(context.get("direction", plan["template"]["direction"]) == plan["template"]["direction"], "feedback_direction")
            require(context["history"] == expected_history, "feedback_history")
            require(context["task_notes"] == plan["task_notes"], "method_notes_not_supplied")
            same_metrics(context["fixed_baseline"], baseline)
            require(context["current_code"] == parent, "proposal_parent_code")
            require(attempt["parent_ordinal"] == (best["ordinal"] if best else None), "proposal_parent_ordinal")
            require(attempt["parent_code_sha256"] == hashlib.sha256(parent.encode()).hexdigest(), "proposal_parent_hash")
            require(set(proposal.get("source_ids", [])) <= notes_sources, "unknown_method_reference")
            require(set(proposal.get("feedback_ordinals", [])) <= set(range(ordinal)), "unknown_feedback_reference")
            require(proposal.get("source_ids", []) == attempt["source_ids_declared"], "recorded_source_reference")
            require(proposal.get("feedback_ordinals", []) == attempt["feedback_ordinals_declared"], "recorded_feedback_reference")
        final_attempt = trial["attempts"][-1]
        exp = experiments[f"trial-{ordinal}-attempt-{final_attempt['attempt']}-validation-7"]
        require(exp["code_sha256"] == trial["code_sha256"], "trial_code_hash")
        same_metrics(exp["metrics"], trial["metrics"])
        require(abs(trial["delta"] - (exp["metrics"]["accuracy"] - baseline["accuracy"])) < 1e-12, "trial_delta")
        trials.append({"ordinal": ordinal, **trial})
    frozen = read(root / "frozen.json")
    best = max([t for t in trials if t["delta"] > 0], key=lambda t: t["metrics"]["accuracy"], default=None)
    require(frozen["candidate_ordinal"] == (best["ordinal"] if best else None), "frozen_selection")
    require(frozen["code"] == (best["code"] if best else BASELINE), "frozen_code")
    frozen_sha = hashlib.sha256(frozen["code"].encode()).hexdigest()
    for stage, split, base_prefix, candidate_prefix in [("confirmation", "validation", "baseline-validation", "confirmation-candidate"),
                                                       ("final_evaluation", "test", "final-baseline", "final-candidate")]:
        pairs = summary[stage]["pairs"]
        require([p["seed"] for p in pairs] == plan["template"]["confirmation_seeds"], "paired_seeds")
        deltas = []
        for pair in pairs:
            base = experiments[f"{base_prefix}-{pair['seed']}"]
            candidate = experiments[f"{candidate_prefix}-{pair['seed']}"] if best else base
            require(base["split"] == candidate["split"] == split and candidate["code_sha256"] == frozen_sha, "frozen_evaluation")
            require(base["code_sha256"] == plan["baseline_sha256"], "paired_baseline_version")
            if stage == "confirmation":
                require(pair["baseline"] == base["metrics"]["accuracy"] and pair["candidate"] == candidate["metrics"]["accuracy"], "confirmation_pair")
            else:
                same_metrics(pair["baseline"], base["metrics"])
                same_metrics(pair["candidate"], candidate["metrics"])
            delta = candidate["metrics"]["accuracy"] - base["metrics"]["accuracy"]
            require(abs(pair["delta"] - delta) < 1e-12, "paired_delta")
            deltas.append(delta)
        require(abs(statistics.mean(deltas) - summary[stage]["mean_delta"]) < 1e-12, "paired_mean")
    require(summary["confirmation"]["improved"] == (bool(best) and summary["confirmation"]["mean_delta"] > 0), "confirmation_judgment")
    return {"schema": "shenzhi-phase1-run-review-v0.1", "run_id": summary["id"], "status": "verified",
            "provider": summary["provider"], "runner": summary["runner"], "plan_sha256": plan["sha256"],
            "task_notes_version": plan["task_notes"]["version"], "baseline": baseline,
            "trial_count": len(trials), "experiment_count": len(experiments), "experiments": experiments,
            "trials": [{"ordinal": t["ordinal"], "metrics": t["metrics"], "delta": t["delta"], "code_sha256": t["code_sha256"],
                        "parent_ordinal": t["attempts"][-1]["parent_ordinal"], "feedback_ordinals": t["attempts"][-1]["feedback_ordinals_declared"]} for t in trials],
            "confirmation": summary["confirmation"], "final_evaluation": summary["final_evaluation"],
            "notice": "开发侧逐项核对；不代替张嘉荣的结果复算、胡杨的独立复现或王筠昊的验收。"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(args.run_root.resolve()):
        print("核对文件必须保存在原始运行目录之外", file=sys.stderr)
        return 2
    try:
        result = review(args.run_root)
        atomic_json(args.out, result)
        print(json.dumps({"status": result["status"], "run_id": result["run_id"], "experiments": result["experiment_count"], "review": str(args.out.resolve())}, ensure_ascii=False))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as exc:
        atomic_json(args.out, {"schema": "shenzhi-phase1-run-review-v0.1", "status": "failed", "error": str(exc)})
        print("运行核对失败：" + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
