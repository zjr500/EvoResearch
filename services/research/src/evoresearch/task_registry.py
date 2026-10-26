"""Registry-based task dispatch. The research loop never selects a task family."""
from dataclasses import asdict, dataclass
from copy import deepcopy
from importlib.util import find_spec
from typing import Callable

from contracts.domain import TaskTemplate
from autoresearch import tasks as legacy
from . import ridge_tasks


@dataclass(frozen=True)
class TaskProvider:
    contract: TaskTemplate
    metadata: dict
    baseline: Callable
    validate: Callable
    prepare: Callable
    execute: Callable
    propose: Callable


class TaskRegistry:
    def __init__(self):
        self._providers = {}

    def register(self, provider: TaskProvider):
        key = provider.contract.template_id
        if key in self._providers:
            raise ValueError(f"Duplicate task template: {key}")
        if provider.contract.metric_direction not in {"minimize", "maximize"}:
            raise ValueError("Invalid metric direction")
        self._providers[key] = provider

    def get(self, template_id: str) -> TaskProvider:
        try:
            return self._providers[template_id]
        except KeyError as exc:
            raise ValueError(f"Unknown task template: {template_id}") from exc

    def catalog(self) -> list[dict]:
        return [self.describe(key) for key in self._providers]

    def describe(self, template_id: str) -> dict:
        provider = self.get(template_id)
        meta = deepcopy(provider.metadata)
        contract = asdict(provider.contract)
        meta.update(id=contract["template_id"], version=contract["version"],
                    task_family=contract["task_family"], primary_metric=contract["metric_key"],
                    direction=contract["metric_direction"], editable_paths=list(contract["allowed_edit_paths"]),
                    supported_runners=list(contract["supported_runners"]))
        return meta


def _digits_execute(*args):
    from autoresearch.executor import execute
    return execute(*args)


def _dlinear_execute(*args):
    from autoresearch.dlinear import execute
    return execute(*args)


registry = TaskRegistry()
for key, family, execute, runners in [
    ("digits-mlp-v1", "image_classification", _digits_execute, ("local_trusted", "docker")),
    ("dlinear-etth1-v1", "time_series_forecasting", _dlinear_execute, ("local_trusted",)),
]:
    meta = legacy.template_by_id(key)
    if key == "dlinear-etth1-v1" and find_spec("torch") is None:
        meta.update(runnable=False, unavailable_reason="Install the original DLinear torch dependency to run this template")
    registry.register(TaskProvider(
        TaskTemplate(key, meta["version"], family, meta["primary_metric"], meta["direction"],
                     tuple(meta["editable_paths"]), runners), meta,
        lambda key=key: legacy.baseline_code(key),
        lambda source, key=key: legacy.check_code(key, source),
        lambda root, key=key: legacy.prepare_task(key, root), execute,
        lambda context, legacy_demo: legacy_demo(context)))

for key, family, metric in [
    ("etth1-ridge-v1", "time_series_forecasting", "mse"),
    ("diabetes-ridge-v1", "tabular_regression", "rmse"),
]:
    meta = {
        "name": "ETTh1 Ridge 48→24 小时预测" if key.startswith("etth1") else "Diabetes Ridge 表格回归",
        "description": "固定数据划分、仅修改 Ridge alpha；CPU 可复现实验",
        "runnable": True, "secondary_metric": "mae", "secondary_direction": "minimize",
        "primary_label": metric, "secondary_label": "MAE",
        "unit": "train_standardized" if key.startswith("etth1") else "target_original",
        "confirmation_seeds": [7, 17, 27], "split_seed": 7,
        "allowed_parameters": {"alpha": "有限浮点数或整数，0.0001–1000"},
        "defaults": dict(legacy.template_by_id("digits-mlp-v1")["defaults"]),
        "limits": deepcopy(legacy.template_by_id("digits-mlp-v1")["limits"]),
        "deterministic_model": True,
    }
    registry.register(TaskProvider(
        TaskTemplate(key, "1.0", family, metric, "minimize", ("model.py",), ("local_trusted",)), meta,
        lambda: ridge_tasks.BASELINE, ridge_tasks.validate_code,
        lambda root, key=key: ridge_tasks.prepare_data(key, root),
        lambda *args, metric=metric: ridge_tasks.execute(*args, primary_metric=metric),
        lambda context, legacy_demo: ridge_tasks.propose(context)))


def template_by_id(template_id):
    try:
        return registry.describe(template_id)
    except ValueError:
        return None


def template_catalog():
    return registry.catalog()


def baseline_code(template_id):
    return registry.get(template_id).baseline()


def check_code(template_id, source):
    return registry.get(template_id).validate(source)


def prepare_task(template_id, root):
    return registry.get(template_id).prepare(root)


def task_runner(template_id):
    return registry.get(template_id).execute


def proposal_for(context, legacy_demo):
    return registry.get(context["task_id"]).propose(context, legacy_demo)
