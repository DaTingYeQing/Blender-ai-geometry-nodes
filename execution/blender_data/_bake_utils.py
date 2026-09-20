"""烘焙基础设施：bake 节点管理、接线、触发烘焙。"""
import bpy
import os
import sys

# 让 blenderdata2.0/ 可导入（供 bake_data_translate 使用）
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE not in sys.path:
    sys.path.insert(0, _BASE)

from data_groups import bake_data_translate

BAKE_NODE = "GeometryNodeBake"
BAKE_LABEL = "__bd_probe__"


def ensure_probe_bake(tree):
    """复用已建的 bake 节点，否则新建。返回 bake 节点。"""
    for n in tree.nodes:
        if n.bl_idname == BAKE_NODE and n.label == BAKE_LABEL:
            return n
    bake = tree.nodes.new(BAKE_NODE)
    bake.label = BAKE_LABEL
    bake.location = (0, -300)
    return bake


def wire_bake(tree, bake, geo_socket):
    """把 bake 插进几何链（目标输出之后透传），保留所有下游分支。
    先记住全部下游 → 剪线 → 目标接 bake 输入 → bake 输出接回所有下游。"""
    errors = []
    if geo_socket is None:
        return errors
    downstreams = [l.to_socket for l in geo_socket.links]
    for l in list(geo_socket.links):
        tree.links.remove(l)
    tree.links.new(geo_socket, bake.inputs[0])
    for to_sock in downstreams:
        try:
            tree.links.new(bake.outputs[0], to_sock)
        except Exception as e:
            errors.append("接回下游 %s 失败: %s" % (getattr(to_sock, "name", "?"), e))
    return errors


def bake_to_disk(obj, mod, directory, target_bake_node=None, tree=None,
                 bake_mode="STILL", frame_start=None, frame_end=None):
    """触发烘焙，每个触发的记录写独立子目录 <directory>/b<i>。
    target_bake_node 给定 → 只触发目标那条（其余跳过，避免模拟区自带/用户 bake 干扰）；
    未给定 → 全部触发。
    bake_mode: "STILL"（单帧，默认）或 "ANIMATION"（帧范围，需 frame_start/end）。
    返回 (target_dir, (ok, msg))。"""
    os.makedirs(directory, exist_ok=True)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if tree is not None:
        for n in tree.nodes:
            try:
                n.socket_value_update(bpy.context)
            except Exception:
                pass
    obj.update_tag(refresh={'DATA'})
    bpy.context.scene.frame_set(bpy.context.scene.frame_current)
    bpy.context.view_layer.update()
    target_dir = None
    errors = []
    for i, bk in enumerate(mod.bakes):
        bn = getattr(bk, "node", None)
        # 指定了目标节点 → 只触发目标那条，其余跳过
        if target_bake_node is not None and bn != target_bake_node:
            continue
        bk_dir = os.path.join(directory, "b%d" % i)
        os.makedirs(bk_dir, exist_ok=True)
        try:
            bk.bake_target = "DISK"
            bk.use_custom_path = True
            bk.directory = bk_dir
            bk.bake_mode = bake_mode
            if frame_start is not None:
                bk.frame_start = frame_start
                bk.frame_end = frame_end
        except Exception as e:
            errors.append("设 bake 配置失败: %s" % e)
            continue
        try:
            bpy.ops.object.geometry_node_bake_delete_single(
                session_uid=obj.session_uid, modifier_name=mod.name, bake_id=bk.bake_id)
        except Exception:
            pass
        res = bpy.ops.object.geometry_node_bake_single(
            session_uid=obj.session_uid, modifier_name=mod.name, bake_id=bk.bake_id)
        if res != {"FINISHED"}:
            errors.append("触发 bake 返回 %s" % res)
            continue
        if target_bake_node is not None and bn == target_bake_node:
            target_dir = bk_dir
    if target_bake_node is not None and target_dir is None:
        errors.append("未找到目标 bake 记录对应的目录")
    return target_dir, (not errors, "；".join(errors))


def bake_round(tree, mod, obj, directory, target_bake_node=None,
               bake_mode="STILL", frame_start=None, frame_end=None):
    """烘焙一轮并翻译。返回 (data, target_dir)。
    bake_mode="ANIMATION" 时 data 为 {帧号: 翻译结果}；否则为单帧翻译结果。"""
    target_dir, (ok, msg) = bake_to_disk(obj, mod, directory, target_bake_node, tree,
                                         bake_mode, frame_start, frame_end)
    if not ok or target_dir is None:
        raise RuntimeError("烘焙失败: %s" % msg)
    if bake_mode == "ANIMATION":
        return bake_data_translate.translate_all(target_dir), target_dir
    return bake_data_translate.translate(target_dir), target_dir