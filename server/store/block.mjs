import * as store from "./index.mjs";

export default {
  id: "store",
  version: 1,

  provides: {
    ApiError: "function",
    APP_DIR: "string",
    SHARED_DIR: "string",
    ROOT_DIR: "string",
    db: "object",
    now: "function",
    rid: "function",
    ensureDir: "function",
    isInside: "function",
    dataDir: "function",
    statePath: "function",
    loadState: "function",
    saveState: "function",
  },

  requires: {},

  async create() {
    await store.loadState();
    return { api: { ...store } };
  },
};
