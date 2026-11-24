import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  AGENT_CONFIG_COMMENT,
  buildAgentConfig,
  compileAgentFlow,
  compileAgentSettings,
  createExtensionPathFormatter,
  normalizeAgentConfig,
  resolveAgentSelection,
} from "../../../shared/agent-config.mjs";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

const key = (p) => p.replace(/\\/g, "/").toLowerCase();

function inside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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

  function readManifest() {
    return shardDir ? readJson(path.join(shardDir, "agents.json")) : null;
  }

  /** 打包版项目被复制到 userData，清单里的路径对不上；按最后一段目录名认领。 */
  function findEntry(manifest, projectPath) {
    const base = path.basename(projectPath).toLowerCase();
    for (const [project, entry] of Object.entries(manifest?.projects ?? {})) {
      const rel = entry?.path || project;
      if (path.basename(rel).toLowerCase() === base) return entry;
    }
    return {};
  }

  function managedRoots(manifest) {
    return [
      path.join(shardDir, "extensions"),
      ...(manifest?.previousHomes ?? []).map((home) => path.join(path.resolve(home), "extensions")),
    ];
  }

  function toolCatalogByPath(manifest) {
    const map = new Map();
    for (const [name, rel] of Object.entries(manifest?.tools ?? {})) {
      map.set(key(path.resolve(shardDir, rel)), name);
      for (const home of manifest?.previousHomes ?? []) {
        map.set(key(path.resolve(home, rel)), name);
      }
    }
    return map;
  }

  /** 把现有 settings.extensions 反推成工具名，供还没有 agent.json 的项目显示。 */
  function toolsFromExtensions(manifest, extensions, baseDir) {
    const byPath = toolCatalogByPath(manifest);
    const roots = managedRoots(manifest);
    const names = [];
    const unknown = [];
    for (const raw of extensions ?? []) {
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (!value || value.startsWith("-") || value.startsWith("!") || value.startsWith("builtin:")) continue;
      const target = value.startsWith("+") ? value.slice(1) : value;
      const resolved = path.isAbsolute(target) ? target : path.resolve(baseDir, target);
      const name = byPath.get(key(resolved));
      if (!name) {
        if (roots.some((root) => inside(root, resolved))) unknown.push(target);
        continue;
      }
      if (!names.includes(name)) names.push(name);
    }
    return { names, unknown };
  }

  function readAgentConfig(projectPath) {
    const piDir = path.join(projectPath, ".pi");
    const manifest = readManifest() ?? { tools: {}, profiles: {}, defaults: {} };
    const entry = findEntry(manifest, projectPath);
    const settings = readJson(path.join(piDir, "settings.json")) || {};
    const flow = readJson(path.join(piDir, "pi-flow.json"));
    const file = path.join(piDir, "agent.json");

    let config;
    let derived = false;
    if (fs.existsSync(file)) {
      config = normalizeAgentConfig(readJson(file), { file }).config;
    } else {
      const extensionTools = toolsFromExtensions(manifest, settings.extensions, piDir);
      config = buildAgentConfig({
        manifest,
        entry,
        settings,
        flow,
        tools: Array.isArray(settings.extensions) ? extensionTools.names : null,
      });
      derived = true;
    }

    const selection = resolveAgentSelection({ config, manifest, entry });
    return { config, selection, derived };
  }

  async function writeJson(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await fsp.rename(tmp, file);
  }

  /**
   * 写 .pi/agent.json，并立刻按它编译 settings.json / pi-flow.json。
   * 传入的 config 会与磁盘上已有的 agent.json 合并，只改调用方给的字段。
   */
  async function writeAgentConfig(projectPath, incoming = {}) {
    const piDir = path.join(projectPath, ".pi");
    const manifest = readManifest() ?? { tools: {}, profiles: {}, defaults: {} };
    const entry = findEntry(manifest, projectPath);
    const agentFile = path.join(piDir, "agent.json");
    const settingsFile = path.join(piDir, "settings.json");
    const flowFile = path.join(piDir, "pi-flow.json");

    let currentConfig = {};
    if (fs.existsSync(agentFile)) {
      currentConfig = normalizeAgentConfig(readJson(agentFile), { file: agentFile }).config;
    }

    const merged = { ...currentConfig, ...incoming };
    if (merged.isolate === undefined) merged.isolate = true;
    if (merged.provider === undefined) merged.provider = manifest.defaults?.defaultProvider;
    if (merged.model === undefined) merged.model = manifest.defaults?.defaultModel;
    if (merged.builtinTools === undefined) merged.builtinTools = manifest.defaults?.defaultTools;
    if (merged.tools === undefined) merged.tools = [];

    const { config } = normalizeAgentConfig(
      { ...merged, _comment: AGENT_CONFIG_COMMENT },
      { file: agentFile },
    );
    const currentSettings = readJson(settingsFile) || {};
    const roots = managedRoots(manifest);
    const { selection, settings } = compileAgentSettings({
      manifest,
      entry,
      config,
      current: currentSettings,
      extensionPath: (name) => {
        const rel = manifest.tools?.[name];
        if (!rel) throw new Error(`tools 里没有 "${name}"`);
        return path.resolve(shardDir, rel);
      },
      formatExtension: createExtensionPathFormatter({
        hubDir: shardDir ? path.dirname(shardDir) : "",
        projectDir: projectPath,
      }),
      isManagedEntry: (raw) => {
        const value = String(raw).trim();
        const target = value.startsWith("+") ? value.slice(1) : value;
        const resolved = path.isAbsolute(target) ? target : path.resolve(piDir, target);
        return roots.some((root) => inside(root, resolved));
      },
    });

    const flow = compileAgentFlow({ config, entry });
    await writeJson(agentFile, { _comment: AGENT_CONFIG_COMMENT, ...config });
    await writeJson(settingsFile, settings);
    if (flow) await writeJson(flowFile, flow);
    else await fsp.rm(flowFile, { force: true });

    return { config, selection, derived: false };
  }

  function catalog() {
    const manifest = readManifest();
    return {
      tools: manifest?.tools || {},
      profiles: manifest?.profiles || {},
    };
  }

  return { resolve, catalog, readAgentConfig, writeAgentConfig };
}
