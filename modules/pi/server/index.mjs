import fs from "node:fs";
import path from "node:path";
import { startPi, PI_BIN } from "./rpc.mjs";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** isolate 项目只加载 settings.json 里显式列出的扩展；其它项目交给 pi 自动发现。 */
export function resolveProjectExtensions(projectPath) {
  const piDir = path.join(projectPath, ".pi");
  const config = readJson(path.join(piDir, "pi-flow.json"));
  if (config?.isolate !== true) return { noExtensions: false, extensions: [] };

  const settings = readJson(path.join(piDir, "settings.json"));
  const entries = Array.isArray(settings?.extensions) ? settings.extensions : [];
  const extensions = [];
  const seen = new Set();

  for (const raw of entries) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || value.startsWith("-") || value.startsWith("!") || value.startsWith("builtin:")) continue;
    const target = value.startsWith("+") ? value.slice(1) : value;
    const resolved = path.isAbsolute(target) ? target : path.resolve(piDir, target);
    if (seen.has(resolved)) continue;
    try {
      fs.statSync(resolved);
    } catch {
      continue;
    }
    seen.add(resolved);
    extensions.push(resolved);
  }

  return { noExtensions: true, extensions };
}

export function createPiServer() {
  const api = {
    start: startPi,
    resolveProjectExtensions,
    health: () => ({
      ok: true,
      mode: "pi",
      electron: Boolean(process.versions.electron),
      pi: { bin: PI_BIN, available: PI_BIN.endsWith(".js") ? fs.existsSync(PI_BIN) : true },
    }),
  };

  return {
    api,
    routes: [{ method: "GET", path: "/api/health", handler: () => api.health() }],
  };
}
