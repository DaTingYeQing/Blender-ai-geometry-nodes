# -*- coding: utf-8 -*-
"""
math_eval.py — 傻瓜"算数"工具：AI 提交自然表达式 + 输入表，求值返回结果表。

试算与编译走**同一条**语义路径：
    自然表达式 ──parser──► Graph(IR) ──interpret──► 数值结果
每个 IRNode 指向一个 OpSpec，解释器直接调用 spec.impl（Blender 精确语义），
不再用 Python 的 eval()，因此试算值与 Blender 实际算出的值在结构上一致。

用法（通过 JSON 载荷）：
  {
    "type": "math" | "vector_math",
    "expr": "sin(x) * 2 + y",
    "inputs": [{"x": 0.0, "y": 1.0}, ...],
    "grid": {"x": [0, 1, 2], "y": [1, 2]}
  }

运行：
  python math_eval.py <payload.json>
  python math_eval.py --demo
"""

import sys
import os
import json
import math

WS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WS)

# infer_type / check_types 已上提到 core（math_spec），这里再导出以兼容旧引用
from math_spec import (SCALAR, VECTOR, infer_type, check_types,  # noqa: F401
                       get_family, apply_op, UnserializableResult)
from math_registry import socket_indices
from math_natural import build_graph


# ---------------------------------------------------------------- 出口守门
def to_jsonable(value):
    """把解释结果转成可安全 json.dumps 的形式。

    复数 / NaN / Inf 直接抛 UnserializableResult，让上层拿到「明确错误」而不是
    json.dumps 的 TypeError / 非法 JSON（Infinity/NaN）。
    """
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, complex):
        raise UnserializableResult(
            f"结果是复数 {value!r}：Blender 节点不会产生复数。"
            f"请检查表达式（例如负底数的非整数次幂）。")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise UnserializableResult(
            f"结果非有限值（{value}）：无法作为数值回传。"
            f"请检查除零 / 越界输入（如 wrap 的上下界相等、inversesqrt(0)）。")
    if isinstance(value, (int, float)):
        return value
    raise UnserializableResult(f"结果类型 {type(value).__name__} 无法序列化：{value!r}")


# ---------------------------------------------------------------- IR 解释器
class _Interpreter:
    """按节点顺序遍历 IR，用值存储调用 spec.impl。"""

    def __init__(self, graph):
        self.graph = graph
        self._ops = {name: get_family(name).ops for name in ("math", "vector_math")}

    def run(self, row):
        vals = dict(row)
        out = {}
        for node in self.graph.nodes:
            out[node.uid] = self._eval_node(node, vals, out)
        return self._resolve(self.graph.output, vals, out)

    def _resolve(self, ref, vals, out):
        if ref.kind == "input":
            return vals[ref.payload]
        if ref.kind == "node":
            return out[ref.payload]
        return ref.payload   # const

    def _eval_node(self, node, vals, out):
        spec = self._ops[node.family][node.op]
        sock_val = dict(node.consts)
        for sock, ref in node.inputs:
            sock_val[sock] = self._resolve(ref, vals, out)
        socks = socket_indices(node.family, node.op)
        operands = [sock_val[s] for s in socks]
        return apply_op(spec, operands)


# ---------------------------------------------------------------- 输入展开
def expand_grid(grid):
    """把扫参网格 {变量: [值,...]} 展开成逐行输入表（笛卡尔积）。"""
    if not grid:
        return []
    import itertools
    keys = list(grid.keys())
    value_lists = [grid[k] for k in keys]
    rows = []
    for combo in itertools.product(*value_lists):
        rows.append(dict(zip(keys, combo)))
    return rows


# ---------------------------------------------------------------- 主流程
def run_eval(payload):
    """执行一次求值。返回可直接 JSON 序列化的结果 dict。"""
    mode = str(payload.get("type", "math"))
    if mode not in ("math", "vector_math"):
        return {"ok": False, "error": f"未知 type: {mode!r}。应为 'math' 或 'vector_math'。"}

    inputs = payload.get("inputs")
    grid = payload.get("grid")
    if inputs is not None and grid is not None:
        return {"ok": False, "error": "inputs 和 grid 不能同时提供，请二选一。"}
    if inputs is None and grid is not None:
        inputs = expand_grid(grid)
    if not inputs:
        return {"ok": False, "error": "缺少输入值：请提供 inputs 或 grid。"}

    expr = payload.get("expr")
    if not isinstance(expr, str) or not expr.strip():
        return {"ok": False, "error": "缺少 expr（数学表达式）。"}

    types, type_errors = check_types(inputs)
    if type_errors:
        return {"ok": False, "error": "输入类型检查失败：\n- " + "\n- ".join(type_errors)}

    # parse → Graph(IR)（与 compile 同一条路径）
    try:
        graph = build_graph(expr, mode, types)
    except Exception as e:
        return {"ok": False, "error": "表达式校验失败：\n- " + str(e)}

    interp = _Interpreter(graph)
    results = []
    eval_errors = []
    for row in inputs:
        try:
            val = to_jsonable(interp.run(row))
            results.append({"input": row, "result": val})
        except Exception as e:
            eval_errors.append({"input": row, "error": f"{type(e).__name__}: {e}"})

    return {
        "ok": not eval_errors,
        "mode": mode,
        "output_type": graph.output.type,
        "types": types,
        "results": results,
        "errors": eval_errors,
    }


# ---------------------------------------------------------------- 入口
def _demo():
    demo = {
        "type": "math",
        "expr": "sin(x) * 2 + y",
        "inputs": [
            {"x": 0.0, "y": 1.0},
            {"x": 0.5, "y": 1.0},
            {"x": 1.570796, "y": 2.0},
        ],
    }
    print(json.dumps(run_eval(demo), ensure_ascii=False, indent=2))


def main(argv):
    if len(argv) >= 2 and argv[1] == "--demo":
        _demo()
        return 0
    if len(argv) < 2:
        print("用法: python math_eval.py <payload.json>   或   python math_eval.py --demo",
              file=sys.stderr)
        return 2
    with open(argv[1], "r", encoding="utf-8") as f:
        payload = json.load(f)
    result = run_eval(payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
