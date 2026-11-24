# -*- coding: utf-8 -*-
"""meshkit.stage —— mesh_probe 的后端：导入一份网格脚本，按 STAGES 逐段导出 meshkit 数据。

用法（由 mesh_probe 工具调用，cwd 在 shard/）：
    python -m meshkit.stage <payload.json>

payload：
    {"script": "...", "params": {...}, "out_dir": "...", "result_path": "..."}

产物：
    <out_dir>/stage1.json、stage2.json……每段一份，含当时的参数 + meshkit 摘要
    result_path 里是给工具读的短摘要（不往上下文灌整份数据）

约定（见 MESH_CODE_RULES.md）：
    STAGES = ("seeds", "cells", "parts")      每段交出的状态，按链路顺序
    build(**params, stage=None)               stage=k 表示累计跑到第 k 段结束
"""

import hashlib
import importlib.util
import inspect
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime

import numpy as np
import trimesh

from .stats import mesh_summary, pointcloud_summary

_STAGE_FILE = re.compile(r"^stage\d+\.json$")
_KINDS = "trimesh.Trimesh / ndarray (N,3) / trimesh.PointCloud / list[trimesh.Trimesh]"


class ProbeError(RuntimeError):
    pass


def _load_module(path: str):
    """按文件路径导入；同目录的辅助模块也能 import。"""
    name = "_mesh_probe_" + hashlib.md5(path.lower().encode("utf-8")).hexdigest()[:10]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ProbeError(f"无法导入脚本：{path}")

    script_dir = os.path.dirname(path)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _read_stages(module) -> tuple:
    stages = getattr(module, "STAGES", None)
    if not isinstance(stages, (list, tuple)) or not stages:
        raise ProbeError(
            "脚本缺少 STAGES：必须按链路顺序声明每段交出的状态，"
            '如 STAGES = ("seeds", "cells", "parts")'
        )

    names = []
    for item in stages:
        name = str(item).strip()
        if not name:
            raise ProbeError(f"STAGES 里有空名字：{stages!r}")
        if name in names:
            raise ProbeError(f"STAGES 里有重复段名 {name!r}")
        names.append(name)
    return tuple(names)


def _read_params(module, overrides) -> dict:
    schema = getattr(module, "SCHEMA", None)
    if not isinstance(schema, dict) or not schema:
        raise ProbeError("脚本缺少 SCHEMA：参数表和 build 的 key 必须对应")
    if not isinstance(overrides, dict):
        raise ProbeError('params 必须是对象，如 {"n": 24, "t": 1.0}')

    defaults = {}
    for key, spec in schema.items():
        if not isinstance(spec, dict) or "default" not in spec:
            raise ProbeError(f"SCHEMA[{key!r}] 缺少 default")
        defaults[key] = spec["default"]

    unknown = sorted(set(overrides) - set(schema))
    if unknown:
        raise ProbeError(
            f"params 里有 SCHEMA 之外的键 {unknown}；可用：{sorted(schema)}"
        )
    return {**defaults, **overrides}


def _to_mesh(value):
    """Trimesh 原样返回；pyvista.PolyData 转成 Trimesh；其它返回 None。"""
    if isinstance(value, trimesh.Trimesh):
        return value

    try:
        import pyvista as pv
    except ImportError:
        return None

    if not isinstance(value, pv.PolyData):
        return None

    tri = value.triangulate()
    faces = np.asarray(tri.regular_faces) if hasattr(tri, "regular_faces") else None
    if faces is None:
        raw = np.asarray(tri.faces)
        faces = raw.reshape(-1, 4)[:, 1:]
    return trimesh.Trimesh(
        vertices=np.asarray(tri.points, dtype=float), faces=faces, process=False
    )


def _piece_row(index: int, piece: trimesh.Trimesh) -> dict:
    return {
        "index": index,
        "cell_id": piece.metadata.get("cell_id"),
        "n_vertices": int(len(piece.vertices)),
        "n_faces": int(len(piece.faces)),
        "volume": float(piece.volume),
        "area": float(piece.area),
        "bounds": piece.bounds.tolist(),
        "is_watertight": bool(piece.is_watertight),
    }


def _summarize(value) -> dict:
    if isinstance(value, np.ndarray):
        points = np.asarray(value, dtype=float)
        if points.ndim != 2 or points.shape[1] != 3:
            raise ProbeError(f"ndarray 必须是 (N,3)，实际 {points.shape}")
        if len(points) == 0:
            raise ProbeError("阶段输出是空点云")
        return {
            "kind": "pointcloud",
            "summary": pointcloud_summary(trimesh.PointCloud(points)),
        }

    if isinstance(value, trimesh.PointCloud):
        return {"kind": "pointcloud", "summary": pointcloud_summary(value)}

    if isinstance(value, (list, tuple)):
        items = list(value)
        if not items:
            raise ProbeError("阶段输出是空列表")
        meshes = []
        for index, item in enumerate(items):
            mesh = _to_mesh(item)
            if mesh is None:
                raise ProbeError(
                    f"列表第 {index} 项是 {type(item).__name__}，不是 Trimesh/PolyData"
                )
            meshes.append(mesh)
        merged = trimesh.util.concatenate(meshes)
        summary = mesh_summary(merged)
        summary["n_pieces"] = len(meshes)
        return {
            "kind": "mesh_list",
            "summary": summary,
            "pieces": [_piece_row(i, mesh) for i, mesh in enumerate(meshes)],
        }

    mesh = _to_mesh(value)
    if mesh is not None:
        return {"kind": "mesh", "summary": mesh_summary(mesh)}

    raise ProbeError(f"不认识的阶段输出类型 {type(value).__name__}；只支持 {_KINDS}")


def _preview(kind: str, summary: dict) -> dict:
    if kind == "pointcloud":
        return {
            "n_points": summary.get("n_points"),
            "extents": summary.get("extents"),
            "centroid": summary.get("centroid"),
        }
    out = {
        "n_vertices": summary.get("n_vertices"),
        "n_faces": summary.get("n_faces"),
        "volume": summary.get("volume"),
        "area": summary.get("area"),
        "extents": summary.get("extents"),
        "is_watertight": summary.get("is_watertight"),
    }
    if "n_pieces" in summary:
        out["n_pieces"] = summary["n_pieces"]
    return out


def _write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def _clear_stage_files(out_dir: str) -> None:
    """只删本工具产出的 stage*.json，避免上次多出来的段残留。"""
    for name in os.listdir(out_dir):
        if _STAGE_FILE.match(name):
            os.remove(os.path.join(out_dir, name))


def run(payload: dict) -> dict:
    script = os.path.abspath(str(payload.get("script") or "").strip())
    if not script or not os.path.isfile(script):
        raise ProbeError(f"找不到脚本：{script or '(空)'}")

    stem = os.path.splitext(os.path.basename(script))[0]
    out_dir = str(payload.get("out_dir") or "").strip() or os.path.join(os.getcwd(), stem)
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    module = _load_module(script)
    stages = _read_stages(module)
    params = _read_params(module, payload.get("params") or {})

    build = getattr(module, "build", None)
    if not callable(build):
        raise ProbeError("脚本缺少 build(**params, stage=None)")
    if "stage" not in inspect.signature(build).parameters:
        raise ProbeError("build 必须接受 stage 参数：build(**params, stage=None)")

    _clear_stage_files(out_dir)

    started = time.perf_counter()
    records = []
    for index, name in enumerate(stages, 1):
        stage_started = time.perf_counter()
        try:
            value = build(stage=name, **params)
        except TypeError as exc:
            raise ProbeError(
                f"第 {index} 段 {name!r} 调 build 失败：{exc}"
                "（检查 SCHEMA 的参数是否都在 build 签名里）"
            ) from exc

        data = _summarize(value)
        stage_file = os.path.join(out_dir, f"stage{index}.json")
        duration_ms = (time.perf_counter() - stage_started) * 1000.0
        stage_payload = {
            "script": script,
            "script_name": stem,
            "stage": {"index": index, "name": name, "total": len(stages)},
            "params": params,
            "kind": data["kind"],
            "summary": data["summary"],
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "duration_ms": round(duration_ms, 1),
        }
        if "pieces" in data:
            stage_payload["pieces"] = data["pieces"]
        _write_json(stage_file, stage_payload)
        records.append({
            "index": index,
            "name": name,
            "kind": data["kind"],
            "preview": _preview(data["kind"], data["summary"]),
            "file": stage_file,
            "duration_ms": round(duration_ms, 1),
        })

    return {
        "ok": True,
        "script": script,
        "script_name": stem,
        "out_dir": out_dir,
        "params": params,
        "stages": records,
        "duration_ms": round((time.perf_counter() - started) * 1000.0, 1),
    }


def main(argv) -> int:
    if len(argv) != 2:
        sys.stderr.write("ERROR: 用法 python -m meshkit.stage <payload.json>\n")
        return 2

    payload_path = argv[1]
    result_path = ""
    try:
        with open(payload_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        result_path = str(payload.get("result_path") or "").strip()
        result = run(payload)
        if result_path:
            _write_json(result_path, result)
        print(
            "[mesh_probe] %s：%d 段 -> %s"
            % (result["script_name"], len(result["stages"]), result["out_dir"])
        )
        return 0
    except BaseException as exc:
        if result_path:
            try:
                _write_json(result_path, {"ok": False, "error": str(exc)})
            except Exception:
                pass
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
