# -*- coding: utf-8 -*-
"""RunContext：引擎与工具卡片之间唯一共享的状态。

这里只放编排需要的数据，不放业务规则。卡片可以读写自己关心的字段，
但不能通过 ctx 去调用别的卡片；跨卡依赖用 signature / finalize 的返回值。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunContext:
    base_dir: str
    prepared: dict
    # Blender 侧
    base: Any = None
    space: Any = None
    value_cards: dict = field(default_factory=dict)
    # 参考数据
    target_summary: dict = field(default_factory=dict)
    target_label: str | None = None
    target_source: dict = field(default_factory=dict)
    # 搜索
    study: Any = None
    started: float = 0.0
    records: list = field(default_factory=list)
    signatures: dict = field(default_factory=dict)
    # 产物路径
    out_dir: str = ""
