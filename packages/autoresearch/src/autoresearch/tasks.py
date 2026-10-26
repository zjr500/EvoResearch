"""The two configured tasks share the same research loop."""
from copy import deepcopy

from .templates import BASELINE, TEMPLATE, prepare_data, validate_code


def template_by_id(template_id):
    if template_id == TEMPLATE['id']:
        return {**deepcopy(TEMPLATE), 'secondary_metric': 'macro_f1', 'secondary_direction': 'maximize',
                'primary_label': '准确率', 'secondary_label': '宏平均F1', 'unit': None,
                'comparison': 'higher_is_better', 'runnable': True}
    if template_id == 'dlinear-etth1-v1':
        return {'id': template_id, 'version': '0.1', 'name': 'ETTh1 小时级预测',
                'description': 'DLinear，输入336小时、预测96小时，7变量；固定训练与评测配置。',
                'editable_paths': ['models/DLinear.py'], 'primary_metric': 'mse', 'direction': 'minimize',
                'secondary_metric': 'mae', 'secondary_direction': 'minimize',
                'primary_label': '均方误差', 'secondary_label': '平均绝对误差',
                'unit': 'train_standardized', 'comparison': 'lower_is_better', 'runnable': True,
                'defaults': dict(TEMPLATE['defaults']), 'limits': deepcopy(TEMPLATE['limits']),
                'confirmation_seeds': [2021, 2022, 2023], 'split_seed': 2021,
                'allowed_parameters': {'kernel_size': '仅修改Model.__init__中的滑动平均窗口；3至49的奇数，其他代码保持不变'},
                'historical_validation': {'mse': 0.6484228295042245, 'mae': 0.5441183980636113,
                                          'split': 'validation', 'device': '3090', 'date': '2026-10-16'}}
    return None


def template_catalog():
    return [template_by_id(TEMPLATE['id']), template_by_id('dlinear-etth1-v1')]


def baseline_code(template_id):
    if template_id == 'dlinear-etth1-v1':
        from .dlinear import BASELINE as source
        return source
    return BASELINE


def check_code(template_id, source):
    if template_id == 'dlinear-etth1-v1':
        from .dlinear import validate_code as validate
        return validate(source)
    return validate_code(source)


def prepare_task(template_id, root):
    if template_id == 'dlinear-etth1-v1':
        from .dlinear import prepare_data as prepare
        return prepare(root)
    return prepare_data(root)
