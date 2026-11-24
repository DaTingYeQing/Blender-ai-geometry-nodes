# -*- coding: utf-8 -*-
"""
math_validate.py — 自然表达式校验。

校验自然表达式（如 sin(x) * 2 + y），解析错误会返回明确报错。
校验即解析：内部只调用一次 parser（build_graph），不再重复 ast.parse。

返回形状保持 (errors, body, out_type) 三元组（外部解包契约不变）。
新架构不再把 AST body 交给调用方 eval，因此 body 恒为 None。
"""


def validate_natural(expr, mode, types):
    """校验自然表达式。返回 (errors, body, out_type)。

    body 恒为 None（保留该位置以维持三元组形状，避免外部解包报错）。
    """
    try:
        from math_natural import build_graph
        graph = build_graph(expr, mode, types)
    except SyntaxError as e:
        return [f"语法错误: {e}"], None, None
    except Exception as e:
        return [str(e)], None, None
    return [], None, graph.output.type
