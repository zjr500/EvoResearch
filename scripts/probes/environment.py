"""Read-only environment probe; run through DSH's confined subprocess service."""
import importlib.util
import json
import os
import platform
import subprocess

result = {"python": platform.python_version(), "platform": platform.system(), "machine": platform.machine(), "cpu_count": os.cpu_count(), "frameworks": {}}
for name in ("torch", "tensorflow"):
    if importlib.util.find_spec(name) is None:
        result["frameworks"][name] = {"installed": False}
        continue
    try:
        mod = __import__(name)
        gpu = bool(mod.cuda.is_available()) if name == "torch" else bool(mod.config.list_physical_devices("GPU"))
        result["frameworks"][name] = {"installed": True, "version": mod.__version__, "gpu_available": gpu}
    except Exception:
        result["frameworks"][name] = {"installed": True, "error": "import_or_gpu_check_failed"}
try:
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
    result["nvidia"] = {"available": gpu.returncode == 0, "devices": gpu.stdout.strip().splitlines() if gpu.returncode == 0 else []}
except (OSError, subprocess.TimeoutExpired):
    result["nvidia"] = {"available": False, "devices": []}
print(json.dumps(result), flush=True)
