"""Recipe 编译器：把 AI 填的 recipe 自动生成隔间代码，追加到 room.py。"""
import os
import re
import textwrap
from . import _paths

# 当前文件在 data_groups/ 下，room.py 也在同一目录
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOM_FILE = os.path.join(_HERE, "room.py")

# 插入锚点
_INSERT_MARKER = "    # === (后续加新隔间直接在这里加) ==="

# 隔间模板
_TEMPLATE = """    # === 小隔间{idx}: {name} ===
{var_lines}
    if any(x is not None for x in [{b_list}, {m_list}]):
        b = [{b_list}]
        m = [{m_list}]
        results["{name}"] = {compute}

"""


def _resolve_paths(path_keys):
    """把 key 名翻译成实际路径地址。"""
    resolved = []
    for key in path_keys:
        p = _paths.DIGEST.get(key) or _paths.ATTR.get(key)
        if p is None:
            raise KeyError(f"路径 key  '{key}' 未在 _paths.py 中注册")
        resolved.append(p)
    return resolved


def _find_next_index(content):
    """扫描已有隔间编号，返回下一个。"""
    indices = re.findall(r"小隔间(\d+)", content)
    if indices:
        return max(int(i) for i in indices) + 1
    return 1


def _format_compute(compute):
    """处理多行 compute 表达式的续行缩进（统一缩进 8 空格）。"""
    if "\n" not in compute:
        return compute
    lines = compute.split("\n")
    indent = "        "
    return lines[0] + "\n" + "\n".join(indent + l for l in lines[1:])


def _generate_compartment(name, path_keys, compute_expr, idx):
    """生成一个隔间的完整代码块。"""
    actual_paths = _resolve_paths(path_keys)
    var_lines = []
    b_names = []
    m_names = []
    for i, (key, ap) in enumerate(zip(path_keys, actual_paths)):
        vb = f"base_d{i}"
        vm = f"mod_d{i}"
        b_names.append(vb)
        m_names.append(vm)
        var_lines.append(f"    {vb} = walk_path(transfer_baseline, \"{ap}\")")
        var_lines.append(f"    {vm} = walk_path(transfer_modified, \"{ap}\")")

    b_list = ", ".join(b_names)
    m_list = ", ".join(m_names)

    return _TEMPLATE.format(
        idx=idx,
        name=name,
        var_lines="\n".join(var_lines),
        b_list=b_list,
        m_list=m_list,
        compute=_format_compute(compute_expr),
    )


def apply(recipe):
    """把 recipe 写入 room.py。

    recipe: {"隔间名": {"paths": [...], "compute": "..."}, ...}
    """
    with open(_ROOM_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if _INSERT_MARKER not in content:
        raise RuntimeError(f"room.py 中找不到插入锚点 {_INSERT_MARKER}")

    idx = _find_next_index(content)
    blocks = []
    for name, spec in recipe.items():
        blocks.append(_generate_compartment(name, spec["paths"], spec["compute"], idx))
        idx += 1

    # 在锚点前插入
    new_content = content.replace(_INSERT_MARKER, "".join(blocks) + _INSERT_MARKER)

    with open(_ROOM_FILE, "w", encoding="utf-8") as f:
        f.write(new_content)

    return f"已添加 {len(recipe)} 个隔间到 {_ROOM_FILE}"