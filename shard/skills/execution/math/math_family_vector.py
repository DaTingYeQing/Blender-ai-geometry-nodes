# -*- coding: utf-8 -*-
"""
math_family_vector.py — 矢量族（ShaderNodeVectorMath）29 个 OpSpec。

★ 新增/修改一个矢量运算，只需要动这个文件里的一行。
  参数签名里出现 Float 的位置，socket 布局自动落到 socket 3（Scale/折射率）。

数值实现照抄 gpu_shader_material_vector_math.glsl（经 math_semantics 的 helper）。
自然函数名严格照旧 math_natural.VECTOR_FUNC：矢量**有** power 与 mod 具名函数。
"""

import math

from math_spec import (OpSpec, Param, ValueType, Family, register_family,
                       vector_socket_rule)
from math_semantics import (safe_divide, compatible_mod, compatible_pow, _wrap, _sign,
                            _dot, _cross, _length, _normalize, _safe_normalize,
                            _reflect, _refract, _faceforward, _vec_project)


def _V(name="A"):
    return Param(name, ValueType.VECTOR, None)


def _F(name="Scale", default=1.0):
    return Param(name, ValueType.SCALAR, default)


# =====================================================================
# 算子定义（id, ui 名, 参数, 输出, 实现, 别名, 运算符, 文档）
# 实现形态: (a, b, c, scale) -> (outVector, outValue)
# =====================================================================
VECTOR_SPECS = [
    # ---- 逐分量四则 ----
    OpSpec("ADD", "Add", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([a[x] + b[x] for x in range(3)], 0.0),
           (), "+", "A + B"),
    OpSpec("SUBTRACT", "Subtract", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([a[x] - b[x] for x in range(3)], 0.0),
           (), "-", "A - B"),
    OpSpec("MULTIPLY", "Multiply", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([a[x] * b[x] for x in range(3)], 0.0),
           (), "*", "Entry-wise multiply"),
    OpSpec("DIVIDE", "Divide", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([safe_divide(a[x], b[x]) for x in range(3)], 0.0),
           (), "/", "Entry-wise divide"),
    OpSpec("MULTIPLY_ADD", "Multiply Add", "vector_math",
           (_V("A"), _V("B"), _V("C")), ValueType.VECTOR,
           lambda a, b, c, s: ([a[x] * b[x] + c[x] for x in range(3)], 0.0),
           ("multiply_add",), None, "A * B + C"),

    # ---- 几何 ----
    OpSpec("CROSS_PRODUCT", "Cross Product", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: (_cross(a, b), 0.0),
           ("cross",), None, "A cross B"),
    OpSpec("PROJECT", "Project", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           _vec_project, ("project",), None, "Project A onto B"),
    OpSpec("REFLECT", "Reflect", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: (_reflect(a, _safe_normalize(b)), 0.0),
           ("reflect",), None, "Reflect A around B"),
    OpSpec("REFRACT", "Refract", "vector_math",
           (_V("A"), _V("B"), _F("Ratio", 1.0)), ValueType.VECTOR,
           lambda a, b, c, s: (_refract(a, _safe_normalize(b), s), 0.0),
           ("refract",), None, "Refract A by B with ratio C"),
    OpSpec("FACEFORWARD", "Face Forward", "vector_math",
           (_V("A"), _V("B"), _V("C")), ValueType.VECTOR,
           lambda a, b, c, s: (_faceforward(a, b, c), 0.0),
           ("faceforward",), None, "Orients A facing away from C"),

    # ---- 输出标量的三个 ----
    OpSpec("DOT_PRODUCT", "Dot Product", "vector_math",
           (_V("A"), _V("B")), ValueType.SCALAR,
           lambda a, b, c, s: (0.0, _dot(a, b)),
           ("dot",), None, "A dot B (returns scalar)"),
    OpSpec("DISTANCE", "Distance", "vector_math",
           (_V("A"), _V("B")), ValueType.SCALAR,
           lambda a, b, c, s: (0.0, _length([a[x] - b[x] for x in range(3)])),
           ("distance",), None, "Distance between A and B (returns scalar)"),
    OpSpec("LENGTH", "Length", "vector_math",
           (_V("A"),), ValueType.SCALAR,
           lambda a, b, c, s: (0.0, _length(a)),
           ("length",), None, "Length of A (returns scalar)"),

    # ---- 缩放 / 归一化 ----
    OpSpec("SCALE", "Scale", "vector_math",
           (_V("A"), _F("Scale", 1.0)), ValueType.VECTOR,
           lambda a, b, c, s: ([v * s for v in a], 0.0),
           ("scale",), None, "A * scale (returns vector)"),
    OpSpec("NORMALIZE", "Normalize", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: (_normalize(a), 0.0),
           ("normalize",), None, "Unit vector of A"),

    # ---- 取整 / 环绕 / 吸附 ----
    OpSpec("SNAP", "Snap", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([math.floor(safe_divide(a[x], b[x])) * b[x] for x in range(3)], 0.0),
           ("snap",), None, "Snap to increment of B"),
    OpSpec("FLOOR", "Floor", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([math.floor(v) for v in a], 0.0),
           ("floor",), None, "Floor each component"),
    OpSpec("CEIL", "Ceil", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([math.ceil(v) for v in a], 0.0),
           ("ceil",), None, "Ceil each component"),
    OpSpec("MODULO", "Modulo", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([compatible_mod(a[x], b[x]) for x in range(3)], 0.0),
           ("mod",), "%", "Entry-wise modulo"),
    OpSpec("WRAP", "Wrap", "vector_math",
           (_V("A"), _V("B"), _V("C")), ValueType.VECTOR,
           lambda a, b, c, s: ([_wrap(a[x], b[x], c[x]) for x in range(3)], 0.0),
           ("wrap",), None, "Wrap each component to [B, C]"),
    OpSpec("FRACTION", "Fraction", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([v - math.floor(v) for v in a], 0.0),
           ("fract",), None, "Fraction part of each component"),

    # ---- 逐分量一元 / 极值 / 逐分量幂 ----
    OpSpec("ABSOLUTE", "Absolute", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([abs(v) for v in a], 0.0),
           ("abs",), None, "Absolute of each component"),
    OpSpec("POWER", "Power", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([compatible_pow(a[x], b[x]) for x in range(3)], 0.0),
           ("power",), "**", "Entry-wise power"),
    OpSpec("SIGN", "Sign", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([_sign(v) for v in a], 0.0),
           ("sign",), None, "Sign of each component"),
    OpSpec("MINIMUM", "Minimum", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([min(a[x], b[x]) for x in range(3)], 0.0),
           ("min",), None, "Entry-wise minimum"),
    OpSpec("MAXIMUM", "Maximum", "vector_math",
           (_V("A"), _V("B")), ValueType.VECTOR,
           lambda a, b, c, s: ([max(a[x], b[x]) for x in range(3)], 0.0),
           ("max",), None, "Entry-wise maximum"),

    # ---- 逐分量三角 ----
    OpSpec("SINE", "Sine", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([math.sin(v) for v in a], 0.0),
           ("sin",), None, "sin of each component"),
    OpSpec("COSINE", "Cosine", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([math.cos(v) for v in a], 0.0),
           ("cos",), None, "cos of each component"),
    OpSpec("TANGENT", "Tangent", "vector_math",
           (_V("A"),), ValueType.VECTOR,
           lambda a, b, c, s: ([math.tan(v) for v in a], 0.0),
           ("tan",), None, "tan of each component"),
]


VECTOR_FAMILY = register_family(Family(
    name="vector_math",
    node_idname="ShaderNodeVectorMath",
    default_input_type=ValueType.VECTOR,
    ops=VECTOR_SPECS,
    socket_rule=vector_socket_rule,
))
