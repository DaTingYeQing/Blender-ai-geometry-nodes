"""节点树工具：定位节点/Socket、上游闭包、set 注入。"""
import bpy
import mathutils
import sys
import os

import implicit_field


def sock_base_type(bl_idname):
    """socket 类型 → 基类名（"Float"/"Vector"等）。"""
    name = bl_idname[len("NodeSocket"):] if bl_idname.startswith("NodeSocket") else bl_idname
    for base in ("Geometry", "Collection", "Material", "Rotation", "Texture",
                 "Closure", "Bundle", "Matrix", "String", "Object", "Shader",
                 "Float", "Vector", "Color", "Bool", "Int"):
        if name.startswith(base):
            return base
    return name


def resolve_node(tree, ref):
    """按 node.name 定位；idname 兜底（唯一时）。返回 node 或 None。"""
    ref = str(ref).strip()
    node = tree.nodes.get(ref)
    if node is not None:
        return node
    matches = [n for n in tree.nodes if n.bl_idname == ref]
    if len(matches) == 1:
        return matches[0]
    return None


def find_socket(sockets, ref):
    """按 identifier 或索引找 socket。"""
    if isinstance(ref, int):
        return sockets[ref] if 0 <= ref < len(sockets) else None
    for s in sockets:
        if s.identifier == ref:
            return s
    return None


def _coerce(sock, value):
    """把 Python 值转成 socket 类型。"""
    base = sock_base_type(sock.bl_idname)
    if base == "Vector":
        return mathutils.Vector(value)
    if base == "Color":
        return mathutils.Color(value)
    if base == "Bool":
        return bool(value)
    if base == "Int":
        return int(value)
    return value


def _coerce_interface(it, value):
    """把 Python 值转成 interface 类型。"""
    base = sock_base_type(it.socket_type)
    if base == "Vector":
        return mathutils.Vector(value)
    if base == "Color":
        return mathutils.Color(value)
    if base == "Bool":
        return bool(value)
    if base == "Int":
        return int(value)
    return value


def apply_sets(tree, mod, sets):
    """应用 set 列表（断开注入：已连线输入先断再设 default_value；enum/属性走 setattr）。
    返回 (errors, warnings)。"""
    errors, warnings = [], []
    for spec in sets or []:
        node = resolve_node(tree, spec.get("node", ""))
        if node is None:
            errors.append("set: 找不到节点 %r" % spec.get("node"))
            continue
        prop, value = spec.get("prop"), spec.get("value")
        # 组输入/组输出 → interface 默认值
        if node.type in ("GROUP_INPUT", "GROUP_OUTPUT"):
            in_out = "INPUT" if node.type == "GROUP_INPUT" else "OUTPUT"
            hit = False
            for it in tree.interface.items_tree:
                if it.item_type == "SOCKET" and it.in_out == in_out and (it.name == prop or it.identifier == prop):
                    try:
                        it.default_value = _coerce_interface(it, value)
                        try:
                            mod[it.identifier] = _coerce_interface(it, value)
                        except Exception:
                            pass
                        hit = True
                    except Exception as e:
                        errors.append("set [%s.%s] interface: %s" % (node.name, prop, e))
                    break
            if not hit:
                errors.append("set: %s 无 interface 项 %s" % (node.name, prop))
            continue
        # 输入接口：先处理隐式字段
        matched = False
        for s in node.inputs:
            if s.name == prop or s.identifier == prop:
                _cls = implicit_field.classify(node, s)
                if _cls == "constant":
                    ok, info = implicit_field.apply(tree, node, s, value)
                    (errors if not ok else warnings).append(info)
                    matched = True
                    break
                if _cls == "exempt":
                    errors.append("set [%s.%s] 是豁免的隐式字段，暂不支持固定设值" % (node.name, s.name))
                    matched = True
                    break
                if s.is_linked and not s.is_multi_input:
                    tree.links.remove(s.links[0])
                    warnings.append("已断开 %s.%s 上游连线（注入固定值）" % (node.name, s.name))
                elif s.is_linked and s.is_multi_input:
                    for l in list(s.links):
                        tree.links.remove(l)
                    warnings.append("已断开 %s.%s 全部连线（注入固定值）" % (node.name, s.name))
                try:
                    s.default_value = _coerce(s, value)
                except Exception as e:
                    errors.append("set [%s.%s]: %s" % (node.name, prop, e))
                matched = True
                break
        if matched:
            continue
        # 节点属性（enum）
        if hasattr(node, prop):
            try:
                setattr(node, prop, value)
            except Exception as e:
                errors.append("set [%s.%s] 属性: %s" % (node.name, prop, e))
            continue
        errors.append("set: %s 无属性/接口 %s" % (node.name, prop))
    return errors, warnings


def group_output_geo(tree):
    """返回组输出节点 Geometry 输入的上游来源 socket。"""
    for n in tree.nodes:
        if n.bl_idname == "NodeGroupOutput":
            for s in n.inputs:
                if s.bl_idname == "NodeSocketGeometry" and s.is_linked:
                    return s.links[0].from_socket
    return None


def group_input_geo(tree):
    """返回组输入节点的 Geometry 输出 socket（原始 mesh，无实例）。"""
    for n in tree.nodes:
        if n.bl_idname == "NodeGroupInput":
            for s in n.outputs:
                if s.bl_idname == "NodeSocketGeometry":
                    return s
    return None


def parse_frames(frames):
    """解析帧范围 "起始-结束" → (start, end)；无/空 → None。
    返回 (range, err)：err 非 None 表示非法。"""
    if frames is None or not str(frames).strip():
        return None, None
    s = str(frames).strip()
    parts = s.split("-")
    if len(parts) != 2:
        return None, "帧范围格式应为 起始-结束，收到 %r" % s
    try:
        start, end = int(parts[0]), int(parts[1])
    except ValueError:
        return None, "帧范围不是数字: %r" % s
    if start < 1 or end < start:
        return None, "帧范围非法 %r（要求 起始>=1 且 起始<=结束）" % s
    if end - start + 1 > 15:
        return None, "帧范围超过上限 15 帧: %r" % s
    return (start, end), None


# ==================== 区域（zone）检测 ====================

ZONE_KINDS = {
    "simulation": "GeometryNodeSimulationInput",
    "repeat": "GeometryNodeRepeatInput",
    "foreach": "GeometryNodeForeachGeometryElementInput",
}


def reachable_from(sockets, target):
    """沿数据流方向 BFS：从 sockets 出发能否到达 target 节点。
    走过输入 socket 时允许【穿过节点】，继续从该节点的输出 socket 出发——
    否则多级链路（如 区内部 → mp1 → Switch → Store → 区输出）永远走不到。"""
    seen = set()
    stack = list(sockets)
    while stack:
        s = stack.pop()
        if s.node == target:  # bpy 对象用 == (RNA地址)，is 恒 False
            return True
        if id(s) in seen:
            continue
        seen.add(id(s))
        for l in s.links:
            stack.append(l.to_socket)
        # 输入 socket 的 links 指向的是它自己（上游线），不去重就会原地打转；
        # 这里改成穿过节点，从该节点所有输出继续往下游走。
        if not s.is_output:
            for o in s.node.outputs:
                stack.append(o)
    return False


def node_in_zone_kind(tree, node, kind):
    """判断 node 是否在某类区域内部；是则返回 (input_node, output_node)，否则 None。"""
    in_idname = ZONE_KINDS[kind]
    if node.bl_idname == in_idname:
        return None
    for n in tree.nodes:
        if n.bl_idname != in_idname:
            continue
        out = getattr(n, "paired_output", None)
        if out is None:
            continue
        # 同时满足：node 在区域输入下游 且 在区域输出上游 → 位于区内
        if reachable_from(list(n.outputs), node) and reachable_from(list(node.outputs), out):
            return (n, out)
    return None