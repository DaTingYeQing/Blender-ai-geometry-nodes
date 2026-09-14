# -*- coding: utf-8 -*-
"""
math_ir.py — 自然表达式编译出的中间表示（IR）。

一份 IR、两条消费者：
    Graph ──┬─► interpret  → 数值结果（eval 试算）
            └─► blender    → 脚本字符串（compile 进 Blender）
每个 IRNode 指向一个 OpSpec，二者共用同一份 impl，因此漂移在结构上不可能发生。

Graph.to_dict() 输出的 dict 形状与旧 parse_natural 完全一致（磁盘产物
math_struct_{group}.json 的形状靠它保持不变）。
"""

from dataclasses import dataclass, field


@dataclass
class Ref:
    """子表达式的值来源。kind: 'input' | 'node' | 'const'。

    - input: payload 为变量名
    - node : payload 为节点 uid
    - const: payload 为数值（标量 float / 矢量 3 元素 list）
    """
    kind: str
    payload: object
    type: str

    def to_dict(self):
        return {"kind": self.kind, "payload": self.payload, "type": self.type}

    def __repr__(self):
        return f"<{self.kind}:{self.payload} type={self.type}>"


@dataclass
class IRNode:
    """一个运算节点。inputs 为 [(socket_idx, Ref)]；consts 为 {socket_idx: value}。"""
    uid: str
    op: str
    node_type: str
    family: str          # "math" / "vector_math"（解释器据此选数值应用函数）
    inputs: list = field(default_factory=list)
    consts: dict = field(default_factory=dict)
    out_socket: int = 0
    out_type: str = "Float"

    def to_dict(self):
        return {
            "uid": self.uid,
            "op": self.op,
            "node_type": self.node_type,
            "inputs": [(sock, ref.to_dict()) for sock, ref in self.inputs],
            "consts": dict(self.consts),
            "out_socket": self.out_socket,
        }


@dataclass
class Graph:
    """一棵完整的节点图 IR。"""
    mode: str
    input_vars: list
    nodes: list          # list[IRNode]，按 uid 产生顺序
    output: Ref
    types: dict

    def to_dict(self):
        return {
            "mode": self.mode,
            "input_vars": list(self.input_vars),
            "nodes": [n.to_dict() for n in self.nodes],
            "output": self.output.to_dict(),
            "types": dict(self.types),
        }
