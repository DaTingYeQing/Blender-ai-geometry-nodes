import { createStateServer } from "./index.mjs";

export default {
  id: "state",
  version: 1,

  provides: {
    snapshot: "function",
  },

  requires: {
    agents: ["list"],
    flow: ["list"],
  },

  create({ api }) {
    const module = createStateServer({ agents: api.agents, flow: api.flow });
    return { api: module.api, routes: module.routes };
  },
};
