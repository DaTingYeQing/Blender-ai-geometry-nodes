# -*- coding: utf-8 -*-
"""node_build.py —— 节点批次的调用方（外层的通道入口）

======================================================================
它和 node_builder.py 的分工（别搞混）
======================================================================
  node_build.py    ← 本文件：**外层**，不碰 bpy。负责拼批次、定落盘位置、
                     经 blender_channel 把载荷送进 Blender、再把结果读回来汇报。
  node_builder.py  ← **载荷**，在 Blender 进程里跑，用 bpy 建节点。

  两者不在同一个进程里，通过「batch.json 进去 / result.json 出来」交换数据。

======================================================================
用法
======================================================================
    python node_build.py <payload.json>
    python node_build.py --demo          # 内置演示：空场景跑一遍，不碰任何 .blend

payload.json = **批次本身**，外加几个可选的传送字段：

    {
      "tree": "AI_Break",                       // 节点组名（也可写 "group"，等价）
      "interface": [{"direction":"input","name":"Scale","socket_type":"NodeSocketFloat"}],
      "add":   ["GeometryNodeMeshCube", "GeometryNodeSetPosition"],
      "set":   [{"node":"Cube","prop":"Vertices X","value":3}],
      "link":  ["Cube.Mesh → Set Position.Geometry"],
      "unlink":[], "del":[], "add_item":[],

      "out_dir": "C:/.../PI_work",              // 可选，产物写哪儿。不给=用工作区(envcard.WORKSPACE)；
                                                //       两处都没有就报错，绝不写进 skill 源码目录
      "read":    "C:/.../X.blend",              // 可选，启动时打开哪个 .blend；"new"=空场景。
                                                //       不给则自动找工作档（见下）
      "save":    "C:/.../X.blend",              // 可选，跑完存哪儿；"no"/false=不存。
                                                //       不给则默认存回 read 的那个档
      "timeout": 120,                           // 可选，超时秒数
      "workdir": "C:/.../"                      // 可选，去哪找 workflow_state.json
    }

工作档怎么找（不给 read 时）：payload["workdir"] → 工作区(envcard.WORKSPACE)，不看当前目录，
依次找 workflow_state.json 里的 "blend" 字段。

落盘产物（都在 out_dir 下）：
    _node_builder_batch.json   本次批次（存档，出问题时可原样重跑）
    screen.json                节点树快照（AI 精确引用的唯一通道）
    node_builder_result.json   业务结果 {ok, submitted, applied, errors[code/hint], warnings}

======================================================================
返回（打印到 stdout 的 JSON）
======================================================================
    {
      "ok": bool,                 # 通道 ok 且业务 ok
      "tree": str,
      "summary": "全部成功" / "有 N 处没成功：...",   # 给人看的一句话
      "submitted": {...}, "applied": {...},          # 每个动作提交几条 / 成功几条
      "errors": [...], "warnings": [...],            # 结构化条目（带 code/hint）
      "out_dir_used": "...", "out_dir_source": "...",# 产物实际落在哪、按哪一档落的
      "batch": "...", "result_json": "...", "screen_json": "...",
      "saved": str|null,          # 实际存到哪个档（没存就是 null）
      "channel": {"ok","exit_code","error","traceback","duration_ms"}
    }

    summary 这段文案原来在前端 blender_build.ts 里（靠正则从 stdout 抠 [errors]），
    现在由后端直接给结构化数据 —— 前端不必再解析文本。

退出码：ok → 0，否则 1。
"""
import json
import os
import sys

# 本文件所在目录 = skills/execution/，同目录有 blender_channel.py / envcard.py / node_builder.py
WS = os.path.dirname(os.path.abspath(__file__))

BATCH_NAME = "_node_builder_batch.json"
RESULT_NAME = "node_builder_result.json"
SCREEN_NAME = "screen.json"
_STATE_NAME = "workflow_state.json"

# 批次里允许出现的字段（白名单：其它键一律不进 batch.json，避免脏数据）
_BATCH_KEYS = ("tree", "tree_type", "interface", "add", "add_item",
               "set", "link", "unlink", "del", "out_dir")
# 至少要有一个动作，否则这次提交没有任何意义
_ACTION_KEYS = ("interface", "add", "add_item", "set", "link", "unlink", "del")


# ---------------------------------------------------------------- 落盘位置
def _read_workspace():
    """取工作区路径（envcard → py_environment.json）。拿不到返回空串。"""
    try:
        from envcard import WORKSPACE
        return str(WORKSPACE or "").strip()
    except Exception:
        return ""


def _resolve_out_dir(payload):
    """定下产物写哪儿。返回 (out_dir, source, error)。

    顺序：payload["out_dir"] → envcard.WORKSPACE（工作区）。
    **故意不兜到脚本所在目录** —— 产物绝不能落进 skill 源码目录，否则会把代码树弄脏。
    两者都没有就报错，让调用方去 py_environment.json 里配 workspace.root。
    """
    explicit = str(payload.get("out_dir") or "").strip()
    if explicit:
        out_dir, source = explicit, "payload"
    else:
        ws = _read_workspace()
        if not ws:
            return "", "", ("没给 out_dir，也拿不到工作区：读 envcard 失败或 workspace.root 是空的。"
                            "请在 py_environment.json 里配好 workspace.root，"
                            "或者在 payload 里显式传 out_dir。")
        out_dir, source = ws, "工作区(envcard.WORKSPACE)"
    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception as e:
        return "", "", f"产物目录建不出来：{out_dir}（{type(e).__name__}: {e}）"
    return out_dir, source, None


# ---------------------------------------------------------------- 工作档
def _find_state_file(payload):
    """找 workflow_state.json。顺序：payload["workdir"] → 工作区。不看当前目录，找不到返回 None。"""
    cands = []
    wd = str(payload.get("workdir") or "").strip()
    if wd:
        cands.append(wd)
    ws = _read_workspace()
    if ws:
        cands.append(ws)
    for d in cands:
        p = os.path.join(d, _STATE_NAME)
        if os.path.isfile(p):
            return p
    return None


def _coerce_bool(v, default=False):
    """宽松布尔：真/假的各种字符串写法都认。"""
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    text = str(v).strip().lower()
    if text in ("1", "true", "yes", "y", "on"):
        return True
    if text in ("0", "false", "no", "n", "off", ""):
        return False
    return default


# ---------------------------------------------------------------- 递交通道
def _submit_to_blender(batch_path, read, save, state_path, timeout):
    """把批次交给 blender_channel 送进 Blender，返回它那套结果 dict。

    本文件**不碰任何地址**：Blender 装在哪，由 blender_channel 自己从 envcard 取。
    """
    try:
        import blender_channel
    except Exception as e:
        return {
            "ok": False, "exit_code": None, "saved": None, "duration_ms": None,
            "traceback": None, "stdout": "", "stderr": "",
            "error": (f"找不到 blender_channel.py（它应该和 node_build.py 同目录，即 {WS}）："
                      f"{type(e).__name__}: {e}"),
        }
    # blender_channel.run 保证任何情况下都不抛异常，出错也返回 ok=False 的 dict
    return blender_channel.run(
        script=os.path.join(WS, "node_builder.py"),
        blend=read,
        save=save,
        state_path=state_path,
        timeout=timeout,
        script_args=[batch_path],   # 批次路径经 `--` 之后透传给载荷
    )


# ---------------------------------------------------------------- 结果汇报
def _action_counts(business):
    """把批次里每个动作的「成功/提交」拼成 ['set 2/2', 'link 7/7']（只列提交过的）。

    键序 = 后端写入顺序 = ACTION_REGISTRY 的执行顺序，读回来是稳定的。
    """
    submitted = business.get("submitted") or {}
    applied = business.get("applied") or {}
    out = []
    for name, n in submitted.items():
        if not n:
            continue
        out.append(f"{name} {applied.get(name, 0)}/{n}")
    return out


def _summarize(business):
    """把业务结果压成一句人话。

    这段逻辑原来在前端（buildStatusText 用正则从 stdout 抠 [errors]/[warnings]），
    现在后端直接给结构化数据，这里只是顺手拼一句摘要。
    批次里超过一个动作时（如 link 顺带 set），额外列出每个动作的成功/提交条数，
    免得顺带做掉的动作在文本上看不见。
    """
    errs = business.get("errors") or []
    if not errs:
        text = "全部成功"
    else:
        lines = [f"有 {len(errs)} 处没成功："]
        for e in errs:
            line = "  - " + str(e.get("msg", ""))
            if e.get("hint"):
                line += f"（建议：{e['hint']}）"
            lines.append(line)
        text = "\n".join(lines)
    counts = _action_counts(business)
    if len(counts) > 1:
        text += "\n明细：" + "、".join(counts)
    warns = business.get("warnings") or []
    if warns:
        text += "\n提示：" + "；".join(str(w.get("msg", "")) for w in warns)
    return text


def _load_business_result(out_dir):
    """读回 node_builder_result.json；读不到返回 (None, 错误说明)。"""
    path = os.path.join(out_dir, RESULT_NAME)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), None, path
    except Exception as e:
        return None, f"读不到 {path}（{type(e).__name__}: {e}）", path


# ---------------------------------------------------------------- 主流程
def run_build(payload):
    """跑一次节点构建。返回结果 dict（绝不抛异常）。"""
    if not isinstance(payload, dict):
        return {"ok": False, "error": "payload 必须是 JSON 对象"}

    # --- 1. 批次字段白名单 + group 别名 ---
    batch = {k: payload[k] for k in _BATCH_KEYS if k in payload}
    if not batch.get("tree") and payload.get("group"):
        batch["tree"] = str(payload["group"]).strip()
    if not any(k in batch for k in _ACTION_KEYS):
        return {"ok": False,
                "error": ("批次是空的：至少要给一个动作字段"
                          f"（{'/'.join(_ACTION_KEYS)}）。")}

    # --- 2. 落盘位置（显式 > 工作区；两处都没有就报错） ---
    out_dir, out_dir_source, out_err = _resolve_out_dir(payload)
    if out_err:
        return {"ok": False, "error": out_err}
    # 让载荷也写进同一个目录（显式传下去，避免它再去猜）
    batch["out_dir"] = out_dir

    batch_path = os.path.join(out_dir, BATCH_NAME)
    try:
        with open(batch_path, "w", encoding="utf-8") as f:
            json.dump(batch, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return {"ok": False, "error": f"写批次文件失败：{batch_path}（{type(e).__name__}: {e}）"}

    # --- 3. 工作档 ---
    state_path = _find_state_file(payload)
    has_read = "read" in payload and payload.get("read") is not None
    has_save = "save" in payload and payload.get("save") is not None
    read = payload.get("read") if has_read else None      # None → 通道自己从工作档取
    if has_save:
        save = payload.get("save")
    else:
        save = None                                        # None → 通道默认存回读的那个档

    timeout = payload.get("timeout", 120)

    # --- 4. 送进 Blender ---
    ch = _submit_to_blender(batch_path, read, save, state_path, timeout)

    # --- 5. 读回业务结果 ---
    business, biz_err, result_path = _load_business_result(out_dir)
    business = business or {}

    channel_ok = bool(ch.get("ok"))
    biz_ok = bool(business.get("ok")) if business else False
    ok = channel_ok and biz_ok

    result = {
        "ok": ok,
        "tree": business.get("tree") or batch.get("tree") or "AI_Build",
        "submitted": business.get("submitted") or {},
        "applied": business.get("applied") or {},
        "errors": business.get("errors") or [],
        "warnings": business.get("warnings") or [],
        "out_dir_used": out_dir,
        "out_dir_source": out_dir_source,
        "batch": batch_path,
        "result_json": result_path,
        "screen_json": os.path.join(out_dir, SCREEN_NAME),
        "saved": ch.get("saved"),
        "channel": {
            "ok": channel_ok,
            "exit_code": ch.get("exit_code"),
            "error": ch.get("error"),
            "traceback": ch.get("traceback"),
            "duration_ms": ch.get("duration_ms"),
        },
    }

    if business:
        result["summary"] = _summarize(business)
    elif biz_err:
        # 载荷压根没产出结果 → 通道多半是挂了（traceback 在 channel.traceback 里）
        result["summary"] = "没拿到业务结果：" + (ch.get("error") or biz_err)
        result["error"] = ch.get("error") or biz_err
    else:
        result["summary"] = "没有输出"

    if not ok and not result.get("error"):
        result["error"] = (ch.get("error")
                           or f"构建失败（exit={ch.get('exit_code')}）："
                              f"{(ch.get('stderr') or ch.get('stdout') or '(无输出)')[:400]}")
    return result


# ---------------------------------------------------------------- 入口
def _demo():
    """内置演示：真跑一遍全链路（拼批次 → 通道 → Blender 建树 → 读回结果）。

    显式 read="new" + save=False：开一个用完就扔的空场景，**不碰任何 .blend**。
    产物仍按正常规矩落到工作区（envcard.WORKSPACE），顺带验证地址链路是通的。
    """
    demo = {
        "tree": "AI_Demo_Build",
        "interface": [{"direction": "input", "name": "Scale", "socket_type": "NodeSocketFloat"},
                      {"direction": "output", "name": "Geometry", "socket_type": "NodeSocketGeometry"}],
        "add": ["GeometryNodeMeshCube", "GeometryNodeSetPosition"],
        "set": [{"node": "Cube", "prop": "Vertices X", "value": 3},
                {"node": "Set Position", "prop": "Offset", "value": [0, 0, 1]}],
        "link": ["Cube.Mesh → Set Position.Geometry",
                 "Set Position.Geometry → Group Output.Geometry"],
        "read": "new",     # 空场景：不读任何档
        "save": False,     # 不存盘：不改任何档
    }
    res = run_build(demo)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if res.get("ok"):
        print("\n--- 人话摘要 ---\n" + str(res.get("summary")))
    return 0 if res.get("ok") else 1


def main(argv):
    if len(argv) >= 2 and argv[1] == "--demo":
        return _demo()
    if len(argv) < 2:
        print("用法: python node_build.py <payload.json>   或   python node_build.py --demo",
              file=sys.stderr)
        return 2
    try:
        with open(argv[1], "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        print(f"读 payload 失败：{argv[1]}（{type(e).__name__}: {e}）", file=sys.stderr)
        return 2
    result = run_build(payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
