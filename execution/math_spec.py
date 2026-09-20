# -*- coding: utf-8 -*-
"""
math_spec.py — 数学 op 的核心规格对象与注册表（单一事实来源）。

设计主线：
  一个 op 的规格对象 OpSpec 携带它的**全部**知识（id / ui 名 / 家族 / 参数签名 /
  输出类型 / 唯一一份数值实现 / 自然函数别名 / 运算符绑定 / 文档）。其余一切
  （arity、socket 布局、参数校验、编译脚本、eval 语义、帮助文案、跨族提示）
  都从注册表**派生**，不再手写第二份。

本模块只放与具体 op 无关的骨架：
  ValueType / Param / OpSpec / Family / 注册表 / apply_* / 类型推断 / 异常。
具体 op 定义在 math_family_scalar.py 与 math_family_vector.py，通过 register_family() 注册。

家族注册采用「惰性加载 + 显式注册」以避免 math_spec 与家族模块的循环 import。
"""

from enum import Enum
from dataclasses import dataclass
from typing import Callable

from math_semantics import _vec


# =====================================================================
# 值类型
# =====================================================================
class ValueType(str, Enum):
    """节点接口的值类型。值本身是 Blender 侧的类型名，方便直接落进脚本。"""
    SCALAR = "Float"
    VECTOR = "Vector"


SCALAR = ValueType.SCALAR.value   # "Float"
VECTOR = ValueType.VECTOR.value   # "Vector"


# =====================================================================
# 异常
# =====================================================================
class MathKitError(Exception):
    """mathkit 家族所有显式错误的基类。"""


class UnserializableResult(MathKitError):
    """解释结果无法安全 JSON 序列化（复数 / 非有限值）。"""


# =====================================================================
# 规格对象
# =====================================================================
@dataclass(frozen=True)
class Param:
    """一个操作数参数。"""
    name: str
    type: ValueType
    default: "float | tuple | None" = None


@dataclass(frozen=True)
class OpSpec:
    """一个数学运算的完整规格（唯一事实来源）。"""
    id: str                              # Blender identifier，如 "POWER"
    ui_name: str                         # "Power"
    family: str                          # "math" / "vector_math"
    params: tuple                        # tuple[Param, ...]，长度即 arity
    out_type: ValueType
    impl: Callable                       # ★ 唯一一份数值实现（Blender 精确语义）
    func_aliases: tuple = ()             # 自然函数名，如 ("sqrt",)
    binop: "str | None" = None           # 运算符字面量 "+"/"-"/"*"/"/"/"**"/"%"
    doc: str = ""                        # 帮助文案（= 旧 BLENDER_*_ENUM 的描述）


# =====================================================================
# 家族
# =====================================================================
class Family:
    """一个节点家族：一套节点类型 + 一组 op + socket 布局规则。"""

    def __init__(self, name, node_idname, default_input_type, ops, socket_rule):
        self.name = name                              # "math" / "vector_math"
        self.node_idname = node_idname                # "ShaderNodeMath"（唯一声明点）
        self.default_input_type = default_input_type  # 变量缺省类型
        self.ops = {spec.id: spec for spec in ops}
        self.socket_rule = socket_rule                # OpSpec -> (输入socket列表, 输出socket)
        self._func_ops = None
        self._binop_ops = None

    # ---- 派生视图 ----

    def func_ops(self):
        """别名 -> op_id（自然函数名映射）。"""
        if self._func_ops is None:
            m = {}
            for spec in self.ops.values():
                for alias in spec.func_aliases:
                    m[alias] = spec.id
            self._func_ops = m
        return self._func_ops

    def binop_ops(self):
        """运算符字面量 -> op_id。"""
        if self._binop_ops is None:
            m = {}
            for spec in self.ops.values():
                if spec.binop:
                    m[spec.binop] = spec.id
            self._binop_ops = m
        return self._binop_ops

    def get(self, op):
        if op not in self.ops:
            raise KeyError(f"家族 {self.name!r} 无此 op: {op!r}。可用: {sorted(self.ops)}")
        return self.ops[op]

    def has(self, op):
        return op in self.ops

    def n_inputs(self, op):
        return len(self.ops[op].params)

    def input_types(self, op):
        return [p.type.value for p in self.ops[op].params]

    def output_type(self, op):
        return self.ops[op].out_type.value

    def input_sockets(self, op):
        return self.socket_rule(self.ops[op])[0]

    def output_socket(self, op):
        return self.socket_rule(self.ops[op])[1]


# ---- 通用 socket 规则（两个家族各一套，供 math_ops 的候选/派生）----
def scalar_socket_rule(spec):
    """标量 ShaderNodeMath：操作数 i -> socket i；输出恒 socket 0。"""
    return list(range(len(spec.params))), 0


def vector_socket_rule(spec):
    """矢量 ShaderNodeVectorMath：3 个 Vector socket(0,1,2) + 1 个 Float socket(3)。
    Vector 操作数依次占 0,1,2；Float 操作数(SCALE 缩放 / REFRACT 折射率)落到 socket 3。
    输出：标量用 socket 1，矢量用 socket 0。"""
    vec_iter = iter(range(3))
    socks = []
    for p in spec.params:
        socks.append(next(vec_iter) if p.type == ValueType.VECTOR else 3)
    return socks, (1 if spec.out_type == ValueType.SCALAR else 0)


# =====================================================================
# 注册表（惰性加载）
# =====================================================================
_FAMILIES = {}


def register_family(fam):
    """家族模块在 import 时调用，把自己登记进来。"""
    _FAMILIES[fam.name] = fam
    return fam


def _ensure_families():
    if "math" not in _FAMILIES or "vector_math" not in _FAMILIES:
        # 惰性 import 触发注册，避免 math_spec <-> 家族模块的循环 import。
        import math_family_scalar  # noqa: F401
        import math_family_vector  # noqa: F401
    return _FAMILIES


def get_family(name):
    fams = _ensure_families()
    if name not in fams:
        raise KeyError(f"未知家族: {name!r}。可用: {sorted(fams)}")
    return fams[name]


# =====================================================================
# 数值应用（两条消费者——interpret 与 blender_* ——共用同一份逻辑）
# =====================================================================
def _pad3(args):
    """把参数补齐成 (a, b, c)，与旧 blender_math 语义一致。"""
    a, b, c = (list(args) + [0.0, 0.0, 0.0])[:3]
    return a, b, c


def apply_scalar(spec, args):
    """按 Blender 标量节点语义执行。args 为操作数位置取值。"""
    a, b, c = _pad3(args)
    return spec.impl(a, b, c)


def apply_vector(spec, args):
    """按 Blender 矢量节点语义执行。args 为操作数位置取值。
    Vector 操作数依次填 a,b,c；Float 操作数（SCALE 缩放/REFRACT 折射率）填 s。
    返回：out_type 为标量时返回 outValue，否则返回 outVector。"""
    a = [0.0, 0.0, 0.0]
    b = [0.0, 0.0, 0.0]
    c = [0.0, 0.0, 0.0]
    s = 1.0
    vec_slot = 0
    for p, v in zip(spec.params, args):
        if p.type == ValueType.SCALAR:
            s = float(v)
        else:
            if vec_slot == 0:
                a = _vec(v)
            elif vec_slot == 1:
                b = _vec(v)
            else:
                c = _vec(v)
            vec_slot += 1
    out_vec, out_val = spec.impl(a, b, c, s)
    return out_val if spec.out_type == ValueType.SCALAR else out_vec


def apply_op(spec, args):
    """按 spec 所属家族分派到 apply_scalar / apply_vector。"""
    return apply_scalar(spec, args) if spec.family == "math" else apply_vector(spec, args)


# =====================================================================
# 输入类型推断（eval / compile 共用，原属 math_eval，上提到 core 以免跨层依赖）
# =====================================================================
def infer_type(value):
    """从单个输入值推断类型：数字=标量，3元素list/tuple=矢量，其它=报错。"""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return SCALAR
    if isinstance(value, (list, tuple)) and len(value) == 3 and all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in value
    ):
        return VECTOR
    raise ValueError(
        f"无法识别输入值的类型: {value!r}。应为数字(标量)或3元素列表/元组(矢量)。"
    )


def check_types(rows):
    """检查所有输入行的变量类型一致性。返回 (types, errors)。"""
    types = {}
    errors = []
    for row_idx, row in enumerate(rows, start=1):
        for name, value in row.items():
            try:
                t = infer_type(value)
            except ValueError as e:
                errors.append(f"第 {row_idx} 组输入变量 {name!r}: {e}")
                continue
            if name in types:
                if types[name] != t:
                    errors.append(
                        f"变量 {name!r} 类型矛盾：第 1 次出现是 {types[name]}，"
                        f"第 {row_idx} 组输入是 {t}。请统一其类型或用不同名字区分。"
                    )
            else:
                types[name] = t
    return types, errors
