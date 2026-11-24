# -*- coding: utf-8 -*-
"""output 卡：清理旧产物、保留最优网格、拼装并写出 best.json / best_seen.json。"""

from __future__ import annotations

import json
import math
import os
import shutil
from typing import Any

from ...core.cards import OutputCard
from ...core.fs import unlink_quiet


def _json_safe(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


class Card(OutputCard):
    name = "json"

    def configure(self, config: dict, base_dir: str) -> dict:
        return {}

    def prepare(self, ctx) -> None:
        out_dir = ctx.prepared["run_dir"] or ctx.base_dir
        os.makedirs(out_dir, exist_ok=True)
        self.report_path = os.path.abspath(
            os.path.join(ctx.base_dir, ctx.prepared["report"])
        )
        os.makedirs(os.path.dirname(self.report_path), exist_ok=True)
        self.best_mesh_path = os.path.join(out_dir, "best.ply")
        self.best_mesh = None
        self.best_loss = float("inf")

        for path in (
            self.report_path,
            self.best_mesh_path,
            os.path.join(out_dir, "best_seen.json"),
            os.path.join(os.path.dirname(self.report_path), "best_seen.json"),
        ):
            unlink_quiet(path)

        ctx.out_dir = out_dir

    def observe(self, ctx, result: dict, loss: float) -> None:
        if not math.isfinite(loss):
            return
        if loss <= self.best_loss:
            self.best_loss = loss
            source = result.get("mesh")
            if source and os.path.isfile(source):
                shutil.copyfile(source, self.best_mesh_path)
                self.best_mesh = self.best_mesh_path

    def finalize(self, ctx, *, score: dict, budget: dict, failure: dict, memory: dict) -> dict:
        prepared = ctx.prepared
        records = ctx.records
        target_loss = budget.get("target_loss")
        min_diff = score.get("min_diff", 0.05)
        failures = failure.get("count", 0)
        last_error = failure.get("last_error")
        total = len(ctx.study.trials)
        elapsed = budget.get("elapsed_s", 0.0)

        if records:
            best_loss = score.get("loss")
            fields = score.get("fields") or []
            params = score.get("params") or {}
            packed = score.get("packed") or []
            if budget.get("converged"):
                message = "已找到：最优损失 %.6g ≤ 目标 %.6g。" % (
                    best_loss, target_loss
                )
            elif target_loss is None:
                message = (
                    "已按预算跑完：最优损失 %.6g（未设置 target_loss，无法判定是否符合）。"
                    % best_loss
                )
            else:
                message = (
                    "可能不符合：在 %d 个 trial / %.1f 秒内未达到目标损失 %.6g（最优 %.6g）。"
                    % (total, elapsed, target_loss, best_loss)
                )
            if failures:
                message += "另有 %d 次求值失败。" % failures
        else:
            best_loss = None
            fields = []
            params = {}
            packed = []
            message = "可能不符合：全部 %d 个 trial 求值失败，没有可用分数。" % total
            if last_error:
                message += "最近错误：%s" % last_error

        report = _json_safe({
            "ok": bool(records),
            "converged": bool(budget.get("converged")),
            "message": message,
            "loss": best_loss,
            "target": ctx.target_label,
            "target_source": ctx.target_source,
            "min_diff": min_diff,
            "fields": fields,
            "params": params,
            "packed": packed,
            "mesh": self.best_mesh,
            "node": prepared["node"],
            "target_loss": target_loss,
            "fixed": prepared.get("fixed_packed") or [],
            "trials": {"total": total, "failed": failures},
            "last_error": last_error,
            "failure_detail": failure.get("rows") or [],
            "warm_start": memory,
            "elapsed_s": round(elapsed, 3),
            "space": {
                "dimensions": len(ctx.space.component_keys()),
                "cards": sorted(ctx.value_cards),
            },
            "run_dir": prepared["run_dir"],
        })

        seen_rows = score.get("best_seen_rows") or []
        seen_path = None
        if seen_rows:
            seen_path = os.path.join(
                os.path.dirname(self.report_path), "best_seen.json"
            )
            seen_payload = {
                "target": ctx.target_label,
                "joint": {
                    "loss": report.get("loss"),
                    "trial": score.get("joint_trial"),
                },
                "fields": seen_rows,
            }
            with open(seen_path, "w", encoding="utf-8") as handle:
                json.dump(_json_safe(seen_payload), handle, ensure_ascii=False, indent=2)
        report["best_seen"] = seen_path

        with open(self.report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
        return report
