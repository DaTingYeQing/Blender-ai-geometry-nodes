import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApiError, ensureDir, isInside, now, rid } from "../electron/server/store.mjs";

export function makeStore(state) {
  const store = {
    ApiError,
    ensureDir,
    isInside,
    now,
    rid,
    db: { state },
    saves: 0,
    async saveState() {
      store.saves += 1;
    },
  };
  return store;
}

export function emptyState() {
  return { agents: [], flows: [], runs: {} };
}

export async function makeTempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-test-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待测试条件超时");
}
