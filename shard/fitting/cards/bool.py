# -*- coding: utf-8 -*-
"""bool 卡片：两个类别。"""

from ..contract import DIST_CATEGORICAL, Component
from ..errors import ConfigError
from ._common import pack, param_with

KIND = "bool"


def build(param, spec):
    choices = spec.get("choices", (True, False))
    if not all(isinstance(item, bool) for item in choices):
        raise ConfigError("%s 是 bool，choices 只能是 true/false" % param.identifier)
    component = Component(
        key=param.key, type=DIST_CATEGORICAL, choices=tuple(choices)
    )
    return param_with(param, (component,))


__all__ = ["KIND", "build", "pack"]
