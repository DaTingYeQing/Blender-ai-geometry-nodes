import fs from "node:fs";
import path from "node:path";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/**
 * 第一层适配器：把项目里的 .pi 配置翻译成 pi 的启动参数。
 * isolate 项目只加载 settings.json 里显式列出的扩展；其它项目交给 pi 自动发现。
 */
export function createPiExtensionsAdapter({ shardDir } = {}) {
  function resolve(projectPath) {
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

  function catalog() {
    const manifest = shardDir ? readJson(path.join(shardDir, "agents.json")) : null;
    return {
      tools: manifest?.tools || {},
      profiles: manifest?.profiles || {},
    };
  }

  return { resolve, catalog };
}
