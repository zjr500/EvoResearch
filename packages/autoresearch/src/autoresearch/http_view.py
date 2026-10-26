"""HTTP fields added for the second-phase frontend. Research logic stays in the engine."""
import hashlib
import json

from .engine import status_snapshot
from .templates import TEMPLATE


STATUS_CATALOG = [
    {"status": "queued", "label": "排队中", "active": True},
    {"status": "running", "label": "运行中", "active": True},
    {"status": "cancelling", "label": "正在停止", "active": True},
    {"status": "completed", "label": "已完成", "active": False},
    {"status": "cancelled", "label": "已停止", "active": False},
    {"status": "interrupted", "label": "已中断", "active": False},
    {"status": "budget_exhausted", "label": "预算用尽", "active": False},
    {"status": "failed", "label": "失败", "active": False},
]

STAGE_LABELS = {
    "queued": "排队",
    "prepare": "准备数据",
    "baseline": "固定基线",
    "proposing": "生成候选",
    "experiment": "实验",
    "confirmation": "重复验证",
    "final_evaluation": "最终测试",
    "completed": "已完成",
    "baseline_failed": "基线失败",
    "confirmation_incomplete": "验证未完成",
    "final_evaluation_incomplete": "最终测试未完成",
    "termination_failed": "终止失败",
}

from .tasks import template_by_id, template_catalog


_DIGITS = template_by_id(TEMPLATE["id"])


def metric_block(template):
    template = template or _DIGITS
    return {
        "template_id": template["id"],
        "primary_metric": template["primary_metric"],
        "direction": template["direction"],
        "secondary_metric": template.get("secondary_metric"),
        "secondary_direction": template.get("secondary_direction"),
        "primary_label": template.get("primary_label"),
        "secondary_label": template.get("secondary_label"),
        "unit": template.get("unit"),
        "comparison": template.get("comparison"),
        "runnable": bool(template.get("runnable")),
    }


def plan_digest(project):
    raw = json.dumps(project.get("plan") or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def present_project(project, runs=None):
    view = {**project, "metric": metric_block(template_by_id(project.get("template_id")))}
    if runs is not None:
        view["runs"] = runs
    return view


def present_run(store, run, *, include_details=False):
    project = store.project(run["project_id"]) or {}
    template = template_by_id(project.get("template_id"))
    snap = status_snapshot(store, run)
    snap.pop("run_id", None)
    budget = project.get("budget") or {}
    rounds_total = int(budget.get("rounds") or 0)
    rounds_completed = int(snap.get("rounds_completed") or 0)
    if run.get("status") == "completed":
        fraction = 1.0
    elif rounds_total:
        fraction = round(min(1.0, rounds_completed / rounds_total), 4)
    else:
        fraction = 0.0
    position = None
    if run.get("status") == "queued":
        queued = store.queued_ids()
        position = queued.index(run["id"]) + 1 if run["id"] in queued else None
    stage = run.get("stage")
    view = {
        **run,
        "status_label": next((item["label"] for item in STATUS_CATALOG if item["status"] == run.get("status")), run.get("status")),
        "metric": metric_block(template),
        "progress": {
            "stage": stage,
            "stage_label": STAGE_LABELS.get(stage, stage),
            "current_round": run.get("current_round"),
            "rounds_total": rounds_total,
            "rounds_completed": rounds_completed,
            "fraction": fraction,
            "elapsed_seconds": round(float(run.get("elapsed") or 0), 2),
            "queue_position": position,
        },
        "proposal_calls": {
            "count": int(run.get("llm_calls") or 0),
            "meaning": "提案与修复操作次数。规则提案也计入，不能当作外部模型请求次数。",
        },
        "snapshot": snap,
    }
    if include_details:
        view["trials"] = store.trials(run["id"])
        view["artifacts"] = store.artifacts(run["id"])
    return view
