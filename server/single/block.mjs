import { launchSingle, singleAgentPath } from "./index.mjs";

export default {
  id: "single",
  version: 1,

  provides: {
    launch: "function",
    path: "function",
  },

  requires: {
    tools: ["resolve"],
    store: ["ApiError"],
  },

  create({ api }) {
    return {
      api: {
        launch: (options = {}) =>
          launchSingle({
            ...options,
            ApiError: api.store.ApiError,
            resolveExtensions:
              options.resolveExtensions || ((projectPath) => api.tools.resolve(projectPath)),
          }),
        path: singleAgentPath,
      },
    };
  },
};
