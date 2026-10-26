import hashlib
import json
import os
from pathlib import Path
import statistics
import sys
import time

from .config import Halt
from .executor import execute, supervised
from .store import atomic_json
from .templates import TEMPLATE, validate_code
from evoresearch.task_registry import baseline_code, check_code, prepare_task, template_by_id, task_runner, proposal_for


def metric_improved(delta, direction):
    if direction == "maximize":
        return delta > 0
    if direction == "minimize":
        return delta < 0
    raise ValueError("unsupported_metric_direction")


def best_valid_trial(trials, metric, direction):
    eligible = [t for t in trials if t.get("status") == "valid"
                and metric_improved(t.get("delta", 0), direction)]
    choose = max if direction == "maximize" else min
    return choose(eligible, key=lambda t: t["metrics"][metric], default=None)


def status_snapshot(store, run):
    project = store.project(run["project_id"]) if run else None
    budget = (project or {}).get("budget") or {}
    trials = store.trials(run["id"]) if run else []
    completed = [trial for trial in trials if trial.get("terminal")]
    elapsed = float(run.get("elapsed") or 0)
    calls = int(run.get("llm_calls") or 0)
    rounds = int(budget.get("rounds") or 0)
    total_seconds = float(budget.get("total_seconds") or 0)
    call_cap = int(budget.get("max_llm_calls") or 0)
    exceptions = []
    for trial in trials:
        for attempt in trial.get("attempts") or []:
            if attempt.get("status") not in (None, "valid"):
                exceptions.append({"round": trial.get("ordinal", 0) + 1, "attempt": attempt.get("attempt"),
                                   "status": attempt.get("status"), "error": attempt.get("error")})
    return {
        "run_id": run["id"], "status": run["status"], "stage": run.get("stage"),
        "round": run.get("current_round"), "rounds_completed": len(completed),
        "remaining_budget": {"rounds": max(0, rounds - len(completed)),
                             "total_seconds": round(max(0.0, total_seconds - elapsed), 2),
                             "llm_calls": max(0, call_cap - calls)},
        "limits": {"experiment_seconds": budget.get("experiment_seconds")},
        "consumed_budget": {"elapsed": round(elapsed, 2), "llm_calls": calls, "rounds_completed": len(completed)},
        "failure_reason": None if run.get("status") == "completed" else (run.get("error") or run.get("stop_reason")),
        "artifacts": [{"kind": item["kind"], "path": item["path"]} for item in store.artifacts(run["id"])],
        "plan_confirmation": run.get("plan_confirmation"),
        "resume_history": run.get("resume_history") or [],
        "exceptions": exceptions,
    }


def feedback_context(project, baseline, trials, current_code, repair_error=None):
    # Explicit field allowlist: confirmation and test evidence never enter search.
    template = project.get("plan", {}).get("template") or template_by_id(project.get("template_id", TEMPLATE["id"]))
    history = [{k: t[k] for k in ("ordinal", "hypothesis", "status", "metrics", "delta", "error", "code_sha256") if k in t} for t in trials]
    context = {"goal": project["goal"], "primary_metric": "validation_" + template["primary_metric"],
            "direction": template["direction"], "fixed_baseline": baseline,
            "allowed_parameters": template["allowed_parameters"], "editable_paths": template["editable_paths"],
            "current_code": current_code, "history": history, "repair_error": repair_error}
    notes = project.get("plan", {}).get("task_notes")
    if notes:
        context["task_notes"] = notes
    context["task_id"] = project.get("template_id", TEMPLATE["id"])
    return context


def _legacy_feedback_demo(context):
    """Transparent feedback-driven fixture, never presented as an LLM request."""
    if context.get("task_id") == "dlinear-etth1-v1":
        import re
        window = (13, 49, 7)[len(context["history"]) % 3]
        code = re.sub(r"kernel_size = \d+", f"kernel_size = {window}", context["current_code"], count=1)
        return {"hypothesis": f"检验{window}小时滑动平均窗口", "rationale": "基于当前提供的最佳有效代码调整分解窗口，其他配置固定；效果待实际验证。", "code": code,
                "feedback_ordinals": [t["ordinal"] for t in context["history"]]}
    best = [t for t in context["history"] if t.get("status") == "valid"
            and metric_improved(t.get("delta", 0), context.get("direction", "maximize"))]
    round_no = len(context["history"])
    # The engine supplies the best valid code (or the baseline). Preserve it.
    parameters = validate_code(context["current_code"])
    parameter = ("hidden_layer_sizes", "max_iter", "learning_rate_init")[round_no % 3]
    before = parameters[parameter]
    if parameter == "hidden_layer_sizes":
        parameters[parameter] = tuple(min(width + 16, 128) for width in before)
    elif parameter == "max_iter":
        parameters[parameter] = min(before + 40, 150)
    else:
        parameters[parameter] = min(before * 3, 0.1)
    arguments = ", ".join(f"{key}={value!r}" if key != "random_state" else "random_state=seed" for key, value in parameters.items())
    code = "from sklearn.neural_network import MLPClassifier\n\ndef build_model(seed):\n    return MLPClassifier(" + arguments + ")\n"
    return {"hypothesis": f"在当前提供的版本上调整 {parameter}",
            "rationale": f"规则策略获得了{round_no}轮历史，其中{len(best)}轮优于固定基线；保留当前版本的其他参数，将 {parameter} 从 {before} 调整为 {parameters[parameter]}。此修改需要实际验证。", "code": code,
            "source_ids": ["mlp-parameters"] if context.get("task_notes") else [],
            "feedback_ordinals": [t["ordinal"] for t in context["history"]]}


def feedback_demo(context):
    return proposal_for(context, _legacy_feedback_demo)


class TerminationFailed(RuntimeError):
    def __init__(self, result):
        super().__init__(result["error"])
        self.result = result


class Engine:
    def __init__(self, settings, store, proposer=None):
        self.settings, self.store, self.proposer = settings, store, proposer

    def check(self):
        elapsed = self.previous_elapsed + time.monotonic() - self.started
        state = self.store.run(self.rid)
        if elapsed - self.last_saved >= 0.5:
            self.store.update(self.rid, elapsed=elapsed)
            self.last_saved = elapsed
        if state["cancel_requested"]:
            raise Halt("user_stop")
        if elapsed >= self.project["budget"]["total_seconds"]:
            raise Halt("total_budget_exhausted")
        return self.project["budget"]["total_seconds"] - elapsed

    def phase(self, stage, **values):
        self.check()
        self.store.update(self.rid, stage=stage, **values)

    def register(self, folder):
        for path in folder.rglob("*"):
            if path.is_file() and path.suffix in {".json", ".log", ".py", ".md"} and "inputs" not in path.parts and "output" not in path.parts:
                self.store.artifact(self.rid, path, path.suffix.lstrip("."))

    def experiment(self, key, code, seed=None, split="validation"):
        remaining = self.check()
        root = self.root / "experiments" / key
        seed = self.search_seed if seed is None else seed
        runner = task_runner(self.task_id)
        result = runner(self.settings, root, self.root / "private_data", code, seed, split, min(self.project["budget"]["experiment_seconds"], remaining), self.check)
        self.register(root)
        if result.get("status") == "valid":
            for name in ("predictions.npy", "labels.npy", "training.json"):
                path = root / "output" / name
                if path.is_file():
                    self.store.artifact(self.rid, path, "evaluation")
        if result.get("error", "").startswith("terminate_failed:"):
            raise TerminationFailed(result)
        return result

    def proposal(self, ordinal, attempt, context):
        self.check()
        folder = self.root / "trials" / str(ordinal) / f"proposal-{attempt}"
        folder.mkdir(parents=True, exist_ok=True)
        request, response = folder / "context.json", folder / "proposal.json"
        if not response.exists():
            atomic_json(request, context)
            state = self.store.run(self.rid)
            if state["llm_calls"] >= self.project["budget"]["max_llm_calls"]:
                raise Halt("model_call_budget_exhausted")
            self.store.update(self.rid, llm_calls=state["llm_calls"] + 1)
            if self.proposer:
                value = self.proposer(context)
                atomic_json(response, value)
            elif self.settings.provider == "feedback_demo":
                atomic_json(response, feedback_demo(context))
            else:
                env = dict(os.environ)
                package_root = str(Path(__file__).resolve().parents[1])
                env["PYTHONPATH"] = package_root
                code = supervised([sys.executable, "-m", "autoresearch.provider_call", str(request), str(response)], folder, env, min(90, self.check()), self.check, folder / "stdout.log", folder / "stderr.log")
                if code != 0 or not response.exists():
                    raise ValueError("model_call_failed")
        elif not request.exists() or json.loads(request.read_text(encoding="utf-8")) != context:
            raise ValueError("invalid_proposal_context_conflict")
        self.check()
        self.register(folder)
        value = json.loads(response.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not all(isinstance(value.get(k), str) for k in ("hypothesis", "rationale", "code")):
            raise ValueError("invalid_proposal")
        if len(value["hypothesis"]) > 1000 or len(value["rationale"]) > 4000:
            raise ValueError("invalid_proposal_size")
        allowed_sources = {s["id"] for s in context.get("task_notes", {}).get("sources", [])}
        allowed_feedback = {t["ordinal"] for t in context["history"]}
        sources, feedback = value.get("source_ids", []), value.get("feedback_ordinals", [])
        if not isinstance(sources, list) or any(type(s) is not str or s not in allowed_sources for s in sources):
            raise ValueError("invalid_proposal_source_reference")
        if not isinstance(feedback, list) or any(type(n) is not int or n not in allowed_feedback for n in feedback):
            raise ValueError("invalid_proposal_feedback_reference")
        if allowed_sources:
            required_types = {s["type"] for s in context["task_notes"]["sources"]}
            cited_types = {s["type"] for s in context["task_notes"]["sources"] if s["id"] in sources}
            if not required_types.issubset(cited_types):
                raise ValueError("invalid_proposal_missing_source_type")
        return value

    def run(self, run):
        self.rid = run["id"]
        self.root = self.settings.home / "runs" / self.rid
        self.root.mkdir(parents=True, exist_ok=True)
        self.project = self.store.project(run["project_id"])
        self.task_id = self.project.get("template_id", TEMPLATE["id"])
        template = self.project.get("plan", {}).get("template") or template_by_id(self.task_id)
        self.search_seed = template.get("split_seed", 7)
        self.baseline = baseline_code(self.task_id)
        self.metric, self.direction = template["primary_metric"], template["direction"]
        self.previous_elapsed, self.started = run.get("elapsed", 0), time.monotonic()
        self.last_saved = self.previous_elapsed
        self.store.update(self.rid, provider=self.settings.provider, runner=self.settings.runner,
                          primary_metric=self.metric, direction=self.direction)
        try:
            self.phase("prepare")
            if self.project.get("plan", {}).get("task_notes"):
                atomic_json(self.root / "plan.json", self.project["plan"])
                self.store.artifact(self.rid, self.root / "plan.json", "plan")
            manifest = prepare_task(self.task_id, self.root / "private_data")
            atomic_json(self.root / "data_manifest.json", manifest)
            self.store.artifact(self.rid, self.root / "data_manifest.json", "data_manifest")
            self.phase("baseline")
            baseline = self.experiment(f"baseline-validation-{self.search_seed}", self.baseline)
            if baseline["status"] != "valid":
                self.store.update(self.rid, status="failed", stage="baseline_failed", error=baseline.get("error", baseline["status"]))
                return
            self.store.update(self.rid, baseline=baseline["metrics"])
            for ordinal in range(self.project["budget"]["rounds"]):
                trials = self.store.trials(self.rid)
                existing = next((t for t in trials if t["ordinal"] == ordinal), None)
                if existing and existing.get("terminal"):
                    continue
                history = [t for t in trials if t["ordinal"] < ordinal]
                best = best_valid_trial(history, self.metric, self.direction)
                current_code = best["code"] if best else self.baseline
                errors = []
                trial = existing or {"attempts": [], "terminal": False}
                for attempt in range(2):
                    self.phase("proposing", current_round=ordinal + 1)
                    previous_attempt = next((a for a in trial["attempts"] if a["attempt"] == attempt), None)
                    if previous_attempt and previous_attempt.get("status") != "valid":
                        errors.append(previous_attempt.get("error", previous_attempt["status"]))
                        continue
                    context = feedback_context(self.project, baseline["metrics"], history, current_code, errors[-1] if errors else None)
                    references = {"parent_ordinal": best["ordinal"] if best else None,
                                  "parent_code_sha256": hashlib.sha256(current_code.encode()).hexdigest(),
                                  "feedback_ordinals_available": [t["ordinal"] for t in history],
                                  "source_ids_available": [s["id"] for s in context.get("task_notes", {}).get("sources", [])]}
                    try:
                        proposal = self.proposal(ordinal, attempt, context)
                        references.update(source_ids_declared=proposal.get("source_ids", []),
                                          feedback_ordinals_declared=proposal.get("feedback_ordinals", []))
                        trial.update(hypothesis=proposal["hypothesis"], rationale=proposal["rationale"], code=proposal["code"])
                        check_code(self.task_id, proposal["code"])
                        self.phase("experiment", current_round=ordinal + 1)
                        outcome = self.experiment(f"trial-{ordinal}-attempt-{attempt}-validation-{self.search_seed}", proposal["code"])
                        detail = {"attempt": attempt, **outcome}
                        if outcome["status"] == "valid":
                            trial.update(status="valid", metrics=outcome["metrics"], delta=outcome["metrics"][self.metric] - baseline["metrics"][self.metric], code_sha256=outcome["code_sha256"])
                    except Halt:
                        self.store.trial(self.rid, ordinal, trial)
                        raise
                    except TerminationFailed as exc:
                        detail = {"attempt": attempt, **exc.result}
                    except TimeoutError as exc:
                        message = str(exc)
                        error = message[:200] if message.startswith("terminate_failed") else "model_timeout"
                        detail = {"attempt": attempt, "status": "model_failed", "error": error}
                    except (ValueError, OSError, TypeError) as exc:
                        message = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
                        category = "model_failed" if message.startswith(("model_", "invalid_proposal")) else "check_failed"
                        detail = {"attempt": attempt, "status": category, "error": message[:200]}
                    detail.update(references)
                    trial["attempts"] = [a for a in trial["attempts"] if a["attempt"] != attempt] + [detail]
                    self.store.trial(self.rid, ordinal, trial)
                    if detail.get("error", "").startswith("terminate_failed:"):
                        trial.update(status=detail["status"], error=detail["error"], terminal=True)
                        self.store.trial(self.rid, ordinal, trial)
                        atomic_json(self.root / "trials" / str(ordinal) / "trial.json", trial)
                        self.register(self.root / "trials" / str(ordinal))
                        raise TerminationFailed(detail)
                    if detail["status"] == "valid":
                        break
                    errors.append(detail.get("error", detail["status"]))
                if trial.get("status") != "valid":
                    last = trial["attempts"][-1]
                    trial.update(status=last["status"], error=last.get("error", last["status"]))
                trial["terminal"] = True
                self.store.trial(self.rid, ordinal, trial)
                atomic_json(self.root / "trials" / str(ordinal) / "trial.json", trial)
                self.register(self.root / "trials" / str(ordinal))

            trials = self.store.trials(self.rid)
            best = best_valid_trial(trials, self.metric, self.direction)
            code = best["code"] if best else self.baseline
            atomic_json(self.root / "frozen.json", {"candidate_ordinal": best["ordinal"] if best else None, "code": code, "template": self.task_id, "primary_metric": self.metric, "direction": self.direction, "policy": "paired-mean-validation-v1"})
            self.store.artifact(self.rid, self.root / "frozen.json", "frozen")
            self.phase("confirmation")
            pairs = []
            for seed in template["confirmation_seeds"]:
                base = self.experiment(f"baseline-validation-{seed}", self.baseline, seed)
                candidate = self.experiment(f"confirmation-candidate-{seed}", code, seed) if best else base
                if base["status"] != "valid" or candidate["status"] != "valid":
                    self.store.update(self.rid, status="failed", stage="confirmation_incomplete")
                    return
                pairs.append({"seed": seed, "baseline": base["metrics"][self.metric], "candidate": candidate["metrics"][self.metric], "delta": candidate["metrics"][self.metric] - base["metrics"][self.metric]})
            confirmation = {"pairs": pairs, "primary_metric": self.metric, "direction": self.direction,
                            "mean_delta": statistics.mean(p["delta"] for p in pairs),
                            "improved": bool(best) and metric_improved(statistics.mean(p["delta"] for p in pairs), self.direction),
                            "interpretation": "本任务三种子验证均值比较，不代表统计显著性"}
            self.store.update(self.rid, confirmation=confirmation)
            self.phase("final_evaluation")
            # No further proposal calls are made after entering this stage.
            final = []
            for seed in template["confirmation_seeds"]:
                base = self.experiment(f"final-baseline-{seed}", self.baseline, seed, "test")
                candidate = self.experiment(f"final-candidate-{seed}", code, seed, "test") if best else base
                if base["status"] != "valid" or candidate["status"] != "valid":
                    self.store.update(self.rid, status="failed", stage="final_evaluation_incomplete")
                    return
                final.append({"seed": seed, "baseline": base["metrics"], "candidate": candidate["metrics"], "delta": candidate["metrics"][self.metric] - base["metrics"][self.metric]})
            chosen = f"final-candidate-{self.search_seed}" if best else f"final-baseline-{self.search_seed}"
            forecast_path = self.root / "experiments" / chosen / "forecast.json"
            if forecast_path.exists():
                self.store.update(self.rid, forecast=json.loads(forecast_path.read_text(encoding="utf-8")))
            self.store.update(self.rid, final_evaluation={"pairs": final, "primary_metric": self.metric, "direction": self.direction,
                                                        "mean_delta": statistics.mean(p["delta"] for p in final)}, status="completed", stage="completed")
        except TerminationFailed as exc:
            self.store.update(self.rid, status="failed", stage="termination_failed", error=str(exc))
        except Halt as exc:
            self.store.update(self.rid, status="cancelled" if str(exc) == "user_stop" else "budget_exhausted", stop_reason=str(exc))
        except KeyboardInterrupt:
            self.store.update(self.rid, status="interrupted", stop_reason="keyboard_interrupt")
        except Exception as exc:
            self.store.update(self.rid, status="failed", error=type(exc).__name__)
        finally:
            elapsed = self.previous_elapsed + time.monotonic() - self.started
            self.store.update(self.rid, elapsed=elapsed)
            self.report()

    def report(self):
        run = self.store.run(self.rid)
        trials = self.store.trials(self.rid)
        report = ["# AutoResearch 研究记录", f"项目：{self.project['goal']}",
                  f"状态：{run['status']} / 阶段：{run['stage']}",
                  f"提案模式：{self.settings.provider}；执行模式：{self.settings.runner}",
                  "feedback_demo 是反馈演示策略，不是模型服务调用。local_trusted 是受控开发验证，不具有容器隔离。",
                  f"累计运行：{run.get('elapsed', 0):.2f}秒；提案与修复次数：{run.get('llm_calls', 0)}。",
                  f"基线验证指标：{run.get('baseline', '未完成')}"]
        if run.get("stop_reason") or run.get("error"):
            report.append(f"停止或失败原因：{run.get('stop_reason') or run.get('error')}")
        if run.get("resume_history"):
            report += ["## 中断与继续记录", "以下是继续前的状态，当前状态以报告开头为准。继续时间不是计划确认时间。",
                       "```json\n" + json.dumps(run["resume_history"], ensure_ascii=False, indent=2) + "\n```"]
        snap = status_snapshot(self.store, run)
        remain = snap["remaining_budget"]
        summary = ["## 阶段与异常摘要",
                   f"阶段：{snap['stage']}；状态：{snap['status']}；当前轮次：{snap['round'] if snap['round'] is not None else '无'}；已完成轮次：{snap['rounds_completed']}。",
                   f"剩余预算：轮次 {remain['rounds']}，总时间 {remain['total_seconds']} 秒，提案与修复 {remain['llm_calls']} 次。单次实验上限 {snap['limits']['experiment_seconds']} 秒。",
                   f"已消耗：{snap['consumed_budget']['elapsed']} 秒，提案与修复 {snap['consumed_budget']['llm_calls']} 次。",
                   f"当前失败或停止原因：{snap['failure_reason'] or '无'}。"]
        if snap["exceptions"]:
            summary.append("异常尝试：")
            summary.extend(f"- 第{item['round']}轮尝试 {item['attempt']}：{item['status']}，{item['error']}" for item in snap["exceptions"])
        else:
            summary.append("异常尝试：无。")
        confirm = snap.get("plan_confirmation") or {}
        if confirm:
            pending = "、".join(confirm.get("pending_fields") or []) or "无"
            summary += ["## 计划确认",
                        "计划确认记录确认人、确认意见、确认时间和计划版本。它与上面的继续时间分开保存。",
                        f"审核状态：{confirm.get('review_status')}；计划版本：{confirm.get('plan_sha256')}；待填写：{pending}。",
                        f"记录时间：{confirm.get('recorded_at') or '无'}；确认时间：{confirm.get('confirmed_at') or '无'}。"]
        report.extend(summary)
        metric_label = {"accuracy": "准确率", "mse": "MSE", "mae": "MAE"}.get(self.metric, self.metric)
        preference = "越高越好" if self.direction == "maximize" else "越低越好"
        report.append(f"主要指标：{self.metric}（{preference}）；相对基线变化为候选指标减去固定基线指标。")
        table = [f"|轮次|状态|验证{metric_label}|相对基线变化|", "|---|---|---|---|"]
        for t in trials:
            table.append(f"|{t['ordinal'] + 1}|{t.get('status', 'interrupted')}|{t.get('metrics', {}).get(self.metric, '缺测')}|{t.get('delta', '缺测')}|")
        report.append("\n".join(table))
        notes = self.project.get("plan", {}).get("task_notes")
        if notes:
            report += ["## 计划与任务资料", f"计划版本：{self.project['plan'].get('sha256', 'legacy-snapshot')}；资料版本：{notes.get('version', 'graphiti-joint-v1')}"]
            report.append("\n".join(f"- [{s.get('title', s['id'])}]({s.get('url', s.get('uri', ''))})（{s['id']}）" for s in notes["sources"]))
            report += ["## 各轮选择和反馈依据", "提供给模型的记录与模型声明采用的记录分别保存；声明不代表方法效果已经证实。"]
            for trial in trials:
                attempt = trial.get("attempts", [{}])[-1] if trial.get("attempts") else {}
                report += [f"第{trial['ordinal'] + 1}轮：{trial.get('hypothesis', '提案未完成')}",
                           trial.get("rationale", trial.get("error", "理由未完成")),
                           "```json\n" + json.dumps({k: v for k, v in attempt.items() if k.startswith(("parent_", "source_", "feedback_"))}, ensure_ascii=False, indent=2) + "\n```"]
        report += ["## 重复验证", "```json\n" + json.dumps(run.get("confirmation", "未完成"), ensure_ascii=False, indent=2) + "\n```",
                   "## 最终测试（不反馈给搜索）", "```json\n" + json.dumps(run.get("final_evaluation", "未完成"), ensure_ascii=False, indent=2) + "\n```",
                   "无改善、失败与未完成记录均保留。验证均值比较不代表统计显著性或跨任务通用改善。"]
        path = self.root / "report.md"
        path.write_text("\n\n".join(report), encoding="utf-8")
        self.store.artifact(self.rid, path, "report")
        atomic_json(self.root / "run_summary.json", run)
        self.store.artifact(self.rid, self.root / "run_summary.json", "summary")
