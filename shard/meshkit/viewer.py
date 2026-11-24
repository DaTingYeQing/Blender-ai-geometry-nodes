# -*- coding: utf-8 -*-
"""meshkit.viewer —— 交互预览：读脚本 SCHEMA 生成控件，拖参数全量重建。

用法（cwd 在 shard/）：
    python -m meshkit.viewer <payload.json>

payload：
    {"script": "...", "params": {...}, "stage": "parts" | null, "log_path": "..."}
    params 是初始值（省略用 SCHEMA 的 default）；stage 省略 = 完整链

窗口由 pyvista(VTK) 负责：控件只改参数，重建仍走 build(**params, stage=...)，
相机在重建前后保持不变。启动失败时把 traceback 写进 log_path。
"""

from __future__ import annotations

import json
import os
import sys
import traceback

import numpy as np
import pyvista as pv
import trimesh

from .stage import ProbeError, _load_module, _read_params, _read_stages, _to_mesh

_COLORS = ("#c9d7f0", "#f0d7c9", "#cbebd3", "#f2d6e6", "#e6e0b8", "#d2d2d2")


def _to_mesh_piece(value):
    """兼容 stage 里的 _to_mesh：Trimesh 原样，PolyData 转 Trimesh。"""
    return _to_mesh(value)


def _mesh_to_poly(mesh: trimesh.Trimesh) -> pv.PolyData:
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if len(faces):
        faces = np.hstack(
            [np.full((len(faces), 1), 3, dtype=np.int64), faces]
        ).ravel()
    return pv.PolyData(np.asarray(mesh.vertices, dtype=float), faces)


def to_datasets(value):
    """把一段的状态换成 [(kind, pv 数据)]；kind 是 "mesh" 或 "points"。"""
    if isinstance(value, np.ndarray):
        points = np.asarray(value, dtype=float)
        if points.ndim != 2 or points.shape[1] != 3:
            raise ProbeError(f"ndarray 必须是 (N,3)，实际 {points.shape}")
        if len(points) == 0:
            raise ProbeError("阶段输出是空点云")
        return [("points", pv.PolyData(points))]

    if isinstance(value, trimesh.PointCloud):
        points = np.asarray(value.vertices, dtype=float)
        if len(points) == 0:
            raise ProbeError("阶段输出是空点云")
        return [("points", pv.PolyData(points))]

    if isinstance(value, (list, tuple)):
        items = list(value)
        if not items:
            raise ProbeError("阶段输出是空列表")
        out = []
        for index, item in enumerate(items):
            mesh = _to_mesh_piece(item)
            if mesh is None:
                raise ProbeError(
                    f"列表第 {index} 项是 {type(item).__name__}，不是 Trimesh/PolyData"
                )
            if mesh.is_empty:
                raise ProbeError(f"列表第 {index} 项是空网格")
            out.append(("mesh", _mesh_to_poly(mesh)))
        return out

    mesh = _to_mesh_piece(value)
    if mesh is not None:
        if mesh.is_empty:
            raise ProbeError("阶段输出是空网格")
        return [("mesh", _mesh_to_poly(mesh))]

    raise ProbeError(
        f"不认识的阶段输出类型 {type(value).__name__}；"
        "只支持 trimesh.Trimesh / ndarray (N,3) / trimesh.PointCloud / list[trimesh.Trimesh]"
    )


class Viewer:
    """一块窗口装三类东西：标题、控件、几何。控件变了就整条链重跑。"""

    def __init__(self, module, script, schema, stages, params, stage):
        self.module = module
        self.script = script
        self.schema = schema
        self.stages = stages
        self.params = dict(params)
        self.stage = stage

        self.pl = pv.Plotter(window_size=(1280, 800))
        self.pl.set_background("#1f1f1f")
        self.pl.add_axes()

        self._actors = []
        self._next_y = 0.92

    # ---------- 文字 ----------
    def _title(self) -> str:
        kind = "完整链" if self.stage is None else f"跑到 {self.stage}"
        pairs = "  ".join(f"{key}={_fmt(self.params[key])}" for key in self.schema)
        return f"{os.path.basename(self.script)} · {kind}\n{pairs}"

    def _label(self, key: str, y: float) -> None:
        self.pl.add_text(f"{key}", position=(0.02, y), font_size=10, color="#dddddd")

    # ---------- 布局 ----------
    def _next_pos(self):
        y = self._next_y
        self._next_y -= 0.07
        return y

    def _add_stage_widget(self) -> None:
        names = ["完整链", *self.stages]

        def callback(value):
            index = int(round(value))
            index = max(0, min(index, len(names) - 1))
            self.stage = None if index == 0 else self.stages[index - 1]
            self._rebuild(reset_camera=False)

        y = self._next_pos()
        self._label("stage", y + 0.03)
        self.pl.add_slider_widget(
            callback,
            rng=(0, len(names) - 1),
            value=0 if self.stage is None else self.stages.index(self.stage) + 1,
            title=" / ".join(names),
            pointa=(0.05, y),
            pointb=(0.35, y),
            style="modern",
        )

    def _add_widget(self, key: str, spec: dict) -> None:
        if not isinstance(spec, dict):
            raise ProbeError(f"SCHEMA[{key!r}] 必须是对象")
        kind = str(spec.get("type") or "float").lower()
        default = spec.get("default")
        if default is None:
            raise ProbeError(f"SCHEMA[{key!r}] 缺少 default")
        if kind in ("float", "int"):
            self._add_number(key, spec, kind, default)
        elif kind == "bool":
            self._add_bool(key, bool(default))
        elif kind == "choices":
            self._add_choices(key, spec, default)
        else:
            raise ProbeError(
                f"SCHEMA[{key!r}].type={kind!r} 不支持；"
                "可用 float / int / bool / choices"
            )

    def _add_number(self, key: str, spec: dict, kind: str, default) -> None:
        lo = float(spec.get("min", default))
        hi = float(spec.get("max", default))
        if lo > hi:
            lo, hi = hi, lo
        if lo == hi:
            lo, hi = lo - 1.0, hi + 1.0

        def callback(value):
            self.params[key] = int(round(value)) if kind == "int" else float(value)
            self._rebuild(reset_camera=False)

        y = self._next_pos()
        self._label(key, y + 0.03)
        self.pl.add_slider_widget(
            callback,
            rng=(lo, hi),
            value=float(default),
            title=f"{key} = {_fmt(default)}",
            pointa=(0.05, y),
            pointb=(0.35, y),
            style="modern",
        )

    def _add_bool(self, key: str, default: bool) -> None:
        def callback(value):
            self.params[key] = bool(round(value))
            self._rebuild(reset_camera=False)

        y = self._next_pos()
        self._label(f"{key}（0 / 1）", y + 0.03)
        self.pl.add_slider_widget(
            callback,
            rng=(0, 1),
            value=1.0 if default else 0.0,
            title=f"{key} = {'是' if default else '否'}",
            pointa=(0.05, y),
            pointb=(0.35, y),
            style="modern",
        )

    def _add_choices(self, key: str, spec: dict, default) -> None:
        options = list(spec.get("choices") or [])
        if not options:
            raise ProbeError(f"SCHEMA[{key!r}].choices 不能为空")
        if default not in options:
            raise ProbeError(f"SCHEMA[{key!r}].default 必须是 choices 之一")

        def callback(text):
            if text in options:
                self.params[key] = text
                self._rebuild(reset_camera=False)

        y = self._next_pos()
        self._label(key, y + 0.03)
        self.pl.add_text_slider_widget(
            callback,
            options,
            value=options.index(default),
            title=key,
            pointa=(0.05, y),
            pointb=(0.35, y),
            style="modern",
        )

    # ---------- 几何 ----------
    def _put_text(self, name: str, text: str, position: str, color: str) -> None:
        """同名 add_text 会就地替换，标题和报错都靠这个刷新。"""
        self.pl.add_text(
            text,
            position=position,
            font_size=11,
            color=color,
            name=name,
            render=False,
        )

    def _drop_text(self, name: str) -> None:
        try:
            self.pl.remove_actor(name, render=False)
        except Exception:
            pass

    def _show_error(self, exc: Exception) -> None:
        message = f"{type(exc).__name__}: {exc}"
        self._put_text("error", message[:400], "lower_left", "#ff6b6b")
        self.pl.render()

    def _clear_error(self) -> None:
        self._drop_text("error")

    def _rebuild(self, reset_camera: bool) -> None:
        self._put_text("title", self._title(), "upper_left", "#dddddd")

        try:
            value = self.module.build(**self.params, stage=self.stage)
            datasets = to_datasets(value)
        except Exception as exc:  # 参数越界就地报，不关窗
            self._show_error(exc)
            return

        for actor in self._actors:
            try:
                self.pl.remove_actor(actor, render=False)
            except Exception:
                pass
        self._actors.clear()

        for index, (kind, data) in enumerate(datasets):
            color = _COLORS[index % len(_COLORS)]
            if kind == "points":
                actor = self.pl.add_mesh(
                    data,
                    color="#8ab4f8",
                    point_size=8,
                    render_points_as_spheres=True,
                    render=False,
                )
            else:
                actor = self.pl.add_mesh(
                    data,
                    color=color,
                    show_edges=True,
                    edge_color="#333333",
                    smooth_shading=False,
                    render=False,
                )
            self._actors.append(actor)

        self._clear_error()
        if reset_camera:
            self.pl.reset_camera()
        self.pl.render()

    def show(self) -> None:
        self._put_text("title", self._title(), "upper_left", "#dddddd")
        self._add_stage_widget()
        for key, spec in self.schema.items():
            self._add_widget(key, spec)
        self._rebuild(reset_camera=True)
        self.pl.show(title=f"mesh viewer · {os.path.basename(self.script)}")


def _fmt(value) -> str:
    if isinstance(value, float):
        if abs(value) < 1e-3 and value != 0:
            return f"{value:.4g}"
        return f"{value:.4g}"
    return str(value)


def run(payload: dict) -> None:
    script = os.path.abspath(str(payload.get("script") or "").strip())
    if not script or not os.path.isfile(script):
        raise ProbeError(f"找不到脚本：{script or '(空)'}")

    module = _load_module(script)
    schema = getattr(module, "SCHEMA", None)
    if not isinstance(schema, dict) or not schema:
        raise ProbeError("脚本缺少 SCHEMA：参数表和 build 的 key 必须对应")
    stages = _read_stages(module)
    build = getattr(module, "build", None)
    if not callable(build):
        raise ProbeError("脚本缺少 build(**params, stage=None)")

    params = _read_params(module, payload.get("params") or {})

    raw_stage = payload.get("stage")
    stage = str(raw_stage).strip() if raw_stage not in (None, "") else ""
    stage = stage or None
    if stage is not None and stage not in stages:
        raise ProbeError(f"stage 必须是 {stages} 之一，收到 {stage!r}")

    Viewer(module, script, schema, stages, params, stage).show()


def main(argv) -> int:
    if len(argv) != 2:
        sys.stderr.write("ERROR: 用法 python -m meshkit.viewer <payload.json>\n")
        return 2

    payload_path = argv[1]
    log_path = ""
    try:
        with open(payload_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        log_path = str(payload.get("log_path") or "").strip()
        run(payload)
        return 0
    except BaseException as exc:
        detail = traceback.format_exc()
        if log_path:
            try:
                with open(log_path, "w", encoding="utf-8") as handle:
                    handle.write(detail)
            except OSError:
                pass
        sys.stderr.write(detail)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
