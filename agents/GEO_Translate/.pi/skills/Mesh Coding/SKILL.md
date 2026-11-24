---
name: geometry-nodes-translate
description: 当用户给出具体的数学或视觉建模描述，需要写成可运行、一步接一步的 trimesh/numpy 处理链时加载。
---

# 几何节点式代码风格

代码要写成一条从上到下的链：先声明链（谁接谁、什么类型进什么类型出），再填节点（函数体）。

## 一、契约（四条硬规则）

1. 一个模块 = 一个顶层 `def`：`def` 天生有名字、有入口、有出口、能单独调用，是模块该有的全部特征。它和几何节点里的节点组是同一件东西：名字是组名，参数是输入口，`return` 是输出口，函数体是组内节点，链路段按顺序的调用就是图上的连线。

`def` 只是外壳，不是判据。判据是：**这个 def 说不说得清它接住什么、交出什么。**
- 说不清 → 塞回调用它的那个函数里
- 两个 def 之间插不进任何东西 → 并成一个
- 名字用动词短语，读出来就是那句话的谓语：`seed_inside` 读作"在里面撒种子"，`cut_cells` 读作"切成块"

不用 `class`：模块之间顺流而下，一旦存了状态，这些函数就不能再单独喂一份假数据去试。每个模块必须能单独跑通。
2. 函数头固定三行：接住 / 交出 / 只管。**：写**交接契约**：类型 + 形状 + 单位/轴。几何节点的连线带类型，文字版也必须带。函数体第一句就把数学量写成变量。
3. 模块之间禁止互相调用。链路是线性的；真有分支，就在链路块里画出来，不能藏在函数体里。
4. 只读输入，失败即断链。
- 要改就在副本上改，不原地修改传进来的对象
- 参数不合法、结果为空，就在那一步抛异常并说清原因；禁止返回 `None` 或空壳。

## 二、链路声明格式

文件最上方（docstring 或注释）放一个链路块。箭头是连线，冒号后面是 socket 类型：

```python
# 链路（唯一顺序；模块之间不许互相调用）
#   butter : Trimesh（封闭、水密、单位 m、Z 向上）
#     │ seed_inside(n=40)
#     ▼
#   seeds  : ndarray (40,3)
#     │ cut_cells()
#     ▼
#   cells  : list[Trimesh] × 40（各自独立、封闭）
#     │ push_apart(t=1.0)
#     ▼
#   parts  : list[Trimesh]
```

要求：每个交接都在这里出现且只出现一次；类型和形状必须写清；有分支就画出来。**AI 先把这块填出来，再补函数实现**。


## 三、完整示例：黄油切开（按照这个模板来写）

```python
"""
黄油切开。三个模块，一条链。

链路（唯一顺序；模块之间不许互相调用）
  butter : Trimesh（封闭、水密、单位 m、Z 向上）
    │ seed_inside(n=40)
    ▼
  seeds  : ndarray (40,3)，网格内部的世界坐标
    │ cut_cells()
    ▼
  cells  : list[Trimesh] × 40，各自独立、封闭
    │ push_apart(seeds, epsilon, t)
    ▼
  parts  : list[Trimesh] × 40，沿种子方向错开，形状不变
"""

import numpy as np
import trimesh
from scipy.spatial import cKDTree, Delaunay

# 每个模块交出的状态，按链路顺序；mesh_probe 靠它逐段导出
STAGES = ("seeds", "cells", "parts")

# viewer / mesh_probe 共用这一张参数表；default 必须能直接 build 成功
SCHEMA = {
    "n":   {"type": "int",   "min": 8,     "max": 48,    "default": 24},
    "eps": {"type": "float", "min": 0.0,   "max": 0.008, "default": 0.003},
    "t":   {"type": "float", "min": 0.0,   "max": 2.0,   "default": 1.0},
}

# ============================================================
# 模块一：撒种子
#
# 接住：trimesh.Trimesh，1 个，封闭水密，单位 m，Z 向上
# 交出：np.ndarray，形状 (N,3)，网格内部的世界坐标，N ≤ n
# 只管：点在哪。点定了块就定了，切的事留给下一块。
# ============================================================
def seed_inside(mesh, n=40, r_min=None, rng_seed=0):
    rng = np.random.default_rng(rng_seed)
    lo, hi = mesh.bounds
    center = 0.5 * (lo + hi)
    half = 0.5 * (hi - lo)

    # 体积换成密度：平均一颗点占这么大的地方，间距按它的 0.6 倍
    if r_min is None:
        r_min = 0.6 * (mesh.volume / n) ** (1.0 / 3.0)

    kept = np.empty((0, 3))
    for _ in range(64):
        batch = rng.uniform(lo, hi, size=(n * 8, 3))
        # 盒子轴对齐：包围盒判内外，等价于 mesh.contains，且不依赖 rtree
        batch = batch[np.all(np.abs(batch - center) <= half, axis=1)]
        for p in batch:
            if len(kept) == 0:
                kept = np.vstack([kept, p])
                continue
            d, _ = cKDTree(kept).query(p, k=1)
            if d >= r_min:                           # 靠太近的丢掉，近似泊松盘
                kept = np.vstack([kept, p])
        if len(kept) >= n:
            return kept[:n]

    raise RuntimeError(f"只撒出 {len(kept)} 颗，密度再放宽一些")

# ============================================================
# 模块二：切块
#
# 接住：trimesh.Trimesh（同一个网格）+ ndarray (N,3) 种子坐标
# 交出：list[trimesh.Trimesh]，N 块，每块只含一颗种子，断面封口
# 只管：怎么分。不碰位置，不碰材质，不改输入网格。
#
# 对第 i 块，只跟 Delaunay 邻居切——再远的种子，它的切面碰不到这块。
# 每刀是两颗种子连线的垂直平分面，保留离 s_i 近的那一侧。
# 这里不用布尔：切平面自带封口，布尔逐次累加会攒误差、出非流形。
# ============================================================
def cut_cells(mesh, seeds):
    seeds = np.asarray(seeds)
    tri = Delaunay(seeds)

    neighbors = [set() for _ in range(len(seeds))]
    for simplex in tri.simplices:
        for a in simplex:
            neighbors[a].update(b for b in simplex if b != a)

    cells = []
    for i in range(len(seeds)):
        piece = mesh.copy()
        for j in sorted(neighbors[i]):
            n = seeds[i] - seeds[j]                          # 法线指向 s_i
            n /= np.linalg.norm(n)
            origin = 0.5 * (seeds[i] + seeds[j])
            piece = piece.slice_plane(origin, n, cap=True)   # 保留 +n 侧，即 s_i 侧
            if piece is None or piece.is_empty:
                break
        if piece is not None and not piece.is_empty:
            piece.metadata["cell_id"] = i
            cells.append(piece)

    return cells

# ============================================================
# 模块三：撑开一道缝
#
# 接住：list[trimesh.Trimesh]，N 块（各自封闭）+ ndarray (N,3) 种子坐标
# 交出：list[trimesh.Trimesh]，N 块，各自沿「种子相对中心」方向错开
# 只管：位置。形状一个顶点都不动，输入块只读。
#
# 方向不用面积加权法线：封闭网格的面积加权法线求和恒为零向量，推不动。
# 改用种子相对全体种子的平均位置——每块各走各的方向，缝就露出来了。
# 时间是闭式回弹 1 - e^(-λt)·cos(ωt)，不是弹簧模拟，所以每帧结果固定。
# ============================================================
def push_apart(cells, seeds, epsilon=0.0015, t=0.0, lam=4.0, omega=10.0):
    seeds = np.asarray(seeds)
    center = seeds.mean(axis=0)
    scale = 1.0 - np.exp(-lam * t) * np.cos(omega * t)

    moved = []
    for cell in cells:
        direction = seeds[cell.metadata["cell_id"]] - center

        norm = np.linalg.norm(direction)
        if norm < 1e-12:
            moved.append(cell.copy())
            continue

        direction /= norm
        out = cell.copy()
        out.apply_translation(epsilon * scale * direction)
        moved.append(out)

    return moved

# ============================================================
# 总装：唯一入口。stage=None 跑完整链；给段名就累计跑到那段并返回
# ============================================================
def build(n=24, eps=0.003, t=1.0, stage=None):
    if stage is not None and stage not in STAGES:
        raise ValueError(f"stage 必须是 {STAGES} 之一，收到 {stage!r}")

    butter = trimesh.creation.box(extents=(0.12, 0.06, 0.04))
    seeds = seed_inside(butter, n=n)
    if stage == "seeds":
        return seeds
    cells = cut_cells(butter, seeds)
    if stage == "cells":
        return cells
    return push_apart(cells, seeds, epsilon=eps, t=t)


if __name__ == "__main__":
    trimesh.Scene(build()).show()
```

## 四、分段导出

`STAGES` + `build(stage=...)` 就是探针接口，写完不用再加导出函数。调用 `mesh_probe`：

- 给 `script` 和 `params`（直接写具体值，如 `{"n":24,"eps":0.003,"t":1.0}`，可以同时给多个变量）
- 工具按 `STAGES` 从原料累计跑到每一段，导出到 `<工作区>/<脚本名>/stage1.json`、`stage2.json`……
- `stage=k` 是累计状态：`stage="cells"` = 跑完模块一、二，不是单独跑模块二

每份 JSON 里有当时的参数、返回类型（`mesh` / `pointcloud` / `mesh_list`）和 meshkit 摘要，拟合和排查都以这些边界数据为准。

## 五、自检清单

交稿前逐条过：

- [ ] `def` 数 = 链路块里的步数
- [ ] 每个交接都在链路块出现且只出现一次，写明类型、形状、单位/轴
- [ ] 模块之间没有互调；顺序只出现在链路段
- [ ] 没有 `class`、没有全局状态、没有隐藏参数
- [ ] 每个模块能单独喂一份假数据跑通
- [ ] 模块只读输入，不原地修改
- [ ] 非法输入、空结果在当步抛异常，没有 `None` 往下传
- [ ] 函数名是动词短语，能读成一句话的谓语
- [ ] 文件里有 `STAGES`，顺序与链路块一致
- [ ] `build(**params, stage=None)` 在每段提前返回；`stage` 是累计状态，不是单独跑某段
- [ ] 每段返回 `Trimesh` / `ndarray (N,3)` / `PointCloud` / `list[Trimesh]`，`mesh_probe` 能识别
