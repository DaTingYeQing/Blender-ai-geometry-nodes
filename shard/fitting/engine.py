# -*- coding: utf-8 -*-
"""引擎：只负责编排，业务全部在卡片里。

    ① 解析配置、加载槽位卡片
    ② target 卡取参考数据，score 卡准备打分计划，output 卡清理旧产物
    ③ 启动 Blender，读 schema，值类型卡生成搜索空间
    ④ 各卡提供签名，memory 卡读种子，budget 卡建 study
    ⑤ 循环：ask → 打包 → 求值 → measure → score → failure → tell → budget 判停
    ⑥ memory 卡写种子，output 卡写报告

命令行：python -m fitting.engine fit.json [--blender-exe <路径>]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time

from . import config as config_mod
from . import translator as tr
from .base import BlenderBase, EngineError
from .core import registry
from .core.context import RunContext
from .core.fs import unlink_quiet
from .errors import ConfigError
from .translate import to_blender


# ------------------------------------------------------------------ 显式循环


def run_config(
    config: dict,
    *,
    base_dir: str = ".",
    blender_exe: str | None = None,
    base_factory=BlenderBase,
) -> dict:
    prepared = config_mod.prepare(config, base_dir)

    tool_cards = registry.resolve(config)
    registry.configure(tool_cards, config, base_dir)
    ctx = RunContext(
        base_dir=base_dir,
        prepared=prepared,
    )
    measure_card = tool_cards["measure"]
    score_card = tool_cards["score"]
    target_card = tool_cards["target"]
    budget_card = tool_cards["budget"]
    failure_card = tool_cards["failure"]
    memory_card = tool_cards["memory"]
    output_card = tool_cards["output"]

    # 参考数据由 target 卡提供：文件或脚本，引擎不区分
    target_card.load(ctx)
    score_card.prepare(ctx)

    output_card.prepare(ctx)
    started = time.monotonic()
    ctx.started = started

    # 每轮网格写本进程独占的临时文件，多个 fit 并发也不会互相覆盖。
    mesh_tmp_path = os.path.join(
        tempfile.gettempdir(), "fit_current_%d.ply" % os.getpid()
    )

    with base_factory(
        prepared["blend"],
        object_name=prepared["object"],
        modifier_name=prepared["modifier"],
        node_name=prepared["node"],
        input_nodes=prepared["input_nodes"],
        frame=prepared["frame"],
        blender_exe=blender_exe,
        startup_timeout=prepared["startup_timeout"],
        eval_timeout=prepared["eval_timeout"],
    ) as base:
        # ② 读节点 schema
        schema = base.read_schema()
        # ③ 按出现的值类型加载卡片，生成搜索空间
        space, value_cards = config_mod.build_space(prepared, schema)
        ctx.base = base
        ctx.space = space
        ctx.value_cards = value_cards

        # 各卡提供自己的签名，memory 卡据此判断种子是否还适用。
        for slot, card in tool_cards.items():
            signature = card.signature(ctx)
            if signature is not None:
                ctx.signatures[slot] = signature
        memory_card.load(ctx)

        study = budget_card.create(ctx)
        memory_card.enqueue(ctx, study)

        trial_index = 0

        while True:
            # ④ study 给一组值
            trial = study.ask()
            raw = tr.sample(trial, space)
            # ⑤ 翻译层 2：Optuna 值 → Blender 打包值
            packed = to_blender(
                space,
                raw,
                value_cards,
                fixed=prepared.get("fixed_packed"),
                default_node=prepared["node"],
            )

            # ⑥ 底座写值、求值（网格写本进程临时文件，下一轮覆盖）
            try:
                result = base.evaluate(packed, mesh_path=mesh_tmp_path)
            except EngineError as exc:
                if not failure_card.on_eval_error(ctx, trial, exc):
                    raise
                study.tell(trial, float("inf"))
                trial_index += 1
            else:
                # ⑦ measure 卡：导出网格 → 扁平字段表
                try:
                    measures = measure_card.extract(ctx, result)
                except (ValueError, TypeError) as exc:
                    raise ConfigError("输出字段无效：%s" % exc) from exc
                # ⑧ score 卡：与参考模型逐字段对比打分
                scored = score_card.score(ctx, measures)
                loss_value = scored["loss"]
                score_card.observe(ctx, trial, measures, scored)
                study.tell(trial, loss_value)
                trial_index += 1
                if math.isfinite(loss_value):
                    ctx.records.append((loss_value, trial))
                    output_card.observe(ctx, result, loss_value)
                elif not failure_card.on_nonfinite(ctx, trial, loss_value):
                    raise EngineError("求值结果不可用：loss=%r" % (loss_value,))

            # ⑨ budget 卡判停
            if budget_card.should_stop(ctx, trial_index):
                break

        # 本次的最优几组写回 seed.json；下次同目标直接从前几名起跑。
        memory_card.finalize(ctx)

    budget_state = budget_card.state(ctx)
    failure_state = failure_card.state(ctx)
    memory_state = memory_card.state(ctx)
    try:
        return output_card.finalize(
            ctx,
            score=score_card.finalize(ctx),
            budget=budget_state,
            failure=failure_state,
            memory=memory_state,
        )
    finally:
        unlink_quiet(mesh_tmp_path)


# ------------------------------------------------------------------ 命令行


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m fitting.engine",
        description="按 JSON 单子启动一次底座，跑显式编排循环",
    )
    parser.add_argument("config", help="配置 JSON 路径")
    parser.add_argument("--blender-exe", default=None, help="覆盖默认 blender.exe")
    args = parser.parse_args(argv)

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
