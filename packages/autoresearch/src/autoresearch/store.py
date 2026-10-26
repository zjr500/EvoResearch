import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


def ident(prefix):
    return prefix + "_" + uuid.uuid4().hex


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    tmp.replace(path)


class Store:
    def __init__(self, home: Path):
        self.home = home.resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.db = self.home / "state.sqlite3"
        with self.connect() as con:
            con.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id),
                    status TEXT NOT NULL, cancel INTEGER NOT NULL DEFAULT 0,
                    body TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_project ON runs(project)
                    WHERE status IN ('queued','running','cancelling');
                CREATE TABLE IF NOT EXISTS trials (
                    run TEXT NOT NULL REFERENCES runs(id), ordinal INTEGER NOT NULL,
                    body TEXT NOT NULL, PRIMARY KEY(run, ordinal));
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES runs(id),
                    kind TEXT NOT NULL, path TEXT NOT NULL, UNIQUE(run,path));
            """)

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.db, timeout=20)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        try:
            yield con
            con.commit()
        except BaseException:
            con.rollback()
            raise
        finally:
            con.close()

    def create_project(self, owner, body):
        pid = ident("project")
        with self.connect() as con:
            con.execute("INSERT INTO projects VALUES (?,?,?,?)", (pid, owner, json.dumps(body), time.time()))
        return self.project(pid)

    def project(self, pid):
        with self.connect() as con:
            row = con.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        return {"id": row["id"], "owner": row["owner"], "created": row["created"], **json.loads(row["body"])} if row else None

    def projects(self, owner):
        with self.connect() as con:
            ids = [r[0] for r in con.execute("SELECT id FROM projects WHERE owner=? ORDER BY created DESC", (owner,))]
        return [self.project(pid) for pid in ids]

    def enqueue(self, pid):
        rid, now = ident("run"), time.time()
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            active = con.execute("SELECT id FROM runs WHERE project=? AND status IN ('queued','running','cancelling')", (pid,)).fetchone()
            if active:
                active_id = active[0]
            else:
                active_id = rid
                con.execute("INSERT INTO runs VALUES (?,?,?,0,?,?,?)", (rid, pid, "queued", json.dumps({"stage": "queued", "elapsed": 0.0, "llm_calls": 0}), now, now))
        return self.run(active_id)

    def run(self, rid):
        with self.connect() as con:
            row = con.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
        if not row:
            return None
        return {"id": row["id"], "project_id": row["project"], "status": row["status"], "cancel_requested": bool(row["cancel"]), "created": row["created"], "updated": row["updated"], **json.loads(row["body"])}

    def runs(self, pid):
        with self.connect() as con:
            ids = [r[0] for r in con.execute("SELECT id FROM runs WHERE project=? ORDER BY created DESC", (pid,))]
        return [self.run(rid) for rid in ids]

    def update(self, rid, **changes):
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
            body = json.loads(row["body"])
            status = changes.pop("status", row["status"])
            body.update(changes)
            con.execute("UPDATE runs SET body=?,status=?,updated=? WHERE id=?", (json.dumps(body, allow_nan=False), status, time.time(), rid))

    def claim(self):
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT id FROM runs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return None
            con.execute("UPDATE runs SET status='running',updated=? WHERE id=?", (time.time(), row[0]))
        return self.run(row[0])

    def queued_ids(self):
        with self.connect() as con:
            return [row[0] for row in con.execute("SELECT id FROM runs WHERE status='queued' ORDER BY created")]

    def recover(self):
        now = time.time()
        with self.connect() as con:
            rows = list(con.execute("SELECT id, status, body FROM runs WHERE status IN ('running','cancelling')"))
            for row in rows:
                body = json.loads(row["body"])
                body["interruption"] = {"kind": "process_lost", "previous_status": row["status"], "recorded_at": now}
                if not body.get("stop_reason"):
                    body["stop_reason"] = "process_lost"
                con.execute("UPDATE runs SET body=?, status='interrupted', updated=? WHERE id=?", (json.dumps(body, ensure_ascii=False, allow_nan=False), now, row["id"]))

    def stop(self, rid):
        with self.connect() as con:
            con.execute("UPDATE runs SET cancel=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END,updated=? WHERE id=? AND status IN ('queued','running','cancelling')", (time.time(), rid))
        return self.run(rid)

    def resume(self, rid):
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
            if not row or row["status"] not in {"interrupted", "cancelled"}:
                return self.run(rid)
            body = json.loads(row["body"])
            now = time.time()
            history = body.setdefault("resume_history", [])
            history.append({"previous_status": row["status"], "previous_stage": body.get("stage"),
                            "stop_reason": body.pop("stop_reason", None), "error": body.pop("error", None),
                            "elapsed": body.get("elapsed", 0), "resumed_at": now})
            con.execute("UPDATE runs SET status='queued',cancel=0,body=?,updated=? WHERE id=?",
                        (json.dumps(body, ensure_ascii=False, allow_nan=False), now, rid))
        return self.run(rid)

    def trial(self, rid, ordinal, body):
        with self.connect() as con:
            con.execute("INSERT INTO trials VALUES (?,?,?) ON CONFLICT(run,ordinal) DO UPDATE SET body=excluded.body", (rid, ordinal, json.dumps(body, ensure_ascii=False, allow_nan=False)))

    def trials(self, rid):
        with self.connect() as con:
            return [{"ordinal": row["ordinal"], **json.loads(row["body"])} for row in con.execute("SELECT * FROM trials WHERE run=? ORDER BY ordinal", (rid,))]

    def artifact(self, rid, path, kind):
        root = (self.home / "runs" / rid).resolve()
        absolute = path.resolve()
        relative = absolute.relative_to(root).as_posix()
        if not absolute.is_file() or absolute.is_symlink():
            raise ValueError("Artifact must be a regular file")
        with self.connect() as con:
            con.execute("INSERT OR IGNORE INTO artifacts VALUES (?,?,?,?)", (ident("artifact"), rid, kind, relative))

    def artifacts(self, rid):
        with self.connect() as con:
            return [dict(row) for row in con.execute("SELECT * FROM artifacts WHERE run=? ORDER BY path", (rid,))]

    def artifact_by_id(self, aid):
        with self.connect() as con:
            row = con.execute("SELECT * FROM artifacts WHERE id=?", (aid,)).fetchone()
        return dict(row) if row else None
