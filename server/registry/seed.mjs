import fsp from "node:fs/promises";
import { reconcileAgents } from "./agents.mjs";
import { seedPresetFlow } from "./preset.mjs";

/** 读默认预设；没有就返回 null，调用方只播种 Agent。 */
export async function readPreset(file) {
  try {
    return JSON.parse((await fsp.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** 开发服务器和桌面端共用的一步：Agent 清单 + 默认流程。 */
export function seedFromTemplates(state, templates, preset, store) {
  const reconciled = reconcileAgents(state, templates, store);
  let changed = reconciled.changed;
  if (preset) changed = seedPresetFlow(state, preset, templates, store) || changed;
  return { changed, report: reconciled.report };
}
