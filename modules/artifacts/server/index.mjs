import fsp from "node:fs/promises";
import path from "node:path";
import { t } from "../../../shared/messages.mjs";

/* ===== 工作区文件 =====
 * 每个 Agent 的项目目录（projectPath）就是它的工作区。
 * 流程里不再有 runs/<runId>/inputs|output：
 *   - listFiles：列出某个 Agent 工作区里的文件，供流程选文件、产物屏使用；
 *   - moveInputs：把上游工作区里的文件移动到下游工作区（移动，不留副本）；
 *   - read：按工作区白名单读取文本文件。
 */

/* 列目录时跳过的目录：这些是运行时/依赖/版本控制内部文件，不属于“工作区产出”。 */
const IGNORED_DIRS = new Set([".git", ".pi", "node_modules", "__pycache__"]);
const MAX_DEPTH = 2;

/** 相对路径归一：统一分隔符，去掉空段与 ..，只保留工作区内的相对位置。 */
function safeRelative(name) {
  const raw = String(name || "").replace(/\\/g, "/");
  return raw
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

export async function createArtifactsServer({ store, agents }) {
  const { ApiError, ensureDir, isInside } = store;

  /** 这个绝对路径落在哪个 Agent 的工作区里。 */
  function agentOfPath(target) {
    const abs = path.resolve(target);
    return agents.list().find((agent) => isInside(agent.projectPath, abs)) || null;
  }

  async function resolveAllowedPath(target) {
    const agent = agentOfPath(target);
    if (!agent) return null;
    let resolved;
    try {
      resolved = await fsp.realpath(path.resolve(target));
    } catch {
      return null;
    }
    return isInside(agent.projectPath, resolved) ? resolved : null;
  }

  async function listFiles({ agentId }) {
    const agent = agents.list().find((item) => item.id === agentId);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));

    const root = agent.projectPath;
    const found = [];

    async function walk(dir, depth) {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          if (depth > 0) await walk(abs, depth - 1);
          continue;
        }
        try {
          const stat = await fsp.stat(abs);
          found.push({
            name: path.relative(root, abs).split(path.sep).join("/"),
            path: abs,
            size: stat.size,
            ext: path.extname(entry.name).slice(1),
          });
        } catch {
          // 扫描期间文件被删除就跳过。
        }
      }
    }

    await walk(root, MAX_DEPTH);
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 移动单个文件；跨盘（EXDEV）时退化成 copy + 删除，语义仍是移动。 */
  async function moveFile(source, dest) {
    try {
      await fsp.rename(source, dest);
      return;
    } catch (error) {
      /* Windows 上目标已存在时 rename 会失败：先删目标再移动（覆盖语义）。 */
      if (error?.code === "EEXIST" || error?.code === "EPERM") {
        await fsp.rm(dest, { force: true });
        await fsp.rename(source, dest);
        return;
      }
      if (error?.code !== "EXDEV") throw error;
      await fsp.copyFile(source, dest);
      await fsp.unlink(source);
    }
  }

  /**
   * 把上游文件移动到下游 Agent 的工作区。
   * files: [{ name, path }]，name 是相对路径（保留子目录），path 是源绝对路径。
   */
  async function moveInputs({ agent, files = [] }) {
    if (!agent?.projectPath) throw new ApiError(400, t("Agent 不存在"));

    const moved = [];
    for (const file of Array.isArray(files) ? files : []) {
      const source = await resolveAllowedPath(file?.path);
      if (!source) continue;

      const rel = safeRelative(file?.name) || path.basename(source);
      if (!rel) continue;

      const dest = path.join(agent.projectPath, rel);
      if (!isInside(agent.projectPath, dest)) continue;

      try {
        await ensureDir(path.dirname(dest));
        await moveFile(source, dest);
        const stat = await fsp.stat(dest);
        moved.push({ name: rel, path: dest, size: stat.size });
      } catch {
        // 单个文件移动失败不影响其余文件；调用方会看到少一条。
      }
    }
    return moved;
  }

  async function read(target) {
    const agent = agentOfPath(target);
    if (!agent) throw new ApiError(403, t("路径不允许"));

    let resolved;
    try {
      resolved = await fsp.realpath(path.resolve(target));
    } catch {
      throw new ApiError(404, t("文件不存在"));
    }
    /* 符号链接可能把真实路径带出工作区：以 realpath 为准再判一次。 */
    const root = await fsp.realpath(agent.projectPath).catch(() => agent.projectPath);
    if (!isInside(root, resolved)) throw new ApiError(403, t("路径不允许"));

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

  const api = { listFiles, moveInputs, read };
  return {
    api,
    routes: [
      {
        method: "GET",
        pattern: /^\/api\/agents\/([^/]+)\/files$/,
        handler: async ({ params }) => ({ files: await listFiles({ agentId: params[1] }) }),
      },
      {
        method: "GET",
        path: "/api/file",
        handler: ({ url }) => read(url.searchParams.get("path") || ""),
      },
    ],
  };
}
