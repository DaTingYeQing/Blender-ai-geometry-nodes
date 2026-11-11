# -*- coding: utf-8 -*-
"""整屏渲染：把节点树导出成结构化快照（AI 精确引用的唯一通道）。

输出结构（写入 screen.json，也由入口打进 stdout 的「==== 屏幕 ====」段）：
    {"tree": 组名, "tree_type": 类型, "nodes": [{"name", "idname", "inputs", "outputs"}]}
每个接口带 ref 字段——那是给 AI 照抄的引用写法（节点组相关节点给接口 name，
其余给 identifier），背后转 identifier 由 _refs.find_socket 负责。

（拆分自 node_builder.py，逻辑与原实现一一对应，未作行为改动。）
"""
from _refs import allows_name, sock_label
from _types import sock_base_type, to_jsonable


def sock_info(tree, s, direction, allow_name=False):
    """单个接口的完整信息，含它连到了谁（linked_to）。"""
    linked = []
    if direction == "in":
        for l in tree.links:
            if l.to_socket == s:
                linked.append({"node": l.from_node.name,
                               "socket": sock_label(l.from_socket, allows_name(l.from_node))})
    else:
        for l in tree.links:
            if l.from_socket == s:
                linked.append({"node": l.to_node.name,
                               "socket": sock_label(l.to_socket, allows_name(l.to_node))})
    return {
        "name": s.name, "identifier": s.identifier,
        "ref": sock_label(s, allow_name),
        "type": s.bl_idname, "base_type": sock_base_type(s.bl_idname),
        "enabled": s.enabled, "hide": s.hide,
        "is_multi_input": s.is_multi_input, "is_linked": s.is_linked,
        "default": to_jsonable(getattr(s, "default_value", None)),
        "linked_to": linked,
    }


def render_json(tree):
    """整棵树 → 可序列化 dict。节点按 name 排序，保证输出稳定可比对。"""
    nodes = []
    for node in tree.nodes:
        allow = allows_name(node)
        nodes.append({
            "name": node.name,
            "idname": node.bl_idname,
            "inputs": [sock_info(tree, s, "in", allow) for s in node.inputs],
            "outputs": [sock_info(tree, s, "out", allow) for s in node.outputs],
        })
    nodes.sort(key=lambda n: n["name"])
    return {"tree": tree.name, "tree_type": tree.bl_idname, "nodes": nodes}
