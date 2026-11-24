# -*- coding: utf-8 -*-
"""memory 卡：用 seed.json 热启动。

指纹 = 场景 + 参考数据签名 + 搜索空间 + 打分计划签名；任何一项变了就不复用。
"""

from __future__ import annotations

import hashlib
import json
import math
import os

from ...contract import DIST_CATEGORICAL, DIST_INT
from ...core.cards import MemoryCard
from ...core.fs import file_stamp

SEED_FILE = "seed.json"
SEED_LIMIT = 3
FINGERPRINT_VERSION = "fit-v1"


def _fingerprint(ctx) -> str:
    prepared = ctx.prepared
    space = ctx.space

    dimensions = []
    for param in space.params:
        if param.fixed:
            continue
        dimensions.append([
            param.key,
            param.kind,
            [
                [
                    component.key,
                    component.type,
                    component.low,
                    component.high,
                    component.step,
                    bool(component.log),
                    list(component.choices),
                ]
                for component in param.components
            ],
        ])

    payload = {
        "version": FINGERPRINT_VERSION,
        "blend": file_stamp(prepared["blend"]),
        "object": prepared["object"],
        "modifier": prepared["modifier"],
        "node": prepared["node"],
        "input_nodes": prepared["input_nodes"],
        "source": ctx.signatures.get("target"),
        "dimensions": dimensions,
        "groups": ctx.signatures.get("score"),
    }
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_seed(path: str, fingerprint: str) -> tuple[list, bool]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return [], False
    if not isinstance(data, dict) or data.get("fingerprint") != fingerprint:
        return [], False

    entries = data.get("entries")
    clean = []
    for item in entries if isinstance(entries, list) else ():
        if not isinstance(item, dict) or not isinstance(item.get("params"), dict):
            continue
        try:
            loss_value = float(item.get("loss"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(loss_value):
            continue
        clean.append({"loss": loss_value, "params": item["params"]})
    clean.sort(key=lambda entry: entry["loss"])
    return clean[:SEED_LIMIT], True


def _seed_params(space, saved: dict) -> dict:
    """把上次的参数裁到当前搜索空间里；对不上或超界的分量直接丢掉。"""
    out = {}
    for _, component in space.components():
        if component.key not in saved:
            continue
        value = saved[component.key]
        if isinstance(value, bool):
            if component.type == DIST_CATEGORICAL and value in component.choices:
                out[component.key] = value
            continue
        if not isinstance(value, (int, float)):
            continue

        if component.type == DIST_CATEGORICAL:
            if value in component.choices:
                out[component.key] = value
            continue

        if component.type == DIST_INT:
            low, high = int(component.low), int(component.high)
            step = max(1, int(component.step or 1))
            snapped = low + int(round((float(value) - low) / step)) * step
            out[component.key] = int(max(low, min(high, snapped)))
            continue

        low, high = float(component.low), float(component.high)
        number = max(low, min(high, float(value)))
        if component.step:
            step = float(component.step)
            number = low + round((number - low) / step) * step
            number = max(low, min(high, number))
        if component.log and number <= 0:
            continue
        out[component.key] = float(number)
    return out


def _write_seed(path: str, fingerprint: str, previous: list, records: list) -> None:
    """保留本指纹下历史最好的几组参数；新一轮更差也不会把旧种子冲掉。"""
    merged = list(previous)
    for loss_value, trial in records:
        if not math.isfinite(float(loss_value)):
            continue
        merged.append({"loss": float(loss_value), "params": dict(trial.params)})

    seen = set()
    top = []
    for item in sorted(merged, key=lambda entry: float(entry.get("loss", float("inf")))):
        key = json.dumps(item["params"], ensure_ascii=False, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        top.append(item)
        if len(top) >= SEED_LIMIT:
            break
    if not top:
        return
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(
            {"fingerprint": fingerprint, "entries": top},
            handle,
            ensure_ascii=False,
            indent=2,
        )


class Card(MemoryCard):
    name = "seed"

    def configure(self, config: dict, base_dir: str) -> dict:
        self.path = None
        self.fingerprint = None
        self.entries = []
        self.matched = False
        self.enqueued = 0
        return {}

    def load(self, ctx) -> None:
        out_dir = ctx.out_dir or ctx.prepared.get("run_dir") or ctx.base_dir
        self.path = os.path.join(out_dir, SEED_FILE)
        self.fingerprint = _fingerprint(ctx)
        self.entries, self.matched = _read_seed(self.path, self.fingerprint)

    def enqueue(self, ctx, study) -> int:
        count = 0
        for entry in self.entries:
            params = _seed_params(ctx.space, entry["params"])
            if params:
                study.enqueue_trial(params)
                count += 1
        self.enqueued = count
        return count

    def finalize(self, ctx) -> None:
        if self.path and self.fingerprint:
            _write_seed(self.path, self.fingerprint, self.entries, ctx.records)

    def state(self, ctx) -> dict:
        return {
            "seed": self.path,
            "matched": self.matched,
            "enqueued": self.enqueued,
            "entries": len(self.entries),
        }
