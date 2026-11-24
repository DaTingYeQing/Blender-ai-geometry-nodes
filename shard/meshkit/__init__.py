# -*- coding: utf-8 -*-
"""meshkit —— 网格能力层：Blender 导出 + 字段计算。

- stats.py            纯字段计算（trimesh / pyvista / manifold3d），不碰 bpy
- blender_export.py   Blender 内的几何导出（改接组输出 / Realize / 恢复）
- env.py              blender.exe 的唯一定位入口
- export_by_name.py   Blender 侧的一次性导出脚本

对外 API 保持不变：
    summarize_from_blender / export_from_blender / load_mesh /
    mesh_summary / pointcloud_summary
"""

import os
import re
import subprocess
import tempfile

from .env import blender_exe
from .stats import SUPPORTED, load_mesh, mesh_summary, pointcloud_summary  # noqa: F401

BLENDER_EXE = blender_exe()
_OWN_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_SCRIPT = os.path.join(_OWN_DIR, "export_by_name.py")


def _require_blender_exe() -> str:
    exe = (BLENDER_EXE or "").strip() or blender_exe()
    if exe and os.path.isfile(exe):
        return exe
    raise RuntimeError(
        "找不到 blender.exe 的路径。\n"
        "请检查环境变量 BLENDER_EXE，或 shard/py_environment.json 里的 blender.exe。"
    )


def export_from_blender(
    blend_path: str,
    object_name: str,
    modifier_name: str,
    node_name: str,
    out_path: str = None,
    summary: str = None,
    frame: int = None,
):
    """从 Blender 按「物体 + 几何节点」导出并加载（GeometrySet 全量模式）。"""
    if summary is None or not str(summary).strip():
        raise ValueError("请写要探测什么数据（summary 必填）。")
    if modifier_name is None or not modifier_name.strip():
        raise ValueError(
            "必须指定几何节点修改器名字（modifier_name）。"
            "AI 需先打开场景确认物体上生效的几何节点修改器名字再调用。"
        )
    if out_path is None:
        out_path = os.path.join(tempfile.gettempdir(), f"meshkit_{object_name}.ply")

    cmd = [
        _require_blender_exe(), "--background", "--python", EXPORT_SCRIPT, "--",
        blend_path, object_name, modifier_name, node_name, out_path,
    ]
    if frame is not None:
        cmd.append(str(int(frame)))
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300,
            encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"Blender 导出超时（300 秒），可能场景过大或 Blender 卡住: {blend_path}"
        )

    combined = (result.stdout or "") + (result.stderr or "")
    if result.returncode != 0 or "Traceback (most recent call last)" in combined:
        raise RuntimeError(
            f"Blender 导出失败: {blend_path} / '{object_name}'\n"
            f"（Blender 退出码 {result.returncode}，但它脚本异常时也可能返回 0，看 traceback 才准）\n"
            f"{result.stdout}\n{result.stderr}"
        )

    if node_name == "LIST":
        nodes = [ln[5:] for ln in result.stdout.splitlines() if ln.startswith("NODE ")]
        return {"nodes": nodes}

    files = {}
    skipped = []
    for line in result.stdout.splitlines():
        if line.startswith("文件["):
            label = line[3:line.index("]")]
            files[label] = line[line.index(":") + 1:].strip()
        elif line.startswith("警告: 检测到"):
            skipped.append(line.split("分量")[0].replace("警告: 检测到", "").strip())

    loaded = {label: load_mesh(path) for label, path in files.items()}
    return {
        "components": list(files.keys()),
        "mesh": loaded.get("mesh"),
        "pointcloud": loaded.get("pointcloud"),
        "files": files,
        "skipped": skipped,
    }


# 摘要类型注册表（新增类型 = 写一个 xxx_summary 函数 + 这里加一行）
_SUMMARY_TYPES = {"mesh": mesh_summary, "pointcloud": pointcloud_summary}
_UNSUPPORTED_SUMMARY_TYPES = ("curves", "volume")

_OUT_RE = re.compile(r"out\s*\(\s*['\"]?([a-zA-Z]+)['\"]?\s*\)", re.IGNORECASE)


def _parse_out(summary: str):
    match = _OUT_RE.search(summary)
    return match.group(1).lower() if match else None


def summarize_from_blender(
    blend_path: str,
    object_name: str,
    modifier_name: str,
    node_name: str,
    summary: str = None,
    frame: int = None,
    fields=None,
) -> dict:
    """从 Blender 按「物体 + 几何节点」取摘要（统一入口）。"""
    if summary is None or not str(summary).strip():
        raise ValueError("请写要探测什么数据（summary 必填）。")

    data_type = _parse_out(summary) or "all"

    if node_name == "LIST":
        return export_from_blender(
            blend_path, object_name, modifier_name, node_name,
            out_path=None, summary=summary, frame=frame,
        )

    if data_type in _UNSUPPORTED_SUMMARY_TYPES:
        return {
            "status": "type_unsupported",
            "requested": data_type,
            "available": None,
            "summary": None,
        }

    if data_type != "all" and data_type not in _SUMMARY_TYPES:
        raise ValueError(
            f"未知数据类型 '{data_type}'，可选: mesh / pointcloud / curves / volume / all"
        )

    try:
        result = export_from_blender(
            blend_path, object_name, modifier_name, node_name,
            out_path=None, summary=summary, frame=frame,
        )
    except RuntimeError as exc:
        if "没有此类型" in str(exc):
            return {
                "status": "type_not_found",
                "requested": data_type,
                "available": [],
                "summary": None,
            }
        raise

    if data_type == "all":
        summaries = {}
        for component in result["components"]:
            summaries[component] = _SUMMARY_TYPES[component](
                result[component], keys=fields
            )
        return {
            "status": "ok",
            "requested": "all",
            "available": result["components"],
            "summary": summaries,
        }

    if data_type not in result["components"]:
        return {
            "status": "type_not_found",
            "requested": data_type,
            "available": result["components"],
            "summary": None,
        }

    return {
        "status": "ok",
        "requested": data_type,
        "available": result["components"],
        "summary": _SUMMARY_TYPES[data_type](result[data_type], keys=fields),
    }
