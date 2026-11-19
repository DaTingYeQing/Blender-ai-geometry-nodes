import { createArtifactsServer } from "./server/index.mjs";

export default {
  id: "artifacts",
  version: 1,

  provides: {
    prepare: "function",
    collect: "function",
    read: "function",
    removeWorkspaces: "function",
  },

  requires: {
    store: ["ApiError", "ensureDir", "isInside"],
    agents: ["list"],
  },

  async create({ api }) {
    const module = await createArtifactsServer({ store: api.store, agents: api.agents });
    return { api: module.api, routes: module.routes };
  },
};
