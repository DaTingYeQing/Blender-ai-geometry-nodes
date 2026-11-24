# -*- coding: utf-8 -*-
"""blender.exe 的唯一定位入口：环境变量 → shard/py_environment.json → 本机默认构建。"""

import json
import os

DEFAULT_BLENDER_EXE = r"D:\blender-src\build_windows_x64_ClangCovTrace\bin\blender.exe"


def _env_json():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "py_environment.json")


def blender_exe() -> str:
    value = (os.environ.get("BLENDER_EXE") or "").strip()
    if value:
        return value
    try:
        with open(_env_json(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        value = str(data.get("blender", {}).get("exe", "")).strip()
        if value:
            return value
    except Exception:
        pass
    return DEFAULT_BLENDER_EXE
