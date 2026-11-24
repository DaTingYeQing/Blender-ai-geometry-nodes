# -*- coding: utf-8 -*-
"""拟合子系统的共享数据契约。

这里只有纯数据定义和常量，不 import bpy、optuna、numpy。
引擎、Blender 人、Optuna 人、翻译官都只依赖本文件，彼此之间不互相 import。

一个回合的数据流：

    Blender socket 描述 ──schema_to_space──► 搜索空间
                                     │
                              Optuna 采样
                                     ▼
                                  原始值 ──raw_to_packed──► 打包值
                                                              │
                                                    packed_to_native
                                                              ▼
                                                    Blender 可赋值对象

"打包值"一律是普通 dict/list/number/str，可以直接 JSON 传输；
只有 packed_to_native 需要 mathutils（在 Blender 内调用）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator, Tuple

# ---------------------------------------------------------------- 字段类型

KIND_FLOAT = "float"
KIND_INT = "int"
KIND_BOOL = "bool"
KIND_VECTOR = "vector"
KIND_COLOR = "color"
KIND_ROTATION = "rotation"
KIND_MATRIX = "matrix"
KIND_GEOMETRY = "geometry"
KIND_FIXED = "fixed"

# Blender socket 归一化后的基类型 → 字段类型。
SOCKET_TO_KIND = {
    "Float": KIND_FLOAT,
    "Int": KIND_INT,
    "Bool": KIND_BOOL,
    "Vector": KIND_VECTOR,
    "Color": KIND_COLOR,
    "Rotation": KIND_ROTATION,
    "Matrix": KIND_MATRIX,
    "Geometry": KIND_GEOMETRY,
}

# ---------------------------------------------------------------- 分布类型

DIST_FLOAT = "float"
DIST_INT = "int"
DIST_CATEGORICAL = "categorical"

# ---------------------------------------------------------------- 数据结构


@dataclass(frozen=True)
class Component:
    """一个可采样的标量维度，对应 Optuna 的一次 suggest_*。"""

    key: str
    type: str
    low: float | None = None
    high: float | None = None
    step: float | None = None
    log: bool = False
    choices: Tuple[Any, ...] = ()


@dataclass(frozen=True)
class ParamSpec:
    """一个 Blender socket 的完整描述，可能展开成多个 Component。

    node 为空表示沿用目标节点（老配置）；多节点时每个参数都带自己的节点名。
    key 是 Optuna 里的唯一名（单节点时等于 identifier，多节点时是 "节点.identifier"）。
    """

    key: str
    label: str
    identifier: str
    kind: str
    components: Tuple[Component, ...] = ()
    fixed: bool = False
    default: Any = None
    node: str | None = None


@dataclass(frozen=True)
class SearchSpace:
    """一次实验的完整搜索空间。"""

    params: Tuple[ParamSpec, ...]

    def components(self) -> Iterator[Tuple[ParamSpec, Component]]:
        """按参数顺序展开所有可采样维度。"""
        for param in self.params:
            for component in param.components:
                yield param, component

    def component_keys(self) -> list[str]:
        return [component.key for _, component in self.components()]
