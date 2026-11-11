import fsp from "node:fs/promises";
import path from "node:path";
import { t } from "../../../app/js/core/i18n.mjs";

function flowRoot(agent) {
  return path.join(agent.projectPath, ".pi", "flow");
}

function safeFlowId(flowId) {
  return String(flowId || "default").replace(/[^a-zA-Z0-9_-]/g, "-") || "default";
}

export async function createArtifactsServer({ store, agents }) {
  const { ApiError, ensureDir, isInside } = store;

  function hasAllowedPrefix(target) {
    const abs = path.resolve(target);
    return agents.list().some((agent) => isInside(flowRoot(agent), abs));
  }

  async function resolveAllowedPath(target) {
    if (!hasAllowedPrefix(target)) return null;
    let resolved;
    try {
      resolved = await fsp.realpath(path.resolve(target));
    } catch {
      return null;
    }
    for (const agent of agents.list()) {
      try {
        const root = await fsp.realpath(flowRoot(agent));
        if (isInside(root, resolved)) return resolved;
      } catch {
        // 尚未创建流程目录的 Agent 不包含可读取的产物。
      }
    }
    return false;
  }

  async function prepare({ agent, flowId, runId, inputFiles = [] }) {
    const runDir = path.join(flowRoot(agent), safeFlowId(flowId), "runs", runId);
    const inputDir = path.join(runDir, "inputs");
    const outDir = path.join(runDir, "output");
    await ensureDir(inputDir);
    await ensureDir(outDir);

    const inputs = [];
    for (const file of Array.isArray(inputFiles) ? inputFiles : []) {
      const source = String(file?.path || "");
      if (!source) continue;
      const allowedSource = await resolveAllowedPath(source);
      if (!allowedSource) continue;
      try {
        const stat = await fsp.stat(allowedSource);
        if (!stat.isFile()) continue;
        const dest = path.join(inputDir, path.basename(file.name || allowedSource));
        await fsp.copyFile(allowedSource, dest);
        const copied = await fsp.stat(dest);
        inputs.push({ name: path.basename(dest), path: dest, size: copied.size });
      } catch {
        // 输入文件已不存在时跳过。
      }
    }

    return { runDir, inputDir, outDir, inputs };
  }

  async function removeWorkspaces(flowId) {
    const id = safeFlowId(flowId);
    for (const agent of agents.list()) {
      await fsp.rm(path.join(flowRoot(agent), id), { recursive: true, force: true });
    }
  }

  async function collect(outDir) {
    const found = [];
    async function walk(dir, depth) {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (depth > 0) await walk(abs, depth - 1);
          continue;
        }
        try {
          const stat = await fsp.stat(abs);
          found.push({
            name: path.relative(outDir, abs).split(path.sep).join("/"),
            path: abs,
            size: stat.size,
            ext: path.extname(entry.name).slice(1),
          });
        } catch {
          // 扫描期间文件被删除就跳过。
        }
      }
    }
    await walk(outDir, 3);
    return found;
  }

  async function read(target) {
    if (!hasAllowedPrefix(target)) throw new ApiError(403, t("路径不允许"));
    const resolved = await resolveAllowedPath(target);
    if (resolved === false) throw new ApiError(403, t("路径不允许"));
    if (!resolved) throw new ApiError(404, t("文件不存在"));
    try {
      const stat = await fsp.stat(resolved);
      if (!stat.isFile()) throw new ApiError(404, t("不是文件"));
      if (stat.size > 400_000) return { content: t("（文件过大，原型中不展示）"), size: stat.size };
      return { content: await fsp.readFile(resolved, "utf8"), size: stat.size };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(404, t("文件不存在"));
    }
  }

  for (const agent of agents.list()) await ensureDir(flowRoot(agent));

  const api = { prepare, collect, read, removeWorkspaces };
  return {
    api,
    routes: [
      {
        method: "GET",
        path: "/api/file",
        handler: ({ url }) => read(url.searchParams.get("path") || ""),
      },
    ],
  };
}
