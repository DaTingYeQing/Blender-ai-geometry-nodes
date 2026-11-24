import { createAgentConfigServer } from "./server/index.mjs";

export default {
  id: "agentconfig",
  version: 1,

  provides: {
    catalog: "function",
    get: "function",
    save: "function",
    create: "function",
  },

  requires: {
    store: ["ApiError", "dataDir", "ensureDir", "saveState"],
    tools: ["catalog", "readAgentConfig", "writeAgentConfig"],
    agents: ["get", "create", "rename"],
  },

  create({ api }) {
    const module = createAgentConfigServer({
      store: api.store,
      tools: api.tools,
      agents: api.agents,
    });
    return { api: module.api, routes: module.routes };
  },
};
