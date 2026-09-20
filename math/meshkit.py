"""meshkit.py — 网格工具统一封装

用法：把本文件放在 math 目录，AI 脚本与它同目录运行即可：
    import meshkit
    mesh = meshkit.load_mesh("model.glb")
    summ = meshkit.summarize_from_blender(
        "scene.blend", "Cube", "GN_修改器", "合并几何",
        summary="统计点云 out(pointcloud)",
    )

原则：只暴露「输入 → 输出」，内部选库/转换/错误处理全部封装。
摘要走"小房间"模式：mesh_summary / pointcloud_summary 各自独立，
统一入口 summarize_from_blender 负责分发（AI 只调它）。
"""
import os
import re
import subprocess
import sys
import tempfile

import trimesh

# ── Blender 程序位置：优先环境变量，其次同目录的 envcard（地址卡片）──
# 不写死任何路径：换机器只改 py_environment.json，这里自动跟着变。
_OWN_DIR = os.path.dirname(os.path.abspath(__file__))
if _OWN_DIR not in sys.path:
    sys.path.insert(0, _OWN_DIR)  # 保证能 import 到同目录的 envcard

_ENVCARD_IMPORT_ERROR = None
try:
    from envcard import BLENDER_EXE as _ENVCARD_BLENDER_EXE
except Exception as _envcard_exc:  # 卡片没生成也不让 import 崩，等真正用时再提示
    _ENVCARD_BLENDER_EXE = None
    _ENVCARD_IMPORT_ERROR = "%s: %s" % (type(_envcard_exc).__name__, _envcard_exc)

BLENDER_EXE = (os.environ.get("BLENDER_EXE") or "").strip() or _ENVCARD_BLENDER_EXE

# 环境分发器 pyenv.py 的位置（本文件在 skills/math/，它在 skills/_shared/）
_SHARED_PYENV = os.path.join(os.path.dirname(_OWN_DIR), "_shared", "pyenv.py")

# Blender 侧导出脚本（与 meshkit 同目录）
EXPORT_SCRIPT = os.path.join(_OWN_DIR, "export_by_name.py")


def _require_blender_exe() -> str:
    """取 blender.exe 路径；取不到就给一条能照着做的中文报错。"""
    if BLENDER_EXE and str(BLENDER_EXE).strip():
        return str(BLENDER_EXE).strip()
    detail = ("\n（读取环境卡片失败：%s）" % _ENVCARD_IMPORT_ERROR) if _ENVCARD_IMPORT_ERROR else ""
    raise RuntimeError(
        "找不到 blender.exe 的路径。\n"
        "请先运行下面这条命令，重新生成环境卡片：\n"
        "    python %s\n"
        "然后再试一次。%s" % (_SHARED_PYENV, detail)
    )

# 支持的格式（交换格式固定 GLB）
SUPPORTED = (".obj", ".stl", ".ply", ".gltf", ".glb")


def load_mesh(path: str, keep_instances: bool = False):
    """加载网格/点云文件。

    输入：文件路径（Blender 导出的 .ply / .glb 等）
    输出：按文件实际内容返回自然类型：
        - 含面的网格文件 → trimesh.Trimesh
        - 纯顶点（点云）→ trimesh.points.PointCloud
        - 多物体场景 → trimesh.Scene

    keep_instances 参数保留仅为兼容，现在总是返回自然类型（不再强制合并网格）。
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"找不到文件: {path}")

    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED:
        raise ValueError(
            f"不支持的格式 {ext}，当前支持: {SUPPORTED}。"
            f"FBX/USD 等格式请先在 Blender 里转成 OBJ/STL/PLY/glTF 再导出"
        )

    try:
        loaded = trimesh.load(path)  # 自然类型：Trimesh / PointCloud / Scene
    except Exception as e:
        raise RuntimeError(f"加载失败 {path}: {e}")

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


def export_from_blender(
    blend_path: str,
    object_name: str,
    modifier_name: str,
    node_name: str,
    out_path: str = None,
    summary: str = None,
    frame: int = None,
):
    """从 Blender 按「物体 + 几何节点」导出并加载（GeometrySet 全量模式）。

    输入：
        blend_path    .blend 文件路径
        object_name   Blender 里的物体名字（Object name）
        modifier_name 几何节点修改器名字（**必填**，AI 需先查场景确定）
        node_name     几何节点名字（**必填**，AI 指定导出点；填 "LIST" 只返回节点清单）
        out_path      输出文件路径（默认临时目录，扩展名 .ply）；
                      网格与点云共存时，点云自动写到 <输出>_points.ply
        summary       要探测什么数据（**必填**，AI 描述本次分析意图；为空直接报错）
        frame         要导出的帧号（可选）。不填 → 场景当前帧；填 N → 先从第 1 帧逐帧
                      推进到第 N 帧再导出。模拟区 / For Each 求值【有状态】，跳帧拿到的
                      是第 1 帧的数据（实测），所以必须逐帧走（约 0.25ms/帧）。

    返回：
        dict: {
            "components": [实际导出的分量名列表，如 "mesh" / "pointcloud"],
            "mesh":       trimesh.Trimesh 或 None，
            "pointcloud": trimesh.points.PointCloud 或 None，
            "files":      {分量名: 文件绝对路径}，
            "skipped":    [跳过的不支持分量，如 "curves" / "volume"]，
        }
        node_name == "LIST" 时返回 {"nodes": [节点清单字符串列表]}。

    内部：调用 Blender 无头模式：组输出改接到指定节点 → 检测到实例自动 Realize →
          分量自动分文件导出（PLY，手工写文件保留拓扑）→ 读回。
    AI 用法：递交路径 + 物体名 + 修改器名 + 节点名 + 分析意图即可。
    """
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
        # 显式 utf-8 解码（Blender 输出 UTF-8；Windows 默认 gbk 会崩）
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300,
            encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Blender 导出超时（300 秒），可能场景过大或 Blender 卡住: {blend_path}")

    # 脚本异常时 Blender 的退出码可能是 0（实测），所以不能只看 returncode：
    # 一旦 stdout/stderr 里有 traceback 就是脚本炸了，直接报错。
    _combined = (result.stdout or "") + (result.stderr or "")
    if result.returncode != 0 or "Traceback (most recent call last)" in _combined:
        raise RuntimeError(
            f"Blender 导出失败: {blend_path} / '{object_name}'\n"
            f"（Blender 退出码 {result.returncode}，但它脚本异常时也可能返回 0，看 traceback 才准）\n"
            f"{result.stdout}\n{result.stderr}"
        )

    # LIST 模式：只返回节点清单
    if node_name == "LIST":
        nodes = [ln[5:] for ln in result.stdout.splitlines() if ln.startswith("NODE ")]
        return {"nodes": nodes}

    # 解析脚本输出：分量 → 文件路径，以及跳过的不支持分量
    files = {}
    skipped = []
    for ln in result.stdout.splitlines():
        if ln.startswith("文件["):
            label = ln[3:ln.index("]")]
            path = ln[ln.index(":") + 1:].strip()
            files[label] = path
        elif ln.startswith("警告: 检测到"):
            skipped.append(ln.split("分量")[0].replace("警告: 检测到", "").strip())

    loaded = {label: load_mesh(path) for label, path in files.items()}
    return {
        "components": list(files.keys()),
        "mesh": loaded.get("mesh"),
        "pointcloud": loaded.get("pointcloud"),
        "files": files,
        "skipped": skipped,
    }


def _to_pyvista(mesh) -> "pv.PolyData":
    """trimesh → pyvista 转换（内部封装：faces 需加 3 前缀，否则报错）"""
    import numpy as np
    import pyvista as pv

    faces = np.hstack([np.full((len(mesh.faces), 1), 3), mesh.faces]).astype(np.int64)
    return pv.PolyData(np.asarray(mesh.vertices, dtype=float), faces)


def mesh_summary(mesh) -> dict:
    """网格摘要（"小房间"之一）：统计级摘要，不含全量数组（坐标/拓扑/逐元素）。

    输入：trimesh.Trimesh（由 load_mesh / export_from_blender 得到）
    输出：dict —— 全部是标量/小数组，JSON 友好，不会刷爆上下文

    AI 不直接调本函数，统一走 summarize_from_blender 入口。
    """
    import numpy as np
    import manifold3d as m3d

    out = {}

    # ── 计数 ──
    out["n_vertices"] = int(len(mesh.vertices))
    out["n_faces"] = int(len(mesh.faces))
    out["n_edges"] = int(len(mesh.edges))

    # ── 几何度量（trimesh 现成 API）──
    out["bounds"] = mesh.bounds.tolist()                 # AABB 包围盒 [min, max]
    out["extents"] = mesh.extents.tolist()               # 包围盒长宽高
    out["volume"] = float(mesh.volume)                   # 体积
    out["area"] = float(mesh.area)                       # 表面积
    out["center_mass"] = mesh.center_mass.tolist()       # 质心
    out["moment_inertia"] = mesh.moment_inertia.tolist()  # 惯性张量
    out["principal_inertia_components"] = mesh.principal_inertia_components.tolist()
    out["principal_inertia_vectors"] = mesh.principal_inertia_vectors.tolist()

    # ── 拓扑属性（trimesh 现成 API）──
    out["euler_number"] = int(mesh.euler_number)         # 欧拉示性数
    out["is_watertight"] = bool(mesh.is_watertight)      # 水密性
    out["is_winding_consistent"] = bool(mesh.is_winding_consistent)
    out["is_volume"] = bool(mesh.is_volume)              # 是否有效体积
    out["body_count"] = int(mesh.body_count)             # 独立壳体数

    # ── 凸包（trimesh 现成 API）──
    hull = mesh.convex_hull
    out["hull"] = {
        "n_vertices": int(len(hull.vertices)),
        "volume": float(hull.volume),
        "area": float(hull.area),
    }

    # ── 包围体（trimesh 现成 API）──
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
    out["units"] = mesh.units  # 单位（可能为 None）
    # 元数据过滤加载残留（_ply_raw 含全量坐标），其余转字符串保证 JSON 安全
    out["metadata"] = {str(k): str(v) for k, v in mesh.metadata.items() if k != "_ply_raw"}

    # ── pyvista 补充（开放边 / 连通分量 / 质心 / 对角线）──
    pm = _to_pyvista(mesh)
    out["n_open_edges"] = int(pm.n_open_edges)
    out["center_of_mass"] = pm.center_of_mass().tolist()
    out["bbox_center"] = list(pm.center)  # 包围盒中心（与质心不同）
    out["bbox_diagonal"] = float(pm.length)
    out["array_names"] = list(pm.array_names)  # 网格带的所有属性数组名（无则为空列表）
    conn = pm.connectivity()
    out["n_connected_components"] = int(len(np.unique(conn["RegionId"])))

    # ── manifold3d 体检：流形状态 + 精化拓扑 + 亏格 ──
    try:
        mm = m3d.Manifold(m3d.Mesh(
            vert_properties=np.asarray(mesh.vertices, np.float32),
            tri_verts=np.asarray(mesh.faces, np.uint32),
        ))
        out["manifold_status"] = str(mm.status())   # Error.NoError / Error.NotManifold（流形体检）
        out["manifold_verts"] = int(mm.num_vert())  # 精化后顶点数（对比 n_vertices 查修复量）
        out["manifold_tris"] = int(mm.num_tri())    # 精化后三角形数（同上）
        out["genus"] = int(mm.genus())
    except Exception:
        out["manifold_status"] = "构造失败"
        out["manifold_verts"] = None
        out["manifold_tris"] = None
        out["genus"] = None  # 非流形网格无法构造 Manifold

    return out


def pointcloud_summary(pc) -> dict:
    """点云摘要（"小房间"之二）：纯统计，不回点坐标（大点云全量坐标会刷爆上下文）。

    输入：trimesh.points.PointCloud（由 load_mesh / export_from_blender 得到）
    输出：dict —— 统计摘要，JSON 友好；字段命名与 mesh_summary 对齐（hull/obb_extents/bounding_sphere）

    AI 不直接调本函数，统一走 summarize_from_blender 入口。
    """
    import numpy as np

    pts = np.asarray(pc.vertices, dtype=float)  # trimesh PointCloud 点存在 .vertices（5.0 起独立于 Trimesh）
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"pointcloud_summary 需要 (N,3) 点云，实际形状 {pts.shape}")
    if len(pts) == 0:
        raise ValueError("pointcloud_summary 收到空点云")

    bounds = np.asarray(pc.bounds, dtype=float)
    extents = bounds[1] - bounds[0]

    out = {
        "n_points": int(len(pts)),
        "bounds": bounds.tolist(),        # AABB [min, max]
        "extents": extents.tolist(),      # 包围盒长宽高
        "centroid": pts.mean(axis=0).tolist(),  # 质心（= 坐标均值）
        "axis_mean": pts.mean(axis=0).tolist(),
        "axis_std": pts.std(axis=0).tolist(),
        "scale": float(pc.scale),         # 包围盒对角线
    }

    # 凸包（退化点云算不了 → None，与 mesh_summary 的 genus 防护同风格）
    try:
        hull = pc.convex_hull
        out["hull"] = {
            "n_vertices": int(len(hull.vertices)),
            "volume": float(hull.volume),
            "area": float(hull.area),
        }
    except Exception:
        out["hull"] = None

    # OBB / 包围球（同防护）
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

    return out


# 摘要类型注册表（"小房间"模式：新增类型 = 写一个 xxx_summary 函数 + 这里加一行）
_SUMMARY_TYPES = {"mesh": mesh_summary, "pointcloud": pointcloud_summary}
# 无摘要路径的类型：静态短路，不启动 Blender 直接回 type_unsupported
_UNSUPPORTED_SUMMARY_TYPES = ("curves", "volume")

# AI 在 summary 里写 out("xxx") 指定类型：兼容裸词/带引号/单双引号/空格，忽略大小写
_OUT_RE = re.compile(r"out\s*\(\s*['\"]?([a-zA-Z]+)['\"]?\s*\)", re.IGNORECASE)


def _parse_out(summary: str):
    """从 summary 解析 out("xxx") 指定的类型；没写 out() → None。"""
    m = _OUT_RE.search(summary)
    return m.group(1).lower() if m else None


def summarize_from_blender(
    blend_path: str,
    object_name: str,
    modifier_name: str,
    node_name: str,
    summary: str = None,
    frame: int = None,
) -> dict:
    """从 Blender 按「物体 + 几何节点」取摘要（统一入口，AI 只调这个，一步返回）。

    输入：
        blend_path    .blend 文件绝对路径
        object_name   Blender 里的物体名字（Object name）
        modifier_name 几何节点修改器名字（**必填**）
        node_name     几何节点名字（**必填**，AI 指定导出点；填 "LIST" 只返回节点清单）
        summary       要探测什么数据（**必填**，AI 描述意图；用 out("xxx") 指定类型，
                      如 "统计点云 out(pointcloud)"；没写 out() → 全返回）
        frame         要取哪一帧的数据（可选）。不填 → 场景当前帧；填 N → 先从第 1 帧
                      逐帧推进到第 N 帧。模拟区是有状态的，跳帧拿不到第 N 帧的数据。

    返回：
        {
            "status":    "ok" | "type_not_found" | "type_unsupported",
            "requested": AI 要的类型（out() 里的值；没写 → "all"），
            "available": 求值结果里实际存在的分量列表；type_unsupported 时为 None，
                         导出失败（求值结果空）时为 []，
            "summary":   status=ok 时的摘要：
                         all 模式 → {分量名: 摘要}；否则 → 该类型的摘要 dict，
                         其他 status → None
        }
    """
    if summary is None or not str(summary).strip():
        raise ValueError("请写要探测什么数据（summary 必填）。")

    # 类型只从 summary 里的 out("xxx") 解析；没写 → all 全返回
    data_type = _parse_out(summary) or "all"

    # LIST 模式：透传节点清单（不走摘要）
    if node_name == "LIST":
        return export_from_blender(
            blend_path, object_name, modifier_name, node_name,
            out_path=None, summary=summary, frame=frame,
        )

    # 无摘要路径的类型：静态短路，不启动 Blender
    if data_type in _UNSUPPORTED_SUMMARY_TYPES:
        return {"status": "type_unsupported", "requested": data_type, "available": None, "summary": None}

    if data_type != "all" and data_type not in _SUMMARY_TYPES:
        raise ValueError(f"未知数据类型 '{data_type}'，可选: mesh / pointcloud / curves / volume / all")

    try:
        result = export_from_blender(
            blend_path, object_name, modifier_name, node_name,
            out_path=None, summary=summary, frame=frame,
        )
    except RuntimeError as e:
        # 导出脚本的"没有此类型"（求值结果空）→ 转译成 type_not_found，其余错误继续抛
        if "没有此类型" in str(e):
            return {"status": "type_not_found", "requested": data_type, "available": [], "summary": None}
        raise

    if data_type == "all":
        summaries = {}
        for comp in result["components"]:
            summaries[comp] = _SUMMARY_TYPES[comp](result[comp])
        return {"status": "ok", "requested": "all", "available": result["components"], "summary": summaries}

    if data_type not in result["components"]:
        return {"status": "type_not_found", "requested": data_type, "available": result["components"], "summary": None}

    return {
        "status": "ok",
        "requested": data_type,
        "available": result["components"],
        "summary": _SUMMARY_TYPES[data_type](result[data_type]),
    }


# ── 后续函数计划（按需逐个添加）──────────────────────────
# boolean(a, b, op)   布尔运算（并/交/差）
# self_intersections  自交检测
# save_mesh(mesh, path)  导出
# curve_summary()     曲线摘要（"小房间"模式：新函数 + _SUMMARY_TYPES 加一行）
