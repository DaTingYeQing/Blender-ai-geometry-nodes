# -*- coding: utf-8 -*-
"""
math_ops.py — Blender 4.5 Math / Vector Math 的 Python 1:1 数值接口（投影层）。

本文件不再存放独立数值实现：全部从 OpSpec 注册表**派生**。
唯一一份数值实现在 math_family_scalar / math_family_vector 的 OpSpec.impl，
底层 GLSL helper 在 math_semantics。

公共符号名与行为与旧版保持一致，外部（TS 层 / 其它脚本 / AI 提示词）可继续引用：
  SCALAR_OPS / VECTOR_OPS / BLENDER_MATH_ENUM / BLENDER_VEC_MATH_ENUM
  blender_math / blender_vec_math / blender_help
  + 旧 helper 名（safe_mod / compatible_mod / safe_divide / _wrap / compatible_pow ...）

用法：
  from math_ops import blender_math, blender_vec_math
  blender_math("SINE", x)
  blender_math("MULTIPLY_ADD", a, b, c)
  blender_vec_math("DOT_PRODUCT", va, vb) -> float
  blender_vec_math("SCALE", va, s)        -> [x,y,z]
"""

# ---- GLSL helper 一律从 math_semantics 转发（唯一事实来源）----
from math_semantics import (  # noqa: F401
    _mod, safe_mod, compatible_mod, safe_divide, safe_rcp, safe_sqrt, safe_acos,
    fallback_pow, compatible_pow, _wrap, _sign, _math_power, _smooth_min, _smooth_max,
    _vec, _dot, _cross, _length, _length_sq, _safe_normalize, _normalize, _reflect,
    _refract, _faceforward, _vec_project,
)
from math_spec import apply_scalar, apply_vector
from math_family_scalar import SCALAR_FAMILY
from math_family_vector import VECTOR_FAMILY


# ---------------------------------------------------------------- 派生投影
# op_id -> impl（保持旧签名：标量 (a,b,c)；矢量 (a,b,c,s) -> (outVec, outVal)）
SCALAR_OPS = {op_id: spec.impl for op_id, spec in SCALAR_FAMILY.ops.items()}
VECTOR_OPS = {op_id: spec.impl for op_id, spec in VECTOR_FAMILY.ops.items()}

# op_id -> (ui_name, n_inputs, desc)（保持旧元组形状）
BLENDER_MATH_ENUM = {
    op_id: (spec.ui_name, len(spec.params), spec.doc)
    for op_id, spec in SCALAR_FAMILY.ops.items()
}
BLENDER_VEC_MATH_ENUM = {
    op_id: (spec.ui_name, len(spec.params), spec.doc)
    for op_id, spec in VECTOR_FAMILY.ops.items()
}


def blender_help(node_type="math", op=None):
    """查询节点的 enum 权威信息。node_type: 'math' 或 'vec_math'。op 缺省时列出全部。"""
    reg = BLENDER_MATH_ENUM if node_type == "math" else BLENDER_VEC_MATH_ENUM
    if op is None:
        return {k: v for k, v in reg.items()}
    if op not in reg:
        raise KeyError(f"未知 op: {op!r}。node_type='{node_type}' 可用: {sorted(reg)}")
    name, n_in, desc = reg[op]
    return {"identifier": op, "type": node_type, "ui_name": name,
            "n_inputs": n_in, "desc": desc}


# ---------------------------------------------------------------- 入口
def blender_math(op, *args):
    """调用标量 Math 节点 op。op 为 enum 名（如 'SINE'、'MULTIPLY_ADD'）。"""
    spec = SCALAR_FAMILY.ops.get(op)
    if spec is None:
        raise KeyError(f"未知标量 op: {op!r}。可用: {sorted(SCALAR_OPS)}")
    return apply_scalar(spec, args)


def blender_vec_math(op, *args):
    """调用矢量 Vector Math 节点 op。输入向量为 3 元素 list/tuple。
    返回 outVector；仅 DOT_PRODUCT/DISTANCE/LENGTH 返回 outValue（标量）。"""
    spec = VECTOR_FAMILY.ops.get(op)
    if spec is None:
        raise KeyError(f"未知矢量 op: {op!r}。可用: {sorted(VECTOR_OPS)}")
    return apply_vector(spec, args)


if __name__ == "__main__":
    # 简易自检
    print("SINE(0) =", blender_math("SINE", 0.0))
    print("ROUND(4.5) =", blender_math("ROUND", 4.5))          # Blender: 5（floor(4.5+0.5)）
    print("DIVIDE(1, 0) =", blender_math("DIVIDE", 1.0, 0.0))  # safe: 0
    print("POWER(-4, 0.5) =", blender_math("POWER", -4.0, 0.5))  # 负底: 0
    print("MULTIPLY_ADD(2,3,4) =", blender_math("MULTIPLY_ADD", 2.0, 3.0, 4.0))
    print("LENGTH([3,4,0]) =", blender_vec_math("LENGTH", [3.0, 4.0, 0.0]))
    print("DOT([1,0,0],[0,1,0]) =", blender_vec_math("DOT_PRODUCT", [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]))
    print("SCALE([1,2,3], 2) =", blender_vec_math("SCALE", [1.0, 2.0, 3.0], 2.0))
