# -*- coding: utf-8 -*-
"""frame_probe.py —— 「帧驱动 + 探针」后端引擎（只读，不存盘）。

分工（高内聚、低耦合）：
    本文件 = 引擎，不用动：开档 → 按帧推进 → 每帧调探针 → 汇总 → 落盘 → 打印
    配置文件 = 每次只填这个：BLEND / GROUP / OBJECT / FRAMES / probe(ctx)

用法：
    python <skills/execution>/blender_channel.py <skills/execution>/frame_probe.py \
        --read=new --save=no -- <配置文件.py>

    --read=new  引擎自己按配置里的 BLEND 开档（避免先开工作档白跑一趟）
    --save=no   纯只读，绝不写回任何 .blend

配置文件里填什么（见 skills/execution/probe_example.py 模板）：
    BLEND   str  档名（相对当前目录）或绝对路径
    GROUP   str  节点树名字
    OBJECT  str  物体名字；留空 = 自动找「挂了 GROUP 的第一个物体」
    FRAMES  str  "1-10"（采 1..10）| "20"（= 采 1..20）| "30-40"（前 29 帧自动预热，只采 30..40）
    probe(ctx)           每帧调一次 —— 这里是【任意代码】的地方
                         返回 dict → 渲染成表格（仅便利层）；返回 None → 不渲染（自己 print / 自己存盘）
                         返回其他值 → 当作单列 "结果"
    ctx.emit(name, v)    把这一帧的 v 累积进序列；结束后统一落盘 + 汇总（这才是“烘焙”）
    ctx.attrs(name)      按名字读求值几何的属性（通用按名取数）；实例化几何读不到 → None
可选：
    SETTINGS  list   跑之前给节点设值 [{"node": 名, "prop": 插口, "value": 值}]（声明式，不能写逻辑）
    setup(tree, obj) 开档后、推帧前调一次；【任意代码】：设值/加删节点/重接线都行
    selftest()       开档前调用一次（仪器校准；assert 失败立刻中止，不给假结论）
    ARRAYS_NPZ str   大数组落盘路径（默认 ./evidence/probe_arrays_<时间戳>.npz）

执行顺序：装配置 → selftest() → 开档 → 找 tree/obj → SETTINGS → setup(tree,obj) → 逐帧 probe(ctx)

ctx 提供什么（通用取数，只搬形状、不问业务含义）：
    ctx.frame     当前帧号
    ctx.dg        当前帧 depsgraph
    ctx.obj       目标物体（已求值入口）
    ctx.centers() 实例世界位置 (N,3)；没有实例时退化为网格顶点
    ctx.matrices()实例世界矩阵 (N,4,4)
    ctx.verts()   实例化合并后的世界顶点 (M,3)
    ctx.attrs(name) 按名字读取值几何的属性（如 'vel'）
    ctx.tree      节点树（可自己读写属性/节点）
    ctx.blend / ctx.group / ctx.object_name
"""
import os
import sys
import time

import bpy
import numpy as np

PREFIX = "[frame_probe]"
ARRAY_MIN = 64          # 数组元素超过这个数就落盘，不往输出里塞
COLLECT_LIMIT = 500     # 一次最多【采集】多少帧（采集才是成本：取数+落盘）
END_LIMIT = 100000      # 终点帧号上限（预热很便宜，约 0.25 ms/帧 → 1 万帧 ~3s）


# ---------------------------------------------------------------- 配置装载
def _config_path():
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1:]
        if rest:
            return os.path.abspath(rest[0])
    env = os.environ.get("BD_PROBE_CONFIG")
    if env:
        return os.path.abspath(env)
    raise SystemExit(
        "%s ERROR: 没给配置文件。用法：... frame_probe.py --read=new --save=no -- <配置文件.py>"
        % PREFIX)


def _need(ns, key, kind=str):
    if key not in ns:
        raise SystemExit("%s ERROR: 配置文件缺少 %s" % (PREFIX, key))
    v = ns[key]
    if kind and not isinstance(v, kind):
        raise SystemExit("%s ERROR: %s 应是 %s，收到 %s" % (PREFIX, key, kind.__name__, type(v).__name__))
    return v


def parse_frames(spec):
    """'1-10' → (1,10)；'20' → (1,20)；'30-40' → (30,40)。返回 (采集起, 采集止)。

    注意：返回的是【采集】区间；引擎一定会从第 1 帧开始预热到 b（模拟区有状态，
    跳帧拿不到正确数据），但只在这个区间里调探针。所以 "990-1000" 是合法的：
    预热 989 帧（约 0.25s），只采 11 帧。
    """
    s = str(spec).strip()
    try:
        if "-" in s:
            a, b = s.split("-", 1)
            a, b = int(a), int(b)
        else:
            a, b = 1, int(s)
    except ValueError:
        raise SystemExit("%s ERROR: FRAMES 格式应为 '1-10' / '20' / '30-40'，收到 %r" % (PREFIX, spec))
    if a < 1 or b < a:
        raise SystemExit("%s ERROR: FRAMES 区间不合法: %r" % (PREFIX, spec))
    if b - a + 1 > COLLECT_LIMIT:
        raise SystemExit("%s ERROR: 一次最多采集 %d 帧，这个区间要采 %d 帧（%d..%d）"
                         % (PREFIX, COLLECT_LIMIT, b - a + 1, a, b))
    if b > END_LIMIT:
        raise SystemExit("%s ERROR: 终点帧 %d 超过上限 %d" % (PREFIX, b, END_LIMIT))
    return a, b


# ---------------------------------------------------------------- 取数入口
class Ctx(object):
    def __init__(self, frame, dg, obj, tree, blend):
        self.frame = frame
        self.dg = dg
        self.obj = obj
        self.tree = tree
        self.blend = blend
        self.group = tree.name if tree is not None else None
        self.object_name = obj.name if obj is not None else None
        self._cache = None
        self.emits = {}

    def emit(self, name, value):
        """把这一帧的 value 累积进序列（同名每帧一个）。结束时引擎统一落盘 + 汇总。"""
        self.emits[name] = value

    def attrs(self, name):
        """按名字读求值几何的属性（通用按名取数，不问业务含义）。读不到返回 None。

        注意：物体输出若是“实例”，求值成 mesh 会是空的，属性读不到——
        这时要么探针改指向点云输出，要么在 setup 里插一个 Points to Vertices。
        """
        ev = self.obj.evaluated_get(self.dg)
        me = ev.to_mesh()
        try:
            a = me.attributes.get(name) if me is not None else None
            if a is None:
                return None
            cnt = {"FLOAT": 1, "INT": 1, "BOOLEAN": 1, "FLOAT_VECTOR": 3,
                   "FLOAT2": 2, "FLOAT_COLOR": 4, "INT32_2D": 2, "QUATERNION": 4}.get(a.data_type, 1)
            buf = np.empty(len(a.data) * cnt, dtype=np.float64)
            a.data.foreach_get("value", buf)
            return buf.reshape(-1, cnt) if cnt > 1 else buf
        finally:
            ev.to_mesh_clear()

    def _gather(self):
        """一次遍历立即取出世界矩阵/位置。

        注意：depsgraph 的实例引用（DepsgraphObjectInstance）只在遍历期间有效，
        存进 list 后再访问会失效——所以必须【循环内】就访问。
        """
        if self._cache is not None:
            return self._cache
        ob = self.obj
        cens, mats = [], []
        for i in self.dg.object_instances:
            if not i.is_instance:
                continue
            if i.parent is not None and i.parent.original != ob:
                continue
            m = i.matrix_world.copy()
            mats.append(np.array(m, dtype=np.float64))
            t = m.translation
            cens.append((t[0], t[1], t[2]))
        self._cache = (np.asarray(cens, dtype=np.float64).reshape(-1, 3),
                       np.asarray(mats, dtype=np.float64).reshape(-1, 4, 4))
        return self._cache

    def matrices(self):
        return self._gather()[1]

    def centers(self):
        c = self._gather()[0]
        return c if len(c) else self.verts()

    def verts(self):
        mats = self._gather()[1]
        if len(mats):
            ob = self.obj
            parts = []
            for i in self.dg.object_instances:      # 重新遍历：循环内立即用
                if not i.is_instance:
                    continue
                if i.parent is not None and i.parent.original != ob:
                    continue
                sub = i.object.to_mesh()
                n = len(sub.vertices)
                if n:
                    co = np.empty(n * 3, dtype=np.float64)
                    sub.vertices.foreach_get("co", co)
                    M = np.array(i.matrix_world)
                    parts.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
                i.object.to_mesh_clear()
            return np.concatenate(parts) if parts else np.zeros((0, 3))
        ev = self.obj.evaluated_get(self.dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        out = co.reshape(-1, 3).copy()
        ev.to_mesh_clear()
        return out


# ---------------------------------------------------------------- 编码层
def _stat(arr):
    a = np.asarray(arr, dtype=np.float64).ravel()
    if a.size == 0:
        return "空"
    return "n=%d min=%.4g max=%.4g mean=%.4g std=%.4g" % (
        a.size, np.nanmin(a), np.nanmax(a), np.nanmean(a), np.nanstd(a))


def is_scalarish(v):
    if v is None:
        return True
    if isinstance(v, (bool, int, float, str, np.bool_, np.integer, np.floating)):
        return True
    if isinstance(v, (list, tuple)) and len(v) <= 6 and all(
            isinstance(x, (bool, int, float, str, np.bool_, np.integer, np.floating)) for x in v):
        return True
    return False


def _dw(s):
    """显示宽度：中文/全角算 2，半角算 1。"""
    return sum(2 if ord(c) > 0x2E80 else 1 for c in str(s))


def pad(s, w):
    s = str(s)
    return s + " " * max(0, w - _dw(s))


def fmt(v):
    if v is None:
        return "-"
    if isinstance(v, (float, np.floating)):
        return "%.4f" % v if abs(v) < 1e6 else "%.4g" % v
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(fmt(x) for x in v) + "]"
    return str(v)


# ---------------------------------------------------------------- 主流程
def main():
    cfg_path = _config_path()
    ns = {}
    import runpy
    ns = runpy.run_path(cfg_path, run_name="__probe_config__")
    print("%s 配置: %s" % (PREFIX, cfg_path))

    blend = _need(ns, "BLEND")
    group_name = _need(ns, "GROUP")
    obj_name = ns.get("OBJECT", "") or ""
    frames_spec = _need(ns, "FRAMES")
    settings = ns.get("SETTINGS") or []
    probe = ns.get("probe")
    if probe is None:
        raise SystemExit("%s ERROR: 配置文件缺少 probe(ctx) 函数" % PREFIX)

    a, b = parse_frames(frames_spec)

    # --- 仪器校准：在碰数据之前 ---
    if callable(ns.get("selftest")):
        ns["selftest"]()
        print("%s selftest 通过（仪器已校准）" % PREFIX)

    # --- 开档 ---
    bp = blend if os.path.isabs(blend) else os.path.abspath(blend)
    if not os.path.isfile(bp):
        raise SystemExit("%s ERROR: 找不到档 %s" % (PREFIX, bp))
    bpy.ops.wm.open_mainfile(filepath=bp)

    tree = bpy.data.node_groups.get(group_name)
    if tree is None:
        raise SystemExit("%s ERROR: 档里没有节点树 %r；现有: %s"
                         % (PREFIX, group_name, list(bpy.data.node_groups.keys())))

    if obj_name:
        obj = bpy.data.objects.get(obj_name)
        if obj is None:
            raise SystemExit("%s ERROR: 档里没有物体 %r" % (PREFIX, obj_name))
    else:
        obj = None
        for ob in bpy.data.objects:
            for m in ob.modifiers:
                if m.type == "NODES" and m.node_group and m.node_group.name == group_name:
                    obj = ob
                    break
            if obj:
                break
        if obj is None:
            raise SystemExit("%s ERROR: 没有物体挂节点树 %r（请填 OBJECT）" % (PREFIX, group_name))

    for s in settings:
        sock = tree.nodes[s["node"]].inputs[s["prop"]]
        sock.default_value = s["value"]
    if settings:
        print("%s 已设值 %d 处（SETTINGS）" % (PREFIX, len(settings)))

    # --- setup：开档后、推帧前的任意代码 ---
    if callable(ns.get("setup")):
        ns["setup"](tree, obj)
        print("%s setup(tree, obj) 已执行" % PREFIX)

    print("%s blend=%s | group=%s | object=%s | 预热 %d 帧，采集 %d..%d"
          % (PREFIX, os.path.basename(bp), group_name, obj.name, a - 1, a, b))

    # --- 驱动层：必须从第 1 帧顺序推进（模拟区有状态，跳帧无效） ---
    scn = bpy.context.scene
    rows = []
    arrays = {}
    emits = {}
    t0 = time.time()
    for f in range(1, b + 1):
        scn.frame_set(f)
        if f < a:
            continue
        dg = bpy.context.evaluated_depsgraph_get()
        ctx = Ctx(f, dg, obj, tree, bp)
        try:
            val = probe(ctx)
        except AssertionError as e:
            raise SystemExit("%s 探针不变量在第 %d 帧被打破: %s" % (PREFIX, f, e))
        if val is None:
            val = {}
        elif not isinstance(val, dict):
            val = {"结果": val}
        rows.append((f, val))
        for k, v in val.items():
            if isinstance(v, np.ndarray) and v.size > ARRAY_MIN:
                arrays.setdefault(k, []).append((f, v))
        for k, v in ctx.emits.items():
            emits.setdefault(k, []).append((f, v))
    dt = time.time() - t0
    print("%s 驱动+采集 %d 帧，用时 %.3fs" % (PREFIX, len(rows), dt))

    if not rows and not emits:
        raise SystemExit("%s ERROR: 没采到任何数据" % PREFIX)

    # --- 汇总输出 ---
    keys = []
    for _, v in rows:                      # 列名取所有帧的并集（某帧可能什么都不返回）
        for k in v:
            if k not in keys:
                keys.append(k)
    scalar_keys = [k for k in keys if all(is_scalarish(v.get(k)) for _, v in rows)]
    array_keys = [k for k in keys if k not in scalar_keys]

    if scalar_keys:
        w = max(_dw(k) for k in scalar_keys) + 1
        print("frame  " + "  ".join(pad(k, w) for k in scalar_keys))
        show = rows if len(rows) <= 30 else (rows[:8] + [None] + rows[-8:])
        for item in show:
            if item is None:
                print("  ...")
                continue
            f, v = item
            print("%5d  " % f + "  ".join(pad(fmt(v.get(k)), w) for k in scalar_keys))
        print("%s 汇总:" % PREFIX)
        for k in scalar_keys:
            nz = [v.get(k) for _, v in rows if v.get(k) is not None]
            if not nz:
                continue
            if all(isinstance(x, (bool, str, np.bool_)) or isinstance(x, (list, tuple)) for x in nz):
                print("  %s 首=%s 末=%s" % (pad(k, 14), fmt(nz[0]), fmt(nz[-1])))
                continue
            arr = np.asarray([float(x) for x in nz])
            trend = "↑" if arr[-1] > arr[0] else ("↓" if arr[-1] < arr[0] else "=")
            print("  %s 首=%.4f 末=%.4f 最小=%.4f 最大=%.4f 趋势%s"
                  % (pad(k, 14), arr[0], arr[-1], arr.min(), arr.max(), trend))

    for k in array_keys:
        samples = [v.get(k) for _, v in rows]
        shapes = sorted({np.shape(s) for s in samples})
        print("%s 数组字段 %r：每帧 shape=%s，共 %d 帧" % (PREFIX, k, shapes, len(samples)))

    # --- 落盘（大数组不进输出） ---
    if arrays or emits:
        out = ns.get("ARRAYS_NPZ") or os.path.join(
            os.getcwd(), "evidence", "probe_arrays_%s.npz" % time.strftime("%Y%m%d_%H%M%S"))
        out = os.path.abspath(out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        payload = {}
        for src in (arrays, emits):
            for k, lst in src.items():
                payload[k + "_frames"] = np.asarray([f for f, _ in lst])
                payload[k] = np.asarray([v for _, v in lst])
        np.savez_compressed(out, **payload)
        first = next(k for k in payload if not k.endswith("_frames"))
        print("%s 已烘焙落盘: %s (%.1f KB) keys=%s | 摘要 %s: %s"
              % (PREFIX, out, os.path.getsize(out) / 1024.0, list(payload.keys()),
                 first, _stat(payload[first])))
        print("%s 后续可从该文件反复查询，不用重跑模拟" % PREFIX)

    print("%s OK" % PREFIX)


if __name__ == "__main__":
    main()
