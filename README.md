#ai-geometry-nodes (AI-generated Blender Geometry Nodes)

Introduction:
Tell the AI what you need (in as much detail as possible). The AI will break your request down into math problems, verify them, then look up node information, and finally build the geometry nodes inside Blender.

Skills:
math (used for early-stage math verification in Python; some packages need to be installed — details below)
node_information (the node information tool mentioned earlier; it is a database containing detailed info about geometry nodes)
execution (a tool for building and testing)

Limitations:
Only works with Blender 4.5.0 (the blender-4.5.0-windows-x64.zip build from the official site). Different Blender versions may add or update geometry nodes, so some node information changes, which mainly affects the usability of these skills.

Setup:
In the py_environment file, I have marked the three paths that need to be changed.
Place all .ts files flat into the extensions folder, and place the four folders flat into the skills folder.
Make sure Python and its dependency packages are installed (see below).

Python 3.13.14

Package	                        Version
pyvista	                        0.48.4
trimesh	                        5.0.0
numpy	                        2.5.2
scipy	                        1.18.1
manifold3d	                3.5.2


Workflow:
Just tell the AI: "Load the math or node_information skill, and help me build something in Blender." (I say "or" because some tasks are simple enough that no math verification is needed — the AI can look up the nodes and build directly. Sometimes the AI will load the math skill on its own, but ultimately that is up to you.)

After one skill finishes its task, the AI will load the next skill by itself; it does not load all of them at once (occasionally it does, but that is rare). Also, sometimes after finishing one skill the AI may fail to load the next one (this happened in my testing, but it is also rare).

Tool descriptions:
blender_math.ts: Lets the AI build math nodes quickly. The AI only needs to enter a math expression in this front end, and the background script automatically verifies it (eval) and builds the node group (build).

blender_build.ts: Lets the AI operate on the node tree quickly (add, link, unlink, del, set, interface, add item). The AI just needs to write small entries in the given format to perform the operations.

blender_screen.ts: This is the AI's eyes. It lets the AI quickly see which nodes exist in the node tree (rough mode), and which socket on a specific node is connected to which other node's socket (detailed mode).

bpy.ts: This is the bridge to the external Python. The AI uses it to export models from inside Blender directly to Python, and with the help of the external packages () it can read the data it wants.

node_query.ts: Gives the AI static and dynamic information about nodes. From a vague memory, the AI can first find a node's idname (find mode), then enter the idname to get the full details of that node (node full mode).

wf_plan.ts: A modular task list. The AI calls this tool after completing the early-stage testing.

blender.ts: A fixed channel for sending scripts into Blender. When the tools above cannot help the AI, it will write code directly and send it to Blender to get what it wants.

py_environment.ts: The environment configuration file.







# ai-geometry-nodes-AI-Blender-
简介：
告诉ai你的需求（尽可能详细），ai会帮助你自动拆解为数学问题，验证完后查询节点信息，然后在blender里面开发几何节点

skill：
math（用来前期在python里面做数学验证，要安装一些包，后面详细说）
node_information（这个就是前面说的关于节点信息的工具，这是一个数据库，里面有几何节点的很多信息）
execution（用来建立，测试，的工具）

限制：
只适用于blender4.5.0版本（blender-4.5.0-windows-x64.zip 官网上的这个版本），因为不同版本的几何节点可能会伴随着一些更新或者增加，一些节点信息会变，主要会影响到一些工具的使用
skill

配置：
py_environment 文件里面我标注好了需要改的三个地址
把所有ts文件全部平铺到extensions里面，四个文件夹全部平铺到skill里面
要下载好python


流程：
只需要对ai说：加载math或者node_information skill，帮我在blender里面做一些什么。（我说或者是因为有些任务可能比较简单，不需要数学验证，可以直接查节点然后直接建，当然有时候ai会自己去加载math skill，不过这最终还是取决于你）

然后一个skill完成任务后ai会自己加载下一个skill，他不会全部一次性加载（有时候也会，概率低），当然有时候他完成上一个skill他也可能不会加载下一个skill（我测试出来有可能这样，概率也比较低）

工具介绍：
blender_math.ts：这是为了方便ai快速建立数学节点，ai只需要在这个前端内输入数学式子，后台的脚本会自动帮他验证（eval）并建立节点组（build）

blender_build.ts：这是为了方便ai快速对节点树操作（add，link，unlink，del，set，interface，add item）ai只只需要根据格式快速写一些单子就能完成操作

blender_screen.ts：这是ai的眼睛，方便ai快速看到节点树里面有什么节点（粗略模式），具体哪个节点上面的接口连了其他节点的接口（详细模式）

bpy.ts：这个是外部python的连接途径，ai会通过这个东西把blender内部的模型直接导出到py里面，依靠外部包（）的帮助，直接读取ai想要的数据

node_query.ts：这个是告诉ai节点的一些静态和动态的信息，ai可以根据自己模糊的记忆知道节点的idname是啥（find模式），然后再输入idname来告诉ai这个节点的信息（node full模式）。

wf_plan.ts：这是一个模块化任务单，ai在完成前期测试后会调用此工具

blender.ts：这个是固定往blender里面发脚本的通道，当上述工具无法帮助ai时ai会直接写代码发到blender来得到自己想要的东西

py_environment.ts：环境配置文件
