# -*- coding: utf-8 -*-
"""bpy_run.py —— 把一段 Python 代码交给「外部 python」执行（那个环境自带 meshkit）。

    「外部 python」= 跑在 Blender 外面的那个 python，地址从同目录的 envcard 取，
    本文件里不出现任何路径、也不出现环境的名字。

调用方只管把代码丢进来，剩下的后勤全由本脚本自理：

  * 自动把内容交给外部 python 去跑 —— 调用方用哪个 python 启动它都无所谓
  * 自动把 meshkit 所在目录摆进 sys.path —— 调用方不用设 cwd / PYTHONPATH
  * 顺带兜住超时、把报错讲清楚

为什么需要它
    外部 python 里装着 trimesh / numpy / pyvista / manifold3d / scipy，
    而别的 python 一个都没有（实测 `import trimesh` 直接 ModuleNotFoundError）。
    AI 用 bpy 工具做网格分析，代码必须落在外部 python 上。本脚本负责保证这件事。

怎么用
    python bpy_run.py -e "<Python 代码>"     跑一段代码
    python bpy_run.py <脚本.py>              跑一个脚本文件
    python bpy_run.py --check                自检：看解释器、目标解释器、meshkit 是否就位

选项
    --timeout=<秒>   默认 180。meshkit 内部要开 Blender，10-30 秒是常态。
    --cwd=<目录>     AI 代码的「当前目录」，默认沿用调用方当前目录

退出码
    0   成功
    1   代码自己报错（栈已打印在 stderr）
    2   用法错 / 环境没配好（比如 -e 后面空着、找不到外部 python）
    124 超时被强制结束（POSIX timeout 的约定值）

编码
    不强制设置，沿用调用方的环境：命令行里天然正确；程序调用请自行设 PYTHONIOENCODING=utf-8。
"""
import os
import runpy
import subprocess
import sys
import time
import traceback

# 本文件所在目录 = skills/math/，meshkit.py 和 envcard.py 都在这儿
_OWN_DIR = os.path.dirname(os.path.abspath(__file__))
if _OWN_DIR not in sys.path:
    sys.path.insert(0, _OWN_DIR)

_INNER = "--__inner__"        # 内部标记：带它 = 已经在目标解释器里，直接跑内容
_DEFAULT_TIMEOUT = 180

# ============================================================================
# 一、后勤：确保内容落在「外部 python」上跑
# ============================================================================
def _target_python():
    """返回 (外部 python 的路径, 错误信息)。不写死任何路径，一律从地址卡片取。"""
    env_val = (os.environ.get("PYTHON_EXE") or "").strip()   # 沿用全项目约定的环境变量名
    if env_val:
        return env_val, None

    detail = ""
    try:
        from envcard import PYTHON_EXE as _card_python      # 同目录的地址卡片
        if _card_python and str(_card_python).strip():
            return str(_card_python).strip(), None
    except Exception as exc:
        detail = "（读取环境卡片失败：%s: %s）" % (type(exc).__name__, exc)

    pyenv = os.path.join(os.path.dirname(_OWN_DIR), "_shared", "pyenv.py")
    return None, (
        "ERROR: 找不到外部 python 的路径。\n"
        "请先运行这条命令，重新生成环境卡片：\n"
        "    python %s\n"
        "然后重试。%s" % (pyenv, detail)
    )


def _timeout_from(argv):
    """从 --timeout=N 取秒数；取不到或不是数字就用默认值（内层会给正式报错）。"""
    for a in argv:
        if a.startswith("--timeout="):
            try:
                return max(1, int(float(a.split("=", 1)[1].strip())))
            except ValueError:
                return _DEFAULT_TIMEOUT
    return _DEFAULT_TIMEOUT


def _do_check():
    """自检（**必须跑在目标解释器里**，否则 meshkit/trimesh 会误报"读不到"）。"""
    print("本脚本所在    :", _OWN_DIR)
    try:
        import envcard
        print("envcard       :", envcard.__file__)
        print("  它的地址簿  :", getattr(envcard, "ENV_JSON", "(无)"))
        print("  外部 python :", getattr(envcard, "PYTHON_EXE", "(无)"))
    except Exception as exc:
        print("envcard       : 读不到（%s: %s）" % (type(exc).__name__, exc))
    try:
        import meshkit
        print("meshkit       :", meshkit.__file__)
        print("  它的 blender.exe:", meshkit.BLENDER_EXE)
    except Exception as exc:
        print("meshkit       : 读不到（%s: %s）" % (type(exc).__name__, exc))
    return 0


def _check(argv):
    """自检入口：当前解释器负责报"我是谁"，环境事实交给目标解释器如实报告。"""
    target, err = _target_python()
    print("=== bpy_run 自检 ===")
    print("当前解释器    :", sys.executable)
    print("目标解释器    :", target or ("取不到 —— " + (err or "")))
    if err:
        return 2
    here = os.path.normcase(os.path.abspath(sys.executable))
    if here == os.path.normcase(os.path.abspath(target)):
        return _do_check()                      # 已经在目标上，直接查
    print("（下面几行由目标解释器自己报告）")
    # 必须先 flush：子进程直接往同一个管道写，而本进程的 stdout 是块缓冲的，
    # 不 flush 的话子进程的输出会跑到上面这几行前面，看着像乱码。
    sys.stdout.flush()
    return subprocess.run([target, os.path.abspath(__file__), _INNER, "--check"]).returncode


# ============================================================================
# 二、内层：已经在目标解释器里了，解析参数并跑内容
# ============================================================================
def _parse(argv):
    """返回 (code, script, cwd, error)。"""
    code = script = cwd = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "-e":
            if i + 1 >= len(argv):
                return None, None, None, "ERROR: -e 后面需要跟一段 Python 代码"
            code = argv[i + 1]
            i += 2
            continue
        if a.startswith("--cwd="):
            cwd = a.split("=", 1)[1].strip() or None
        elif a.startswith("--timeout="):
            pass                                   # 外层已用，内层忽略
        elif a.startswith("-"):
            return None, None, None, "ERROR: 未知选项 %s" % a
        elif script is None:
            script = a
        else:
            return None, None, None, "ERROR: 只能给一个脚本文件，多出来的是 %s" % a
        i += 1

    if code and script:
        return None, None, None, "ERROR: -e 和脚本文件只能给一个"
    if not code and not script:
        return None, None, None, "ERROR: 需要 -e <代码> 或一个 .py 脚本文件"
    return code, script, cwd, None


def _run_code(argv):
    """在外部 python 里执行用户代码，返回退出码。"""
    code, script, cwd, err = _parse(argv)
    if err:
        sys.stderr.write(err + "\n")
        return 2
    if cwd:
        os.chdir(cwd)

    status = 0
    try:
        if script:
            path = os.path.abspath(script)
            if not os.path.isfile(path):
                sys.stderr.write("ERROR: 找不到脚本文件：%s\n" % path)
                return 2
            sys.path.insert(0, os.path.dirname(path))   # 脚本里 import 同目录模块能成立
            runpy.run_path(path, run_name="__main__")
        else:
            globs = {"__name__": "__main__", "__file__": "<bpy_run -e>"}
            exec(compile(code, "<bpy_run -e>", "exec"), globs)
    except SystemExit as exc:                      # 用户代码自己 sys.exit
        status = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
    except BaseException:                          # 其余异常：打印栈，退出码非 0
        traceback.print_exc()
        status = 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    return status


# ============================================================================
# 三、入口
# ============================================================================
def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 0
    if argv[0] == _INNER:                           # 已经在目标解释器里
        if "--check" in argv[1:]:
            return _do_check()
        return _run_code(argv[1:])
    if "--check" in argv:
        return _check(argv)

    # 外层：只管把内容交给外部 python，并把超时兜住
    target, err = _target_python()
    if err:
        sys.stderr.write(err + "\n")
        return 2

    # 不捕获子进程输出（流直通）——避免父进程解码后再转发把中文弄坏
    cmd = [target, os.path.abspath(__file__), _INNER] + argv
    try:
        return subprocess.run(cmd, timeout=_timeout_from(argv)).returncode
    except subprocess.TimeoutExpired:
        # 124 是 POSIX `timeout` 命令的约定值。不要用 -1：Windows 上传到 bash 会变成 127，
        # 而 127 的约定含义是「命令找不到」，排查时会被带偏。
        sys.stderr.write("ERROR: 超过 %s 秒还没跑完，已强制结束。\n" % _timeout_from(argv))
        return 124
    except OSError as exc:
        sys.stderr.write("ERROR: 启动外部 python 失败：%s\n路径：%s\n" % (exc, target))
        return 2


if __name__ == "__main__":
    sys.exit(main())
