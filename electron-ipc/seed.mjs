/* ===== 播种资源的三方合并 =====
 * 模板目录（安装包自带）和用户目录（%APPDATA%\Pi Flow\agents）逐文件对比：
 *   - 本地没有 → 新增
 *   - 本地和上次播种的 hash 一致 → 用户没改过 → 用新模板覆盖
 *   - 本地和上次 hash 不同 → 用户改过 → 保留
 *   - 模板里删掉、本地也没改 → 删除；改过的保留
 * 只判断"能不能安全覆盖"，不合并文件内容。
 */

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

export async function hashFile(file) {
  const data = await fsp.readFile(file);
  return crypto.createHash("sha256").update(data).digest("hex");
}

const toPosix = (rel) => rel.split(path.sep).join("/");
const toLocal = (rel) => rel.split("/").join(path.sep);

async function listFiles(root, filter) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (!filter(toPosix(path.relative(root, abs)))) continue;
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  await walk(root);
  return out;
}

/**
 * 执行一次播种合并。
 * @param {object} options
 * @param {string} options.templateRoot 安装包里的模板目录
 * @param {string} options.targetRoot 用户目录
 * @param {object} options.previous 上次的 .pi-flow-seed.json
 * @param {string} options.seedVersion 本版播种版本
 * @param {(rel: string) => boolean} options.filter 哪些相对路径参与播种（posix 分隔符）
 * @returns {Promise<{marker: object, stats: object}>}
 */
export async function mergeSeedTree({
  templateRoot,
  targetRoot,
  previous = {},
  seedVersion = "",
  filter = () => true,
}) {
  const previousFiles =
    previous?.files && typeof previous.files === "object" ? previous.files : {};
  const nextFiles = {};
  const stats = { added: 0, updated: 0, kept: 0, removed: 0, adopted: 0 };

  const templateFiles = await listFiles(templateRoot, filter);
  const templateSet = new Set();

  for (const source of templateFiles) {
    const rel = toPosix(path.relative(templateRoot, source));
    templateSet.add(rel);
    const target = path.join(targetRoot, toLocal(rel));
    const templateHash = await hashFile(source);

    let targetHash = "";
    try {
      targetHash = await hashFile(target);
    } catch {
      targetHash = "";
    }

    if (!targetHash) {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
      nextFiles[rel] = templateHash;
      stats.added++;
      continue;
    }

    // 内容已经和模板一致：直接认领，下次就能安全更新。
    if (targetHash === templateHash) {
      nextFiles[rel] = templateHash;
      if (previousFiles[rel]) stats.kept++;
      else stats.adopted++;
      continue;
    }

    const base = previousFiles[rel];
    if (base && targetHash === base) {
      await fsp.copyFile(source, target);
      nextFiles[rel] = templateHash;
      stats.updated++;
      continue;
    }

    // 用户改过，或者没有历史记录：保留本地文件。
    // 有历史记录时继续记着旧的 base，下次仍能识别"改过"。
    if (base) nextFiles[rel] = base;
    stats.kept++;
  }

  // 模板里已经不存在的文件：只有用户没改过才删。
  for (const [rel, base] of Object.entries(previousFiles)) {
    if (templateSet.has(rel)) continue;
    if (!filter(rel)) continue;
    const target = path.join(targetRoot, toLocal(rel));
    let targetHash = "";
    try {
      targetHash = await hashFile(target);
    } catch {
      continue; // 本地已经没了
    }
    if (base && targetHash === base) {
      await fsp.rm(target, { force: true });
      stats.removed++;
    }
    // 改过的留在原处，不再归播种层管理
  }

  return { marker: { seedVersion, files: nextFiles }, stats };
}
