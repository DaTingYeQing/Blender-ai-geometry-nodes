"""数值模式：读取指定函数节点指定 socket 的数值。

规则：
- AI 用 "节点名.插座名" 指定要读的 socket。
- 未连线的输入 → 直接读 default_value（单值）。
- 已连线的输入 / 输出 → 接进探针烘焙，再分类：
    * 单值 → 返回 {"类型": "单值", "值": ...}
    * 字段（依赖几何）→ 返回 {"类型": "字段", "提示": ...}，请去几何模式。
- 目标 socket 位于模拟区内部 → 自动经模拟输出新增项"逃逸"到外部烘焙。
- 位于重复 / foreach 区域内部 → 暂不支持，报错。
"""
import bpy
import mathutils

from _node_utils import (resolve_node, find_socket, sock_base_type, group_input_geo,
                         group_output_geo, parse_frames, reachable_from, node_in_zone_kind)
from _bake_utils import ensure_probe_bake, bake_round

FIELD_NOTE = "依赖几何的字段，给不出单值，请在几何模式查看统计"


def _socket_to_bake_type(bl_idname):
    """socket bl_idname → bake item 的 socket_type 枚举标识。"""
    base = sock_base_type(bl_idname)
    return {
        "Float": "FLOAT",
        "Int": "INT",
        "Bool": "BOOLEAN",
        "Vector": "VECTOR",
        "Color": "RGBA",
        "Rotation": "ROTATION",
        "Matrix": "MATRIX",
        "String": "STRING",
    }.get(base)


# ==================== 模拟区逃逸 ====================

def _escape_through_zone(tree, zone, src_sock, stype, ident):
    """把模拟区内部的 socket 值经模拟输出新增 state 项逃逸到外部。
    返回 (out_sock, cleanups)；失败返回 (None, [])。
    cleanups: [(output_node, item)]，烘焙后需删除还原。"""
    _, output_node = zone
    try:
        item = output_node.state_items.new(socket_type=stype, name="__bd_esc_%d" % ident)
    except Exception:
        return None, []
    tree.update_tag()
    in_sock = out_sock = None
    for s in output_node.inputs:
        if s.name == item.name:
            in_sock = s
            break
    for s in output_node.outputs:
        if s.name == item.name:
            out_sock = s
            break
    if in_sock is None or out_sock is None:
        try:
            output_node.state_items.remove(item)
        except Exception:
            pass
        return None, []
    try:
        tree.links.new(src_sock, in_sock)
    except Exception:
        try:
            output_node.state_items.remove(item)
        except Exception:
            pass
        return None, []
    return out_sock, [(output_node, item)]


def _cleanup_escapes(cleanups):
    """删除逃逸新增的 state 项（连同其 socket 和连线）。"""
    for output_node, item in cleanups:
        try:
            output_node.state_items.remove(item)
        except Exception:
            pass


# ==================== 收集目标 ====================

def _collect_targets(tree, refs):
    """解析 "节点名.插座名" 列表。
    返回 (targets, direct, errors)：
    - targets: [(node_name, sock_name, src_sock, is_input)] 需烘焙
    - direct:  [(node_name, sock_name, value)] 未连线输入直接读
    """
    targets, direct, errors = [], [], []
    for ref in refs:
        ref = str(ref).strip()
        if "." not in ref:
            errors.append("指定格式应为 节点名.插座名，收到 %r" % ref)
            continue
        node_ref, sock_ref = ref.rsplit(".", 1)
        node = resolve_node(tree, node_ref)
        if node is None:
            errors.append("找不到节点 %r" % node_ref)
            continue
        sock = None
        is_input = None
        for s in node.inputs:
            if s.name == sock_ref or s.identifier == sock_ref:
                sock, is_input = s, True
                break
        if sock is None:
            for s in node.outputs:
                if s.name == sock_ref or s.identifier == sock_ref:
                    sock, is_input = s, False
                    break
        if sock is None:
            errors.append("节点 %r 无插座 %r" % (node.name, sock_ref))
            continue
        if sock.bl_idname == "NodeSocketGeometry":
            errors.append("%s.%s 是几何插座，数值模式只读非几何值" % (node.name, sock_ref))
            continue
        if is_input and not sock.is_linked:
            val = getattr(sock, "default_value", None)
            if isinstance(val, mathutils.Vector):
                val = [round(x, 6) for x in val]
            elif isinstance(val, mathutils.Color):
                val = [round(x, 6) for x in val]
            direct.append((node.name, sock.name, val))
            continue
        src_sock = sock if not is_input else sock.links[0].from_socket
        targets.append((node.name, sock.name, src_sock, is_input))
    return targets, direct, errors


# ==================== 接线 ====================

def _wire_bake_before_output(tree, bake):
    """把 bake 的几何输入旁接到组输出前的最终几何（不动原链）。
    无输出几何时退回组输入。返回是否成功。"""
    src = group_output_geo(tree)
    if src is None:
        src = group_input_geo(tree)
    if src is None:
        return False
    try:
        tree.links.new(src, bake.inputs[0])
        return True
    except Exception:
        return False


# ==================== 结果分类 ====================

def _classify(bake_json, ident):
    """把第 ident 个烘焙项分类：单值 or 字段。"""
    items = bake_json.get("烘焙项", {})
    item = items.get(str(ident))
    if item is None:
        return {"类型": "未知", "提示": "烘焙项缺失"}
    if item.get("type") == "ATTRIBUTE":
        return {"类型": "字段", "提示": FIELD_NOTE}
    return {"类型": "单值", "值": item.get("value")}


# ==================== 入口 ====================

def numeric_run(tree, mod, obj, node_sockets, out_root, frames=None):
    """数值模式：读取指定 节点名.插座名 的数值。
    frames: 可选 "起始-结束"；给了→按帧输出值列表（≤15帧），没给→当前帧单值。
    返回 {ok, data, 帧?} 或 {ok: False, error}。"""
    frame_range = None
    if frames is not None:
        frame_range, ferr = parse_frames(frames)
        if ferr is not None:
            return {"ok": False, "error": ferr}

    targets, direct, errors = _collect_targets(tree, node_sockets)
    if errors:
        return {"ok": False, "error": "；".join(errors)}

    result = {}
    for node_name, sock_name, val in direct:
        result.setdefault(node_name, {"inputs": {}, "outputs": {}})[
            "inputs"][sock_name] = {"类型": "单值", "值": val}

    if not targets:
        return {"ok": True, "data": result}

    # 预扫描：逃逸 / 直接 / 不支持的区域
    prepared = []       # (ident, node_name, sock_name, is_input, src_for_bake)
    cleanups = []
    zone_errors = []
    ident = 1
    for node_name, sock_name, src_sock, is_input in targets:
        stype = _socket_to_bake_type(src_sock.bl_idname)
        if stype is None:
            continue
        zone = node_in_zone_kind(tree, src_sock.node, "simulation")
        if zone is not None:
            out_sock, cl = _escape_through_zone(tree, zone, src_sock, stype, ident)
            if out_sock is None:
                zone_errors.append("%s.%s 模拟区逃逸失败" % (node_name, sock_name))
                continue
            cleanups.extend(cl)
            prepared.append((ident, node_name, sock_name, is_input, out_sock))
        else:
            bad = None
            for kind in ("repeat", "foreach"):
                if node_in_zone_kind(tree, src_sock.node, kind) is not None:
                    bad = kind
                    break
            if bad is not None:
                zone_errors.append(
                    "%s.%s 位于 %s 区域内部，暂不支持读取" % (node_name, sock_name, bad))
                continue
            prepared.append((ident, node_name, sock_name, is_input, src_sock))
        ident += 1

    if zone_errors:
        _cleanup_escapes(cleanups)
        return {"ok": False, "error": "；".join(zone_errors)}

    if not prepared:
        return {"ok": True, "data": result, "提示": "没有可读取的目标"}

    bake = ensure_probe_bake(tree)
    if not _wire_bake_before_output(tree, bake):
        _cleanup_escapes(cleanups)
        return {"ok": False, "error": "找不到可用的几何来源（组输出/组输入）"}

    for ident, node_name, sock_name, is_input, src_for_bake in prepared:
        stype = _socket_to_bake_type(src_for_bake.bl_idname)
        if stype is None:
            continue
        try:
            bake.bake_items.new(socket_type=stype, name="%s.%s" % (node_name, sock_name))
        except Exception:
            continue
        in_sock = find_socket(bake.inputs, "Item_%d" % ident)
        if in_sock is None:
            continue
        try:
            tree.links.new(src_for_bake, in_sock)
        except Exception:
            continue

    tree.update_tag()
    for n in tree.nodes:
        try:
            n.socket_value_update(bpy.context)
        except Exception:
            pass
    obj.update_tag(refresh={'DATA'})
    bpy.context.scene.frame_set(bpy.context.scene.frame_current)
    bpy.context.view_layer.update()

    bake_mode = "ANIMATION" if frame_range is not None else "STILL"
    f_start = frame_range[0] if frame_range is not None else None
    f_end = frame_range[1] if frame_range is not None else None
    try:
        bake_json, _ = bake_round(tree, mod, obj, out_root, bake,
                                  bake_mode=bake_mode,
                                  frame_start=f_start, frame_end=f_end)
    except Exception as e:
        _cleanup_escapes(cleanups)
        return {"ok": False, "error": "烘焙失败: %s" % e}

    field_count = 0
    out = {"ok": True}
    if frame_range is not None:
        # 多帧：每个 socket 输出逐帧值列表
        out["帧"] = list(range(frame_range[0], frame_range[1] + 1))
        for ident, node_name, sock_name, is_input, _src in prepared:
            vals = []
            is_field = False
            for fr in range(frame_range[0], frame_range[1] + 1):
                j = bake_json.get(fr)
                if j is None:
                    vals.append(None)
                    continue
                v = _classify(j, ident)
                if v.get("类型") == "字段":
                    is_field = True
                else:
                    vals.append(v.get("值"))
            if is_field:
                field_count += 1
                entry = {"类型": "字段", "提示": FIELD_NOTE}
            else:
                entry = {"类型": "单值", "值": vals}
            key = "inputs" if is_input else "outputs"
            result.setdefault(node_name, {"inputs": {}, "outputs": {}})[key][sock_name] = entry
    else:
        # 单帧：当前帧单值
        for ident, node_name, sock_name, is_input, _src in prepared:
            val = _classify(bake_json, ident)
            if val.get("类型") == "字段":
                field_count += 1
            key = "inputs" if is_input else "outputs"
            result.setdefault(node_name, {"inputs": {}, "outputs": {}})[key][sock_name] = val

    _cleanup_escapes(cleanups)

    out["data"] = result
    if field_count:
        out["提示"] = "有 %d 个 socket 是字段（依赖几何），请用几何模式查看其统计" % field_count
    return out
