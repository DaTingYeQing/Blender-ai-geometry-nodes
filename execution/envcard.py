# -*- coding: utf-8 -*-
"""envcard.py —— 本文件夹的环境卡片（自动生成，请勿手改）

【改地址】只改 py_environment.json（在 skills/ 的上一级），本卡片会自动读到新值。
【重新生成】python <skills>/_shared/pyenv.py   （只有新增 skill 文件夹时才需要）

本卡片不含任何绝对路径，可以安全提交到 Git。
"""
import json as _json
import os as _os

_MAX_UP = 6


def _find_env_json():
    """从本卡片所在目录向上找 py_environment.json（不写死路径）。"""
    p = _os.path.dirname(_os.path.abspath(__file__))
    for _ in range(_MAX_UP):
        cand = _os.path.join(p, "py_environment.json")
        if _os.path.exists(cand):
            return cand
        parent = _os.path.dirname(p)
        if parent == p:
            break
        p = parent
    raise FileNotFoundError(
        "找不到 py_environment.json（从 %s 向上找了 %d 层）。\n"
        "它是全部地址的唯一配置处，应当放在 skills/ 的上一级。" % (p, _MAX_UP))


ENV_JSON = _find_env_json()

with open(ENV_JSON, "r", encoding="utf-8") as _f:
    _E = _json.load(_f)

BLENDER_EXE = _E["blender"]["exe"]            # 内层：带 bpy 跑
PYTHON_EXE  = _E["python"]["exe"]             # 外部：跑不碰 bpy 的胶水脚本
WORKSPACE   = _E.get("workspace", {}).get("root", "")

__all__ = ["BLENDER_EXE", "PYTHON_EXE", "WORKSPACE", "ENV_JSON"]
