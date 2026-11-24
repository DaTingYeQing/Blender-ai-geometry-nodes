# -*- coding: utf-8 -*-
"""纯网格字段计算（meshkit 的 stats 层，API 保持不变）。

meshkit 的 summarize_from_blender 和 fitting 的字段打分共用这一份；
这里不 import bpy、不启动 Blender。
"""

import os

import trimesh

# 支持的格式（交换格式固定 GLB）
SUPPORTED = (".obj", ".stl", ".ply", ".gltf", ".glb")


def load_mesh(path: str, keep_instances: bool = False):
    """加载网格/点云文件，返回 trimesh.Trimesh / PointCloud / Scene。"""
    if not os.path.exists(path):
        raise FileNotFoundError(f"找不到文件: {path}")

    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED:
        raise ValueError(
            f"不支持的格式 {ext}，当前支持: {SUPPORTED}。"
            f"FBX/USD 等格式请先在 Blender 里转成 OBJ/STL/PLY/glTF 再导出"
        )

    try:
        loaded = trimesh.load(path)
    except Exception as exc:
        raise RuntimeError(f"加载失败 {path}: {exc}")

    if _is_empty(loaded):
        raise ValueError(
            f"文件 {path} 里没有几何数据。"
            f"注意：Blender 侧导出已自动处理实例/网格/点云；"
            f"曲线/体积/蜡笔等类型 PLY 不支持，需先在 Blender 里转成网格再导出"
        )

    return loaded


def _is_empty(obj) -> bool:
    """判断网格/场景对象是否没有几何数据。"""
    if hasattr(obj, "vertices"):
        return len(obj.vertices) == 0
    if hasattr(obj, "geometry"):  # trimesh.Scene
        return all(_is_empty(g) for g in obj.geometry.values())
    return True


def _pick(out: dict, keys, kind: str) -> dict:
    """按 keys 从摘要里挑项；未知项名直接报错并列出全部可用项。"""
    if keys is None:
        return out
    if isinstance(keys, str):
        keys = [k for k in keys.replace(",", " ").split() if k]
    keys = [str(k).strip() for k in keys if str(k).strip()]
    if not keys:
        return out
    unknown = [k for k in keys if k not in out]
    if unknown:
        raise ValueError(
            f"fields 里有未知项 {unknown}；{kind} 可用 {len(out)} 项：{list(out)}"
        )
    return {k: out[k] for k in keys}


def _to_pyvista(mesh) -> "pv.PolyData":
    """trimesh → pyvista 转换（faces 需加 3 前缀）。"""
    import numpy as np
    import pyvista as pv

    faces = np.hstack([np.full((len(mesh.faces), 1), 3), mesh.faces]).astype(np.int64)
    return pv.PolyData(np.asarray(mesh.vertices, dtype=float), faces)


def mesh_summary(mesh, keys=None) -> dict:
    """网格摘要：统计级数据，全部是标量/小数组，JSON 友好。"""
    import numpy as np
    import manifold3d as m3d

    out = {}

    # ── 计数 ──
    out["n_vertices"] = int(len(mesh.vertices))
    out["n_faces"] = int(len(mesh.faces))
    out["n_edges"] = int(len(mesh.edges))

    # ── 几何度量 ──
    out["bounds"] = mesh.bounds.tolist()
    out["extents"] = mesh.extents.tolist()
    out["volume"] = float(mesh.volume)
    out["area"] = float(mesh.area)
    out["center_mass"] = mesh.center_mass.tolist()
    out["moment_inertia"] = mesh.moment_inertia.tolist()
    out["principal_inertia_components"] = mesh.principal_inertia_components.tolist()
    out["principal_inertia_vectors"] = mesh.principal_inertia_vectors.tolist()

    # ── 拓扑属性 ──
    out["euler_number"] = int(mesh.euler_number)
    out["is_watertight"] = bool(mesh.is_watertight)
    out["is_winding_consistent"] = bool(mesh.is_winding_consistent)
    out["is_volume"] = bool(mesh.is_volume)
    out["body_count"] = int(mesh.body_count)

    # ── 凸包 ──
    hull = mesh.convex_hull
    out["hull"] = {
        "n_vertices": int(len(hull.vertices)),
        "volume": float(hull.volume),
        "area": float(hull.area),
    }

    # ── 包围体 ──
    out["obb_extents"] = mesh.bounding_box_oriented.extents.tolist()
    out["bounding_sphere"] = {
        "center": mesh.bounding_sphere.center.tolist(),
        "radius": float(mesh.bounding_sphere.primitive.radius),
    }
    out["bounding_cylinder"] = {
        "center": mesh.bounding_cylinder.primitive.center.tolist(),
        "radius": float(mesh.bounding_cylinder.primitive.radius),
        "height": float(mesh.bounding_cylinder.primitive.height),
    }
    out["units"] = mesh.units
    out["metadata"] = {
        str(k): str(v) for k, v in mesh.metadata.items() if k != "_ply_raw"
    }

    # ── pyvista 补充 ──
    pm = _to_pyvista(mesh)
    out["n_open_edges"] = int(pm.n_open_edges)
    out["center_of_mass"] = pm.center_of_mass().tolist()
    out["bbox_center"] = list(pm.center)
    out["bbox_diagonal"] = float(pm.length)
    out["array_names"] = list(pm.array_names)
    conn = pm.connectivity()
    out["n_connected_components"] = int(len(np.unique(conn["RegionId"])))

    # ── manifold3d 体检 ──
    try:
        mm = m3d.Manifold(m3d.Mesh(
            vert_properties=np.asarray(mesh.vertices, np.float32),
            tri_verts=np.asarray(mesh.faces, np.uint32),
        ))
        out["manifold_status"] = str(mm.status())
        out["manifold_verts"] = int(mm.num_vert())
        out["manifold_tris"] = int(mm.num_tri())
        out["genus"] = int(mm.genus())
    except Exception:
        out["manifold_status"] = "构造失败"
        out["manifold_verts"] = None
        out["manifold_tris"] = None
        out["genus"] = None

    return _pick(out, keys, "mesh")


def pointcloud_summary(pc, keys=None) -> dict:
    """点云摘要：纯统计，不回点坐标。"""
    import numpy as np

    pts = np.asarray(pc.vertices, dtype=float)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"pointcloud_summary 需要 (N,3) 点云，实际形状 {pts.shape}")
    if len(pts) == 0:
        raise ValueError("pointcloud_summary 收到空点云")

    bounds = np.asarray(pc.bounds, dtype=float)
    extents = bounds[1] - bounds[0]

    out = {
        "n_points": int(len(pts)),
        "bounds": bounds.tolist(),
        "extents": extents.tolist(),
        "centroid": pts.mean(axis=0).tolist(),
        "axis_mean": pts.mean(axis=0).tolist(),
        "axis_std": pts.std(axis=0).tolist(),
        "scale": float(pc.scale),
    }

    try:
        hull = pc.convex_hull
        out["hull"] = {
            "n_vertices": int(len(hull.vertices)),
            "volume": float(hull.volume),
            "area": float(hull.area),
        }
    except Exception:
        out["hull"] = None

    try:
        out["obb_extents"] = pc.bounding_box_oriented.extents.tolist()
    except Exception:
        out["obb_extents"] = None
    try:
        out["bounding_sphere"] = {
            "center": pc.bounding_sphere.center.tolist(),
            "radius": float(pc.bounding_sphere.primitive.radius),
        }
    except Exception:
        out["bounding_sphere"] = None

    return _pick(out, keys, "pointcloud")
