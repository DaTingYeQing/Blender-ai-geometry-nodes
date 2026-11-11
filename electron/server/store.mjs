import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "../..");
export const APP_DIR = path.join(ROOT_DIR, "app");

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

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

export function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function emptyState() {
  return {
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
