# -*- coding: utf-8 -*-
"""AI 节点构建器 —— 载荷（在 Blender 进程内运行）
=========================================================
本文件是**载荷**：由外层的 node_build.py 经 blender_channel.py 送进 Blender 执行。
它自己不起进程、不知道 blender.exe 装在哪，也**不该** import blender_channel（两者不在同一进程）。

批次式单子：一次提交一张表单，按固定顺序执行，返回全屏快照（AI 视觉）。
执行后表单即作废（下次是新的一张），所有状态由 Blender 自身管理。

节点引用规则（重做后，不再有自定义序号）：
  - 引用节点统一用 Blender 内置 node.name（唯一、存续期稳定、自动管理 .001 后缀）。
  - socket 统一用 identifier。
  - add 新建节点不需要引用；返回新节点 name 供后续 link/set/del 用。
  - link/unlink/set/del 的节点字段一律填 name。

用法（推荐走 node_build.py —— 它代你拼批次、落盘、读回结果）：
    python node_build.py <payload.json>

也可由 blender_channel.py 直接送进来。**批次路径必须放在 `--` 之后**：
    python blender_channel.py node_builder.py --read=<档|new> --save=<档|no> -- <batch.json>
放在 `--` 前面会被通道当成第二个脚本文件而报错（exit=2）。

批次 JSON 结构（各模块可混填、可留空）：
    {
      "tree": "AI_Build",              // 可选，节点组名，默认 AI_Build
      "tree_type": "GeometryNodeTree", // 可选，默认 GeometryNodeTree
      "interface": [{"direction":"input","name":"Object","socket_type":"NodeSocketObject"},
                    {"direction":"output","name":"Geometry","socket_type":"NodeSocketGeometry"}],
                                      // 可选，节点组边界接口（add 之前执行，建出组输入/组输出的插口）
      "add":    ["GeometryNodeCube", {"type": "..."}],   // 只加节点（不带属性）
      "add_item": [{"zone":"Repeat Output","socket_type":"Float","item_name":"Acc"}],
                                      // 可选，给 zone 输出节点加携带项
      "set":    [{"node":"群组.002","prop":"Socket_1","value":3}],  // 单独改属性，node 用 name
      "link":   ["Mesh Cube.Mesh → Set Position.Geometry"],  // 用「节点name.接口」直接连线
      "unlink": ["0.0 → 1.0", "2.0"],                    // 全式=断这根线；短式=只断该节点的【输入】(节点name.接口)
      "del":    [2, "Cube.001"],                        // 删节点（用序号兜底或缺省名）
      "out_dir": "C:/.../PI_work",                  // 可选，产物写哪儿；不给=用 envcard 的 WORKSPACE
      "no_create": true                             // 可选，只读模式：组不存在时【不】新建，
                                                    //       报 tree_not_found 并列出可用组（screen 查询用）
    }

执行顺序：interface → add → add_item → set → link → unlink → del
- add 按序创建节点，节点 name 由 Blender 自动管理；add 后打印 name 供同轮后续引用
- link 用「节点name.接口 → 节点name.接口」直接连线
- 接口引用（_refs.find_socket）：先按 identifier 精确匹配；对节点组相关节点
  （GeometryNodeGroup / NodeGroupInput / NodeGroupOutput）再按接口 name 兜底——
  它们的 name 来自 interface（如 hi / precision / Precision），比 Socket_N 好读，
  AI 写 name 即可，identifier 由脚本内部转。其他节点（Math 的 Value×3 等）name 会重名，只用 identifier。
  name 在同一节点内命中多个时报错要求改用 identifier，不会静默取第一个。
- unlink 短式的“节点.接口”只在 node.inputs 里找，所以只能断输入侧的线；
  输出侧的线（如 Group Input.Precision 发出的）必须用全式「A.口 → B.口」。

读档/存档由外层通道（blender_channel）的 --read / --save 统一控制（本脚本不碰 .blend 读存）。

输出（写入 out_dir）：
    screen.json              结构化快照（name+idname+接口，AI 精确引用通道）
    node_builder_result.json 结构化执行结果 {ok, submitted, applied, errors[], warnings[]}

out_dir 三级解析（与 math_compile.py 同一套规矩）：
    ① batch 里的 "out_dir" 字段（显式指定，优先）
    ② envcard 的 WORKSPACE（= py_environment.json 的 workspace.root，即工作区）
    ③ 兜底：batch 所在目录（结果里会用 out_dir_source 标注是哪一档，便于发现配错）
    产物绝不写进 skill 源码目录。

代码结构（本文件是薄入口，逻辑在以下模块，全部同目录）：
    _types.py    类型推导与值转换（不碰 bpy 对象）
    _refs.py     引用解析与定位（name/identifier → 真实节点与 socket）
    _errors.py   错误模块：Issue + Collector + 提示渲染
    _actions.py  七个动作 + ACTION_REGISTRY（定义顺序 = 执行顺序）
    _render.py   整屏快照导出
"""
import json
import os
import sys

# Blender 的 --python 不会把脚本所在目录放进 sys.path（实测 sys.path[0] 是插件目录），
# 必须自己插一行，否则下面的 import 会 ModuleNotFoundError。同一目录的兄弟模块依赖这一步。
_DIR = os.path.dirname(os.path.abspath(__file__))
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)

import bpy  # noqa: E402  （须在 sys.path 就绪后导入，保持与兄弟模块一致）

from _actions import ACTION_REGISTRY          # noqa: E402
from _errors import Collector                 # noqa: E402
from _render import render_json               # noqa: E402

RESULT_FILE = "node_builder_result.json"


def _resolve_out_dir(batch, batch_dir):
    """定下产物（screen.json / node_builder_result.json）写哪儿。返回 (out_dir, source)。

    三级：batch["out_dir"] → envcard.WORKSPACE（工作区） → batch 所在目录。
    与 math_compile.py 同一套规矩，只有最后一档不同：那里直接报错，这里兜回 batch 目录
    —— 因为 batch 目录本身就是调用方指定的位置，不属于 skill 源码树。
    source 会写进结果文件，方便一眼看出「产物到底按哪一档落的」。
    """
    explicit = str(batch.get("out_dir") or "").strip()
    if explicit:
        return explicit, "batch.out_dir"
    try:
        from envcard import WORKSPACE
        ws = str(WORKSPACE or "").strip()
        if ws:
            return ws, "工作区(envcard.WORKSPACE)"
    except Exception:
        pass
    return batch_dir, "batch 所在目录（兜底：没拿到 envcard.WORKSPACE）"


def _ensure_dir(path):
    """目录建得出来返回 True。建不出来由调用方兜底，不抛异常。"""
    try:
        os.makedirs(path, exist_ok=True)
        return True
    except Exception:
        return False


def _write_result(out_dir, tree_name, tree_type, created, submitted, applied, col,
                  screen_path, out_dir_source):
    """写结构化结果文件（供调用方直接读，替代从 stdout 抠文本）。

    注意：写失败不影响主流程，也不打印任何内容——stdout 必须保持与改造前一字不差。
    save_policy=partial 表示「部分失败时，成功的改动仍会存盘」是当前既定语义；
    注意通道的 driver 还在 finally 里存盘，所以脚本崩溃时档也会被保存（见 blender_channel）。
    """
    payload = {
        "ok": col.ok(),
        "tool": "node_builder",
        "tree": tree_name,
        "tree_type": tree_type,
        "created": created,
        "save_policy": "partial",
        "submitted": submitted,
        "applied": applied,
        "errors": [i.to_json() for i in col.errors],
        "warnings": [i.to_json() for i in col.warnings],
        "out_dir": out_dir,
        "out_dir_source": out_dir_source,
        "screen_path": screen_path,
    }
    try:
        with open(os.path.join(out_dir, RESULT_FILE), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def main():
    json_args = [a for a in sys.argv if a.lower().endswith(".json")]
    if not json_args:
        print("用法: node_builder.py <batch.json>")
        return
    batch_path = json_args[-1]
    batch_dir = os.path.dirname(os.path.abspath(batch_path))

    with open(batch_path, "r", encoding="utf-8") as f:
        batch = json.load(f)

    # 产物落盘位置：batch.out_dir → envcard.WORKSPACE → batch 所在目录
    out_dir, out_dir_source = _resolve_out_dir(batch, batch_dir)
    if not _ensure_dir(out_dir):
        out_dir, out_dir_source = batch_dir, "batch 所在目录（兜底：目标目录建不出来）"

    tree_name = batch.get("tree", "AI_Build")
    tree_type = batch.get("tree_type", "GeometryNodeTree")
    tree = bpy.data.node_groups.get(tree_name)
    new_group_created = False

    col = Collector()

    # 只读模式（批次带 no_create，如 screen 查询）：组不存在不新建，报错并列出可用组
    if tree is None and batch.get("no_create"):
        avail = sorted(g.name for g in bpy.data.node_groups)
        col.error(f"节点组 {tree_name!r} 不存在",
                  code="tree_not_found",
                  hint="可用组: " + (", ".join(avail) if avail else "(工程里还没有任何节点组)"),
                  where={"tree": tree_name})
        submitted = {a["name"]: 0 for a in ACTION_REGISTRY}
        applied = dict(submitted)
        data = {"tree": tree_name, "tree_type": tree_type, "nodes": []}
        screen_path = os.path.join(out_dir, "screen.json")
        try:
            with open(screen_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        _write_result(out_dir, tree_name, tree_type, False, submitted, applied, col,
                      screen_path, out_dir_source)
        counts = " ".join(f"{a['name']}=0" for a in ACTION_REGISTRY)
        print(f"[node_builder] 完成：{counts}")
        print("[errors]")
        for e in col.error_texts():
            print("  - " + e)
        print("==== 屏幕 ====")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    if tree is None:
        tree = bpy.data.node_groups.new(tree_name, type=tree_type)
        new_group_created = True
    tree.use_fake_user = True

    if new_group_created:
        col.warning(f"节点组 {tree_name} 不存在，已自动新建")

    # 按注册表顺序执行；每条动作前后取错误差值，即得该动作真正成功的条数
    submitted, applied = {}, {}
    for action in ACTION_REGISTRY:
        name, key = action["name"], action["batch_key"]
        items = batch.get(key, [])
        submitted[name] = len(items)
        before = col.failed()
        for item in items:
            action["func"](tree, item, col)
        applied[name] = len(items) - (col.failed() - before)

    try:
        tree.update_tag()
        bpy.context.view_layer.update()
    except Exception:
        pass

    data = render_json(tree)
    screen_path = os.path.join(out_dir, "screen.json")
    try:
        with open(screen_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        col.error(f"写 screen.json 失败：{out_dir}（{e}）", code="screen_write_failed",
                  where={"out_dir": out_dir},
                  hint="检查 py_environment.json 的 workspace.root 是否可写")

    _write_result(out_dir, tree.name, tree.bl_idname, new_group_created, submitted, applied, col,
                  screen_path, out_dir_source)

    # ==== 以下输出格式必须与改造前逐字一致（前端 blender_build.ts 仍在按此格式解析）====
    counts = " ".join(f"{a['name']}={submitted[a['name']]}" for a in ACTION_REGISTRY)
    print(f"[node_builder] 完成：{counts}")
    if col.warnings:
        print("[warnings]")
        for w in col.warning_texts():
            print("  - " + w)
    if col.errors:
        print("[errors]")
        for e in col.error_texts():
            print("  - " + e)
    print("==== 屏幕 ====")
    print(json.dumps(data, ensure_ascii=False, indent=2))


# 守卫不可省：拆成多文件后，任何地方 import 本模块都不应触发一次真实构建。
if __name__ == "__main__":
    main()
