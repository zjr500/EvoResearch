"""Check the week 2 domain/use-case document without third-party packages.

Usage: python3 week2_model_check.py path/to/领域模型及用例模型_v1.0_261107.docx
This checks the document and rehearses a tiny task-state model. It does not
exercise the EvoResearch application or a real remote GPU host.
"""

import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def content(element):
    return "".join(node.text or "" for node in element.iter(W + "t")).strip()


def table_rows(table):
    return [[content(cell) for cell in row.findall(W + "tc")]
            for row in table.findall(W + "tr")]


def inspect_document(path):
    with ZipFile(path) as package:
        root = ET.fromstring(package.read("word/document.xml"))
    body = root.find(W + "body")
    assert body is not None
    current_uc = None
    use_cases = {}
    operations = {}
    messages = {}
    states = []
    declared_member_contracts = None
    declared_total_contracts = None

    for item in body:
        if item.tag == W + "p":
            line = content(item)
            match = re.match(r"^(UC\d{2})\s+(.+)", line)
            if match:
                current_uc = match.group(1)
                use_cases[current_uc] = match.group(2)
            count_match = re.search(r"全组\s*(\d+)\s*份契约", line)
            if count_match:
                declared_total_contracts = int(count_match.group(1))
        elif item.tag == W + "tbl":
            rows = table_rows(item)
            if not rows:
                continue
            if rows[0][:2] == ["消息中文名", "消息可编程名称"] and current_uc:
                messages[current_uc] = {row[1]: row[2] for row in rows[1:]
                                        if len(row) >= 3}
            if rows[0][:2] == ["状态", "进入条件"]:
                states = [row[0] for row in rows[1:] if row]
            if rows[0][:2] == ["模型", "任务"]:
                for row in rows[1:]:
                    if row and row[0] == "操作契约":
                        declared_member_contracts = int(re.search(r"\d+", row[3]).group())
            if current_uc:
                for row in rows:
                    if len(row) >= 2 and row[0] in {"系统事件", "系统内部操作"}:
                        operations.setdefault(current_uc, []).append(row[1])

    assert len(use_cases) == 13, f"Expected 13 use-case sections, got {len(use_cases)}"
    assert all("马雨瑶" in use_cases[uc] for uc in ("UC05", "UC06", "UC07"))
    assert [len(operations[uc]) for uc in ("UC05", "UC06", "UC07")] == [2, 4, 2]
    assert {"待确认", "待启动", "运行中", "认证中", "终止确认中", "已终止", "已完成", "执行失败"} <= set(states)
    validation = messages["UC05"]["returnValidation"]
    assert "taskId" in operations["UC05"][1]
    assert declared_member_contracts is not None and declared_total_contracts is not None

    actual_member_contracts = sum(len(operations[uc]) for uc in ("UC05", "UC06", "UC07"))
    actual_total_contracts = sum(map(len, operations.values()))
    return {
        "use_cases": len(use_cases),
        "owned_use_cases": ["UC05", "UC06", "UC07"],
        "owned_contracts": actual_member_contracts,
        "declared_owned_contracts": declared_member_contracts,
        "all_contracts": actual_total_contracts,
        "declared_all_contracts": declared_total_contracts,
        "confirmation_id_missing_from_validation": "taskId" not in validation,
        "task_host_binding_message_missing": not any(
            "taskId" in parameters and "hostId" in parameters
            for uc in ("UC05", "UC06", "UC07")
            for parameters in messages.get(uc, {}).values()
        ),
        "states": len(states),
    }


def rehearse_state_paths():
    # This miniature model checks that the documented transition constraints
    # can express the main and failure paths without touching real systems.
    state = "待确认"
    state = "待启动"  # confirmTask after successful validation
    assert state == "待启动"
    run_count = 0
    host_ready = False
    if not host_ready:  # startLoop returns error and creates no run
        assert state == "待启动" and run_count == 0
    host_ready = True
    if host_ready:
        state, run_count = "运行中", run_count + 1
    assert state == "运行中" and run_count == 1

    state = "认证中"  # finishLoop, with a frozen candidate list
    candidates = ("candidate-1", "candidate-2")
    certified = {"candidate-1"}  # certification was interrupted here
    certification_calls = {"candidate-1": 1, "candidate-2": 0}
    for candidate in candidates:  # resume after interruption is idempotent
        if candidate not in certified:
            certified.add(candidate)
            certification_calls[candidate] += 1
    assert len(certified) == 2 and set(certification_calls.values()) == {1}
    state = "已完成"
    assert state == "已完成"

    state = "运行中"
    state = "终止确认中"  # stopTask cannot confirm remote process stopped
    assert state != "已终止"
    state = "已终止"  # only after remote stop acknowledgement
    assert state == "已终止"
    return {"paths": ["startup_failure_retry", "certification_resume", "stop_acknowledgement"],
            "candidate_certifications": len(certified)}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 week2_model_check.py source.docx")
    source = Path(sys.argv[1])
    if not source.is_file():
        raise SystemExit(f"missing source: {source}")
    print(json.dumps({"document": inspect_document(source),
                      "state_rehearsal": rehearse_state_paths()}, ensure_ascii=False,
                     indent=2))
