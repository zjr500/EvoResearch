"""Isolated subprocess entry point for prevalidated Ridge model factories."""
import importlib.util
from pathlib import Path
import sys

import numpy as np

model_path, inputs, output, seed = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4])
spec = importlib.util.spec_from_file_location("candidate", model_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
model = module.build_model(seed)
model.fit(np.load(inputs / "train_x.npy", allow_pickle=False), np.load(inputs / "train_y.npy", allow_pickle=False))
predictions = model.predict(np.load(inputs / "eval_x.npy", allow_pickle=False))
np.save(output / "predictions.npy", predictions, allow_pickle=False)
