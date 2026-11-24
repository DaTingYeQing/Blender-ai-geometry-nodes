import { createRuntimeServer } from "./server/index.mjs";

export default {
  id: "runtime",
  version: 1,

  provides: {
    start: "function",
    get: "function",
    abort: "function",
    active: "function",
  },

  requires: {
    store: ["ApiError", "db", "now", "rid", "saveState"],
    agents: ["list", "get", "beginSession", "bindSession", "finishSession"],
    artifacts: ["listFiles", "moveInputs"],
    pi: ["start"],
    tools: ["resolve"],
  },

  create({ api }) {
    const module = createRuntimeServer({
      store: api.store,
      agents: api.agents,
      artifacts: api.artifacts,
      pi: api.pi,
      tools: api.tools,
    });
    return { api: module.api, routes: module.routes, meta: { recovered: module.recovered } };
  },
};
