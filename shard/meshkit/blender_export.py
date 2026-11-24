# -*- coding: utf-8 -*-
"""Blender 侧几何导出（mesh / pointcloud），meshkit 与 fitting 共用。

约定：
- 只依赖 bpy，不依赖 fitting 其他模块，可以在 Blender 的 python 里直接 import
- 导出前后会临时改接 Group Output 到目标节点，结束后恢复原链接
- 返回字典和 stdout 文案保持与旧 export_by_name 兼容（meshkit 靠这两样解析）
"""

from __future__ import annotations

import os
import time


def write_ply(verts, faces, path: str) -> None:
    """二进制小端 PLY；faces 为空时写出纯顶点文件（点云）。

    文本 PLY 在大网格上既慢又占空间，这里统一写 binary_little_endian：
    顶点 float32，面 uchar 计数 + int32 索引。
    """
    import numpy as np

    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)

    points = np.asarray(verts, dtype="<f4").reshape(-1, 3)
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        "element vertex %d\n"
        "property float x\nproperty float y\nproperty float z\n"
        "element face %d\n"
        "property list uchar int vertex_indices\n"
        "end_header\n"
    ) % (len(points), len(faces))

    body = bytearray()
    for face in faces:
        indices = np.asarray(face, dtype="<i4").ravel()
        if indices.size > 255:
            raise ValueError(
                "二进制 PLY 单个面上限 255 个顶点，实际 %d" % int(indices.size)
            )
        body.append(int(indices.size))
        body.extend(indices.tobytes())

    with open(path, "wb") as handle:
        handle.write(header.encode("ascii"))
        handle.write(points.tobytes())
        handle.write(bytes(body))


def advance_to_frame(target: int) -> None:
    """从第 1 帧逐帧推进到 target（模拟区/For Each 有状态，不能直接跳帧）。"""
    import bpy

    scene = bpy.context.scene
    started = time.time()
    for frame in range(1, int(target) + 1):
        scene.frame_set(frame)
    print("已推进到第 %d 帧（从第 1 帧逐帧预热，用时 %.2fs）" % (target, time.time() - started))


def list_nodes(node_group) -> list[str]:
    """节点清单（名字 + 类型 + 几何输出），math 的 LIST 模式用。"""
    lines = []
    for node in node_group.nodes:
        geo = [f"{s.name}:{s.type}" for s in node.outputs if s.type in ("GEOMETRY", "INSTANCE")]
        lines.append(
            "NODE %s | %s | geo_out: %s"
            % (node.name, node.bl_idname, ", ".join(geo) if geo else "(无几何输出)")
        )
    return lines


def _group_output_geometry(node_group):
    out_node = next((n for n in node_group.nodes if n.type == "GROUP_OUTPUT"), None)
    if out_node is None:
        raise RuntimeError("节点组里没有 Group Output")
    geo_in = next((s for s in out_node.inputs if s.type == "GEOMETRY"), None)
    if geo_in is None:
        raise RuntimeError("Group Output 没有 Geometry 输入")
    return geo_in


def _insert_realize(node_group, geo_in):
    """在组输出前插 Realize Instances；末端已是则返回 None。"""
    link = next((l for l in node_group.links if l.to_socket == geo_in), None)
    if link is None:
        return None
    if link.from_node.bl_idname == "GeometryNodeRealizeInstances":
        return None
    from_socket, to_socket = link.from_socket, link.to_socket
    node_group.links.remove(link)
    node = node_group.nodes.new("GeometryNodeRealizeInstances")
    node_group.links.new(from_socket, node.inputs[0])
    node_group.links.new(node.outputs[0], to_socket)
    return node


def export_geometry(obj, node_group, target_node, out_path: str) -> dict:
    """导出 target_node 输出处的几何（mesh / pointcloud），结束后恢复节点树。

    返回：
        {"components": [...], "files": {"mesh": path|None, "pointcloud": path|None},
         "skipped": [...], "n_vertices": int, "n_faces": int}
    """
    import bpy

    geo_in = _group_output_geometry(node_group)
    src_socket = next(
        (s for s in target_node.outputs if s.type in ("GEOMETRY", "INSTANCE")), None
    )
    if src_socket is None:
        raise RuntimeError("节点 %r 没有几何输出（只支持 mesh）" % target_node.name)

    saved_sources = [link.from_socket for link in node_group.links if link.to_socket == geo_in]
    realize_node = None
    try:
        current = [l for l in node_group.links if l.to_socket == geo_in]
        if not (len(current) == 1 and current[0].from_socket == src_socket):
            for link in current:
                node_group.links.remove(link)
            node_group.links.new(src_socket, geo_in)

        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        geometry_set = obj.evaluated_get(depsgraph).evaluated_geometry()

        if geometry_set.instances_pointcloud() is not None:
            realize_node = _insert_realize(node_group, geo_in)
            if realize_node is not None:
                depsgraph.update()
                geometry_set = obj.evaluated_get(depsgraph).evaluated_geometry()

        mesh = geometry_set.mesh
        verts = [(v.co[0], v.co[1], v.co[2]) for v in mesh.vertices] if mesh else []
        if mesh is not None:
            # 变长 n-gon 会让 trimesh 的二进制 PLY 读取器长度对不上（PLY is unexpected length），
            # 统一走三角化，保证每个 face 固定 3 个顶点。
            mesh.calc_loop_triangles()
            faces = [tuple(t.vertices) for t in mesh.loop_triangles]
        else:
            faces = []
        pointcloud = geometry_set.pointcloud
        points = [(p.co[0], p.co[1], p.co[2]) for p in pointcloud.points] if pointcloud else []
        has_curves = geometry_set.curves is not None
        has_volume = geometry_set.volume is not None

        components = []
        if verts or faces:
            components.append("mesh")
        if points:
            components.append("pointcloud")
        if not components:
            raise RuntimeError("没有此类型（求值结果中不存在网格/点云分量）")

        mesh_path = pointcloud_path = None
        if points and (verts or faces):
            root, ext = os.path.splitext(out_path)
            mesh_path, pointcloud_path = out_path, root + "_points" + ext
        elif points:
            pointcloud_path = out_path
        else:
            mesh_path = out_path

        if mesh_path is not None:
            write_ply(verts, faces, mesh_path)
        if pointcloud_path is not None:
            write_ply(points, [], pointcloud_path)

        skipped = []
        if has_curves:
            skipped.append("curves")
        if has_volume:
            skipped.append("volume")

        return {
            "components": components,
            "files": {
                "mesh": os.path.abspath(mesh_path) if mesh_path else None,
                "pointcloud": os.path.abspath(pointcloud_path) if pointcloud_path else None,
            },
            "skipped": skipped,
            "n_vertices": len(verts),
            "n_faces": len(faces),
            "n_edges": len(mesh.edges) if mesh else 0,
        }
    finally:
        if realize_node is not None:
            node_group.nodes.remove(realize_node)
        for link in [l for l in node_group.links if l.to_socket == geo_in]:
            node_group.links.remove(link)
        for source in saved_sources:
            node_group.links.new(source, geo_in)
        bpy.context.view_layer.update()
