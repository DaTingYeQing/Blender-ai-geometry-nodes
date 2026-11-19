import { startPi } from "./rpc.mjs";
import { PI_BIN, piAvailable, readPiVersion } from "./args.mjs";

export function createPiServer({ tools } = {}) {
  function toolSummary() {
    const catalog = tools?.catalog?.() || {};
    return {
      tools: Object.keys(catalog.tools || {}),
      profiles: Object.keys(catalog.profiles || {}),
    };
  }

  const api = {
    start: startPi,
    health: () => ({
      ok: true,
      mode: "pi",
      electron: Boolean(process.versions.electron),
      pi: {
        bin: PI_BIN,
        available: piAvailable(PI_BIN),
        version: readPiVersion(PI_BIN),
        protocol: 1,
      },
      tools: toolSummary(),
    }),
  };

  return {
    api,
    routes: [{ method: "GET", path: "/api/health", handler: () => api.health() }],
  };
}
