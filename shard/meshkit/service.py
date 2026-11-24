# -*- coding: utf-8 -*-
"""meshkit.service —— 工具和 meshkit 之间唯一的文件单子。

用法（cwd 在 shard/）：
    python -m meshkit.service <request.json>

request 至少带 op；result_path 给了就把结果写回去：
    {"op": "from_blend",  "blend": "...", "object": "...", "modifier": "...",
     "node": "...", "kind": "mesh", "fields": [...], "frame": 1,
     "result_path": "..."}
    {"op": "node_list",   "blend": "...", "object": "...", "modifier": "...",
     "result_path": "..."}
    {"op": "export_blend","blend": "...", "object": "...", "modifier": "...",
     "node": "...", "out_path": "...", "frame": 1, "result_path": "..."}
    {"op": "stage",       "script": "...", "params": {...}, "out_dir": "...",
     "result_path": "..."}
    {"op": "mesh_file",   "path": "...", "kind": "auto|mesh|pointcloud",
     "fields": [...], "result_path": "..."}

统一返回 {"ok": true/false, "op": "...", ...}；失败时带 error。
"""

import json
import os
import sys
import traceback

import trimesh

from . import export_from_blender, load_mesh, mesh_summary, pointcloud_summary, summarize_from_blender

_OPS = ("from_blend", "node_list", "export_blend", "stage", "mesh_file")


def _text(value) -> str:
    return str(value or "").strip()


def _require(req: dict, key: str) -> str:
    value = _text(req.get(key))
    if not value:
        raise ValueError(f"op={req.get('op')!r} 需要 {key}")
    return value


def _fields(req: dict):
    fields = req.get("fields")
    if fields is None:
        return None
    if isinstance(fields, str):
        return [part for part in fields.replace(",", " ").split() if part]
    return list(fields)


def _frame(req: dict):
    value = req.get("frame")
    return None if value in (None, "") else int(value)


def _as_mesh(loaded):
    if isinstance(loaded, trimesh.Trimesh):
        return loaded
    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError("文件里没有网格几何（只有点云或空场景）")
        return trimesh.util.concatenate(meshes)
    raise ValueError(f"文件加载成 {type(loaded).__name__}，不是网格")


def _from_blend(req: dict) -> dict:
    kind = _text(req.get("kind")) or "mesh"
    if kind not in ("mesh", "pointcloud", "all"):
        raise ValueError('kind 必须是 mesh / pointcloud / all')
    summary = "all" if kind == "all" else f'out("{kind}")'
    result = summarize_from_blender(
        _require(req, "blend"),
        _require(req, "object"),
        _require(req, "modifier"),
        _require(req, "node"),
        summary=summary,
        frame=_frame(req),
        fields=_fields(req),
    )
    return {"op": "from_blend", **result}


def _node_list(req: dict) -> dict:
    result = summarize_from_blender(
        _require(req, "blend"),
        _require(req, "object"),
        _require(req, "modifier"),
        "LIST",
        summary="all",
        frame=_frame(req),
    )
    return {"op": "node_list", **result}


def _export_blend(req: dict) -> dict:
    result = export_from_blender(
        _require(req, "blend"),
        _require(req, "object"),
        _require(req, "modifier"),
        _require(req, "node"),
        out_path=_text(req.get("out_path")) or None,
        summary="all",
        frame=_frame(req),
    )
    return {
        "op": "export_blend",
        "components": result.get("components", []),
        "files": result.get("files", {}),
        "skipped": result.get("skipped", []),
    }


def _stage(req: dict) -> dict:
    from .stage import run as run_stage

    result = run_stage(req)
    return {"op": "stage", **result}


def _mesh_file(req: dict) -> dict:
    loaded = load_mesh(_require(req, "path"))
    kind = _text(req.get("kind")) or "auto"
    if kind == "auto":
        kind = "pointcloud" if isinstance(loaded, trimesh.PointCloud) else "mesh"
    if kind == "mesh":
        summary = mesh_summary(_as_mesh(loaded), keys=_fields(req))
    elif kind == "pointcloud":
        summary = pointcloud_summary(loaded, keys=_fields(req))
    else:
        raise ValueError('kind 必须是 auto / mesh / pointcloud')
    return {"op": "mesh_file", "kind": kind, "summary": summary}


def run_request(req: dict) -> dict:
    if not isinstance(req, dict):
        raise ValueError("request 必须是 JSON 对象")
    op = _text(req.get("op"))
    if not op:
        raise ValueError(f"request 缺少 op；可用：{_OPS}")
    if op == "from_blend":
        return _from_blend(req)
    if op == "node_list":
        return _node_list(req)
    if op == "export_blend":
        return _export_blend(req)
    if op == "stage":
        return _stage(req)
    if op == "mesh_file":
        return _mesh_file(req)
    raise ValueError(f"未知 op {op!r}；可用：{_OPS}")


def _write(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def main(argv) -> int:
    if len(argv) != 2:
        sys.stderr.write("ERROR: 用法 python -m meshkit.service <request.json>\n")
        return 2

    request_path = argv[1]
    result_path = ""
    try:
        with open(request_path, "r", encoding="utf-8") as handle:
            req = json.load(handle)
        result_path = _text(req.get("result_path"))
        result = run_request(req)
        result["ok"] = True
        if result_path:
            _write(result_path, result)
        print("[meshkit] %s ok" % result.get("op"))
        return 0
    except BaseException as exc:
        if result_path:
            try:
                _write(result_path, {"ok": False, "error": str(exc)})
            except Exception:
                pass
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
