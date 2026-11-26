/* ===== 更新状态文件 =====
 * 只负责读写 installRoot/updates 下的几个 JSON，不碰 electron、不下载。
 *   pending.json          本次已下载、等下次启动应用的运行时包
 *   installed-assets.json 实际应用过的组件 ID（内容哈希）
 */
import fsp from "node:fs/promises";
import path from "node:path";

export function updatesDir(root) {
  return path.join(root, "updates");
}

export function pendingPath(root) {
  return path.join(updatesDir(root), "pending.json");
}

export function assetsMarkerPath(root) {
  return path.join(updatesDir(root), "installed-assets.json");
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fsp.rm(file, { force: true });
  await fsp.rename(tmp, file);
}

export async function readPending(root) {
  const data = await readJson(pendingPath(root));
  return data && typeof data === "object" ? data : null;
}

export async function writePending(root, data) {
  await writeJson(pendingPath(root), data);
}

export async function clearPending(root) {
  await fsp.rm(pendingPath(root), { force: true });
}

export async function readInstalledAssets(root) {
  const data = await readJson(assetsMarkerPath(root));
  return data && typeof data === "object" ? data : {};
}

export async function writeInstalledAssets(root, data) {
  await writeJson(assetsMarkerPath(root), data);
}
