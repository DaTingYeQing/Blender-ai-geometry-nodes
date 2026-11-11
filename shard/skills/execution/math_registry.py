# -*- coding: utf-8 -*-
"""
math_registry.py — 数学 op 的签名/布局查询接口（投影层）。

本文件不再存放独立元数据：标量 41 + 矢量 29 的 arity / 输入类型 / 输出类型 /
socket 布局全部从 OpSpec 注册表**派生**，公共符号名与行为与旧版一致。

数据来源：math_family_scalar / math_family_vector 的 OpSpec（唯一事实来源）。
"""

from math_spec import (SCALAR, VECTOR, get_family)  # noqa: F401


# ---------------------------------------------------------------- 家族签名表（派生）
def _signatures(family_name):
    fam = get_family(family_name)
    return {op_id: (fam.input_types(op_id), fam.output_type(op_id))
            for op_id in fam.ops}


SCALAR_SIGNATURES = _signatures("math")
VECTOR_SIGNATURES = _signatures("vector_math")


def _family(mode):
    return get_family("math" if mode == "math" else "vector_math")


# ---------------------------------------------------------------- 查询接口
def family_for(mode):
    """mode ('math'/'vector_math') -> 该家族签名表。"""
    return SCALAR_SIGNATURES if mode == "math" else VECTOR_SIGNATURES


def has_op(mode, op):
    return op in family_for(mode)


def n_inputs(mode, op):
    return len(family_for(mode)[op][0])


def input_types(mode, op):
    return family_for(mode)[op][0]


def output_type(mode, op):
    return family_for(mode)[op][1]


def list_ops(mode):
    return sorted(family_for(mode))


# ---------------------------------------------------------------- Blender socket 布局
# 编译/建节点脚本需要"操作数位置 -> 实际 socket 序号"，不能拿操作数序号当 socket 序号。
# 规则由 Family.socket_rule 提供，与旧版一致：
#   - 标量 ShaderNodeMath：操作数 i -> socket i。
#   - 矢量 ShaderNodeVectorMath：Vector 操作数依次占 0,1,2；Float 操作数(SCALE 缩放 /
#     REFRACT 折射率)落到 socket 3。
#   - 输出：标量节点恒 outputs[0]；矢量节点输出 Vector 用 outputs[0]，输出 Scalar 用 outputs[1]。

def socket_indices(mode, op):
    """操作数位置 -> Blender 输入 socket 序号。返回等长列表。"""
    return _family(mode).input_sockets(op)


def output_socket(mode, op):
    """该 op 的结果在 Blender 输出 socket 的序号。"""
    return _family(mode).output_socket(op)


if __name__ == "__main__":
    print("标量 op:", len(SCALAR_SIGNATURES), "个")
    print("矢量 op:", len(VECTOR_SIGNATURES), "个")
    print("SCALE 输入:", input_types("vector_math", "SCALE"),
          "输出:", output_type("vector_math", "SCALE"))
    print("LENGTH 输入:", input_types("vector_math", "LENGTH"),
          "输出:", output_type("vector_math", "LENGTH"))
    print("SMOOTH_MIN 输入个数:", n_inputs("math", "SMOOTH_MIN"))
