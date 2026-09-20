"""几何模式：单帧 双轮烘焙 → room.diff；动画 单轮 ANIMATION → 逐帧统计。"""
import sys
import os

# 让 blenderdata2.0/ 可导入（供 room, _diff 使用）
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE not in sys.path:
    sys.path.insert(0, _BASE)

from data_groups import room, _diff
from _bake_utils import ensure_probe_bake, wire_bake, bake_round
from _node_utils import resolve_node, apply_sets, parse_frames, node_in_zone_kind


def _inject_matrix(obj, json):
    """把物体世界矩阵（列主序 16 float）塞进烘焙 json，供 room 算世界坐标/旋转/缩放/位移。"""
    obj_matrix = [obj.matrix_world[c][r] for c in range(4) for r in range(4)]
    json["烘焙项"]["0"]["data"]["__object_matrix__"] = obj_matrix
    return json


def _collapse_room_side(room_result):
    """room.run(帧,帧) 的 baseline==modified → 折叠成单侧统计。
    room 输出两种形态：逐 key 的 {k: {baseline, modified}}，或顶层 {baseline, modified}。"""
    out = {}
    for section, body in room_result.items():
        if isinstance(body, dict) and "baseline" in body:
            out[section] = body.get("baseline")
        elif isinstance(body, dict):
            out[section] = {k: (v.get("baseline") if isinstance(v, dict) and "baseline" in v else v)
                            for k, v in body.items()}
        else:
            out[section] = body
    return out


def _flatten_stats(d, prefix=""):
    """把统计 dict 压平成 {点分路径: 值}，便于跨帧对比。"""
    out = {}
    if isinstance(d, dict):
        for k, v in d.items():
            p = "%s.%s" % (prefix, k) if prefix else k
            out.update(_flatten_stats(v, p))
    else:
        out[prefix] = d
    return out


def _geometry_animation(tree, mod, obj, out_root, bake, frame_range, payload):
    """动画：单轮 ANIMATION 烘焙 → 每帧 room 统计 → 只输出跨帧有变化的统计项。"""
    start, end = frame_range
    try:
        frames_json, _ = bake_round(tree, mod, obj, out_root, bake,
                                    bake_mode="ANIMATION",
                                    frame_start=start, frame_end=end)
    except Exception as e:
        return {"ok": False, "error": "动画烘焙失败: %s" % e}

    frames_avail = []
    series = {}  # 点分路径 -> 逐帧值列表（与 frames_avail 对齐）
    for fr in range(start, end + 1):
        j = frames_json.get(fr)
        if j is None:
            continue
        _inject_matrix(obj, j)
        flat = _flatten_stats(_collapse_room_side(room.run(j, j)))
        frames_avail.append(fr)
        for p, v in flat.items():
            series.setdefault(p, []).append(v)

    if not frames_avail:
        return {"ok": False, "error": "动画烘焙没有产出帧数据（%d-%d）" % (start, end)}

    result = {"ok": True, "mode": "geometry", "动画": True,
              "帧范围": "%d-%d" % (start, end), "帧": frames_avail}
    if payload.get("sets"):
        result["提示"] = "动画模式已忽略 sets（只看自然演化）"

    # 只保留跨帧有变化的统计项，按隔间分块输出
    sections = {}
    for p, vals in series.items():
        first = vals[0]
        if any(v != first for v in vals[1:]):
            head, _, tail = p.partition(".")
            sections.setdefault(head, {})[tail if tail else head] = vals
    for section, body in sections.items():
        result[section] = body
    return result


def _geometry_single(tree, mod, obj, out_root, bake, payload):
    """单帧：双轮烘焙 baseline/set/modified → room.diff。"""
    baseline_dir = os.path.join(out_root, "baseline")
    modified_dir = os.path.join(out_root, "modified")

    # 轮1：基准
    try:
        base_json, _ = bake_round(tree, mod, obj, baseline_dir, bake)
    except Exception as e:
        return {"ok": False, "error": "基准轮失败: %s" % e}

    # 应用 sets
    set_errors, _ = apply_sets(tree, mod, payload.get("sets", []))
    if set_errors:
        return {"ok": False, "error": "set 失败: %s" % "；".join(set_errors)}

    # 轮2：改值
    try:
        mod_json, _ = bake_round(tree, mod, obj, modified_dir, bake)
    except Exception as e:
        return {"ok": False, "error": "改值轮失败: %s" % e}

    _inject_matrix(obj, base_json)
    _inject_matrix(obj, mod_json)

    room_result = room.run(base_json, mod_json)
    diff_result = _diff.diff(room_result)

    return {"ok": True, "mode": "geometry", "diff": diff_result}


def geometry_run(tree, mod, obj, payload, out_root):
    """几何模式：
    - 无 frames：双轮烘焙 → room.run() → _diff.diff()（单帧改值对比）
    - 有 frames：单轮 ANIMATION → 每帧统计 → 只输出跨帧有变化的统计项（逐帧演化）
    返回 {ok, mode, diff|逐帧统计} 或 {ok: False, error}。"""
    node = resolve_node(tree, payload.get("node", ""))
    if node is None:
        return {"ok": False, "error": "找不到节点 %r" % payload.get("node")}

    geo_socket = next((s for s in node.outputs if s.bl_idname == "NodeSocketGeometry"), None)
    if geo_socket is None:
        return {"ok": False, "error": "%s 无几何输出" % node.name}

    frame_range, ferr = parse_frames(payload.get("frames"))
    if ferr is not None:
        return {"ok": False, "error": ferr}

    # 单帧且目标在区域内部时 STILL 烤不出来 → 先检查（此时原线未动，BFS 畅通），报错让 AI 用动画
    if frame_range is None:
        for kind in ("simulation", "repeat", "foreach"):
            if node_in_zone_kind(tree, node, kind) is not None:
                return {"ok": False,
                        "error": "目标节点 %r 位于 %s 区域内部，该区域烘焙只能按帧(动画)，请传 frames 如 \"1-15\""
                                 % (node.name, kind)}

    # 检查通过后再装配 bake（旁接，不动原链）
    bake = ensure_probe_bake(tree)
    setup_errs = wire_bake(tree, bake, geo_socket)
    if setup_errs:
        return {"ok": False, "error": "装配失败: %s" % "；".join(setup_errs)}

    if frame_range is not None:
        return _geometry_animation(tree, mod, obj, out_root, bake, frame_range, payload)
    return _geometry_single(tree, mod, obj, out_root, bake, payload)
