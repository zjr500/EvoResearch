import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

import numpy as np
from sklearn.metrics import accuracy_score, f1_score

from .config import Halt
from .store import atomic_json
from .templates import digest, validate_code


class WindowsJob:
    """A job object so a timed-out experiment and its children can be ended together.

    taskkill is not the primary path. In some restricted Windows sessions it
    returns ERROR_LOGON_FAILURE ("The user name or password is incorrect")
    without stopping the process.
    """

    def __init__(self):
        self.handle = None
        self.assigned = False
        self.failure = None
        self._kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel = self._kernel
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
        kernel.CreateJobObjectW.restype = ctypes.c_void_p
        kernel.SetInformationJobObject.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        kernel.SetInformationJobObject.restype = ctypes.c_int
        kernel.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        kernel.AssignProcessToJobObject.restype = ctypes.c_int
        kernel.TerminateJobObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
        kernel.TerminateJobObject.restype = ctypes.c_int
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle.restype = ctypes.c_int
        handle = kernel.CreateJobObjectW(None, None)
        if not handle:
            self.failure = "create_job:" + str(ctypes.get_last_error())
            return
        info = _job_limits()
        info.BasicLimitInformation.LimitFlags = 0x2000
        if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            self.failure = "set_job:" + str(ctypes.get_last_error())
        self.handle = handle

    def assign(self, proc):
        if not self.handle:
            return False
        if not self._kernel.AssignProcessToJobObject(self.handle, int(proc._handle)):
            self.failure = "assign_job:" + str(ctypes.get_last_error())
            return False
        self.assigned = True
        return True

    def terminate(self):
        if not self.handle:
            return False
        if not self._kernel.TerminateJobObject(self.handle, 1):
            self.failure = "terminate_job:" + str(ctypes.get_last_error())
            return False
        return True

    def close(self):
        if self.handle:
            self._kernel.CloseHandle(self.handle)
            self.handle = None


def _job_limits():
    uint64 = ctypes.c_uint64

    class Basic(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", uint64),
            ("PerJobUserTimeLimit", uint64),
            ("LimitFlags", ctypes.c_uint32),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", ctypes.c_uint32),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", ctypes.c_uint32),
            ("SchedulingClass", ctypes.c_uint32),
        ]

    class Counters(ctypes.Structure):
        _fields_ = [(name, uint64) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class Extended(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", Basic),
            ("IoInfo", Counters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    return Extended()


def _windows_kernel():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.TerminateProcess.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    kernel.TerminateProcess.restype = ctypes.c_int
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
    kernel.GetExitCodeProcess.restype = ctypes.c_int
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.CloseHandle.restype = ctypes.c_int
    kernel.CreateToolhelp32Snapshot.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
    kernel.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    kernel.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.Process32FirstW.restype = ctypes.c_int
    kernel.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.Process32NextW.restype = ctypes.c_int
    return kernel


def _process_entry():
    class Entry(ctypes.Structure):
        _fields_ = [
            ("dwSize", ctypes.c_uint32),
            ("cntUsage", ctypes.c_uint32),
            ("th32ProcessID", ctypes.c_uint32),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", ctypes.c_uint32),
            ("cntThreads", ctypes.c_uint32),
            ("th32ParentProcessID", ctypes.c_uint32),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", ctypes.c_uint32),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    entry = Entry()
    entry.dwSize = ctypes.sizeof(Entry)
    return entry


def _windows_pid_alive(pid):
    kernel = _windows_kernel()
    handle = kernel.OpenProcess(0x1000, 0, pid)
    if not handle:
        return ctypes.get_last_error() == 5
    code = ctypes.c_uint32()
    ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
    kernel.CloseHandle(handle)
    return bool(ok) and code.value == 259


def _descendant_pids(root_pid):
    kernel = _windows_kernel()
    snapshot = kernel.CreateToolhelp32Snapshot(0x00000002, 0)
    if not snapshot or snapshot == ctypes.c_void_p(-1).value:
        return []
    children = {}
    entry = _process_entry()
    found = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
    while found:
        children.setdefault(entry.th32ParentProcessID, []).append(entry.th32ProcessID)
        found = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    kernel.CloseHandle(snapshot)
    ordered, seen, pending = [], set(), list(children.get(root_pid, []))
    while pending:
        pid = pending.pop()
        if pid in seen or pid == root_pid:
            continue
        seen.add(pid)
        ordered.append(pid)
        pending.extend(children.get(pid, []))
    return ordered


def _terminate_pid(pid):
    kernel = _windows_kernel()
    handle = kernel.OpenProcess(0x0001, 0, pid)
    if not handle:
        return "open:" + str(ctypes.get_last_error())
    ok = kernel.TerminateProcess(handle, 1)
    error = None if ok else "terminate:" + str(ctypes.get_last_error())
    kernel.CloseHandle(handle)
    return error


def kill_process(proc, job=None):
    if proc.poll() is not None:
        return
    notes = []
    descendants = []
    if os.name == "nt":
        descendants = _descendant_pids(proc.pid)
        if job is not None and not job.terminate() and job.failure:
            notes.append(job.failure)
        if proc.poll() is None:
            for pid in reversed(descendants):
                error = _terminate_pid(pid)
                if error:
                    notes.append(f"pid_{pid}:{error}")
            try:
                proc.kill()
            except OSError as exc:
                notes.append("terminate_process:" + str(getattr(exc, "winerror", None) or exc.errno))
        if proc.poll() is None:
            try:
                completed = subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    capture_output=True, text=True, timeout=2, check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                notes.append("taskkill:" + type(exc).__name__)
            else:
                if completed.returncode not in (0, 128):
                    detail = (completed.stderr or completed.stdout or "").strip().replace("\n", " ")
                    notes.append(f"taskkill_exit_{completed.returncode}:{detail}")
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError as exc:
            notes.append("killpg:" + str(exc.errno))
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        notes.append("process_still_alive")
    leftovers = [pid for pid in descendants if _windows_pid_alive(pid)] if os.name == "nt" else []
    if proc.poll() is None or leftovers:
        if job is not None and job.failure:
            notes.append(job.failure)
        detail = ";".join(dict.fromkeys(notes)) or "process_still_alive"
        if leftovers:
            detail += ";leftover:" + ",".join(str(pid) for pid in leftovers)
        raise TimeoutError("terminate_failed:" + detail)


def supervised(command, cwd, env, timeout, check, stdout, stderr, cleanup=None):
    job = WindowsJob() if os.name == "nt" else None
    try:
        with stdout.open("wb") as out, stderr.open("wb") as err:
            proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=out, stderr=err, start_new_session=os.name != "nt")
            if job is not None:
                job.assign(proc)
            start = time.monotonic()
            try:
                while proc.poll() is None:
                    check()
                    if time.monotonic() - start >= timeout:
                        raise TimeoutError("experiment_timeout")
                    time.sleep(0.1)
                check()
                return proc.returncode
            except BaseException:
                kill_process(proc, job)
                if cleanup:
                    try:
                        cleanup()
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                raise
    finally:
        if job is not None:
            job.close()


def execute(settings, root, data, code, seed, split, timeout, check):
    root.mkdir(parents=True, exist_ok=True)
    (root / "code").mkdir(exist_ok=True)
    model = root / "code" / "model.py"
    validate_code(code)
    result_file = root / "result.json"
    if result_file.exists():
        cached = json.loads(result_file.read_text(encoding="utf-8"))
        if not model.exists() or model.read_text(encoding="utf-8") != code.replace("\r\n", "\n") or cached["code_sha256"] != digest(model) or cached["seed"] != seed or cached["split"] != split:
            raise ValueError("experiment_identity_conflict")
        for name, sha in cached.get("input_sha256", {}).items():
            path = root / "inputs" / name
            if not path.exists() or digest(path) != sha:
                raise ValueError("experiment_input_integrity_conflict")
        if cached["status"] == "valid":
            predictions = root / "output" / "predictions.npy"
            if not predictions.exists() or digest(predictions) != cached["predictions_sha256"]:
                raise ValueError("experiment_output_integrity_conflict")
        return cached
    model.write_text(code, encoding="utf-8", newline="")
    code_sha = digest(model)
    result = {"code_sha256": code_sha, "seed": seed, "split": split, "runner": settings.runner}
    inputs, output = root / "inputs", root / "output"
    inputs.mkdir(exist_ok=True)
    if output.exists():
        # Only this known attempt directory; interrupted output is never a score.
        for p in output.iterdir():
            if p.is_file():
                p.unlink()
    output.mkdir(exist_ok=True)
    for src, dest in [("train_x.npy", "train_x.npy"), ("train_y.npy", "train_y.npy"), (split + "_x.npy", "eval_x.npy")]:
        shutil.copyfile(data / src, inputs / dest)
    result["input_sha256"] = {p.name: digest(p) for p in inputs.glob("*.npy")}
    runner = Path(__file__).parent / "runner" / "train.py"
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "HOME", "USERPROFILE", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"}}
    env.update({"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "PYTHONUTF8": "1"})
    cleanup = None
    if settings.runner == "docker":
        name = "ar-" + hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:24]
        home_label = hashlib.sha256(str(settings.home).encode()).hexdigest()[:24]
        command = ["docker", "run", "--rm", "--name", name, "--label", "autoresearch.home=" + home_label, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "2g", "--cpus", "2", "--user", "65534:65534", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "-v", str(model.parent.resolve()) + ":/code:ro", "-v", str(inputs.resolve()) + ":/data:ro", "-v", str(output.resolve()) + ":/output:rw", settings.image, "python", "/runner/train.py", "/code", "/data", "/output", str(seed)]
        if os.name != "nt":
            output.chmod(0o777)
        cleanup = lambda: subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    else:
        command = [sys.executable, "-I", str(runner), str(model.parent.resolve()), str(inputs.resolve()), str(output.resolve()), str(seed)]
    try:
        exit_code = supervised(command, root, env, timeout, check, root / "stdout.log", root / "stderr.log", cleanup)
        if exit_code != 0:
            result.update(status="execution_failed", error="process_exit_" + str(exit_code))
        elif not (output / "predictions.npy").exists():
            result.update(status="missing_output", error="predictions_missing")
        else:
            predictions = np.load(output / "predictions.npy", allow_pickle=False)
            labels = np.load(data / (split + "_y.npy"), allow_pickle=False)
            if predictions.shape != labels.shape or not np.isfinite(predictions).all() or not np.isin(predictions, np.arange(10)).all():
                result.update(status="invalid_output", error="invalid_predictions")
            else:
                metrics = {"accuracy": float(accuracy_score(labels, predictions)), "macro_f1": float(f1_score(labels, predictions, average="macro"))}
                if not all(math.isfinite(v) for v in metrics.values()):
                    raise ValueError("nonfinite_metrics")
                np.save(output / "labels.npy", labels, allow_pickle=False)
                result.update(status="valid", metrics=metrics, predictions_sha256=digest(output / "predictions.npy"), labels_sha256=digest(output / "labels.npy"))
    except Halt:
        # No terminal result: a resume can rerun this interrupted attempt.
        raise
    except TimeoutError as exc:
        message = str(exc)
        result.update(status="timeout", error=message[:200] if message.startswith("terminate_failed") else "experiment_timeout")
    except (OSError, ValueError) as exc:
        result.update(status="invalid_output", error=type(exc).__name__)
    atomic_json(result_file, result)
    return result
