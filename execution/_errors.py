# -*- coding: utf-8 -*-
"""错误模块（原代码里没有这一层，本次新建）。

改造前：错误只是一串中文字符串 append 进 list，前端只能靠正则从 stdout 里抠。
改造后：每条错误是一个 Issue，同时提供两个出口，两份数据同源：

  · msg   —— **沿用改造前的原始文案**，保证 stdout 一字不差，前端零改动仍然可用
  · code / hint / where —— 结构化字段，写进 result.json，供前端后续直接消费

这样「给人看的旧格式」和「给程序用的新格式」永不脱节——它们来自同一个 Issue。

（msg 文案必须与改造前逐字一致，这是 stdout 兼容性的硬约束，改动前请先跑比对验证。）
"""
from _refs import sock_label


class Issue:
    """一条错误或警告。msg 必须与改造前文案逐字一致。"""

    __slots__ = ("msg", "code", "hint", "where")

    def __init__(self, msg, code="", hint="", where=None):
        self.msg = msg
        self.code = code
        self.hint = hint
        self.where = where

    def to_json(self):
        d = {"msg": self.msg}
        if self.code:
            d["code"] = self.code
        if self.hint:
            d["hint"] = self.hint
        if self.where:
            d["where"] = self.where
        return d


class Collector:
    """一次批次的错误/警告收集器。所有动作通过它汇报，不抛异常。"""

    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, msg, code="", hint="", where=None):
        self.errors.append(Issue(msg, code, hint, where))

    def warning(self, msg, code="", hint="", where=None):
        self.warnings.append(Issue(msg, code, hint, where))

    def failed(self):
        """已累计的错误条数（动作执行前后取差值，即可算出这个动作成功了几条）。"""
        return len(self.errors)

    def ok(self):
        return not self.errors

    def error_texts(self):
        return [i.msg for i in self.errors]

    def warning_texts(self):
        return [i.msg for i in self.warnings]

    def to_json(self):
        return {
            "errors": [i.to_json() for i in self.errors],
            "warnings": [i.to_json() for i in self.warnings],
        }


def list_sockets(sockets, allow_name=False):
    """列出某个节点当前可用的接口，拼成「你写错了，可用的是这些」提示。"""
    return "、".join(sock_label(s, allow_name) for s in sockets if s.enabled and s.name) or "无"


def list_ifaces(tree, in_out):
    """列出组边界上的 interface 项，供 set 写错 prop 时提示。"""
    return "、".join(it.name for it in tree.interface.items_tree
                     if it.item_type == "SOCKET" and it.in_out == in_out and it.name) or "无"
