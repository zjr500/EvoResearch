"""Local research entry point, independent of platform accounts and pages."""
import copy
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

import numpy as np
import sklearn
from sklearn.datasets import load_digits

from .config import Settings
from .engine import Engine, status_snapshot
from .store import Store, atomic_json
from .templates import BASELINE, TEMPLATE, validate_code
from .worker import WorkerLock, recover_execution


TASK_NOTES = {
    "version": "digits-notes-v0.1-20261014",
    "integration": {
        "date": "2026-10-14",
        "material_author": "刘润涛",
        "integrated_by": "王筠昊",
        "source_file": "提案与反馈样例.json",
        "source_sha256": "798ad1706984f27d2210b4fd33a3e7099af8551673a8a05e0a2bda639960429c",
        "notice": "接入待验证方向，不接入原材料中的模拟指标和错误；原稿保留。",
    },
    "sources": [
        {"id": "digits-data", "title": "scikit-learn load_digits 数据说明",
         "url": "https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_digits.html"},
        {"id": "mlp-parameters", "title": "scikit-learn MLPClassifier 参数说明",
         "url": "https://scikit-learn.org/stable/modules/generated/sklearn.neural_network.MLPClassifier.html"},
    ],
    "method_hypotheses": [
        "H1：将单隐藏层由32增加到48个单元，检验容量变化是否改善验证表现。",
        "H2：将最大迭代次数由80提高到120，检验迭代上限变化是否改善验证表现。",
        "H3：将初始学习率由0.001提高到0.003，检验优化步长变化是否改善验证表现。",
        "三个方向均来自方法样例，尚无对应单变量实验证据。迭代版本可能相对固定基线累积多个参数变化，成绩不能直接归因于某一个参数。",
    ],
    "hypothesis_status": "unverified",
    "documentation_version_checked": "scikit-learn 1.9.1；stable 链接随官方发布更新，以运行依赖锁和本次记录为准",
    "rules": [
        "固定数据划分、原始基线、随机种子和评测程序。",
        "只修改 model.py 中允许的 MLPClassifier 参数。",
        "下一轮只接收开发验证反馈，最终测试不反馈给本轮搜索。",
        "各轮统一对照固定基线；搜索提供当前最佳有效版本或基线，提案需要说明实际改动与反馈依据。",
        "验证没有改善仍记录为有效实验；它不能进入最佳候选。正增量只是搜索阶段的筛选结果，重复验证在候选冻结后开展。",
    ],
}


def fingerprint(value):
    body = {k: v for k, v in value.items() if k != "sha256"}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def validate_budget(budget):
    if set(budget) != set(TEMPLATE["defaults"]):
        raise ValueError("预算字段不完整或包含未知字段")
    for name, (lower, upper) in TEMPLATE["limits"].items():
        if type(budget[name]) is not int or not lower <= budget[name] <= upper:
            raise ValueError(f"预算 {name} 必须在 {lower}—{upper} 范围内")


def execution_config(settings):
    value = {"runner": settings.runner, "provider": settings.provider, "image": settings.image,
             "python": list(sys.version_info[:2]), "sklearn": sklearn.__version__, "numpy": np.__version__}
    if settings.provider == "openai_compatible":
        value["model"] = os.getenv("AUTORESEARCH_MODEL", "")
        value["endpoint_sha256"] = hashlib.sha256(os.getenv("AUTORESEARCH_MODEL_BASE_URL", "").encode()).hexdigest()
    return value


def check_conditions(settings):
    checks = []
    try:
        validate_code(BASELINE)
        dataset = load_digits()
        ready = dataset.data.shape == (1797, 64) and np.isfinite(dataset.data).all()
        checks.append({"name": "固定模板与内置数据", "ready": bool(ready)})
    except (OSError, ValueError, TypeError):
        checks.append({"name": "固定模板与内置数据", "ready": False})
    checks.append({"name": "Python 3.12 或更新版本", "ready": sys.version_info >= (3, 12)})
    if settings.provider == "openai_compatible":
        missing = [name for name in ("AUTORESEARCH_MODEL_BASE_URL", "AUTORESEARCH_MODEL",
                                    "AUTORESEARCH_MODEL_API_KEY") if not os.getenv(name)]
        checks.append({"name": "模型配置", "ready": not missing, "missing": missing,
                       "note": "这里只检查配置；真实模型连通性需要通过实际研究验证。"})
    else:
        checks.append({"name": "演示提案策略", "ready": True,
                       "note": "feedback_demo 使用规则提出修改，没有调用大模型。"})
    if settings.runner == "docker":
        ready = False
        if shutil.which("docker"):
            try:
                result = subprocess.run(["docker", "image", "inspect", settings.image],
                                        capture_output=True, timeout=8)
                ready = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                pass
        checks.append({"name": "Docker 和实验镜像", "ready": ready,
                       "note": "需要可用的 Docker 服务和已构建的实验镜像。"})
    else:
        checks.append({"name": "受控本地进程", "ready": True,
                       "note": "local_trusted 仅用于固定模板，不提供容器隔离。"})
    return checks


def build_plan(settings, goal, budget):
    if not isinstance(goal, str) or not 3 <= len(goal.strip()) <= 2000:
        raise ValueError("研究目标需要 3—2000 个字符")
    validate_budget(budget)
    checks = check_conditions(settings)
    plan = {
        "schema": "shenzhi-harness-mvp-v0.1", "goal": goal.strip(),
        "template": copy.deepcopy(TEMPLATE), "task_notes": copy.deepcopy(TASK_NOTES),
        "baseline_sha256": hashlib.sha256(BASELINE.encode()).hexdigest(),
        "budget": dict(budget), "execution": execution_config(settings),
        "plan_method": "团队预配置模板；计划阶段不调用模型或启动训练",
        "plan_model_calls": 0,
        "flow": ["baseline", "proposal", "experiment", "feedback", "confirmation", "final_evaluation", "report"],
        "checks": checks, "status": "ready" if all(c["ready"] for c in checks) else "blocked",
    }
    plan["sha256"] = fingerprint(plan)
    return plan


def validate_plan(plan, settings, confirmation):
    if plan.get("schema") != "shenzhi-harness-mvp-v0.1":
        raise ValueError("不支持这份计划的格式")
    if confirmation != plan.get("sha256") or fingerprint(plan) != confirmation:
        raise ValueError("计划版本未确认或已经修改，请重新生成并确认")
    validate_budget(plan["budget"])
    if plan["template"] != TEMPLATE or plan["task_notes"] != TASK_NOTES:
        raise ValueError("模板或任务资料已变化，请重新生成计划")
    if plan["baseline_sha256"] != hashlib.sha256(BASELINE.encode()).hexdigest():
        raise ValueError("基线已变化，请重新生成计划")
    if plan["execution"] != execution_config(settings):
        raise ValueError("运行环境或模型配置已变化，请重新生成计划")
    checks = check_conditions(settings)
    if plan["status"] != "ready" or not all(c["ready"] for c in checks):
        raise ValueError("运行条件不足：" + "、".join(c["name"] for c in checks if not c["ready"]) + "；请补齐后重新生成计划")


def settings_for_plan(home, plan):
    config = plan["execution"]
    return Settings(Path(home), runner=config["runner"], provider=config["provider"], image=config["image"])


def build_plan_confirmation(plan_sha256, confirmer="", opinion=""):
    confirmer = (confirmer or "").strip()
    opinion = (opinion or "").strip()
    if len(confirmer) > 64 or len(opinion) > 2000:
        raise ValueError("确认人或确认意见超出长度")
    pending = [name for name, value in (("confirmer", confirmer), ("opinion", opinion)) if not value]
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    return {"plan_sha256": plan_sha256, "confirmer": confirmer or None, "opinion": opinion or None,
            "confirmed_at": now if not pending else None, "recorded_at": now,
            "review_status": "confirmed" if not pending else "pending_review", "pending_fields": pending}


def merge_plan_confirmation(existing, plan_sha256, confirmer="", opinion=""):
    if existing and existing.get("review_status") == "confirmed" and existing.get("plan_sha256") == plan_sha256:
        return existing
    kept_confirmer = (confirmer or "").strip() or (existing or {}).get("confirmer") or ""
    kept_opinion = (opinion or "").strip() or (existing or {}).get("opinion") or ""
    record = build_plan_confirmation(plan_sha256, kept_confirmer, kept_opinion)
    if existing and existing.get("recorded_at"):
        record["recorded_at"] = existing["recorded_at"]
    return record


def save_plan_confirmation(store, run_id, record):
    store.update(run_id, plan_confirmation=record)
    root = store.home / "runs" / run_id
    root.mkdir(parents=True, exist_ok=True)
    path = root / "plan_confirmation.json"
    atomic_json(path, record)
    store.artifact(run_id, path, "plan_confirmation")
    return store.run(run_id)


def run_plan(settings, plan, confirmation, confirmer="", opinion=""):
    validate_plan(plan, settings, confirmation)
    build_plan_confirmation(confirmation, confirmer, opinion)
    store = Store(settings.home)
    with WorkerLock(settings.home / "worker.lock"):
        recover_execution(settings, store)
        project = next((p for p in store.projects("local-mvp") if p.get("plan", {}).get("sha256") == confirmation), None)
        if project is None:
            project = store.create_project("local-mvp", {"goal": plan["goal"], "template_id": TEMPLATE["id"],
                                                        "budget": plan["budget"], "plan": plan})
        previous = store.runs(project["id"])
        if previous and previous[0]["status"] != "queued":
            run = previous[0]
            record = merge_plan_confirmation(run.get("plan_confirmation"), confirmation, confirmer, opinion)
            if record != run.get("plan_confirmation"):
                run = save_plan_confirmation(store, run["id"], record)
            return store, run
        run = previous[0] if previous else store.enqueue(project["id"])
        record = merge_plan_confirmation(run.get("plan_confirmation"), confirmation, confirmer, opinion)
        save_plan_confirmation(store, run["id"], record)
        store.update(run["id"], status="running")
        Engine(settings, store).run(store.run(run["id"]))
        return store, store.run(run["id"])


def resume_run(home, rid, confirmation):
    store = Store(Path(home))
    run = store.run(rid)
    project = store.project(run["project_id"]) if run else None
    if not project or project["owner"] != "local-mvp":
        raise ValueError("找不到本地 MVP 研究记录")
    plan = project["plan"]
    settings = settings_for_plan(home, plan)
    validate_plan(plan, settings, confirmation)
    with WorkerLock(settings.home / "worker.lock"):
        recover_execution(settings, store)
        run = store.run(rid)
        if run["status"] not in {"interrupted", "cancelled"}:
            raise ValueError("只有中断或停止的任务可以继续")
        if run["elapsed"] >= project["budget"]["total_seconds"]:
            raise ValueError("总运行时间已耗尽")
        store.resume(rid)
        store.update(rid, status="running")
        Engine(settings, store).run(store.run(rid))
        return store, store.run(rid)


def export_run(store, rid, destination):
    run = store.run(rid)
    if not run:
        raise ValueError("找不到研究记录")
    root = (store.home / "runs" / rid).resolve()
    if destination.resolve().is_relative_to(root):
        raise ValueError("导出文件需要放在实验产物目录之外")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("export_state.json", json.dumps(run, ensure_ascii=False, indent=2))
        for item in store.artifacts(rid):
            path = (root / item["path"]).resolve()
            if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
                raise ValueError("实验产物不可用")
            archive.write(path, item["path"])
    return destination


def main(args):
    try:
        if args.command == "plan":
            settings = Settings(Path(args.home), runner=args.runner, provider=args.provider)
            budget = {name: getattr(args, name) for name in TEMPLATE["defaults"]}
            plan = build_plan(settings, args.goal, budget)
            atomic_json(Path(args.out), plan)
            print(json.dumps({"plan": str(Path(args.out).resolve()), "status": plan["status"],
                              "confirm": plan["sha256"], "checks": plan["checks"]}, ensure_ascii=False, indent=2))
            return 0 if plan["status"] == "ready" else 2
        if args.command == "run":
            plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
            settings = settings_for_plan(args.home, plan)
            store, run = run_plan(settings, plan, args.confirm, confirmer=args.confirmer, opinion=args.opinion)
        elif args.command == "resume":
            store, run = resume_run(args.home, args.run_id, args.confirm)
        else:
            store = Store(Path(args.home))
            run = store.run(args.run_id)
            if not run:
                raise ValueError("找不到研究记录")
            if args.command == "stop":
                run = store.stop(args.run_id)
            elif args.command == "export":
                destination = export_run(store, args.run_id, Path(args.out))
                print(json.dumps({"export": str(destination.resolve())}, ensure_ascii=False))
                return 0
        print(json.dumps({"run": run, "snapshot": status_snapshot(store, run), "trials": store.trials(run["id"]),
                          "report": str(store.home / "runs" / run["id"] / "report.md")}, ensure_ascii=False, indent=2))
        return 0 if args.command in {"status", "stop"} or run["status"] == "completed" else 2
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
