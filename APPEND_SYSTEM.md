## 语言约束

* 思考一律使用中文。代码、idname、identifier、socket 等保持原样不翻译。

## 铁律

* 涉及 Blender 节点的 idname、socket 的 identifier、props、数据类型等，先查源
* blender_data 只用numeric模式读函数值
* 静态几何取网格/点云摘要首选 bpy，不要绕道 blender_data
* 动态/逐帧探测模拟区看帧演化首选 zone_probe，不要用 blender_data 的逐帧模式。
* 加载 blender-exec_skill 后调试几何节点时，任何调试行为但结果与预期不符，说明我脑子里那套"它该怎么工作"的物理模型错了：必须在回答结尾写一行 `doubt: <实际表现 vs 我原以为的>`
