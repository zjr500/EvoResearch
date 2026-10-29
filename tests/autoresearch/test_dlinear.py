import json

import numpy as np
import pytest

from autoresearch.dlinear import BASELINE, prepare_data, validate_code
from autoresearch.engine import feedback_context, feedback_demo
from autoresearch.tasks import template_by_id


@pytest.mark.parametrize('window', [3, 13, 25, 49])
def test_only_odd_bounded_window_can_change(window):
    assert validate_code(BASELINE.replace('kernel_size = 25', f'kernel_size = {window}')) == {'kernel_size': window}


@pytest.mark.parametrize('code', [BASELINE.replace('kernel_size = 25', 'kernel_size = 50'),
                                  BASELINE.replace('kernel_size = 25', 'kernel_size = True'),
                                  BASELINE.replace('configs.pred_len', '96'),
                                  BASELINE + '\nimport os\n',
                                  BASELINE.replace('kernel_size = 25', 'kernel_size = int(13)')])
def test_other_changes_are_rejected(code):
    with pytest.raises(ValueError):
        validate_code(code)


def test_fixed_split_and_training_only_scaler(tmp_path):
    manifest = prepare_data(tmp_path)
    assert manifest['scaler']['fit_rows'] == [0, 8640]
    train = np.load(tmp_path / 'train.npy')
    val = np.load(tmp_path / 'validation.npy')
    test = np.load(tmp_path / 'test.npy')
    assert train.shape == (8640, 7) and val.shape == test.shape == (3216, 7)
    np.testing.assert_allclose(train.mean(axis=0, dtype=np.float64), np.zeros(7), atol=1e-7)
    np.testing.assert_array_equal(val[:336], train[-336:])
    np.testing.assert_array_equal(test[:336], val[-336:])
    assert len(val) - 336 - 96 + 1 == 2785
    assert prepare_data(tmp_path) == manifest
    val[0, 0] += 1
    np.save(tmp_path / 'validation.npy', val)
    with pytest.raises(ValueError, match='data_integrity_failed'):
        prepare_data(tmp_path)


def test_dlinear_feedback_has_its_own_scope_and_no_test_results():
    template = template_by_id('dlinear-etth1-v1')
    project = {'template_id': template['id'], 'goal': '改进预测', 'plan': {'template': template}}
    context = feedback_context(project, {'mse': 0.7, 'mae': 0.6}, [], BASELINE)
    assert context['editable_paths'] == ['models/DLinear.py']
    assert context['primary_metric'] == 'validation_mse' and context['direction'] == 'minimize'
    assert 'test' not in json.dumps(context)
    assert validate_code(feedback_demo(context)['code']) == {'kernel_size': 13}
