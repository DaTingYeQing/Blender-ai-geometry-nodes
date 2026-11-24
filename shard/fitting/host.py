# -*- coding: utf-8 -*-
"""fitting.host —— 常驻 Blender 底座的在 Blender 内那一端。

定位方式：object → modifier（几何节点修改器）→ node_group 里的具体节点。
每轮求值：写入节点输入 → 刷新 → 把目标节点输出处的几何导出成 PLY。
输出只认网格（mesh）；点云/曲线/体积不参与拟合。

导出逻辑在 meshkit.blender_export，与 meshkit 共用同一份实现。
"""

from __future__ import annotations

import json
import math
import os
import sys
import traceback

PROTOCOL_PREFIX = "@@FIT@@"


# ------------------------------------------------------------------ 协议


def _reply(payload):
    text = json.dumps(payload, ensure_ascii=False)
    sys.stdout.buffer.write((PROTOCOL_PREFIX + " " + text + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


# ------------------------------------------------------------------ 初始化


def _load_config():
    path = os.environ.get("FIT_HOST_CONFIG", "").strip()
    if not path:
        raise RuntimeError("缺少 FIT_HOST_CONFIG 环境变量")
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _add_fitting_root():
    root = os.environ.get("FIT_FITTING_ROOT", "").strip()
    if root and root not in sys.path:
        sys.path.insert(0, root)


class _Target:
    __slots__ = ("object", "modifier", "node", "nodes")

    def __init__(self, obj, mod, node, nodes):
        self.object = obj
        self.modifier = mod
        self.node = node
        self.nodes = nodes


def _resolve_target(bpy, config):
    object_name = str(config.get("object") or "").strip()
    modifier_name = str(config.get("modifier") or "").strip()
    node_name = str(config.get("node") or "").strip()
    if not object_name:
        raise ValueError("配置缺少 object")
    if not modifier_name:
        raise ValueError("配置缺少 modifier")
    if not node_name:
        raise ValueError("配置缺少 node")
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        raise KeyError("场景里没有物体 %r" % object_name)
    mod = obj.modifiers.get(modifier_name)
    if mod is None:
        raise KeyError("物体 %r 上没有修改器 %r" % (object_name, modifier_name))
    if getattr(mod, "type", "") != "NODES" or mod.node_group is None:
        raise TypeError("修改器 %r 不是几何节点修改器或没有节点组" % modifier_name)
    node = mod.node_group.nodes.get(node_name)
    if node is None:
        names = ", ".join(sorted(item.name for item in mod.node_group.nodes))
        raise KeyError("节点组里没有节点 %r（可用：%s）" % (node_name, names or "空"))

    # 目标节点 + 配置里涉及的其它输入节点（都必须在这个节点组里）
    nodes = {node.name: node}
    for raw_name in config.get("input_nodes") or []:
        name = str(raw_name).strip()
        if not name or name in nodes:
            continue
        extra = mod.node_group.nodes.get(name)
        if extra is None:
            names = ", ".join(sorted(item.name for item in mod.node_group.nodes))
            raise KeyError(
                "节点组里没有输入节点 %r（可用：%s）" % (name, names or "空")
            )
        nodes[name] = extra
    return _Target(obj, mod, node, nodes)


# ------------------------------------------------------------------ socket 描述


def _jsonable(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    try:
        seq = list(value)
    except TypeError:
        return None
    if seq and all(isinstance(item, (int, float)) for item in seq):
        return [float(item) for item in seq]
    return None


def _socket_entry(socket):
    entry = {
        "name": socket.name,
        "label": socket.name,
        "identifier": socket.identifier or socket.name,
        "socket_type": socket.bl_idname,
        "linked": bool(getattr(socket, "is_linked", False)),
    }
    default = _jsonable(getattr(socket, "default_value", None))
    if default is not None:
        entry["default"] = default
    for source, target in (("min_value", "min"), ("max_value", "max")):
        bound = getattr(socket, source, None)
        if (
            isinstance(bound, (int, float))
            and math.isfinite(float(bound))
            and abs(bound) < 1e30
        ):
            entry[target] = bound
    return entry


def _entries(sockets):
    return [_socket_entry(socket) for socket in sockets]


def _find_socket(sockets, identifier):
    socket = sockets.get(identifier)
    if socket is not None:
        return socket
    for item in sockets:
        if item.identifier == identifier or item.name == identifier:
            return item
    return None


# ------------------------------------------------------------------ 求值


def _refresh(bpy):
    # 改 socket 默认值不会给 depsgraph 打脏标记，必须补 tag 后再 update。
    for obj in bpy.data.objects:
        try:
            obj.update_tag(refresh={"DATA"})
        except Exception:
            pass
    bpy.context.view_layer.update()


def _apply(bpy, target, params):
    if isinstance(params, dict):
        entries = [
            (target.node, identifier, packed)
            for identifier, packed in params.items()
        ]
    elif isinstance(params, list):
        entries = []
        for item in params:
            if not isinstance(item, dict):
                raise TypeError("多节点 params 每项需要是 {node, identifier, value}")
            node_name = str(item.get("node") or target.node.name).strip()
            node = target.nodes.get(node_name)
            if node is None:
                names = ", ".join(sorted(target.nodes))
                raise KeyError(
                    "本次会话里没有输入节点 %r（可用：%s）" % (node_name, names)
                )
            identifier = str(item.get("identifier") or "").strip()
            if not identifier:
                raise ValueError("多节点 params 每项需要 identifier")
            entries.append((node, identifier, item.get("value")))
    else:
        raise TypeError("params 需要是 {identifier: 打包值} 或 [{node, identifier, value}, ...]")

    from fitting.translator import packed_to_native

    for node, identifier, packed in entries:
        socket = _find_socket(node.inputs, identifier)
        if socket is None:
            raise KeyError("节点 %r 没有输入 %r" % (node.name, identifier))
        if getattr(socket, "is_linked", False):
            raise ValueError(
                "节点 %r 的输入 %r 已连线，写默认值不会生效" % (node.name, identifier)
            )
        if not hasattr(socket, "default_value"):
            raise TypeError(
                "节点 %r 的输入 %r（%s）没有 default_value，不能写入"
                % (node.name, identifier, socket.bl_idname)
            )
        socket.default_value = packed_to_native(packed)


def _evaluate(bpy, target, params, mesh_path):
    from meshkit.blender_export import export_geometry

    if not mesh_path:
        raise ValueError("求值请求缺少 mesh_path")
    _apply(bpy, target, params)
    _refresh(bpy)

    info = export_geometry(
        target.object, target.modifier.node_group, target.node, mesh_path
    )
    if "mesh" not in info["components"]:
        raise RuntimeError(
            "只支持 mesh 输出；节点 %r 的求值结果是 %s"
            % (target.node.name, info["components"])
        )
    return {
        "mesh": info["files"]["mesh"],
        "n_vertices": info["n_vertices"],
        "n_faces": info["n_faces"],
        "skipped": info["skipped"],
    }


# ------------------------------------------------------------------ 主循环


def _handle(bpy, target, request):
    op = request.get("op")
    if op == "ping":
        return {"blender": bpy.app.version_string, "python": sys.version.split()[0]}
    if op == "schema":
        return {
            "node": target.node.name,
            "inputs": _entries(target.node.inputs),
            "outputs": _entries(target.node.outputs),
            "nodes": {
                name: {"inputs": _entries(node.inputs)}
                for name, node in target.nodes.items()
            },
        }
    if op == "inputs":
        return {"inputs": _entries(target.node.inputs)}
    if op == "eval":
        return _evaluate(
            bpy, target, request.get("params") or {}, request.get("mesh_path")
        )
    if op == "bye":
        return {}
    raise ValueError("未知的 op：%r" % (op,))


def main():
    _add_fitting_root()
    import bpy

    try:
        config = _load_config()
        target = _resolve_target(bpy, config)
        frame = config.get("frame")
        if frame is not None:
            from meshkit.blender_export import advance_to_frame

            advance_to_frame(int(frame))
    except BaseException as exc:
        _reply({
            "op": "ready",
            "ok": False,
            "error": "%s: %s" % (type(exc).__name__, exc),
            "traceback": traceback.format_exc(),
        })
        return 2

    _reply({
        "op": "ready",
        "ok": True,
        "result": {
            "blender": bpy.app.version_string,
            "python": sys.version.split()[0],
            "object": target.object.name,
            "modifier": target.modifier.name,
            "node": target.node.name,
        },
    })

    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = _handle(bpy, target, request)
            _reply({"id": request_id, "ok": True, "result": result})
            if request.get("op") == "bye":
                break
        except BaseException as exc:
            _reply({
                "id": request_id,
                "ok": False,
                "error": "%s: %s" % (type(exc).__name__, exc),
                "traceback": traceback.format_exc(),
            })
    return 0


if __name__ == "__main__":
    sys.exit(main())
