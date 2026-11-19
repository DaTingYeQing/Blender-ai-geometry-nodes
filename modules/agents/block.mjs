import { createAgentsServer } from "./server/index.mjs";

export default {
  id: "agents",
  version: 1,

  provides: {
    list: "function",
    get: "function",
    create: "function",
    remove: "function",
    beginSession: "function",
    bindSession: "function",
    finishSession: "function",
    renameSession: "function",
    removeSession: "function",
  },

  requires: {
    store: ["ApiError", "db", "now", "rid", "saveState"],
  },

  create({ api }) {
    const module = createAgentsServer({ store: api.store });
    return { api: module.api, routes: module.routes };
  },
};
