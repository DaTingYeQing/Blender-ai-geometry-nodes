"""export_by_name.py — 在 Blender 里按「物体 + 几何节点」导出网格/点云（PLY）

meshkit 的 Blender 侧入口；真正的导出逻辑在 meshkit/blender_export.py，
与拟合底座共用同一份实现（改接组输出、Realize Instances、恢复节点树）。

用法（Blender 无头模式）：
    blender --background --python export_by_name.py -- <场景.blend> <物体名> <修改器名> <几何节点名> <输出.ply> [帧号]
"""

import os
import sys

import bpy

# 本文件在 shard/meshkit/，把 shard 放进 sys.path 才能 import meshkit.blender_export
_SHARD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SHARD not in sys.path:
    sys.path.insert(0, _SHARD)

from meshkit.blender_export import advance_to_frame, export_geometry, list_nodes  # noqa: E402


def _find_gn_modifier(obj, modifier_name):
    mod = obj.modifiers.get(modifier_name)
    if mod is None:
        avail = ", ".join(f"{m.name}({m.type})" for m in obj.modifiers) or "(无修改器)"
        print(f"错误: 物体 '{obj.name}' 没有名为 '{modifier_name}' 的修改器。可用: {avail}")
        sys.exit(1)
    if mod.type not in ("NODES", "NODE_GROUP"):
        print(f"错误: 修改器 '{modifier_name}' 类型是 {mod.type}，不是几何节点修改器")
        sys.exit(1)
    return mod


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

    if not os.path.isfile(blend_path):
        print(f"错误: 找不到 .blend 文件: {blend_path}")
        sys.exit(1)
    try:
        bpy.ops.wm.open_mainfile(filepath=blend_path)
    except RuntimeError as exc:
        print(f"错误: 打开 .blend 失败: {exc}")
        sys.exit(1)

    if obj_name not in bpy.data.objects:
        names = ", ".join(sorted(o.name for o in bpy.data.objects))
        print(f"错误: 找不到物体 '{obj_name}'。场景里可用的物体: {names}")
        sys.exit(1)
    obj = bpy.data.objects[obj_name]

    mod = _find_gn_modifier(obj, modifier_name)
    ng = mod.node_group
    if ng is None:
        print(f"错误: 修改器 '{modifier_name}' 没有指定节点组")
        sys.exit(1)

    if node_name == "LIST":
        print(f"节点组: {ng.name}（{len(ng.nodes)} 个节点）")
        for line in list_nodes(ng):
            print(line)
        sys.exit(0)

    target = ng.nodes.get(node_name)
    if target is None:
        names = ", ".join(sorted(n.name for n in ng.nodes))
        print(f"错误: 节点组 '{ng.name}' 里找不到节点 '{node_name}'。可用节点: {names}")
        sys.exit(1)

    if frame_arg:
        try:
            target_frame = int(frame_arg)
        except ValueError:
            print(f"错误: 帧号 '{frame_arg}' 不是整数")
            sys.exit(1)
        advance_to_frame(target_frame)

    try:
        info = export_geometry(obj, ng, target, out_path)
    except RuntimeError as exc:
        print(f"错误: {exc}")
        sys.exit(1)

    print(f"检测到分量: {', '.join(info['components'])}")
    for label, path in info["files"].items():
        if path is not None:
            print(f"文件[{label}]: {path}")
    for item in info["skipped"]:
        print(f"警告: 检测到{item}分量，暂不支持导出，已跳过")


if __name__ == "__main__":
    main()
