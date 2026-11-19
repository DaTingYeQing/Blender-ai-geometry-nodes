import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./manifest.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEV_MANIFEST = path.join(ROOT_DIR, "shard", "agents.json");

/**
 * 把清单里的 projects 解析成实际目录。
 *
 * 开发/打包只差「manifest 在哪、项目路径怎么解析」，所以这两件事由调用方传进来。
 * 目录缺失、不是目录、显示名/路径重复都不抛错，作为 diagnostics 返回给启动日志。
 */
export async function loadTemplates({ manifestPath, resolveProjectPath, manifest } = {}) {
  if (!manifestPath) throw new Error("loadTemplates 需要 manifestPath");
  const loaded = manifest ? { manifest, warnings: [] } : await loadManifest(manifestPath);
  const baseDir = path.dirname(manifestPath);
  const projectsBase = loaded.manifest.projectsBase
    ? path.resolve(baseDir, loaded.manifest.projectsBase)
    : baseDir;
  const resolvePath =
    resolveProjectPath ||
    ((project, entry) => path.resolve(projectsBase, entry?.path || project));

  const diagnostics = {
    manifestPath,
    warnings: [...loaded.warnings],
    skipped: [],
  };
  const agents = [];
  const seenPaths = new Map();
  const seenNames = new Map();

  for (const [project, entry] of Object.entries(loaded.manifest.projects || {})) {
    if (entry.enabled === false) {
      diagnostics.skipped.push({ project, reason: "enabled: false" });
      continue;
    }

    const projectPath = resolvePath(project, entry);
    let stat;
    try {
      stat = await fsp.stat(projectPath);
    } catch {
      diagnostics.skipped.push({ project, reason: "目录不存在", path: projectPath });
      continue;
    }
    if (!stat.isDirectory()) {
      diagnostics.skipped.push({ project, reason: "不是目录", path: projectPath });
      continue;
    }

    const name = entry.displayName || project;
    if (seenPaths.has(projectPath)) {
      diagnostics.warnings.push(`projects.${project} 与 ${seenPaths.get(projectPath)} 指向同一路径：${projectPath}`);
    } else {
      seenPaths.set(projectPath, project);
    }
    if (seenNames.has(name)) {
      diagnostics.warnings.push(`projects.${project} 与 ${seenNames.get(name)} 的显示名重复：${name}`);
    } else {
      seenNames.set(name, project);
    }

    agents.push({
      project,
      name,
      projectPath,
      register: entry.register !== false,
    });
  }

  return { agents, diagnostics };
}

/** 开发模式直接从仓库读 shard/agents.json；打包后由 electron-ipc/runtime 传入安装目录。 */
export function loadDevTemplates({ manifestPath = DEV_MANIFEST } = {}) {
  return loadTemplates({ manifestPath });
}

/** 单人模式是清单里唯一不注册成可拖拽 Agent 的项目。 */
export function singleProject(templates = []) {
  const named = templates.find((item) => item.register === false && /single/i.test(item.project));
  return (named || templates.find((item) => item.register === false))?.projectPath || null;
}
