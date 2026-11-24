# -*- coding: utf-8 -*-
"""budget 卡：Optuna 搜索预算。

拥有的配置键：budget.max_trials / timeout_s / target_loss / seed。
引擎只问 create / should_stop / state，不再 import optuna。
"""

from __future__ import annotations

import math
import os
import platform
import sys
import time
from typing import Any

# 这台机器上 WMI 查询会卡死：Python 3.13 的 platform.machine() 会走 WMI，
# 而 SQLAlchemy 一被导入就调用它。在导入 optuna 之前换成本进程内的廉价实现。
if sys.platform == "win32":
    platform.machine = lambda: os.environ.get("PROCESSOR_ARCHITECTURE", "AMD64")

import optuna

from ...core.cards import BudgetCard
from ...errors import ConfigError


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError("%s 需要是数字，收到 %r" % (name, value))
    number = float(value)
    if not math.isfinite(number):
        raise ConfigError("%s 需要是有限数字，收到 %r" % (name, value))
    return number


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


class Card(BudgetCard):
    name = "optuna"

    def configure(self, config: dict, base_dir: str) -> dict:
        cfg = _validate_budget(config.get("budget") or {})
        self.max_trials = cfg["max_trials"]
        self.timeout_s = cfg["timeout_s"]
        self.target_loss = cfg["target_loss"]
        self.seed = cfg["seed"]
        self.converged = False
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        return cfg

    def create(self, ctx):
        sampler = (
            optuna.samplers.TPESampler(seed=self.seed)
            if self.seed is not None
            else None
        )
        study = optuna.create_study(
            study_name=ctx.prepared["study_name"],
            direction="minimize",
            sampler=sampler,
        )
        ctx.study = study
        self.converged = False
        return study

    def should_stop(self, ctx, trial_index: int) -> bool:
        if ctx.records and self.target_loss is not None:
            best_loss = min(loss for loss, _ in ctx.records)
            if best_loss <= self.target_loss:
                self.converged = True
                return True
        if trial_index >= self.max_trials:
            return True
        if (
            self.timeout_s is not None
            and time.monotonic() - ctx.started >= self.timeout_s
        ):
            return True
        return False

    def state(self, ctx) -> dict:
        return {
            "converged": self.converged,
            "target_loss": self.target_loss,
            "elapsed_s": time.monotonic() - ctx.started,
        }
