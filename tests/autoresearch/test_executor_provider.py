import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pytest

from autoresearch.config import Halt, Settings
from autoresearch.executor import execute, supervised
from autoresearch.templates import BASELINE, prepare_data


def _process_alive(pid):
    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True
    import ctypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
    kernel.GetExitCodeProcess.restype = ctypes.c_int
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x1000, 0, pid)
    if not handle:
        return ctypes.get_last_error() == 5
    code = ctypes.c_uint32()
    ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
    kernel.CloseHandle(handle)
    return bool(ok) and code.value == 259


def test_actual_process_timeout_and_cancellation(tmp_path):
    command = [sys.executable, "-c", "import time; time.sleep(20)"]
    start = time.monotonic()
    with pytest.raises(TimeoutError, match="^experiment_timeout$"):
        supervised(command, tmp_path, os.environ.copy(), 0.3, lambda: None, tmp_path / "out", tmp_path / "err")
    assert time.monotonic() - start < 5
    def stop():
        raise Halt("user_stop")
    with pytest.raises(Halt):
        supervised(command, tmp_path, os.environ.copy(), 20, stop, tmp_path / "out", tmp_path / "err")


def test_timeout_kills_child_and_ignores_failed_taskkill(tmp_path, monkeypatch):
    real_run = subprocess.run

    def fake_run(args, *args_rest, **kwargs):
        if isinstance(args, (list, tuple)) and args and args[0] == "taskkill":
            time.sleep(8)
            return subprocess.CompletedProcess(list(args), 1, "", "ERROR: The user name or password is incorrect.\n\n")
        return real_run(args, *args_rest, **kwargs)

    monkeypatch.setattr("autoresearch.executor.subprocess.run", fake_run)
    pid_file = tmp_path / "child.pid"
    env = os.environ.copy()
    env["CHILD_PID_FILE"] = str(pid_file)
    command = [sys.executable, "-c", "import os,pathlib,subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); pathlib.Path(os.environ['CHILD_PID_FILE']).write_text(str(p.pid)); time.sleep(30)"]
    start = time.monotonic()
    with pytest.raises(TimeoutError, match="^experiment_timeout$"):
        supervised(command, tmp_path, env, 2, lambda: None, tmp_path / "out", tmp_path / "err")
    assert time.monotonic() - start < 5
    assert pid_file.exists()
    assert not _process_alive(int(pid_file.read_text()))


def test_completed_experiment_reused_without_rewrite_and_tamper_rejected(tmp_path, monkeypatch):
    data = tmp_path / "data"
    prepare_data(data)
    settings = Settings(tmp_path, runner="local_trusted")
    root = tmp_path / "experiment"
    result = execute(settings, root, data, BASELINE, 7, "validation", 120, lambda: 120)
    assert result["status"] == "valid"
    timestamp = (root / "result.json").stat().st_mtime_ns
    def forbidden(*args, **kwargs):
        raise AssertionError("Completed experiment must not rerun")
    monkeypatch.setattr("autoresearch.executor.supervised", forbidden)
    assert execute(settings, root, data, BASELINE, 7, "validation", 120, lambda: 120) == result
    np.testing.assert_array_equal(np.load(root / "output/labels.npy"), np.load(data / "validation_y.npy"))
    assert result["labels_sha256"]
    assert (root / "result.json").stat().st_mtime_ns == timestamp
    with pytest.raises(ValueError, match="identity_conflict"):
        execute(settings, root, data, BASELINE.replace("(32,)", "(48,)"), 7, "validation", 120, lambda: 120)
    assert (root / "code/model.py").read_text() == BASELINE
    (root / "output/predictions.npy").write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="output_integrity"):
        execute(settings, root, data, BASELINE, 7, "validation", 120, lambda: 120)


@pytest.mark.parametrize("kind,expected", [("missing", "missing_output"), ("nan", "invalid_output"), ("shape", "invalid_output"), ("failed", "execution_failed"), ("timeout", "timeout")])
def test_invalid_experiment_outputs(tmp_path, monkeypatch, kind, expected):
    data = tmp_path / "data"
    prepare_data(data)
    def fixture(command, cwd, env, timeout, check, stdout, stderr, cleanup):
        if kind == "timeout":
            raise TimeoutError()
        if kind == "failed":
            return 1
        if kind != "missing":
            values = np.full(np.load(data / "validation_y.npy").shape, np.nan) if kind == "nan" else np.zeros(2)
            np.save(cwd / "output" / "predictions.npy", values)
        return 0
    monkeypatch.setattr("autoresearch.executor.supervised", fixture)
    outcome = execute(Settings(tmp_path, runner="local_trusted"), tmp_path / "experiment", data, BASELINE, 7, "validation", 10, lambda: 10)
    assert outcome["status"] == expected
    assert "metrics" not in outcome


@pytest.mark.parametrize("model,finish_reason", [("fixture-model", "stop"), ("glm-5.3", "stop"), ("glm-5.3", "length")])
def test_openai_compatible_adapter_real_http_mock(tmp_path, model, finish_reason):
    seen = []
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append((self.path, self.headers["Authorization"], body))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"id": "fixture-request", "model": model,
                "usage": {"prompt_tokens": 20, "completion_tokens": 30, "total_tokens": 50},
                "choices": [{"finish_reason": finish_reason, "message": {"content": json.dumps({"hypothesis": "fixture", "rationale": "fixture", "code": BASELINE})}}]}).encode())
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        request, response = tmp_path / "context.json", tmp_path / "response.json"
        request.write_text(json.dumps({"goal": "accuracy", "history": []}))
        env = dict(os.environ, AUTORESEARCH_MODEL_BASE_URL=f"http://127.0.0.1:{server.server_port}/v1", AUTORESEARCH_MODEL_API_KEY="fixture-secret", AUTORESEARCH_MODEL=model, AUTORESEARCH_REASONING_EFFORT="low", PYTHONPATH=str((Path(__file__).resolve().parents[2] / "packages/autoresearch") / "src"))
        if model == "glm-5.3" and finish_reason == "stop":
            env["AUTORESEARCH_REASONING_EFFORT"] = "low\r"
        proc = subprocess.run([sys.executable, "-m", "autoresearch.provider_call", str(request), str(response)], env=env, capture_output=True, timeout=15)
        if finish_reason == "length":
            assert proc.returncode != 0 and b"model_response_incomplete" in proc.stderr
            assert not response.exists()
        else:
            assert proc.returncode == 0, proc.stderr
        assert seen[0][0] == "/v1/chat/completions" and seen[0][1] == "Bearer fixture-secret"
        assert seen[0][2]["model"] == model
        if model == "glm-5.3":
            assert seen[0][2]["thinking"] == {"type": "enabled"}
            assert seen[0][2]["reasoning_effort"] == "low"
            assert seen[0][2]["max_tokens"] == 8192
        else:
            assert "thinking" not in seen[0][2] and "reasoning_effort" not in seen[0][2]
        if finish_reason == "stop":
            assert "fixture-secret" not in response.read_text()
            assert json.loads(response.read_text())["code"] == BASELINE
        metadata = response.with_suffix(".model_call.json").read_text()
        assert "fixture-secret" not in metadata
        assert json.loads(metadata)["usage"]["total_tokens"] == 50
        assert json.loads(metadata)["returned_model"] == model
    finally:
        server.shutdown()
        server.server_close()
