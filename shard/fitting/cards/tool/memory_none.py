# -*- coding: utf-8 -*-
"""memory 卡：不读也不写种子，每轮完全冷启动。"""

from __future__ import annotations

from ...core.cards import MemoryCard


class Card(MemoryCard):
    name = "none"

    def configure(self, config: dict, base_dir: str) -> dict:
        return {}

    def load(self, ctx) -> None:
        pass

    def enqueue(self, ctx, study) -> int:
        return 0

    def finalize(self, ctx) -> None:
        pass

    def state(self, ctx) -> dict:
        return {"seed": None, "matched": False, "enqueued": 0, "entries": 0}
