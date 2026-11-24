# blender_fit 后端结构

这个目录是 `blender_fit` 工具的 Python 后端。总体分工：

- **引擎只做编排**：按固定顺序启动 Blender、读 schema、循环 ask/evaluate/tell、调用卡片。
- **Blender 卡**：处理 socket、值类型、测量。
- **工具卡**：处理参考数据、打分、预算、失败策略、热启动、报告。

## 目录树

```text
shard/fitting/
├── __init__.py                 # 包声明；Blender 内只 import contract/translator
├── contract.py                 # 纯数据契约：KIND / Component / ParamSpec / SearchSpace
├── translator.py               # 值翻译：socket→搜索空间、采样、raw→packed、packed→原生值
├── config.py                   # 基础配置校验 + 找 socket + 生成搜索空间
├── engine.py                   # 编排循环（python -m fitting.engine）
├── base.py                     # 外侧底座：启动/管理常驻 Blender，协议读写、超时、日志
├── host.py                     # Blender 内脚本：定位节点、写值、刷新、导出网格
├── errors.py                   # 共享异常 ConfigError
├── example_config.json         # 配置示例（脚本来源）
│
├── core/                       # 引擎侧的槽位接口与运行上下文
│   ├── __init__.py
│   ├── cards.py                # ToolCard + 各槽位接口
│   ├── context.py              # RunContext：引擎与卡片唯一共享状态
│   ├── registry.py             # 槽位→卡片注册表、默认卡、cards 覆盖、配置分发
│   ├── flatten.py              # 嵌套摘要 → 点号扁平字段
│   └── fs.py                   # file_stamp / unlink_quiet
│
├── cards/
│   ├── __init__.py             # 值类型卡注册表：KIND → 模块，按需加载
│   │
│   ├── blender/                # Blender 侧卡
│   │   ├── __init__.py
│   │   ├── _common.py          # socket→ParamSpec、复合分量覆盖、打包
│   │   ├── float.py            # float 卡：标量、choices/step/log
│   │   ├── int.py              # int 卡：整数维度
│   │   ├── bool.py             # bool 卡：两个类别
│   │   ├── vector.py           # vector 卡：x/y/z 三个分量
│   │   ├── color.py            # color 卡：r/g/b（可选 a）
│   │   ├── rotation.py         # rotation 卡：x/y/z 欧拉角（度）
│   │   ├── matrix.py           # matrix 卡：平移 3 + 旋转 3 + 缩放 3
│   │   └── measure_mesh.py     # measure 卡：求值网格 → 扁平 mesh 统计
│   │
│   └── tool/                   # 工具策略卡
│       ├── __init__.py
│       ├── target_file.py      # target 卡：参考模型文件
│       ├── target_script.py    # target 卡：STAGES/SCHEMA 分段脚本
│       ├── score_grouped.py    # score 卡：分组加权误差、字段明细、best_seen
│       ├── budget_optuna.py    # budget 卡：TPE、study、停机判断
│       ├── failure_tolerate.py # failure 卡：单轮失败计数并继续（B）
│       ├── failure_strict.py   # failure 卡：任何单轮失败整轮中止（A）
│       ├── memory_seed.py      # memory 卡：seed.json、指纹、热启动
│       ├── memory_none.py      # memory 卡：不读不写，每轮冷启动
│       └── output_json.py      # output 卡：清理、best.ply、best_seen、best.json
│
└── translate/
    ├── __init__.py             # 只导出 to_blender
    └── to_blender.py           # 采样值 + fixed → {identifier: packed} 或 [{node,...}]
```

## 各文件职责

### 入口与运行时

| 文件 | 职责 |
|---|---|
| `__init__.py` | 包声明。这个包会被 Blender 内 import（via `fitting.translator`），所以不能导入 engine，也不能带 optuna 依赖。 |
| `errors.py` | 只有 `ConfigError`，配置/参考数据不合法时由卡片或 config 抛出。 |
| `contract.py` | 定义值类型常量、`Component`、`ParamSpec`、`SearchSpace`。不 import bpy/optuna/numpy。 |
| `translator.py` | Blender 与 Optuna 之间的值翻译：`schema_to_space`、`sample`、`raw_to_packed`、`packed_to_native`、空间校验。 |
| `config.py` | 校验场景/inputs/fixed/路径/超时；按 schema 找 socket、加载值类型卡、生成 `SearchSpace` 和 `fixed_packed`。 |
| `engine.py` | 唯一的编排者：加载卡片、取参考数据、启动底座、循环、调用各槽位、返回报告。 |
| `base.py` | 外侧底座：启动 `blender --background`，stdin/stdout 的 `@@FIT@@` 协议，超时、日志、进程清理。 |
| `host.py` | Blender 内一端：`object → modifier → node_group` 定位；处理 `schema / inputs / eval / bye`；写 socket、刷新 depsgraph、导出 PLY。 |
| `example_config.json` | 一份可参考的配置单子，当前使用 `script + stage + params` 来源。 |

### core/

| 文件 | 职责 |
|---|---|
| `core/cards.py` | 引擎对卡片的接口：`ToolCard`、`TargetCard`、`MeasureCard`、`ScoreCard`、`BudgetCard`、`FailureCard`、`MemoryCard`、`OutputCard`。 |
| `core/context.py` | `RunContext`：prepared 配置、base、space、value_cards、target、study、records、signatures、out_dir 等共享状态。 |
| `core/registry.py` | 槽位→可用卡→默认卡；解析配置里的 `cards` 覆盖；调用每张卡的 `configure`。`target` 优先：有 `target` 用 `file` 卡，否则有 `script` 用 `script` 卡。 |
| `core/flatten.py` | 把嵌套摘要（dict/list）拍平成 `extents.0` 这类字段，供 score 和 measure 共用。 |
| `core/fs.py` | `file_stamp`（路径+大小+修改时间，用于失效判断）和 `unlink_quiet`。 |

### cards/blender/

| 文件 | 职责 |
|---|---|
| `cards/__init__.py` | 值类型卡注册表：按 `KIND_FLOAT/INT/...` 懒加载对应模块；没有卡片的类型直接报错。 |
| `blender/_common.py` | 单个 socket → `ParamSpec`；复合类型按 `components` 覆盖分量；调用 translator 打包。 |
| `blender/float.py` | float 卡：一个标量维度，支持 `min/max/step/log/choices`。 |
| `blender/int.py` | int 卡：一个整数维度，校验整数范围和步长。 |
| `blender/bool.py` | bool 卡：`True/False` 两个类别。 |
| `blender/vector.py` | vector 卡：x/y/z 三个 float 分量。 |
| `blender/color.py` | color 卡：r/g/b（声明 alpha 时为 rgba）。 |
| `blender/rotation.py` | rotation 卡：x/y/z 欧拉角，对外单位是度。 |
| `blender/matrix.py` | matrix 卡：平移 3 + 旋转 3 + 缩放 3，共 9 维。 |
| `blender/measure_mesh.py` | measure 槽位：读导出的 PLY，调用 `meshkit.stats` 生成扁平测量表。 |

### cards/tool/

每张卡都实现 `core/cards.py` 里对应槽位的接口，槽位名写在类的 `slot` 上。

| 文件 | 槽位 | 职责 |
|---|---|---|
| `target_file.py` | target | 校验 `target`；加载参考网格并生成摘要；提供文件指纹。出现 `target` 时 `script/stage/params` 被忽略。 |
| `target_script.py` | target | 校验 `script/stage/params`；跑脚本并把 stage JSON 的 `summary` 当参考；提供脚本指纹。 |
| `score_grouped.py` | score | 拥有 `weights/skip/min_diff`；生成分组打分计划；逐轮打分；记录字段级历史最好；产出报告评分片段。 |
| `budget_optuna.py` | budget | 拥有 `budget.*`；创建 TPE/study；按 target_loss、max_trials、timeout 判断停机；给出 converged/elapsed。 |
| `failure_tolerate.py` | failure | 单轮求值失败计数并继续；Blender 超时或进程退出才整轮中止。 |
| `failure_strict.py` | failure | 任意单轮失败（含非有限分数）立即整轮中止。 |
| `memory_seed.py` | memory | 计算指纹；读写 `seed.json`；把历史最优参数入队热启动。 |
| `memory_none.py` | memory | 完全冷启动，不读不写种子。 |
| `output_json.py` | output | 清理旧产物；刷新 `best.ply`；写 `best_seen.json`；拼装并写 `best.json`。 |

### translate/

| 文件 | 职责 |
|---|---|
| `translate/__init__.py` | 只导出 `to_blender`。 |
| `translate/to_blender.py` | 把一轮采样值 + `fixed_packed` 打包：单节点返回 `{identifier: packed}`，多节点返回 `[{node, identifier, value}]`。 |

## 外部依赖与入口

| 文件 | 职责 |
|---|---|
| `shard/extensions/blender_fit.ts` | 工具入口：拼 `_fit_config.json`、启动 `python -m fitting.engine`、读取报告并回一句摘要。不向模型暴露内部实现。 |
| `shard/extensions/bpy.ts` | 几何探针/导出：`export` 模式把节点当前几何导出成 PLY，路径可直接作为 `blender_fit` 的 `target`。 |
| `shard/lib/env.ts` | 读取 `py_environment.json`，解析 python / blender / workspace 路径。 |
| `shard/py_environment.json` | 环境地址簿（python、blender、workspace、covtrace）。 |
| `shard/meshkit/env.py` | blender.exe 的唯一定位入口。 |
| `shard/meshkit/stats.py` | 纯网格字段计算：trimesh / pyvista / manifold3d 摘要。 |
| `shard/meshkit/blender_export.py` | Blender 内导出：临时改接 Group Output、补 Realize Instances、三角化、写二进制 PLY、恢复连线。 |
| `shard/meshkit/stage.py` | 分段脚本执行器：`STAGES + SCHEMA + build(**params, stage=...)`，每段落一份 stage JSON。 |

## 一次运行的流程

1. `blender_fit.ts` 把参数整理成配置，写到 `workspace/_fit_config.json`，启动 `fitting.engine`。
2. `config.prepare` 校验场景/inputs/fixed；`registry` 解析并 configure 七个槽位的卡片。
3. `target` 卡加载参考数据；`score` 卡生成打分计划；`output` 卡确定路径并清理旧产物。
4. 启动 Blender，`host.py` 就绪；`build_space` 读取 schema，值类型卡生成搜索空间。
5. 各卡提供签名，`memory` 卡读 `seed.json`；`budget` 卡建 study；`memory` 卡入队种子。
6. 循环：`study.ask → to_blender → base.evaluate → measure → score → failure → tell → budget 判停`。
7. `memory` 卡写回种子；`output` 卡写 `best.json` / `best.ply` / `best_seen.json`，返回报告。

## 配置键归属

| 配置键 | 归属 |
|---|---|
| `blend / object / modifier / node / frame / startup_timeout_s / eval_timeout_s` | `config.py` + `base.py` |
| `inputs / fixed` | 值类型卡（`cards/blender/`） |
| `target` | `target_file` |
| `script / stage / params` | `target_script` |
| `weights / skip / min_diff` | `score_grouped` |
| `budget.*` | `budget_optuna` |
| `cards` | `core/registry.py`（换卡用，如 `{"failure": "strict"}`） |
| `run_dir / report` | `config.py` 解析，`output_json` 消费 |
| `study_name` | `config.py` 解析，`budget_optuna` 消费 |

## 运行产物

默认在工作区 `workspace/fit_runs/fit/`：

| 文件 | 说明 |
|---|---|
| `best.json` | 最终报告：loss、分组、字段偏差、最优参数、失败明细、热启动状态。 |
| `best.ply` | 最优 trial 的网格。 |
| `best_seen.json` | 字段级历史最好与联合最优的差距，只在有可提升字段时生成。 |
| `seed.json` | 热启动种子：指纹 + 历史最好几组参数。 |
| `stageN.json` | 脚本来源时，第 N 段的参考数据。 |

旧版本的 `workspace/fit_fit.log` 是 Optuna journal，当前代码已不再读写，可以手动删除。
