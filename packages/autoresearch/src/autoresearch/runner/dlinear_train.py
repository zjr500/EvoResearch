"""Fixed DLinear training. Test data is evaluated only after validation-selected training."""
import importlib.util
import json
from pathlib import Path
import random
import sys
import time
from types import SimpleNamespace

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset


class Windows(Dataset):
    def __init__(self, values):
        self.values = values

    def __len__(self):
        return len(self.values) - 431

    def __getitem__(self, i):
        return self.values[i:i + 336], self.values[i + 336:i + 432]


def main():
    code, inputs, output = map(Path, sys.argv[1:4])
    seed, split = int(sys.argv[4]), sys.argv[5]
    config = json.loads((inputs / 'config.json').read_text())
    torch.set_num_threads(config['torch_num_threads'])
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    spec = importlib.util.spec_from_file_location('candidate', code)
    candidate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(candidate)
    model = candidate.Model(SimpleNamespace(**config))
    train = DataLoader(Windows(np.load(inputs / 'train.npy', allow_pickle=False)), batch_size=32, shuffle=True, drop_last=True)
    validation = DataLoader(Windows(np.load(inputs / 'validation.npy', allow_pickle=False)), batch_size=32, shuffle=False, drop_last=False)
    optimizer = torch.optim.Adam(model.parameters(), lr=config['learning_rate'])
    best, stale, history = float('inf'), 0, []
    started = time.monotonic()
    checkpoint = None
    for epoch in range(config['train_epochs']):
        model.train()
        for x, y in train:
            optimizer.zero_grad()
            loss = torch.mean((model(x) - y) ** 2)
            loss.backward()
            optimizer.step()
        model.eval()
        squared, count = 0.0, 0
        with torch.no_grad():
            for x, y in validation:
                error = model(x).double() - y.double()
                squared += float(error.square().sum())
                count += error.numel()
        value = squared / count
        history.append({'epoch': epoch + 1, 'validation_mse': value})
        print(json.dumps(history[-1]), flush=True)
        if value < best:
            best, stale = value, 0
            checkpoint = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            stale += 1
            if stale >= config['patience']:
                break
        for group in optimizer.param_groups:
            group['lr'] = config['learning_rate'] * (0.5 ** epoch)
    model.load_state_dict(checkpoint)
    evaluation = DataLoader(Windows(np.load(inputs / (split + '.npy'), allow_pickle=False)), batch_size=32, shuffle=False, drop_last=False)
    predictions = []
    with torch.no_grad():
        for x, _ in evaluation:
            predictions.append(model(x).numpy())
    np.save(output / 'predictions.npy', np.concatenate(predictions), allow_pickle=False)
    (output / 'training.json').write_text(json.dumps({'device': 'cpu', 'torch': torch.__version__, 'seed': seed,
         'epochs': history, 'best_epoch': min(history, key=lambda r: r['validation_mse'])['epoch'],
         'elapsed_seconds': time.monotonic() - started, 'config': config}), encoding='utf-8')


if __name__ == '__main__':
    main()
