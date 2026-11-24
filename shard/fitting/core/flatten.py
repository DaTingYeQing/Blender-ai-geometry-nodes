# -*- coding: utf-8 -*-
"""把嵌套摘要拍平成 {字段名: 标量}，容器用点号分隔。"""

from __future__ import annotations


def flatten(prefix: str, value, out: dict) -> None:
    if hasattr(value, "tolist") and not isinstance(value, (str, bytes)):
        value = value.tolist()
    if isinstance(value, dict):
        for key, item in value.items():
            flatten("%s.%s" % (prefix, key) if prefix else str(key), item, out)
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            flatten("%s.%d" % (prefix, index) if prefix else str(index), item, out)
    elif isinstance(value, bool):
        out[prefix] = 1.0 if value else 0.0
    elif isinstance(value, (int, float)):
        out[prefix] = float(value)
    elif value is None:
        out[prefix] = float("nan")
    else:
        out[prefix] = str(value)
