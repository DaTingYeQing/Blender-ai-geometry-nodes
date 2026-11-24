/**
 * 第二层对第三层（UI）承诺的稳定 API。
 *
 * 这里的表就是唯一事实来源：
 *   - 启动时拿实际注册的路由和它对账，多一条、少一条都会直接报错；
 *   - 请求前按这里的 request / query 描述校验载荷；
 *   - UI 用 id + template 构造 URL，不再硬编码路径。
 *
 * 换 UI 只允许消费这张表，不允许改表。
 */

export const API_VERSION = 4;

export const ENDPOINTS = Object.freeze([
  {
    id: "state",
    method: "GET",
    path: "/api/state",
    response: { agents: "Agent[]", flows: "FlowSummary[]", mode: '"pi"' },
    summary: "首屏快照：Agent 列表 + 流程摘要",
  },
  {
    id: "contract",
    method: "GET",
    path: "/api/contract",
    response: { version: "number", endpoints: "Endpoint[]" },
    summary: "本表自描述，供新前端适配",
  },
  {
    id: "health",
    method: "GET",
    path: "/api/health",
    response: { ok: "boolean", mode: "string", electron: "boolean", pi: "object", tools: "object" },
    summary: "pi 运行通道与工具层的健康检查",
  },
  {
    id: "single-launch",
    method: "POST",
    path: "/api/single/launch",
    response: { agent: "string", command: "string" },
    summary: "在外部终端启动 GEO_Single",
  },
  {
    id: "agents",
    method: "GET",
    path: "/api/agents",
    response: { agents: "Agent[]" },
    summary: "列出已注册 Agent",
  },
  {
    id: "agent-delete",
    method: "DELETE",
    pattern: "^\\/api\\/agents\\/([^/]+)$",
    template: "/api/agents/:id",
    response: { ok: "true" },
    summary: "删除 Agent 注册记录",
  },
  {
    id: "tools",
    method: "GET",
    path: "/api/tools",
    response: { tools: "string[]", profiles: "object" },
    summary: "工具目录（工具名 + 组合）",
  },
  {
    id: "agent-config-create",
    method: "POST",
    path: "/api/agents/create",
    request: {
      name: { type: "string", required: true },
      tools: { type: "array" },
    },
    response: { agent: "Agent", config: "AgentConfig" },
    summary: "新建 Agent 项目目录并写入初始配置",
  },
  {
    id: "agent-config-get",
    method: "GET",
    pattern: "^\\/api\\/agents\\/([^/]+)\\/config$",
    template: "/api/agents/:id/config",
    response: { agent: "Agent", config: "AgentConfig", derived: "boolean" },
    summary: "读取 Agent 的 .pi/agent.json（缺失时按当前 settings 推导）",
  },
  {
    id: "agent-config-save",
    method: "PUT",
    pattern: "^\\/api\\/agents\\/([^/]+)\\/config$",
    template: "/api/agents/:id/config",
    request: {
      name: { type: "string", required: true },
      tools: { type: "array", required: true },
    },
    response: { agent: "Agent", config: "AgentConfig" },
    summary: "保存 Agent 配置并重编译 settings / pi-flow",
  },
  {
    id: "agent-session",
    method: "GET",
    pattern: "^\\/api\\/agents\\/([^/]+)\\/sessions\\/([^/]+)$",
    template: "/api/agents/:agentId/sessions/:sessionId",
    response: { session: "Session", entries: "SessionEntry[]", truncated: "boolean", missing: "boolean" },
    summary: "读取 Pi 会话记录（sessionId 可为内部 id 或 pi 会话 id）",
  },
  {
    id: "session-rename",
    method: "PATCH",
    pattern: "^\\/api\\/agents\\/([^/]+)\\/sessions\\/([^/]+)$",
    template: "/api/agents/:agentId/sessions/:sessionId",
    request: { title: { type: "string", required: true } },
    response: { session: "Session" },
    summary: "重命名会话（sessionId 可为内部 id 或 pi 会话 id）",
  },
  {
    id: "session-delete",
    method: "DELETE",
    pattern: "^\\/api\\/agents\\/([^/]+)\\/sessions\\/([^/]+)$",
    template: "/api/agents/:agentId/sessions/:sessionId",
    response: { ok: "true" },
    summary: "删除会话记录（不删 pi 的会话文件；sessionId 可为内部 id 或 pi 会话 id）",
  },
  {
    id: "flows",
    method: "GET",
    path: "/api/flows",
    response: { flows: "FlowSummary[]" },
    summary: "列出流程",
  },
  {
    id: "flow-create",
    method: "POST",
    path: "/api/flows",
    request: { name: { type: "string" } },
    response: { flow: "Flow" },
    summary: "创建流程",
  },
  {
    id: "flow-prune",
    method: "POST",
    path: "/api/flows/prune",
    request: { agentId: { type: "string", required: true } },
    response: { ok: "true", changed: "boolean" },
    summary: "删除指定 Agent 在所有流程里的节点和相连的线",
  },
  {
    id: "flow-get",
    method: "GET",
    pattern: "^\\/api\\/flows\\/([^/]+)$",
    template: "/api/flows/:id",
    response: { flow: "Flow" },
    summary: "读取流程",
  },
  {
    id: "flow-save",
    method: "PUT",
    pattern: "^\\/api\\/flows\\/([^/]+)$",
    template: "/api/flows/:id",
    request: {
      name: { type: "string" },
      nodes: { type: "array", required: true },
      edges: { type: "array", required: true },
    },
    response: { ok: "true" },
    summary: "整体保存流程",
  },
  {
    id: "flow-delete",
    method: "DELETE",
    pattern: "^\\/api\\/flows\\/([^/]+)$",
    template: "/api/flows/:id",
    response: { ok: "true" },
    summary: "删除流程（工作区属于 Agent，不受影响）",
  },
  {
    id: "run",
    method: "POST",
    path: "/api/run",
    request: {
      node: { type: "object", required: true },
      flowId: { type: "string", required: true },
      inputFiles: { type: "array" },
    },
    response: { runId: "string", sessionId: "string|null", sessionInternalId: "string" },
    summary: "启动一次节点运行",
  },
  {
    id: "run-active",
    method: "GET",
    path: "/api/runs/active",
    response: { count: "number", runs: "Run[]" },
    summary: "列出正在运行的节点（关闭窗口前提示用）",
  },
  {
    id: "run-get",
    method: "GET",
    pattern: "^\\/api\\/runs\\/([^/]+)$",
    template: "/api/runs/:id",
    response: { id: "string", status: "idle|running|done|error", transcript: "Entry[]" },
    summary: "轮询运行状态与转录",
  },
  {
    id: "run-abort",
    method: "POST",
    pattern: "^\\/api\\/runs\\/([^/]+)\\/abort$",
    template: "/api/runs/:id/abort",
    response: { ok: "true" },
    summary: "中止运行",
  },
  {
    id: "files",
    method: "GET",
    pattern: "^\\/api\\/agents\\/([^/]+)\\/files$",
    template: "/api/agents/:id/files",
    response: { files: "FileEntry[]" },
    summary: "列出某个 Agent 工作区里的文件",
  },
  {
    id: "file",
    method: "GET",
    path: "/api/file",
    query: { path: { type: "string", required: true } },
    response: { content: "string", size: "number" },
    summary: "读取工作区文件（受 Agent 目录约束）",
  },
]);

export function endpointKey(entry) {
  return `${entry.method} ${entry.path ?? entry.pattern}`;
}

export function routeKey(route) {
  return `${route.method} ${route.path ?? route.pattern?.source}`;
}

export function contractEntry(entryKey) {
  return ENDPOINTS.find((entry) => endpointKey(entry) === entryKey) || null;
}

export function assertEndpointTable(routes) {
  const expected = new Set(ENDPOINTS.map(endpointKey));
  const actual = new Set(routes.map(routeKey));

  const missing = [...expected].filter((key) => !actual.has(key));
  const extra = [...actual].filter((key) => !expected.has(key));
  if (missing.length || extra.length) {
    throw new Error(
      [
        "API 路由与 server/contract.mjs 不一致。",
        missing.length ? `契约里有、实现里没有：${missing.join("；")}` : "",
        extra.length ? `实现里有、契约里没有：${extra.join("；")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

export function publicContract() {
  return {
    version: API_VERSION,
    endpoints: ENDPOINTS.map((entry) => ({ ...entry })),
  };
}
