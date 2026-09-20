# -*- coding: utf-8 -*-
"""
math_natural.py — 自然数学表达式 → Blender 节点图编译器。

把 'sin(x) * 2 + y' 这种自然表达式翻译成与 math_compile.py 一致的节点图结构，
让 AI 可以直接写数学式子，不用写屎山嵌套函数调用。

支持的表达式:
  - 四则运算: +, -, *, /, **, %
  - 一元负号: -x
  - 函数调用: sin(x), cos(x), sqrt(x), dot(a,b), cross(a,b), length(v), ...
  - 常量: 3.14, [1, 2, 3]
  - 变量: x, pos, offset

自动优化:
  - a * b + c  → MULTIPLY_ADD(a, b, c)
  - a * b - c  → MULTIPLY_ADD(a, b, -c)

与 math_compile 无缝衔接:
  import math_natural, math_compile
  graph = math_natural.parse_natural(expr, mode, types)       # dict（对外契约）
  gg    = math_natural.build_graph(expr, mode, types)         # Graph IR（eval 用）
  script = math_compile._gen_script(graph, ...)

本文件不再手写任何 op 映射表：函数名 / 运算符绑定 / 参数个数 / socket 布局
全部从 OpSpec 注册表派生（唯一事实来源）。自然函数名严格保持旧版集合：
标量**没有** power / mod 具名函数（只有 ** 与 %），矢量**有** power / mod。
"""

import ast

from math_registry import SCALAR, VECTOR, output_socket, socket_indices, n_inputs
from math_spec import get_family
from math_ir import Ref, IRNode, Graph


# 运算符字面量绑定（两个家族一致）
_AST_BINOP = {
    ast.Add: "+", ast.Sub: "-", ast.Mult: "*",
    ast.Div: "/", ast.Pow: "**", ast.Mod: "%",
}


# =====================================================================
# NaturalParser — 核心解析器
# =====================================================================

class NaturalParser:
    """自然表达式 → 节点图（IR）。"""

    def __init__(self, mode, types):
        self.mode = mode          # 'math' | 'vector_math'
        self.types = dict(types)  # {变量名: 类型}
        self.nodes = []           # IRNode 列表
        self.input_vars = []      # 按首次出现顺序
        self._memo = {}           # ast.dump(node) → Ref
        self._uid = 0

        # ---- 由注册表派生的映射（单源）----
        self._family = get_family(mode)
        self._func_map = self._family.func_ops()          # 别名 -> op_id
        self._binop_symbol = self._family.binop_ops()     # 运算符 -> op_id（本家族）
        self._scalar_binop_symbol = get_family("math").binop_ops()
        self._binop_map = {}
        for ast_cls, sym in _AST_BINOP.items():
            op_id = self._binop_symbol.get(sym)
            if op_id:
                self._binop_map[ast_cls] = op_id

    # ---- 工具 ----

    def _new_uid(self):
        u = f"n{self._uid}"
        self._uid += 1
        return u

    def _node_type(self):
        return "ShaderNodeMath" if self.mode == "math" else "ShaderNodeVectorMath"

    def _register_input(self, name):
        if name not in self.input_vars:
            self.input_vars.append(name)
        t = self.types.get(name, VECTOR if self.mode == "vector_math" else SCALAR)
        return Ref("input", name, t)

    def _const(self, value):
        if isinstance(value, (list, tuple)):
            # 只处理 3 元素向量常量
            if len(value) == 3:
                return Ref("const", [float(v) for v in value], VECTOR)
            raise ValueError(f"向量常量必须为 3 元素，收到 {len(value)} 个")
        if isinstance(value, bool):
            return Ref("const", 1.0 if value else 0.0, SCALAR)
        if isinstance(value, (int, float)):
            return Ref("const", float(value), SCALAR)
        raise ValueError(f"不支持的常量: {value!r}")

    def _add_node(self, op, inputs, consts, out_type, node_type=None):
        uid = self._new_uid()
        nt = node_type or self._node_type()

        # 确定输出 socket 序号
        if nt == self._node_type():
            try:
                osock = output_socket(self.mode, op)
            except Exception:
                osock = 0
        else:
            osock = 0

        node_family = "math" if nt == "ShaderNodeMath" else "vector_math"
        self.nodes.append(IRNode(
            uid=uid, op=op, node_type=nt, family=node_family,
            inputs=list(inputs), consts=dict(consts),
            out_socket=osock, out_type=out_type,
        ))
        return Ref("node", uid, out_type)

    # ---- 入口 ----

    def build(self, expr):
        """返回 Graph IR。"""
        tree = ast.parse(expr.strip(), mode="eval")
        out_ref = self._walk(tree.body)
        return Graph(self.mode, self.input_vars, self.nodes, out_ref, self.types)

    def parse(self, expr):
        """返回节点图 dict（对外契约形状不变）。"""
        return self.build(expr).to_dict()

    def _walk(self, node):
        key = ast.dump(node)
        if key in self._memo:
            return self._memo[key]
        ref = self._do_walk(node)
        self._memo[key] = ref
        return ref

    def _do_walk(self, node):
        if isinstance(node, ast.Constant):
            return self._const(node.value)
        if isinstance(node, ast.Name):
            return self._register_input(node.id)
        if isinstance(node, ast.UnaryOp):
            return self._unary(node)
        if isinstance(node, ast.BinOp):
            return self._binop(node)
        if isinstance(node, ast.Call):
            return self._call(node)
        if isinstance(node, (ast.List, ast.Tuple)):
            return self._list_literal(node)
        raise ValueError(f"不支持的结构: {type(node).__name__}")

    # ---- 列表字面量 [x, y, z] ----

    def _list_literal(self, node):
        """[x, y, z] 或 (x, y, z) → 向量常量或逐个元素构建。"""
        elts = [self._walk(e) for e in node.elts]
        if len(elts) != 3:
            raise ValueError(f"向量长度必须为 3，收到 {len(elts)} 个")
        # 如果所有元素都是常量，直接做向量常量
        if all(e.kind == "const" for e in elts):
            return self._const([e.payload for e in elts])
        # 否则用三个 Separate/Combine XYZ 构造
        raise ValueError("[x, y, z] 语法目前只支持全常量，如 [1, 2, 3]")

    # ---- 一元运算符 ----

    def _unary(self, node):
        if not isinstance(node.op, ast.USub):
            raise ValueError(f"不支持的一元运算符: {type(node.op).__name__}")
        operand = self._walk(node.operand)

        if operand.type == VECTOR:
            # SCALE(v, -1) → 矢量取反
            return self._add_node("SCALE", [(0, operand)], {3: -1.0}, VECTOR)
        else:
            # MULTIPLY(-1, x) → 标量取反，过滤常数
            neg = self._const(-1.0)
            inputs = []
            consts = {}
            for sock, ref in [(0, neg), (1, operand)]:
                if ref.kind == "const":
                    consts[sock] = ref.payload
                else:
                    inputs.append((sock, ref))
            # 标量取反必须落到 ShaderNodeMath：即便在 vector_math 模式下，
            # 这个 MULTIPLY 的两个操作数都是标量，用矢量节点会让计数器/常量错位。
            return self._add_node("MULTIPLY", inputs, consts, SCALAR,
                                  node_type="ShaderNodeMath")

    # ---- 二元运算符 ----

    def _binop(self, node):
        op_type = type(node.op)

        if op_type not in self._binop_map:
            raise ValueError(f"不支持的运算符: {type(node.op).__name__}")

        blender_op = self._binop_map[op_type]

        # 先检测 MULTIPLY_ADD 优化（避免创建冗余的 MULTIPLY 节点）
        if op_type in (ast.Add, ast.Sub):
            madd = self._try_multiply_add_early(node)
            if madd:
                return madd

        # 普通二元 op
        left = self._walk(node.left)
        right = self._walk(node.right)

        # 矢量模式: 标量 * 矢量 → SCALE
        if self.mode == "vector_math" and blender_op == "MULTIPLY":
            if left.type == VECTOR and right.type == SCALAR:
                return self._make_scale(left, right)
            if left.type == SCALAR and right.type == VECTOR:
                return self._make_scale(right, left)

        # 通用二元 op
        out_type = self._infer_binop_type(blender_op, left, right)

        # 如果矢量模式下两个操作数都是标量，退化为标量 Math 节点
        node_type = None
        actual_op = blender_op
        if (self.mode == "vector_math" and left.type == SCALAR
                and right.type == SCALAR and blender_op in self._binop_symbol.values()):
            node_type = "ShaderNodeMath"
            actual_op = self._scalar_binop_symbol.get(_AST_BINOP[op_type], blender_op)
            out_type = SCALAR

        if node_type:
            sock_nums = socket_indices("math", actual_op)
        else:
            sock_nums = socket_indices(self.mode, actual_op)

        inputs = []
        consts = {}
        for i, ref in enumerate([left, right]):
            sock = sock_nums[i]
            if ref.kind == "const":
                consts[sock] = ref.payload
            else:
                inputs.append((sock, ref))

        return self._add_node(actual_op, inputs, consts, out_type, node_type=node_type)

    def _make_scale(self, vec_ref, scalar_ref):
        """创建 SCALE 节点: vec * scalar"""
        inputs = []
        consts = {}
        if vec_ref.kind == "const":
            consts[0] = vec_ref.payload
        else:
            inputs.append((0, vec_ref))
        if scalar_ref.kind == "const":
            consts[3] = scalar_ref.payload
        else:
            inputs.append((3, scalar_ref))
        return self._add_node("SCALE", inputs, consts, VECTOR)

    def _try_multiply_add_early(self, node):
        """在 walk 子节点前检测 MULTIPLY_ADD 优化，避免创建冗余节点。

        匹配模式:
          a * b + c  → MULTIPLY_ADD(a, b, c)
          a * b - c  → MULTIPLY_ADD(a, b, -c)
          c + a * b  → MULTIPLY_ADD(a, b, c)
        """
        # 模式1: a * b + c 或 a * b - c
        if (isinstance(node.left, ast.BinOp) and
                isinstance(node.left.op, ast.Mult)):
            a = self._walk(node.left.left)
            b = self._walk(node.left.right)
            c = self._walk(node.right)
            # 矢量模式下 标量*矢量/矢量*标量 应走 SCALE，不是 MULTIPLY_ADD；
            # 只有 同型(两个矢量 或 两个标量) 才可合并 MULTIPLY_ADD
            if self.mode == "vector_math" and not isinstance(node.op, ast.Add):
                # c - a*b 不能优化（非 MULTIPLY_ADD 语义）
                return None
            if self.mode == "vector_math" and a.type != b.type:
                return None
            if isinstance(node.op, ast.Add):
                return self._make_multiply_add(a, b, c)
            else:
                # a * b - c → MULTIPLY_ADD(a, b, -c)
                c_neg = self._make_neg(c)
                return self._make_multiply_add(a, b, c_neg)

        # 模式2: c + a * b
        if (isinstance(node.right, ast.BinOp) and
                isinstance(node.right.op, ast.Mult)):
            a = self._walk(node.right.left)
            b = self._walk(node.right.right)
            c = self._walk(node.left)
            if isinstance(node.op, ast.Add):
                # 矢量模式下 标量*矢量/矢量*标量 走 SCALE，不合并 MULTIPLY_ADD
                if self.mode == "vector_math" and a.type != b.type:
                    return None
                return self._make_multiply_add(a, b, c)
            # c - a * b 不能优化（不是 MULTIPLY_ADD 的语义）

        return None

    def _make_neg(self, ref):
        """创建取反节点: -value。"""
        if ref.kind == "const":
            if ref.type == VECTOR:
                return self._const([-v for v in ref.payload])
            return self._const(-ref.payload)
        if ref.type == VECTOR:
            return self._add_node("SCALE", [(0, ref)], {3: -1.0}, VECTOR)
        neg = self._const(-1.0)
        inputs = []
        consts = {}
        for sock, r in [(0, neg), (1, ref)]:
            if r.kind == "const":
                consts[sock] = r.payload
            else:
                inputs.append((sock, r))
        # 同上：标量取反一律用 ShaderNodeMath。
        return self._add_node("MULTIPLY", inputs, consts, SCALAR,
                              node_type="ShaderNodeMath")

    def _make_multiply_add(self, a, b, c):
        """创建 MULTIPLY_ADD 节点。"""
        out_type = self._infer_binop_type("MULTIPLY_ADD", a, b)
        sock_nums = socket_indices(self.mode, "MULTIPLY_ADD")
        inputs = []
        consts = {}
        for i, ref in enumerate([a, b, c]):
            sock = sock_nums[i]
            if ref.kind == "const":
                consts[sock] = ref.payload
            else:
                inputs.append((sock, ref))
        return self._add_node("MULTIPLY_ADD", inputs, consts, out_type)

    def _infer_binop_type(self, op, left, right):
        """推断二元操作的结果类型。"""
        if self.mode == "vector_math":
            if op in ("DOT_PRODUCT", "DISTANCE", "LENGTH"):
                return SCALAR
            if op == "SCALE":
                return VECTOR
            # 如果两个操作数都是标量，结果也是标量
            if left.type == SCALAR and right.type == SCALAR:
                return SCALAR
            # 否则默认输出矢量
            return VECTOR
        return SCALAR

    # ---- 函数调用 ----

    def _call(self, node):
        func_name = node.func.id if isinstance(node.func, ast.Name) else None
        if func_name is None:
            raise ValueError(f"只支持函数调用，不支持: {ast.dump(node.func)}")

        if func_name not in self._func_map:
            # 给用户友好的跨家族提示
            alt_name = "vector_math" if self.mode == "math" else "math"
            alt_map = get_family(alt_name).func_ops()
            if func_name in alt_map:
                raise ValueError(
                    f"函数 {func_name}() 属于 '{alt_name}' 族，"
                    f"但当前模式是 '{self.mode}'。请把 type 改为 '{alt_name}'。"
                )
            raise ValueError(f"未知函数: {func_name}()")

        blender_op = self._func_map[func_name]
        args = [self._walk(a) for a in node.args]

        # 验证参数个数。
        # log 特例：LOGARITHM 有 2 个 socket（值 A、底数 Base）。双参直接对应两个 socket；
        # 单参会落到 Blender 未连线的 Base socket——而 Base 默认值是 0.5（已实测），
        # 于是 log(a) 实际是 log_0.5(a)，与自然对数符号相反。为免歧义，单参明确拒绝。
        if func_name == "log":
            if len(args) == 1:
                raise ValueError(
                    "log(a) 单参已禁用：Blender LOGARITHM 节点在不连 Base 时默认底数为 0.5，"
                    "log(a) 实际等于 log_0.5(a) = -log2(a)，与自然对数 ln(a) 符号相反。"
                    "请显式指定底数，例如 log(a, 2.718281828) 表示自然对数、"
                    "log(a, 2) 表示以 2 为底。"
                )
            if len(args) != 2:
                raise ValueError(f"log() 需要 2 个参数（值 a 与底数 b），收到 {len(args)} 个")
        else:
            try:
                need = n_inputs(self.mode, blender_op)
            except KeyError:
                need = len(args)  # 兜底
            if len(args) != need:
                raise ValueError(
                    f"{func_name}() 需要 {need} 个参数，收到 {len(args)} 个"
                )

        # 输出类型从注册表派生（矢量族 DOT/DISTANCE/LENGTH 输出标量，其余矢量）
        out_type = self._family.output_type(blender_op)

        sock_nums = socket_indices(self.mode, blender_op)
        inputs = []
        consts = {}
        for i, ref in enumerate(args):
            sock = sock_nums[i]
            if ref.kind == "const":
                consts[sock] = ref.payload
            else:
                inputs.append((sock, ref))

        return self._add_node(blender_op, inputs, consts, out_type)


# =====================================================================
# 公开接口
# =====================================================================

def build_graph(expr, mode, types):
    """解析自然表达式，返回 Graph IR（供 eval 解释器使用）。"""
    parser = NaturalParser(mode, types)
    return parser.build(expr)


def parse_natural(expr, mode, types):
    """解析自然表达式，返回节点图 dict（与 GraphBuilder.graph() 格式一致）。"""
    parser = NaturalParser(mode, types)
    return parser.parse(expr)


def is_natural_expr(expr):
    """现在只支持自然表达式，永远返回 True。"""
    return True


# =====================================================================
# 自检
# =====================================================================

if __name__ == "__main__":
    tests = [
        # (名称, 表达式, 模式, 类型表)
        ("标量基础", "sin(x) * 2 + y", "math", {"x": "Float", "y": "Float"}),
        ("标量 MULTIPLY_ADD 优化", "x * y + z", "math", {"x": "Float", "y": "Float", "z": "Float"}),
        ("标量取反", "-x", "math", {"x": "Float"}),
        ("标量复合", "sqrt(abs(x) * 2) + sin(y)", "math", {"x": "Float", "y": "Float"}),
        ("矢量基础", "dot(a, b) + length(c)", "vector_math", {"a": "Vector", "b": "Vector", "c": "Vector"}),
        ("矢量取反", "-v", "vector_math", {"v": "Vector"}),
        ("矢量标量乘", "v * 2", "vector_math", {"v": "Vector"}),
        ("矢量归一化", "normalize(v)", "vector_math", {"v": "Vector"}),
        ("矢量复合", "dot(a, normalize(b)) * 2", "vector_math", {"a": "Vector", "b": "Vector"}),
    ]

    for name, expr, mode, types in tests:
        try:
            g = parse_natural(expr, mode, types)
            print(f"[OK] {name}: {expr}")
            print(f"     输入: {g['input_vars']}  节点数: {len(g['nodes'])}  输出: {g['output']['type']}")
            for n in g['nodes']:
                ins = ", ".join(f"s{i}" for i, _ in n['inputs'])
                cs = f" cv={n['consts']}" if n['consts'] else ""
                print(f"      {n['uid']}: {n['op']} [{n['node_type']}] ({ins}){cs}")
            print()
        except Exception as e:
            print(f"[FAIL] {name}: {expr} → {e}")
            print()
