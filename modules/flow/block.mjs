import { createFlowServer } from "./server/index.mjs";

export default {
  id: "flow",
  version: 1,

  provides: {
    list: "function",
    get: "function",
    create: "function",
    save: "function",
    remove: "function",
    prune: "function",
  },

  requires: {
    store: ["ApiError", "db", "now", "rid", "saveState"],
  },

  create({ api }) {
    const module = createFlowServer({ store: api.store });
    return { api: module.api, routes: module.routes, meta: { recovered: module.recovered } };
  },
};
