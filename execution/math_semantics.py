# -*- coding: utf-8 -*-
"""
math_semantics.py — Blender 4.5 Math / Vector Math 的 GLSL 精确数值 helper（唯一一份）。

严格照抄源码（不凭 Python 数学直觉）：
  标量:  source/blender/gpu/shaders/common/gpu_shader_common_math.glsl
  矢量:  source/blender/gpu/shaders/material/gpu_shader_material_vector_math.glsl
  helper: source/blender/gpu/shaders/common/gpu_shader_math_base_lib.glsl

本模块是全工程里**唯一**存有这些 helper 的地方；math_ops 只做转发，
两个家族文件与 IR 解释器都从这里引用，因此数值语义在结构上不可能漂移。
"""

import math

# =====================================================================
# 标量 GLSL helper（被多个 op 共用）
# =====================================================================
# GLSL mod(x,y) = x - y*floor(x/y)      # floored
# Python 里 math.fmod 是截断、% 是 floored；需按 GLSL 语义手动实现。


def _mod(a, b):
    """GLSL mod：floored 取模。"""
    return a - b * math.floor(a / b)


def safe_mod(a, b):
    """GLSL safe_mod：b==0 时返回 0。"""
    return _mod(a, b) if b != 0.0 else 0.0


def compatible_mod(a, b):
    """GLSL compatible_mod：向零截断取模，b==0 时返回 0。"""
    if b != 0.0:
        n = int(a / b)  # Python int() 向零截断
        return a - n * b
    return 0.0


def safe_divide(a, b):
    """GLSL safe_divide：b==0 时返回 0。"""
    return a / b if b != 0.0 else 0.0


def safe_rcp(a):
    """GLSL safe_rcp：a==0 时返回 0。"""
    return 1.0 / a if a != 0.0 else 0.0


def safe_sqrt(a):
    """GLSL safe_sqrt：a<=0 时返回 0。"""
    return math.sqrt(max(0.0, a))


def safe_acos(a):
    """GLSL safe_acos：越界钳制到 0/PI。"""
    if a <= -1.0:
        return math.pi
    if a >= 1.0:
        return 0.0
    return math.acos(a)


def fallback_pow(x, y, fallback):
    """GLSL fallback_pow：x<0 或 (x==0 且 y<=0) 时返回 fallback。"""
    if x < 0.0 or (x == 0.0 and y <= 0.0):
        return fallback
    return math.pow(x, y)


def compatible_pow(x, y):
    """GLSL compatible_pow：模拟 std::pow，支持负底/0^0。"""
    if y == 0.0:  # x^0 -> 1，包括 0^0
        return 1.0
    if x < 0.0:
        if _mod(-y, 2.0) == 0.0:
            return math.pow(-x, y)
        return -math.pow(-x, y)
    if x == 0.0:
        return 0.0
    return math.pow(x, y)


def _wrap(a, b, c):
    """GLSL wrap：把 a 归到 [b, c]。

    ⚠️ 已修缺陷：旧实现把 a!=b 分支的 floor((a-c)/range) 直接算，range==0 时抛
    ZeroDivisionError。GLSL 不会抛异常——range==0（即 b==c）时：
      - a==b 分支 s=1.0（与 GLSL 一致）；
      - a!=b 时 floor((a-c)/0) 得 ±inf，a - 0*inf 得 nan。
    这里按 GLSL 语义如实返回 nan，不再抛异常。
    """
    rng = b - c
    if a == b:
        s = 1.0
    elif rng == 0.0:
        s = float("inf") if (a - c) > 0 else float("-inf")
    else:
        s = math.floor((a - c) / rng)
    return a - rng * s


def _sign(a):
    """GLSL sign。"""
    return 1.0 if a > 0.0 else (-1.0 if a < 0.0 else 0.0)


def _math_power(a, b, c):
    """GLSL math_power：a>=0 直接 pow；a<0 时仅当 b 接近整数才定义。"""
    if a >= 0.0:
        return compatible_pow(a, b)
    fraction = _mod(abs(b), 1.0)
    if fraction > 0.999 or fraction < 0.001:
        return compatible_pow(a, math.floor(b + 0.5))
    return 0.0


def _smooth_min(a, b, c):
    """GLSL math_smoothmin。"""
    if c != 0.0:
        h = max(c - abs(a - b), 0.0) / c
        return min(a, b) - h * h * h * c * (1.0 / 6.0)
    return min(a, b)


def _smooth_max(a, b, c):
    """GLSL math_smoothmax = -smoothmin(-a, -b, c)。"""
    return -_smooth_min(-a, -b, c)


# =====================================================================
# 矢量 GLSL helper
# =====================================================================
def _vec(a):
    """确保输入是长度 3 的 list。"""
    return [float(a[0]), float(a[1]), float(a[2])] if not isinstance(a, (int, float)) else [float(a)] * 3


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]]


def _length(a):
    return math.sqrt(_dot(a, a))


def _length_sq(a):
    return _dot(a, a)


def _safe_normalize(a):
    # 匹配 Cycles 的 safe normalize，length_sq 过小则归零
    ls = _length_sq(a)
    return [v * (1.0 / math.sqrt(ls)) for v in a] if ls > 1e-35 else [0.0, 0.0, 0.0]


def _normalize(a):
    # vector_math_normalize 用 lenSquared > 0
    ls = _length_sq(a)
    return [v * (1.0 / math.sqrt(ls)) for v in a] if ls > 0.0 else a[:]


def _reflect(i, n):
    # GLSL reflect: I - 2*dot(N,I)*N
    d = _dot(n, i)
    return [i[x] - 2.0 * d * n[x] for x in range(3)]


def _refract(i, n, eta):
    # GLSL refract
    d = _dot(n, i)
    k = 1.0 - eta * eta * (1.0 - d * d)
    if k < 0.0:
        return [0.0, 0.0, 0.0]
    return [eta * i[x] - (eta * d + math.sqrt(k)) * n[x] for x in range(3)]


def _faceforward(n, i, ng):
    # GLSL faceforward: dot(Ng,I)<0 ? N : -N
    return n[:] if _dot(ng, i) < 0.0 else [-v for v in n]


def _vec_project(a, b, c, s):
    """GLSL vector_math_project：a 投影到 b。b=0 时返回 0 向量。"""
    ls = _length_sq(b)
    if ls == 0.0:
        return [0.0, 0.0, 0.0], 0.0
    d = _dot(a, b) / ls
    return [d * b[x] for x in range(3)], 0.0
