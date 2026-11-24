# -*- coding: utf-8 -*-
"""文件指纹：路径 + 大小 + 修改时间，用于热启动失效判断。"""

from __future__ import annotations

import os


def file_stamp(path: str) -> list:
    try:
        stat = os.stat(path)
        return [os.path.abspath(path), int(stat.st_size), int(stat.st_mtime_ns)]
    except OSError:
        return [os.path.abspath(path), None, None]


def unlink_quiet(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass
