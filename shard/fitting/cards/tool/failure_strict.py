# -*- coding: utf-8 -*-
"""failure 卡：任何单轮失败都整轮中止（A 策略）。"""

from __future__ import annotations

from ...core.cards import FailureCard


class Card(FailureCard):
    name = "strict"

    def configure(self, config: dict, base_dir: str) -> dict:
        return {}

    def on_eval_error(self, ctx, trial, error: BaseException) -> bool:
        return False

    def on_nonfinite(self, ctx, trial, value: float) -> bool:
        return False

    def state(self, ctx) -> dict:
        return {"count": 0, "last_error": None, "rows": []}
