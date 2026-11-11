# -*- coding: utf-8 -*-
"""
implicit_field.py — 隐式字段输入识别 + 固定值注入（喂入对应常量节点并连回）。
=============================================================================================
背景：Blender 部分输入声明为"隐式字段"(implicit field)，如 `设置位置.Position`。
这类输入断开后不认 socket.default_value（回退到内置字段：原始位置/法向/序号/ID/实例变换），
因此"断开注入 default"对它们无效（diff 空）。而无辜的普通字段（如 V族Scale）断开后是认默认值的。

识别不能靠 display_shape（Scale 也是 DIAMOND 但却是普通字段），必须按已知名单判定——
从源码 grep `implicit_field` 实测汇总出两份名单：
  IMPLICIT   需要"插常量节点连回"才能注入固定值（Position 系 / Index 系 / ID 系）
  EXEMPT     同样隐式，但用户指定不做（法向系 / 控制柄系 / 矩阵），不应静默，直接报"不支持"。

常量源节点实测（blender 4.5）：
  NodeSocketVector*  -> FunctionNodeInputVector   (值写 .vector)
  NodeSocketInt      -> FunctionNodeInputInt      (值写 .integer)
"""

# 豁免：隐式字段但暂不支持固定设值，命中直接报错（不做静默注入）
#   法向系：挤出网格.Offset、设置网格法向.Normal；控制柄系：设置曲线控制柄.Position；
#   矩阵系：设置实例变换.Transform（无输入矩阵常量节点）
EXEMPT = {
    ("GeometryNodeExtrudeMesh", "Offset"),
    ("GeometryNodeSetMeshNormal", "Normal"),
    ("GeometryNodeSetCurveHandlePositions", "Position"),
    ("GeometryNodeSetInstanceTransform", "Transform"),
}

# 需要"插常量节点"的隐式字段：(node bl_idname, socket.identifier) -> 输出类型
IMPLICIT = {
    # ---- Position 系（矢量）----
    ("GeometryNodeSetPosition", "Position"): "vector",
    ("GeometryNodeIndexOfNearest", "Position"): "vector",
    ("GeometryNodeMeshToPoints", "Position"): "vector",
    ("GeometryNodeInstancesToPoints", "Position"): "vector",
    ("GeometryNodeProximity", "Source Position"): "vector",
    ("GeometryNodeRaycast", "Source Position"): "vector",
    ("GeometryNodeSampleGrid", "Position"): "vector",
    ("GeometryNodeSampleNearest", "Sample Position"): "vector",
    ("GeometryNodeSampleNearestSurface", "Sample Position"): "vector",
    # ---- Index 系（整数）----
    ("GeometryNodeCornersOfEdge", "Edge Index"): "int",
    ("GeometryNodeCornersOfFace", "Face Index"): "int",
    ("GeometryNodeCornersOfVertex", "Vertex Index"): "int",
    ("GeometryNodeCurveOfPoint", "Point Index"): "int",
    ("GeometryNodeEdgesOfCorner", "Corner Index"): "int",
    ("GeometryNodeEdgesOfVertex", "Vertex Index"): "int",
    ("GeometryNodeFaceOfCorner", "Corner Index"): "int",
    ("GeometryNodeInstanceOnPoints", "Instance Index"): "int",
    ("GeometryNodeOffsetCornerInFace", "Corner Index"): "int",
    ("GeometryNodeOffsetPointInCurve", "Point Index"): "int",
    ("GeometryNodePointsOfCurve", "Curve Index"): "int",
    ("GeometryNodeVertexOfCorner", "Corner Index"): "int",
    # ---- ID 系（整数）----
    ("GeometryNodeSetID", "ID"): "int",
    ("FunctionNodeRandomValue", "ID"): "int",
}

# socket.bl_idname 前缀 -> (常量源节点 idname, 设值属性名)
_SOURCE = {
    "NodeSocketVector": ("FunctionNodeInputVector", "vector"),
    "NodeSocketInt": ("FunctionNodeInputInt", "integer"),
}


def classify(node, sock):
    """把输入 sock 分类：
    'constant'=隐式字段需插常量注入；'exempt'=隐式字段但豁免(不支持)；
    'normal'=普通输入/已豁免外的普通字段(断开填 default 有效)。"""
    if sock.is_output:
        return "normal"
    key = (node.bl_idname, sock.identifier)
    if key in EXEMPT:
        return "exempt"
    if key in IMPLICIT:
        return "constant"
    return "normal"


def is_implicit(node, sock):
    """是否"隐式字段且需要插常量注入"。"""
    return classify(node, sock) == "constant"


def _find_source(sock):
    for prefix, (idname, prop) in _SOURCE.items():
        if sock.bl_idname.startswith(prefix):
            return idname, prop
    return None, None


def _set_value(node, prop, value):
    if prop == "vector":
        node.vector = tuple(float(x) for x in value)
    elif prop == "integer":
        node.integer = int(value)


def apply(tree, node, sock, value):
    """对隐式字段输入做注入：断开原上游 -> 建常量节点 -> 设值 -> 连回。
    返回 (ok, info)：ok 成功与否，info 为说明或错误。"""
    for l in list(sock.links):
        tree.links.remove(l)
    idname, prop = _find_source(sock)
    if idname is None:
        return False, "隐式字段 %s.%s(%s) 暂不支持设置为固定值" % (
            node.name, sock.name, sock.bl_idname)
    try:
        c = tree.nodes.new(idname)
        _set_value(c, prop, value)
    except Exception as e:
        return False, "隐式字段 %s.%s 设常量失败: %s" % (node.name, sock.name, e)
    tree.links.new(c.outputs[0], sock)
    return True, "隐式字段 %s.%s 已断开并注入固定值（连入 %s=%s）" % (
        node.name, sock.name, c.name, _fmt(value))


def _fmt(value):
    try:
        return str(tuple(value))
    except Exception:
        return repr(value)