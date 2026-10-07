# ERRORS.md —— execution 报错总表

> **干嘛的**：把 execution/ 里所有**对外**的报错收在一处 —— 什么行为 → 报什么错（原文）→ 从哪出 → 怎么处理。
> **怎么用**：拿到一条报错，按原文在下文搜一下，立刻知道是哪层、怎么修。
> **维护约定**：本表的报错原文与代码**逐字一致**（含标点）；改了代码里的文案，回来同步本表；新增对外报错，在对应层加一行。
> **范围**：①②③ 是确定性报错，逐条收录；④ 运行期异常不可穷举，只讲定位法。
> 表里的 `<尖括号>` 是占位符；`\n` 表示原文里的换行。
> 更新：2026-10-03（只对应桌面副本；repo / .pi 两份尚未同步）。
> 英文版：[ERRORS.en.md](ERRORS.en.md)

## 0. 四层结构总览

```
① 通道层   blender_channel.py        环境/用法/运行错误，~25 条     → 返回体的 error 字段 / CLI stderr
② 批次层   blender_build/            29 个结构化 code + hint        → result.json 的 errors 数组（带 code/where）
③ 参数层   node_build / screen /     入口校验文案                   → 返回体的 error 字段（CLI 另有退出码）
           blender_math / frame_probe
④ 运行期   进 Blender 的脚本真崩了    Python traceback（自由文本）   → channel.traceback 字段
```

拿到失败结果时的**三步定位**：

1. 先看 `error` 字段 —— 多数时候是人话说明，直接照 ①②③ 的表搜原文；
2. 再看 `channel.traceback` —— 有它 = Blender 进程里的脚本崩了（④ 层），堆栈在哪行写得清清楚楚；
3. 都没有就看 `channel.stderr` / `channel.stdout` 原文。

---

## 1. 通道层 —— blender_channel.py

### 1.1 契约速查

- **永不抛异常**：不管出什么错，`run()` 都返回同一个 dict（`ok/exit_code/error/traceback/duration_ms/stdout/stderr/command/blend/saved`）。
- **ok=True 三条件（缺一不可）**：`error is None`、`exit_code == 0`、stderr 不含 `Traceback (most recent call last)`。
- **退出码**：CLI 下正常时 = Blender 的退出码；用法/参数解析错误 = **2**；通道自身失败（exit_code=-1）= **1**。

### 1.2 运行期报错（进返回体的 `error` 字段；CLI 下同时打到 stderr）

| 什么行为 | 报错原文 | 怎么处理 |
|---|---|---|
| 机器上没配 blender.exe（环境变量 `BLENDER_EXE` 和 envcard 里都没有） | `ERROR: 找不到 blender.exe 的路径。\n请先运行下面这条命令，重新生成环境卡片：\n    python <skills/_shared/pyenv.py>\n然后再试一次。<详情>` | 跑一次 `pyenv.py` 重建环境卡片；或临时设 `BLENDER_EXE` 环境变量 |
| 没给 blend，且工作区里也翻不到工作档 | `还没建工作档。请先 wf_plan 建档（会自动创建并锁定唯一工作档 .blend），再 run。` | 先 wf_plan 建档 |
| 工作档被其它请求占着，等锁超时 | `ERROR: 工作档正被其它请求占用，等待超过 <N> 秒仍拿不到锁。请稍后再试。` | 稍后重试；确认没有另一个进程在跑同一个档 |
| 锁文件建不出来 | `ERROR: 无法创建锁文件 <路径>：<系统错误>` | 检查系统临时目录是否可写 |
| timeout 传了非数字 | `ERROR: timeout 需要是数字，收到的是 <类型名>`（字符串但解析不了时是 `收到的是 <值>`） | 传数字 |
| timeout 小于 1、inf、nan | `ERROR: timeout 需要 ≥ 1 的秒数（收到 <值>）；要更长时间请直接给更大的秒数` | 给 ≥1 的数字 |
| script_args 不是列表（给了字符串/数字等） | `ERROR: script_args 需要是一个字符串列表，收到的是 <类型>。如果要传单个参数，请写成 ["参数"]` | 包成列表 |
| state_path / blend 传了布尔值或非路径类型 | `ERROR: <参数名> 需要是路径字符串，收到的是布尔值`（或 `收到的是 <类型>`） | 传字符串路径（`save` 允许传 False，不在此列） |
| code 和 script 同时给了 | `ERROR: code 和 script 只能给一个` | 二选一 |
| `-e` 后面跟的是空内容 | `ERROR: -e 后面是空的，需要给一段 Python 代码` | 补代码 |
| script 给了空串 | `ERROR: 脚本路径是空的，需要给一个 .py 文件路径` | 补路径 |
| code / script 一个都没给 | `ERROR: 需要给 code 或 script 之一` | 给一个 |
| 脚本文件不存在 | `ERROR: 找不到脚本文件：<路径>` | 核对路径 |
| 跑超时被强杀 | `ERROR: 超过 <N> 秒还没跑完，已强制结束。（Blender 被中断，工作档可能没来得及完整保存）` | 加大 timeout，或查脚本为什么卡住 |
| Blender 起不来（进程启动失败） | `ERROR: 无法启动 Blender：<系统错误>\n请检查环境卡片里的 blender.exe 是否真的存在，或运行环境分发器重新生成地址。` | 体检 blender.exe 路径 |
| 通道自己出未预期异常（兜底） | `ERROR: 通道内部异常（<异常类型>）：<消息>`，同时 `traceback` 字段存完整堆栈 | 看 traceback 字段定位 |

### 1.3 CLI 用法/解析错误（写 stderr，进程退出码 2）

| 什么行为 | 报错原文 |
|---|---|
| `-e` 后面没跟内容 | `ERROR: -e 后面需要跟一段 Python 代码` |
| `-e ""`（空字符串） | `ERROR: -e 后面是空的，需要给一段 Python 代码` |
| `--timeout` 不是整数秒 | `ERROR: --timeout 需要是整数秒，收到：<值>` |
| 给了不认识的选项 | `ERROR: 未知选项 <选项>` |
| `-e` 和脚本文件同时给 | `ERROR: -e 和脚本文件只能给一个` |
| 什么都没给 | `ERROR: 需要给 -e <代码> 或 <脚本.py>（或用 --check 自检）` |
| 给了多个脚本文件 | `ERROR: 只能指定一个脚本文件，收到 <N> 个` |
| `--check` 和代码/脚本混用 | `ERROR: --check 不能和代码/脚本一起用` |

### 1.4 `--check` 自检提示（体检输出，不算报错）

| 看到的文字 | 含义 |
|---|---|
| `blender.exe : 未找到` + 上面第 1 条同款指引 | 地址链断了，跑 pyenv.py |
| `警告        : 这个文件不存在，请检查 py_environment.json` | 地址写了但文件不在 |
| `Blender 版本: 获取失败（<异常>）` | exe 起不来 |
| `工作区      : 拿不到（envcard 未生成或 workspace.root 为空）` | 工作区没配 |
| `workflow_state.json : 不存在（还没建档，请先 wf_plan 建档）` | 还没建档 |
| `  （解析失败：<异常>）` | 建档文件坏了 |

---

## 2. 批次层 —— blender_build（结构化 code / hint）

错误最终进 `node_builder_result.json` 的 `errors` 数组，每条形如 `{msg, code, hint, where}`：
`msg` 是给 stdout 的原文（前缀 = 动作名），`code` 是给程序判断的稳定标识，`where` 指出出错对象（节点名/接口名等）。
下表按 `code` 汇总（共 29 个）。

| code | 什么行为 | 报错原文（msg） | 处理（hint 要点） |
|---|---|---|---|
| `bad_direction` | interface 的 direction 不是 input/output | `interface 失败：direction 只能是 input 或 output，收到 <值>` | 填 "input" 或 "output"（大小写不限） |
| `interface_no_name` | interface 缺 name | `interface 失败：缺少 name` | 补 name |
| `bad_socket_type` | interface / add_item 的 socket_type 认不出 | `interface 失败 [<名>]：认不出 socket 类型 <类型>` 或 `add_item 失败：未知 socket 类型 <类型>（可用：…）` | 写类型名即可（大小写不限），有可用清单 |
| `interface_new_failed` | Blender 拒了该 socket 类型 | `interface 失败 [<名>]: <Blender 报错>` | 核对应是可用类型之一 |
| `add_no_idname` | add 列表里有空项 | `add 失败：节点类型名(idname)不能为空` | 别留空项 |
| `add_bad_idname` | add 的 idname 不存在于本版本 | `add 失败 [<idname>]：节点类型名/idname 写错了，请核对（如 GeometryNodeMeshCube）—— <Blender 报错>` | 用 node_full 或 idname 清单核对 |
| `node_not_found` | 引用的节点找不到（add_item/set/link/unlink/del 共用） | 前缀（如 `set 失败：`、`连线失败（<原文>）：`、`del 失败：`）+ `找不到节点 <名>（不是 node.name，也不是某个 idname）`；或 `节点 <名> 有 <N> 个，请改用 name 区分：<各 name>` | 先用 blender_screen 查真实 name |
| `not_zone_output` | add_item 的 zone 不是 zone 输出节点 | `add_item 失败：<节点名> 不是 zone 输出节点（<idname>）` | zone 要填输出端点 |
| `item_new_failed` | zone item 建不出来 | `add_item 失败 [<节点名>]: <Blender 报错>` | — |
| `bad_set_spec` | set 里 socket 与 prop 同给、或都没给 | `set 失败：socket 与 prop 只能填一个（收到 socket=<值>、prop=<值>）` 或 `set 失败：要填 socket（接口名）或 prop（属性名）之一` | 设接口默认值用 socket；改节点属性用 prop |
| `prop_not_found` | set 的 prop 在该节点不存在 | `set 失败：<节点名> 没有属性 <属性名>` | prop 是节点自身属性名（operation / data_type / integer…），可用范围 = bl_rna 非只读属性 |
| `set_prop_failed` | 写属性被 Blender 拒 | `set 失败 [<节点名>.<属性名>] 属性：<报错>` | 检查值的类型/范围 |
| `interface_ambiguous` | 组边界接口重名，没法确定指哪个 | `set 失败：<名> 在本节点有 <N> 个同名接口（identifier 分别是 …），请改用 identifier 指明是哪一个` | 写 identifier（screen 详情里接口名后面的词） |
| `set_interface_failed` | interface 默认值写失败 | `set 失败 [<节点名>.<接口>] interface：<报错>` | 检查类型是否匹配 |
| `interface_not_found` | 组边界没有这个接口 | `set 失败：<节点名> 没有对应 interface 项 <接口>（可用：<清单>）` | 先 screen 看边界接口 |
| `socket_ambiguous` | 输入口重名（set/link/unlink 共用） | 前缀（`set 失败：` / `连线失败（<原文>）：` / `unlink 失败：`）+ `<名> 在本节点有 <N> 个同名接口（identifier 分别是 …），请改用 identifier 指明是哪一个` | 写 identifier |
| `set_socket_failed` | 输入口默认值写失败 | `set 失败 [<节点名>.<接口>]：<报错>` | 检查类型是否匹配 |
| `socket_not_found` | 节点没有这个输入口 | `set 失败：<节点名> 没有输入接口 <接口>` | 用 screen detail 查输入口名；改属性请用 prop |
| `wire_format` | 连线字符串不符合格式 | `连线失败（<原文>）：连线格式应为 '节点name.接口identifier → 节点name.接口identifier'，收到: <原文>` | 格式：节点name.接口 → 节点name.接口 |
| `output_not_found` | 源节点没有这个输出口 | `连线失败（<原文>）：<节点> 没有输出接口 <接口>；可用：<清单>` | 按可用清单改 |
| `input_not_found` | 目标节点没有这个输入口 | `连线失败（<原文>）：<节点> 没有输入接口 <接口>；可用：<清单>` | 按可用清单改 |
| `virtual_socket` | 想直连 `__extend__` 虚拟口 | `连线失败（<原文>）：<接口> 是虚拟接口 __extend__，直接连线不会生效。请先用 interface 建对应类型的组接口，再连线。` | 先建组接口再连 |
| `socket_disabled` | 接口未启用（动态节点没先定类型） | `连线失败（<原文>）：接口未启用——动态节点请先用 set 设好 data_type 再连` | 先 set data_type |
| `input_occupied` | 目标输入已连线且不是 multi_input | `连线失败（<原文>）：<节点> 的输入 <接口> 已连线（只有 multi_input 接口能叠线）` | 先 unlink 或换口 |
| `type_incompatible` | 两个接口类型不能连 | `连线失败（<原文>）：类型不兼容：<源类型> → <目标类型>（查隐式转换表）` | 中间加转换节点，或改接口类型 |
| `link_not_found` | unlink 全式没找到这根线 | `unlink 失败：没找到 <原文> 这根线` | 用 screen 看实际连线 |
| `input_not_linked` | unlink 短式目标输入本来就没线 | `unlink 失败：<节点>.<接口> 无输入连线` | 输出侧的线要用全式断 |
| `tree_not_found` | 只读模式（no_create）下节点组不存在 | `节点组 <组名> 不存在` | hint 里直接列出可用组 |
| `screen_write_failed` | 写 screen.json 失败 | `写 screen.json 失败：<目录>（<报错>）` | 检查 workspace.root 是否可写 |

**附：warnings（不算报错，但会出现在结果里）**：
`接口已建：<方向> <名> (<类型>)`、`已建：<节点名> (<idname>)`、`zone 已自动配对：<节点名>`、`已加 item <节点>.<项>（<类型>）`、`已连：<源节点>.<接口> → <目标节点>.<接口>`、`已断：<原文>`（或 `已断：<节点> 的输入 <接口>`）、`已删：<节点名>`、`已同步 <接口> → <N> 个修改器（接口默认值已写进 modifier，渲染立即生效）`、`节点组 <名> 不存在，已自动新建`、`提醒：Group Input/Output 被删，外部输入/输出接不上；补法：跑一次 action=interface（会自动补回）`。

---

## 3. 参数层 —— 各入口的前置校验

### 3.1 通用

| 什么行为 | 报错原文 | 出处 |
|---|---|---|
| payload 不是 JSON 对象 | `payload 必须是 JSON 对象` | node_build / screen |
| CLI 读 payload 文件失败 | `读 payload 失败：<路径>（<异常类型>: <报错>）`（stderr，退出码 2） | node_build / screen |
| 找不到通道文件 | `找不到 blender_channel.py（它应在 skills/execution/，即 <目录>）：<异常类型>: <报错>`（screen 的文案是「应和 screen.py 同目录」） | node_build / screen / math_compile |
| 环境卡片缺失/坏了 | 表现为 `拿不到工作区：读 envcard 失败（FileNotFoundError: 找不到 py_environment.json（从 … 向上找了 6 层）…）` | screen / math_compile / node_build |

### 3.2 node_build.py

| 什么行为 | 报错原文 |
|---|---|
| 批次里一个动作字段都没给 | `批次是空的：至少要给一个动作字段（interface/add/add_item/set/link/unlink/del）。` |
| 没给 out_dir 也拿不到工作区 | `没给 out_dir，也拿不到工作区：读 envcard 失败或 workspace.root 是空的。请在 py_environment.json 里配好 workspace.root，或者在 payload 里显式传 out_dir。` |
| 产物目录建不出来 | `产物目录建不出来：<目录>（<异常类型>: <报错>）` |
| 写批次文件失败 | `写批次文件失败：<路径>（<异常类型>: <报错>）` |
| 载荷跑完但没产出 result.json | summary/error = `没拿到业务结果：<通道 error 或 读不到 …（异常类型: 报错）>` |
| 通道或业务失败且没给具体 error | `构建失败（exit=<退出码>）：<stderr 或 stdout 或 (无输出)，截前 400 字>` |

### 3.3 screen.py

| 什么行为 | 报错原文 |
|---|---|
| 没给 tree | `缺少 tree（要查的节点组名，如 AI_Break）。` |
| detail 模式没给 nodes | `detail 模式需要 nodes（name 或 idname 数组）；只看节点清单请用 detail=overview。` |
| 读 envcard 失败 | `拿不到工作区：读 envcard 失败（<异常类型>: <报错>）。` |
| workspace.root 为空 | `py_environment.json 里的 workspace.root 是空的，请先配好。` |
| 写批次文件失败 | `写批次文件失败：<路径>（<异常类型>: <报错>）` |
| 通道失败 | `通道失败（exit=<退出码>）：<stderr 或 stdout 或 (无输出)，截前 400 字>`（通道有 error 时直接用通道 error） |
| 快照文件读不到 | `读不到快照 <路径>（<异常类型>: <报错>）` |
| 组不存在 | 透传批次层 `tree_not_found` 的 msg + hint（即「节点组 <名> 不存在」+ 可用组清单） |

### 3.4 blender_math

**math_compile.py**（校验失败时返回 `{"ok": false, "error": …}`）：

| 什么行为 | 报错原文 |
|---|---|
| type 不是 math / vector_math | `ValueError: 未知 type: <值>。应为 'math' 或 'vector_math'。` |
| 输入值与 types 不符 | `ValueError: 输入类型检查失败：\n- <逐条原因>` |
| 缺 expr | `ValueError: 缺少 expr（数学表达式）。` |
| 表达式语法/函数错误 | `ValueError: <math_natural 的报错，见下表>` |
| build 时缺 group | `缺少 group（主组名）。build 时必须指定把封装节点组放进哪个主组。` |
| 缺 node_name | `缺少 node_name（主组里那个数学节点的名字）。自己起个短代号，如 delta / rot_axis / size_ratio。` |
| node_name 太长 | `node_name 太长：<N> 字节，Blender 上限 63 字节（中文 1 字 = 3 字节），超了会被静默截断。当前 <值>，建议压到 20 个字符以内。` |
| node_name 含逗号 | `node_name 不能含逗号（发现 <字符>）：blender_build 的 wires 用逗号分隔多条连线，会把一个名字劈成两条。改成下划线，如 delta_bbox。` |
| node_name 含 → / -> | `node_name 不能含 <符号>：那是 blender_build 连线语法里「左边 → 右边」的分隔符，会被当成两个节点。换成 _to_ 之类。` |
| node_name 含换行/制表符 | `node_name 不能含换行/制表符（它会被写进单行连线字符串）。` |
| 没给 out_dir 且读不到 envcard | `没给 out_dir，也拿不到工作区：读 envcard 失败（<异常类型>: <报错>）。请在 py_environment.json 里配好 workspace.root，或者在 payload 里显式传 out_dir。` |
| workspace.root 为空 | `没给 out_dir，py_environment.json 里的 workspace.root 也是空的。请给它配一个工作区目录（.blend、生成脚本都落那儿），或者在 payload 里显式传 out_dir。` |
| 工作区目录建不出来 | `工作区目录建不出来：<目录>（<异常类型>: <报错>）` |
| 写盘失败 | `写盘失败: <报错>` |
| 建节点失败（通道失败） | `建节点失败（exit=<退出码>）：<stderr 或 stdout 或 (无输出)>` |

**math_eval.py**：

| 什么行为 | 报错原文 |
|---|---|
| type 不是 math / vector_math | `未知 type: <值>。应为 'math' 或 'vector_math'。` |
| inputs 和 grid 同时给 | `inputs 和 grid 不能同时提供，请二选一。` |
| 两样都没给 | `缺少输入值：请提供 inputs 或 grid。` |
| 缺 expr | `缺少 expr（数学表达式）。` |
| 输入值类型不符 | `输入类型检查失败：\n- <逐条原因>` |
| 表达式语法/函数错误 | `表达式校验失败：\n- <math_natural 的报错>` |
| 某一行输入求值出错 | 该行进 `errors` 数组：`{"input": …, "error": "<异常类型>: <报错>"}` |

**math_natural.py —— 表达式语法报错**（本体是 raise，经上面两个入口透出）：

| 什么行为 | 报错原文 |
|---|---|
| 常量不支持 | `不支持的常量: <值>` |
| 向量常量元素数不是 3 | `向量常量必须为 3 元素，收到 <N> 个` / `向量长度必须为 3，收到 <N> 个` |
| [x,y,z] 里含非纯常量 | `[x, y, z] 语法目前只支持全常量，如 [1, 2, 3]` |
| 结构不支持 | `不支持的结构: <类型>` |
| 运算符不支持 | `不支持的运算符: <类型>` / `不支持的一元运算符: <类型>` |
| 调用了非函数 | `只支持函数调用，不支持: <AST 内容>` |
| 函数名不认识 | `未知函数: <名>()` |
| 函数属于另一个族 | `函数 <名>() 属于 '<另一族>' 族，但当前模式是 '<本族>'。请把 type 改为 '<另一族>'。` |
| log 只给一个参数 | `log(a) 单参已禁用：Blender LOGARITHM 节点在不连 Base 时默认底数为 0.5，log(a) 实际等于 log_0.5(a) = -log2(a)，与自然对数 ln(a) 符号相反。请显式指定底数，例如 log(a, 2.718281828) 表示自然对数、log(a, 2) 表示以 2 为底。` |
| log 参数个数不对 | `log() 需要 2 个参数（值 a 与底数 b），收到 <N> 个` |
| 一般函数参数个数不对 | `<函数名>() 需要 <N> 个参数，收到 <M> 个` |

### 3.5 frame_probe.py

它在 Blender 进程里跑（经通道 CLI：`... frame_probe.py --read=new --save=no -- <配置文件.py>`），
报错以 `[frame_probe] ERROR: …` 出现在 stderr 里，退出码非 0；Python 异常（如配置里写错）则落到 traceback。

| 什么行为 | 报错原文 |
|---|---|
| 没给配置文件 | `[frame_probe] ERROR: 没给配置文件。用法：... frame_probe.py --read=new --save=no -- <配置文件.py>` |
| 配置缺 BLEND / GROUP / FRAMES | `[frame_probe] ERROR: 配置文件缺少 <键名>` |
| 配置项类型不对 | `[frame_probe] ERROR: <键名> 应是 <类型>，收到 <类型>` |
| 缺 probe(ctx) 函数 | `[frame_probe] ERROR: 配置文件缺少 probe(ctx) 函数` |
| FRAMES 格式错 | `[frame_probe] ERROR: FRAMES 格式应为 '1-10' / '20' / '30-40'，收到 <值>` |
| FRAMES 区间不合法 | `[frame_probe] ERROR: FRAMES 区间不合法: <值>` |
| 采集帧数超上限（100） | `[frame_probe] ERROR: 一次最多采集 <上限> 帧，这个区间要采 <N> 帧（<起>..<止>）（要采更长区间，改 frame_probe.py 的 COLLECT_LIMIT）` |
| 终点帧超上限（100） | `[frame_probe] ERROR: 终点帧 <N> 超过上限 <上限>（要探更后面的帧，改 frame_probe.py 的 END_LIMIT）` |
| 档不存在 | `[frame_probe] ERROR: 找不到档 <路径>` |
| 档里没有该节点树 | `[frame_probe] ERROR: 档里没有节点树 <名>；现有: <各树名>` |
| 档里没有该物体 | `[frame_probe] ERROR: 档里没有物体 <名>` |
| 没有物体挂该节点树 | `[frame_probe] ERROR: 没有物体挂节点树 <名>（请填 OBJECT）` |
| 探针里的 assert 失败 | `[frame_probe] 探针不变量在第 <N> 帧被打破: <assert 消息>`（约定：探针里 assert 失败 = 明确结论，不是 bug） |
| 一帧都没采到 | `[frame_probe] ERROR: 没采到任何数据` |

---

## 4. 运行期异常（不可穷举）—— 定位法

Blender 进程里跑的脚本真崩了（Python 异常），错误是自由文本，无法逐条收录。
**统一表现**：`channel.ok=false`、`exit_code≠0`、`channel.traceback` 里有堆栈；各工具再包一层人话：

| 工具 | 运行期失败时的表现 |
|---|---|
| node_build.py | `没拿到业务结果：…`（载荷没产出 result.json）或 `构建失败（exit=…）：<stderr/stdout 前 400 字>`；traceback 在 `channel.traceback` |
| screen.py | `通道失败（exit=…）：…` 或 `读不到快照 <路径>（…）` |
| math_compile.py | `建节点失败（exit=…）：<stderr 或 stdout>`；`blender.traceback` 字段存堆栈 |
| frame_probe.py | `[frame_probe] ERROR: …` 走 stderr 原样带回；配置里写错 Python 则落 traceback |
| blender_data/mian.py | 失败写 `result.json`：`{"ok": false, "error": "<原因>"}`，stdout 打 `[blender_data] FAIL: <原因前 200 字>`；原因如 `动画烘焙失败: …`、`基准轮失败: …`、`改值轮失败: …`、`装配失败: …`、`烘焙失败: …` |
| data_groups 编译/翻译类工具 | `_recipe_compiler.py`：`KeyError: 路径 key '<键>' 未在 _paths.py 中注册`、`RuntimeError: room.py 中找不到插入锚点 …`；`bake_data_translate.py`：`FileNotFoundError: meta 目录下没有 .json: <目录>` |

**定位法**：`traceback` 字段在手 = 直接看堆栈最后一行和文件行号；没有 traceback 却失败 = 更可能是通道层/参数层的问题，回头查 ①②③。

---

## 5. 跨层速查

### 5.1 退出码

| 场景 | 退出码 |
|---|---|
| 成功 | 0 |
| 业务失败（工具返回 ok=false） | 1 |
| CLI 用法/payload 读取错误（node_build / screen / math_* 的 main） | 2 |
| blender_channel CLI：用法/解析错误 | 2 |
| blender_channel CLI：通道自身失败（exit_code=-1） | 1 |
| blender_channel CLI：正常 | Blender 的退出码 |

### 5.2 地址链（报错里跟"路径"有关的，先查这条链）

`py_environment.json`（唯一配置处，在 skills/ 上一级）
→ `envcard.py`（自动生成，请勿手改；由 `_shared/pyenv.py` 重新生成）
→ 各工具（channel 取 blender.exe / 工作区；screen、node_build、math_compile 取工作区）。

- 临时覆盖 blender.exe：设环境变量 `BLENDER_EXE`。
- 体检：`python blender_channel.py --check`。

### 5.3 相关文件

| 文件 | 角色 |
|---|---|
| blender_channel.py | ① 层：通往 Blender 的公共通道 |
| blender_build/_errors.py | ② 层的 Issue / Collector 结构定义 |
| blender_build/_actions.py | ② 层 29 个 code 的主要出处（七个动作） |
| blender_build/node_build.py / node_builder.py | ③④ 层：批次入口 / 载荷 |
| screen.py | ③④ 层：只读快照 |
| blender_math/math_compile.py / math_eval.py / math_natural.py | ③④ 层：数学套件 |
| frame_probe.py | ③④ 层：动画探针（跑在 Blender 里） |
| blender_data/、data_groups/ | ④ 层：烘焙/翻译类工具 |
