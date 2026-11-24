# -*- coding: utf-8 -*-
"""Blender 值类型卡注册表。

一个值类型一个卡片文件（cards/blender/）；引擎只 import 本次用到的类型。
配置里出现了没有卡片的类型，直接报错 —— 不会静默跳过。
工具策略卡（score / target / memory ...）由 core.registry 管理。
"""

import importlib

from ..contract import (
    KIND_BOOL,
    KIND_COLOR,
    KIND_FLOAT,
    KIND_INT,
    KIND_MATRIX,
    KIND_ROTATION,
    KIND_VECTOR,
)
from ..errors import ConfigError

_MODULES = {
    KIND_FLOAT: "fitting.cards.blender.float",
    KIND_INT: "fitting.cards.blender.int",
    KIND_BOOL: "fitting.cards.blender.bool",
    KIND_VECTOR: "fitting.cards.blender.vector",
    KIND_COLOR: "fitting.cards.blender.color",
    KIND_ROTATION: "fitting.cards.blender.rotation",
    KIND_MATRIX: "fitting.cards.blender.matrix",
}

_loaded = {}


def load(kinds):
    """按需加载卡片，返回 {kind: 模块}。没有对应卡片的类型直接报错。"""
    unique = []
    for kind in kinds:
        if kind not in unique:
            unique.append(kind)
    missing = [kind for kind in unique if kind not in _MODULES]
    if missing:
        raise ConfigError("没有这些值类型的卡片：%s" % ", ".join(missing))
    for kind in unique:
        if kind not in _loaded:
            _loaded[kind] = importlib.import_module(_MODULES[kind])
    return {kind: _loaded[kind] for kind in unique}
