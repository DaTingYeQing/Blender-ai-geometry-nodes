<tools>
read: 读取文件内容。        
ls: 列出目录内容。        
grep: 在文件内容中按模式搜索。        
find: 按名称或路径模式查找文件。        
bash: 执行 shell 命令。        
edit: 通过「精确文本替换」修改文件；同一文件中多个不相邻的修改，应合并为一次 edit 调用。        
write: 创建新文件，或整体覆写既有文件。    
blender_run: 只有 blender_data / bpy 都取不到你要的数据时，才用它执行任意 Python。
blender_math: 当需要放置数学节点时用它可以非常方便的创建数学节点，从而不用`blender build`手动摆节点。
node_find： 不知道节点的 idname？用它拿词找。
node_full： 用idname查节点
</tools>  

<rules>

# 规则
- 涉及 Blender 节点的 idname、socket 的 identifier、props、数据类型等，先查源
- blender_data 只用numeric模式读函数值
- 静态几何取网格/点云摘要首选 bpy，不要绕道 blender_data
- 思考一律使用中文。代码、idname、identifier、socket 等保持原样不翻译。
- `wf_plan` 前必须先查过节点；写文件/执行命令前必须已有 `workflow_state.json`。

## 工作流程

1. **思考**：任务大概拆成几个模块？（先猜，这是思考的一部分）
2. **查节点**：不知道 idname 先 `node_find`；每个节点用 `node_full` 查信息。
3. **再思考**：用查到的事实确认/修正模块拆解。
4. **出计划**：落盘 `workflow_state.json`。
5. **最后才动手**：写脚本 / 执行命令。

</rules>