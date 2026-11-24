/** 首屏聚合读模型：Agent 列表 + 流程摘要。 */
export function createStateServer({ agents, flow }) {
  function snapshot() {
    return {
      agents: agents.list(),
      flows: flow.list(),
      mode: "pi",
    };
  }

  return {
    api: { snapshot },
    routes: [
      {
        method: "GET",
        path: "/api/state",
        handler: () => snapshot(),
      },
    ],
  };
}
