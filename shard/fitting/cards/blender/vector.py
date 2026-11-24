# -*- coding: utf-8 -*-
"""vector 卡片：x / y / z 三个分量。"""

from ...errors import ConfigError
from ._common import expand_compound, pack, param_with

KIND = "vector"


def build(param, spec):
    if "choices" in spec:
        raise ConfigError("%s 是复合类型，不能用 choices" % param.identifier)
    return param_with(param, expand_compound(param, spec))


__all__ = ["KIND", "build", "pack"]
