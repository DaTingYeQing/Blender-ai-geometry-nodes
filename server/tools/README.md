# 工具层切口

第一层（`shard/`）和第二层（`server/`、`modules/`）之间只有这一个入口。

## 契约

`server/tools/contract.mjs` 定义第二层允许调用的方法：

```js
resolve(projectPath) // { noExtensions: boolean, extensions: string[] }
catalog()            // { tools: Record<string, string>, profiles: Record<string, string[]> }
```

`resolve()` 返回的是「怎么启动 Pi」的规格，不是工具实现本身。
`catalog()` 只读 `shard/agents.json` 的 `tools` / `profiles`，结果会出现在 `GET /api/health` 的 `tools` 字段（只返回名字），供诊断使用，不参与启动。

## 实现

- `server/tools/index.mjs`：第二层唯一入口，负责校验 adapter 接口。
- `server/tools/adapters/pi-extensions.mjs`：当前实现，读取项目 `.pi/pi-flow.json` 与 `.pi/settings.json`，把扩展路径解析成 Pi 的启动参数。
- `shard/`：工具本体（TypeScript 扩展 + Python skills + 节点信息库）。第二层不 import 这里的任何文件。

## 换工具

1. 在 `shard/` 里新增或替换工具实现。
2. 更新 `shard/agents.json` 的 `tools` / `profiles`。
3. 如果启动方式变了（例如从 Pi 扩展换成 CLI / RPC），只改 `server/tools/adapters/`，并让它继续实现上面两个方法。

`modules/runtime` 只接收 `tools` 依赖，不读 `.pi` 配置，也不关心扩展文件在哪。
`tests/server/architecture.test.mjs` 会阻止 `.pi/settings.json`、`pi-flow.json` 和 `shard/` 引用漏到别处。
