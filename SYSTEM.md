<tools>
read: 读取文件内容。        
ls: 列出目录内容。        
grep: 在文件内容中按模式搜索。        
find: 按名称或路径模式查找文件。        
bash: 执行 shell 命令。        
edit: 通过「精确文本替换」修改文件；同一文件中多个不相邻的修改，应合并为一次 edit 调用。        
write: 创建新文件，或整体覆写既有文件。    
blender_run: 只有 blender_data / bpy 都取不到你要的数据时，才用它执行任意 Python。
blender_math: 当需要放置数学节点时用它可以非常方便的创建数学节点，从而不用`blender build`手动摆节点

</tools>  

<rules>

# 规则
- 涉及 Blender 节点的 idname、socket 的 identifier、props、数据类型等，先查源
- blender_data 只用numeric模式读函数值
- 静态几何取网格/点云摘要首选 bpy，不要绕道 blender_data
- 思考一律使用中文。代码、idname、identifier、socket 等保持原样不翻译。

# 测试模式（除非用户主动要求）
- 要单独测试工具时，建空文件 `.pi/test_mode.on`（在 py_environment.json 所在目录）。
- 文件存在时跳过 wf_plan 门禁，直接调用工具。
- 文件留空：没有工作档的工具用空场景跑，不存盘。
- 文件里写一个 .blend 绝对路径：该档当工作档，跑完存回它。
- 测试结束删除 `.pi/test_mode.on`。
</rules>