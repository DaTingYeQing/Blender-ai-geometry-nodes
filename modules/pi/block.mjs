import { createPiServer } from "./server/index.mjs";

export default {
  id: "pi",
  version: 1,

  provides: {
    start: "function",
    health: "function",
  },

  requires: {
    tools: ["catalog"],
  },

  create({ api }) {
    const module = createPiServer({ tools: api.tools });
    return { api: module.api, routes: module.routes };
  },
};
