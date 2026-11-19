---
name: geometry-nodes-translate
description: 当接受到了很具体的关于blender的数学和视觉建模的文件的时候加载或者skill。
---

# 例子

## 重点：

每个模块是一个纯函数，函数头三行讲清接住什么、交出什么、只管什么，函数体第一句就把数学量写成变量。

```python
"""
黄油切开。三个模块，一步接一步。
每个模块先说清接住什么、交出什么，再写怎么算。
"""

import numpy as np
import trimesh
from scipy.spatial import cKDTree, Delaunay

# ============================================================
# 模块一：撒种子
#
# 接住：一个封闭网格，1 块。
# 交出：N 个点，埋在网格内部，彼此不挤。
# 只管：点在哪。点定了，块就定了，切的事留给下一个模块。
# ============================================================
def seed_inside(mesh, n=40, r_min=None, rng_seed=0):
    rng = np.random.default_rng(rng_seed)
    lo, hi = mesh.bounds

    # 体积换成密度：平均一颗点占这么大的地方，间距按它的 0.6 倍
    if r_min is None:
        r_min = 0.6 * (mesh.volume / n) ** (1.0 / 3.0)

    kept = np.empty((0, 3))
    for _ in range(64):
        batch = rng.uniform(lo, hi, size=(n * 8, 3))
        batch = batch[mesh.contains(batch)]          # 只留埋在里面的
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
# 接住：一个网格，加上模块一交出的 N 个点。
# 交出：N 块，每块里只有一颗种子，断面是平的。
# 只管：怎么分。不碰位置，不碰材质。
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
            n = seeds[j] - seeds[i]
            n /= np.linalg.norm(n)
            origin = 0.5 * (seeds[i] + seeds[j])
            piece = piece.slice_plane(origin, n, cap=True)   # 保留 -n 侧，即 s_i 侧
            if piece is None or piece.is_empty:
                break
        if piece is not None and not piece.is_empty:
            piece.metadata["cell_id"] = i
            cells.append(piece)

    return cells

# ============================================================
# 模块三：撑开一道缝
#
# 接住：N 块。
# 交出：N 块，各自沿断面挪一点，缝露出来，但不散开。
# 只管：位置。形状一个顶点都不动。
#
# 方向是面积加权的面法线求和——大面说话更算数。
# 时间是闭式回弹 1 - e^(-λt)·cos(ωt)，不是弹簧模拟，所以每帧结果固定。
# ============================================================
def push_apart(cells, epsilon=0.0015, t=0.0, lam=4.0, omega=10.0):
    moved = []
    for cell in cells:
        weighted = cell.area_faces[:, None] * cell.face_normals
        direction = weighted.sum(axis=0)

        norm = np.linalg.norm(direction)
        if norm < 1e-12:
            moved.append(cell.copy())
            continue

        direction /= norm
        scale = 1.0 - np.exp(-lam * t) * np.cos(omega * t)

        out = cell.copy()
        out.apply_translation(epsilon * scale * direction)
        moved.append(out)

    return moved

if __name__ == "__main__":
    butter = trimesh.creation.box(extents=(0.12, 0.06, 0.04))
    seeds = seed_inside(butter, n=40)      # 1 块 -> N 个点
    cells = cut_cells(butter, seeds)       # N 个点 -> N 块
    shown = push_apart(cells, t=1.0)       # N 块 -> N 块错开

    trimesh.Scene(shown).show()
```

**函数头三行固定**：接住、交出、只管。第四行永远不出现，因为“不管”是默认的。读到第三行，就知道这块的边界在哪。
```markdown
## 模块就是 def
一条规则：一个模块 = 一个顶层 `def`，没有例外。
理由很朴素：`def` 天生就有名字、有入口、有出口、能单独调用一次。这正好是模块该有的全部特征。它和几何节点里的节点组是同一件东西的两种写法——名字是组名，参数是输入口，`return` 是输出口，函数体是组内节点，`__main__` 里按顺序的调用就是图上的连线。
但 `def` 只是外壳，不是判据。判据还是那句话：**这个 def 说不说得清它接住什么、交出什么。** 
两个反面检查：一个 def 说不出它接住了什么，就把它塞回调它的那个函数里。两个 def 之间没有任何东西插得进去，就把它们并成一个。
名字用动词短语，读出来就是那句话的谓语。`seed_inside` 读作“在里面撒种子”，`cut_cells` 读作“切成块”，`push_apart` 读作“推开”。所以命名不需要查规范，能念通顺就行。
为什么是 def 不是 class：模块之间顺流而下，不共享状态。class 会诱导你存状态，一旦存了，这些函数就不能再单独喂一份假数据去试。才能保持每块能单独拿出来跑。
```
