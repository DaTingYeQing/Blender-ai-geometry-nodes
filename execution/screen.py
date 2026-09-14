# -*- coding: utf-8 -*-
"""screen.py —— 节点树只读快照（外层入口，不碰 bpy）

和 node_build.py 的分工：node_build 改树，本文件只看树。
流程：拼只含 tree 的空批次（带 no_create=true：组不存在直接报错并列可用组，不静默新建）
     → 经 blender_channel 跑 node_builder.py 产 screen.json
     （save=False：只读工具绝不存盘）→ 读回快照 → 渲染成人读文本。
渲染（接口行 / 分区块 / 聚焦匹配）原来在前端 blender_screen.ts 里，
现在收进后端 —— 前端只剩透传。

用法：
    python screen.py <payload.json>
    python screen.py --demo          # 空场景链路自检，不碰任何 .blend

payload.json：
    {
      "tree": "AI_Break",            // 必填（也可写 "group"，等价），要查的节点组
      "detail": "overview"|"detail", // 可选，默认 detail
      "nodes": ["Cube", ...],        // detail 模式必填：name 或 idname（idname 支持子串模糊）
      "workdir": "C:/.../",          // 可选，去哪找 workflow_state.json
      "timeout": 120                 // 可选，Blender 超时秒数
    }

返回（stdout 单个 JSON）：
    {"ok", "tree", "text", "node_count", "matched", "warnings",
     "screen_json", "channel": {"ok","exit_code","error","traceback","duration_ms"}}
    text 就是给 AI 直接看的渲染文本；ok=false 时带 error。

退出码：ok → 0，否则 1。
"""
import json
import os
import sys

# 本文件所在目录 = skills/execution/，同目录有 blender_channel.py / envcard.py / node_builder.py
WS = os.path.dirname(os.path.abspath(__file__))
if WS not in sys.path:
    sys.path.insert(0, WS)

from node_build import _find_state_file  # 找 workflow_state.json（同一套规矩，不复制）

BATCH_NAME = "_screen_batch.json"   # 查询专用批次名，不覆盖 build 的存档批次
SCREEN_NAME = "screen.json"
RESULT_NAME = "node_builder_result.json"


# ---------------------------------------------------------------- 渲染（搬自旧前端 blender_screen.ts）
def _sock_section(sock):
    return "geo" if sock.get("base_type") == "Geometry" else "num"


def _sock_line(sock, direction):
    tag = sock.get("ref") or sock.get("identifier")
    badge = f"({sock.get('base_type') or sock.get('type') or '?'})"
    linked = sock.get("linked_to") or []
    if not linked:
        return f"  {tag}{badge}  未连接"
    srcs = ", ".join(f"{l.get('node', '?')} {l.get('socket', '')}".strip() for l in linked)
    arrow = "←" if direction == "in" else "→"
    return f"  {tag}{badge}  {arrow} {srcs}"


def _render_node_detail(n):
    """一个节点：按 输入/几何、输入/数值、输出/几何、输出/数值 分四块。"""
    lines = [f"▸ {n.get('name')} [{n.get('idname')}]", ""]
    inputs = n.get("inputs") or []
    outputs = n.get("outputs") or []
    for title, socks, direction in (
        ("输入", inputs, "in"),
        ("输出", outputs, "out"),
    ):
        lines.append(title)
        for sec_title, sec_key in (("几何数据", "geo"), ("数值/其他", "num")):
            lines.append(f"  {sec_title}")
            rows = [s for s in socks if _sock_section(s) == sec_key]
            if not rows:
                lines.append("    null")
            else:
                for s in rows:
                    lines.append("  " + _sock_line(s, direction))
    return "\n".join(lines)


def _overview(screen):
    """粗略模式：全节点清单（idname + name），字符量小。"""
    nodes = screen.get("nodes") or []
    if not nodes:
        return "(无节点)", 0
    lines = [f"{n.get('idname')}  {n.get('name')}" for n in nodes]
    return f"节点清单（共 {len(nodes)} 个，粗略模式）：\n" + "\n".join(lines), len(nodes)


def _focus(screen, targets):
    """详细模式：只渲染匹配到的节点（name 精确 / idname 精确 / idname 子串）。"""
    all_nodes = screen.get("nodes") or []
    if not all_nodes:
        return "(节点为空)", []
    refs = [str(t).strip() for t in targets if str(t).strip()]
    matched = [n for n in all_nodes
               if any(t == n.get("name") or t == n.get("idname") or t in str(n.get("idname"))
                      for t in refs)]
    if not matched:
        avail = ", ".join(f"{n.get('name')} {n.get('idname')}" for n in all_nodes)
        return f"(未匹配到节点。可用: {avail})", []
    return "\n\n".join(_render_node_detail(n) for n in matched), [n["name"] for n in matched]


# ---------------------------------------------------------------- 主流程
def run_screen(payload):
    """跑一次只读查询。返回结果 dict（绝不抛异常）。"""
    if not isinstance(payload, dict):
        return {"ok": False, "error": "payload 必须是 JSON 对象"}
    tree = str(payload.get("tree") or payload.get("group") or "").strip()
    if not tree:
        return {"ok": False, "error": "缺少 tree（要查的节点组名，如 AI_Break）。"}
    detail = str(payload.get("detail") or "detail").strip()
    nodes = payload.get("nodes") or []
    if detail != "overview" and not nodes:
        return {"ok": False,
                "error": "detail 模式需要 nodes（name 或 idname 数组）；只看节点清单请用 detail=overview。"}

    # 产物落工作区（与 node_build 同一套规矩；拿不到就报错，绝不落 skill 目录）
    try:
        from envcard import WORKSPACE
        out_dir = str(WORKSPACE or "").strip()
    except Exception as e:
        return {"ok": False, "error": f"拿不到工作区：读 envcard 失败（{type(e).__name__}: {e}）。"}
    if not out_dir:
        return {"ok": False, "error": "py_environment.json 里的 workspace.root 是空的，请先配好。"}

    # 批次：只含 tree + no_create —— 载荷一个动作都不做，跑完只产 screen.json；
    # 组不存在时报错（tree_not_found，带可用组列表），不替查询方新建空组
    batch_path = os.path.join(out_dir, BATCH_NAME)
    try:
        with open(batch_path, "w", encoding="utf-8") as f:
            json.dump({"tree": tree, "out_dir": out_dir, "no_create": True},
                      f, ensure_ascii=False, indent=2)
    except Exception as e:
        return {"ok": False, "error": f"写批次文件失败：{batch_path}（{type(e).__name__}: {e}）"}

    # 送进 Blender：只读，save=False 绝不存盘（通道默认会存回工作档，必须显式关掉）
    try:
        import blender_channel
    except Exception as e:
        return {"ok": False,
                "error": f"找不到 blender_channel.py（应和 screen.py 同目录，即 {WS}）：{type(e).__name__}: {e}"}
    ch = blender_channel.run(
        script=os.path.join(WS, "node_builder.py"),
        blend=payload.get("read"),     # 不给 → 通道自动找工作档
        save=False,                    # 只读：绝不存盘
        state_path=_find_state_file(payload),
        timeout=payload.get("timeout", 120),
        script_args=[batch_path],
    )
    channel_brief = {"ok": ch.get("ok"), "exit_code": ch.get("exit_code"),
                     "error": ch.get("error"), "traceback": ch.get("traceback"),
                     "duration_ms": ch.get("duration_ms")}
    if not ch.get("ok"):
        return {"ok": False, "tree": tree,
                "error": ch.get("error") or f"通道失败（exit={ch.get('exit_code')}）："
                                             f"{(ch.get('stderr') or ch.get('stdout') or '(无输出)')[:400]}",
                "channel": channel_brief}

    # 读回快照 + 载荷的 warnings（如「组不存在已临时新建」）
    screen_path = os.path.join(out_dir, SCREEN_NAME)
    try:
        with open(screen_path, "r", encoding="utf-8") as f:
            screen = json.load(f)
    except Exception as e:
        return {"ok": False, "tree": tree,
                "error": f"读不到快照 {screen_path}（{type(e).__name__}: {e}）",
                "channel": channel_brief}
    # 读回载荷的业务结果：errors 非空（如组不存在 tree_not_found）→ 直接失败，不渲染空快照
    warnings = []
    errors = []
    try:
        with open(os.path.join(out_dir, RESULT_NAME), "r", encoding="utf-8") as f:
            biz = json.load(f)
        warnings = [w.get("msg", "") for w in (biz.get("warnings") or [])]
        errors = biz.get("errors") or []
    except Exception:
        pass
    if errors:
        e0 = errors[0]
        msg = str(e0.get("msg", "")).strip()
        hint = str(e0.get("hint") or "").strip()
        return {"ok": False, "tree": tree,
                "error": msg + (f"\n{hint}" if hint else ""),
                "errors": errors, "channel": channel_brief}

    if detail == "overview":
        text, count = _overview(screen)
        matched = None
    else:
        text, matched = _focus(screen, nodes)
        count = len(screen.get("nodes") or [])
    if warnings:
        text += "\n提示：" + "；".join(warnings)

    return {"ok": True, "tree": screen.get("tree") or tree, "detail": detail,
            "text": text, "node_count": count, "matched": matched,
            "warnings": warnings, "screen_json": screen_path,
            "channel": channel_brief}


# ---------------------------------------------------------------- 入口
def _demo():
    """空场景链路自检：空场景里没有任何组，查询应报「组不存在」而不是静默新建空组。
    不碰任何 .blend。返回 0 = 报错路径按预期工作。"""
    res = run_screen({"tree": "AI_ScreenDemo", "detail": "overview", "read": "new"})
    print(json.dumps(res, ensure_ascii=False, indent=2))
    expected = (not res.get("ok")) and "不存在" in str(res.get("error", ""))
    print("\n[demo] 组不存在 → 正确报错：" + ("是" if expected else "否（行为变了，检查！）"))
    return 0 if expected else 1


def main(argv):
    if len(argv) >= 2 and argv[1] == "--demo":
        return _demo()
    if len(argv) < 2:
        print("用法: python screen.py <payload.json>   或   python screen.py --demo",
              file=sys.stderr)
        return 2
    try:
        with open(argv[1], "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        print(f"读 payload 失败：{argv[1]}（{type(e).__name__}: {e}）", file=sys.stderr)
        return 2
    result = run_screen(payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
