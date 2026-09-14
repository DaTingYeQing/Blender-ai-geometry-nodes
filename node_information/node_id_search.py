# -*- coding: utf-8 -*-
"""node_id_search.py —— 节点名称搜索工具(第一步: 找 idname)。

输入一个英文词(功能/属性/socket/描述/名字片段), 返回匹配的 idname + label 列表。
匹配范围: bl_idname / label / 属性名 / socket 名 / 描述文字。

用法:
  python node_id_search.py <英文词>         # 如: rounding / mix / offset / convert
"""
import argparse
import io
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

_idx = None


def find_data(name):
    """在脚本同目录找数据文件, 找到返回路径, 否则 None。"""
    p = os.path.join(BASE, name)
    return p if os.path.exists(p) else None


def load_index():
    """轻量搜索索引: idname -> {label, category, description, sockets, props}。"""
    global _idx
    if _idx is None:
        p = find_data("search_index.json")
        if p is None:
            raise SystemExit("ERROR: 找不到 search_index.json")
        with io.open(p, "r", encoding="utf-8") as f:
            _idx = json.load(f)
    return _idx


def search_nodes(kw):
    """模糊搜: 在 名字/label/属性名/socket名/描述 里匹配, 返回 {idname: label}。"""
    kwl = kw.lower()
    idx = load_index()
    hits = {}
    for idname, meta in sorted(idx.items()):
        label = meta.get("label", "")
        if kwl in idname.lower() or kwl in label.lower():
            hits[idname] = label
            continue
        if any(kwl in p.lower() for p in meta.get("props", [])):
            hits[idname] = label
            continue
        if any(kwl in s.lower() for s in meta.get("sockets", [])):
            hits[idname] = label
            continue
        desc = (meta.get("description") or "").lower()
        if kwl in desc:
            hits[idname] = label
    return hits


def main():
    ap = argparse.ArgumentParser(description="Blender 4.5.0 节点名称搜索工具(找 idname)")
    ap.add_argument("word", help="英文片段: 名字/label/属性/socket/描述, 如 rounding / mix / offset")
    args = ap.parse_args()

    hits = search_nodes(args.word)
    print("== node-id-search %s ==  (%d hits)" % (args.word, len(hits)))
    for idname in sorted(hits):
        print("  %-48s %s" % (idname, hits[idname]))
    print("选好 idname 后: python node_full_export.py <idname> 返回预生成 JSON")
    # 不用 sys.exit: 避免在 Blender 控制台粘贴时闪退
    return 0


if __name__ == "__main__":
    main()
