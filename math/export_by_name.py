"""export_by_name.py — 在 Blender 里按「物体 + 几何节点」导出网格/点云（PLY）

用法（Blender 无头模式）：
    blender --background --python export_by_name.py -- <场景.blend> <物体名> <修改器名> <几何节点名> <输出.ply> [帧号]

说明：
- 按物体名字（Object name）选中目标，按名字定位几何节点修改器（AI 必填）
- **组输出改接到 AI 指定的几何节点**：导出该节点输出处的几何（内存中修改，不保存文件）
- 帧号（可选）：不填 → 用场景当前帧；填 N → 先从第 1 帧逐帧推进到第 N 帧再导出
  模拟区 / For Each 这类求值【有状态】（state_{t+1}=F(state_t)），跳帧拿到的是第 1 帧的
  状态（实测），所以必须逐帧走；预热约 0.25ms/帧，几十帧可忽略
- 永远 GeometrySet 模式：求值几何的分量自动检测
    * 检测到实例 → 在指定节点后、组输出前自动插入 Realize Instances（其他分量透传）
    * mesh       → 顶点+面 → <输出.ply>
    * pointcloud → 纯顶点   → <输出.ply>（仅点云时）或 <输出>_points.ply（与网格共存时）
    * curves / volume → 提示"暂不支持"，跳过
    * 全无 → 报"没有此类型"
- 报告：检测到的分量 + 每个文件的绝对路径
- 几何节点名填 LIST → 只 dump 节点清单（名字 + 类型 + 几何输出）供 AI 参考
"""
import os
import sys
import time

import bpy


def write_ply(verts, faces, path: str) -> None:
    """用原始顶点/面索引写 ASCII PLY；faces 为空时写出纯顶点文件（点云）。"""
    with open(path, "w") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(verts)}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        f.write(f"element face {len(faces)}\n")
        f.write("property list uchar int vertex_indices\n")
        f.write("end_header\n")
        for v in verts:
            f.write(f"{v[0]:.9f} {v[1]:.9f} {v[2]:.9f}\n")
        for fc in faces:
            f.write(f"{len(fc)} {' '.join(str(i) for i in fc)}\n")


def dump_nodes(ng) -> None:
    """打印节点组里的节点清单（名字 + 类型 + 几何输出 socket），供 AI 选择导出点。"""
    print(f"节点组: {ng.name}（{len(ng.nodes)} 个节点）")
    for n in ng.nodes:
        geo = [f"{s.name}:{s.type}" for s in n.outputs if s.type in ("GEOMETRY", "INSTANCE")]
        print(f"NODE {n.name} | {n.bl_idname} | geo_out: {', '.join(geo) if geo else '(无几何输出)'}")


def _find_gn_modifier(obj, modifier_name):
    """按名字找几何节点修改器；找不到 / 不是 GN 类型 → 报错退出。"""
    mod = obj.modifiers.get(modifier_name)
    if mod is None:
        avail = ", ".join(f"{m.name}({m.type})" for m in obj.modifiers) or "(无修改器)"
        print(f"错误: 物体 '{obj.name}' 没有名为 '{modifier_name}' 的修改器。可用: {avail}")
        sys.exit(1)
    if mod.type not in ("NODES", "NODE_GROUP"):  # 4.x 用 NODES，旧版用 NODE_GROUP
        print(f"错误: 修改器 '{modifier_name}' 类型是 {mod.type}，不是几何节点修改器")
        sys.exit(1)
    return mod


def _rewire_group_output(ng, target_node):
    """组输出的 Geometry 输入改接 target_node 的几何输出。

    返回 (geo_in, changed)；target_node 无几何输出 → 报错退出。
    """
    out_node = next((n for n in ng.nodes if n.type == "GROUP_OUTPUT"), None)
    if out_node is None:
        print("错误: 节点组里没有 Group Output")
        sys.exit(1)
    geo_in = next((s for s in out_node.inputs if s.type == "GEOMETRY"), None)
    if geo_in is None:
        print("错误: Group Output 没有 Geometry 输入")
        sys.exit(1)
    src_socket = next((s for s in target_node.outputs if s.type in ("GEOMETRY", "INSTANCE")), None)
    if src_socket is None:
        print(f"错误: 节点 '{target_node.name}' 不是几何节点（没有 GEOMETRY/INSTANCE 类型输出）")
        sys.exit(1)
    existing = [l for l in ng.links if l.to_socket == geo_in]
    if len(existing) == 1 and existing[0].from_socket == src_socket:
        return geo_in, False  # 已连到目标节点，无需改
    for l in existing:
        ng.links.remove(l)
    ng.links.new(src_socket, geo_in)
    return geo_in, True


def _ensure_realize(ng, geo_in) -> bool:
    """在组输出 Geometry 输入前确保 Realize Instances；末端已是则跳过。返回是否插入。"""
    links = [l for l in ng.links if l.to_socket == geo_in]
    if not links:
        return False
    if links[0].from_node.bl_idname == "GeometryNodeRealizeInstances":
        return False  # 输出链末端已是 Realize，不重复插
    link = links[0]
    from_socket, to_socket = link.from_socket, link.to_socket
    ng.links.remove(link)
    ri = ng.nodes.new("GeometryNodeRealizeInstances")
    ng.links.new(from_socket, ri.inputs[0])
    ng.links.new(ri.outputs[0], to_socket)
    return True


def _get_geometry_set(obj, dg):
    """取求值物体的 GeometrySet（4.5 新增 API，全量分量）。"""
    eval_obj = obj.evaluated_get(dg)
    return eval_obj.evaluated_geometry()


def _extract(gs):
    """从 GeometrySet 提取各分量，返回 (mesh_verts, mesh_faces, point_coords, has_curves, has_volume)。"""
    mesh = gs.mesh
    mesh_verts = [(v.co[0], v.co[1], v.co[2]) for v in mesh.vertices] if mesh else []
    mesh_faces = [tuple(p.vertices) for p in mesh.polygons] if mesh else []
    pc = gs.pointcloud
    point_coords = [(p.co[0], p.co[1], p.co[2]) for p in pc.points] if pc else []
    return mesh_verts, mesh_faces, point_coords, gs.curves is not None, gs.volume is not None


def _advance_to_frame(target: int) -> None:
    """从第 1 帧逐帧推进到 target 帧。

    模拟区（Simulation Zone）/ For Each 是【有状态】求值：state_{t+1} = F(state_t)。
    实测直接 frame_set(N) 拿到的是第 1 帧的状态，必须逐帧走（约 0.25ms/帧）。
    """
    scn = bpy.context.scene
    t0 = time.time()
    for f in range(1, int(target) + 1):
        scn.frame_set(f)
    print(f"已推进到第 {target} 帧（从第 1 帧逐帧预热，用时 {time.time() - t0:.2f}s）")


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) < 5:
        print(
            "用法: blender --background --python export_by_name.py -- "
            "<场景.blend> <物体名> <几何节点修改器名> <几何节点名|LIST> <输出.ply> [帧号]"
        )
        sys.exit(1)
    blend_path, obj_name, modifier_name, node_name, out_path = args[:5]
    frame_arg = (args[5] if len(args) > 5 else "").strip()

    # 打开场景（先自己检查，错误信息比 Blender 的原始报错清楚）
    if not os.path.isfile(blend_path):
        print(f"错误: 找不到 .blend 文件: {blend_path}")
        sys.exit(1)
    try:
        bpy.ops.wm.open_mainfile(filepath=blend_path)
    except RuntimeError as e:
        print(f"错误: 打开 .blend 失败: {e}")
        sys.exit(1)

    # 按名字找物体
    if obj_name not in bpy.data.objects:
        names = ", ".join(sorted(o.name for o in bpy.data.objects))
        print(f"错误: 找不到物体 '{obj_name}'。场景里可用的物体: {names}")
        sys.exit(1)
    obj = bpy.data.objects[obj_name]

    # 按名字找修改器
    mod = _find_gn_modifier(obj, modifier_name)
    ng = mod.node_group
    if ng is None:
        print(f"错误: 修改器 '{modifier_name}' 没有指定节点组")
        sys.exit(1)

    # LIST 模式：dump 节点清单供 AI 参考
    if node_name == "LIST":
        dump_nodes(ng)
        sys.exit(0)

    # 按名字找节点
    target = ng.nodes.get(node_name)
    if target is None:
        names = ", ".join(sorted(n.name for n in ng.nodes))
        print(f"错误: 节点组 '{ng.name}' 里找不到节点 '{node_name}'。可用节点: {names}")
        sys.exit(1)

    # 推进到指定帧。必须在改接/插 Realize 【之前】：先让原树按原配置跑完预热，
    # 改树会改变求值内容（可能变慢，甚至因导出点选在区内部而报错）。
    if frame_arg:
        try:
            target_frame = int(frame_arg)
        except ValueError:
            print(f"错误: 帧号 '{frame_arg}' 不是整数")
            sys.exit(1)
        _advance_to_frame(target_frame)

    # 组输出改接到指定节点
    geo_in, changed = _rewire_group_output(ng, target)
    if changed:
        print(f"已将 Group Output 改接到节点 '{node_name}'")

    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()

    # 检测实例：只有检测到实例才在指定节点后插 Realize Instances（其他分量透传）
    gs = _get_geometry_set(obj, dg)
    if gs.instances_pointcloud() is not None:
        if _ensure_realize(ng, geo_in):
            print("检测到实例，已自动插入 Realize Instances")
            dg.update()
            gs = _get_geometry_set(obj, dg)

    mesh_verts, mesh_faces, point_coords, has_curves, has_volume = _extract(gs)

    if has_curves:
        print("警告: 检测到曲线分量，暂不支持导出，已跳过")
    if has_volume:
        print("警告: 检测到体积分量，暂不支持导出，已跳过")

    # 分量分发：mesh / pointcloud 分开文件；全无 → 报错
    components = []
    if mesh_verts or mesh_faces:
        components.append("mesh")
    if point_coords:
        components.append("pointcloud")
    if not components:
        print("错误: 没有此类型（求值结果中不存在网格/点云分量）")
        sys.exit(1)

    mesh_path = out_path
    points_path = None
    if point_coords and mesh_verts:
        root, ext = os.path.splitext(out_path)
        points_path = f"{root}_points{ext}"
    elif point_coords:
        points_path = out_path
        mesh_path = None

    if mesh_path is not None:
        write_ply(mesh_verts, mesh_faces, mesh_path)
    if points_path is not None:
        write_ply(point_coords, [], points_path)

    print(f"检测到分量: {', '.join(components)}")
    for label, p in (("mesh", mesh_path), ("pointcloud", points_path)):
        if p is not None:
            print(f"文件[{label}]: {os.path.abspath(p)}")


if __name__ == "__main__":
    main()
