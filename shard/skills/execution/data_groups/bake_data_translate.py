# -*- coding: utf-8 -*-
"""bake 数据翻译器（脚本1）：把烘焙落盘的 meta.json + blobs 翻译成全量 JSON。

职责：只翻译，不做筛选/对比（那是脚本2）。凡烘焙缓存里有的数据，这里一个字不漏地
读出来、转成结构化 JSON。

用法:
  python bake_data_translate.py <bake根目录>          # 输出 JSON 到 stdout
  python bake_data_translate.py <bake根目录> -o out.json

bake 根目录结构（烘焙节点 -> DISK 模式落盘后产生）:
  <根目录>/
    meta/00001_00000.json     # 地图：每一项数据的类型、在 blobs 的偏移/长度
    blobs/00001_00000.blob    # 货：属性数组的真实二进制数据

原理（对照 Blender 源码 bake_items_serialize.cc）:
  - 非几何标量（FLOAT/INT/BOOL 单值）-> 明文放在 meta.json 的 data 字段，直接读。
  - 几何属性数组（position/edge_verts/...）-> 存 blobs，按 meta 里的 type + start + size
    解析二进制。
  - 字节序 little-endian（x86 默认），无 padding，紧凑排列。
"""
import json
import os
import struct
import sys

# 类型 -> (每元素基本字节宽, struct 单元素格式符, 组大小)
# 组大小 > 1 表示向量/矩阵，输出会重组为嵌套 list（如 FLOAT_VECTOR -> [[x,y,z], ...]）。
_TYPE_INFO = {
    "INT8":         (1, "b", 1),    # int8（curve_type 等）
    "BOOLEAN":      (1, "B", 1),    # 1 字节 0/1
    "INT":          (4, "i", 1),    # int32
    "FLOAT":        (4, "f", 1),    # float32
    "INT16_2D":     (2, "h", 2),    # 2 x int16
    "BYTE_COLOR":   (1, "B", 4),    # 4 x uint8
    "FLOAT2":       (4, "f", 2),    # 2 x float32
    "INT32_2D":     (4, "i", 2),    # 2 x int32
    "FLOAT_VECTOR": (4, "f", 3),    # 3 x float32（position 等）
    "COLOR":        (4, "f", 4),    # 4 x float32
    "QUATERNION":   (4, "f", 4),    # 4 x float32（注意 Blender 存 w 在前）
    "FLOAT4X4":     (4, "f", 16),   # 16 x float32（列主序）
}


def _is_slice(v):
    """判断一个 dict 是不是指向 blobs 的切片（{name, start, size}）。"""
    return (
        isinstance(v, dict)
        and "name" in v
        and "start" in v
        and "size" in v
    )


def _read_slice(blob_dir, sl):
    """按切片从 blob 文件读出原始字节。"""
    path = os.path.join(blob_dir, sl["name"])
    with open(path, "rb") as f:
        f.seek(sl["start"])
        return f.read(sl["size"])


def _round_float(v):
    """float32 解出来后可能有 0.0799999 这种尾差，round 到 6 位消噪。"""
    return round(v, 6)


def _decode(raw, type_name):
    """按类型把原始字节解码成 Python 值列表。"""
    info = _TYPE_INFO.get(type_name)
    if info is None:
        return {"__unknown_type__": type_name, "raw_bytes": len(raw)}
    elem_w, fmt_char, group = info
    if len(raw) % elem_w != 0:
        return {"__decode_error__": type_name, "raw_bytes": len(raw)}
    total = len(raw) // elem_w
    vals = struct.unpack("<" + fmt_char * total, raw)
    if type_name == "BOOLEAN":
        vals = [bool(v) for v in vals]
    elif fmt_char == "f":
        vals = [_round_float(v) for v in vals]
    if group == 1:
        return list(vals)
    # 向量/矩阵：按组大小重组为嵌套 list
    return [list(vals[i:i + group]) for i in range(0, len(vals), group)]


def _read_int32_slice(blob_dir, sl):
    """隐含 int32 数组（如 mesh 的 poly_offsets）专用解码。"""
    raw = _read_slice(blob_dir, sl)
    n = len(raw) // 4
    return list(struct.unpack("<" + "i" * n, raw))


def _translate_attrs(attrs, blob_dir):
    """翻译一个属性数组（attributes 列表），每项有显式 type。"""
    out = []
    for a in attrs:
        name = a.get("name")
        domain = a.get("domain")
        type_name = a.get("type")
        data = a.get("data")
        if _is_slice(data):
            value = _decode(_read_slice(blob_dir, data), type_name)
        else:
            value = data
        out.append({"name": name, "domain": domain, "type": type_name, "value": value})
    return out


def _translate_component(comp, blob_dir):
    """翻译一个几何组件描述（mesh / pointcloud / curves ...）。"""
    if not isinstance(comp, dict):
        return comp
    out = {}
    for k, v in comp.items():
        if k == "attributes":
            out[k] = _translate_attrs(v, blob_dir)
        elif k == "poly_offsets" and _is_slice(v):
            # mesh 的面偏移数组：隐含 int32
            out[k] = _read_int32_slice(blob_dir, v)
        elif _is_slice(v):
            # 没有显式类型的切片（罕见），原样保留并标记
            out[k] = {"__untyped_blob__": v}
        else:
            out[k] = v
    return out


def _translate_geometry(data, blob_dir):
    """翻译 GEOMETRY 项的数据：instances 结构 + 各几何组件。"""
    if not isinstance(data, dict):
        return data
    if "instances" in data:
        inst = data["instances"]
        refs = []
        for ref in inst.get("references", []):
            new_ref = {}
            for comp_type, comp in ref.items():
                new_ref[comp_type] = _translate_component(comp, blob_dir)
            refs.append(new_ref)
        return {
            "num_instances": inst.get("num_instances"),
            "references": refs,
            "实例属性": _translate_attrs(inst.get("attributes", []), blob_dir),
        }
    # 非 instances 几何（混合组件，如 {mesh, pointcloud}/直接 mesh）：
    # 必须对每个子组件递归翻译，否则组件内部 attributes 不会被 _decode，只留
    # 原始 data(字节引用)，diff 时只剩 start/size 噪声、看不到真值。
    return {k: (_translate_component(v, blob_dir) if isinstance(v, dict) else v)
            for k, v in data.items()}


def _translate_item(item, blob_dir):
    """翻译单个烘焙项。"""
    t = item.get("type")
    name = item.get("name")
    data = item.get("data")
    if t == "GEOMETRY":
        return {"name": name, "type": t, "data": _translate_geometry(data, blob_dir)}
    if _is_slice(data):
        # 字符串等大数据存 blobs 的情况（罕见），按字节读
        return {"name": name, "type": t, "data": _read_slice(blob_dir, data).decode("utf-8", "replace")}
    # primitive 标量 / 小字符串：明文直接保留
    return {"name": name, "type": t, "value": data}


def _find_bake_files(bake_root):
    """在 bake 根目录下找 meta json 和 blobs 目录。"""
    meta_dir = os.path.join(bake_root, "meta")
    blob_dir = os.path.join(bake_root, "blobs")
    meta_files = sorted(f for f in os.listdir(meta_dir) if f.endswith(".json"))
    if not meta_files:
        raise FileNotFoundError(f"meta 目录下没有 .json: {meta_dir}")
    return os.path.join(meta_dir, meta_files[0]), blob_dir


def _translate_meta(meta, blob_dir):
    """把单个 meta dict 翻译成结构化 JSON。"""
    items = meta.get("items", {})
    return {
        "版本": meta.get("version"),
        "烘焙项": {k: _translate_item(v, blob_dir) for k, v in items.items()},
    }


def translate(bake_root):
    """入口：读 bake 目录（取第一帧），返回全量翻译结果（dict）。"""
    meta_path, blob_dir = _find_bake_files(bake_root)
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    return _translate_meta(meta, blob_dir)


def translate_all(bake_root):
    """读 bake 目录下所有帧，返回 {帧号: 翻译结果}（按帧号排序）。"""
    blob_dir = os.path.join(bake_root, "blobs")
    meta_dir = os.path.join(bake_root, "meta")
    frames = []
    for f in os.listdir(meta_dir):
        if not f.endswith(".json"):
            continue
        try:
            frame = int(f.split("_")[0])
        except ValueError:
            continue
        frames.append((frame, f))
    out = {}
    for frame, f in sorted(frames):
        with open(os.path.join(meta_dir, f), "r", encoding="utf-8") as fh:
            meta = json.load(fh)
        out[frame] = _translate_meta(meta, blob_dir)
    return out


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return
    bake_root = argv[0]
    out_path = None
    if "-o" in argv:
        out_path = argv[argv.index("-o") + 1]
    result = translate(bake_root)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"[bake_data_translate] 已写到 {out_path}")
    else:
        print(text)


if __name__ == "__main__":
    main()