/**
 * 每个 Agent 的唯一配置源：<项目>/.pi/agent.json
 *
 * 这里只做纯数据校验与解析，不碰文件系统。
 * shard/sync.mjs 用它把 agent.json 编译成 Pi 实际读取的
 * .pi/settings.json 与 .pi/pi-flow.json；这两个文件是生成物，不要手改。
 *
 * 优先级（从高到低）：
 *   agent.json 的显式字段 > 清单 projects[].settings > 清单 defaults
 * 工具清单：
 *   agent.json.tools 显式给出时完全接管；否则退回清单的 profile / tools。
 * 提示词不在这里：SYSTEM.md 与 skills/ 仍由 Pi 按固定路径读取。
 */

import path from "node:path";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function isInsideDir(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * settings.extensions 里写什么路径：
 * 项目在 hub 内时写相对 .pi 的路径，整个仓库换位置不用重新配置；
 * 项目在 hub 外（安装后的 userData）时写绝对路径。
 * sync 和 UI 保存必须共用这一套规则，否则同一个 Agent 会出现两种写法。
 */
export function createExtensionPathFormatter({ hubDir, projectDir }) {
  const baseDir = path.join(projectDir, ".pi");
  const inHub = Boolean(hubDir) && isInsideDir(hubDir, projectDir);
  return (abs) => {
    const value = inHub ? path.relative(baseDir, abs) : abs;
    return value.replace(/\\/g, "/");
  };
}

export const AGENT_CONFIG_FILE = "agent.json";
export const AGENT_CONFIG_VERSION = 1;

export const AGENT_CONFIG_COMMENT =
  "该 Agent 的唯一配置源。.pi/settings.json 与 .pi/pi-flow.json 由 shard/sync.mjs 生成，不要手改。";

const CONFIG_KEYS = new Set([
  "_comment",
  "version",
  "profile",
  "provider",
  "model",
  "isolate",
  "builtinTools",
  "tools",
]);

function readNameList(raw, label, file) {
  if (!Array.isArray(raw)) throw new Error(`Agent 配置 ${file} 的 ${label} 必须是数组`);
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Agent 配置 ${file} 的 ${label} 里有非字符串条目`);
    }
    const name = item.trim();
    if (out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

/** 校验 agent.json 的结构；返回规范化后的配置和可忽略的警告。 */
export function normalizeAgentConfig(raw, { file = AGENT_CONFIG_FILE } = {}) {
  if (!isObject(raw)) throw new Error(`Agent 配置 ${file} 必须是 JSON 对象`);

  const warnings = [];
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) warnings.push(`Agent 配置 ${file} 有未知字段：${key}（已忽略）`);
  }
  if (raw.version !== undefined && raw.version !== AGENT_CONFIG_VERSION) {
    throw new Error(`Agent 配置 ${file} 的 version 不支持：${raw.version}`);
  }

  const config = { version: AGENT_CONFIG_VERSION };

  for (const key of ["provider", "model"]) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string") throw new Error(`Agent 配置 ${file} 的 ${key} 必须是字符串`);
    const value = raw[key].trim();
    if (value) config[key] = value;
  }

  if (raw.profile !== undefined) {
    if (typeof raw.profile !== "string" || !raw.profile.trim()) {
      throw new Error(`Agent 配置 ${file} 的 profile 必须是非空字符串`);
    }
    config.profile = raw.profile.trim();
  }

  if (raw.isolate !== undefined) {
    if (typeof raw.isolate !== "boolean") {
      throw new Error(`Agent 配置 ${file} 的 isolate 必须是布尔值`);
    }
    config.isolate = raw.isolate;
  }

  for (const key of ["tools", "builtinTools"]) {
    if (raw[key] === undefined) continue;
    config[key] = readNameList(raw[key], key, file);
  }

  return { config, warnings };
}

/**
 * 解析出一个 Agent 最终生效的选择。
 *
 * - tools：agent.json 显式数组优先；否则按清单 profile / tools + disableTools / extraTools。
 * - builtinTools / provider / model：返回 null 表示沿用清单里的默认值。
 * - isolate：agent.json 覆盖清单。
 */
export function resolveAgentSelection({ config = {}, manifest = {}, entry = {} } = {}) {
  const tools = manifest.tools ?? {};
  const profiles = manifest.profiles ?? {};
  const profile = config.profile ?? entry.profile ?? null;

  let names;
  if (Array.isArray(config.tools)) {
    names = config.tools;
  } else {
    if (config.profile && !Object.hasOwn(profiles, config.profile)) {
      throw new Error(`Agent 配置引用了不存在的 profile：${config.profile}`);
    }
    const base = entry.tools ?? (profile ? profiles[profile] : []);
    if (!Array.isArray(base)) throw new Error(`profile "${profile}" 不存在或不是数组`);
    const disabled = new Set(Array.isArray(entry.disableTools) ? entry.disableTools : []);
    const extra = Array.isArray(entry.extraTools) ? entry.extraTools : [];
    names = [...base, ...extra].filter((name) => !disabled.has(name));
  }

  const unique = [];
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) throw new Error("工具名必须是非空字符串");
    if (!Object.hasOwn(tools, name)) throw new Error(`工具 "${name}" 不在清单 tools 里`);
    if (!unique.includes(name)) unique.push(name);
  }

  return {
    names: unique,
    profile,
    builtinTools: Array.isArray(config.builtinTools) ? [...config.builtinTools] : null,
    provider: config.provider ?? null,
    model: config.model ?? null,
    isolate: typeof config.isolate === "boolean" ? config.isolate : entry.isolate === true,
  };
}

/**
 * 从当前生效状态反向生成 agent.json（迁移用）。
 *
 * tools 优先用调用方从磁盘反推出来的实际列表（迁移时冻结现状）；没有时按清单 profile。
 * provider / model / builtinTools 取磁盘上当前的 settings.json（缺失时回退清单默认值）；
 * isolate 取当前 pi-flow.json。
 */
export function buildAgentConfig({ manifest = {}, entry = {}, settings = {}, flow = null, tools = null } = {}) {
  const defaults = { ...(manifest.defaults ?? {}), ...(entry.settings ?? {}) };
  const effective = { ...defaults, ...(settings ?? {}) };
  const selection = resolveAgentSelection({ config: {}, manifest, entry });

  const config = {
    _comment: AGENT_CONFIG_COMMENT,
    version: AGENT_CONFIG_VERSION,
  };
  if (typeof effective.defaultProvider === "string" && effective.defaultProvider.trim()) {
    config.provider = effective.defaultProvider.trim();
  }
  if (typeof effective.defaultModel === "string" && effective.defaultModel.trim()) {
    config.model = effective.defaultModel.trim();
  }
  config.isolate =
    flow && typeof flow.isolate === "boolean" ? flow.isolate : entry.isolate === true;
  if (Array.isArray(effective.defaultTools)) config.builtinTools = effective.defaultTools;
  config.tools = Array.isArray(tools) ? [...new Set(tools)] : selection.names;
  if (entry.profile) config.profile = entry.profile;
  return config;
}

/**
 * 把 agent.json + 清单编译成 Pi 读取的 settings 内容。
 *
 * 路径怎么解析、哪些条目算共享扩展由调用方决定：
 *   extensionPath(name)  工具名 -> 扩展文件绝对路径
 *   formatExtension(abs) 绝对路径 -> 写进 settings.extensions 的字符串
 *   isManagedEntry(raw)  该条目是否由 sync 管理（会被替换掉）
 */
export function compileAgentSettings({
  manifest = {},
  entry = {},
  config = {},
  current = {},
  extensionPath,
  formatExtension,
  isManagedEntry,
} = {}) {
  if (typeof extensionPath !== "function") throw new Error("compileAgentSettings 需要 extensionPath");
  if (typeof formatExtension !== "function") throw new Error("compileAgentSettings 需要 formatExtension");

  const selection = resolveAgentSelection({ config, manifest, entry });
  const next = { ...(manifest.defaults ?? {}), ...(entry.settings ?? {}) };
  if (selection.provider != null) next.defaultProvider = selection.provider;
  if (selection.model != null) next.defaultModel = selection.model;
  if (selection.builtinTools != null) next.defaultTools = selection.builtinTools;

  // 项目自己的扩展原样保留；我们管理的条目稍后整体替换。
  const kept = [];
  for (const raw of Array.isArray(current.extensions) ? current.extensions : []) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || value.startsWith("-") || value.startsWith("!") || value.startsWith("builtin:")) continue;
    if (isManagedEntry?.(value)) continue;
    kept.push(raw);
  }

  const ours = [];
  for (const name of selection.names) {
    const abs = extensionPath(name);
    if (!abs) throw new Error(`tools 里没有 "${name}"`);
    const stored = formatExtension(abs);
    if (stored) ours.push(stored);
  }

  const extensions = [...kept, ...ours];
  if (extensions.length) next.extensions = extensions;
  else delete next.extensions;
  return { selection, settings: next };
}

/** agent.json -> .pi/pi-flow.json；isolate=false 时返回 null 表示要删掉该文件。 */
export function compileAgentFlow({ config = {}, entry = {} } = {}) {
  const isolate = typeof config.isolate === "boolean" ? config.isolate : entry.isolate === true;
  return isolate
    ? {
        _comment: "由 shard/sync.mjs 生成；isolate=true 时 Pi Flow 以 --no-extensions 启动。",
        isolate: true,
      }
    : null;
}
