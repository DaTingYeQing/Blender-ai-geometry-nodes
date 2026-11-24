# -*- coding: utf-8 -*-
"""翻译官：只做数据转换，不做 I/O，不 import bpy / optuna。

两个方向：

1. Blender → Optuna
   ``schema_to_space()`` 把 socket 描述翻成搜索空间；
   ``sample()`` 用 Optuna 的 trial 采一轮原始值（鸭子类型，不 import optuna）。

2. Optuna → Blender
   ``pack_values()`` / ``raw_to_packed()`` 把原始值翻成可 JSON 传输的打包值；
   ``packed_to_native()`` 在 Blender 里把打包值翻成可直接赋给 socket 的对象。

反方向（读当前值、调试、坐标轮换）用 ``packed_to_raw()`` / ``native_to_packed()``。

约定：
- 角度对外一律用"度"；只有 packed_to_native 时转弧度。
- 颜色对外用 RGB；打包时补 alpha（默认 1.0），只有声明 include_alpha 时才采 R/G/B/A 四通道。
- 矩阵拆成 平移 3 + 旋转 3 + 缩放 3，共 9 个维度，绝不直接搜 16 维。
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Sequence, Tuple

from .contract import (
    Component,
    DIST_CATEGORICAL,
    DIST_FLOAT,
    DIST_INT,
    KIND_BOOL,
    KIND_COLOR,
    KIND_FIXED,
    KIND_FLOAT,
    KIND_GEOMETRY,
    KIND_INT,
    KIND_MATRIX,
    KIND_ROTATION,
    KIND_VECTOR,
    OUTPUT_ATTRIBUTE,
    OUTPUT_KINDS,
    OUTPUT_MESH_STAT,
    OutputSpec,
    ParamSpec,
    SOCKET_TO_KIND,
    SearchSpace,
)


class TranslationError(ValueError):
    """字段对不上、缺值、类型不支持时抛出。"""


@dataclass(frozen=True)
class TranslateOptions:
    """socket 没有给范围时的兜底值。"""

    float_low: float = -1.0
    float_high: float = 1.0
    int_low: int = 0
    int_high: int = 100
    vector_low: float = -1.0
    vector_high: float = 1.0
    rotation_low: float = -180.0
    rotation_high: float = 180.0
    matrix_translation_low: float = -1.0
    matrix_translation_high: float = 1.0
    matrix_scale_low: float = 0.01
    matrix_scale_high: float = 10.0
    matrix_scale_log: bool = True
    include_alpha: bool = False


# ============================================================ 一、Blender → 搜索空间

# 长前缀在前，避免短的抢先命中。
_BASE_ORDER = (
    "Geometry", "Collection", "Material", "Rotation", "Texture",
    "Closure", "Bundle", "Matrix", "String", "Object", "Shader",
    "Vector", "Color", "Bool", "Int", "Float",
)


def socket_base_type(bl_idname: str) -> str:
    """NodeSocketVectorTranslation / RGBA / FLOAT 等 → Float / Vector / Color。

    接受完整 idname、接口的 socket_type 大写枚举，或裸类型名。
    """
    raw = str(bl_idname or "").strip()
    if raw.startswith("NodeSocket"):
        raw = raw[len("NodeSocket"):]
    if not raw:
        return ""
    if raw in ("RGBA", "Color") or raw.startswith(("Color", "ByteColor")):
        return "Color"
    if raw in ("BOOL", "BOOLEAN") or raw.startswith("Bool"):
        return "Bool"
    if raw in ("INT", "INTEGER") or raw.startswith("Int"):
        return "Int"
    if raw in ("FLOAT",) or raw.startswith("Float"):
        return "Float"
    for base in _BASE_ORDER:
        if raw.startswith(base):
            return base
    return raw


def schema_to_space(
    sockets: Iterable[Mapping[str, Any]],
    options: TranslateOptions | None = None,
    *,
    outputs: Iterable[Mapping[str, Any]] | None = None,
) -> Tuple[SearchSpace, list[str]]:
    """把 Blender 侧读到的 socket 描述转成搜索空间。

    每个 socket 是一个 dict，字段：
        name / label          显示名（中文、带空格都可以）
        identifier / id       稳定 ID，如 "Socket_1"（推荐用这个做参数名）
        socket_type / bl_idname   如 "NodeSocketFloat" 或 "FLOAT"
        min / min_value       数值下限，可缺省
        max / max_value       数值上限，可缺省
        default / default_value   默认值，可缺省
        linked / is_linked    是否已连线，已连线的不参与搜索

    返回 (SearchSpace, warnings)。不支持的 socket 不会静默丢弃，会记在 warnings 里。
    """
    opt = options or TranslateOptions()
    warnings: list[str] = []
    params: list[ParamSpec] = []
    used: set[str] = set()

    for index, socket in enumerate(sockets or ()):
        if not isinstance(socket, Mapping):
            warnings.append("第 %d 个 socket 不是字典，已跳过" % index)
            continue

        label = _text(_pick(socket, "name", "label"))
        identifier = _text(_pick(socket, "identifier", "id"))
        if not identifier:
            identifier = "param_%d" % index
            warnings.append("socket %r 没有 identifier，改用 %s" % (label or index, identifier))
        identifier = _unique(identifier, used, warnings)
        label = label or identifier

        default = _pick(socket, "default", "default_value")
        base = socket_base_type(_pick(socket, "socket_type", "bl_idname", default=""))
        kind = SOCKET_TO_KIND.get(base)

        if _pick(socket, "linked", "is_linked", default=False):
            params.append(_fixed(identifier, label, kind or KIND_FIXED, default))
            warnings.append("%s 已连线，不参与搜索" % label)
            continue

        if kind is None:
            params.append(_fixed(identifier, label, KIND_FIXED, default))
            warnings.append("%s 的类型 %s 不支持，固定为常量" % (label, base or "未知"))
            continue

        if kind == KIND_GEOMETRY:
            params.append(_fixed(identifier, label, KIND_GEOMETRY, default))
            continue

        if kind == KIND_FLOAT:
            low, high = _bounds(socket, opt.float_low, opt.float_high, label, warnings, "浮点")
            if low >= high:
                params.append(_fixed(identifier, label, kind, default))
                warnings.append("%s 的下限不小于上限，固定为常量" % label)
                continue
            params.append(_param(identifier, label, kind, default, [
                Component(key=identifier, type=DIST_FLOAT, low=low, high=high),
            ]))
            continue

        if kind == KIND_INT:
            low, high = _bounds(socket, opt.int_low, opt.int_high, label, warnings, "整数")
            low, high = int(round(low)), int(round(high))
            if low >= high:
                params.append(_fixed(identifier, label, kind, default))
                warnings.append("%s 的整数范围无效，固定为常量" % label)
                continue
            params.append(_param(identifier, label, kind, default, [
                Component(key=identifier, type=DIST_INT, low=low, high=high, step=1),
            ]))
            continue

        if kind == KIND_BOOL:
            params.append(_param(identifier, label, kind, default, [
                Component(key=identifier, type=DIST_CATEGORICAL, choices=(True, False)),
            ]))
            continue

        if kind == KIND_VECTOR:
            low, high = _bounds(socket, opt.vector_low, opt.vector_high, label, warnings, "矢量")
            if low >= high:
                params.append(_fixed(identifier, label, kind, default))
                warnings.append("%s 的矢量范围无效，固定为常量" % label)
                continue
            params.append(_param(identifier, label, kind, default, [
                Component(key="%s.%s" % (identifier, axis), type=DIST_FLOAT, low=low, high=high)
                for axis in "xyz"
            ]))
            continue

        if kind == KIND_COLOR:
            channels = "rgba" if opt.include_alpha else "rgb"
            params.append(_param(identifier, label, kind, default, [
                Component(key="%s.%s" % (identifier, channel), type=DIST_FLOAT, low=0.0, high=1.0)
                for channel in channels
            ]))
            continue

        if kind == KIND_ROTATION:
            params.append(_param(identifier, label, kind, default, [
                Component(key="%s.%s" % (identifier, axis), type=DIST_FLOAT,
                          low=opt.rotation_low, high=opt.rotation_high)
                for axis in "xyz"
            ]))
            continue

        if kind == KIND_MATRIX:
            axes = (
                ("tx", opt.matrix_translation_low, opt.matrix_translation_high, False),
                ("ty", opt.matrix_translation_low, opt.matrix_translation_high, False),
                ("tz", opt.matrix_translation_low, opt.matrix_translation_high, False),
                ("rx", opt.rotation_low, opt.rotation_high, False),
                ("ry", opt.rotation_low, opt.rotation_high, False),
                ("rz", opt.rotation_low, opt.rotation_high, False),
                ("sx", opt.matrix_scale_low, opt.matrix_scale_high, opt.matrix_scale_log),
                ("sy", opt.matrix_scale_low, opt.matrix_scale_high, opt.matrix_scale_log),
                ("sz", opt.matrix_scale_low, opt.matrix_scale_high, opt.matrix_scale_log),
            )
            params.append(_param(identifier, label, kind, default, [
                Component(key="%s.%s" % (identifier, suffix), type=DIST_FLOAT,
                          low=low, high=high, log=log)
                for suffix, low, high, log in axes
            ]))
            continue

        params.append(_fixed(identifier, label, KIND_FIXED, default))
        warnings.append("%s 的类型 %s 暂不支持，固定为常量" % (label, base or "未知"))

    output_specs, output_warnings = outputs_to_specs(outputs or ())
    warnings.extend(output_warnings)
    return SearchSpace(params=tuple(params), outputs=output_specs), warnings


def outputs_to_specs(
    entries: Iterable[Mapping[str, Any]],
) -> Tuple[Tuple[OutputSpec, ...], list[str]]:
    """输出描述 → OutputSpec 列表。"""
    warnings: list[str] = []
    specs: list[OutputSpec] = []
    used: set[str] = set()

    for index, entry in enumerate(entries or ()):
        if not isinstance(entry, Mapping):
            warnings.append("第 %d 个输出不是字典，已跳过" % index)
            continue
        label = _text(_pick(entry, "name", "label"))
        key = _text(_pick(entry, "key")) or label or "output_%d" % index
        key = _unique(key, used, warnings)
        label = label or key
        kind = _text(_pick(entry, "kind"))

        if kind not in OUTPUT_KINDS:
            raise TranslationError("输出 %r 的 kind 必须是 %s" % (key, " / ".join(OUTPUT_KINDS)))

        stat = _text(_pick(entry, "stat"))
        attribute = _text(_pick(entry, "attribute", "attr"))
        attribute_type = _text(_pick(entry, "attribute_type", "attr_type")) or None

        if kind == OUTPUT_MESH_STAT and not stat:
            raise TranslationError("输出 %r 是 mesh_stat，但没有给 stat" % key)
        if kind == OUTPUT_ATTRIBUTE and not attribute:
            raise TranslationError("输出 %r 是 attribute，但没有给 attribute 名" % key)

        specs.append(OutputSpec(
            key=key,
            label=label,
            kind=kind,
            stat=stat or None,
            attribute=attribute or None,
            attribute_type=attribute_type,
        ))

    return tuple(specs), warnings


# ============================================================ 二、Optuna → 原始值


def sample(trial: Any, space: SearchSpace) -> dict[str, Any]:
    """用 Optuna 的 trial 采一整轮，返回原始值 dict。

    这里用鸭子类型，不 import optuna：只要 trial 有 suggest_float / suggest_int /
    suggest_categorical 就能用，测试时可以传假对象。
    """
    raw: dict[str, Any] = {}
    for _, component in space.components():
        if component.type == DIST_FLOAT:
            raw[component.key] = trial.suggest_float(
                component.key,
                component.low,
                component.high,
                step=component.step,
                log=component.log,
            )
        elif component.type == DIST_INT:
            raw[component.key] = trial.suggest_int(
                component.key,
                int(component.low),
                int(component.high),
                step=int(component.step or 1),
                log=component.log,
            )
        elif component.type == DIST_CATEGORICAL:
            raw[component.key] = trial.suggest_categorical(
                component.key, list(component.choices)
            )
        else:
            raise TranslationError("未知的分布类型 %r（参数 %s）" % (component.type, component.key))
    return raw


def pack_values(space: SearchSpace, raw: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """整轮原始值 → {socket identifier: 打包值}。"""
    packed: dict[str, dict[str, Any]] = {}
    for param in space.params:
        if param.fixed:
            continue
        packed[param.identifier] = raw_to_packed(param, raw)
    return packed


# ============================================================ 三、原始值 ↔ 打包值


def raw_to_packed(spec: ParamSpec, raw: Mapping[str, Any]) -> dict[str, Any]:
    """原始值（Optuna 采样结果）→ 可 JSON 传输的打包值。"""
    if spec.fixed:
        raise TranslationError("参数 %s 是固定字段，不能采样" % spec.label)

    keys = _suffix_map(spec)

    if spec.kind == KIND_FLOAT:
        return {"kind": spec.kind, "value": float(_need(raw, spec.key))}

    if spec.kind == KIND_INT:
        return {"kind": spec.kind, "value": int(_need(raw, spec.key))}

    if spec.kind == KIND_BOOL:
        return {"kind": spec.kind, "value": bool(_need(raw, spec.key))}

    if spec.kind == KIND_VECTOR:
        return {"kind": spec.kind, "value": [
            float(_need(raw, _component_key(keys, axis, spec))) for axis in "xyz"
        ]}

    if spec.kind == KIND_COLOR:
        rgba = [float(_need(raw, _component_key(keys, channel, spec))) for channel in "rgb"]
        alpha_key = keys.get("a")
        rgba.append(float(_need(raw, alpha_key)) if alpha_key else 1.0)
        return {"kind": spec.kind, "rgba": rgba}

    if spec.kind == KIND_ROTATION:
        return {"kind": spec.kind, "euler_xyz_deg": [
            float(_need(raw, _component_key(keys, axis, spec))) for axis in "xyz"
        ]}

    if spec.kind == KIND_MATRIX:
        return {
            "kind": spec.kind,
            "translation": [
                float(_need(raw, _component_key(keys, suffix, spec)))
                for suffix in ("tx", "ty", "tz")
            ],
            "rotation_xyz_deg": [
                float(_need(raw, _component_key(keys, suffix, spec)))
                for suffix in ("rx", "ry", "rz")
            ],
            "scale": [
                float(_need(raw, _component_key(keys, suffix, spec)))
                for suffix in ("sx", "sy", "sz")
            ],
        }

    raise TranslationError("参数 %s 的类型 %r 不能打包" % (spec.label, spec.kind))


def packed_to_raw(spec: ParamSpec, packed: Mapping[str, Any]) -> dict[str, Any]:
    """打包值 → 原始值。用于读回、调试和往返测试。"""
    kind = packed.get("kind")
    if kind != spec.kind:
        raise TranslationError("打包值类型 %r 与参数 %s 的类型 %r 不一致"
                               % (kind, spec.label, spec.kind))

    keys = _suffix_map(spec)

    if spec.kind in (KIND_FLOAT, KIND_INT, KIND_BOOL):
        return {spec.key: packed["value"]}

    if spec.kind == KIND_VECTOR:
        return {_component_key(keys, axis, spec): float(value)
                for axis, value in zip("xyz", packed["value"])}

    if spec.kind == KIND_COLOR:
        raw = {_component_key(keys, channel, spec): float(value)
               for channel, value in zip("rgb", packed["rgba"][:3])}
        if "a" in keys:
            raw[keys["a"]] = float(packed["rgba"][3])
        return raw

    if spec.kind == KIND_ROTATION:
        return {_component_key(keys, axis, spec): float(value)
                for axis, value in zip("xyz", packed["euler_xyz_deg"])}

    if spec.kind == KIND_MATRIX:
        raw: dict[str, Any] = {}
        for suffix, value in zip(("tx", "ty", "tz"), packed["translation"]):
            raw[_component_key(keys, suffix, spec)] = float(value)
        for suffix, value in zip(("rx", "ry", "rz"), packed["rotation_xyz_deg"]):
            raw[_component_key(keys, suffix, spec)] = float(value)
        for suffix, value in zip(("sx", "sy", "sz"), packed["scale"]):
            raw[_component_key(keys, suffix, spec)] = float(value)
        return raw

    raise TranslationError("参数 %s 的类型 %r 不能还原" % (spec.label, spec.kind))


# ============================================================ 四、打包值 ↔ Blender 原生


def packed_to_native(packed: Mapping[str, Any]) -> Any:
    """打包值 → 可直接赋给 socket 的对象。只能在 Blender 里调用。"""
    mathutils = _mathutils()
    kind = packed.get("kind")

    if kind in (KIND_FLOAT, KIND_INT, KIND_BOOL):
        return packed["value"]

    if kind == KIND_VECTOR:
        return mathutils.Vector([float(value) for value in packed["value"]])

    if kind == KIND_COLOR:
        return tuple(float(value) for value in packed["rgba"])

    if kind == KIND_ROTATION:
        degrees = packed["euler_xyz_deg"]
        return mathutils.Euler([math.radians(float(degree)) for degree in degrees], "XYZ")

    if kind == KIND_MATRIX:
        translation = mathutils.Vector([float(value) for value in packed["translation"]])
        rotation = mathutils.Euler(
            [math.radians(float(degree)) for degree in packed["rotation_xyz_deg"]], "XYZ"
        )
        scale = mathutils.Vector([float(value) for value in packed["scale"]])
        return mathutils.Matrix.LocRotScale(translation, rotation, scale)

    raise TranslationError("打包值类型 %r 不能转成 Blender 原生值" % (kind,))


def native_to_packed(kind: str, native: Any) -> dict[str, Any]:
    """Blender 原生值 → 打包值。只能在 Blender 里调用。"""
    if kind in (KIND_FLOAT, KIND_INT, KIND_BOOL):
        return {"kind": kind, "value": native}

    if kind == KIND_VECTOR:
        return {"kind": kind, "value": [float(value) for value in native]}

    if kind == KIND_COLOR:
        rgba = [float(value) for value in native]
        if len(rgba) == 3:
            rgba.append(1.0)
        return {"kind": kind, "rgba": rgba}

    if kind == KIND_ROTATION:
        euler = native.to_euler("XYZ") if hasattr(native, "to_euler") else native
        return {"kind": kind, "euler_xyz_deg": [
            math.degrees(float(angle)) for angle in euler
        ]}

    if kind == KIND_MATRIX:
        translation, rotation, scale = native.decompose()
        euler = rotation.to_euler("XYZ")
        return {
            "kind": kind,
            "translation": [float(value) for value in translation],
            "rotation_xyz_deg": [math.degrees(float(angle)) for angle in euler],
            "scale": [float(value) for value in scale],
        }

    raise TranslationError("类型 %r 不能从 Blender 原生值打包" % (kind,))


# ============================================================ 五、校验


def validate_space(space: SearchSpace) -> list[str]:
    """检查搜索空间本身是否合法，返回错误列表（空列表表示通过）。"""
    errors: list[str] = []
    seen: set[str] = set()

    for param in space.params:
        if param.fixed:
            continue
        if not param.components:
            errors.append("参数 %s 可搜索但没有展开出任何维度" % param.label)
            continue

        for component in param.components:
            if component.key in seen:
                errors.append("参数键重复：%s" % component.key)
            seen.add(component.key)

            if component.type == DIST_FLOAT:
                if component.low is None or component.high is None:
                    errors.append("%s 缺少上下限" % component.key)
                    continue
                if not float(component.low) < float(component.high):
                    errors.append("%s 的下限不小于上限" % component.key)
                if component.log and float(component.low) <= 0:
                    errors.append("%s 开对数但下限不大于 0" % component.key)
                if component.log and component.step is not None:
                    errors.append("%s 不能同时开对数和使用步长" % component.key)

            elif component.type == DIST_INT:
                if component.low is None or component.high is None:
                    errors.append("%s 缺少上下限" % component.key)
                    continue
                if not int(component.low) <= int(component.high):
                    errors.append("%s 的整数下限大于上限" % component.key)
                if component.step is not None and int(component.step) < 1:
                    errors.append("%s 的步长必须是正整数" % component.key)
                if component.log and int(component.low) < 1:
                    errors.append("%s 开对数但下限小于 1" % component.key)

            elif component.type == DIST_CATEGORICAL:
                if not component.choices:
                    errors.append("%s 没有任何可选项" % component.key)
                    continue
                try:
                    unique = set(component.choices)
                except TypeError:
                    errors.append("%s 的选项里有不可哈希的值" % component.key)
                else:
                    if len(unique) != len(component.choices):
                        errors.append("%s 的选项有重复" % component.key)

            else:
                errors.append("%s 的分布类型 %r 未知" % (component.key, component.type))

    return errors


# ============================================================ 内部工具


def _pick(mapping: Mapping[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        value = mapping.get(name)
        if value is not None:
            return value
    return default


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _finite(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _bounds(
    socket: Mapping[str, Any],
    fallback_low: float,
    fallback_high: float,
    label: str,
    warnings: list[str],
    kind_name: str,
) -> Tuple[float, float]:
    low = _pick(socket, "min", "min_value")
    high = _pick(socket, "max", "max_value")

    if _finite(low):
        low = float(low)
    else:
        low = float(fallback_low)
        warnings.append("%s 没有%s下限，用兜底值 %s" % (label, kind_name, low))

    if _finite(high):
        high = float(high)
    else:
        high = float(fallback_high)
        warnings.append("%s 没有%s上限，用兜底值 %s" % (label, kind_name, high))

    return low, high


def _unique(key: str, used: set[str], warnings: list[str]) -> str:
    if key not in used:
        used.add(key)
        return key
    base = key
    index = 2
    while key in used:
        key = "%s_%d" % (base, index)
        index += 1
    used.add(key)
    warnings.append("键 %s 重复，改用 %s" % (base, key))
    return key


def _fixed(identifier: str, label: str, kind: str, default: Any) -> ParamSpec:
    return ParamSpec(
        key=identifier,
        label=label,
        identifier=identifier,
        kind=kind,
        components=(),
        fixed=True,
        default=default,
    )


def _param(
    identifier: str,
    label: str,
    kind: str,
    default: Any,
    components: Sequence[Component],
) -> ParamSpec:
    return ParamSpec(
        key=identifier,
        label=label,
        identifier=identifier,
        kind=kind,
        components=tuple(components),
        fixed=False,
        default=default,
    )


def _suffix_map(spec: ParamSpec) -> dict[str, str]:
    """分量后缀 → 完整参数键。标量参数返回 {"" : key}。"""
    mapping: dict[str, str] = {}
    for component in spec.components:
        suffix = component.key.rsplit(".", 1)[-1] if "." in component.key else ""
        mapping[suffix] = component.key
    return mapping


def _component_key(mapping: Mapping[str, str], suffix: str, spec: ParamSpec) -> str:
    key = mapping.get(suffix)
    if key is None:
        raise TranslationError("参数 %s 缺少分量 %r" % (spec.label, suffix))
    return key


def _need(raw: Mapping[str, Any], key: str) -> Any:
    if key not in raw:
        raise TranslationError("缺少参数 %r（现有：%s）" % (key, ", ".join(sorted(raw))))
    return raw[key]


def _mathutils() -> Any:
    try:
        import mathutils  # 只有 Blender 里有
    except ImportError as exc:  # pragma: no cover - 取决于运行环境
        raise TranslationError("这个函数只能在 Blender 里调用（缺少 mathutils）") from exc
    return mathutils
