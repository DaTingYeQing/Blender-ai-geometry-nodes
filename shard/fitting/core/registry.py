# -*- coding: utf-8 -*-
"""工具卡片注册表：槽位 → 可用卡片 → 默认卡。

本轮只有 measure / score 两个槽位接入了卡片；其余槽位等各自迁移时再加。
`cards` 配置只用来换卡，不写就用默认卡。
"""

from __future__ import annotations

import importlib
from typing import Any

from ..errors import ConfigError

_CARDS = {
    "target": {
        "file": ("fitting.cards.tool.target_file", "Card"),
        "script": ("fitting.cards.tool.target_script", "Card"),
    },
    "measure": {
        "mesh_stats": ("fitting.cards.blender.measure_mesh", "Card"),
    },
    "score": {
        "grouped_loss": ("fitting.cards.tool.score_grouped", "Card"),
    },
    "budget": {
        "optuna": ("fitting.cards.tool.budget_optuna", "Card"),
    },
    "failure": {
        "tolerate": ("fitting.cards.tool.failure_tolerate", "Card"),
        "strict": ("fitting.cards.tool.failure_strict", "Card"),
    },
    "memory": {
        "seed": ("fitting.cards.tool.memory_seed", "Card"),
        "none": ("fitting.cards.tool.memory_none", "Card"),
    },
    "output": {
        "json": ("fitting.cards.tool.output_json", "Card"),
    },
}

_DEFAULTS = {
    "measure": "mesh_stats",
    "score": "grouped_loss",
    "budget": "optuna",
    "failure": "tolerate",
    "memory": "seed",
    "output": "json",
}


def _default_name(slot: str, config: dict) -> str:
    if slot == "target":
        # target 优先：给了参考网格（含 bpy export 的 PLY）就不再跑脚本
        if str(config.get("target") or "").strip():
            return "file"
        return "script" if str(config.get("script") or "").strip() else "file"
    return _DEFAULTS[slot]


def _load(module_name: str, class_name: str) -> Any:
    module = importlib.import_module(module_name)
    card = getattr(module, class_name)()
    if not getattr(card, "slot", ""):
        raise ConfigError("卡片 %s 没有声明 slot" % module_name)
    return card


def resolve(config: dict) -> dict:
    """按配置解析出本轮要用的卡片：{slot: card}。"""
    overrides = config.get("cards") or {}
    if not isinstance(overrides, dict):
        raise ConfigError('cards 需要是对象，如 {"score": "grouped_loss"}')

    unknown = sorted(set(overrides) - set(_CARDS))
    if unknown:
        raise ConfigError(
            "cards 里有未接入的槽位：%s（当前可用：%s）"
            % (", ".join(unknown), ", ".join(sorted(_CARDS)))
        )

    cards = {}
    for slot, options in _CARDS.items():
        name = str(overrides.get(slot) or _default_name(slot, config)).strip()
        if name not in options:
            raise ConfigError(
                "槽位 %s 没有卡片 %r（可用：%s）"
                % (slot, name, ", ".join(sorted(options)))
            )
        module_name, class_name = options[name]
        card = _load(module_name, class_name)
        if card.slot != slot:
            raise ConfigError(
                "卡片 %s 声明的是槽位 %s，不能放到 %s"
                % (module_name, card.slot, slot)
            )
        cards[slot] = card
    return cards


def configure(cards: dict, config: dict, base_dir: str) -> dict:
    """让每张卡校验自己拥有的配置键，返回 {slot: 规范化配置}。"""
    out = {}
    for slot, card in cards.items():
        out[slot] = card.configure(config, base_dir) or {}
    return out
