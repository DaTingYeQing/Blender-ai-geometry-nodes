---

name: "blender-exec"
description: "Blender 4.5 几何节点执行+调试阶段：建节点树、连 socket、跑脚本验证、调试修正、打勾推进。math模式出完计划后加载本 skill。"
---

# 执行 + 调试（wf\_plan 落盘后进入本阶段）

## 铁律
1. **traceback**（创建/参数错）：根据实际报错来修复。
2. **结果对不上**（能建、改值，但输出和预期不同）：二分，最小复现，孤立，改变一个值测试预期
3. 改完重跑脚本验证，直到输出符合预期才打勾。
4. 一次只建/改**一个模块**，建完必须跑脚本验证（traceback 或输出），通过才打勾，再进下一个模块。

## 打勾推进（workflow\_state.json）

结构：`{project, modules:\[{id,name,idnames,status}], cur, phase}`（wf\_plan 生成，status 默认 "pending"）。

每完成一个模块：

1. 用 write/edit 更新 `workflow\_state.json`：`modules\[cur].status = "done"`，`cur += 1`；
2. 若 `cur < modules.length`：继续下一个模块；
3. 全部模块 done：`phase = "done"`，收尾。


### 工具分工（谁干什么、何时调用）

* **blender\_build** —— 节点树的一切结构操作，禁止用脚本硬编码代替。
* **blender\_math** —— 任何需要数学计算的地方，禁止手摆数学节点。
* **blender\_screen** —— 想知道当前档里有哪些节点。
* **blender\_data** ——想对比"改了某个上游/几何节点值前后，数据变没变、变哪"时。
* **bpy** ——想知道"几何节点对网格的影响，或需要 Python 侧数值分析而 Blender 内工具覆盖不到时。
* **blender\_run**——往blender里面写代码的工具
* **zone\_probe**——节点树里有模拟区时方便你在时间流动的情况下探测想要的数据