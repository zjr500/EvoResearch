"""Two task families sharing a constrained model runner, not training scores."""
import ast
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

import numpy as np
from sklearn.datasets import load_diabetes
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from autoresearch.config import Halt
from autoresearch.store import atomic_json
from autoresearch.templates import digest

BASELINE = "from sklearn.linear_model import Ridge\n\ndef build_model(seed):\n    return Ridge(alpha=1.0, solver='cholesky')\n"


def validate_code(source):
    if not isinstance(source, str) or len(source) > 2000:
        raise ValueError("invalid_code_size")
    try:
        tree, reference = ast.parse(source), ast.parse(BASELINE)
        call = tree.body[1].body[0].value
        alpha_nodes = [k for k in call.keywords if k.arg == "alpha"]
        if len(alpha_nodes) != 1:
            raise ValueError("invalid_alpha")
        value = ast.literal_eval(alpha_nodes[0].value)
        if type(value) not in {int, float} or not np.isfinite(value) or not 0.0001 <= value <= 1000:
            raise ValueError("parameter_budget")
        alpha_nodes[0].value = ast.Constant(value=1.0)
        if ast.dump(tree) != ast.dump(reference):
            raise ValueError("editable_boundary: only Ridge alpha may change")
        return {"alpha": value}
    except (SyntaxError, TypeError, AttributeError, IndexError) as exc:
        raise ValueError("invalid_model_code") from exc


def propose(context):
    alpha = (0.1, 10.0, 100.0)[len(context["history"]) % 3]
    return {"hypothesis": f"Evaluate Ridge alpha={alpha}",
            "rationale": "Fixed-budget rule proposal; validation determines selection, never the held-out test set.",
            "code": BASELINE.replace("alpha=1.0", f"alpha={alpha}"),
            "feedback_ordinals": [t["ordinal"] for t in context["history"]]}


def prepare_data(template_id, root):
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest["template_id"] != template_id:
            raise ValueError("dataset_template_conflict")
        if any(digest(root / name) != sha for name, sha in manifest["files"].items()):
            raise ValueError("data_integrity_failed")
        return manifest
    arrays = {}
    if template_id == "diabetes-ridge-v1":
        dataset = load_diabetes(scaled=False)
        train, remainder = train_test_split(np.arange(len(dataset.target)), test_size=0.4, random_state=7)
        val, test = train_test_split(remainder, test_size=0.5, random_state=7)
        scaler = StandardScaler().fit(dataset.data[train])
        x = scaler.transform(dataset.data)
        splits = {"train": train, "validation": val, "test": test}
        for name, indices in splits.items():
            arrays[name + "_x"] = x[indices]
            arrays[name + "_y"] = dataset.target[indices]
        manifest = {"dataset": "sklearn-diabetes", "split_seed": 7,
                    "split_indices": {k: v.tolist() for k, v in splits.items()},
                    "scaler_fit_split": "train", "scaler_mean": scaler.mean_.tolist()}
    elif template_id == "etth1-ridge-v1":
        import autoresearch
        source = Path(autoresearch.__file__).parent / "assets/dlinear/ETTh1.csv"
        with source.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.reader(stream))
        raw = np.asarray([[float(v) for v in row[1:]] for row in rows[1:14401]])
        scaler = StandardScaler().fit(raw[:8640])
        series = scaler.transform(raw)
        ranges = {"train": (48, 8640), "validation": (8640, 11520), "test": (11520, 14400)}
        target_starts = {}
        for name, (start, end) in ranges.items():
            starts = list(range(start, end - 24 + 1, 6 if name == "train" else 24))
            arrays[name + "_x"] = np.stack([series[t - 48:t].reshape(-1) for t in starts])
            arrays[name + "_y"] = np.stack([series[t:t + 24, -1] for t in starts])
            target_starts[name] = starts
        manifest = {"dataset": "ETTh1", "source_sha256": digest(source), "seq_len": 48, "pred_len": 24,
                    "target": rows[0][-1], "columns": rows[0][1:], "target_ranges": ranges,
                    "target_starts": target_starts, "train_stride": 6, "evaluation_stride": 24,
                    "scaler_fit_rows": [0, 8640], "scaler_mean": scaler.mean_.tolist(),
                    "unit": "train_standardized"}
    else:
        raise ValueError("Unknown Ridge task")
    for name, value in arrays.items():
        np.save(root / (name + ".npy"), value, allow_pickle=False)
    manifest.update(template_id=template_id, files={p.name: digest(p) for p in root.glob("*.npy")})
    atomic_json(manifest_path, manifest)
    return manifest


def execute(settings, root, data, code, seed, split, timeout, check, *, primary_metric):
    from autoresearch.executor import supervised
    if settings.runner != "local_trusted":
        raise ValueError("ridge_requires_local_trusted")
    if split not in {"validation", "test"}:
        raise ValueError("invalid_evaluation_split")
    validate_code(code)
    manifest = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
    if any(digest(data / name) != sha for name, sha in manifest["files"].items()):
        raise ValueError("data_integrity_failed")
    root.mkdir(parents=True, exist_ok=True)
    model, result_path = root / "model.py", root / "result.json"
    identity = {"code_sha256": hashlib.sha256(code.encode()).hexdigest(), "seed": seed,
                "split": split, "data_manifest_sha256": digest(data / "manifest.json")}
    if result_path.exists():
        cached = json.loads(result_path.read_text(encoding="utf-8"))
        if any(cached.get(k) != v for k, v in identity.items()) or digest(model) != identity["code_sha256"]:
            raise ValueError("experiment_identity_conflict")
        if cached["status"] == "valid":
            for name in ("predictions", "labels"):
                if digest(root / "output" / (name + ".npy")) != cached[name + "_sha256"]:
                    raise ValueError("experiment_output_integrity_conflict")
        return cached
    model.write_text(code, encoding="utf-8", newline="")
    inputs, output = root / "inputs", root / "output"
    inputs.mkdir(exist_ok=True)
    output.mkdir(exist_ok=True)
    # Only evaluation features enter the subprocess, never evaluation labels.
    for src, dest in [("train_x.npy", "train_x.npy"), ("train_y.npy", "train_y.npy"), (split + "_x.npy", "eval_x.npy")]:
        shutil.copyfile(data / src, inputs / dest)
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE"}}
    env.update(OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1", PYTHONUTF8="1")
    command = [sys.executable, "-I", str(Path(__file__).with_name("ridge_runner.py")),
               str(model.resolve()), str(inputs.resolve()), str(output.resolve()), str(seed)]
    result = {**identity, "runner": settings.runner}
    try:
        status = supervised(command, root, env, timeout, check, root / "stdout.log", root / "stderr.log")
        if status != 0:
            result.update(status="execution_failed", error=f"process_exit_{status}")
        else:
            pred = np.load(output / "predictions.npy", allow_pickle=False)
            labels = np.load(data / (split + "_y.npy"), allow_pickle=False)
            if pred.shape != labels.shape or not np.isfinite(pred).all():
                raise ValueError("invalid_predictions")
            residuals = pred - labels
            mse = float(np.mean(residuals ** 2))
            metrics = {primary_metric: mse if primary_metric == "mse" else float(np.sqrt(mse)),
                       "mae": float(np.mean(np.abs(residuals)))}
            if not all(np.isfinite(value) for value in metrics.values()):
                raise ValueError("nonfinite_metrics")
            np.save(output / "labels.npy", labels, allow_pickle=False)
            result.update(status="valid", metrics=metrics, predictions_sha256=digest(output / "predictions.npy"),
                          labels_sha256=digest(output / "labels.npy"))
    except Halt:
        raise
    except TimeoutError as exc:
        result.update(status="timeout", error=str(exc) if str(exc).startswith("terminate_failed:") else "experiment_timeout")
    except (ValueError, OSError) as exc:
        result.update(status="invalid_output", error=type(exc).__name__)
    atomic_json(result_path, result)
    return result
