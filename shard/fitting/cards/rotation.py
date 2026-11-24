# -*- coding: utf-8 -*-
"""rotation 卡片：x / y / z 欧拉角（度）。"""

from ..errors import ConfigError
from ._common import expand_compound, pack, param_with

KIND = "rotation"


def build(param, spec):
    if "choices" in spec:
        raise ConfigError("%s 是复合类型，不能用 choices" % param.identifier)
    return param_with(param, expand_compound(param, spec))


__all__ = ["KIND", "build", "pack"]
