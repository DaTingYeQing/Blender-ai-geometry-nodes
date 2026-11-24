# -*- coding: utf-8 -*-
"""拟合子系统。

- contract / translator —— 数据契约与底层数值转换
- base                  —— 底座：启动 Blender、读写节点、落 result.json
- core                  —— 槽位接口、RunContext、工具卡注册表
- cards/blender         —— 值类型卡（socket → 维度/打包）与测量卡
- cards/tool            —— 工具策略卡（score / target / memory ...）
- translate             —— Optuna 原始值 → Blender 打包值
- engine                —— 写死顺序的显式循环（python -m fitting.engine）
- host                  —— 底座在 Blender 内的一端（脚本，不参与导入）

注意：这个包会在 Blender 里被 import（via fitting.translator），
所以 __init__ 不能导入 engine（engine 只在外部跑，且会加载 optuna 等卡片）。
"""

from . import contract, translator  # noqa: F401

__all__ = ["contract", "translator"]
