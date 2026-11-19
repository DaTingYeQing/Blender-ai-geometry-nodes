import { loadManifest, validateManifest } from "./manifest.mjs";
import { loadTemplates, loadDevTemplates, singleProject } from "./templates.mjs";
import { reconcileAgents, seedAgents } from "./agents.mjs";
import { seedPresetFlow } from "./preset.mjs";
import { readPreset, seedFromTemplates } from "./seed.mjs";

export {
  loadManifest,
  validateManifest,
  loadTemplates,
  loadDevTemplates,
  singleProject,
  reconcileAgents,
  seedAgents,
  seedPresetFlow,
  readPreset,
  seedFromTemplates,
};

function assertReady(store) {
  if (!store?.db || !store.db.state) {
    throw new Error("registry 需要已加载的状态（store.db.state）");
  }
}

/**
 * 块对外接口：把纯函数和状态接起来。
 *
 * 读清单、解析目录、对账都是纯函数；seed / seedDev 负责写回 state 并保存。
 * electron / dev server 只调这两个入口，不碰 store 内部结构。
 */
export function createRegistryApi({ store } = {}) {
  async function seed({ templates = [], preset = null, diagnostics = null } = {}) {
    assertReady(store);
    const result = seedFromTemplates(store.db.state, templates, preset, store);
    if (result.changed) await store.saveState();
    return { ...result, diagnostics };
  }

  async function seedDev({ presetPath } = {}) {
    const loaded = await loadDevTemplates();
    const preset = presetPath ? await readPreset(presetPath) : null;
    const result = await seed({ templates: loaded.agents, preset, diagnostics: loaded.diagnostics });
    return {
      ...result,
      diagnostics: loaded.diagnostics,
      agents: loaded.agents,
      single: singleProject(loaded.agents),
    };
  }

  return {
    loadManifest,
    loadTemplates,
    loadDevTemplates,
    readPreset,
    singleProject,
    seed,
    seedDev,
  };
}
