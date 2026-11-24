# -*- coding: utf-8 -*-
"""引擎对工具卡片的接口。

一个槽位一套接口；新增同类卡片只实现对应接口，引擎不改。
卡片是纯策略对象，不 import engine，也不互相 import。
"""

from __future__ import annotations

from typing import Any


class ToolCard:
    """所有工具卡的共同部分：槽位名、显示名、配置校验。"""

    slot: str = ""
    name: str = ""

    def configure(self, config: dict, base_dir: str) -> dict:
        """校验本卡拥有的配置键，返回规范化后的配置。"""
        return {}

    def signature(self, ctx) -> Any:
        """参与热启动指纹的部分；不参与返回 None。"""
        return None


class MeasureCard(ToolCard):
    """求值结果 → 扁平测量表。"""

    slot = "measure"

    def extract(self, ctx, result: dict) -> dict:
        raise NotImplementedError


class TargetCard(ToolCard):
    """参考数据来源：load 之后写入 ctx.target_summary / label / source。"""

    slot = "target"

    def load(self, ctx) -> None:
        raise NotImplementedError

    def signature(self, ctx) -> Any:
        """参与热启动指纹的部分。"""
        return None


class ScoreCard(ToolCard):
    """测量表 → 分数，并维护字段级历史最好。"""

    slot = "score"

    def prepare(self, ctx) -> Any:
        """根据参考数据准备打分计划并返回。"""
        raise NotImplementedError

    def signature(self, ctx) -> Any:
        """参与热启动指纹的部分。"""
        return None

    def score(self, ctx, measures: dict) -> dict:
        """返回 {"loss": float, "groups": dict, "worst": list}。"""
        raise NotImplementedError

    def observe(self, ctx, trial, measures: dict, scored: dict) -> None:
        """记录本轮结果（trial 属性、字段级历史最好）。"""
        pass

    def finalize(self, ctx) -> dict:
        """返回报告需要的评分片段。"""
        return {}


class BudgetCard(ToolCard):
    """搜索预算：建 study、判断停机、给出最终预算状态。"""

    slot = "budget"

    def create(self, ctx):
        """创建本轮 study，写入 ctx.study 并返回。"""
        raise NotImplementedError

    def should_stop(self, ctx, trial_index: int) -> bool:
        """第 trial_index 个 trial 结束后是否停机。"""
        raise NotImplementedError

    def state(self, ctx) -> dict:
        """返回 {"converged", "target_loss", "elapsed_s"}。"""
        return {}


class FailureCard(ToolCard):
    """单轮失败策略：返回 False 表示整轮中止。"""

    slot = "failure"

    def on_eval_error(self, ctx, trial, error: BaseException) -> bool:
        raise NotImplementedError

    def on_nonfinite(self, ctx, trial, value: float) -> bool:
        raise NotImplementedError

    def state(self, ctx) -> dict:
        """返回 {"count", "last_error", "rows"}。"""
        return {"count": 0, "last_error": None, "rows": []}


class MemoryCard(ToolCard):
    """跨轮记忆：读/写热启动种子，不参与指纹本身。"""

    slot = "memory"

    def load(self, ctx) -> None:
        """读取种子；需要 ctx.space / ctx.signatures 已就绪。"""
        raise NotImplementedError

    def enqueue(self, ctx, study) -> int:
        """把种子参数塞给 study，返回实际入队数量。"""
        return 0

    def finalize(self, ctx) -> None:
        """本轮结束后写回种子。"""
        pass

    def state(self, ctx) -> dict:
        """返回报告里的 warm_start 片段。"""
        return {"seed": None, "matched": False, "enqueued": 0, "entries": 0}


class OutputCard(ToolCard):
    """产物：清理旧文件、保留最优网格、拼装并写出报告。"""

    slot = "output"

    def prepare(self, ctx) -> None:
        """确定产物路径并清理上一轮。"""
        raise NotImplementedError

    def observe(self, ctx, result: dict, loss: float) -> None:
        """每轮成功后调用，用于刷新最优网格。"""
        pass

    def finalize(self, ctx, *, score: dict, budget: dict, failure: dict, memory: dict) -> dict:
        """写报告并返回报告 dict。"""
        raise NotImplementedError
