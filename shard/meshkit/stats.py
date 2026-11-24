# -*- coding: utf-8 -*-
"""纯网格字段计算（meshkit 的 stats 层，API 保持不变）。

meshkit 的 summarize_from_blender 和 fitting 的字段打分共用这一份；
这里不 import bpy、不启动 Blender。
"""

import math
import os

import trimesh

# 支持的格式（交换格式固定 GLB）
SUPPORTED = (".obj", ".stl", ".ply", ".gltf", ".glb")

# ── 拟合开关 ────────────────────────────────────────────────────────────
# 与参考模型对比时只比扁平数值字段；布尔、字符串、数组、嵌套结构不参与。
# 这里是唯一的开关，fitting 侧不要再散写排除逻辑。
FIT_SKIP = {
    "mesh": frozenset({
        "is_watertight",
        "is_winding_consistent",
        "is_volume",
        "manifold_status",
        "units",
        "metadata",
        # 派生字段：报告里给外部工具用，拟合时由 bounds / extents 代算，不重复参与
        "bbox_center",
        "bbox_diagonal",
    }),
    "pointcloud": frozenset({
        "pca_eigenvalues",
        "axis_percentiles",
        "scale",
    }),
}


def fit_fields(summary: dict, kind: str = "mesh") -> list:
    """返回参与参考模型拟合的字段名（扁平数值，不含布尔与 None）。

    字段集合随数据变化（None 值不参与），调用方应在 target 与 trial 间取交集。
    """
    skip = FIT_SKIP.get(kind, frozenset())
    names = []
    for name, value in summary.items():
        if name in skip or isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            names.append(name)
    return names


def _ratio(numerator, denominator):
    """比值字段：分母为 0 或缺失时给 None，不抛异常、不出 inf。"""
    try:
        if not denominator:
            return None
        return float(numerator) / float(denominator)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _plain(value):
    """metadata 里的值尽量保留原类型，只把不认识的转成字符串。"""
    if isinstance(value, (bool, str, int, float)):
        return value
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return item()
        except Exception:
            pass
    return str(value)


def _sphericity(volume, area) -> float:
    """球度 ψ = (36πV²)^(1/3) / A；立方体约 0.806，球为 1。"""
    if not volume or not area or volume <= 0 or area <= 0:
        return None
    return float((36.0 * math.pi * volume * volume) ** (1.0 / 3.0) / area)


def _blender_count(counts, name, fallback) -> int:
    """优先用 Blender 侧的计数（与 Blender 统计面板一致），没有就退回 trimesh 的结果。"""
    if counts:
        value = counts.get(name)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                pass
    return int(fallback)


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
        # process=False：不再二次焊接顶点。Blender 导出的顶点本来就已焊接，
        # 让 trimesh 再合并会改写连通性（is_watertight / body_count / genus 会失真）。
        loaded = trimesh.load(path, process=False)
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


def _sanitize(value):
    """把 NaN/Inf 转成 None，并把 numpy 标量降级成原生类型。

    严格 JSON 不允许 NaN/Infinity，前端 JSON.parse 会直接炸。
    """
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    if isinstance(value, (bool, str, int)) or value is None:
        return value
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _sanitize(item())
        except Exception:
            return str(value)
    return value


def _pick(out: dict, keys, kind: str) -> dict:
    """按 keys 从摘要里挑项；未知项名直接报错并列出全部可用项。"""
    if keys is None:
        return _sanitize(out)
    if isinstance(keys, str):
        keys = [k for k in keys.replace(",", " ").split() if k]
    keys = [str(k).strip() for k in keys if str(k).strip()]
    if not keys:
        return _sanitize(out)
    unknown = [k for k in keys if k not in out]
    if unknown:
        raise ValueError(
            f"fields 里有未知项 {unknown}；{kind} 可用 {len(out)} 项：{list(out)}"
        )
    return {k: _sanitize(out[k]) for k in keys}


def _to_pyvista(mesh) -> "pv.PolyData":
    """trimesh → pyvista 转换（faces 需加 3 前缀）。"""
    import numpy as np
    import pyvista as pv

    faces = np.hstack([np.full((len(mesh.faces), 1), 3), mesh.faces]).astype(np.int64)
    return pv.PolyData(np.asarray(mesh.vertices, dtype=float), faces)


def mesh_summary(mesh, keys=None, counts=None) -> dict:
    """网格摘要：统计级数据，全部是标量/小数组，JSON 友好。

    n_vertices / n_faces / n_edges 用 Blender 侧的原始计数（counts），
    与 Blender 统计面板一致；n_triangles 是 trimesh 三角化后的数量，
    也是下游实际渲染/导出的量。
    """
    import numpy as np
    import manifold3d as m3d

    out = {}

    # ── 计数 ──
    out["n_vertices"] = _blender_count(counts, "n_vertices", len(mesh.vertices))
    out["n_faces"] = _blender_count(counts, "n_faces", len(mesh.faces))
    out["n_edges"] = _blender_count(counts, "n_edges", len(mesh.edges))
    out["n_triangles"] = int(len(mesh.faces))

    # ── 几何度量 ──
    out["bounds"] = mesh.bounds.tolist()
    out["extents"] = mesh.extents.tolist()
    # 包围盒派生量：其他工具直接消费，拟合时不用（见 FIT_SKIP）
    out["bbox_center"] = (
        (np.asarray(mesh.bounds[0]) + np.asarray(mesh.bounds[1])) / 2.0
    ).tolist()
    out["bbox_diagonal"] = float(np.linalg.norm(mesh.extents))
    out["volume"] = float(mesh.volume)
    out["area"] = float(mesh.area)
    out["center_mass"] = mesh.center_mass.tolist()
    try:
        out["principal_inertia_components"] = mesh.principal_inertia_components.tolist()
    except Exception:
        # 退化网格算不出惯性张量（NaN / 特征值不收敛），留空即可，别让整份报告崩掉
        out["principal_inertia_components"] = None

    # ── 面质量（几何节点容易产出退化面 / 瘦长三角形）──
    face_areas = np.asarray(mesh.area_faces, dtype=float)
    live_areas = face_areas[face_areas > 0]
    out["degenerate_faces"] = int(face_areas.size - live_areas.size)
    out["face_area_min"] = float(live_areas.min()) if live_areas.size else 0.0
    out["face_area_mean"] = float(live_areas.mean()) if live_areas.size else 0.0
    out["face_area_max"] = float(live_areas.max()) if live_areas.size else 0.0
    out["face_area_std"] = float(live_areas.std()) if live_areas.size else 0.0
    face_angles = np.asarray(getattr(mesh, "face_angles", []), dtype=float)
    out["face_angle_min_deg"] = (
        float(np.degrees(face_angles.min())) if face_angles.size else None
    )
    edge_lengths = np.asarray(
        getattr(mesh, "edges_unique_length", []), dtype=float
    )
    out["edge_length_min"] = float(edge_lengths.min()) if edge_lengths.size else None
    out["edge_length_mean"] = float(edge_lengths.mean()) if edge_lengths.size else None
    out["edge_length_max"] = float(edge_lengths.max()) if edge_lengths.size else None

    # ── 拓扑属性 ──
    out["euler_number"] = int(mesh.euler_number)
    out["is_watertight"] = bool(mesh.is_watertight)
    out["is_winding_consistent"] = bool(mesh.is_winding_consistent)
    out["is_volume"] = bool(mesh.is_volume)
    out["body_count"] = int(mesh.body_count)

    # ── 凸包 ──
    hull_volume = None
    try:
        hull = mesh.convex_hull
        hull_volume = float(hull.volume)
        out["hull_volume"] = hull_volume
        out["hull_area"] = float(hull.area)
        out["hull_n_vertices"] = int(len(hull.vertices))
    except Exception:
        out["hull_volume"] = None
        out["hull_area"] = None
        out["hull_n_vertices"] = None

    # ── 包围体（退化网格上会算不出来，各自降级为 None）──
    try:
        out["obb_extents"] = mesh.bounding_box_oriented.extents.tolist()
    except Exception:
        out["obb_extents"] = None
    try:
        out["bounding_sphere_radius"] = float(mesh.bounding_sphere.primitive.radius)
    except Exception:
        out["bounding_sphere_radius"] = None
    try:
        out["bounding_cylinder_radius"] = float(
            mesh.bounding_cylinder.primitive.radius
        )
        out["bounding_cylinder_height"] = float(
            mesh.bounding_cylinder.primitive.height
        )
    except Exception:
        out["bounding_cylinder_radius"] = None
        out["bounding_cylinder_height"] = None

    # ── 形状描述符（无量纲比值，便于判断形状像不像）──
    obb = (
        np.asarray(out["obb_extents"], dtype=float)
        if out["obb_extents"]
        else np.zeros(3)
    )
    out["fill_ratio"] = _ratio(out["volume"], float(np.prod(obb)))
    out["solidity"] = _ratio(out["volume"], hull_volume)
    out["sphericity"] = _sphericity(out["volume"], out["area"])
    ordered = np.sort(obb)
    out["elongation"] = _ratio(ordered[1], ordered[2])
    out["flatness"] = _ratio(ordered[0], ordered[1])

    out["units"] = mesh.units
    out["metadata"] = {
        str(k): _plain(v) for k, v in mesh.metadata.items() if k != "_ply_raw"
    }

    # ── pyvista 补充（退化网格可能算不出来，整段降级）──
    try:
        out["n_open_edges"] = int(_to_pyvista(mesh).n_open_edges)
    except Exception:
        out["n_open_edges"] = None

    # ── manifold3d 体检 ──
    try:
        mm = m3d.Manifold(m3d.Mesh(
            vert_properties=np.asarray(mesh.vertices, np.float32),
            tri_verts=np.asarray(mesh.faces, np.uint32),
        ))
        out["manifold_status"] = str(mm.status())
        out["genus"] = int(mm.genus())
    except Exception:
        out["manifold_status"] = "构造失败"
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
        "axis_std": pts.std(axis=0).tolist(),
        "scale": float(np.max(extents)),
    }

    try:
        hull = pc.convex_hull
        out["hull_volume"] = float(hull.volume)
        out["hull_area"] = float(hull.area)
        out["hull_n_vertices"] = int(len(hull.vertices))
    except Exception:
        out["hull_volume"] = None
        out["hull_area"] = None
        out["hull_n_vertices"] = None

    try:
        out["obb_extents"] = pc.bounding_box_oriented.extents.tolist()
    except Exception:
        out["obb_extents"] = None
    try:
        out["bounding_sphere_radius"] = float(pc.bounding_sphere.primitive.radius)
    except Exception:
        out["bounding_sphere_radius"] = None

    # ── 空间结构（PCA）：判断点云是线状 / 面状 / 体状 ──
    centered = pts - pts.mean(axis=0)
    eigenvalues = None
    if len(pts) >= 2:
        cov = np.cov(centered, rowvar=False)
        if np.all(np.isfinite(cov)):
            try:
                eigenvalues = np.sort(np.linalg.eigvalsh(cov))[::-1]
            except np.linalg.LinAlgError:
                eigenvalues = None
    if eigenvalues is None:
        out["pca_eigenvalues"] = None
        out["linearity"] = None
        out["planarity"] = None
        out["scattering"] = None
    else:
        l1, l2, l3 = (float(v) for v in eigenvalues)
        out["pca_eigenvalues"] = [l1, l2, l3]
        out["linearity"] = _ratio(l1 - l2, l1)
        out["planarity"] = _ratio(l2 - l3, l1)
        out["scattering"] = _ratio(l3, l1)

    # ── 各轴分位数：比 mean/std 更能反映分布 ──
    out["axis_percentiles"] = {
        axis: [float(np.percentile(pts[:, i], q)) for q in (5, 25, 50, 75, 95)]
        for i, axis in enumerate("xyz")
    }

    # ── 采样密度：最近邻间距（scipy 缺失时降级为 None）──
    try:
        from scipy.spatial import cKDTree

        distances, _ = cKDTree(pts).query(pts, k=2)
        nearest = np.asarray(distances[:, 1], dtype=float)
        nearest = nearest[np.isfinite(nearest)]
        out["mean_nn_distance"] = float(nearest.mean()) if nearest.size else None
        out["median_nn_distance"] = float(np.median(nearest)) if nearest.size else None
    except Exception:
        out["mean_nn_distance"] = None
        out["median_nn_distance"] = None

    # ── 体素占用：32³ 网格里被点占到的比例，反映填充程度 ──
    resolution = 32
    cell = np.maximum(extents, 1e-12) / float(resolution)
    indices = np.floor((pts - bounds[0]) / cell).astype(np.int64)
    indices = np.clip(indices, 0, resolution - 1)
    occupied = int(len(np.unique(indices, axis=0)))
    out["voxel_occupied"] = occupied
    out["voxel_occupancy"] = float(occupied) / float(resolution ** 3)

    return _pick(out, keys, "pointcloud")
