---
name: geometry-nodes-viewer
description: 当完成了第一步的程序化网格后，加载它来纠正代码让它真正可视化从而让用户验收。
---


# 网格代码规则（交互调参用）

适用于：AI 用 trimesh / numpy / pyvista 等直接生成网格，由交互窗口把参数做成滑块，拖动时实时重建。

viewer 的用法固定：`import` 模块 → 读 `SCHEMA` 生成控件 → 每次拖动调 `build(**params)` → 把返回的网格换上去。

## 规则 1：参数空间要声明

模块级 `SCHEMA`，纯数据、JSON 可序列化。viewer 靠它自动生成控件；`default` 必须能直接 build 成功，打开窗口的第一帧就靠它。

```python
SCHEMA = {
    "radius": {"type": "float", "min": 0.2, "max": 2.0, "default": 1.0},
    "height": {"type": "float", "min": 0.2, "max": 3.0, "default": 1.0},
    "sides":  {"type": "int",   "min": 3,   "max": 64,  "default": 6},
}
```

支持的类型和 fitting 卡片一致：`float` / `int` / `bool` / `choices` / `vector` / `color`。
`choices` 写 `{"type": "choices", "choices": ["a", "b"], "default": "a"}`。

## 规则 2：入口是 build(**params, stage=None) + STAGES

`STAGES` 按链路顺序列出每个模块**交出的状态**。`stage=k` 表示从头累计跑到第 k 段结束，返回该段交出的东西（也是下一段的输入），不是把第 k 段单独拿出来跑。

- 参数进、状态出；参数名和 `SCHEMA` 的 key 一一对应，值就是具体数字 / 布尔 / 数组
- 只收 JSON 能表达的基础类型，不收回调、对象、文件句柄
- 不碰全局状态，不读写文件、不联网、不弹窗（`pl.show()` / `plt.show()` 留给 viewer）
- 确定性：有随机就做成 `seed` 参数暴露出来，不要拿系统时间当种子
- 参数不合法就抛异常并说清哪个值不行；不要静默返回 `None`

```python
import trimesh

STAGES = ("seeds", "cells", "parts")

def build(n=24, eps=0.003, t=1.0, stage=None):
    if stage is not None and stage not in STAGES:
        raise ValueError(f"stage 必须是 {STAGES} 之一，收到 {stage!r}")

    butter = trimesh.creation.box(extents=(0.12, 0.06, 0.04))
    seeds = seed_inside(butter, n=n)
    if stage == "seeds":
        return seeds                        # 点云 ndarray (N,3)
    cells = cut_cells(butter, seeds)
    if stage == "cells":
        return cells                        # list[trimesh.Trimesh]
    return push_apart(cells, seeds, epsilon=eps, t=t)
```

- `STAGES` 第 1 项 = 模块一交出的状态，第 2 项 = 模块二……顺序必须和 `build` 里的 `if stage == ...` 一致
- `stage=None`：完整链，viewer 用
- `stage="cells"`：跑完模块一、二，返回 `cells`
- 每段返回 `trimesh.Trimesh`、`ndarray (N,3)`、`trimesh.PointCloud` 或 `list[trimesh.Trimesh]`，viewer 按类型决定怎么画

显示、相机、刷新全部由 viewer 负责，模型代码不感知。调用 `mesh_view`（只给脚本路径）就会打开窗口，窗口是独立进程，关掉才退出。`seed_inside / cut_cells / push_apart` 的完整实现见 `agents/GEO_Translate/.pi/skills/SKILL.md` 的三段式示例。

## 规则 3：每次全量重建

- 拖滑块 = 从头调一次 `build`，不写增量更新（"只改哪几个顶点"）或结果缓存
- 小模型 rebuild 是毫秒级，全量重建最快也最不容易错；真慢了先降面数，不是加缓存

```
滑块变化 → build(新参数) → 新网格 → viewer 换数据（相机不动）
```

## 反例

```python
WIDTH = 1.0                      # 参数藏在全局变量：viewer 读不到也设不了

def build():
    global WIDTH
    mesh = trimesh.creation.box([WIDTH, 1, 1])
    scene = trimesh.Scene(mesh)
    scene.show()                 # 自己弹窗、阻塞事件循环
    return None                  # viewer 拿到 None，没法显示
```
