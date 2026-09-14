# -*- coding: utf-8 -*-
"""
math_family_scalar.py — 标量族（ShaderNodeMath）41 个 OpSpec。

★ 新增/修改一个标量运算，只需要动这个文件里的一行：
    OpSpec(id="xxx", ui_name="Xxx", family="math", params=..., out_type=..., impl=..., ...)
  其余一切（arity、socket 布局、参数校验、编译、eval 语义、帮助文案、跨族提示）
  都由 math_ops / math_registry / frontend 从注册表派生。

数值实现照抄 Blender gpu_shader_common_math.glsl（经 math_semantics 的 helper）。
自然函数名严格照旧 math_natural.SCALAR_FUNC：标量**没有** power / mod 具名函数，
只有 ** 与 % 运算符。
"""

import math

from math_spec import (OpSpec, Param, ValueType, Family, register_family,
                       scalar_socket_rule)
from math_semantics import (safe_divide, compatible_mod, _math_power,
                            _mod, _smooth_min, _smooth_max, _wrap, _sign)


def _A(name="A", default=0.0):
    return Param(name, ValueType.SCALAR, default)


# =====================================================================
# 算子定义（id, ui 名, 参数, 输出, 实现, 别名, 运算符, 文档）
# =====================================================================
SCALAR_SPECS = [
    # ---- 基础四则 + 乘加 ----
    OpSpec("ADD", "Add", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: a + b, (), "+", "A + B"),
    OpSpec("SUBTRACT", "Subtract", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: a - b, (), "-", "A - B"),
    OpSpec("MULTIPLY", "Multiply", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: a * b, (), "*", "A * B"),
    OpSpec("DIVIDE", "Divide", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: safe_divide(a, b), (), "/", "A / B"),
    OpSpec("MULTIPLY_ADD", "Multiply Add", "math",
           (_A("A"), _A("B"), _A("C")), ValueType.SCALAR,
           lambda a, b, c: a * b + c, ("multiply_add",), None, "A * B + C"),

    # ---- 幂 / 对数 / 根 ----
    OpSpec("POWER", "Power", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           _math_power, (), "**", "A power B"),
    # b==1 时 log2(b)=0 会除零；实测 Blender 对 base<=0 / base==1 / value<=0 都返回 0.0，
    # 故这些非法输入一律归 0（旧版只判 b>0，漏了 b==1）。守卫为 b>0.0 and b != 1.0。
    OpSpec("LOGARITHM", "Logarithm", "math",
           (_A("A"), _A("Base", 0.5)), ValueType.SCALAR,
           lambda a, b, c: (math.log2(a) / math.log2(b)) if (a > 0.0 and b > 0.0 and b != 1.0) else 0.0,
           ("log",), None, "Logarithm A base B"),
    OpSpec("SQRT", "Square Root", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.sqrt(a) if a > 0.0 else 0.0,
           ("sqrt",), None, "Square root of A"),
    OpSpec("INVERSE_SQRT", "Inverse Square Root", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: 1.0 / math.sqrt(a) if a > 0.0 else (float("inf") if a == 0.0 else float("nan")),
           ("inversesqrt",), None, "1 / Square root of A"),

    # ---- 绝对值 / 指数 / 比较 ----
    OpSpec("ABSOLUTE", "Absolute", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: abs(a), ("abs",), None, "Magnitude of A"),
    OpSpec("EXPONENT", "Exponent", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.exp(a), ("exp",), None, "exp(A)"),
    OpSpec("MINIMUM", "Minimum", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: min(a, b), ("min",), None, "The minimum from A and B"),
    OpSpec("MAXIMUM", "Maximum", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: max(a, b), ("max",), None, "The maximum from A and B"),
    OpSpec("LESS_THAN", "Less Than", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: 1.0 if a < b else 0.0, (), None, "1 if A < B else 0"),
    OpSpec("GREATER_THAN", "Greater Than", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: 1.0 if a > b else 0.0, (), None, "1 if A > B else 0"),
    OpSpec("SIGN", "Sign", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: _sign(a), ("sign",), None, "Returns the sign of A"),
    OpSpec("COMPARE", "Compare", "math",
           (_A("A"), _A("B"), _A("C")), ValueType.SCALAR,
           lambda a, b, c: 1.0 if abs(a - b) <= max(c, 1e-5) else 0.0,
           ("compare",), None, "1 if (A == B) within tolerance C else 0"),
    OpSpec("SMOOTH_MIN", "Smooth Minimum", "math",
           (_A("A"), _A("B"), _A("C")), ValueType.SCALAR,
           _smooth_min, ("smoothmin",), None, "The minimum from A and B with smoothing C"),
    OpSpec("SMOOTH_MAX", "Smooth Maximum", "math",
           (_A("A"), _A("B"), _A("C")), ValueType.SCALAR,
           _smooth_max, ("smoothmax",), None, "The maximum from A and B with smoothing C"),

    # ---- 取整 / 取小数 ----
    OpSpec("ROUND", "Round", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.floor(a + 0.5),
           ("round",), None, "Round A to nearest integer; round up if fractional part is 0.5"),
    OpSpec("FLOOR", "Floor", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.floor(a), ("floor",), None, "Largest integer <= A"),
    OpSpec("CEIL", "Ceil", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.ceil(a), ("ceil",), None, "Smallest integer >= A"),
    OpSpec("TRUNC", "Truncate", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.trunc(a),
           ("trunc",), None, "Integer part of A, removing fractional digits"),
    OpSpec("FRACT", "Fraction", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: a - math.floor(a), ("fract",), None, "The fraction part of A"),

    # ---- 取模 / 环绕 / 吸附 ----
    OpSpec("MODULO", "Truncated Modulo", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: compatible_mod(a, b), (), "%", "Remainder of truncated division fmod(A,B)"),
    OpSpec("FLOORED_MODULO", "Floored Modulo", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: (a - math.floor(a / b) * b) if b != 0.0 else 0.0,
           ("floored_mod",), None, "Remainder of floored division"),
    OpSpec("WRAP", "Wrap", "math",
           (_A("A"), _A("B"), _A("C")), ValueType.SCALAR,
           lambda a, b, c: _wrap(a, b, c), ("wrap",), None, "Wrap value to range [B, C]"),
    OpSpec("SNAP", "Snap", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: math.floor(safe_divide(a, b)) * b, ("snap",), None, "Snap to increment of B"),
    OpSpec("PINGPONG", "Ping-Pong", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: (abs(_mod((a - b) / (b * 2.0), 1.0) * b * 2.0 - b)) if b != 0.0 else 0.0,
           ("pingpong",), None, "Wrap and reverse every other cycle"),

    # ---- 三角 / 双曲 ----
    OpSpec("SINE", "Sine", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.sin(a), ("sin",), None, "sin(A)"),
    OpSpec("COSINE", "Cosine", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.cos(a), ("cos",), None, "cos(A)"),
    OpSpec("TANGENT", "Tangent", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.tan(a), ("tan",), None, "tan(A)"),
    OpSpec("ARCSINE", "Arcsine", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.asin(a) if -1.0 <= a <= 1.0 else 0.0,
           ("asin",), None, "arcsin(A)"),
    OpSpec("ARCCOSINE", "Arccosine", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.acos(a) if -1.0 <= a <= 1.0 else 0.0,
           ("acos",), None, "arccos(A)"),
    OpSpec("ARCTANGENT", "Arctangent", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.atan(a), ("atan",), None, "arctan(A)"),
    OpSpec("ARCTAN2", "Arctan2", "math",
           (_A("A"), _A("B")), ValueType.SCALAR,
           lambda a, b, c: 0.0 if (a == 0.0 and b == 0.0) else math.atan2(a, b),
           ("atan2",), None, "The signed angle arctan(A / B)"),
    OpSpec("SINH", "Hyperbolic Sine", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.sinh(a), ("sinh",), None, "sinh(A)"),
    OpSpec("COSH", "Hyperbolic Cosine", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.cosh(a), ("cosh",), None, "cosh(A)"),
    OpSpec("TANH", "Hyperbolic Tangent", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: math.tanh(a), ("tanh",), None, "tanh(A)"),

    # ---- 角度换算 ----
    OpSpec("RADIANS", "To Radians", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: a * (math.pi / 180.0),
           ("radians",), None, "Convert from degrees to radians"),
    OpSpec("DEGREES", "To Degrees", "math",
           (_A("A"),), ValueType.SCALAR,
           lambda a, b, c: a * (180.0 / math.pi),
           ("degrees",), None, "Convert from radians to degrees"),
]


SCALAR_FAMILY = register_family(Family(
    name="math",
    node_idname="ShaderNodeMath",
    default_input_type=ValueType.SCALAR,
    ops=SCALAR_SPECS,
    socket_rule=scalar_socket_rule,
))
