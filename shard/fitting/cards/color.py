# -*- coding: utf-8 -*-
"""color 卡片：r / g / b 三个通道（默认不含 alpha）。"""

from ..errors import ConfigError
from ._common import expand_compound, pack, param_with

KIND = "color"


def build(param, spec):
    if "choices" in spec:
        raise ConfigError("%s 是复合类型，不能用 choices" % param.identifier)
    return param_with(param, expand_compound(param, spec))


__all__ = ["KIND", "build", "pack"]
