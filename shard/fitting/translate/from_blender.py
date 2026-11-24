# -*- coding: utf-8 -*-
"""翻译层 1：导出的网格文件 → Optuna 可打分的扁平数值表。

字段计算复用 meshkit.stats（与 meshkit 同一份实现）。
"""

from __future__ import annotations


def _stats():
    from meshkit.stats import load_mesh, mesh_summary

    return load_mesh, mesh_summary


def _flatten(prefix: str, value, out: dict) -> None:
    if hasattr(value, "tolist") and not isinstance(value, (str, bytes)):
        value = value.tolist()
    if isinstance(value, dict):
        for key, item in value.items():
            _flatten("%s.%s" % (prefix, key) if prefix else str(key), item, out)
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _flatten("%s.%d" % (prefix, index) if prefix else str(index), item, out)
    elif isinstance(value, bool):
        out[prefix] = 1.0 if value else 0.0
    elif isinstance(value, (int, float)):
        out[prefix] = float(value)
    elif value is None:
        out[prefix] = float("nan")
    else:
        out[prefix] = str(value)


def to_optuna(result: dict, fields) -> dict:
    """result 里有 mesh 文件路径；按 fields 算网格指标并拍平成 {名字: 值}。"""
    path = result.get("mesh")
    if not path:
        raise ValueError("求值结果里没有 mesh 文件路径")

    load_mesh, mesh_summary = _stats()
    mesh = load_mesh(path)
    if not hasattr(mesh, "vertices") or not hasattr(mesh, "faces"):
        raise TypeError("导出的不是网格（%s）" % type(mesh).__name__)

    summary = mesh_summary(mesh, keys=list(fields))
    flat = {}
    _flatten("", summary, flat)
    return flat
