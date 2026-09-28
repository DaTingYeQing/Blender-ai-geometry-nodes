# -*- coding: utf-8 -*-
"""动作模块：七个可执行动作 + 动作注册表（注册表顺序 = 批次执行顺序）。

统一约定：
  · 每个动作签名都是 cmd_x(tree, spec, col) -> None
  · 成功与失败一律通过 col（Collector）汇报，不抛异常、不返回值
  · 动作内**不出现任何 print**，输出统一由入口 node_builder.py 负责

按操作性质分三组：
  结构：interface / add / add_item / del
  接线：link / unlink
  取值：set

（拆分自 node_builder.py，逻辑与原实现一一对应；msg 文案逐字保持原样。）
"""
import _types as T
import _refs as R
from _errors import list_sockets, list_ifaces


# ============ zone 支持（Repeat / Simulation / ForEach）============

# 各 zone 的输入/输出节点 idname 成对
ZONE_ENDPOINTS = {
    "Repeat":     ("GeometryNodeRepeatInput",                  "GeometryNodeRepeatOutput"),
    "Simulation": ("GeometryNodeSimulationInput",              "GeometryNodeSimulationOutput"),
    "ForEach":    ("GeometryNodeForeachGeometryElementInput",  "GeometryNodeForeachGeometryElementOutput"),
}

# 各 zone 输出节点上的 item 集合：直接映射到属性名；ForEach 有 main/generation/input 三种
ZONE_ITEM_COLL = {
    "GeometryNodeRepeatOutput":             "repeat_items",
    "GeometryNodeSimulationOutput":         "state_items",
    "GeometryNodeForeachGeometryElementOutput": {
        "main":        "main_items",
        "generation":  "generation_items",
        "input":       "input_items",
    },
}


def zone_kind(bl_idname):
    """判断 idname 是不是 zone 端点。返回 (zone名, 'input'/'output') 或 None。"""
    for key, (i, o) in ZONE_ENDPOINTS.items():
        if bl_idname == i:
            return (key, "input")
        if bl_idname == o:
            return (key, "output")
    return None


def pair_zone(tree, node):
    """zone 端点自动配对：一次 add 里同时建了 Input 与 Output，这里把两半接起来。
    返回 (是zone端点, 本次是否新配成功)。"""
    kind = zone_kind(node.bl_idname)
    if kind is None:
        return False, False
    key, side = kind
    in_id, out_id = ZONE_ENDPOINTS[key]
    if side == "input":
        if getattr(node, "paired_output", None) is not None:
            return True, False
        for n in tree.nodes:
            if n.bl_idname == out_id and getattr(n, "paired_input", None) is None:
                node.pair_with_output(n)
                return True, True
    else:
        for n in tree.nodes:
            if n.bl_idname == in_id and getattr(n, "paired_output", None) is None:
                n.pair_with_output(node)
                return True, True
    return True, False


def zone_item_collection(rout, kind=None):
    """取 zone 输出节点上携带项的集合（repeat_items / state_items / *_items）。"""
    m = ZONE_ITEM_COLL.get(rout.bl_idname)
    if m is None:
        return None
    if isinstance(m, str):
        return getattr(rout, m)
    return getattr(rout, m.get(kind, "input_items"))


# ============ 结构：interface / add / add_item / del ============

def cmd_interface(tree, spec, col):
    """创建节点组边界接口，并自动备好可连线的组输入/组输出节点。"""
    direction = str(spec.get("direction", "input")).strip().lower()
    if direction in ("input", "in"):
        in_out = "INPUT"
    elif direction in ("output", "out"):
        in_out = "OUTPUT"
    else:
        col.error(f"interface 失败：direction 只能是 input 或 output，收到 {spec.get('direction')!r}",
                  code="bad_direction", where={"name": spec.get("name", "")},
                  hint='direction 填 "input" 或 "output"（大小写不限）')
        return
    name = spec.get("name", "")
    raw_type = spec.get("socket_type", "Float")
    if not name:
        col.error("interface 失败：缺少 name", code="interface_no_name",
                  hint='补上 name，如 {"direction":"input","name":"Object","socket_type":"Object"}')
        return
    stype = T.canon_socket_idname(raw_type)
    if stype is None:
        col.error(f"interface 失败 [{name}]：认不出 socket 类型 {raw_type}",
                  code="bad_socket_type", where={"name": name, "socket_type": raw_type},
                  hint="socket_type 写类型名即可（大小写不限）。可用："
                       + "、".join(T.INTERFACE_SOCKET_TYPES))
        return
    try:
        tree.interface.new_socket(name=name, in_out=in_out, socket_type=stype)
    except Exception as e:
        col.error(f"interface 失败 [{name}]: {e}", code="interface_new_failed",
                  where={"name": name, "socket_type": raw_type},
                  hint="Blender 拒了这个 socket 类型，核对应是上列 15 种之一")
        return
    for gtype in ("NodeGroupInput", "NodeGroupOutput"):
        if not any(n.bl_idname == gtype for n in tree.nodes):
            tree.nodes.new(gtype)
    col.warning(f"接口已建：{in_out} {name} ({stype})")


def cmd_add(tree, spec, col):
    """加节点。成功：返回建出的节点 name；失败：指出 idname 名字错了。"""
    idname = spec if isinstance(spec, str) else spec.get("type")
    if not isinstance(idname, str) or not idname.strip():
        col.error("add 失败：节点类型名(idname)不能为空", code="add_no_idname",
                  hint="ids 里不要留空项，如 GeometryNodeMeshCube")
        return
    try:
        node = tree.nodes.new(idname.strip())
    except Exception as e:
        col.error(f"add 失败 [{idname}]：节点类型名/idname 写错了，请核对（如 GeometryNodeMeshCube）—— {e}",
                  code="add_bad_idname", where={"idname": idname},
                  hint="该 idname 在本 Blender 版本不存在；用 node_full 或查 idname 清单确认")
        return
    col.warning(f"已建：{node.name} ({idname})")
    # Zone 端点：自动与树上未配对的那一半配对
    if zone_kind(node.bl_idname):
        _, newly = pair_zone(tree, node)
        if newly:
            col.warning("zone 已自动配对：" + node.name)


def cmd_add_item(tree, spec, col):
    """给 zone 输出节点加 item（开携带档）。spec: {zone: name, socket_type, item_name, kind}"""
    rout, err = R.resolve_node(tree, spec.get("zone", ""))
    if rout is None:
        col.error(f"add_item 失败：{err}", code="node_not_found",
                  where={"zone": spec.get("zone")})
        return
    coll = zone_item_collection(rout, spec.get("kind"))
    if coll is None:
        col.error(f"add_item 失败：{rout.name} 不是 zone 输出节点（{rout.bl_idname}）",
                  code="not_zone_output", where={"zone": rout.name})
        return
    base = T.sock_base_type(str(spec.get("socket_type", "Float")))
    enum = T.BASE_TO_ENUM.get(base)
    if enum is None:
        col.error(f"add_item 失败：未知 socket 类型 {spec.get('socket_type')}（可用：{'、'.join(T.BASE_TO_ENUM)}）",
                  code="bad_socket_type", where={"zone": rout.name},
                  hint="socket_type 填类型名，如 Float / Vector / Geometry")
        return
    try:
        it = coll.new(enum, spec.get("item_name", ""))
    except Exception as e:
        col.error(f"add_item 失败 [{rout.name}]: {e}", code="item_new_failed",
                  where={"zone": rout.name})
        return
    col.warning(f"已加 item {rout.name}.{it.name}（{enum}）")


# ============ 取值：set ============

def cmd_set(tree, spec, col):
    """设一个值：socket=接口默认值（含组边界）、prop=节点属性，两者二选一（node 用 name）。"""
    ref = spec.get("node", "")
    node, err = R.resolve_node(tree, ref)
    if node is None:
        col.error(f"set 失败：{err}", code="node_not_found", where={"node": ref})
        return
    socket_ref = str(spec.get("socket") or "").strip()
    prop_ref = str(spec.get("prop") or "").strip()
    value = spec.get("value")
    if socket_ref and prop_ref:
        col.error(f"set 失败：socket 与 prop 只能填一个（收到 socket={socket_ref!r}、prop={prop_ref!r}）",
                  code="bad_set_spec", where={"node": node.name},
                  hint="设接口默认值用 socket；改节点属性用 prop")
        return
    if not socket_ref and not prop_ref:
        col.error("set 失败：要填 socket（接口名）或 prop（属性名）之一",
                  code="bad_set_spec", where={"node": node.name},
                  hint='例：{"node":"Math","socket":"Value_001","value":2}；'
                       '{"node":"Math","prop":"operation","value":"MULTIPLY"}')
        return

    # ---- prop 支：只改节点属性（含 enum，如 operation / data_type）----
    if prop_ref:
        if not hasattr(node, prop_ref):
            col.error(f"set 失败：{node.name} 没有属性 {prop_ref}",
                      code="prop_not_found", where={"node": node.name, "prop": prop_ref},
                      hint="prop 是节点属性名（node_full 的 runtime_properties）；设接口默认值请改用 socket")
            return
        try:
            setattr(node, prop_ref, value)
        except Exception as e:
            col.error(f"set 失败 [{node.name}.{prop_ref}] 属性：{e}",
                      code="set_prop_failed", where={"node": node.name, "prop": prop_ref})
        return

    # ---- socket 支：组边界节点 → interface 项；其余 → 输入口 ----
    if node.type in ("GROUP_INPUT", "GROUP_OUTPUT"):
        in_out = "INPUT" if node.type == "GROUP_INPUT" else "OUTPUT"
        items = [it for it in tree.interface.items_tree
                 if it.item_type == "SOCKET" and it.in_out == in_out]
        # 复用 find_socket：identifier 精确优先，name 重名时报错并列 identifier（不闷头取第一个）
        it, amb = R.find_socket(items, socket_ref, True)
        if amb:
            col.error(f"set 失败：{amb}", code="interface_ambiguous",
                      where={"node": node.name, "socket": socket_ref},
                      hint="同名接口必须写 identifier（screen 详情里接口名后面的那个词）")
            return
        if it is not None:
            try:
                it.default_value = T.coerce_interface(it, value)
            except Exception as e:
                col.error(f"set 失败 [{node.name}.{socket_ref}] interface：{e}",
                          code="set_interface_failed",
                          where={"node": node.name, "socket": socket_ref})
            return
        col.error(f"set 失败：{node.name} 没有对应 interface 项 {socket_ref}（可用：{list_ifaces(tree, in_out)}）",
                  code="interface_not_found",
                  where={"node": node.name, "socket": socket_ref},
                  hint="先用 blender_screen 看该组边界接口，或直接用 identifier")
        return
    # 输入口：name 重名同样报错，不闷头取第一个
    sock, amb = R.find_socket(node.inputs, socket_ref, True)
    if amb:
        col.error(f"set 失败：{amb}", code="socket_ambiguous",
                  where={"node": node.name, "socket": socket_ref},
                  hint="同名接口必须写 identifier（screen 详情里接口名后面的那个词）")
        return
    if sock is not None:
        try:
            sock.default_value = T.coerce(sock, value)
        except Exception as e:
            col.error(f"set 失败 [{node.name}.{socket_ref}]：{e}",
                      code="set_socket_failed",
                      where={"node": node.name, "socket": socket_ref})
        return
    col.error(f"set 失败：{node.name} 没有输入接口 {socket_ref}",
              code="socket_not_found", where={"node": node.name, "socket": socket_ref},
              hint="先用 blender_screen 的 detail 模式查该节点输入口名；改属性请改用 prop")


# ============ 接线：link / unlink ============

def cmd_link(tree, spec, col):
    """连接节点接口：'节点name.接口 → 节点name.接口'。"""
    try:
        sn, ss, dn, ds = R.parse_wire(spec)
    except ValueError as e:
        col.error(f"连线失败（{spec}）：{e}", code="wire_format", where={"spec": spec},
                  hint="格式：节点name.接口 → 节点name.接口（接口写 screen 里括号前那个词）")
        return
    src, err_s = R.resolve_node(tree, sn)
    dst, err_d = R.resolve_node(tree, dn)
    if src is None or dst is None:
        col.error(f"连线失败（{spec}）：{err_s or err_d}", code="node_not_found",
                  where={"spec": spec})
        return
    a_src, a_dst = R.allows_name(src), R.allows_name(dst)
    out, err_out = R.find_socket(src.outputs, R.parse_ref(ss), a_src)
    inn, err_inn = R.find_socket(dst.inputs, R.parse_ref(ds), a_dst)
    if err_out or err_inn:
        col.error(f"连线失败（{spec}）：{err_out or err_inn}", code="socket_ambiguous",
                  where={"spec": spec})
        return
    if out is None:
        col.error(f"连线失败（{spec}）：{sn} 没有输出接口 {ss}；可用：{list_sockets(src.outputs, a_src)}",
                  code="output_not_found", where={"spec": spec, "node": src.name})
        return
    if inn is None:
        col.error(f"连线失败（{spec}）：{dn} 没有输入接口 {ds}；可用：{list_sockets(dst.inputs, a_dst)}",
                  code="input_not_found", where={"spec": spec, "node": dst.name})
        return
    if getattr(out, "identifier", "") == "__extend__" or getattr(inn, "identifier", "") == "__extend__":
        col.error(
            f"连线失败（{spec}）：{ds if getattr(inn, 'identifier', '') == '__extend__' else ss} 是虚拟接口 __extend__，"
            "直接连线不会生效。请先用 interface 建对应类型的组接口，再连线。",
            code="virtual_socket", where={"spec": spec},
            hint="先 interface 建同类型组接口，再连；不要直接连 __extend__",
        )
        return
    if not out.enabled or not inn.enabled:
        col.error(f"连线失败（{spec}）：接口未启用——动态节点请先用 set 设好 data_type 再连",
                  code="socket_disabled", where={"spec": spec})
        return
    if not inn.is_multi_input and inn.is_linked:
        col.error(f"连线失败（{spec}）：{dn} 的输入 {ds} 已连线（只有 multi_input 接口能叠线）",
                  code="input_occupied", where={"spec": spec, "node": dst.name})
        return
    ok, msg = T.check_link_compatible(out, inn)
    if not ok:
        col.error(f"连线失败（{spec}）：{msg}", code="type_incompatible",
                  where={"spec": spec})
        return
    tree.links.new(out, inn)
    col.warning(f"已连：{src.name}.{R.sock_label(out, a_src)} → {dst.name}.{R.sock_label(inn, a_dst)}")


def cmd_unlink(tree, spec, col):
    """断线。全式「A.口 → B.口」（→ / -> / to 都认）= 断这根线；短式「节点.口」只断该节点的【输入】线。"""
    # 全式判定与 link 共用 parse_wire（三种连接词都认）；两边都得是「名字.接口」才算全式，
    # 否则节点名里带 " to " 的短式会被误判。
    try:
        full = R.parse_wire(spec)
    except ValueError:
        full = None
    if full is not None and full[0] and full[2]:
        sn, ss, dn, ds = full
        src, err_s = R.resolve_node(tree, sn)
        dst, err_d = R.resolve_node(tree, dn)
        if src is None or dst is None:
            col.error(f"unlink 失败：{err_s or err_d}", code="node_not_found",
                      where={"spec": spec})
            return
        a_src, a_dst = R.allows_name(src), R.allows_name(dst)
        out, err_out = R.find_socket(src.outputs, R.parse_ref(ss), a_src)
        inn, err_inn = R.find_socket(dst.inputs, R.parse_ref(ds), a_dst)
        if err_out or err_inn:
            col.error(f"unlink 失败：{err_out or err_inn}", code="socket_ambiguous",
                      where={"spec": spec})
            return
        for l in list(tree.links):
            if l.from_socket == out and l.to_socket == inn:
                tree.links.remove(l)
                col.warning(f"已断：{spec}")
                return
        col.error(f"unlink 失败：没找到 {spec} 这根线", code="link_not_found",
                  where={"spec": spec})
    else:
        n, s = spec.rsplit(".", 1)   # rsplit: 节点名可能带点（如 delta_bbox.001）
        node, err = R.resolve_node(tree, n)
        if node is None:
            col.error(f"unlink 失败：{err}", code="node_not_found", where={"spec": spec})
            return
        inn, amb = R.find_socket(node.inputs, R.parse_ref(s), R.allows_name(node))
        if amb:
            col.error(f"unlink 失败：{amb}", code="socket_ambiguous", where={"spec": spec})
            return
        if inn is not None and inn.is_linked:
            tree.links.remove(inn.links[0])
            col.warning(f"已断：{node.name} 的输入 {inn.name}")
            return
        col.error(f"unlink 失败：{n}.{s} 无输入连线", code="input_not_linked",
                  where={"spec": spec})


def cmd_del(tree, ref, col):
    """按 name/idname 删节点。删掉组边界节点时不拦，但在摘要里给一句提醒。"""
    node, err = R.resolve_node(tree, str(ref).strip())
    if node is None:
        col.error(f"del 失败：{err}", code="node_not_found", where={"ref": str(ref)})
        return
    node_name = node.name  # 先取名字：remove 之后 StructRNA 已释放，不能再访问 node
    # 删前记下边界节点在不在：只在「本来有、被你删没了」时提醒，空树（没建过边界）不误报
    borders = (("NodeGroupInput", "Group Input"), ("NodeGroupOutput", "Group Output"))
    had = {t: any(n.bl_idname == t for n in tree.nodes) for t, _ in borders}
    tree.nodes.remove(node)
    col.warning(f"已删：{node_name}")
    missing = [label for t, label in borders
               if had[t] and not any(n.bl_idname == t for n in tree.nodes)]
    if missing:
        col.warning(f"提醒：{'、'.join(missing)} 被删，外部输入/输出接不上；"
                    f"补法：跑一次 action=interface（会自动补回）")


# ============ 动作注册表（定义顺序 = 执行顺序）============
ACTION_REGISTRY = [
    {"name": "interface", "func": cmd_interface, "batch_key": "interface",
     "description": "创建节点组边界接口（组输入/组输出的插口）"},
    {"name": "add", "func": cmd_add, "batch_key": "add",
     "description": "添加节点（按 idname 创建，返回新节点 name）。zone 建法：在一条 add 里同时列出该 zone 的 Input 与 Output 两个 idname，脚本即自动配对。"},
    {"name": "add_item", "func": cmd_add_item, "batch_key": "add_item",
     "description": "给 zone 输出节点加携带项 item（开档）。zone=<输出节点 name>，socket_type=<类型名>，name=<项名>。For Each 用 kind 指定槽位。"},
    {"name": "set", "func": cmd_set, "batch_key": "set",
     "description": "设置节点属性或输入接口默认值（node 用 name）"},
    {"name": "link", "func": cmd_link, "batch_key": "link",
     "description": "连接节点接口（节点name.接口identifier → 节点name.接口identifier）"},
    {"name": "unlink", "func": cmd_unlink, "batch_key": "unlink",
     "description": "断开节点接口连接"},
    {"name": "del", "func": cmd_del, "batch_key": "del",
     "description": "删除节点（用 name 或 idname）"},
]
