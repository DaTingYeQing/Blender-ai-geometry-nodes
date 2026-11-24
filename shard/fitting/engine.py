# -*- coding: utf-8 -*-
"""引擎：写死顺序的显式循环。

    ① 底座启动 Blender（只启动一次）
    ② 读节点 schema（输入/输出）
    ③ 一个值类型一个卡片，只加载出现的类型
    ④ Optuna 给一组值（study.ask）
    ⑤ 翻译层2：Optuna 值 → Blender 打包值
    ⑥ 底座写值、求值、落 result.json
    ⑦ 翻译层1：result.json → Optuna 数据
    ⑧ 打分（加权平方误差）
    ⑨ 达标就停；否则 study.tell 后回 ④

命令行：python -m fitting.engine fit.json [--blender-exe <路径>]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import sys
import time
from typing import Any, Mapping

# 这台机器上 WMI 查询会卡死：Python 3.13 的 platform.machine() 会走 WMI，
# 而 SQLAlchemy 一被导入就调用它。在导入 optuna 之前换成本进程内的廉价实现。
if sys.platform == "win32":
    platform.machine = lambda: os.environ.get("PROCESSOR_ARCHITECTURE", "AMD64")

import optuna

from . import config as config_mod
from . import translator as tr
from .base import BlenderBase, EngineError, EngineTimeout
from .errors import ConfigError
from .translate import to_blender, to_optuna


# ------------------------------------------------------------------ 打分


def _score(measures: Mapping[str, Any], targets: dict, weights: dict) -> float:
    total = 0.0
    for key, target in targets.items():
        value = measures.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return float("inf")
        value = float(value)
        if not math.isfinite(value):
            return float("inf")
        diff = value - target
        total += weights.get(key, 1.0) * diff * diff
    return total


# ------------------------------------------------------------------ 显式循环


def run_config(
    config: dict,
    *,
    base_dir: str = ".",
    blender_exe: str | None = None,
    base_factory=BlenderBase,
) -> dict:
    prepared = config_mod.prepare(config, base_dir)
    budget = prepared["budget"]
    targets = prepared["loss"]["targets"]
    weights = prepared["loss"]["weights"]

    started = time.monotonic()
    with base_factory(
        prepared["blend"],
        object_name=prepared["object"],
        modifier_name=prepared["modifier"],
        node_name=prepared["node"],
        input_nodes=prepared["input_nodes"],
        frame=prepared["frame"],
        blender_exe=blender_exe,
        run_dir=prepared["run_dir"],
        startup_timeout=prepared["startup_timeout"],
        eval_timeout=prepared["eval_timeout"],
    ) as base:
        # ② 读节点 schema
        schema = base.read_schema()
        # ③ 按出现的值类型加载卡片，生成搜索空间
        space, cards = config_mod.build_space(prepared, schema)

        sampler = (
            optuna.samplers.TPESampler(seed=budget["seed"])
            if budget["seed"] is not None
            else None
        )
        study = optuna.create_study(
            study_name=prepared["study_name"],
            direction="minimize",
            sampler=sampler,
            storage=prepared["storage"],
            load_if_exists=bool(prepared["storage"]),
        )
        try:
            study.set_user_attr("fitting_config", _json_safe(config))
        except Exception:
            pass

        offset = len(study.trials)
        records = []
        failures = 0
        last_error = None
        converged = False
        trial_index = 0

        while True:
            # ④ Optuna 给一组值
            trial = study.ask()
            raw = tr.sample(trial, space)
            # ⑤ 翻译层 2：Optuna 值 → Blender 打包值
            packed = to_blender(
                space,
                raw,
                cards,
                fixed=prepared.get("fixed_packed"),
                default_node=prepared["node"],
            )

            # ⑥ 底座写值、求值、落 result.json
            try:
                result = base.evaluate(
                    packed, tag="trial_%04d" % (offset + trial_index + 1)
                )
            except EngineTimeout:
                raise
            except EngineError as exc:
                if not base.alive:
                    raise
                failures += 1
                last_error = str(exc)
                trial.set_user_attr("eval_error", last_error)
                study.tell(trial, float("inf"))
                trial_index += 1
            else:
                # ⑦ 翻译层 1：导出网格 → 字段数值
                try:
                    measures = to_optuna(result, prepared["outputs"])
                except (ValueError, TypeError) as exc:
                    raise ConfigError("输出字段无效：%s" % exc) from exc
                # ⑧ 打分
                loss = _score(measures, targets, weights)
                trial.set_user_attr("measures", measures)
                trial.set_user_attr("mesh", result.get("mesh"))
                study.tell(trial, loss)
                trial_index += 1
                if math.isfinite(loss):
                    records.append((loss, trial))
                else:
                    failures += 1

            # ⑨ 判定：符合就停
            if records:
                best_loss = min(loss for loss, _ in records)
                target = budget["target_loss"]
                if target is not None and best_loss <= target:
                    converged = True
                    break
            if trial_index >= budget["max_trials"]:
                break
            if (
                budget["timeout_s"] is not None
                and time.monotonic() - started >= budget["timeout_s"]
            ):
                break

    elapsed = time.monotonic() - started
    report = _build_report(
        prepared=prepared,
        records=records,
        converged=converged,
        failures=failures,
        last_error=last_error,
        total=len(study.trials),
        elapsed=elapsed,
        space=space,
        cards=cards,
    )

    if prepared["report"]:
        report_path = os.path.join(base_dir, prepared["report"])
        report_path = os.path.abspath(report_path)
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
    return report


def _build_report(
    *,
    prepared: dict,
    records: list,
    converged: bool,
    failures: int,
    last_error: str | None,
    total: int,
    elapsed: float,
    space,
    cards: dict,
) -> dict:
    target = prepared["budget"]["target_loss"]

    if records:
        best_loss, best_trial = min(records, key=lambda item: item[0])
        packed = to_blender(
            space,
            best_trial.params,
            cards,
            fixed=prepared.get("fixed_packed"),
            default_node=prepared["node"],
        )
        measures = dict(best_trial.user_attrs.get("measures") or {})
        mesh_path = best_trial.user_attrs.get("mesh")
        if converged:
            message = "已找到：最优损失 %.6g ≤ 目标 %.6g。" % (best_loss, target)
        elif target is None:
            message = (
                "已按预算跑完：最优损失 %.6g（未设置 target_loss，无法判定是否符合）。"
                % best_loss
            )
        else:
            message = (
                "可能不符合：在 %d 个 trial / %.1f 秒内未达到目标损失 %.6g（最优 %.6g）。"
                % (total, elapsed, target, best_loss)
            )
        best = {
            "loss": best_loss,
            "params": dict(best_trial.params),
            "packed": packed,
            "measures": measures,
            "mesh": mesh_path,
        }
    else:
        message = "可能不符合：全部 %d 个 trial 求值失败，没有可用分数。" % total
        if last_error:
            message += "最近错误：%s" % last_error
        best = None

    return _json_safe({
        "ok": bool(records),
        "converged": converged,
        "message": message,
        "node": prepared["node"],
        "target_loss": target,
        "fixed": prepared.get("fixed_packed") or [],
        "best": best,
        "trials": {"total": total, "failed": failures},
        "elapsed_s": round(elapsed, 3),
        "outputs": list(prepared["outputs"]),
        "space": {
            "dimensions": len(space.component_keys()),
            "cards": sorted(cards),
        },
        "run_dir": prepared["run_dir"],
    })


def _json_safe(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


# ------------------------------------------------------------------ 命令行


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m fitting.engine",
        description="按 JSON 单子启动一次底座，跑显式 Optuna 循环",
    )
    parser.add_argument("config", help="配置 JSON 路径")
    parser.add_argument("--blender-exe", default=None, help="覆盖默认 blender.exe")
    args = parser.parse_args(argv)

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    path = os.path.abspath(args.config)
    try:
        config = config_mod.load_config(path)
        report = run_config(
            config,
            base_dir=os.path.dirname(path),
            blender_exe=args.blender_exe,
        )
    except ConfigError as exc:
        sys.stderr.write("配置错误：%s\n" % exc)
        return 2
    except EngineError as exc:
        sys.stderr.write("引擎错误：%s\n" % exc)
        return 1

    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
