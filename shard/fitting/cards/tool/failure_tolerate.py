# -*- coding: utf-8 -*-
"""failure 卡：单轮失败只计数，基础设施错误才整轮中止（B 策略）。"""

from __future__ import annotations

from ...base import EngineTimeout
from ...core.cards import FailureCard


class Card(FailureCard):
    name = "tolerate"

    def configure(self, config: dict, base_dir: str) -> dict:
        self.count = 0
        self.last_error = None
        self.rows = []
        return {}

    def on_eval_error(self, ctx, trial, error: BaseException) -> bool:
        if isinstance(error, EngineTimeout):
            return False
        if not getattr(ctx.base, "alive", False):
            return False
        text = str(error)
        self.count += 1
        self.last_error = text
        trial.set_user_attr("eval_error", text)
        self.rows.append({
            "number": trial.number,
            "error": text[:500],
        })
        return True

    def on_nonfinite(self, ctx, trial, value: float) -> bool:
        self.count += 1
        return True

    def state(self, ctx) -> dict:
        return {
            "count": self.count,
            "last_error": self.last_error,
            "rows": self.rows,
        }
