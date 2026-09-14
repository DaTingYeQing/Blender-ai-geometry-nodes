# -*- coding: utf-8 -*-
"""
math_compile.py — 傻瓜"编译"工具：把 eval 验证过的自然表达式翻译成 Blender 数学节点图。

设计目标：
  - AI 只提交自然表达式（如 sin(x) * 2 + y），脚本自动建节点。
  - 类型由输入值自动推断（或显式 types 覆盖），AI 不用管。
  - 变量 → 组输入插口；最终结果 → 组输出插口；常数 → 输入默认值。
  - 写 op 错误由 math_natural 在编译前拦截。

为什么不用 node_builder 批次：
  - set 输入 default_value 只匹配第一个同名 socket，Math 节点多个 Value 输入时设不了第二个；
  - 直接在 Blender 里生成脚本用 socket 对象引用，最可控，无需关心引用规则。
  因此直接生成独立 Blender 脚本（用 socket 对象引用，完全可控），并当场交给同目录的
  blender_channel.py 执行（Blender 装在哪由 blender_channel 自己从 envcard 取，本文件不管地址）。
  主组里的 GeometryNodeGroup 节点名由调用方通过 payload["node_name"] 指定（必填），脚本建完后
  回读实际名（重名时 Blender 会加 .001）并 print('NODE_NAME', ...)，本文件抓取后放进返回值
  node_name_actual，调用方直接用它连线即可。
  node_name 的合法性由 _check_node_name 校验，报错信息直接说清「哪不对 + 怎么改」。

支持：
  - 41 个标量运算全覆盖
  - 29 个矢量运算全覆盖
  - 自动优化 a * b + c → MULTIPLY_ADD

用法（通过 JSON 载荷）：
  {
    "type": "math" | "vector_math",
    "expr": "sin(x) * 2 + y",                     # 自然表达式
    "group": "AI_Break",                         # 必填，主组名（封装组放进去的那个组）
    "node_name": "delta",                        # 必填，主组里那个 Group 节点的 name
    "inputs": [{"x":0,"y":1}],                    # 可选，用于类型推断
    "types": {"x":"Float","y":"Float"},           # 可选，显式类型（优先级高，能免掉抄 inputs）

    "out_dir": "C:/.../PI_work",                 # 可选，产物写哪儿。不给=用工作区(envcard.WORKSPACE)；
                                                 #       两处都没有就报错，绝不写进 skill 源码目录
    "run": true,                                 # 可选，默认 true=生成脚本后立刻去 Blender 建节点；
                                                 #       false=只生成脚本，不碰 Blender
    "read": "C:/.../X.blend",                    # 可选，启动时打开哪个 .blend；"new"=空场景。
                                                 #       不给则自动找工作档（见下）
    "save": "C:/.../X.blend",                    # 可选，跑完存到哪；false/"no"=不存。
                                                 #       不给则：找到工作档就写回它，否则不存
    "workdir": "C:/.../PI_work",                 # 可选，去哪找 workflow_state.json（默认工作区，不看当前目录）
    "timeout": 120,                              # 可选，Blender 超时秒数，默认 120
    "script_args": ["--x", "1"]                  # 可选，透传给构建脚本的参数
  }

工作档是怎么定的（只在 read/save 没给全时才去找）：
  依次在 <workdir>/、envcard 的 WORKSPACE 里找 workflow_state.json（不看当前目录），
  读它的 "blend" 字段当工作档。找到 → read 和 save 都用它（节点真的存盘）；
  找不到 → read="new"、不存盘，并在返回值的 note 里明说「未存盘」，避免把假成功当真。

产物（构建脚本 + 结构 JSON）落在哪：
  payload["out_dir"] → envcard 的 WORKSPACE（工作区）。两处都没有就直接报错，并说清怎么配；
  故意**不**兜到脚本所在目录 —— 产物不能弄脏 skill 源码树。实际落点见返回值的 out_dir_used。

运行：
  python math_compile.py <payload.json>   # 输出结果 JSON（含建节点结果）+ 生成构建脚本
  python math_compile.py --demo           # 内置演示（真跑一遍全链路；空场景+不存盘，不碰任何档）
"""

import sys
import os
import re
import json

WS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WS)
from math_registry import SCALAR, VECTOR
from math_spec import infer_type, check_types
from math_natural import parse_natural


# ---------------------------------------------------------------- 生成 Blender 脚本
SOCK_FLOAT = "NodeSocketFloat"
SOCK_VECTOR = "NodeSocketVector"
# 子组输出接口名：主组里那个 Group 节点的输出口就叫这个（AI 连线直接写 <node_name>.out）
OUT_VAR = "out"


def _socket_type(ty):
    return SOCK_VECTOR if ty == VECTOR else SOCK_FLOAT


def _check_node_name(raw):
    """校验主组里那个数学节点的 name。返回 (name, error)，error=None 表示通过。
    报错必须说清「哪不对 + 为什么 + 怎么改」，AI 才能立刻改对重试。"""
    name = str(raw or "").strip()
    if not name:
        return "", ("缺少 node_name（主组里那个数学节点的名字）。"
                    "自己起个短代号，如 delta / rot_axis / size_ratio。")
    nbytes = len(name.encode("utf-8"))
    if nbytes > 63:
        return name, (f"node_name 太长：{nbytes} 字节，Blender 上限 63 字节"
                      f"（中文 1 字 = 3 字节），超了会被静默截断。"
                      f"当前 {name!r}，建议压到 20 个字符以内。")
    bad = "".join(c for c in name if c in ",，")
    if bad:
        return name, (f"node_name 不能含逗号（发现 {bad!r}）：blender_build 的 wires "
                      f"用逗号分隔多条连线，会把一个名字劈成两条。改成下划线，如 delta_bbox。")
    for tok in ("→", "->"):
        if tok in name:
            return name, (f"node_name 不能含 {tok!r}：那是 blender_build 连线语法里"
                          f"「左边 → 右边」的分隔符，会被当成两个节点。换成 _to_ 之类。")
    if any(ch in name for ch in "\r\n\t"):
        return name, "node_name 不能含换行/制表符（它会被写进单行连线字符串）。"
    return name, None


def _gen_script(graph, main_group, sub_group, node_name):
    """把节点图序列化成可直接在 Blender 里执行的 Python 脚本字符串。

    脚本做两件事：
      1. 建/复用一个"封装组"(sub_group)，公式节点摆在里面，带输入/输出接口。
      2. 在"主组"(main_group)里 add 一个 GeometryNodeGroup 节点，node_tree=封装组，
         让封装组作为一个子节点出现在主组中，接口自动露出给 AI 后续用 build 连。
    主组不存在就自动新建；封装组不存在就新建、存在就复用(组名自动取，不会撞旧内容)。
    """
    order = graph["input_vars"]
    out_socket_of = {n["uid"]: n["out_socket"] for n in graph["nodes"]}

    def ref_script(ref):
        if ref["kind"] == "input":
            return "gi.outputs[%d]" % order.index(ref["payload"])
        if ref["kind"] == "node":
            return "%s.outputs[%d]" % (ref["payload"], out_socket_of[ref["payload"]])
        raise ValueError("常数不应出现在连线里，应放 consts")

    L = []
    L.append("import bpy")
    # ---- 1. 封装组：存在复用，不存在新建（组名由脚本定，不删旧内容）----
    L.append("sub_group = bpy.data.node_groups.get(%r)" % sub_group)
    L.append("if sub_group is None:")
    L.append("    sub_group = bpy.data.node_groups.new(%r, type='GeometryNodeTree')" % sub_group)
    L.append("    sub_group.use_fake_user = True")
    L.append("")
    L.append("tree = sub_group")
    L.append("# 组输入/组输出节点")
    L.append("gi = tree.nodes.new('NodeGroupInput')")
    L.append("go = tree.nodes.new('NodeGroupOutput')")
    L.append("gi.location = (-300, 0)")
    L.append("go.location = (%d, 0)" % (len(graph["nodes"]) * 200 + 100))
    L.append("")
    L.append("# 变量 -> 组输入插口")
    for var in order:
        ty = graph["types"].get(var, SCALAR)
        L.append("tree.interface.new_socket(name=%r, in_out='INPUT', socket_type=%r)"
                 % (var, _socket_type(ty)))
    out_ty = graph["output"]["type"]
    L.append("tree.interface.new_socket(name=%r, in_out='OUTPUT', socket_type=%r)"
             % (OUT_VAR, _socket_type(out_ty)))
    L.append("")
    L.append("# 数学节点")
    for i, node in enumerate(graph["nodes"]):
        L.append("%s = tree.nodes.new(%r)" % (node["uid"], node["node_type"]))
        L.append("%s.operation = %r" % (node["uid"], node["op"]))
        L.append("%s.location = (%d, 0)" % (node["uid"], (i + 1) * 200))
    L.append("")
    L.append("# 常数 -> 输入默认值")
    for node in graph["nodes"]:
        for sock_idx, val in node["consts"].items():
            if isinstance(val, (list, tuple)):
                dv = "[%f, %f, %f]" % tuple(float(v) for v in val)
            else:
                dv = repr(float(val))
            L.append("%s.inputs[%d].default_value = %s" % (node["uid"], sock_idx, dv))
    L.append("")
    L.append("# 变量/节点连线")
    for node in graph["nodes"]:
        for sock_idx, ref in node["inputs"]:
            L.append("tree.links.new(%s, %s.inputs[%d])" % (ref_script(ref), node["uid"], sock_idx))
    L.append("")
    L.append("# 结果 -> 组输出")
    L.append("tree.links.new(%s, go.inputs[0])" % ref_script(graph["output"]))
    L.append("")
    # ---- 2. 主组：存在复用不存在新建，add 一个 Group 节点绑定封装组 ----
    L.append("main_group = bpy.data.node_groups.get(%r)" % main_group)
    L.append("if main_group is None:")
    L.append("    main_group = bpy.data.node_groups.new(%r, type='GeometryNodeTree')" % main_group)
    L.append("    main_group.use_fake_user = True")
    L.append("")
    L.append("# 在主组 add 一个引用封装组的 Group 节点")
    L.append("gn = main_group.nodes.new('GeometryNodeGroup')")
    L.append("gn.node_tree = sub_group")
    L.append("gn.location = (0, 0)")
    L.append("try:")
    L.append("    gn.name = %r" % node_name)
    L.append("    gn.label = %r" % node_name)
    L.append("except Exception as _e:")
    L.append("    print('NODE_NAME_ERR', repr(str(_e)))")
    L.append("")
    L.append("# 输出构建摘要")
    L.append("print('MATH_BUILT', %r, %d, %r)  # type=ignore"
             % (main_group, len(graph["nodes"]), graph["output"]["type"]))
    L.append("print('SUB_GROUP', %r)" % sub_group)
    L.append("print('MATH_IN', %r)" % order)
    L.append("print('NODE_NAME', repr(gn.name))")
    return "\n".join(L)


# ---------------------------------------------------------------- 递交 Blender
_STATE_NAME = "workflow_state.json"


def _coerce_bool(value, default):
    """把 payload 里的开关收敛成 bool。认 bool / 数字 / "true|false|yes|no|on|off|1|0"。"""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in ("1", "true", "yes", "y", "on"):
        return True
    if text in ("0", "false", "no", "n", "off", ""):
        return False
    return default


def _resolve_out_dir(payload):
    """定下产物（构建脚本 + 结构 JSON）写哪儿。返回 (out_dir, error)。

    顺序：payload["out_dir"] → envcard.WORKSPACE（工作区）。
    **故意不兜到脚本所在目录** —— 产物绝不能落进 skill 源码目录，否则会把代码树弄脏。
    两者都没有就报错，让调用方去 py_environment.json 里配 workspace.root。
    """
    explicit = str(payload.get("out_dir") or "").strip()
    if explicit:
        out_dir = explicit
    else:
        try:
            from envcard import WORKSPACE
        except Exception as e:
            return "", (f"没给 out_dir，也拿不到工作区：读 envcard 失败（{type(e).__name__}: {e}）。"
                        f"请在 py_environment.json 里配好 workspace.root，"
                        f"或者在 payload 里显式传 out_dir。")
        if not str(WORKSPACE or "").strip():
            return "", ("没给 out_dir，py_environment.json 里的 workspace.root 也是空的。"
                        "请给它配一个工作区目录（.blend、生成脚本都落那儿），"
                        "或者在 payload 里显式传 out_dir。")
        out_dir = str(WORKSPACE).strip()

    try:
        os.makedirs(out_dir, exist_ok=True)
    except Exception as e:
        return "", f"工作区目录建不出来：{out_dir}（{type(e).__name__}: {e}）"
    return out_dir, None


def _find_state_file(payload):
    """找 workflow_state.json 的路径；找不到返回 None。

    顺序：payload["workdir"] → envcard.WORKSPACE。不看当前目录。
    全程不写死路径，所以换机器/换工程都不用改这里。
    """
    dirs = []
    workdir = str(payload.get("workdir") or "").strip()
    if workdir:
        dirs.append(workdir)
    try:
        from envcard import WORKSPACE
        if WORKSPACE:
            dirs.append(str(WORKSPACE))
    except Exception:
        pass   # 卡片没生成也不影响「显式给 read/save」的用法
    for d in dirs:
        cand = os.path.join(d, _STATE_NAME)
        if os.path.isfile(cand):
            return cand
    return None


def _read_work_blend(state_path):
    """从 workflow_state.json 读 "blend" 字段。返回 (工作档路径, 失败原因)。"""
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return None, f"读不了 {state_path}（{type(e).__name__}: {e}）"
    blend = data.get("blend")
    if isinstance(blend, str) and blend.strip():
        return blend.strip(), None
    return None, f"{state_path} 里没有有效的 blend 字段"


def _resolve_workfile(payload):
    """定下 read（读哪个档）和 save（存到哪）。

    返回 (read, save, source, note)：
      source  这两个值从哪来（"payload" / "工作档:<路径>" / "兜底"），方便排查
      note    一句人话，讲清「会不会存盘」—— 避免把没存盘的假成功当成真成功
    """
    has_read = payload.get("read") not in (None, "")
    has_save = payload.get("save") is not None

    blend = None
    state_why = ""
    if not (has_read and has_save):
        state_path = _find_state_file(payload)
        if state_path:
            blend, state_why = _read_work_blend(state_path)
        else:
            state_why = f"没找到 {_STATE_NAME}"

    read = payload.get("read") if has_read else (blend or "new")
    save = payload.get("save") if has_save else (blend if blend else False)

    if has_read and has_save:
        source = "payload"
    elif blend:
        source = f"工作档:{blend}"
    else:
        source = "兜底"

    saves = bool(save) and str(save).strip().lower() != "no"
    if saves:
        note = f"跑完会存到 {save}"
    elif str(read).strip().lower() == "new":
        note = ("未存盘：节点只在这次 Blender 会话里建好，关掉就没了。想留住请传 "
                "save=<工作档路径>，或先把工程建档（写好 workflow_state.json）。"
                + (f"（找档详情：{state_why}）" if state_why else ""))
    else:
        note = f"读的是 {read}，但 save=no，所以这次的改动不会写回档里。"
    return read, save, source, note


def _submit_to_blender(script_path, read, save, timeout, script_args):
    """把生成好的脚本交给 blender_channel 去跑，返回它那套结果 dict。

    本文件**不碰任何地址**：Blender 装在哪，由 blender_channel 自己从 envcard 取。
    这里只负责「找到同目录的通道 + 把参数递进去」。
    """
    try:
        import blender_channel
    except Exception as e:
        return {
            "ok": False,
            "error": (f"找不到 blender_channel.py（它应该和 math_compile.py 同目录，即 {WS}）："
                      f"{type(e).__name__}: {e}"),
            "stdout": "", "stderr": "", "saved": None,
            "exit_code": None, "duration_ms": None, "traceback": None,
        }
    # blender_channel.run 保证任何情况下都不抛异常，出错也返回 ok=False 的 dict
    return blender_channel.run(script=os.path.abspath(script_path),
                               blend=read, save=save,
                               timeout=timeout, script_args=script_args)


def _grab_node_name(stdout, fallback):
    """从构建脚本的输出里抓回读到的真实节点名，以及「设名报错」（如果有）。

    脚本会 print 两行：出问题先 print NODE_NAME_ERR，最后 print NODE_NAME。
    重名时 Blender 会自动加 .001，所以实际名以 NODE_NAME 回读到的为准。
    """
    text = stdout or ""
    m = re.search(r"NODE_NAME\s+'([^']*)'", text)
    actual = m.group(1) if (m and m.group(1)) else fallback
    m_err = re.search(r"NODE_NAME_ERR\s+'([^']*)'", text)
    return actual, (m_err.group(1) if m_err else None)


# ---------------------------------------------------------------- 主流程
def _resolve_types(payload):
    """确定每个变量的类型。优先级：显式 types > 输入值推断；缺失则报错。"""
    mode = str(payload.get("type", "math"))
    if mode not in ("math", "vector_math"):
        raise ValueError(f"未知 type: {mode!r}。应为 'math' 或 'vector_math'。")
    types = dict(payload.get("types") or {})

    inputs = payload.get("inputs")
    if inputs:
        _, errors = check_types(inputs)
        if errors:
            raise ValueError("输入类型检查失败：\n- " + "\n- ".join(errors))
        for row in inputs:
            for name, value in row.items():
                if name not in types:
                    types[name] = infer_type(value)
    return types, mode


def run_compile(payload):
    """执行一次编译。返回可直接 JSON 序列化的结果 dict。"""
    try:
        types, mode = _resolve_types(payload)
        expr = payload.get("expr")
        if not isinstance(expr, str) or not expr.strip():
            raise ValueError("缺少 expr（数学表达式）。")

        graph = parse_natural(expr, mode, types)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    # main_group 来自 build 的 group 参数（AI 指定的主组，要往里面放封装组节点）。
    # sub_group 是封装组，自动命名，避免跟主组混。
    main_group = str(payload.get("group") or "").strip()
    if not main_group:
        return {"ok": False,
                "error": "缺少 group（主组名）。build 时必须指定把封装节点组放进哪个主组。"}
    # node_name = 主组里那个 Group 节点的 name，必填，由 AI 起短代号
    node_name, name_err = _check_node_name(payload.get("node_name"))
    if name_err:
        return {"ok": False, "error": name_err}
    sub_group = f"{main_group}_math_{abs(hash(expr)) % 100000}"
    script = _gen_script(graph, main_group, sub_group, node_name)

    # 产物落盘到 out_dir：显式指定 > 工作区(envcard.WORKSPACE)。
    # 绝不落进 skill 源码目录；两处都没有就直接报错（并说清怎么配）。
    out_dir, out_err = _resolve_out_dir(payload)
    if out_err:
        return {"ok": False, "error": out_err}
    out_dir_source = ("payload" if str(payload.get("out_dir") or "").strip()
                      else "工作区(envcard.WORKSPACE)")
    script_path = os.path.join(out_dir, f"math_build_{main_group}.py")
    struct_path = os.path.join(out_dir, f"math_struct_{main_group}.json")
    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script)
        with open(struct_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return {"ok": False, "error": f"写盘失败: {e}"}

    result = {
        "ok": True,
        "compiled": True,
        "tree": sub_group,          # 封装组
        "group": main_group,        # 主组
        "mode": mode,
        "node_name": node_name,     # 请求的 name（可能被 Blender 改名，看 node_name_actual）
        "output_var": OUT_VAR,      # 子组输出接口名（= 主组 Group 节点的输出口名）
        "source": expr,
        "types": types,
        "input_vars": graph["input_vars"],
        "output_type": graph["output"]["type"],
        "node_count": len(graph["nodes"]),
        "nodes": [
            {"uid": n["uid"], "op": n["op"], "inputs": [r["payload"] for _, r in n["inputs"]]}
            for n in graph["nodes"]
        ],
        "script": script_path,
        "struct": struct_path,
        "out_dir_used": out_dir,        # 产物实际落在哪（一眼可见，不用猜）
        "out_dir_source": out_dir_source,
    }

    # ---- 递交：把脚本真的送进 Blender，把节点组建出来 ----
    if not _coerce_bool(payload.get("run"), True):
        result.update({
            "ran": False, "built": False,
            "node_name_actual": node_name,
            "note": ("run=false：只生成了脚本，没去 Blender 建节点。"
                     "要建就把 run 设为 true，或者手动跑 "
                     f"blender_channel（脚本：{os.path.basename(script_path)}）。"),
        })
        return result

    read, save, source, note = _resolve_workfile(payload)
    br = _submit_to_blender(script_path, read, save,
                            payload.get("timeout", 120),
                            payload.get("script_args") or [])

    stdout = br.get("stdout") or ""
    actual, name_err = _grab_node_name(stdout, node_name)
    built = bool(br.get("ok"))

    result.update({
        "ok": built,
        "ran": True,
        "built": built,
        "read": read,
        "save": save,
        "workfile_source": source,
        "saved_to_disk": bool(br.get("saved")),
        "node_name_actual": actual,
        "note": note,
        "blender": {
            "ok": built,
            "exit_code": br.get("exit_code"),
            "saved": br.get("saved"),
            "duration_ms": br.get("duration_ms"),
            "error": br.get("error"),
            "stdout": stdout,
            "stderr": br.get("stderr") or "",
            "traceback": br.get("traceback"),
        },
    })

    warns = []
    if name_err:
        warns.append(f"设置节点名时报错：{name_err}（已保留 Blender 自动名）")
    if actual != node_name:
        warns.append(f"主组里已有同名节点，Blender 把实际 name 改成了 {actual!r}，连线请用这个名字。")
    if warns:
        result["node_name_warn"] = "；".join(warns)

    if not built:
        result["error"] = (br.get("error")
                           or f"建节点失败（exit={br.get('exit_code')}）："
                              f"{br.get('stderr') or stdout or '(无输出)'}")
    return result


# ---------------------------------------------------------------- 入口
def _demo():
    """内置演示：真跑一遍全链路（生成 → 递交 Blender 建节点）。

    显式 read="new" + save=False：开一个用完就扔的空场景，**不碰任何 .blend**。
    否则它会顺着工作区里的 workflow_state.json 写回真实工作档 —— 演示不该改用户数据。
    """
    demo = {
        "type": "math",
        "expr": "sin(x) * 2 + y",  # 自然表达式
        "inputs": [{"x": 0.5, "y": 1.0}],
        "group": "AI_Demo",        # 必填：主组名
        "node_name": "demo_math",  # 必填：主组里那个 Group 节点的 name
        "read": "new",             # 空场景：不读任何档
        "save": False,             # 不存盘：不改任何档
    }
    print(json.dumps(run_compile(demo), ensure_ascii=False, indent=2))


def main(argv):
    if len(argv) >= 2 and argv[1] == "--demo":
        _demo()
        return 0
    if len(argv) < 2:
        print("用法: python math_compile.py <payload.json>   或   python math_compile.py --demo",
              file=sys.stderr)
        return 2
    with open(argv[1], "r", encoding="utf-8") as f:
        payload = json.load(f)
    result = run_compile(payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
