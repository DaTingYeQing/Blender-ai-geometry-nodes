# -*- coding: utf-8 -*-
"""target 卡：参考模型文件。

拥有的配置键：target。出现 target 时 script/stage/params 一律忽略。
"""

from __future__ import annotations

import os

from ...core.cards import TargetCard
from ...core.fs import file_stamp
from ...errors import ConfigError


class Card(TargetCard):
    name = "file"

    def configure(self, config: dict, base_dir: str) -> dict:
        target = str(config.get("target") or "").strip()
        if not target:
            raise ConfigError("缺少 target（参考模型文件路径，如 ref.ply），或改用 script")
        path = os.path.abspath(os.path.join(base_dir, target))
        if not os.path.isfile(path):
            raise ConfigError("找不到 target 文件：%s" % path)
        self.path = path
        return {"target": path}

    def load(self, ctx) -> None:
        from meshkit.stats import load_mesh, mesh_summary

        try:
            mesh = load_mesh(self.path)
        except (FileNotFoundError, ValueError, RuntimeError) as exc:
            raise ConfigError("读取 target 失败：%s" % exc) from exc
        if not hasattr(mesh, "faces"):
            raise ConfigError(
                "target 需要是网格文件（带面），当前是 %s" % type(mesh).__name__
            )
        ctx.target_summary = mesh_summary(mesh)
        ctx.target_label = self.path
        ctx.target_source = {"kind": "file"}

    def signature(self, ctx) -> list:
        return ["target", file_stamp(self.path)]
