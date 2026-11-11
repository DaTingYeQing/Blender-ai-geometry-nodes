# -*- coding: utf-8 -*-
"""node_id_search.py —— 节点名称搜索工具(第一步: 找 idname)。

输入一个英文片段, 在 idname / label 上正反各匹配一次:
  正向: 搜索词出现在 idname 或 label 里
  反向: idname 或 label 整段出现在搜索词里
不搜 description、属性名、socket 名。

用法:
  python node_id_search.py <英文词>         # 如: position / mix / nodesetpos
"""
import argparse
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))


def search_nodes(kw):
    """正反子串匹配 idname / label, 返回 {idname: label}。"""
    kwl = kw.lower()
    if not kwl:
        return {}
    with open(os.path.join(BASE, "search_index.json"), encoding="utf-8") as f:
        idx = json.load(f)
    hits = {}
    for idname, meta in sorted(idx.items()):
        label = meta if isinstance(meta, str) else meta["label"]
        idl = idname.lower()
        lab = label.lower()
        forward = kwl in idl or kwl in lab
        reverse = idl in kwl or lab in kwl
        if forward or reverse:
            hits[idname] = label
    return hits


def main():
    ap = argparse.ArgumentParser(description="Blender 4.5.0 节点名称搜索工具(找 idname)")
    ap.add_argument("word", help="英文片段。出现在 idname/label 里, 或 idname/label 出现在它里面, 都算命中")
    args = ap.parse_args()

    hits = search_nodes(args.word)
    print("== node-id-search %s ==  (%d hits)" % (args.word, len(hits)))
    for idname in sorted(hits):
        print("  %-48s %s" % (idname, hits[idname]))
    print("选好 idname 后: python node_full_export.py <idname> 返回预生成 JSON")
    # 不用 sys.exit: 避免在 Blender 控制台粘贴时闪退


if __name__ == "__main__":
    main()
