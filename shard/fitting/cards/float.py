# -*- coding: utf-8 -*-
"""float 卡片：单个标量搜索维度。"""

from ..contract import DIST_CATEGORICAL, DIST_FLOAT, Component
from ..errors import ConfigError
from ._common import pack, param_with

KIND = "float"


def build(param, spec):
    if "choices" in spec:
        choices = spec["choices"]
        if not all(
            isinstance(item, (int, float)) and not isinstance(item, bool)
            for item in choices
        ):
            raise ConfigError("%s 是 float，choices 只能是数字" % param.identifier)
        component = Component(
            key=param.key, type=DIST_CATEGORICAL, choices=tuple(choices)
        )
        return param_with(param, (component,))

    if spec.get("min") is None:
        raise ConfigError("%s 需要给 min/max 或 choices" % param.identifier)
    low, high = float(spec["min"]), float(spec["max"])
    step = spec.get("step")
    log = bool(spec.get("log")) if spec.get("log") is not None else False
    if low >= high:
        raise ConfigError("%s 的 min 必须小于 max" % param.identifier)
    if log and low <= 0:
        raise ConfigError("%s 开了 log，min 必须大于 0" % param.identifier)
    if log and step is not None:
        raise ConfigError("%s 不能同时开 log 和给 step" % param.identifier)
    component = Component(
        key=param.key, type=DIST_FLOAT, low=low, high=high, step=step, log=log
    )
    return param_with(param, (component,))


__all__ = ["KIND", "build", "pack"]
