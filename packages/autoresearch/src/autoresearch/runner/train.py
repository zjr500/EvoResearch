"""Fixed experiment runner. Receives training labels and evaluation features only."""
import importlib.util
import os
from pathlib import Path
import sys
import time

for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[name] = "1"
import numpy as np

code, data, output, seed = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4])
output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("candidate", code / "model.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
model = module.build_model(seed)
t0 = time.monotonic()
model.fit(np.load(data / "train_x.npy", allow_pickle=False), np.load(data / "train_y.npy", allow_pickle=False))
predictions = model.predict(np.load(data / "eval_x.npy", allow_pickle=False))
np.save(output / "predictions.npy", predictions, allow_pickle=False)
(output / "runtime.txt").write_text(str(time.monotonic() - t0), encoding="utf-8")
