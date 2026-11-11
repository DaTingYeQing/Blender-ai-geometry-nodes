# -*- coding: utf-8 -*-
"""node_full_export.py —— 节点数据查询: 输入 idname 直接返回预生成 JSON。

用法:
  python node_full_export.py <idname>     # 输出 prebuilt_node/<idname>.json 的内容到 stdout

stdout 就是整理好的 JSON, AI 直接看即可, 不用再 read 文件。
不知道 idname? 先: python node_id_search.py <英文词> 找名字。
"""
import argparse
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser(description="节点数据查询: 读预生成 prebuilt_node/<idname>.json")
    ap.add_argument("idname", help="节点 bl_idname, 如 ShaderNodeMath")
    args = ap.parse_args()

    path = os.path.join(BASE, "prebuilt_node", args.idname + ".json")
    try:
        with open(path, encoding="utf-8") as f:
            data = f.read()
    except OSError:
        print("== node_full %s ==" % args.idname)
        print("found=false")
        print("提示: prebuilt_node 无此 idname。先用 node_find 搜正确 idname(4.5 很多节点已改名)。")
        return

    sys.stdout.write(data)


if __name__ == "__main__":
    main()
