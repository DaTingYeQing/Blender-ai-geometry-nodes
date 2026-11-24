# -*- coding: utf-8 -*-
"""配置：JSON 单子 → 校验结果 → 搜索空间。

单子结构（开头必须有 node，它也是默认的输入节点/输出节点）：

    {
      "blend": "...", "object": "...", "modifier": "...", "node": "...",
      "inputs":  [{"identifier": "...", "min": .., "max": ..},
                  {"node": "别的节点", "identifier": "...", "min": .., "max": ..}],
      "fixed":   [{"node": "上游模块节点", "identifier": "...", "value": 2.0}],
      "outputs": ["volume", "area", "is_watertight"],
      "loss":    {"targets": {"volume": 1.0}, "weights": {"volume": 1.0}},
      "budget":  {"max_trials": 100, "target_loss": 0.01}
    }

inputs 每项可写 node（省略 = 顶层 node）；顶层 node 始终是“从哪个节点导出几何”。
fixed 是把某些输入写死、不参与搜索（每轮求值前写回），用于锁住上游模块的参数；
同一 (node, identifier) 不能既在 inputs 又在 fixed。
输出只认网格字段（字段名来自 meshkit：volume / area / extents / ...）；
每轮求值在 Blender 里导出 PLY，再由引擎侧算这些字段。
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import replace
from typing import Any

from . import cards as cards_mod
from . import translator as tr
from .cards import _common as cards_common
from .contract import (
    KIND_BOOL,
    KIND_COLOR,
    KIND_FLOAT,
    KIND_INT,
    KIND_MATRIX,
    KIND_ROTATION,
    KIND_VECTOR,
    SearchSpace,
)
from .errors import ConfigError

MESH_STATS_HINT = "mesh 统计方法待定（bbox、水密等由后续设计，stat 先留空）"


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ConfigError("配置文件的顶层需要是 JSON 对象")
    return data


# ------------------------------------------------------------------ 校验


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError("%s 需要是数字，收到 %r" % (name, value))
    number = float(value)
    if not math.isfinite(number):
        raise ConfigError("%s 需要是有限数字，收到 %r" % (name, value))
    return number


def _validate_inputs(value: Any, default_node: str) -> list[dict]:
    if not isinstance(value, list):
        raise ConfigError("inputs 需要是数组（可以是空数组，表示只观察不搜索）")
    entries = []
    seen = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ConfigError("inputs[%d] 需要是对象" % index)
        identifier = _text(item.get("identifier"))
        if not identifier:
            raise ConfigError("inputs[%d] 缺少 identifier" % index)
        node = _text(item.get("node")) or default_node
        key = (node, identifier)
        if key in seen:
            raise ConfigError(
                "inputs 里节点 %s 的 identifier 重复：%s" % (node, identifier)
            )
        seen.add(key)
        entry = {"identifier": identifier, "node": node}

        if "choices" in item:
            choices = item["choices"]
            if not isinstance(choices, list) or not choices:
                raise ConfigError("%s 的 choices 需要是非空数组" % identifier)
            for choice in choices:
                if isinstance(choice, (dict, list)):
                    raise ConfigError("%s 的 choices 里只能是标量" % identifier)
            entry["choices"] = tuple(choices)
            entries.append(entry)
            continue

        if item.get("min") is None and item.get("max") is None:
            entry.update(min=None, max=None)
        else:
            if item.get("min") is None or item.get("max") is None:
                raise ConfigError("%s 需要同时给 min 和 max（或改用 choices）" % identifier)
            low = _number(item.get("min"), "%s.min" % identifier)
            high = _number(item.get("max"), "%s.max" % identifier)
            if low >= high:
                raise ConfigError("%s 的 min 必须小于 max" % identifier)
            entry.update(min=low, max=high)

        entry["log"] = bool(item["log"]) if "log" in item else None
        step = item.get("step")
        if step is not None:
            step = _number(step, "%s.step" % identifier)
            if step <= 0:
                raise ConfigError("%s 的 step 必须大于 0" % identifier)
        entry["step"] = step
        entry["components"] = _validate_components(item.get("components"), identifier)
        entries.append(entry)
    return entries


def _validate_fixed(value: Any, default_node: str, inputs: list[dict]) -> list[dict]:
    """fixed：每轮写死、不参与搜索的节点输入。"""
    if value is None:
        return []
    if not isinstance(value, list):
        raise ConfigError("fixed 需要是数组")

    search = {(item["node"], item["identifier"]) for item in inputs}
    entries = []
    seen = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ConfigError("fixed[%d] 需要是对象" % index)
        identifier = _text(item.get("identifier"))
        if not identifier:
            raise ConfigError("fixed[%d] 缺少 identifier" % index)
        node = _text(item.get("node")) or default_node
        key = (node, identifier)
        if key in seen:
            raise ConfigError(
                "fixed 里节点 %s 的 identifier 重复：%s" % (node, identifier)
            )
        if key in search:
            raise ConfigError(
                "节点 %s 的输入 %s 同时出现在 inputs 和 fixed；要么搜索，要么定死"
                % (node, identifier)
            )
        if "value" not in item:
            raise ConfigError("fixed[%d] 缺少 value（%s）" % (index, identifier))
        if item["value"] is None:
            raise ConfigError("fixed[%d] 的 value 不能是 null（%s）" % (index, identifier))
        seen.add(key)
        entries.append(
            {"node": node, "identifier": identifier, "value": item["value"]}
        )
    return entries


def _axis_values(value: Any, name: str, axes: str) -> list[float]:
    if isinstance(value, dict):
        missing = [axis for axis in axes if axis not in value]
        if missing:
            raise ConfigError("%s 缺少分量 %s" % (name, ", ".join(missing)))
        return [_number(value[axis], "%s.%s" % (name, axis)) for axis in axes]
    if isinstance(value, (list, tuple)) and len(value) == len(axes):
        return [_number(item, "%s[%d]" % (name, i)) for i, item in enumerate(value)]
    raise ConfigError(
        "%s 需要 %d 个分量（数组或 {%s}）" % (name, len(axes), ",".join(axes))
    )


def _color_values(value: Any, name: str) -> list[float]:
    if isinstance(value, dict):
        missing = [axis for axis in "rgb" if axis not in value]
        if missing:
            raise ConfigError("%s 缺少分量 %s" % (name, ", ".join(missing)))
        values = [_number(value[axis], "%s.%s" % (name, axis)) for axis in "rgb"]
        if "a" in value:
            values.append(_number(value["a"], name + ".a"))
        return values
    if isinstance(value, (list, tuple)) and len(value) in (3, 4):
        return [_number(item, "%s[%d]" % (name, i)) for i, item in enumerate(value)]
    raise ConfigError("%s 需要 [r,g,b] 或 [r,g,b,a]，收到 %r" % (name, value))


def _matrix_values(value: Any, name: str) -> list[float]:
    axes = ("tx", "ty", "tz", "rx", "ry", "rz", "sx", "sy", "sz")
    if isinstance(value, dict):
        if all(key in value for key in ("translation", "rotation_xyz_deg", "scale")):
            return (
                _axis_values(value["translation"], name + ".translation", "xyz")
                + _axis_values(value["rotation_xyz_deg"], name + ".rotation_xyz_deg", "xyz")
                + _axis_values(value["scale"], name + ".scale", "xyz")
            )
        if all(key in value for key in axes):
            return [_number(value[key], "%s.%s" % (name, key)) for key in axes]
        raise ConfigError(
            "%s 需要 translation/rotation_xyz_deg/scale，或 %s"
            % (name, ", ".join(axes))
        )
    if isinstance(value, (list, tuple)) and len(value) == 9:
        return [_number(item, "%s[%d]" % (name, i)) for i, item in enumerate(value)]
    raise ConfigError("%s 需要 9 个分量（数组或按 tx..sz 的字典）" % name)


def _fixed_raw(param, value: Any) -> dict:
    """工具侧的固定值 → raw_to_packed 要的原始键值。"""
    name = param.identifier
    kind = param.kind

    if kind == KIND_FLOAT:
        return {param.key: _number(value, name)}
    if kind == KIND_INT:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ConfigError("%s 需要是整数，收到 %r" % (name, value))
        if isinstance(value, float):
            if not value.is_integer():
                raise ConfigError("%s 需要是整数，收到 %r" % (name, value))
            value = int(value)
        return {param.key: value}
    if kind == KIND_BOOL:
        if not isinstance(value, bool):
            raise ConfigError("%s 需要是布尔值，收到 %r" % (name, value))
        return {param.key: value}
    if kind == KIND_VECTOR:
        values = _axis_values(value, name, "xyz")
        return {"%s.%s" % (param.key, axis): values[i] for i, axis in enumerate("xyz")}
    if kind == KIND_COLOR:
        values = _color_values(value, name)
        raw = {"%s.%s" % (param.key, ch): values[i] for i, ch in enumerate("rgb")}
        has_alpha = any(
            component.key.rsplit(".", 1)[-1] == "a" for component in param.components
        )
        if len(values) == 4:
            if not has_alpha:
                raise ConfigError("%s 没有 alpha 分量，请给 [r,g,b]" % name)
            raw["%s.a" % param.key] = values[3]
        return raw
    if kind == KIND_ROTATION:
        values = _axis_values(value, name, "xyz")
        return {"%s.%s" % (param.key, axis): values[i] for i, axis in enumerate("xyz")}
    if kind == KIND_MATRIX:
        values = _matrix_values(value, name)
        axes = ("tx", "ty", "tz", "rx", "ry", "rz", "sx", "sy", "sz")
        return {"%s.%s" % (param.key, axis): values[i] for i, axis in enumerate(axes)}

    raise ConfigError("fixed 输入 %s 的类型 %s 不支持写默认值" % (name, kind))


def _validate_components(value: Any, identifier: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict) or not value:
        raise ConfigError("%s 的 components 需要是非空对象" % identifier)
    clean = {}
    for suffix, spec in value.items():
        name = "%s.components.%s" % (identifier, suffix)
        if not isinstance(spec, dict):
            raise ConfigError("%s 需要是对象" % name)
        unknown = set(spec) - {"min", "max", "step", "log"}
        if unknown:
            raise ConfigError("%s 里有未知字段：%s" % (name, ", ".join(sorted(unknown))))
        item = {}
        if ("min" in spec) != ("max" in spec):
            raise ConfigError("%s 需要同时给 min 和 max" % name)
        if "min" in spec:
            low = _number(spec["min"], name + ".min")
            high = _number(spec["max"], name + ".max")
            if low >= high:
                raise ConfigError("%s 的 min 必须小于 max" % name)
            item.update(min=low, max=high)
        if "step" in spec:
            step = _number(spec["step"], name + ".step")
            if step <= 0:
                raise ConfigError("%s 的 step 必须大于 0" % name)
            item["step"] = step
        if "log" in spec:
            item["log"] = bool(spec["log"])
        if not item:
            raise ConfigError("%s 是空的" % name)
        clean[str(suffix)] = item
    return clean


def _validate_fields(value: Any) -> list[str]:
    """outputs 现在只认网格字段：["volume", "area", "is_watertight", ...]。"""
    if not isinstance(value, list) or not value:
        raise ConfigError("outputs 需要是非空的网格字段数组，如 [\"volume\", \"area\"]")
    fields = []
    for index, item in enumerate(value):
        if not isinstance(item, str):
            raise ConfigError("outputs[%d] 需要是字段名字符串，收到 %r" % (index, item))
        name = _text(item)
        if not name:
            raise ConfigError("outputs[%d] 需要是字段名" % index)
        if name in fields:
            raise ConfigError("outputs 里字段重复：%s" % name)
        fields.append(name)
    return fields


def _target_allowed(name: str, fields: list[str]) -> bool:
    if name in fields:
        return True
    return any(name.startswith(field + ".") for field in fields)


def _validate_loss(value: Any, fields: list[str]) -> dict:
    if not isinstance(value, dict):
        raise ConfigError("loss 需要是对象，至少包含 targets")
    targets = value.get("targets")
    if not isinstance(targets, dict) or not targets:
        raise ConfigError("loss.targets 需要是非空对象")
    clean_targets = {}
    for key, target in targets.items():
        if not _target_allowed(str(key), fields):
            raise ConfigError(
                "loss.targets 引用了未声明的输出 %r（已声明：%s）"
                % (key, ", ".join(fields))
            )
        clean_targets[str(key)] = _number(target, "loss.targets.%s" % key)

    weights = value.get("weights") or {}
    if not isinstance(weights, dict):
        raise ConfigError("loss.weights 需要是对象")
    clean_weights = {}
    for key, weight in weights.items():
        if str(key) not in clean_targets:
            raise ConfigError("loss.weights 里有不做目标的输出 %r" % key)
        weight = _number(weight, "loss.weights.%s" % key)
        if weight < 0:
            raise ConfigError("loss.weights.%s 不能是负数" % key)
        clean_weights[str(key)] = weight
    return {"targets": clean_targets, "weights": clean_weights}


def _validate_budget(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ConfigError("budget 需要是对象")
    max_trials = value.get("max_trials", 100)
    if isinstance(max_trials, bool) or not isinstance(max_trials, int) or max_trials < 1:
        raise ConfigError("budget.max_trials 需要是正整数")

    timeout = value.get("timeout_s")
    if timeout is not None:
        timeout = _number(timeout, "budget.timeout_s")
        if timeout <= 0:
            raise ConfigError("budget.timeout_s 必须大于 0")

    target = value.get("target_loss")
    if target is not None:
        target = _number(target, "budget.target_loss")

    seed = value.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
        raise ConfigError("budget.seed 需要是整数")

    return {
        "max_trials": max_trials,
        "timeout_s": timeout,
        "target_loss": target,
        "seed": seed,
    }


def _resolve_storage(storage: Any, base_dir: str) -> Any:
    if storage is None or _text(storage) == "":
        return None
    value = _text(storage)

    journal_prefix = "journal://"
    if value.startswith(journal_prefix):
        from optuna.storages import JournalStorage
        from optuna.storages.journal import JournalFileBackend

        raw = value[len(journal_prefix):]
        if not raw:
            raise ConfigError("storage 的 journal:// 后面需要文件路径")
        if not os.path.isabs(raw):
            raw = os.path.abspath(os.path.join(base_dir, raw))
        return JournalStorage(JournalFileBackend(raw))

    prefix = "sqlite:///"
    if value.startswith(prefix) and not value.startswith(prefix + "/"):
        raw = value[len(prefix):]
        if raw and not os.path.isabs(raw):
            path = os.path.abspath(os.path.join(base_dir, raw))
            return prefix + path.replace(os.sep, "/")
    return value


# ------------------------------------------------------------------ 准备与搜索空间


def prepare(config: dict, base_dir: str = ".") -> dict:
    blend = _text(config.get("blend"))
    if not blend:
        raise ConfigError("缺少 blend")
    blend = os.path.abspath(os.path.join(base_dir, blend))

    object_name = _text(config.get("object"))
    modifier_name = _text(config.get("modifier"))
    node_name = _text(config.get("node"))
    if not object_name:
        raise ConfigError("缺少 object")
    if not modifier_name:
        raise ConfigError("缺少 modifier")
    if not node_name:
        raise ConfigError("缺少 node（节点树里的节点名）")

    inputs = _validate_inputs(config.get("inputs"), node_name)
    fixed = _validate_fixed(config.get("fixed"), node_name, inputs)
    fields = _validate_fields(config.get("outputs"))
    loss = _validate_loss(config.get("loss"), fields)
    budget = _validate_budget(config.get("budget") or {})
    storage = _resolve_storage(config.get("storage"), base_dir)
    study_name = _text(config.get("study_name")) or "fit"

    frame = config.get("frame")
    if frame is not None:
        if isinstance(frame, bool) or not isinstance(frame, int) or frame < 1:
            raise ConfigError("frame 需要是正整数")
        frame = int(frame)

    run_dir_value = config.get("run_dir", os.path.join("fit_runs", study_name))
    run_dir = None
    if run_dir_value not in (None, "", False):
        run_dir = os.path.abspath(os.path.join(base_dir, str(run_dir_value)))

    report = _text(config.get("report")) or None

    return {
        "blend": blend,
        "object": object_name,
        "modifier": modifier_name,
        "node": node_name,
        "inputs": inputs,
        "fixed": fixed,
        "fixed_packed": [],
        "input_nodes": sorted(
            {item["node"] for item in inputs} | {item["node"] for item in fixed}
        ),
        "outputs": fields,
        "frame": frame,
        "loss": loss,
        "budget": budget,
        "storage": storage,
        "study_name": study_name,
        "run_dir": run_dir,
        "report": report,
        "startup_timeout": _number(
            config.get("startup_timeout_s") or 180.0, "startup_timeout_s"
        ),
        "eval_timeout": _number(
            config.get("eval_timeout_s") or 300.0, "eval_timeout_s"
        ),
    }


def _bind_node(param, node: str, prefix: bool):
    """给参数补上节点名；多节点时把 key 改成 "节点.identifier"（分量同步改）。"""
    key = "%s.%s" % (node, param.key) if prefix else param.key
    components = []
    for component in param.components:
        old = component.key
        if old == param.key:
            new_key = key
        elif old.startswith(param.key + "."):
            new_key = key + old[len(param.key):]
        elif prefix:
            new_key = "%s.%s" % (node, old)
        else:
            new_key = old
        components.append(replace(component, key=new_key))
    return replace(param, key=key, components=tuple(components), node=node)


def build_space(prepared: dict, schema: dict):
    """按 schema 找 socket、按值类型加载卡片、生成搜索空间。

    多节点：schema["nodes"] 里每个节点一份 inputs，参数键加 "节点." 前缀；
    单节点（含老配置）：行为与原来完全一致。
    """
    node_schemas = schema.get("nodes") or {}
    if not node_schemas:
        node_schemas = {prepared["node"]: schema}

    prefix = len({item["node"] for item in prepared["inputs"]}) > 1
    pairs = []
    for spec in prepared["inputs"]:
        node_name = spec["node"]
        node_schema = node_schemas.get(node_name)
        if node_schema is None:
            raise ConfigError(
                "节点 %r 不在本次 schema 里（可用：%s）"
                % (node_name, ", ".join(sorted(node_schemas)))
            )
        inputs_by_id = {
            item["identifier"]: item for item in node_schema.get("inputs", [])
        }
        identifier = spec["identifier"]
        socket = inputs_by_id.get(identifier)
        if socket is None:
            raise ConfigError(
                "节点 %r 没有输入 %r（可用：%s）"
                % (node_name, identifier, ", ".join(sorted(inputs_by_id)))
            )
        if socket.get("linked"):
            raise ConfigError(
                "节点 %r 的输入 %r 已连线，不能参与搜索" % (node_name, identifier)
            )
        param = cards_common.param_from_socket(socket)
        pairs.append((spec, _bind_node(param, node_name, prefix)))

    fixed_pairs = []
    for spec in prepared.get("fixed") or []:
        node_name = spec["node"]
        node_schema = node_schemas.get(node_name)
        if node_schema is None:
            raise ConfigError(
                "fixed 节点 %r 不在本次 schema 里（可用：%s）"
                % (node_name, ", ".join(sorted(node_schemas)))
            )
        inputs_by_id = {
            item["identifier"]: item for item in node_schema.get("inputs", [])
        }
        identifier = spec["identifier"]
        socket = inputs_by_id.get(identifier)
        if socket is None:
            raise ConfigError(
                "fixed 节点 %r 没有输入 %r（可用：%s）"
                % (node_name, identifier, ", ".join(sorted(inputs_by_id)))
            )
        if socket.get("linked"):
            raise ConfigError(
                "fixed 节点 %r 的输入 %r 已连线，不能写默认值" % (node_name, identifier)
            )
        try:
            param = cards_common.param_from_socket(socket)
        except ConfigError as exc:
            raise ConfigError(
                "fixed 输入 %s.%s 不支持写默认值：%s" % (node_name, identifier, exc)
            ) from exc
        fixed_pairs.append((spec, param))

    loaded = cards_mod.load(
        [param.kind for _, param in pairs]
        + [param.kind for _, param in fixed_pairs]
    )
    params = []
    for spec, param in pairs:
        params.append(loaded[param.kind].build(param, spec))

    prepared["fixed_packed"] = [
        {
            "node": spec["node"],
            "identifier": param.identifier,
            "value": loaded[param.kind].pack(param, _fixed_raw(param, spec["value"])),
        }
        for spec, param in fixed_pairs
    ]

    space = SearchSpace(params=tuple(params))
    errors = tr.validate_space(space)
    if errors:
        raise ConfigError("搜索空间不合法：" + "；".join(errors))
    return space, loaded
