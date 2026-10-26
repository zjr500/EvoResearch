"""Fixed ETTh1 task and evaluator; candidate edits are limited to one model constant."""
import ast
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

import numpy as np
from sklearn.preprocessing import StandardScaler

from .config import Halt
from .store import atomic_json
from .templates import digest

ASSETS = Path(__file__).parent / 'assets/dlinear'
BASELINE = (ASSETS / 'DLinear.py').read_text(encoding='utf-8')
CONFIG = {'seq_len': 336, 'pred_len': 96, 'enc_in': 7, 'individual': False,
          'batch_size': 32, 'learning_rate': 0.005, 'train_epochs': 10, 'patience': 3,
          'torch_num_threads': 2, 'train_drop_last': True, 'eval_drop_last': False,
          'learning_rate_schedule': 'type1'}


def validate_code(source):
    try:
        if not isinstance(source, str) or len(source) > 12000:
            raise ValueError('invalid_code_size')
        tree, reference = ast.parse(source), ast.parse(BASELINE)
        model = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Model')
        init = next(n for n in model.body if isinstance(n, ast.FunctionDef) and n.name == '__init__')
        assignments = [n for n in init.body if isinstance(n, ast.Assign) and len(n.targets) == 1
                       and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'kernel_size']
        if len(assignments) != 1:
            raise ValueError('editable_boundary')
        value = ast.literal_eval(assignments[0].value)
        if type(value) is not int or not 3 <= value <= 49 or value % 2 != 1:
            raise ValueError('parameter_budget')
        assignments[0].value = ast.Constant(value=25)
        if ast.dump(tree) != ast.dump(reference):
            raise ValueError('editable_boundary: only kernel_size may change')
        return {'kernel_size': value}
    except (SyntaxError, TypeError, AttributeError, StopIteration) as exc:
        raise ValueError('invalid_model_code') from exc


def prepare_data(root):
    root.mkdir(parents=True, exist_ok=True)
    path = root / 'manifest.json'
    if path.exists():
        manifest = json.loads(path.read_text(encoding='utf-8'))
        if any(digest(root / name) != sha for name, sha in manifest['files'].items()):
            raise ValueError('data_integrity_failed')
        return manifest
    with (ASSETS / 'ETTh1.csv').open(encoding='utf-8', newline='') as f:
        rows = list(csv.reader(f))
    values = np.asarray([[float(x) for x in row[1:]] for row in rows[1:14401]], dtype=np.float64)
    scaler = StandardScaler().fit(values[:8640])
    series = scaler.transform(values).astype(np.float32)
    for name, (start, end) in {'train': (0, 8640), 'validation': (8304, 11520), 'test': (11184, 14400)}.items():
        np.save(root / (name + '.npy'), series[start:end], allow_pickle=False)
    manifest = {'dataset': 'ETTh1', 'source_sha256': digest(ASSETS / 'ETTh1.csv'),
                'source_commit': '11ab373cf9c9f5be7698e219a5a170e1b1c8a930',
                'model_commit': '0c113668a3b88c4c4ee586b8c5ec3e539c4de5a6',
                'columns': rows[0][1:], 'label_rows': {'train': [336, 8640], 'validation': [8640, 11520], 'test': [11520, 14400]},
                'scaler': {'fit_rows': [0, 8640], 'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist()},
                'config': CONFIG, 'timestamps': [r[0] for r in rows[1:14401]],
                'files': {p.name: digest(p) for p in root.glob('*.npy')}}
    atomic_json(path, manifest)
    return manifest


def execute(settings, root, data, code, seed, split, timeout, check):
    from .executor import supervised
    if settings.runner != 'local_trusted':
        raise ValueError('dlinear_requires_local_trusted_runner')
    validate_code(code)
    root.mkdir(parents=True, exist_ok=True)
    model = root / 'code/models/DLinear.py'
    result_file = root / 'result.json'
    identity = {'code_sha256': hashlib.sha256(code.encode()).hexdigest(), 'seed': seed,
                'split': split, 'data_manifest_sha256': digest(data / 'manifest.json')}
    if result_file.exists():
        cached = json.loads(result_file.read_text(encoding='utf-8'))
        if any(cached.get(k) != v for k, v in identity.items()):
            raise ValueError('experiment_identity_conflict')
        if not model.exists() or digest(model) != identity['code_sha256']:
            raise ValueError('experiment_code_integrity_conflict')
        if cached['status'] == 'valid':
            for name in ['predictions', 'labels']:
                if digest(root / 'output' / (name + '.npy')) != cached[name + '_sha256']:
                    raise ValueError('experiment_output_integrity_conflict')
        return cached
    model.parent.mkdir(parents=True, exist_ok=True)
    model.write_text(code, encoding='utf-8', newline='')
    inputs, output = root / 'inputs', root / 'output'
    inputs.mkdir(exist_ok=True)
    output.mkdir(exist_ok=True)
    for name in ['train', 'validation', split]:
        shutil.copyfile(data / (name + '.npy'), inputs / (name + '.npy'))
    atomic_json(inputs / 'config.json', CONFIG)
    result = {**identity, 'runner': settings.runner,
              'input_sha256': {p.name: digest(p) for p in inputs.iterdir() if p.is_file()}}
    env = {k: v for k, v in os.environ.items() if k in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'HOME', 'USERPROFILE'}}
    env.update(OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='1', MKL_NUM_THREADS='2', PYTHONUTF8='1')
    runner = Path(__file__).parent / 'runner/dlinear_train.py'
    command = [sys.executable, '-I', str(runner), str(model.resolve()), str(inputs.resolve()), str(output.resolve()), str(seed), split]
    try:
        status = supervised(command, root, env, timeout, check, root / 'stdout.log', root / 'stderr.log')
        if status != 0:
            result.update(status='execution_failed', error='process_exit_' + str(status))
        elif not (output / 'predictions.npy').exists():
            result.update(status='missing_output', error='predictions_missing')
        else:
            pred = np.load(output / 'predictions.npy', allow_pickle=False)
            values = np.load(data / (split + '.npy'), allow_pickle=False)
            labels = np.stack([values[i + 336:i + 432] for i in range(len(values) - 431)])
            if pred.shape != labels.shape or not np.isfinite(pred).all():
                result.update(status='invalid_output', error='invalid_predictions')
            else:
                errors = pred.astype(np.float64) - labels.astype(np.float64)
                metrics = {'mse': float(np.mean(errors ** 2)), 'mae': float(np.mean(np.abs(errors)))}
                if not all(np.isfinite(v) for v in metrics.values()):
                    raise ValueError('nonfinite_metrics')
                np.save(output / 'labels.npy', labels, allow_pickle=False)
                training = json.loads((output / 'training.json').read_text(encoding='utf-8'))
                result.update(status='valid', metrics=metrics, prediction_shape=list(pred.shape),
                              predictions_sha256=digest(output / 'predictions.npy'), labels_sha256=digest(output / 'labels.npy'),
                              training=training)
                manifest = json.loads((data / 'manifest.json').read_text(encoding='utf-8'))
                start = manifest['label_rows'][split][0]
                atomic_json(root / 'forecast.json', {'actual': labels[0, :, -1].tolist(), 'predicted': pred[0, :, -1].tolist(),
                            'timestamps': manifest['timestamps'][start:start + 96], 'target_name': 'OT',
                            'unit': 'train_standardized', 'split': split, 'window_index': 0,
                            'columns': manifest['columns'], 'seed': seed, 'code_sha256': identity['code_sha256']})
    except Halt:
        raise
    except TimeoutError as exc:
        message = str(exc)
        result.update(status='timeout', error=message if message.startswith('terminate_failed:') else 'experiment_timeout')
    except (OSError, ValueError) as exc:
        result.update(status='invalid_output', error=type(exc).__name__)
    atomic_json(result_file, result)
    return result
