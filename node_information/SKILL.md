---
name: "node-information"
description: "Blender 4.5 节点查询、计划与初始化。需要查节点数据、拆解任务、初始化项目时调用。"
---

# Blender 节点查询

脚本由 TS 工具封装，别直接跑。

## 核心概念：idname

- **idname** 是节点的唯一类型名，如 `GeometryNodeSetPosition`。所有查节点都是用 idname。
- 不知道节点的 idname？用 `node_find` 拿词找。

## 工作流程（必须遵守）

1. **思考**：任务大概拆成几个模块？（先猜，这是思考的一部分）
2. **查节点**：不知道 idname 先 `node_find`；每个节点用 `node_full` 查信息。
3. **再思考**：用查到的事实确认/修正模块拆解。
4. **出计划**：`wf_plan <项目名> <模块清单>`（每模块：名称 + idname 清单）→ 落盘 `workflow_state.json`。
5. **最后才动手**：写脚本 / 执行命令。

## 硬规则
- 现在所有数据都只需知道 idname：通过 TS 工具（`node_find` 找名 → `node_full` 查信息 ）就直接返回非常简单易懂的 JSON 文件。
- 不知道 idname 就 `node_find`，别凭记忆猜、别 find/grep 瞎找。
- `wf_plan` 前必须先查过节点；写文件/执行命令前必须已有 `workflow_state.json`。