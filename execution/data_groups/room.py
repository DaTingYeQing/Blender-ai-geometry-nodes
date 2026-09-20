"""room — 数据注册 + 计算
内部按功能分小隔间，每个隔间独立、互不干扰。
加新隔间 = 在 run() 里加一段代码。
"""
from ._utils import walk_path, calc_stats, bbox, decompose_matrix, transform_point, decompose_matrix_euler

# 隔间4「实例包围盒」逐实例明细的显示条数上限。
# 全量 per-instance bbox 是 N 条（实例数），逐帧再 × 帧数 → 返回值会被撑爆。
# 只显示前 N 条，其余用「每个世界坐标省略」标出省略条数；
# 「整体世界坐标」仍覆盖全部实例，所以"有没有变化"不会漏检。
INST_BBOX_SHOW = 10


def _transform_stats(decomposed_list):
    """从分解后的矩阵列表提取 trans/scale/rot 的统计 + top5。"""
    if not decomposed_list or not isinstance(decomposed_list, list):
        return None
    trans = [x["translation"] for x in decomposed_list]
    scale = [x["scale"] for x in decomposed_list]
    rot = [x["rotation"] for x in decomposed_list]
    return {
        "translations": {**calc_stats(trans), "top5": trans[:5]},
        "scales":       {**calc_stats(scale), "top5": scale[:5]},
        "rotations":    {**calc_stats(rot),   "top5": rot[:5]},
        "count": len(decomposed_list),
    }


def run(transfer_baseline, transfer_modified):
    """遍历所有小隔间，收齐结果。"""
    results = {}

    # === 小隔间1: 数字摘要（纯搬运） ===
    room_digest = {}
    for key, path in [
        ("num_vertices",  "烘焙项/0/data/mesh/num_vertices"),
        ("num_edges",     "烘焙项/0/data/mesh/num_edges"),
        ("num_polygons",  "烘焙项/0/data/mesh/num_polygons"),
        ("num_points",    "烘焙项/0/data/pointcloud/num_points"),
        ("num_instances", "烘焙项/0/data/num_instances"),
    ]:
        base = walk_path(transfer_baseline, path)
        mod = walk_path(transfer_modified, path)
        if base is not None or mod is not None:
            room_digest[key] = {"baseline": base, "modified": mod}
    results["数字摘要"] = room_digest

    # === 小隔间2: 位置统计（合并 mesh/pointcloud/curves 的 position，含包围盒+统计） ===
    # 实例的包围盒无法直接计算（需模板几何体 × 变换矩阵），跳过
    def _collect_positions(transfer):
        pos = []
        for p in [
            "烘焙项/0/data/mesh/attributes[position]/value",
            "烘焙项/0/data/pointcloud/attributes[position]/value",
            "烘焙项/0/data/curves/attributes[position]/value",
        ]:
            data = walk_path(transfer, p)
            if data:
                pos.extend(data)
        return pos if pos else None

    base_pos = _collect_positions(transfer_baseline)
    mod_pos = _collect_positions(transfer_modified)
    if base_pos is not None or mod_pos is not None:
        def _pos_stats(transfer, pos):
            out = {"局部": calc_stats(pos) if pos else None}
            obj_m = walk_path(transfer, "烘焙项/0/data/__object_matrix__")
            if obj_m and pos:
                world_pts = [transform_point(obj_m, p) for p in pos]
                out["世界包围盒"] = bbox(world_pts)
                dec = decompose_matrix_euler(obj_m)
                out["旋转"] = dec["euler"]
                out["缩放"] = dec["scale"]
                out["位移"] = dec["translation"]
            return out
        results["位置统计"] = {
            "baseline": _pos_stats(transfer_baseline, base_pos),
            "modified": _pos_stats(transfer_modified, mod_pos),
        }

    # === 小隔间3: 实例变换（统计 + top5） ===
    base_xform = walk_path(transfer_baseline, "烘焙项/0/data/实例属性[instance_transform]/value")
    mod_xform = walk_path(transfer_modified, "烘焙项/0/data/实例属性[instance_transform]/value")
    if base_xform is not None or mod_xform is not None:
        room_xform = {}
        if base_xform:
            room_xform["baseline"] = _transform_stats(decompose_matrix(base_xform))
        if mod_xform:
            room_xform["modified"] = _transform_stats(decompose_matrix(mod_xform))
        results["实例变换"] = room_xform

    # === 小隔间4: 实例包围盒（模板局部 + 实例世界坐标） ===
    def _instance_bboxes(transfer):
        # 1. 读所有模板 position（局部坐标）
        refs = []
        for i in range(100):
            pos = walk_path(transfer, "烘焙项/0/data/references/%d/mesh/attributes[position]/value" % i)
            if pos is None:
                break
            refs.append(pos)
        if not refs:
            return None
        # 2. 读实例变换矩阵 + 引用索引
        xforms = walk_path(transfer, "烘焙项/0/data/实例属性[instance_transform]/value")
        if not xforms:
            return None
        ref_idx = walk_path(transfer, "烘焙项/0/data/实例属性[.reference_index]/value")
        # 3. 逐个实例：局部顶点 × 矩阵 → 世界坐标
        per = []
        all_pts = []
        for i, m in enumerate(xforms):
            r = ref_idx[i] if ref_idx and i < len(ref_idx) else 0
            if not (0 <= r < len(refs)):
                r = 0
            pts = [transform_point(m, p) for p in refs[r]]
            all_pts.extend(pts)
            per.append(bbox(pts))
        # 模板局部坐标（合并所有模板）
        tpl_pts = [p for ref in refs for p in ref]
        return {
            "数量": len(xforms),
            "模板局部坐标": bbox(tpl_pts) if tpl_pts else None,
            "整体世界坐标": bbox(all_pts) if all_pts else None,
            "每个世界坐标": per[:INST_BBOX_SHOW],
            "每个世界坐标省略": max(0, len(per) - INST_BBOX_SHOW),
        }

    base_inst = _instance_bboxes(transfer_baseline)
    mod_inst = _instance_bboxes(transfer_modified)
    if base_inst is not None or mod_inst is not None:
        results["实例包围盒"] = {
            "baseline": base_inst,
            "modified": mod_inst,
        }

    # === (后续加新隔间直接在这里加) ===

    return results