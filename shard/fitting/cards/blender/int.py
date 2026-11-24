# -*- coding: utf-8 -*-
"""int 卡片：单个整数搜索维度。"""

from ...contract import DIST_CATEGORICAL, DIST_INT, Component
from ...errors import ConfigError
from ._common import pack, param_with

KIND = "int"


def build(param, spec):
    if "choices" in spec:
        choices = spec["choices"]
        if not all(
            isinstance(item, int) and not isinstance(item, bool) for item in choices
        ):
            raise ConfigError("%s 是 int，choices 只能是整数" % param.identifier)
        component = Component(
            key=param.key, type=DIST_CATEGORICAL, choices=tuple(choices)
        )
        return param_with(param, (component,))

    if spec.get("min") is None:
        raise ConfigError("%s 需要给 min/max 或 choices" % param.identifier)
    low, high = spec["min"], spec["max"]
    if not float(low).is_integer() or not float(high).is_integer():
        raise ConfigError("%s 是 int，min/max 必须是整数" % param.identifier)
    log = bool(spec.get("log")) if spec.get("log") is not None else False
    if log and low < 1:
        raise ConfigError("%s 开了 log，min 必须大于等于 1" % param.identifier)
    step = spec.get("step")
    if step is not None and (not float(step).is_integer() or step < 1):
        raise ConfigError("%s 是 int，step 需要是正整数" % param.identifier)
    component = Component(
        key=param.key,
        type=DIST_INT,
        low=int(low),
        high=int(high),
        step=int(step) if step is not None else 1,
        log=log,
    )
    return param_with(param, (component,))


__all__ = ["KIND", "build", "pack"]
