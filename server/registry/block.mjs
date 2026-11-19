import { createRegistryApi } from "./index.mjs";

export default {
  id: "registry",
  version: 1,

  provides: {
    loadManifest: "function",
    loadTemplates: "function",
    loadDevTemplates: "function",
    readPreset: "function",
    singleProject: "function",
    seed: "function",
    seedDev: "function",
  },

  requires: {
    store: ["db", "saveState"],
  },

  create({ api }) {
    return { api: createRegistryApi({ store: api.store }) };
  },
};
