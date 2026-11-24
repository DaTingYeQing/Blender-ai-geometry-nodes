# -*- coding: utf-8 -*-
"""score 卡：分组加权误差。

target 是一份参考摘要，字段全部自动提取，逐字段归一化后按组聚合。
配置所有权：weights / skip / min_diff。
"""

from __future__ import annotations

import math
from typing import Any

from ...core.cards import ScoreCard
from ...core.flatten import flatten
from ...errors import ConfigError
from ...translate import to_blender

# ── 分组与默认权重 ───────────────────────────────────────────────────
# 组内先平均再乘权重，避免字段多的组靠数量压过其他组。
GROUPS = {
    "shape": (
        "sphericity",
        "solidity",
        "fill_ratio",
        "elongation",
        "flatness",
    ),
    "volume": (
        "volume",
        "area",
        "hull_volume",
        "hull_area",
    ),
    "dimension": (
        "extents",
        "bounds",
        "obb_extents",
        "bounding_sphere_radius",
        "bounding_cylinder_radius",
        "bounding_cylinder_height",
    ),
    "topology": (
        "euler_number",
        "body_count",
        "n_open_edges",
    ),
    "quality": (
        "face_area_min",
        "face_area_mean",
        "face_area_max",
        "face_area_std",
        "face_angle_min_deg",
        "edge_length_min",
        "edge_length_mean",
        "edge_length_max",
        "degenerate_faces",
    ),
    "position": ("center_mass",),
    "scale": (
        "n_vertices",
        "n_faces",
        "n_edges",
        "n_triangles",
        "hull_n_vertices",
    ),
}

DEFAULT_WEIGHTS = {
    "shape": 2.0,
    "volume": 1.0,
    "dimension": 1.0,
    "topology": 1.0,
    "quality": 0.5,
    "position": 0.5,
    "scale": 0.3,
}

# 每组用的误差口径：relative 是对称相对误差；absolute_scaled 是
# 「绝对差 / 整体尺度」，用于目标接近 0 的字段（如 center_mass）。
GROUP_METRICS = {
    "position": "absolute_scaled",
}

_EPS = 1e-12


def relative(value: float, target: float) -> float:
    """对称相对误差，恒定在 [0,1]；target 为 0 时也不会发散。"""
    scale = max(abs(value), abs(target), _EPS)
    return min(abs(value - target) / scale, 1.0)


def diff(value: float, target: float, metric: str = "relative", scale: float = 1.0) -> float:
    """按分组口径算单字段偏差，结果恒定在 [0,1]。"""
    value, target = float(value), float(target)
    if metric == "absolute_scaled":
        try:
            norm = float(scale)
        except (TypeError, ValueError):
            norm = 1.0
        if not math.isfinite(norm) or norm <= 0:
            norm = 1.0
        return min(abs(value - target) / norm, 1.0)
    return relative(value, target)


def _model_scale(flat: dict) -> float:
    """整体尺度：优先用包围盒对角线，退化时用 extents 的模长。"""
    diagonal = flat.get("bbox_diagonal")
    if isinstance(diagonal, (int, float)) and math.isfinite(float(diagonal)):
        if float(diagonal) > 0:
            return float(diagonal)
    extents = []
    for index in range(3):
        value = flat.get("extents.%d" % index)
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            extents.append(float(value))
    norm = math.sqrt(sum(value * value for value in extents)) if extents else 0.0
    return norm if norm > 0 else 1.0


def _is_skipped(key: str, skip) -> bool:
    return any(key == item or key.startswith(item + ".") for item in skip)


def _merged_weights(overrides) -> dict:
    merged = dict(DEFAULT_WEIGHTS)
    for name, raw in (overrides or {}).items():
        if name not in GROUPS:
            raise ValueError(
                "weights 里有未知分组 %r；可用：%s" % (name, sorted(GROUPS))
            )
        value = float(raw)
        if value < 0:
            raise ValueError("weights.%s 不能是负数" % name)
        merged[name] = value
    return merged


def build_plan(target_summary: dict, *, skip=(), weights=None) -> dict:
    """从参考摘要生成打分计划。

    只保留 target 里真实存在的字段；列表字段会展开成分量（extents.0 等）。
    """
    flat = {}
    flatten("", target_summary, flat)
    usable = {
        key: float(value)
        for key, value in flat.items()
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    }

    skip = tuple(str(item) for item in (skip or ()))
    merged = _merged_weights(weights)
    model_scale = _model_scale(flat)
    groups = []

    for name, fields in GROUPS.items():
        picked = {}
        for field in fields:
            if field in usable and not _is_skipped(field, skip):
                picked[field] = usable[field]
            for key, value in usable.items():
                if not key.startswith(field + "."):
                    continue
                if _is_skipped(key, skip):
                    continue
                picked[key] = value
        if picked:
            group = {
                "name": name,
                "weight": merged[name],
                "targets": picked,
                "metric": GROUP_METRICS.get(name, "relative"),
            }
            if group["metric"] == "absolute_scaled":
                group["scale"] = model_scale
            groups.append(group)

    if not groups:
        raise ValueError(
            "参考模型没有可用字段：确认 target 是网格文件，且 skip 没有把字段全排除"
        )
    return {"groups": groups}


def score_measures(measures: dict, plan: dict) -> dict:
    """按计划打分；返回 total ∈ [0,1] 和最大的几项偏差。"""
    total = 0.0
    weight_sum = 0.0
    per_group = {}
    diffs = []

    for group in plan["groups"]:
        values = []
        metric = group.get("metric", "relative")
        scale = group.get("scale", 1.0)
        for name, target in group["targets"].items():
            value = measures.get(name)
            if value is None or not math.isfinite(value):
                continue
            field_diff = diff(value, target, metric, scale)
            values.append(field_diff)
            diffs.append((name, field_diff))
        if not values:
            continue
        mean = sum(values) / len(values)
        per_group[group["name"]] = mean
        total += group["weight"] * mean
        weight_sum += group["weight"]

    if weight_sum <= 0:
        return {"loss": float("inf"), "groups": per_group, "worst": []}

    diffs.sort(key=lambda item: item[1], reverse=True)
    return {
        "loss": total / weight_sum,
        "groups": per_group,
        "worst": [[name, value] for name, value in diffs[:5]],
    }


# ---------------------------------------------------------------- 配置校验


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError("%s 需要是数字，收到 %r" % (name, value))
    number = float(value)
    if not math.isfinite(number):
        raise ConfigError("%s 需要是有限数字，收到 %r" % (name, value))
    return number


def _validate_skip(value: Any) -> list:
    """skip：不参与对比的字段，可写字段名或它的分量（extents 或 extents.0）。"""
    if value is None:
        return []
    if not isinstance(value, list):
        raise ConfigError('skip 需要是字段名数组，如 ["center_mass"]')
    names = []
    for index, item in enumerate(value):
        name = _text(item)
        if not name:
            raise ConfigError("skip[%d] 需要是非空字段名" % index)
        if name not in names:
            names.append(name)
    return names


def _validate_weights(value: Any) -> dict:
    """weights：覆盖分组权重，如 {"shape": 3.0}。"""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError('weights 需要是对象，如 {"shape": 3.0}')
    clean = {}
    for key, raw in value.items():
        name = _text(key)
        if not name:
            raise ConfigError("weights 里有空分组名")
        if name not in GROUPS:
            raise ConfigError(
                "weights 里有未知分组 %r；可用：%s" % (name, sorted(GROUPS))
            )
        weight = _number(raw, "weights.%s" % name)
        if weight < 0:
            raise ConfigError("weights.%s 不能是负数" % name)
        clean[name] = weight
    return clean


def _validate_min_diff(value: Any) -> float:
    """min_diff：只输出偏差大于它的字段，单位是百分比（5 = 5%）。"""
    if value is None:
        return 0.05
    number = _number(value, "min_diff")
    if number < 0 or number > 100:
        raise ConfigError("min_diff 需要在 0~100 之间（单位 %）")
    return number / 100.0


# ---------------------------------------------------------------- 字段明细


def _field_diffs(measures: dict, plan: dict) -> dict:
    """每个参与字段的当前值、目标值、偏差与所属组。"""
    out = {}
    for group in plan["groups"]:
        metric = group.get("metric", "relative")
        scale = group.get("scale", 1.0)
        for name, target in group["targets"].items():
            value = measures.get(name)
            if not isinstance(value, (int, float)):
                continue
            value = float(value)
            if not math.isfinite(value):
                continue
            out[name] = {
                "value": value,
                "target": float(target),
                "diff": diff(value, float(target), metric, scale),
                "group": group["name"],
            }
    return out


def _field_rows(measures: dict, plan: dict, min_diff: float) -> list:
    """按偏差从大到小，只列超过阈值的字段。"""
    rows = []
    for name, item in _field_diffs(measures, plan).items():
        if item["diff"] <= min_diff:
            continue
        rows.append({
            "field": name,
            "group": item["group"],
            "target": item["target"],
            "best": item["value"],
            "diff": item["diff"],
        })
    rows.sort(key=lambda row: row["diff"], reverse=True)
    return rows


def _best_seen_rows(measures: dict, plan: dict, seen: dict) -> list:
    """字段级历史最好 vs 联合最优：只列还有提升空间的，按 gap 降序。"""
    rows = []
    for name, item in _field_diffs(measures, plan).items():
        best = seen.get(name)
        if not best:
            continue
        gap = item["diff"] - best["diff"]
        if gap <= 0:
            continue
        rows.append({
            "field": name,
            "group": item["group"],
            "target": item["target"],
            "joint": {"value": item["value"], "diff": item["diff"]},
            "seen": {
                "value": best["value"],
                "diff": best["diff"],
                "trial": best["trial"],
            },
            "gap": gap,
        })
    rows.sort(key=lambda row: row["gap"], reverse=True)
    return rows


# ---------------------------------------------------------------- 卡片


class Card(ScoreCard):
    name = "grouped_loss"

    def configure(self, config: dict, base_dir: str) -> dict:
        self.weights = _validate_weights(config.get("weights"))
        self.skip = _validate_skip(config.get("skip"))
        self.min_diff = _validate_min_diff(config.get("min_diff"))
        self.plan = None
        self.best_seen = {}
        return {
            "weights": self.weights,
            "skip": self.skip,
            "min_diff": self.min_diff,
        }

    def prepare(self, ctx) -> dict:
        try:
            plan = build_plan(
                ctx.target_summary,
                skip=self.skip,
                weights=self.weights,
            )
        except ValueError as exc:
            raise ConfigError(str(exc)) from exc
        self.plan = plan
        self.best_seen = {}
        return plan

    def signature(self, ctx) -> list:
        return [
            [
                group["name"],
                group["weight"],
                group.get("metric"),
                group.get("scale"),
                sorted(
                    (str(key), float(value))
                    for key, value in group["targets"].items()
                ),
            ]
            for group in self.plan["groups"]
        ]

    def score(self, ctx, measures: dict) -> dict:
        return score_measures(measures, self.plan)

    def observe(self, ctx, trial, measures: dict, scored: dict) -> None:
        trial.set_user_attr("measures", measures)
        trial.set_user_attr("groups", scored.get("groups") or {})
        trial.set_user_attr("worst", scored.get("worst") or [])
        if not math.isfinite(float(scored["loss"])):
            return
        for name, item in _field_diffs(measures, self.plan).items():
            previous = self.best_seen.get(name)
            if previous is None or item["diff"] < previous["diff"]:
                self.best_seen[name] = {
                    "value": item["value"],
                    "diff": item["diff"],
                    "trial": getattr(trial, "number", None),
                }

    def finalize(self, ctx) -> dict:
        out = {
            "loss": None,
            "fields": [],
            "params": {},
            "packed": [],
            "best_seen_rows": [],
            "joint_trial": None,
            "min_diff": self.min_diff,
        }
        if not ctx.records:
            return out

        best_loss, best_trial = min(ctx.records, key=lambda item: item[0])
        packed = to_blender(
            ctx.space,
            best_trial.params,
            ctx.value_cards,
            fixed=ctx.prepared.get("fixed_packed"),
            default_node=ctx.prepared["node"],
        )
        measures = dict(best_trial.user_attrs.get("measures") or {})
        out.update({
            "loss": best_loss,
            "fields": _field_rows(measures, self.plan, self.min_diff),
            "params": dict(best_trial.params),
            "packed": packed,
            "best_seen_rows": _best_seen_rows(measures, self.plan, self.best_seen),
            "joint_trial": getattr(best_trial, "number", None),
        })
        return out
