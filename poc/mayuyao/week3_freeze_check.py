#!/usr/bin/env python3
"""Check the frozen EvoResearch use cases, contracts, API list and F7 bridge.

Usage: python week3_freeze_check.py SRS.docx API_Design.docx
This is a document-level check; it does not exercise the plugin or SSH host.
"""

import re
import sys
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def body(path):
    with zipfile.ZipFile(path) as archive:
        return ET.fromstring(archive.read("word/document.xml")).find(f"{W}body")


def text(element):
    return "".join(t.text or "" for t in element.iter(f"{W}t"))


def style(paragraph):
    item = paragraph.find(f"{W}pPr/{W}pStyle")
    return item.get(f"{W}val", "") if item is not None else ""


def table_rows(table):
    return [[text(cell) for cell in row.findall(f"{W}tc")]
            for row in table.findall(f"{W}tr")]


def main(srs_path, api_path):
    srs = body(srs_path)
    api = body(api_path)
    use_cases = set()
    contracts = Counter()
    active_uc = None
    for item in srs:
        if item.tag == f"{W}p":
            match = re.match(r"UC(\d{2})\s", text(item)) if style(item) in {"3", "Heading3"} else None
            if match:
                active_uc = match.group(1)
                use_cases.add(active_uc)
        elif item.tag == f"{W}tbl" and active_uc:
            rows = table_rows(item)
            contracts[active_uc] += sum(
                row[0] in {"系统事件", "系统内部操作"}
                for row in rows if row
            )

    tables = [table_rows(item) for item in api if item.tag == f"{W}tbl"]
    api_list = next(rows for rows in tables if rows and rows[0][0] == "接口")
    schema_names = [text(item).split("（", 1)[0] for item in api
                    if item.tag == f"{W}p"
                    and style(item) in {"3", "Heading3"}
                    and re.fullmatch(r"[a-z_]+（[^）]+）", text(item))]
    api_text = text(api)
    srs_text = text(srs)
    assert len(use_cases) == 13, use_cases
    assert sum(contracts.values()) == 25, contracts
    assert [contracts[f"{n:02d}"] for n in (5, 6, 7)] == [2, 4, 3], contracts
    assert len(api_list) - 1 == 30, len(api_list)
    assert len(schema_names) == len(set(schema_names)) == 13, schema_names
    assert "按领域模型建立 12 张表，另设 1 张操作记录表" in api_text
    assert "remote_hosts（远程主机）" in api_text
    assert "taskId（草稿任务编号" in srs_text
    assert "bindTaskHost" in srs_text
    assert "PUT /experiments/{id}/host" in api_text
    assert "POST /remote/hosts" in api_text
    assert "host_alias" in api_text
    print("PASS: 13 use cases; 25 contracts; UC05–07 = 2+4+3; 30 APIs; 13 tables; F7 bridge present")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python week3_freeze_check.py SRS.docx API_Design.docx")
    main(*sys.argv[1:])
