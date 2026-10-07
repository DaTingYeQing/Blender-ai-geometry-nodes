# ERRORS.en.md — Execution Error Catalog (English)

> **What this is**: one place collecting every **outward-facing** error in execution/ — what you did → what error you get (verbatim) → where it comes from → how to fix it.
> **How to use**: when you hit an error, search its text below to find the layer and the fix.
> **Maintenance**: the quoted error text matches the code **verbatim** (punctuation included); when you change a message in code, come back and update this table; add a row for each new outward-facing error.
> **Scope**: layers ①②③ are deterministic and listed exhaustively; layer ④ (runtime exceptions) can't be enumerated, so it only gives a locating method.
> In the tables, `<angle brackets>` are placeholders and `\n` is a newline in the original text.
> The real error strings are Chinese (they come from the code); they are quoted verbatim so you can grep them.
> Updated: 2026-10-03 (desktop copy only; the repo and .pi copies are not synced yet).
> Chinese version: [ERRORS.md](ERRORS.md)

## 0. The four layers

```
① Channel layer   blender_channel.py        env / usage / run errors, ~25   → the `error` field of the returned dict / CLI stderr
② Batch layer     blender_build/            29 structured codes + hints      → the `errors` array in result.json (with code/where)
③ Parameter layer node_build / screen /     entry-point validation messages  → the `error` field (CLI has exit codes too)
                  blender_math / frame_probe
④ Runtime         a script inside Blender   Python traceback (free text)     → the channel.traceback field
                  actually crashed
```

**Three-step triage** when you get a failure:

1. Read the `error` field first — most of the time it's a plain-language explanation; search its text in ①②③;
2. Then read `channel.traceback` — if present, a script inside the Blender process crashed (layer ④), and the stack shows the exact line;
3. If neither, read the raw `channel.stderr` / `channel.stdout`.

---

## 1. Channel layer — blender_channel.py

### 1.1 Contract at a glance

- **Never raises**: whatever goes wrong, `run()` returns the same dict shape (`ok/exit_code/error/traceback/duration_ms/stdout/stderr/command/blend/saved`).
- **`ok=True` requires all three**: `error is None`, `exit_code == 0`, and stderr contains no `Traceback (most recent call last)`.
- **Exit codes**: on the CLI, normal = Blender's exit code; usage/argument parse errors = **2**; a channel-internal failure (exit_code=-1) = **1**.

### 1.2 Runtime errors (returned in the `error` field; also written to stderr on the CLI)

| Trigger | Message (verbatim) | Fix |
|---|---|---|
| blender.exe is not configured (neither the `BLENDER_EXE` env var nor envcard has it) | `ERROR: 找不到 blender.exe 的路径。\n请先运行下面这条命令，重新生成环境卡片：\n    python <skills/_shared/pyenv.py>\n然后再试一次。<detail>` | Run `pyenv.py` once to regenerate the environment card; or set `BLENDER_EXE` temporarily |
| No `blend` given and no workfile found in the workspace | `还没建工作档。请先 wf_plan 建档（会自动创建并锁定唯一工作档 .blend），再 run。` | Create a workfile first (wf_plan) |
| The workfile is busy with another request (lock wait timed out) | `ERROR: 工作档正被其它请求占用，等待超过 <N> 秒仍拿不到锁。请稍后再试。` | Retry later; make sure no other process is running the same file |
| The lock file cannot be created | `ERROR: 无法创建锁文件 <path>：<os error>` | Check that the system temp directory is writable |
| `timeout` is not a number | `ERROR: timeout 需要是数字，收到的是 <type name>` (for an unparseable string: `收到的是 <value>`) | Pass a number |
| `timeout` < 1, inf or nan | `ERROR: timeout 需要 ≥ 1 的秒数（收到 <value>）；要更长时间请直接给更大的秒数` | Pass a number ≥ 1 |
| `script_args` is not a list (string/number/...) | `ERROR: script_args 需要是一个字符串列表，收到的是 <type>。如果要传单个参数，请写成 ["参数"]` | Wrap it in a list |
| `state_path` / `blend` got a bool or a non-path type | `ERROR: <param> 需要是路径字符串，收到的是布尔值` (or `收到的是 <type>`) | Pass a string path (`save` may be False; it is not covered by this rule) |
| Both `code` and `script` given | `ERROR: code 和 script 只能给一个` | Give only one |
| `-e` with empty content | `ERROR: -e 后面是空的，需要给一段 Python 代码` | Add code |
| `script` is an empty string | `ERROR: 脚本路径是空的，需要给一个 .py 文件路径` | Add a path |
| Neither `code` nor `script` given | `ERROR: 需要给 code 或 script 之一` | Give one |
| The script file does not exist | `ERROR: 找不到脚本文件：<path>` | Check the path |
| Killed after timing out | `ERROR: 超过 <N> 秒还没跑完，已强制结束。（Blender 被中断，工作档可能没来得及完整保存）` | Raise the timeout, or find out why the script hangs |
| Blender cannot start (process spawn failed) | `ERROR: 无法启动 Blender：<os error>\n请检查环境卡片里的 blender.exe 是否真的存在，或运行环境分发器重新生成地址。` | Check the blender.exe path |
| An unexpected channel-internal exception (last-resort catch) | `ERROR: 通道内部异常（<exception type>）：<message>`, with the full stack in the `traceback` field | Read the `traceback` field to locate it |

### 1.3 CLI usage/parse errors (written to stderr, process exit code 2)

| Trigger | Message (verbatim) |
|---|---|
| `-e` with nothing after it | `ERROR: -e 后面需要跟一段 Python 代码` |
| `-e ""` (empty string) | `ERROR: -e 后面是空的，需要给一段 Python 代码` |
| `--timeout` is not an integer number of seconds | `ERROR: --timeout 需要是整数秒，收到：<value>` |
| An unknown option | `ERROR: 未知选项 <option>` |
| `-e` and a script file together | `ERROR: -e 和脚本文件只能给一个` |
| Nothing given at all | `ERROR: 需要给 -e <代码> 或 <脚本.py>（或用 --check 自检）` |
| More than one script file | `ERROR: 只能指定一个脚本文件，收到 <N> 个` |
| `--check` mixed with code/script | `ERROR: --check 不能和代码/脚本一起用` |

### 1.4 `--check` output (a health check, not errors)

| Text you see | Meaning |
|---|---|
| `blender.exe : 未找到` + the same guidance as row 1 above | the address chain is broken; run pyenv.py |
| `警告        : 这个文件不存在，请检查 py_environment.json` | the path is configured but the file is missing |
| `Blender 版本: 获取失败（<exception>）` | the exe will not run |
| `工作区      : 拿不到（envcard 未生成或 workspace.root 为空）` | the workspace is not configured |
| `workflow_state.json : 不存在（还没建档，请先 wf_plan 建档）` | no workfile yet |
| `  （解析失败：<exception>）` | the workfile state file is broken |

---

## 2. Batch layer — blender_build (structured code / hint)

Errors end up in the `errors` array of `node_builder_result.json`, each shaped like `{msg, code, hint, where}`:
`msg` is the verbatim stdout text (prefixed with the action name), `code` is the stable machine-readable id, and `where` points at the object involved (node/socket name, etc.).
The table below is grouped by `code` (29 of them).

| code | Trigger | Message (msg, verbatim) | Fix (hint gist) |
|---|---|---|---|
| `bad_direction` | `interface` direction is neither input nor output | `interface 失败：direction 只能是 input 或 output，收到 <value>` | Use `"input"` or `"output"` (case-insensitive) |
| `interface_no_name` | `interface` is missing `name` | `interface 失败：缺少 name` | Add `name` |
| `bad_socket_type` | `interface` / `add_item` `socket_type` is unrecognized | `interface 失败 [<name>]：认不出 socket 类型 <type>` or `add_item 失败：未知 socket 类型 <type>（可用：…）` | Write the type name (case-insensitive); a list of valid ones is shown |
| `interface_new_failed` | Blender rejected the socket type | `interface 失败 [<name>]: <Blender error>` | Confirm it is one of the valid types |
| `add_no_idname` | `add` list contains an empty item | `add 失败：节点类型名(idname)不能为空` | Do not leave empty items |
| `add_bad_idname` | `add` idname does not exist in this Blender version | `add 失败 [<idname>]：节点类型名/idname 写错了，请核对（如 GeometryNodeMeshCube）—— <Blender error>` | Check with node_full or an idname list |
| `node_not_found` | A referenced node can not be found (shared by add_item/set/link/unlink/del) | prefix (e.g. `set 失败：`, `连线失败（<spec>）：`, `del 失败：`) + `找不到节点 <name>（不是 node.name，也不是某个 idname）`; or `节点 <name> 有 <N> 个，请改用 name 区分：<each name>` | Use blender_screen to get the real name first |
| `not_zone_output` | `add_item` zone is not a zone output node | `add_item 失败：<node> 不是 zone 输出节点（<idname>）` | Point `zone` at the output endpoint |
| `item_new_failed` | A zone item cannot be created | `add_item 失败 [<node>]: <Blender error>` | — |
| `bad_set_spec` | `set` has both `socket` and `prop`, or neither | `set 失败：socket 与 prop 只能填一个（收到 socket=<value>、prop=<value>）` or `set 失败：要填 socket（接口名）或 prop（属性名）之一` | Use `socket` for interface defaults, `prop` for node properties |
| `prop_not_found` | `set` `prop` does not exist on that node | `set 失败：<node> 没有属性 <prop>` | `prop` is a node's own property (operation / data_type / integer…); valid range = non-read-only bl_rna properties |
| `set_prop_failed` | Writing the property was rejected by Blender | `set 失败 [<node>.<prop>] 属性：<error>` | Check the value's type/range |
| `interface_ambiguous` | Duplicate group-boundary interface names, so the target is ambiguous | `set 失败：<name> 在本节点有 <N> 个同名接口（identifier 分别是 …），请改用 identifier 指明是哪一个` | Write the identifier (the word after the interface name in screen detail) |
| `set_interface_failed` | Writing an interface default value failed | `set 失败 [<node>.<socket>] interface：<error>` | Check that the type matches |
| `interface_not_found` | The group boundary has no such interface | `set 失败：<node> 没有对应 interface 项 <socket>（可用：<list>）` | Run screen to see the boundary interfaces |
| `socket_ambiguous` | Duplicate input socket names (shared by set/link/unlink) | prefix (`set 失败：` / `连线失败（<spec>）：` / `unlink 失败：`) + `<name> 在本节点有 <N> 个同名接口（identifier 分别是 …），请改用 identifier 指明是哪一个` | Write the identifier |
| `set_socket_failed` | Writing an input socket default value failed | `set 失败 [<node>.<socket>]：<error>` | Check that the type matches |
| `socket_not_found` | The node has no such input socket | `set 失败：<node> 没有输入接口 <socket>` | Use screen detail to find the input name; for properties use `prop` |
| `wire_format` | The wire string is malformed | `连线失败（<spec>）：连线格式应为 '节点name.接口identifier → 节点name.接口identifier'，收到: <spec>` | Format: nodeName.socket → nodeName.socket |
| `output_not_found` | The source node has no such output | `连线失败（<spec>）：<node> 没有输出接口 <socket>；可用：<list>` | Use the available list |
| `input_not_found` | The destination node has no such input | `连线失败（<spec>）：<node> 没有输入接口 <socket>；可用：<list>` | Use the available list |
| `virtual_socket` | Trying to link directly to the `__extend__` virtual socket | `连线失败（<spec>）：<socket> 是虚拟接口 __extend__，直接连线不会生效。请先用 interface 建对应类型的组接口，再连线。` | Create a group interface first, then link |
| `socket_disabled` | The socket is disabled (a dynamic node's type was not set first) | `连线失败（<spec>）：接口未启用——动态节点请先用 set 设好 data_type 再连` | Set `data_type` first |
| `input_occupied` | The destination input is already linked and is not multi_input | `连线失败（<spec>）：<node> 的输入 <socket> 已连线（只有 multi_input 接口能叠线）` | Unlink first, or use another socket |
| `type_incompatible` | The two sockets' types cannot connect | `连线失败（<spec>）：类型不兼容：<src type> → <dst type>（查隐式转换表）` | Insert a converter node, or change the socket type |
| `link_not_found` | `unlink` (full form) did not find that link | `unlink 失败：没找到 <spec> 这根线` | Use screen to see the actual links |
| `input_not_linked` | `unlink` (short form) target input has no link anyway | `unlink 失败：<node>.<socket> 无输入连线` | Delete links on the output side with the full form |
| `tree_not_found` | Read-only mode (no_create) and the node group does not exist | `节点组 <group> 不存在` | The hint lists the available groups |
| `screen_write_failed` | Writing screen.json failed | `写 screen.json 失败：<dir>（<error>）` | Check that workspace.root is writable |

**Note — warnings** (not errors, but they appear in the result): `接口已建：<dir> <name> (<type>)`, `已建：<node> (<idname>)`, `zone 已自动配对：<node>`, `已加 item <node>.<item>（<type>）`, `已连：<src>.<socket> → <dst>.<socket>`, `已断：<spec>` (or `已断：<node> 的输入 <socket>`), `已删：<node>`, `已同步 <socket> → <N> 个修改器（接口默认值已写进 modifier，渲染立即生效）`, `节点组 <name> 不存在，已自动新建`, `提醒：Group Input/Output 被删，外部输入/输出接不上；补法：跑一次 action=interface（会自动补回）`.

---

## 3. Parameter layer — entry-point validation

### 3.1 Common

| Trigger | Message (verbatim) | Source |
|---|---|---|
| payload is not a JSON object | `payload 必须是 JSON 对象` | node_build / screen |
| CLI failed to read the payload file | `读 payload 失败：<path>（<exception type>: <error>）` (stderr, exit code 2) | node_build / screen |
| The channel file cannot be found | `找不到 blender_channel.py（它应在 skills/execution/，即 <dir>）：<exception type>: <error>` (screen's wording is "应和 screen.py 同目录") | node_build / screen / math_compile |
| The environment card is missing/broken | shows up as `拿不到工作区：读 envcard 失败（FileNotFoundError: 找不到 py_environment.json（从 … 向上找了 6 层）…）` | screen / math_compile / node_build |

### 3.2 node_build.py

| Trigger | Message (verbatim) | Meaning / fix |
|---|---|---|
| No action field at all in the batch | `批次是空的：至少要给一个动作字段（interface/add/add_item/set/link/unlink/del）。` | Batch must carry at least one action key |
| No `out_dir` and no workspace available | `没给 out_dir，也拿不到工作区：读 envcard 失败或 workspace.root 是空的。请在 py_environment.json 里配好 workspace.root，或者在 payload 里显式传 out_dir。` | Configure workspace.root, or pass `out_dir` |
| The output directory cannot be created | `产物目录建不出来：<dir>（<exception type>: <error>）` | Path/permission problem |
| Writing the batch file failed | `写批次文件失败：<path>（<exception type>: <error>）` | Check the directory is writable |
| The payload ran but produced no result.json | summary/error = `没拿到业务结果：<channel error or 读不到 …（exception type: error）>` | The payload likely crashed; read `channel.traceback` |
| Channel or business failure with no specific error | `构建失败（exit=<code>）：<stderr or stdout or (无输出), first 400 chars>` | Fallback summary of the raw output |

### 3.3 screen.py

| Trigger | Message (verbatim) | Meaning / fix |
|---|---|---|
| No `tree` given | `缺少 tree（要查的节点组名，如 AI_Break）。` | Provide the node group name |
| detail mode without `nodes` | `detail 模式需要 nodes（name 或 idname 数组）；只看节点清单请用 detail=overview。` | Pass `nodes`, or use `detail=overview` |
| Reading envcard failed | `拿不到工作区：读 envcard 失败（<exception type>: <error>）。` | Environment card missing/broken |
| workspace.root is empty | `py_environment.json 里的 workspace.root 是空的，请先配好。` | Configure workspace.root |
| Writing the batch file failed | `写批次文件失败：<path>（<exception type>: <error>）` | Check the directory is writable |
| The channel failed | `通道失败（exit=<code>）：<stderr or stdout or (无输出), first 400 chars>` (or the channel's own error if present) | Read traceback/stderr |
| The snapshot file cannot be read | `读不到快照 <path>（<exception type>: <error>）` | The payload probably did not produce screen.json |
| The group does not exist | passes through batch-layer `tree_not_found`: `节点组 <name> 不存在` + the available-groups hint | Check the group name |

### 3.4 blender_math

**math_compile.py** (validation failures return `{"ok": false, "error": …}`):

| Trigger | Message (verbatim) | Meaning / fix |
|---|---|---|
| `type` is not math / vector_math | `ValueError: 未知 type: <value>。应为 'math' 或 'vector_math'。` | Use a valid `type` |
| Input values disagree with `types` | `ValueError: 输入类型检查失败：\n- <each reason>` | Fix the input values or the declared types |
| Missing `expr` | `ValueError: 缺少 expr（数学表达式）。` | Provide the expression |
| Expression syntax / function error | `ValueError: <math_natural's message, see below>` | Fix the expression |
| Missing `group` in a build | `缺少 group（主组名）。build 时必须指定把封装节点组放进哪个主组。` | Pass the main group name |
| Missing `node_name` | `缺少 node_name（主组里那个数学节点的名字）。自己起个短代号，如 delta / rot_axis / size_ratio。` | Give a short code name |
| `node_name` too long | `node_name 太长：<N> 字节，Blender 上限 63 字节（中文 1 字 = 3 字节），超了会被静默截断。当前 <value>，建议压到 20 个字符以内。` | Shorten it |
| `node_name` contains a comma | `node_name 不能含逗号（发现 <char>）：blender_build 的 wires 用逗号分隔多条连线，会把一个名字劈成两条。改成下划线，如 delta_bbox。` | Use underscores |
| `node_name` contains → / -> | `node_name 不能含 <symbol>：那是 blender_build 连线语法里「左边 → 右边」的分隔符，会被当成两个节点。换成 _to_ 之类。` | Use `_to_` instead |
| `node_name` contains newline/tab | `node_name 不能含换行/制表符（它会被写进单行连线字符串）。` | Remove them |
| No `out_dir` and envcard unreadable | `没给 out_dir，也拿不到工作区：读 envcard 失败（<exception type>: <error>）。请在 py_environment.json 里配好 workspace.root，或者在 payload 里显式传 out_dir。` | Configure or pass `out_dir` |
| workspace.root is empty | `没给 out_dir，py_environment.json 里的 workspace.root 也是空的。请给它配一个工作区目录（.blend、生成脚本都落那儿），或者在 payload 里显式传 out_dir。` | Configure or pass `out_dir` |
| The workspace directory cannot be created | `工作区目录建不出来：<dir>（<exception type>: <error>）` | Path/permission problem |
| Write to disk failed | `写盘失败: <error>` | Check the output directory |
| Building nodes failed (channel failure) | `建节点失败（exit=<code>）：<stderr or stdout or (无输出)>` | Read `blender.traceback` |

**math_eval.py**:

| Trigger | Message (verbatim) | Meaning / fix |
|---|---|---|
| `type` is not math / vector_math | `未知 type: <value>。应为 'math' 或 'vector_math'。` | Use a valid `type` |
| Both `inputs` and `grid` given | `inputs 和 grid 不能同时提供，请二选一。` | Provide only one |
| Neither given | `缺少输入值：请提供 inputs 或 grid。` | Provide one |
| Missing `expr` | `缺少 expr（数学表达式）。` | Provide the expression |
| Input value types disagree | `输入类型检查失败：\n- <each reason>` | Fix values/types |
| Expression syntax / function error | `表达式校验失败：\n- <math_natural's message>` | Fix the expression |
| One input row fails to evaluate | that row goes into the `errors` array: `{"input": …, "error": "<exception type>: <error>"}` | Inspect that row's input |

**math_natural.py — expression syntax errors** (raised here, surfaced through the two entry points above):

| Trigger | Message (verbatim) |
|---|---|
| Unsupported constant | `不支持的常量: <value>` |
| Vector constant is not 3 elements | `向量常量必须为 3 元素，收到 <N> 个` / `向量长度必须为 3，收到 <N> 个` |
| `[x,y,z]` contains a non-constant | `[x, y, z] 语法目前只支持全常量，如 [1, 2, 3]` |
| Unsupported structure | `不支持的结构: <type>` |
| Unsupported operator | `不支持的运算符: <type>` / `不支持的一元运算符: <type>` |
| Called something that is not a function | `只支持函数调用，不支持: <AST dump>` |
| Unknown function name | `未知函数: <name>()` |
| Function belongs to the other family | `函数 <name>() 属于 '<other family>' 族，但当前模式是 '<this family>'。请把 type 改为 '<other family>'。` |
| `log` with a single argument | `log(a) 单参已禁用：Blender LOGARITHM 节点在不连 Base 时默认底数为 0.5，log(a) 实际等于 log_0.5(a) = -log2(a)，与自然对数 ln(a) 符号相反。请显式指定底数，例如 log(a, 2.718281828) 表示自然对数、log(a, 2) 表示以 2 为底。` |
| Wrong argument count for `log` | `log() 需要 2 个参数（值 a 与底数 b），收到 <N> 个` |
| Wrong argument count for a generic function | `<fn>() 需要 <N> 个参数，收到 <M> 个` |

### 3.5 frame_probe.py

It runs inside the Blender process (via the channel CLI: `... frame_probe.py --read=new --save=no -- <config.py>`).
Errors show up on stderr as `[frame_probe] ERROR: …` with a non-zero exit code; a Python error (e.g. a bad config) lands in the traceback.

| Trigger | Message (verbatim) |
|---|---|
| No config file given | `[frame_probe] ERROR: 没给配置文件。用法：... frame_probe.py --read=new --save=no -- <配置文件.py>` |
| Config missing BLEND / GROUP / FRAMES | `[frame_probe] ERROR: 配置文件缺少 <key>` |
| Config value has the wrong type | `[frame_probe] ERROR: <key> 应是 <type>，收到 <type>` |
| Config missing the `probe(ctx)` function | `[frame_probe] ERROR: 配置文件缺少 probe(ctx) 函数` |
| Bad FRAMES format | `[frame_probe] ERROR: FRAMES 格式应为 '1-10' / '20' / '30-40'，收到 <value>` |
| Invalid FRAMES range | `[frame_probe] ERROR: FRAMES 区间不合法: <value>` |
| Too many frames collected (limit 100) | `[frame_probe] ERROR: 一次最多采集 <limit> 帧，这个区间要采 <N> 帧（<start>..<end>）（要采更长区间，改 frame_probe.py 的 COLLECT_LIMIT）` |
| End frame beyond limit (100) | `[frame_probe] ERROR: 终点帧 <N> 超过上限 <limit>（要探更后面的帧，改 frame_probe.py 的 END_LIMIT）` |
| The .blend does not exist | `[frame_probe] ERROR: 找不到档 <path>` |
| The .blend has no such node tree | `[frame_probe] ERROR: 档里没有节点树 <name>；现有: <each tree name>` |
| The .blend has no such object | `[frame_probe] ERROR: 档里没有物体 <name>` |
| No object uses that node tree | `[frame_probe] ERROR: 没有物体挂节点树 <name>（请填 OBJECT）` |
| An assert inside the probe failed | `[frame_probe] 探针不变量在第 <N> 帧被打破: <assert message>` (convention: a failing assert in a probe = a definite conclusion, not a bug) |
| Not a single frame was collected | `[frame_probe] ERROR: 没采到任何数据` |

---

## 4. Runtime exceptions (not enumerable) — how to locate

A script running inside the Blender process really crashed (Python exception); the error is free text and cannot be tabulated row by row.
**Common shape**: `channel.ok=false`, `exit_code≠0`, and a stack in `channel.traceback`; each tool then wraps it in plain language:

| Tool | What a runtime failure looks like |
|---|---|
| node_build.py | `没拿到业务结果：…` (payload produced no result.json) or `构建失败（exit=…）：<stderr/stdout, first 400 chars>`; the stack is in `channel.traceback` |
| screen.py | `通道失败（exit=…）：…` or `读不到快照 <path>（…）` |
| math_compile.py | `建节点失败（exit=…）：<stderr or stdout>`; the stack is in the `blender.traceback` field |
| frame_probe.py | `[frame_probe] ERROR: …` comes straight back on stderr; a Python error in the config lands in the traceback |
| blender_data/mian.py | On failure it writes `result.json`: `{"ok": false, "error": "<reason>"}` and prints `[blender_data] FAIL: <first 200 chars>`; reasons like `动画烘焙失败: …`, `基准轮失败: …`, `改值轮失败: …`, `装配失败: …`, `烘焙失败: …` |
| data_groups compile/translate tools | `_recipe_compiler.py`: `KeyError: 路径 key '<key>' 未在 _paths.py 中注册`, `RuntimeError: room.py 中找不到插入锚点 …`; `bake_data_translate.py`: `FileNotFoundError: meta 目录下没有 .json: <dir>` |

**How to locate**: if you have the `traceback` field, read its last line and file/line number; if it failed with no traceback, the problem is more likely in the channel/parameter layer — go back to ①②③.

---

## 5. Cross-layer quick reference

### 5.1 Exit codes

| Situation | Exit code |
|---|---|
| Success | 0 |
| Business failure (tool returned ok=false) | 1 |
| CLI usage/payload-read error (main of node_build / screen / math_*) | 2 |
| blender_channel CLI: usage/parse error | 2 |
| blender_channel CLI: channel-internal failure (exit_code=-1) | 1 |
| blender_channel CLI: normal | Blender's exit code |

### 5.2 The address chain (for anything "path"-related, check this chain first)

`py_environment.json` (the single source of all addresses, one level above skills/)
→ `envcard.py` (auto-generated, do not edit by hand; regenerate with `_shared/pyenv.py`)
→ each tool (the channel reads blender.exe / the workspace; screen, node_build and math_compile read the workspace).

- Temporary override of blender.exe: set the `BLENDER_EXE` environment variable.
- Health check: `python blender_channel.py --check`.

### 5.3 File index

| File | Role |
|---|---|
| blender_channel.py | Layer ①: the shared channel into Blender |
| blender_build/_errors.py | Layer ②: the Issue / Collector definitions |
| blender_build/_actions.py | Layer ②: main source of the 29 codes (the seven actions) |
| blender_build/node_build.py / node_builder.py | Layers ③④: batch entry point / payload |
| screen.py | Layers ③④: read-only snapshot |
| blender_math/math_compile.py / math_eval.py / math_natural.py | Layers ③④: the math suite |
| frame_probe.py | Layers ③④: animation probe (runs inside Blender) |
| blender_data/, data_groups/ | Layer ④: bake/translate tools |
