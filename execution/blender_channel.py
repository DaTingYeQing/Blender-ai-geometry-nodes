# -*- coding: utf-8 -*-
"""blender_channel.py —— 通往 Blender 的「一条通道」（单文件）。

============================================================================
这是什么？
============================================================================
一句话：把一段 Python 代码（或一个 .py 脚本）送进 Blender 后台跑，再把
Blender 的输出收回来。它是整个系统里所有 Blender 工具的公共出口。
============================================================================
怎么用（给别的 Python 文件 import）
============================================================================
    import blender_channel

    # 跑一小段代码（用工作区 workflow_state.json 里记的工作档）
    r = blender_channel.run(code="import bpy; print(bpy.app.version_string)")
    print(r["ok"], r["stdout"])

    # 跑一个脚本文件，存回指定档
    r = blender_channel.run(script="build_nodes.py", blend="my_work.blend",
                            save="my_work.blend", script_args=["--node", "Cube"])

    # 开一个空场景（不读任何档，也不存）
    r = blender_channel.run(code="import bpy; print(len(bpy.data.objects))",
                            blend="new", save=False)

返回的永远是 dict（见下），不管出什么错都 **不会** 抛异常给调用方。

============================================================================
怎么用（当命令行，给 TypeScript / 任何脚本 spawn）
============================================================================
    python blender_channel.py -e "<代码>"        [选项] [-- 脚本参数...]
    python blender_channel.py <脚本.py>          [选项] [-- 脚本参数...]
    python blender_channel.py --check

    选项：
      --read=<路径|new>   启动时打开这个 .blend（new=开空场景；不给=读工作档）
      --save=<路径|no>    跑完存到这个 .blend（no=不存；不给=存回工作档）
      --cwd=<目录>        去哪找 workflow_state.json（默认工作区，不看当前目录）
      --state=<json路径>  直接指定 workflow_state.json 的位置
      --timeout=<秒>      超时时间，默认 120
      --json              输出一个 JSON（给机器读）
      --check             自检：打印 blender.exe 路径、Blender 版本、建档状况

    默认（不加 --json）时，本通道把 Blender 的 stdout 原样写到自己 stdout、
    stderr 原样写到自己 stderr，进程退出码 = Blender 退出码。所以老的调用点
    可以零改动接上。

    注意：`--` 之后的参数一律原样透传给目标脚本（POSIX 约定），本通道不再解析。
    例如 `-- --read=abc` 里的 `--read=abc` 会完整交给目标脚本，不会被通道吃掉。

============================================================================
返回值（dict）长这样
============================================================================
    {
      "ok":         True/False,   # 三条件全满足才算 True（见下）
      "exit_code":  int,          # Blender 的退出码（通道自身出错时为 -1）
      "stdout":     str,          # Blender 的标准输出（已解码成文字）
      "stderr":     str,          # Blender 的标准错误（已解码成文字）
      "traceback":  str | None,   # 从 stderr 里抠出来的 Traceback 段落
      "blend":      str | None,   # 实际使用的工作档（"new" 表示空场景）
      "saved":      str | None,   # 实际存到哪个档（没存就是 None）
      "duration_ms": int,         # 一共花了多少毫秒
      "error":      str | None,   # 通道自己的问题（不是 Blender 的）
      "command":    list[str],    # 真正执行的命令行（方便排查）
    }

    ok 为 True 的三个条件（缺一不可）：
      ① error 是 None
      ② exit_code == 0
      ③ stderr 里不含 "Traceback (most recent call last)"

============================================================================
工作档是怎么定的
============================================================================
  1. 调用方显式给了 blend 就用它；
  2. 否则读 workflow_state.json（= state_path，或 <cwd>/workflow_state.json，
     都没给则看工作区 envcard.WORKSPACE；不看当前目录）里的 "blend" 字段；
  3. 翻不到 → 返回错误，提示先建档（文案固定）；
  4. save 默认值：如果工作档有效且不是 "new"，就默认存回同一个档；
     显式给 "no" 或 False 则不存；
  5. blend == "new" 表示开空场景，不传任何档位置参数。

============================================================================
自检 / 出问题怎么办
============================================================================
  运行 `python blender_channel.py --check` 看 blender.exe 路径和版本。
  若提示找不到 blender.exe，说明环境卡片没生成，去运行环境分发器：
      python <skills/_shared/pyenv.py>
"""

import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback

__all__ = ["run"]


# ============================================================================
# 一、找到 blender.exe（不写死任何路径）
# ============================================================================
# 本文件所在目录 = skills/execution/，它和 skills/_shared/ 是兄弟目录。
# 环境分发器 pyenv.py 就在 _shared/ 里，这里按相对位置算出来，避免写死盘符路径。
_SKILLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))                                    #dirname是去掉末尾的文件来找到当前文件的路径abspath是以当前文件为绝对地址，
_SHARED_PYENV = os.path.join(_SKILLS_DIR, "_shared", "pyenv.py")                                             #join是把两个路径合并成一个路径



def _ensure_own_dir_on_path():
    """把本文件所在目录放进 sys.path，保证能 import 同目录的 envcard。"""
    own_dir = os.path.dirname(os.path.abspath(__file__))
    if own_dir and own_dir not in sys.path:
        sys.path.insert(0, own_dir)                                                                          #搜索一次然后就插入正确的地址在前面


# 在模块加载时尝试取一次 envcard 里的 BLENDER_EXE。
# 取不到也不让 import 崩掉，只记下错误，等真正 run() 时再给友好提示。
_ENVCARD_IMPORT_ERROR = None
try:
    _ensure_own_dir_on_path()
    from envcard import BLENDER_EXE as _ENVCARD_BLENDER_EXE  # noqa: E402                                    #拿到了正确的encard地址，现在就把工作地址和blender地址地址导入到py里面
    from envcard import WORKSPACE as _ENVCARD_WORKSPACE  # noqa: E402
except Exception as _exc:  # pragma: no cover - 依环境而定
    _ENVCARD_BLENDER_EXE = None
    _ENVCARD_WORKSPACE = None
    _ENVCARD_IMPORT_ERROR = "%s: %s" % (type(_exc).__name__, _exc)


def _resolve_blender_exe():
    """返回 (blender.exe 路径, 错误信息)。

    优先级：
      1. 环境变量 BLENDER_EXE（临时覆盖用）；
      2. envcard 里的 BLENDER_EXE；
      3. 都没有 → 给出指引，让用户去跑 pyenv.py 重新生成地址卡片。
    """
    env_val = os.environ.get("BLENDER_EXE")
    if env_val and env_val.strip():
        return env_val.strip(), None

    if _ENVCARD_BLENDER_EXE and str(_ENVCARD_BLENDER_EXE).strip():
        return str(_ENVCARD_BLENDER_EXE).strip(), None

    detail = ""
    if _ENVCARD_IMPORT_ERROR:
        detail = "\n（读取环境卡片失败：%s）" % _ENVCARD_IMPORT_ERROR
    return None, (
        "ERROR: 找不到 blender.exe 的路径。\n"
        "请先运行下面这条命令，重新生成环境卡片：\n"
        "    python %s\n"
        "然后再试一次。%s" % (_SHARED_PYENV, detail)
    )                                                                                                        #兜底设计，实际上前面的card已经有了地址


# ============================================================================
# 二、driver 脚本（内嵌字符串，保证单文件；运行时写到临时目录再执行）
# ============================================================================
# driver 是在 Blender 里跑的「引导员」：它从环境变量读任务，跑用户代码，
# 并且**无论如何都存盘**、把退出码算准。
_DRIVER_SOURCE = '''# -*- coding: utf-8 -*-
"""blender_channel 的 Blender 内引导脚本（自动生成，请勿手改）。"""
import json
import os
import runpy
import sys
import traceback

_EXIT_CODE = 0


# ---------------------------------------------------------------------------
# 自动同步：把「改了值但没打 tag」在求值入口处补上
# ---------------------------------------------------------------------------
# 背景：几何节点修改器的 socket 值存在 ID 属性里，改它不会给 depsgraph 打脏
# 标记。而 bpy.context.view_layer.update() 只重算「已打标记」的 ID，所以不打
# tag 时它是 no-op —— 表现为「改了值，读到的还是旧几何，而且不报错」。
#
# 做法：执行用户代码之前，把 sys.modules["bpy"] 换成一个极薄的代理，只在两个
# 求值入口被调用前补一次 tag：
#     bpy.context.view_layer.update()
#     bpy.context.evaluated_depsgraph_get()
# 其余一切原样转发（data / ops / types / props），对用户代码透明。用户自己显式
# 调用它们时同样受益 —— 所以「AI 写不写刷新都生效」。
#
# 关闭：设 BLENDER_CHANNEL_NO_AUTOSYNC=1（在大循环里反复读几何、在意性能时）。
_AUTOSYNC_DISABLED = os.environ.get("BLENDER_CHANNEL_NO_AUTOSYNC") == "1"

if not _AUTOSYNC_DISABLED:
    try:
        import types as _types
        import bpy as _real_bpy

        def _sync_all():
            """给所有物体补 tag —— 补上之后 view_layer.update() 才有东西可算。"""
            for _o in _real_bpy.data.objects:
                try:
                    _o.update_tag(refresh={"DATA"})
                except Exception:
                    pass

        class _ViewLayerProxy:
            """只重写 update()，其余全部转发给真的 view_layer。"""

            def __init__(self, real):
                object.__setattr__(self, "_real", real)

            def update(self, *args, **kwargs):
                _sync_all()
                return self._real.update(*args, **kwargs)

            def __getattr__(self, name):
                return getattr(self._real, name)

            def __setattr__(self, name, value):
                setattr(self._real, name, value)

        class _ContextProxy:
            """只加工 view_layer 和 evaluated_depsgraph_get，其余转发。"""

            def __init__(self, real):
                object.__setattr__(self, "_real", real)

            @property
            def view_layer(self):
                return _ViewLayerProxy(self._real.view_layer)

            def evaluated_depsgraph_get(self, *args, **kwargs):
                _sync_all()
                return self._real.evaluated_depsgraph_get(*args, **kwargs)

            def __getattr__(self, name):
                return getattr(self._real, name)

            def __setattr__(self, name, value):
                setattr(self._real, name, value)

        class _BpyProxy(_types.ModuleType):
            """bpy 模块的替身：只有 context 被加工，其余原样透传。"""

            def __getattr__(self, name):
                if name == "context":
                    return _ContextProxy(_real_bpy.context)
                return getattr(_real_bpy, name)

        sys.modules["bpy"] = _BpyProxy("bpy")
    except Exception:
        # 注入失败绝不能影响主流程：退回「不注入」，一切照旧
        traceback.print_exc()
        sys.stderr.write("[blender_channel] 自动同步注入失败，本次不注入\\n")


def _fallback_sync():
    """存盘前的兜底同步：保证落盘的几何反映脚本最后改的值。

    与上面的代理相互独立：即使代理被 BLENDER_CHANNEL_NO_AUTOSYNC 关掉，
    这一步也照做（每轮只跑一次，开销可忽略）。
    """
    try:
        import bpy as _bpy_now
        for _o in _bpy_now.data.objects:
            try:
                _o.update_tag(refresh={"DATA"})
            except Exception:
                pass
        _bpy_now.context.view_layer.update()
    except Exception:
        pass


def _save_blend(path):
    """在 finally 里存盘：脚本就算崩了，结果也能落盘。"""
    global _EXIT_CODE
    try:
        import bpy  # 只有身处 Blender 里才 import 得到
    except Exception:
        traceback.print_exc()
        sys.stderr.write("[blender_channel] 无法 import bpy，存盘失败\\n")
        _EXIT_CODE = 1
        return
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
        sys.stdout.write("[blender_channel] saved -> %s\\n" % path)
    except Exception:
        traceback.print_exc()
        sys.stderr.write("[blender_channel] 存盘失败 -> %s\\n" % path)
        _EXIT_CODE = 1


def _load_job():
    """从环境变量读任务文件路径（不放 argv 里，避免引号/顺序问题）。"""
    raw = os.environ.get("BLENDER_CHANNEL_JOB", "")
    if not raw:
        sys.stderr.write("[blender_channel] 缺少 BLENDER_CHANNEL_JOB 环境变量\\n")
        return None
    try:
        with open(raw, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        traceback.print_exc()
        return None


def main():
    global _EXIT_CODE

    job = _load_job()
    if job is None:
        return 2

    kind = job.get("kind")
    src = job.get("src")
    save = job.get("save")
    label = job.get("label") or "<blender_channel>"

    try:
        if kind == "file":
            # 把脚本所在目录插到 sys.path[0]，脚本里 import 同目录模块才找得到
            src_dir = os.path.dirname(os.path.abspath(src))
            if src_dir and (not sys.path or sys.path[0] != src_dir):
                sys.path.insert(0, src_dir)
            runpy.run_path(src, run_name="__main__")
        elif kind == "code":
            code_obj = compile(src, label, "exec")
            globs = {
                "__name__": "__main__",
                "__file__": label,
                "__builtins__": __builtins__,
            }
            exec(code_obj, globs)
        else:
            sys.stderr.write("[blender_channel] 未知 kind: %r\\n" % (kind,))
            _EXIT_CODE = 2
    except SystemExit as exc:
        # 显式退出：取它的 code 当退出码，不打印 traceback
        code = exc.code
        if code is None:
            _EXIT_CODE = 0
        elif isinstance(code, int):
            _EXIT_CODE = code
        else:
            sys.stderr.write("%s\\n" % (code,))
            _EXIT_CODE = 1
    except BaseException:
        traceback.print_exc()
        _EXIT_CODE = 1
    finally:
        # 存盘放 finally：即使上面抛了异常，这里也一定跑到
        # 存盘前先兜底同步，否则落盘的是脚本改值之前的旧几何
        _fallback_sync()
        if save:
            _save_blend(save)

    try:
        sys.stdout.flush()
    except Exception:
        pass
    try:
        sys.stderr.flush()
    except Exception:
        pass
    return _EXIT_CODE


if __name__ == "__main__":
    # 注意：绝不修改 sys.argv —— 目标脚本靠扫 sys.argv 拿自己的参数
    sys.exit(main())
'''


# ============================================================================
# 三、输出解码（按字节收，逐行判断编码，解决中英混排乱码）
# ============================================================================
def _decode_one_line(raw: bytes) -> str:
    """解一行：先按 utf-8，再按 gbk，再兜底 utf-8 replace。"""
    for enc in ("utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _decode_stream(data: bytes) -> str:
    """把一坨字节解码成文字，逐行处理（应付同一流里 utf-8 / gbk 混排）。

    顺手把 Windows 的 \\r\\n 收成 \\n，输出更干净。
    """
    if not data:
        return ""
    out = []
    for line in data.split(b"\n"):
        if line.endswith(b"\r"):
            line = line[:-1]
        out.append(_decode_one_line(line))
    return "\n".join(out)


_TRACEBACK_MARKER = "Traceback (most recent call last)"


def _extract_traceback(stderr: str):
    """从 stderr 里抠出 Traceback 那一段；没有就返回 None。"""
    if not stderr or _TRACEBACK_MARKER not in stderr:
        return None
    idx = stderr.find(_TRACEBACK_MARKER)
    return stderr[idx:].strip()


# ============================================================================
# 四、工作档解析（与现有 TS 扩展保持一致）
# ============================================================================
_NO_BLEND_MESSAGE = (
    "还没建工作档。请先 wf_plan 建档（会自动创建并锁定唯一工作档 .blend），再 run。"
)


def _resolve_blend(blend, cwd, state_path):
    """算出这次要用哪个 .blend；算不出返回 None。"""
    # 1. 调用方显式给了 blend
    if blend is not None:
        b = str(blend).strip()
        if b:
            return b
        # 显式给了空串 → 当作没给，回落到 workflow_state.json

    # 2. 读 workflow_state.json（只认显式指定和工作区，不看当前目录）
    sp = state_path
    if not sp:
        base = cwd or (_ENVCARD_WORKSPACE or "")
        if base:
            sp = os.path.join(base, "workflow_state.json")
    if sp:
        if not os.path.isabs(sp):
            sp = os.path.abspath(sp)
        try:
            with open(sp, "r", encoding="utf-8") as f:
                data = json.load(f)
            val = data.get("blend")
            if isinstance(val, str) and val.strip():
                return val.strip()
        except Exception:
            pass

    # 3. 翻不到
    return None


def _normalize_save(save, blend):
    """算出这次要不要存、存到哪；不存返回 None。"""
    if isinstance(save, bool):
        if not save:
            return None
        save = None  # True → 用默认（存回工作档）
    if save is None:
        if blend and blend != "new":
            return blend
        return None
    s = str(save).strip()
    if s == "" or s.lower() == "no":
        return None
    return s


# ============================================================================
# 五、文件锁（同一个 .blend 串行化，防止互相覆盖）
# ============================================================================
def _acquire_lock(blend_path, timeout):
    """给目标档加锁。返回 (锁文件路径, None) 或 (None, 错误信息)。"""
    key = os.path.normcase(os.path.abspath(blend_path))
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    lock_path = os.path.join(
        tempfile.gettempdir(), "blender_channel_" + digest + ".lock"
    )
    warn_pending = True
    deadline = time.monotonic() + max(int(timeout), 1)

    while True:
        try:
            # O_CREAT | O_EXCL 是原子操作：谁先创建谁拿锁
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                os.write(fd, str(os.getpid()).encode("ascii"))
            finally:
                os.close(fd)
            return lock_path, None
        except FileExistsError:
            # 锁已存在：先看是不是陈旧锁（很久没动过）
            stale = False
            try:
                age = time.time() - os.path.getmtime(lock_path)
                if age > timeout * 2:
                    stale = True
            except OSError:
                stale = False

            if stale:
                if warn_pending:
                    sys.stderr.write(
                        "[blender_channel] 检测到陈旧锁（超过 %.0f 秒未更新），强制接管：%s\n"
                        % (timeout * 2, lock_path)
                    )
                    warn_pending = False
                try:
                    os.remove(lock_path)
                except OSError:
                    pass
                continue  # 删掉后立刻重试抢锁

            if time.monotonic() >= deadline:
                return None, (
                    "ERROR: 工作档正被其它请求占用，等待超过 %.0f 秒仍拿不到锁。"
                    "请稍后再试。" % timeout
                )
            time.sleep(0.05)
        except OSError as exc:
            return None, "ERROR: 无法创建锁文件 %s：%s" % (lock_path, exc)


def _release_lock(lock_path):
    """释放锁；出错也无所谓，别影响主流程。"""
    if not lock_path:
        return
    try:
        os.remove(lock_path)
    except OSError:
        pass


# ============================================================================
# 六、结果字典
# ============================================================================
def _empty_result() -> dict:
    return {
        "ok": False,
        "exit_code": -1,
        "stdout": "",
        "stderr": "",
        "traceback": None,
        "blend": None,
        "saved": None,
        "duration_ms": 0,
        "error": None,
        "command": [],
    }


def _fail(result: dict, message: str, started: float) -> dict:
    """把结果标成失败并写错误信息，返回同一个 dict。"""
    result["error"] = message
    result["ok"] = False
    result["duration_ms"] = int((time.monotonic() - started) * 1000)
    return result


# ============================================================================
# 七、参数规整（把外面递进来的脏值挡在门口，保证 run() 不抛异常）
# ============================================================================
def _coerce_timeout(timeout):
    """把 timeout 规整成 ≥ 1 的秒数（float）。不合法返回 (None, 错误信息)。

    语义（**绝不静默改语义** —— 静默 clamping 比明确报错危险得多）：
      * None            → 用默认值 120（显式传 None 表示「沿用默认」）
      * 正整数/正浮点/纯数字字符串（含两端空格）→ 用它
      * 0 / 负数        → 明确报错（不再静默抬到 1 秒）
      * nan / inf / -inf → 明确报错（用 math.isfinite 统一挡掉，
                          绝不放去下游炸出 OverflowError）
      * bool            → 明确报错
      * 其它类型        → 明确报错（「需要是数字」）

    不提供「不限时」取值：那意味着一个可能永远不返回的 Blender 进程，
    风险大于收益；要跑久一点请直接给更大的秒数。
    """
    if timeout is None:
        # 显式传 None 是很自然的「沿用默认」写法，接受它
        return 120.0, None
    if isinstance(timeout, bool):
        # bool 是 int 的子类，但这里当秒数用没有意义，明确挡掉
        return None, "ERROR: timeout 需要是数字，收到的是 %s" % type(timeout).__name__
    if isinstance(timeout, (int, float)):
        val = float(timeout)
        shown = timeout
    elif isinstance(timeout, str):
        try:
            val = float(timeout.strip())
        except ValueError:
            return None, "ERROR: timeout 需要是数字，收到的是 %r" % timeout
        shown = timeout.strip()
    else:
        return None, "ERROR: timeout 需要是数字，收到的是 %s" % type(timeout).__name__
    # inf / nan 一律挡掉：既不是「≥ 1 的秒数」，也绝不放去下游炸 OverflowError
    if not math.isfinite(val) or val < 1.0:
        return None, (
            "ERROR: timeout 需要 ≥ 1 的秒数（收到 %s）；"
            "要更长时间请直接给更大的秒数" % shown
        )
    return val, None


def _coerce_script_args(script_args):
    """把 script_args 规整成 list[str]。不合法返回 (None, 错误信息)。

      * None → []
      * list / tuple → 元素统一转成 str（元素不是 str 也不抛）
      * 直接给字符串 / 数字等标量 → 明确报错（避免把单条参数误当列表传）
    """
    if script_args is None:
        return [], None
    if isinstance(script_args, (str, bytes)):
        return None, (
            "ERROR: script_args 需要是一个字符串列表，收到的是 %s。"
            "如果要传单个参数，请写成 [\"参数\"]" % type(script_args).__name__
        )
    if isinstance(script_args, (list, tuple)):
        out = []
        for item in script_args:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, os.PathLike):
                out.append(os.fspath(item))
            elif item is None:
                out.append("")
            else:
                out.append(str(item))
        return out, None
    return None, (
        "ERROR: script_args 需要是一个字符串列表，收到的是 %s"
        % type(script_args).__name__
    )


def _coerce_path_value(value, name):
    """把路径类参数（cwd / state_path / blend / save）规整成 str。

    None 原样放行；str / os.PathLike 转成 str；其它一律返回错误，不抛异常。
    布尔值由调用方单独处理（save 允许 False），这里遇到 bool 一律报错。
    """
    if value is None:
        return None, None
    if isinstance(value, bool):
        return None, "ERROR: %s 需要是路径字符串，收到的是布尔值" % name
    if isinstance(value, str):
        return value, None
    if isinstance(value, os.PathLike):
        try:
            return os.fspath(value), None
        except TypeError:
            return None, (
                "ERROR: %s 需要是路径字符串，收到的是 %s"
                % (name, type(value).__name__)
            )
    return None, (
        "ERROR: %s 需要是路径字符串，收到的是 %s" % (name, type(value).__name__)
    )


# ============================================================================
# 八、核心入口 run()
# ============================================================================
def run(code=None, *, script=None, blend=None, save=None,
        cwd=None, state_path=None, timeout=120, script_args=None) -> dict:
    """让 Blender 后台跑一段代码/一个脚本，把结果作为 dict 返回。

    参数：
      code        要执行的 Python 代码字符串（与 script 二选一）。
      script      要执行的 .py 脚本路径（与 code 二选一）。
      blend       要打开的 .blend 路径、"new"（空场景）或 None（读工作档）。
      save        存到的路径、False/"no"（不存）或 None（默认存回工作档）。
      cwd         去哪找 workflow_state.json，默认工作区（envcard.WORKSPACE），不看当前目录。
      state_path  直接指定 workflow_state.json 路径（优先于 cwd）。
      timeout     超时秒数，默认 120。接受 int / float / 纯数字字符串。
      script_args 传给目标脚本的参数列表（放在 `--` 之后）。

    返回：见模块顶部说明的 dict。
    保证：**任何情况下都不抛异常**（KeyboardInterrupt / SystemExit 除外，
    这两个放行，好让 Ctrl+C 能中断、sys.exit 能退出）。参数类型不对一律
    返回 ok=False 的 dict，绝不把脏值透传给下层。
    """
    started = time.monotonic()
    result = _empty_result()
    try:
        return _run_impl(
            result, started,
            code=code, script=script, blend=blend, save=save,
            cwd=cwd, state_path=state_path, timeout=timeout,
            script_args=script_args,
        )
    except (KeyboardInterrupt, SystemExit):
        # 这两个不能吞：Ctrl+C 要能中断进程，sys.exit 要能退出
        raise
    except BaseException as exc:
        # 最后一道防线：任何没预料到的异常都兜成 ok=False 的 dict，
        # 保证「任何情况下都不抛异常」这份契约在未来改动下也成立。
        _fail(
            result,
            "ERROR: 通道内部异常（%s）：%s" % (type(exc).__name__, exc),
            started,
        )
        # 面向用户的 error 保持上面的友好文案；面向排查的 traceback 字段存栈，
        # 两不打扰。正常跑通时该字段仍为 None（契约不变）。
        result["traceback"] = traceback.format_exc()
        return result


def _run_impl(result, started, *, code=None, script=None, blend=None, save=None,
              cwd=None, state_path=None, timeout=120, script_args=None) -> dict:
    """run() 的实际实现；不负责兜底（兜底在 run() 里）。"""
    # --- 0. 入口参数规整（类型不对就明确报错，绝不把脏值往下传） ---
    timeout, err = _coerce_timeout(timeout)
    if err:
        return _fail(result, err, started)

    script_args, err = _coerce_script_args(script_args)
    if err:
        return _fail(result, err, started)

    cwd, err = _coerce_path_value(cwd, "cwd")
    if err:
        return _fail(result, err, started)

    state_path, err = _coerce_path_value(state_path, "state_path")
    if err:
        return _fail(result, err, started)

    blend, err = _coerce_path_value(blend, "blend")
    if err:
        return _fail(result, err, started)

    # save 允许布尔（False = 不存），所以先放行 bool，其余按路径规整
    if save is not None and not isinstance(save, bool):
        save, err = _coerce_path_value(save, "save")
        if err:
            return _fail(result, err, started)

    # --- 1. code / script 二选一 ---
    code_given = code is not None
    script_given = script is not None
    has_code = code_given and str(code).strip() != ""
    has_script = script_given and str(script).strip() != ""
    if has_code and has_script:
        return _fail(result, "ERROR: code 和 script 只能给一个", started)
    if not has_code and not has_script:
        # 分清「压根没给」和「给了但是空的」——后者要能把问题点出来
        if code_given and not has_code:
            return _fail(
                result, "ERROR: -e 后面是空的，需要给一段 Python 代码", started
            )
        if script_given and not has_script:
            return _fail(
                result, "ERROR: 脚本路径是空的，需要给一个 .py 文件路径", started
            )
        return _fail(result, "ERROR: 需要给 code 或 script 之一", started)

    # --- 2. 找 blender.exe ---
    exe, exe_err = _resolve_blender_exe()
    if exe_err:
        return _fail(result, exe_err, started)

    # --- 3. 定工作档 ---
    resolved_blend = _resolve_blend(blend, cwd, state_path)
    if resolved_blend is None:
        return _fail(result, _NO_BLEND_MESSAGE, started)
    result["blend"] = resolved_blend

    # --- 4. save 默认值 ---
    resolved_save = _normalize_save(save, resolved_blend)

    # --- 5. 准备来源（代码 或 脚本路径） ---
    base = cwd or os.getcwd()
    if has_code:
        kind = "code"
        src = code if isinstance(code, str) else str(code)
        label = "<blender_channel -e>"
    else:
        kind = "file"
        p = script if isinstance(script, str) else str(script)
        if not os.path.isabs(p):
            p = os.path.join(base, p)  # 相对路径先按 base 拼，再转绝对
        p = os.path.abspath(p)
        if not os.path.isfile(p):
            return _fail(result, "ERROR: 找不到脚本文件：%s" % p, started)
        src = p
        label = p

    args = list(script_args) if script_args else []

    # --- 6. 拿锁（只有真正用档时才需要） ---
    lock_path = None
    if resolved_blend != "new":
        lock_path, lock_err = _acquire_lock(resolved_blend, timeout)
        if lock_err:
            return _fail(result, lock_err, started)

    tmpdir = None
    try:
        # 把 driver 和 job 写到临时目录
        tmpdir = tempfile.mkdtemp(prefix="blender_channel_")
        driver_path = os.path.join(tmpdir, "blender_channel_driver.py")
        job_path = os.path.join(tmpdir, "blender_channel_job.json")
        with open(driver_path, "w", encoding="utf-8") as f:
            f.write(_DRIVER_SOURCE)
        job = {"src": src, "kind": kind, "save": resolved_save, "label": label}
        with open(job_path, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False)

        # 拼命令行：档位置参数必须在 --python 之前
        cmd = [exe, "--background", "--python-exit-code", "1"]
        if resolved_blend != "new":
            cmd.append(resolved_blend)
        cmd += ["--python", driver_path]
        if args:
            cmd += ["--"] + args
        result["command"] = cmd

        env = dict(os.environ)
        env["BLENDER_CHANNEL_JOB"] = job_path
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"

        try:
            # 按字节收（不传 text/encoding），后面自己逐行解码
            proc = subprocess.run(
                cmd, capture_output=True, cwd=base, env=env, timeout=timeout
            )
            out_bytes = proc.stdout or b""
            err_bytes = proc.stderr or b""
            result["exit_code"] = proc.returncode
        except subprocess.TimeoutExpired as exc:
            # subprocess.run 在超时时已尽力 kill 子进程；这里把能拿到的输出收下
            out_bytes = getattr(exc, "stdout", None) or b""
            err_bytes = getattr(exc, "stderr", None) or b""
            result["stdout"] = _decode_stream(out_bytes)
            result["stderr"] = _decode_stream(err_bytes)
            result["traceback"] = _extract_traceback(result["stderr"])
            result["exit_code"] = -1
            return _fail(
                result,
                "ERROR: 超过 %.0f 秒还没跑完，已强制结束。"
                "（Blender 被中断，工作档可能没来得及完整保存）" % timeout,
                started,
            )
        except OSError as exc:
            return _fail(
                result,
                "ERROR: 无法启动 Blender：%s\n"
                "请检查环境卡片里的 blender.exe 是否真的存在，"
                "或运行环境分发器重新生成地址。" % exc,
                started,
            )

        # --- 解码 + 判据 ---
        result["stdout"] = _decode_stream(out_bytes)
        result["stderr"] = _decode_stream(err_bytes)
        result["traceback"] = _extract_traceback(result["stderr"])

        if resolved_save and "[blender_channel] saved ->" in result["stdout"]:
            result["saved"] = resolved_save

        result["ok"] = (
            result["error"] is None
            and result["exit_code"] == 0
            and _TRACEBACK_MARKER not in result["stderr"]
        )
    finally:
        # 清理临时文件（除非开了保留开关）
        if tmpdir and os.environ.get("BLENDER_CHANNEL_KEEP_TEMP") != "1":
            shutil.rmtree(tmpdir, ignore_errors=True)
        _release_lock(lock_path)

    result["duration_ms"] = int((time.monotonic() - started) * 1000)
    return result


# ============================================================================
# 九、命令行解析
# ============================================================================
def _parse_argv(argv):
    """解析命令行。返回 (选项字典, 错误信息)。错误信息非 None 时表示参数有问题。"""
    opts = {
        "check": False,
        "json": False,
        "code": None,
        "script": None,
        "blend": None,
        "save": None,
        "cwd": None,
        "state": None,
        "timeout": 120,
        "script_args": [],
    }

    # `--` 之后一律原样透传给目标脚本
    if "--" in argv:
        i = argv.index("--")
        head = list(argv[:i])
        opts["script_args"] = list(argv[i + 1:])
    else:
        head = list(argv)

    positional = []
    j = 0
    while j < len(head):
        a = head[j]
        if a == "-e":
            if j + 1 >= len(head):
                return None, "ERROR: -e 后面需要跟一段 Python 代码"
            opts["code"] = head[j + 1]
            j += 2
            continue
        if a == "--check":
            opts["check"] = True
        elif a == "--json":
            opts["json"] = True
        elif a.startswith("--read="):
            v = a.split("=", 1)[1].strip()
            opts["blend"] = v or None
        elif a.startswith("--save="):
            v = a.split("=", 1)[1].strip()
            opts["save"] = v or None
        elif a.startswith("--cwd="):
            v = a.split("=", 1)[1].strip()
            opts["cwd"] = v or None
        elif a.startswith("--state="):
            v = a.split("=", 1)[1].strip()
            opts["state"] = v or None
        elif a.startswith("--timeout="):
            v = a.split("=", 1)[1].strip()
            try:
                opts["timeout"] = int(v)
            except ValueError:
                return None, "ERROR: --timeout 需要是整数秒，收到：%r" % v
        elif a.startswith("-") and a != "-":
            return None, "ERROR: 未知选项 %s" % a
        else:
            positional.append(a)
        j += 1

    if opts["check"]:
        if opts["code"] is not None or positional:
            return None, "ERROR: --check 不能和代码/脚本一起用"
        return opts, None

    # `-e ""`：代码没给全，属于用法错误 —— 归为解析失败（exit 2），
    # 与 --timeout=abc 等其它参数错误一致；文案保持不变。
    if opts["code"] is not None and opts["code"].strip() == "":
        return None, "ERROR: -e 后面是空的，需要给一段 Python 代码"

    if opts["code"] is not None and positional:
        return None, "ERROR: -e 和脚本文件只能给一个"
    if opts["code"] is None and not positional:
        return None, "ERROR: 需要给 -e <代码> 或 <脚本.py>（或用 --check 自检）"
    if len(positional) > 1:
        return None, "ERROR: 只能指定一个脚本文件，收到 %d 个" % len(positional)
    if positional:
        opts["script"] = positional[0]
    return opts, None


def _do_check() -> int:
    """自检：打印 blender.exe 路径、Blender 版本、工作区建档状况。"""
    print("=== blender_channel 自检 ===")

    exe, err = _resolve_blender_exe()
    if err:
        print("blender.exe : 未找到")
        print(err)
        return 1
    print("blender.exe : %s" % exe)
    if not os.path.exists(exe):
        print("警告        : 这个文件不存在，请检查 py_environment.json")

    try:
        proc = subprocess.run([exe, "--version"], capture_output=True, timeout=60)
        text = _decode_stream(proc.stdout or b"").strip()
        first = text.splitlines()[0] if text else ""
        print("Blender 版本: %s" % (first or "(无法获取)"))
    except Exception as exc:
        print("Blender 版本: 获取失败（%s）" % exc)

    ws = (_ENVCARD_WORKSPACE or "").strip()
    if not ws:
        print("工作区      : 拿不到（envcard 未生成或 workspace.root 为空）")
        return 0
    sp = os.path.join(ws, "workflow_state.json")
    print("工作区      : %s" % ws)
    if os.path.exists(sp):
        print("workflow_state.json : 存在")
        try:
            with open(sp, "r", encoding="utf-8") as f:
                data = json.load(f)
            b = data.get("blend")
            print("  blend     : %s" % (b if b else "(没有 blend 字段)"))
        except Exception as exc:
            print("  （解析失败：%s）" % exc)
    else:
        print("workflow_state.json : 不存在（还没建档，请先 wf_plan 建档）")
    return 0


def _cli_main(argv) -> int:
    """命令行主函数，返回进程退出码。"""
    opts, err = _parse_argv(argv)
    if err:
        sys.stderr.write(err + "\n")
        return 2

    if opts["check"]:
        return _do_check()

    result = run(
        code=opts["code"],
        script=opts["script"],
        blend=opts["blend"],
        save=opts["save"],
        cwd=opts["cwd"],
        state_path=opts["state"],
        timeout=opts["timeout"],
        script_args=opts["script_args"],
    )

    if opts["json"]:
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        if result["ok"]:
            return 0
        code = result["exit_code"]
        return code if isinstance(code, int) and code > 0 else 1

    # 默认模式：把 Blender 的输出原样转发，退出码 = Blender 退出码
    if result["stdout"]:
        sys.stdout.write(result["stdout"])
    if result["stderr"]:
        sys.stderr.write(result["stderr"])
    if result["error"]:
        sys.stderr.write(result["error"] + "\n")

    code = result["exit_code"]
    if not isinstance(code, int) or code < 0:
        code = 0 if result["ok"] else 1
    return code


if __name__ == "__main__":
    sys.exit(_cli_main(sys.argv[1:]))
