import ast
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split

BASELINE = '''from sklearn.neural_network import MLPClassifier

def build_model(seed):
    return MLPClassifier(hidden_layer_sizes=(32,), activation="relu", solver="adam", alpha=0.001, learning_rate_init=0.001, max_iter=80, random_state=seed)
'''

TEMPLATE = {
    "id": "digits-mlp-v1", "version": "1.0", "name": "手写数字模型改进",
    "description": "真实 digits 数据，固定训练/验证/测试划分，改进 MLP 模型。",
    "editable_paths": ["model.py"], "primary_metric": "accuracy", "direction": "maximize",
    "defaults": {"rounds": 3, "total_seconds": 1800, "experiment_seconds": 120, "max_llm_calls": 12},
    "limits": {"rounds": [2, 10], "total_seconds": [10, 3600], "experiment_seconds": [1, 120], "max_llm_calls": [1, 40]},
    "confirmation_seeds": [7, 17, 27], "split_seed": 7,
    "allowed_parameters": {"hidden_layer_sizes": "1–3层，每层8–128单元", "activation": ["relu", "tanh", "logistic"], "alpha": "0–1", "learning_rate_init": "0.00001–0.1", "max_iter": "20–150"},
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_code(source):
    """A deliberately narrow v1 code boundary; not a generic Python sandbox."""
    if not isinstance(source, str) or len(source) > 8000:
        raise ValueError("invalid_code_size")
    try:
        tree = ast.parse(source)
        reference = ast.parse(BASELINE)
        if len(tree.body) != 2 or ast.dump(tree.body[0]) != ast.dump(reference.body[0]):
            raise ValueError("editable_boundary: only the model constructor may change")
        func = tree.body[1]
        if not isinstance(func, ast.FunctionDef) or func.name != "build_model" or func.decorator_list or func.returns or func.type_params:
            raise ValueError("invalid_factory")
        if ast.dump(func.args) != ast.dump(reference.body[1].args) or len(func.body) != 1 or not isinstance(func.body[0], ast.Return):
            raise ValueError("invalid_factory")
        call = func.body[0].value
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.func.id != "MLPClassifier" or call.args:
            raise ValueError("invalid_constructor")
        kwargs = {}
        for item in call.keywords:
            if item.arg is None or item.arg in kwargs:
                raise ValueError("invalid_parameters")
            if item.arg == "random_state":
                if not isinstance(item.value, ast.Name) or item.value.id != "seed":
                    raise ValueError("seed_must_be_fixed")
                kwargs[item.arg] = "seed"
            else:
                kwargs[item.arg] = ast.literal_eval(item.value)
        required = {"hidden_layer_sizes", "activation", "solver", "alpha", "learning_rate_init", "max_iter", "random_state"}
        if set(kwargs) != required or kwargs["solver"] != "adam":
            raise ValueError("invalid_parameters")
        layers = kwargs["hidden_layer_sizes"]
        if not isinstance(layers, tuple) or not 1 <= len(layers) <= 3 or any(type(x) is not int or not 8 <= x <= 128 for x in layers):
            raise ValueError("parameter_budget")
        if kwargs["activation"] not in TEMPLATE["allowed_parameters"]["activation"]:
            raise ValueError("invalid_activation")
        for name, lo, hi in [("alpha", 0, 1), ("learning_rate_init", 1e-5, 0.1), ("max_iter", 20, 150)]:
            value = kwargs[name]
            if type(value) not in {int, float} or not np.isfinite(value) or not lo <= value <= hi or (name == "max_iter" and type(value) is not int):
                raise ValueError("parameter_budget")
        compile(source, "model.py", "exec")
        return kwargs
    except (SyntaxError, TypeError, AttributeError) as exc:
        raise ValueError("invalid_model_code") from exc


def prepare_data(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    manifest_file = root / "manifest.json"
    if manifest_file.exists():
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        for name, sha in manifest["files"].items():
            if digest(root / name) != sha:
                raise ValueError("data_integrity_failed")
        return manifest
    dataset = load_digits()
    indices = np.arange(len(dataset.target))
    train, remainder = train_test_split(indices, test_size=0.4, stratify=dataset.target, random_state=7)
    val, test = train_test_split(remainder, test_size=0.5, stratify=dataset.target[remainder], random_state=7)
    x = dataset.data.astype(np.float32) / 16
    for name, arr in {"train_x": x[train], "train_y": dataset.target[train], "validation_x": x[val], "validation_y": dataset.target[val], "test_x": x[test], "test_y": dataset.target[test]}.items():
        np.save(root / (name + ".npy"), arr, allow_pickle=False)
    manifest = {"dataset": "sklearn-digits", "split_seed": 7, "split_indices": {"train": train.tolist(), "validation": val.tolist(), "test": test.tolist()}, "files": {p.name: digest(p) for p in root.glob("*.npy")}}
    from .store import atomic_json
    atomic_json(manifest_file, manifest)
    return manifest
