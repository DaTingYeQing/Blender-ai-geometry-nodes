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
    const launch = (options = {}) =>
      launchSingle({
        ...options,
        ApiError: api.store.ApiError,
        resolveExtensions:
          options.resolveExtensions || ((projectPath) => api.tools.resolve(projectPath)),
      });
    return {
      api: {
        launch,
        path: singleAgentPath,
      },
      routes: [
        {
          method: "POST",
          path: "/api/single/launch",
          handler: () => launch(),
        },
      ],
    };
  },
};
