# -*- coding: utf-8 -*-
"""matrix 卡片：平移 3 + 旋转 3 + 缩放 3，共 9 个分量。"""

from ...errors import ConfigError
from ._common import expand_compound, pack, param_with

KIND = "matrix"


def build(param, spec):
    if "choices" in spec:
        raise ConfigError("%s 是复合类型，不能用 choices" % param.identifier)
    return param_with(param, expand_compound(param, spec))


__all__ = ["KIND", "build", "pack"]
