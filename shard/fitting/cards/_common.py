# -*- coding: utf-8 -*-
"""卡片共用工具：从 socket 展开基础参数、合并配置覆盖、打包。

卡片只负责"某一种值类型"的规则；真正的数据展开沿用 translator，
保证和 Blender 端的 packed_to_native 是同一套实现。
"""

from __future__ import annotations

from .. import translator as tr
from ..contract import DIST_FLOAT, Component, ParamSpec
from ..errors import ConfigError


def param_from_socket(socket: dict) -> ParamSpec:
    """一个 socket 描述 → 基础 ParamSpec（范围来自 socket 或 translator 兜底）。"""
    space, _warnings = tr.schema_to_space([socket])
    if len(space.params) != 1:
        raise ConfigError("socket %r 无法展开成参数" % (socket.get("identifier"),))
    param = space.params[0]
    if param.fixed:
        raise ConfigError(
            "输入 %r 是固定字段（已连线 / 几何 / 不支持的类型），不能参与搜索"
            % param.identifier
        )
    return param


def param_with(param: ParamSpec, components) -> ParamSpec:
    return ParamSpec(
        key=param.key,
        label=param.label,
        identifier=param.identifier,
        kind=param.kind,
        components=tuple(components),
        fixed=False,
        default=param.default,
        node=param.node,
    )


def expand_compound(param: ParamSpec, spec: dict) -> tuple[Component, ...]:
    """复合类型：顶层 min/max/step/log 作默认，components 按分量覆盖。"""
    overrides = spec.get("components") or {}
    expected = [component.key.rsplit(".", 1)[-1] for component in param.components]
    unknown = sorted(set(overrides) - set(expected))
    if unknown:
        raise ConfigError(
            "%s 没有分量 %s（可用：%s）"
            % (param.identifier, ", ".join(unknown), ", ".join(expected))
        )

    components = []
    for component in param.components:
        suffix = component.key.rsplit(".", 1)[-1]
        override = overrides.get(suffix) or {}
        low = override.get("min", spec.get("min"))
        high = override.get("max", spec.get("max"))
        step = override.get("step", spec.get("step"))
        log = override.get("log", spec.get("log"))
        if low is None:
            low = component.low
        if high is None:
            high = component.high
        if step is None:
            step = component.step
        if log is None:
            log = component.log

        name = "%s.%s" % (param.identifier, suffix)
        low, high = float(low), float(high)
        if low >= high:
            raise ConfigError("%s 的 min 必须小于 max" % name)
        if log and low <= 0:
            raise ConfigError("%s 开了 log，min 必须大于 0" % name)
        if log and step is not None:
            raise ConfigError("%s 不能同时开 log 和给 step" % name)
        components.append(
            Component(
                key=component.key,
                type=DIST_FLOAT,
                low=low,
                high=high,
                step=step,
                log=bool(log),
            )
        )
    return tuple(components)


def pack(param: ParamSpec, raw: dict) -> dict:
    return tr.raw_to_packed(param, raw)
