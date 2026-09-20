# -*- coding: utf-8 -*-
"""类型系统与静态转换表（base 层之一）。

本模块只做两件事：**推导 socket 类型**、**把值转成 Blender 能赋值的形式**。
全程不碰 bpy 对象，因此可以脱离 Blender 单独理解。

（拆分自 node_builder.py，逻辑与原实现一一对应，未作行为改动。）
"""
import mathutils

# 隐式转换表：行 = 输出端类型，列 = 可接入的输入端类型。
# 依据 geometry_node_tree_validate_link。
CONV = {
    "Float":      {"Float", "Int", "Vector", "Color", "Bool", "Rotation"},
    "Int":        {"Float", "Int", "Vector", "Color", "Bool"},
    "Vector":     {"Float", "Int", "Vector", "Color", "Bool", "Rotation"},
    "Color":      {"Float", "Int", "Vector", "Color", "Bool"},
    "Bool":       {"Float", "Int", "Vector", "Color", "Bool"},
    "Rotation":   {"Vector", "Rotation", "Matrix"},
    "Matrix":     {"Rotation", "Matrix"},
    "String":     {"String"},
    "Geometry":   {"Geometry"},
    "Object":     {"Object"},
    "Collection": {"Collection"},
    "Texture":    {"Texture"},
    "Image":      {"Image"},
    "Material":   {"Material"},
    "Menu":       {"Menu"},
    "Bundle":     {"Bundle"},
    "Closure":    {"Closure"},
    "Shader":     {"Shader"},
}

# socket base 名 -> 组 interface 的 .new() 可用的大写枚举
BASE_TO_ENUM = {
    "Float": "FLOAT", "Int": "INT", "Bool": "BOOLEAN", "Vector": "VECTOR",
    "Rotation": "ROTATION", "Matrix": "MATRIX", "String": "STRING", "Menu": "MENU",
    "Color": "RGBA", "Object": "OBJECT", "Image": "IMAGE", "Geometry": "GEOMETRY",
    "Collection": "COLLECTION", "Texture": "TEXTURE", "Material": "MATERIAL",
    "Bundle": "BUNDLE", "Closure": "CLOSURE",
}

# 剥离顺序：长前缀在前，避免短的抢先命中。
_BASE_ORDER = ("Geometry", "Collection", "Material", "Rotation", "Texture",
               "Closure", "Bundle", "Matrix", "String", "Object", "Shader",
               "Float", "Vector", "Color", "Bool", "Int")


def sock_base_type(bl_idname):
    """NodeSocketVectorTranslation → Vector 等，按前缀剥离。"""
    name = bl_idname[len("NodeSocket"):] if bl_idname.startswith("NodeSocket") else bl_idname
    for base in _BASE_ORDER:
        if name.startswith(base):
            return base
    return name


def check_link_compatible(src_sock, dst_sock):
    """按隐式转换表判断两个接口能否相连。返回 (ok, 错误说明)。"""
    st = sock_base_type(src_sock.bl_idname)
    dt = sock_base_type(dst_sock.bl_idname)
    # Virtual 是通配接口（组输入/组输出），任意类型可连
    if st == "Virtual" or dt == "Virtual":
        return True, None
    if dt in CONV.get(st, set()):
        return True, None
    return False, f"类型不兼容：{st} → {dt}（查隐式转换表）"


def coerce(sock, value):
    """按 socket 类型把 JSON 值转成可直接赋给 default_value 的形式。"""
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


def coerce_interface(it, value):
    """interface 项（无 bl_idname，按 socket_type）→ 可赋值的默认值。"""
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


def to_jsonable(v):
    """Blender 值 → 可 JSON 序列化（含 bpy_prop_array / mathutils 数组 / 指针）。"""
    if isinstance(v, (str, bytes, bool, int, float)) or v is None:
        return v
    if isinstance(v, (mathutils.Vector, mathutils.Color, mathutils.Euler,
                      mathutils.Quaternion, mathutils.Matrix)):
        return list(v)
    if hasattr(v, "__len__") and not isinstance(v, dict):
        try:
            return [to_jsonable(x) for x in v]
        except TypeError:
            pass
    if hasattr(v, "to_list"):
        return v.to_list()
    return str(v)
