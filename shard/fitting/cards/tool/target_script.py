# -*- coding: utf-8 -*-
"""target 卡：分段脚本生成的参考数据。

拥有的配置键：script / stage / params。
"""

from __future__ import annotations

import json
import os

from ...core.cards import TargetCard
from ...core.fs import file_stamp
from ...errors import ConfigError


def _validate_stage(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ConfigError("stage 需要是从 1 开始的整数（跑脚本的第几段）")
    return int(value)


def _validate_params(value) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError('params 需要是对象，如 {"n": 24, "t": 1.0}')
    return dict(value)


class Card(TargetCard):
    name = "script"

    def configure(self, config: dict, base_dir: str) -> dict:
        if str(config.get("target") or "").strip():
            raise ConfigError(
                "target 与 script 只能二选一：要么直接给参考模型，要么给生成参考的脚本"
            )
        script = str(config.get("script") or "").strip()
        if not script:
            raise ConfigError("缺少 script（生成参考数据的 .py）")
        path = os.path.abspath(os.path.join(base_dir, script))
        if not os.path.isfile(path):
            raise ConfigError("找不到 script：%s" % path)
        self.script = path
        self.stage = _validate_stage(config.get("stage"))
        self.params = _validate_params(config.get("params"))
        return {
            "script": path,
            "stage": self.stage,
            "params": self.params,
        }

    def load(self, ctx) -> None:
        from meshkit import stage as stage_mod

        out_dir = os.path.abspath(ctx.prepared["run_dir"] or ctx.base_dir)
        payload = {
            "script": self.script,
            "params": self.params,
            "out_dir": out_dir,
        }
        if self.stage is not None:
            payload["stage"] = self.stage

        try:
            result = stage_mod.run(payload)
        except stage_mod.ProbeError as exc:
            raise ConfigError("脚本生成参考数据失败：%s" % exc) from exc
        except Exception as exc:
            raise ConfigError(
                "脚本生成参考数据失败（%s）：%s" % (type(exc).__name__, exc)
            ) from exc

        rows = result.get("stages") or []
        if not rows:
            raise ConfigError("脚本没有跑出任何阶段数据")
        path = rows[-1].get("file")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError) as exc:
            raise ConfigError("读阶段数据失败：%s" % exc) from exc

        summary = data.get("summary")
        if not isinstance(summary, dict) or not summary:
            raise ConfigError("阶段数据里没有 summary：%s" % path)

        ctx.target_summary = summary
        ctx.target_label = path
        ctx.target_source = {
            "kind": "script",
            "script": self.script,
            "stage": self.stage,
            "params": self.params,
        }

    def signature(self, ctx) -> list:
        return ["script", file_stamp(self.script), self.stage, self.params]
