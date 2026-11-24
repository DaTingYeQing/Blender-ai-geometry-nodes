import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ApiError, ROOT_DIR, APP_DIR, SHARED_DIR, isInside } from "../common.mjs";

export { ApiError, ROOT_DIR, APP_DIR, SHARED_DIR, isInside };

/** 分层版本清单：数据层只关心 dataSchemaVersion，其余版本由 setup 对账。 */
function readVersions() {
  try {
    // 打包后 shard 是 extraResources，不在 app.asar 里；启动时 main 会把它的路径写进 PI_FLOW_HOME。
    const shardDir = process.env.PI_FLOW_HOME || path.join(ROOT_DIR, "shard");
    const raw = fs.readFileSync(path.join(shardDir, "versions.json"), "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

export const DATA_SCHEMA_VERSION = String(readVersions().dataSchemaVersion || "");

// 必须在调用时读取：main.mjs 会在启动阶段才设置 PI_FLOW_DATA_DIR。
// 模块加载时就算好会把路径锁在 app.asar 里，打包后 mkdir 直接 ENOTDIR。
export function dataDir() {
  return process.env.PI_FLOW_DATA_DIR || path.join(ROOT_DIR, "data");
}

export function statePath() {
  return path.join(dataDir(), "state.json");
}

export const now = () => new Date().toISOString();
export const rid = (prefix) => `${prefix}-${crypto.randomBytes(4).toString("hex")}`;

export const db = { state: null };

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function emptyState() {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    agents: [],
    flows: [],
    runs: {},
  };
}

export async function loadState() {
  await ensureDir(dataDir());
  try {
    db.state = JSON.parse(await fsp.readFile(statePath(), "utf8"));
    db.state.agents ||= [];
    db.state.runs ||= {};
    db.state.flows ||= [];
    // 旧文件没有版本号：先按当前版本记上，后续迁移才有依据。
    if (!db.state.schemaVersion && DATA_SCHEMA_VERSION) {
      db.state.schemaVersion = DATA_SCHEMA_VERSION;
      await saveState();
    }
  } catch {
    db.state = emptyState();
    await saveState();
  }
}

let saveChain = Promise.resolve();

/** 串行写入，避免并发 run 互相覆盖同一个临时文件。 */
export function saveState() {
  const snapshot = JSON.stringify(db.state, null, 2);
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      const target = statePath();
      const tmp = `${target}.tmp`;
      await fsp.writeFile(tmp, snapshot);
      await fsp.rename(tmp, target);
    });
  return saveChain;
}
