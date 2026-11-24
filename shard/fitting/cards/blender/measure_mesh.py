# -*- coding: utf-8 -*-
"""measure 卡：导出网格 → 扁平测量表。"""

from __future__ import annotations

from ...core.cards import MeasureCard
from ...core.flatten import flatten


class Card(MeasureCard):
    name = "mesh_stats"

    def extract(self, ctx, result: dict) -> dict:
        path = result.get("mesh")
        if not path:
            raise ValueError("求值结果里没有 mesh 文件路径")

        from meshkit.stats import load_mesh, mesh_summary

        mesh = load_mesh(path)
        if not hasattr(mesh, "vertices") or not hasattr(mesh, "faces"):
            raise TypeError("导出的不是网格（%s）" % type(mesh).__name__)

        flat = {}
        flatten("", mesh_summary(mesh), flat)
        return flat
