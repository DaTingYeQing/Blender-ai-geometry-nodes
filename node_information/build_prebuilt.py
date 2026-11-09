# -*- coding: utf-8 -*-
"""build_prebuilt.py —— 重新生成几何/函数节点的 prebuilt_node 与 search_index.json

由 Blender 4.5 自带的 python 在后台运行（需要 bpy）：

  "<blender.exe>" --background --factory-startup \
      --python build_prebuilt.py -- --src "D:\\blender-src\\blender-4.5.0"

- 只生成 GeometryNode* 与 FunctionNode*；不动 ShaderNode* 文件。
- node idname 列表、nclass、几何类型支持从源码里解析（bpy.types 在 4.5 是懒加载，无法枚举）。
- search_index 收录所有已有 prebuilt 文件的 idname（用节点 UI 名称）。
"""
import argparse
import json
import os
import re
import sys

# ---------------------------------------------------------------- source scan

ID_RE = re.compile(r'"(GeometryNode[A-Za-z0-9_]+|FunctionNode[A-Za-z0-9_]+)"')
ID_RE_GEOM = re.compile(r'"(GeometryNode[A-Za-z0-9_]+)"')
CLASS_RE = re.compile(r"ntype\.nclass\s*=\s*(NODE_CLASS_[A-Z_]+)")
CUSTOM_RE = re.compile(
    r'node_type_base_custom\s*\(\s*ntype\s*,\s*"(GeometryNode[A-Za-z0-9_]+)"[^)]*?(NODE_CLASS_[A-Z_]+)')
SUP_RE = re.compile(r"supported_type\s*\(([^)]*)\)")
SUP_TYPE_RE = re.compile(r"Type::([A-Za-z]+)")

# ---------------------------------------------------------------- schema data

DENY = {
    "rna_type", "type", "location", "location_absolute", "width", "height",
    "dimensions", "name", "label", "inputs", "outputs", "internal_links",
    "parent", "warning_propagation", "use_custom_color", "color", "color_tag",
    "select", "show_options", "show_preview", "hide", "mute", "show_texture",
    "bl_idname", "bl_label", "bl_description", "bl_icon", "bl_static_type",
    "bl_width_default", "bl_width_min", "bl_width_max",
    "bl_height_default", "bl_height_min", "bl_height_max",
    "active_index", "active_item", "inspection_index",
}

ALL_TYPES = ["Mesh", "Curve", "PointCloud", "Volume", "Instances", "GreasePencil"]
SUPPORT_NAME = {"Mesh": "Mesh", "Curve": "Curve", "PointCloud": "PointCloud",
                "Volume": "Volume", "Instance": "Instance", "GreasePencil": "GreasePencil"}
SUPPORT_ZH = {"Mesh": "网格", "Curve": "曲线", "GreasePencil": "蜡笔",
              "PointCloud": "点云", "Volume": "体积", "Instance": "Instance"}

CATEGORY = {
    "GeometryNode": "几何节点",
    "FunctionNode": "函数/数学节点",
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"D:\blender-src\blender-4.5.0",
                    help="Blender 源码根目录（需要 source/blender/nodes）")
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)),
                    help="输出目录（默认本脚本所在目录）")
    return ap.parse_args(argv)


def iter_sources(root):
    for sub in ("geometry", "function"):
        base = os.path.join(root, "source", "blender", "nodes", sub)
        for dirpath, _dirs, names in os.walk(base):
            for name in names:
                if name.endswith((".cc", ".hh")):
                    yield os.path.join(dirpath, name)


def scan_source(root):
    """返回 (candidates, nclass_map, supports_map)。"""
    candidates = set()
    nclass = {}
    supports = {}
    for path in iter_sources(root):
        text = open(path, encoding="utf-8", errors="ignore").read()
        flat = re.sub(r"\s+", " ", text)
        is_geometry = "\\nodes\\geometry\\" in path or "/nodes/geometry/" in path

        for m in CUSTOM_RE.finditer(flat):
            idname, cls = m.group(1), m.group(2)
            candidates.add(idname)
            nclass.setdefault(idname, cls)

        ids = list(ID_RE.finditer(text))
        if not ids:
            continue

        file_sup = set()
        for call in SUP_RE.findall(flat):
            file_sup.update(SUP_TYPE_RE.findall(call))

        for i, m in enumerate(ids):
            idname = m.group(1)
            if idname.endswith("NodeTree"):
                continue
            candidates.add(idname)
            start = m.end()
            end = ids[i + 1].start() if i + 1 < len(ids) else len(text)
            window = re.sub(r"\s+", " ", text[start:end])
            cm = CLASS_RE.search(window)
            if cm:
                nclass.setdefault(idname, cm.group(1))
            if is_geometry and file_sup:
                supports.setdefault(idname, sorted(file_sup))
    return candidates, nclass, supports


# ---------------------------------------------------------------- extraction

def sock_type(s):
    return getattr(s, "bl_idname", None) or s.bl_rna.identifier


def sock_default(s):
    try:
        v = s.default_value
    except Exception:
        return None
    if isinstance(v, bool):
        return bool(v)
    if isinstance(v, int):
        return int(v)
    if isinstance(v, float):
        return float(v)
    if isinstance(v, str):
        return str(v)
    return None


def sock_dump(s, is_output):
    return {
        "name": s.name,
        "identifier": s.identifier,
        "type": sock_type(s),
        "enabled": s.enabled,
        "default": sock_default(s),
        "hide_value": getattr(s, "hide_value", False),
        "is_multi_input": False if is_output else bool(getattr(s, "is_multi_input", False)),
    }


def sockets(node):
    return {
        "inputs": [sock_dump(s, False) for s in node.inputs],
        "outputs": [sock_dump(s, True) for s in node.outputs],
    }


def _default_array(_p):
    # 旧数据里该字段恒为 null；非数组属性本来就没有值
    return None


def prop_dump(node, p):
    name = p.identifier
    rec = {"type": p.type, "readonly": p.is_readonly}
    try:
        subtype = p.subtype
    except Exception:
        subtype = "NONE"
    if p.type == "ENUM":
        default = p.default
        if isinstance(default, set):
            default = "|".join(sorted(default))
        rec["default"] = default
        rec["subtype"] = subtype
        rec["enum_items"] = [
            {"id": it.identifier, "name": it.name, "description": it.description or ""}
            for it in p.enum_items
        ]
    elif p.type == "BOOLEAN":
        rec["default"] = bool(p.default)
        rec["default_array"] = _default_array(p)
        rec["subtype"] = subtype
    elif p.type in ("INT", "FLOAT"):
        rec["default"] = p.default
        rec["default_array"] = _default_array(p)
        rec["step"] = p.step
        rec["subtype"] = subtype
        rec["soft_min"] = p.soft_min
        rec["soft_max"] = p.soft_max
    elif p.type == "STRING":
        rec["default"] = p.default
        rec["subtype"] = subtype
    else:
        rec["subtype"] = subtype
    return rec


def props(node):
    out = {}
    for p in node.bl_rna.properties:
        if p.identifier in DENY:
            continue
        try:
            out[p.identifier] = prop_dump(node, p)
        except Exception as e:
            print("PROP FAIL", node.bl_idname, p.identifier, e)
    return out


def dynamic(tree, idname, prop_names):
    """每个枚举属性用全新节点取基线，避免上一个枚举的残留状态影响下一项。"""
    out = []
    for name in prop_names:
        node = tree.nodes.new(idname)
        try:
            p = node.bl_rna.properties[name]
            if p.type != "ENUM" or getattr(p, "is_enum_flag", False):
                continue
            base = sockets(node)
            variants = []
            for it in p.enum_items:
                try:
                    setattr(node, name, it.identifier)
                except Exception:
                    continue
                snap = sockets(node)
                if snap != base:
                    variants.append({"value": it.identifier,
                                     "inputs": snap["inputs"],
                                     "outputs": snap["outputs"]})
            if variants:
                out.append({"property": name, "variants": variants})
        finally:
            tree.nodes.remove(node)
    return out


# ---------------------------------------------------------------- formatting

def _j(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def fmt_sock_list(items, pad_item, pad_close):
    if not items:
        return "[]"
    return "[\n" + ",\n".join(pad_item + _j(s) for s in items) + "\n" + pad_close + "]"


def fmt_sockets(socks):
    return '{"inputs":%s,"outputs":%s}' % (
        fmt_sock_list(socks["inputs"], "      ", "    "),
        fmt_sock_list(socks["outputs"], "      ", "    "),
    )


def fmt_props(prop_map):
    parts = []
    for name, rec in prop_map.items():
        items = rec.get("enum_items")
        if not items:
            parts.append(_j(name) + ":" + _j(rec))
            continue
        body = ",\n".join("        " + _j(it) for it in items)
        head = dict(rec)
        head.pop("enum_items")
        text = _j(head)
        text = text[:-1] + ',"enum_items":[\n' + body + "\n      ]}"
        parts.append(_j(name) + ":" + text)
    return "{" + ",".join(parts) + "}"


def fmt_dynamic(entries):
    if not entries:
        return "[]"
    blocks = []
    for entry in entries:
        var_parts = []
        for var in entry["variants"]:
            ins = fmt_sock_list(var["inputs"], "            ", "          ")
            outs = fmt_sock_list(var["outputs"], "            ", "          ")
            var_parts.append(
                '{"value":%s,"inputs":%s,"outputs":%s}'
                % (_j(var["value"]), ins, outs)
            )
        blocks.append(
            '{"property":%s,"variants":[\n        %s\n      ]}'
            % (_j(entry["property"]), ",\n        ".join(var_parts))
        )
    return "[\n    " + ",\n    ".join(blocks) + "\n  ]"


def fmt_supports(values):
    return '[\n' + ",\n".join("    " + json.dumps(v, ensure_ascii=False) for v in values) + "\n  ]"


def render(doc):
    out = ['{"idname":%s,"found":true,"blender":%s,"identity":%s,'
           % (_j(doc["idname"]), _j(doc["blender"]), _j(doc["identity"]))]
    out.append('"runtime_sockets":%s,' % fmt_sockets(doc["runtime_sockets"]))
    out.append('"runtime_properties":%s,' % fmt_props(doc["runtime_properties"]))
    out.append('"dynamic":%s' % fmt_dynamic(doc["dynamic"]))
    if "supports" in doc:
        out.append(',"supports":%s' % fmt_supports(doc["supports"]))
        out.append(',"supports_note":%s' % _j(doc["supports_note"]))
    out.append("}")
    return "".join(out)


# ---------------------------------------------------------------- main

def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out)
    pre_dir = os.path.join(out_dir, "prebuilt_node")
    os.makedirs(pre_dir, exist_ok=True)

    candidates, nclass, supports = scan_source(args.src)
    print("candidates:", len(candidates))

    import bpy  # noqa: E402  (只在 Blender 里可用)

    tree = bpy.data.node_groups.new("__build_prebuilt", "GeometryNodeTree")
    labels = {}
    written = 0
    skipped = []

    for idname in sorted(candidates):
        try:
            node = tree.nodes.new(idname)
        except Exception as e:
            skipped.append((idname, str(e).splitlines()[0]))
            continue

        try:
            prop_map = props(node)
            doc = {
                "idname": idname,
                "blender": bpy.app.version_string,
                "identity": {
                    "category": CATEGORY.get(idname.split("Node")[0] + "Node", ""),
                    "nclass": nclass.get(idname, ""),
                    "description": node.bl_rna.description or "",
                    "created_in_tree": "GeometryNodeTree",
                },
                "runtime_sockets": sockets(node),
                "runtime_properties": prop_map,
                "dynamic": dynamic(tree, idname, list(prop_map.keys())),
            }
            if idname.startswith("GeometryNode"):
                sups = supports.get(idname)
                if sups:
                    names = sorted(SUPPORT_NAME[x] for x in sups)
                    doc["supports"] = names
                    doc["supports_note"] = "仅支持: " + "/".join(SUPPORT_ZH[x] for x in names)
                else:
                    doc["supports"] = list(ALL_TYPES)
                    doc["supports_note"] = "全部几何类型(默认)"
            labels[idname] = node.bl_label

            with open(os.path.join(pre_dir, idname + ".json"), "w",
                      encoding="utf-8", newline="\r\n") as f:
                f.write(render(doc))
            written += 1
        finally:
            tree.nodes.remove(node)

    # search index：所有已有 prebuilt 文件；新生成的用 UI 名称，旧的沿用旧索引
    old_index = {}
    old_index_path = os.path.join(out_dir, "search_index.json")
    if os.path.exists(old_index_path):
        try:
            old_index = json.load(open(old_index_path, encoding="utf-8"))
        except Exception:
            old_index = {}

    index = {}
    for name in sorted(os.listdir(pre_dir)):
        if not name.endswith(".json"):
            continue
        idname = name[:-5]
        index[idname] = labels.get(idname) or old_index.get(idname) or idname

    with open(old_index_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(_j(index))

    print("written:", written)
    print("search_index:", len(index))
    if skipped:
        print("skipped:", skipped)


if __name__ == "__main__":
    main()
