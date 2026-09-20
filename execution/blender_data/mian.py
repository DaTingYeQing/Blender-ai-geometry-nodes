"""
blender_data 主入口 — 由 blender_run.py 调用，在 Blender 内运行。

用法：
    python blender_run.py blender_data/mian.py <payload.json> --read=<原档> --save=no

payload.json 结构：
    {
      "object": "ShardCube",
      "group": "AI_Shard_Main",
      "mode": "geometry" | "numeric",
      "node": "设置位置",          // geometry 模式
      "nodes": ["矢量运算.001.Value"],  // numeric 模式（节点名.插座名）
      "frames": "1-15",           // numeric 模式可选：帧范围（≤15帧），不填=当前帧单值
      "sets": [{"node":"...","prop":"...","value":...}],
      "out_dir": "C:/.../bake_run"
    }
"""
import bpy
import json
import os
import sys

# 添加 blenderdata2.0/ 和 blender_data/ 到导入路径
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (_BASE, os.path.join(_BASE, 'blender_data')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _geometry_mode import geometry_run
from _numeric_mode import numeric_run


def _payload(argv):
    for a in argv:
        if a.lower().endswith(".json"):
            with open(a, "r", encoding="utf-8") as f:
                return json.load(f)
    raise SystemExit("用法: mian.py <payload.json>")


def _emit(out_root, payload):
    result_path = os.path.join(out_root, "result.json")
    os.makedirs(out_root, exist_ok=True)
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return result_path


def _fail(out_root, msg):
    _emit(out_root, {"ok": False, "error": msg})
    print("[blender_data] FAIL: %s" % msg[:200])


def _find_object_using_group(group_name):
    """按节点组名找到使用该组的第一个物体。"""
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        for mod in obj.modifiers:
            if mod.type == 'NODES' and mod.node_group and mod.node_group.name == group_name:
                return obj
    return None


def main():
    p = _payload(sys.argv[1:])
    group_name = str(p.get("group") or "").strip()
    out_root = p.get("out_dir") or os.path.join(
        os.path.dirname(os.path.abspath(sys.argv[0])), "_bd_out")

    # 找物体
    obj = None
    if p.get("object"):
        obj = bpy.data.objects.get(p["object"])
    obj = obj or _find_object_using_group(group_name)
    if obj is None:
        what = ("物体 %r" % p.get("object")) if p.get("object") else "小组 %r" % group_name
        _fail(out_root, "找不到 %s 对应的物体(modifier)" % what)
        return

    mod = next((m for m in obj.modifiers if m.type == "NODES"), None)
    if mod is None:
        _fail(out_root, "%s 无 NODES modifier" % obj.name)
        return

    if not group_name:
        group_name = mod.node_group.name
    tree = bpy.data.node_groups.get(group_name) or mod.node_group
    if tree is None:
        _fail(out_root, "找不到节点组 %r" % group_name)
        return

    mode = p.get("mode", "geometry")

    if mode == "numeric":
        node_names = p.get("nodes") or []
        if not node_names:
            _fail(out_root, "numeric 模式需要 nodes 列表")
            return
        result = numeric_run(tree, mod, obj, node_names, out_root, frames=p.get("frames"))
        if not result.get("ok"):
            _fail(out_root, result.get("error", "未知错误"))
            return
        result["mode"] = "numeric"
        result_path = _emit(out_root, result)
        print("[blender_data] numeric done -> %s" % result_path)
        return

    # 默认 geometry 模式
    result = geometry_run(tree, mod, obj, dict(p), out_root)
    if not result.get("ok"):
        _fail(out_root, result.get("error", "未知错误"))
        return
    result_path = _emit(out_root, result)
    print("[blender_data] geometry done -> %s" % result_path)


if __name__ == "__main__":
    main()