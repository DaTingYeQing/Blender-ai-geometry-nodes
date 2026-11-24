# -*- coding: utf-8 -*-
"""拟合子系统。

- contract / translator —— 数据契约与底层数值转换
- base                  —— 底座：启动 Blender、读写节点、落 result.json
- cards                 —— 一个值类型一个卡片，引擎按需加载
- translate             —— 两个翻译层（Optuna↔Blender）
- engine                —— 写死顺序的显式循环（python -m fitting.engine）
- host                  —— 底座在 Blender 内的一端（脚本，不参与导入）

注意：这个包会在 Blender 里被 import（via fitting.translator），
所以 __init__ 不能导入 engine（engine 依赖 optuna）。
"""

from . import contract, translator  # noqa: F401

__all__ = ["contract", "translator"]
