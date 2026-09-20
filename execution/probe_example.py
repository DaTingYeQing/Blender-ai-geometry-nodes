# -*- coding: utf-8 -*-
"""探针配置模板 —— 引擎 frame_probe.py 不用动，每次只改这个文件。

运行：
    python <skills/execution>/blender_channel.py <skills/execution>/frame_probe.py \
        --read=new --save=no -- <本文件路径>
"""
import numpy as np

# =========================== 填写区（改这里） ===========================
BLEND = "SimBounce_重力弹跳堆积.blend"   # 档名（相对当前目录）或绝对路径
GROUP = "M3"                             # 节点树名字
OBJECT = "SimObj"                        # 物体名；留空 = 自动找挂了 GROUP 的第一个物体
FRAMES = "1-10"                          # "1-10" 采 1..10 | "20" = 采 1..20 | "30-40" 前 29 帧自动预热
SETTINGS = []                            # 可选，声明式设值（不能写逻辑）：[{"node":"细分网格","prop":"Level","value":1}]
ARRAYS_NPZ = ""                          # 大数组落盘路径；留空 = ./evidence/probe_arrays_<时间戳>.npz


def setup(tree, obj):
    """开档后、推帧前调一次 —— 这里是【任意代码】的地方。

    想改输入值就直接写；想加/删节点、重接线、换算法、根据条件分支设值，都写在这。
    只改一个输入值的简单情形，用上面的 SETTINGS 就够了（不必写这里）。
    """
    pass

R = 0.05                                 # 球半径（只有探针用得到，引擎不关心）


def selftest():
    """仪器校准：开档前跑，用【已知答案】验证判据本身没写错。
    你不需要读引擎代码，只看这里过没过。assert 失败会立刻中止，不给假结论。"""
    def overlap(c, r=R):
        d = np.linalg.norm(c[:, None, :] - c[None, :, :], axis=-1)
        np.fill_diagonal(d, 9.9)
        dd = d[np.triu_indices(len(c), 1)]
        return int((dd < 2 * r).sum())

    assert overlap(np.array([[0.0, 0, 0], [0.0, 0, 0]])) == 1, "阳性对照失败（重合应算 1 对）"
    assert overlap(np.array([[0.0, 0, 0], [0.2, 0, 0]])) == 0, "阴性对照失败（拉开应算 0 对）"
    assert overlap(np.array([[0.0, 0, 0], [0.0999, 0, 0]])) == 1, "边界 0.0999 应算相交"
    assert overlap(np.array([[0.0, 0, 0], [0.1001, 0, 0]])) == 0, "边界 0.1001 应算不相交"


def probe(ctx):
    """每帧调一次，返回想测的东西（键名随意、值随意，引擎按形状自动编码）。"""
    c = ctx.centers()                      # 实例世界位置 (N,3)
    assert len(c) == 500, "第%d帧球数 %d ≠ 500" % (ctx.frame, len(c))       # 不变量：一破就崩
    assert c[:, 2].min() >= R - 1e-6, "第%d帧有球穿地 z=%.5f" % (ctx.frame, c[:, 2].min())

    d = np.linalg.norm(c[:, None, :] - c[None, :, :], axis=-1)
    np.fill_diagonal(d, 9.9)
    dd = d[np.triu_indices(len(c), 1)]
    hit = dd < 2 * R
    return {
        "穿插对": int(hit.sum()),
        "最小球心距": float(dd.min()),
        "z最低": float(c[:, 2].min()),
        "球心坐标": c,                      # 数组 → 自动落盘，不塞进输出
    }
# ========================= 填写区结束 =========================
