# -*- coding: utf-8 -*-
"""pyenv.py —— 环境分发器（放在 skills/_shared/ 里）

干两件事：
  1. 找到 py_environment.json（从本文件位置向上逐层找），读出里面的地址。
  2. 【核心】给 skills/ 下每个 skill 文件夹写一份 envcard.py（环境卡片）。

用法：
  python pyenv.py           → 分发：给每个同级 skill 文件夹写一份 envcard.py
  python pyenv.py --show    → 只打印当前地址，不动任何文件（附带体检：路径是否真实存在）

之后，skill 文件夹里的脚本只要一行：
  from envcard import BLENDER_EXE, PYTHON_EXE

【发到 GitHub 时的规矩】
  * py_environment.json 是**全部地址的唯一配置处**，用户只改这一个文件。
  * 卡片（envcard.py）里**不含任何绝对路径** —— 它靠"从自己位置向上找"来定位地址簿，
    所以卡片可以安全地提交到仓库，别人 clone 下来开箱即用、连本脚本都不用先跑。
  * 代码里**不许出现环境目录的名字**，只许引用卡片导出的角色名
    （BLENDER_EXE / PYTHON_EXE / …）。这样换环境只改地址簿里的"值"，不用改任何"名字"。
"""
import json
import os
import sys

_JSON_NAME = "py_environment.json"
_MAX_UP = 6
_CARD_NAME = "envcard.py"


# ============ 一、找地址簿 ============
def _find_json(start=None):
    """从 start（默认本文件）所在目录向上找 py_environment.json，返回绝对路径。"""
    p = os.path.dirname(os.path.abspath(start or __file__))
    for _ in range(_MAX_UP):
        cand = os.path.join(p, _JSON_NAME)
        if os.path.exists(cand):
            return cand
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    raise FileNotFoundError("找不到 %s（从 %s 向上找了 %d 层）"
                            % (_JSON_NAME, os.path.dirname(os.path.abspath(start or __file__)), _MAX_UP))


_ENV = None


def _env():
    """读一次就记住，避免重复读盘。"""
    global _ENV
    if _ENV is None:
        with open(_find_json(), "r", encoding="utf-8") as f:
            _ENV = json.load(f)
    return _ENV


def blender_exe():
    """内层：blender.exe 完整路径（带 bpy 跑）。"""
    return _env()["blender"]["exe"]


def python_exe():
    """外部 python：python.exe 完整路径（跑所有不碰 bpy 的胶水脚本）。"""
    return _env()["python"]["exe"]


def workspace():
    """工作区根目录：.blend / 批次文件 / payload / 生成脚本等产物的落盘处。"""
    return _env().get("workspace", {}).get("root", "")


def env_json_path():
    """地址簿自身的路径。"""
    return _find_json()


# ============ 二、生成"卡片"内容 ============
def build_envcard_text():
    """生成 envcard.py 的完整内容。

    卡片里**不写死任何绝对路径**：它从自己所在目录向上找 py_environment.json。
    因此卡片内容与机器无关，可以提交进 Git；地址改了一律立刻生效（值是运行时现读的），
    只有"新增了 skill 文件夹"时才需要重新跑本脚本分发。
    """
    tmpl = r'''# -*- coding: utf-8 -*-
"""envcard.py —— 本文件夹的环境卡片（自动生成，请勿手改）

【改地址】只改 py_environment.json（在 skills/ 的上一级），本卡片会自动读到新值。
【重新生成】python <skills>/_shared/pyenv.py   （只有新增 skill 文件夹时才需要）

本卡片不含任何绝对路径，可以安全提交到 Git。
"""
import json as _json
import os as _os

_MAX_UP = 6


def _find_env_json():
    """从本卡片所在目录向上找 py_environment.json（不写死路径）。"""
    p = _os.path.dirname(_os.path.abspath(__file__))
    for _ in range(_MAX_UP):
        cand = _os.path.join(p, "py_environment.json")
        if _os.path.exists(cand):
            return cand
        parent = _os.path.dirname(p)
        if parent == p:
            break
        p = parent
    raise FileNotFoundError(
        "找不到 py_environment.json（从 %s 向上找了 %d 层）。\n"
        "它是全部地址的唯一配置处，应当放在 skills/ 的上一级。" % (p, _MAX_UP))


ENV_JSON = _find_env_json()

with open(ENV_JSON, "r", encoding="utf-8") as _f:
    _E = _json.load(_f)

BLENDER_EXE = _E["blender"]["exe"]            # 内层：带 bpy 跑
PYTHON_EXE  = _E["python"]["exe"]             # 外部：跑不碰 bpy 的胶水脚本
WORKSPACE   = _E.get("workspace", {}).get("root", "")

__all__ = ["BLENDER_EXE", "PYTHON_EXE", "WORKSPACE", "ENV_JSON"]
'''
    return tmpl


# ============ 三、分发到各 skill 文件夹 ============
def sync_skills(skills_dir=None):
    """给 skills/ 下每个 skill 文件夹写一份 envcard.py。

    跳过：_shared 本身、以及所有以 _ 开头的文件夹（约定：_ 开头 = 公共/临时）。
    返回已写入的路径列表。
    """
    if skills_dir is None:
        skills_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    written = []
    for name in sorted(os.listdir(skills_dir)):
        if name.startswith("_"):
            continue
        d = os.path.join(skills_dir, name)
        if not os.path.isdir(d):
            continue
        target = os.path.join(d, _CARD_NAME)
        with open(target, "w", encoding="utf-8") as f:
            f.write(build_envcard_text())
        written.append(target)
    return written


# ============ 四、自检 ============
def _show():
    """打印当前地址 + 体检（路径是否真实存在）。"""
    print("地址簿      :", env_json_path())
    print()

    def line(label, path, note=""):
        ok = "✓ 存在" if path and os.path.exists(path) else "✗ 不存在"
        print("  %-12s %s   [%s] %s" % (label, path or "(空)", ok, note))

    line("blender.exe", blender_exe(), "内层：带 bpy 跑")
    line("python.exe", python_exe(), "外部：跑胶水脚本")
    line("工作区", workspace(), "产物落盘处")
    print()

    envc = _env()
    print("  blender.version        :", envc.get("blender", {}).get("version", ""))
    print("  python.version         :", envc.get("python", {}).get("version", ""))


if __name__ == "__main__":
    if "--show" in sys.argv:
        _show()
    else:
        paths = sync_skills()
        if not paths:
            print("没有找到可分发的 skill 文件夹（skills/ 下除 _shared 外为空）。")
        for p in paths:
            print("已生成:", p)
        print("\n提示：想确认地址对不对，跑  python %s --show" % os.path.abspath(__file__))
