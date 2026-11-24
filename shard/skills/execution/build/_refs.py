# -*- coding: utf-8 -*-
"""引用解析与定位（base 层之二）。

把 AI 写的「人话」翻译成 Blender 对象：节点名 / 接口名 / 序号 → 真正的节点与 socket。
这一层是 AI 与 Blender 之间的翻译层，也是「AI 该写 name 还是 identifier」这条规则的
唯一实现处（见 allows_name）。

（拆分自 node_builder.py，逻辑与原实现一一对应，未作行为改动。）
"""
import re


def parse_ref(x):
    """'-1'/'3' → int；否则当名字。"""
    x = x.strip()
    if re.fullmatch(r"-?\d+", x):
        return int(x)
    return x


def allows_name(node):
    """这些节点上的接口名来自节点组 interface（比 Socket_N 有意义），允许用 name 连线：
      - GeometryNodeGroup : 引用别的组的那个节点，接口名 = 被引用组的接口名
      - NodeGroupInput    : 本组边界入口，接口名 = 本组 interface 名
      - NodeGroupOutput   : 本组边界出口，同上
    其他节点（Math 的 Value×3、Vector Math 的 Vector×3）name 会重名，仍只能用 identifier。
    name 命中多个时 find_socket 会报错要求改用 identifier，不会静默取第一个。"""
    return node is not None and node.bl_idname in (
        "GeometryNodeGroup", "NodeGroupInput", "NodeGroupOutput")


def sock_label(s, allow_name=False):
    """接口对外显示的引用字符串：节点组相关节点给 name（AI 就当它是 identifier 写，
    脚本内部会自己转成 Socket_N），其余给 identifier。name 为空（如 __extend__）则回落 identifier。"""
    if allow_name and s.name:
        return s.name
    return s.identifier


def find_socket(sockets, ref, allow_name=False):
    """ref: int 序号 或 str。返回 (socket, err)。
    先按 identifier 精确匹配（老写法继续可用）；allow_name=True 时再按 name 兜底，
    这样 Group 节点可以写 Group.hi，而 AI 不需要知道背后是 Socket_0。
    name 命中多个时报错而不是闷头取第一个——接口 name 在 Blender 里并不保证唯一。"""
    if isinstance(ref, int):
        if 0 <= ref < len(sockets):
            return sockets[ref], None
        return None, None
    for s in sockets:
        if s.identifier == ref:
            return s, None
    if allow_name:
        hits = [s for s in sockets if s.name == ref]
        if len(hits) == 1:
            return hits[0], None
        if len(hits) > 1:
            ids = "、".join(h.identifier for h in hits)
            return None, (f"{ref!r} 在本节点有 {len(hits)} 个同名接口"
                          f"（identifier 分别是 {ids}），请改用 identifier 指明是哪一个")
    return None, None


def resolve_node(tree, ref):
    """按 name 定位节点；也宽容接受 idname（唯一时），重名时贴出各 name 让 AI 用 name。
    返回 (node, err)：node 为空时 err 说明具体原因。"""
    ref = str(ref).strip()
    # 1) 精确 name 匹配（唯一稳定，主路径）
    node = tree.nodes.get(ref)
    if node is not None:
        return node, None
    # 2) idname 匹配兜底：唯一时用；多个时列 name 让 AI 用 name
    matches = [n for n in tree.nodes if n.bl_idname == ref]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        names = "、".join(n.name for n in matches)
        return None, f"节点 {ref} 有 {len(matches)} 个，请改用 name 区分：{names}"
    return None, f"找不到节点 {ref}（不是 node.name，也不是某个 idname）"


def parse_wire(spec):
    """'name.identifier → name.identifier'（也可用 -> 或 to）→ (sn, ss, dn, ds)。
    接口 identifier 不含点，从最后一个点切才正确。"""
    m = re.split(r"\s*(?:→|->)\s*", spec)
    if len(m) != 2:
        m = re.split(r"\s+to\s+", spec, flags=re.IGNORECASE)
    if len(m) != 2:
        raise ValueError(f"连线格式应为 '节点name.接口identifier → 节点name.接口identifier'，收到: {spec}")
    def side(part):
        n, _, s = part.rpartition(".")
        return n.strip(), s.strip()
    sn, ss = side(m[0])
    dn, ds = side(m[1])
    return sn, ss, dn, ds
