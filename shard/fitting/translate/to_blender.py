# -*- coding: utf-8 -*-
"""翻译层 2：Optuna 原始值 + 固定值 → Blender 打包值。"""

from __future__ import annotations


def to_blender(space, raw: dict, cards: dict, *, fixed=(), default_node=None):
    """把一轮采样值和固定值按输入打包，供底座写进 Blender。

    单节点且都在默认输出节点：{socket identifier: 打包值}（与旧版一致）。
    其它情况：[{node, identifier, value}, ...]，避免不同节点的同名 socket 撞键。
    """
    entries = []
    for param in space.params:
        card = cards.get(param.kind)
        if card is None:
            raise KeyError("参数 %r 没有 %s 卡片" % (param.identifier, param.kind))
        entries.append((param.node, param.identifier, card.pack(param, raw)))

    for item in fixed or ():
        entries.append((item.get("node"), item["identifier"], item["value"]))

    if not entries:
        return {}

    nodes = {node for node, _, _ in entries}
    if len(nodes) == 1 and (default_node is None or nodes == {default_node}):
        return {identifier: packed for _, identifier, packed in entries}
    return [
        {"node": node, "identifier": identifier, "value": packed}
        for node, identifier, packed in entries
    ]
