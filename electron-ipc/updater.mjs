/* ===== 更新器 =====
 * 负责：拉 update.json、比较版本、下载运行时包、写 pending 交接给 setup。
 * 不依赖 electron：主进程把 installRoot / appVersion / setup-result 路径传进来，
 * 这样本地测试可以直接用临时目录和本地 HTTP 服务跑。
 *
 * 程序安装器只负责下载和记录路径；真正安装由主进程在重启时启动安装包。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { normalizeVersion } from "../shared/versions.mjs";
import {
  readInstalledAssets,
  writeInstalledAssets,
  writePending,
} from "./update-state.mjs";

const REPO = "DaTingYeQing/Blender-ai-geometry-nodes";
const GH_MIRRORS = ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"];
const MANIFEST_TIMEOUT_MS = 15000;
const IDLE_TIMEOUT_MS = 45000;

export function manifestUrls() {
  const override = String(process.env.PI_FLOW_UPDATE_URL || "").trim();
  if (override) {
    return override.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  }
  const direct = `https://github.com/${REPO}/releases/latest/download/update.json`;
  return [...GH_MIRRORS.map((prefix) => `${prefix}${direct}`), direct];
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function hashFile(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .once("end", resolve)
      .once("error", reject);
  });
  return hash.digest("hex");
}

async function sizeOf(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return 0;
  }
}

async function freeSpace(dir) {
  try {
    const stats = await fsp.statfs(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return 0;
  }
}

function mb(bytes) {
  return `${(Number(bytes) / 1048576).toFixed(1)} MB`;
}

function isAbort(error) {
  return error?.name === "AbortError" || /aborted|cancelled/i.test(String(error?.message || ""));
}

function withTimeout(parent, ms) {
  const controller = new AbortController();
  const forward = () => controller.abort(new Error("cancelled"));
  if (parent?.aborted) forward();
  else parent?.addEventListener?.("abort", forward, { once: true });

  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
  };
  arm();

  return {
    signal: controller.signal,
    reset: arm,
    done() {
      clearTimeout(timer);
      parent?.removeEventListener?.("abort", forward);
    },
  };
}

async function fetchManifest() {
  const errors = [];
  for (const url of manifestUrls()) {
    const guard = withTimeout(null, MANIFEST_TIMEOUT_MS);
    try {
      if (url.startsWith("file://") || path.isAbsolute(url)) {
        const file = url.startsWith("file://") ? new URL(url) : url;
        const text = await fsp.readFile(file, "utf8");
        return JSON.parse(text.replace(/^\uFEFF/, ""));
      }
      const response = await fetch(url, {
        signal: guard.signal,
        redirect: "follow",
        headers: { "cache-control": "no-cache" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== "object") throw new Error("清单不是 JSON 对象");
      return data;
    } catch (error) {
      errors.push(`${url} -> ${error.message}`);
    } finally {
      guard.done();
    }
  }
  throw new Error(`拉取更新清单失败：\n${errors.join("\n")}`);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve, reject) => {
      stream.once("drain", resolve);
      stream.once("error", reject);
    });
  }
}

/** 下载到 .part，支持 Range 续传；完成后校验大小和 sha256。 */
async function downloadOne(urls, dest, { sha256, size, onProgress, signal }) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const errors = [];

  for (const url of urls || []) {
    if (signal?.aborted) throw new Error("cancelled");
    try {
      let offset = await sizeOf(part);
      if (size > 0 && offset === size) {
        if (await hashFile(part) === sha256) {
          await fsp.rm(dest, { force: true });
          await fsp.rename(part, dest);
          return;
        }
        await fsp.rm(part, { force: true });
        offset = 0;
      }

      const guard = withTimeout(signal, IDLE_TIMEOUT_MS);
      const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
      let response;
      try {
        response = await fetch(url, { headers, signal: guard.signal, redirect: "follow" });
      } catch (error) {
        guard.done();
        throw error;
      }

      if (response.status === 416) {
        guard.done();
        await fsp.rm(part, { force: true });
        throw new Error("服务器拒绝了续传范围");
      }
      if (!response.ok) {
        guard.done();
        throw new Error(`HTTP ${response.status}`);
      }

      let append = offset > 0 && response.status === 206;
      if (!append) offset = 0;

      const hash = createHash("sha256");
      if (append) {
        await new Promise((resolve, reject) => {
          fs.createReadStream(part)
            .on("data", (chunk) => hash.update(chunk))
            .once("end", resolve)
            .once("error", reject);
        });
      }

      const out = fs.createWriteStream(part, { flags: append ? "a" : "w" });
      let received = offset;
      let lastReport = 0;
      try {
        for await (const chunk of Readable.fromWeb(response.body)) {
          hash.update(chunk);
          received += chunk.length;
          guard.reset();
          await writeChunk(out, chunk);
          const now = Date.now();
          if (now - lastReport > 150) {
            lastReport = now;
            onProgress?.({ received, total: size });
          }
        }
        await new Promise((resolve, reject) => {
          out.end((error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        out.destroy();
        throw error;
      } finally {
        guard.done();
      }

      const actualSize = await sizeOf(part);
      if (size > 0 && actualSize !== size) {
        await fsp.rm(part, { force: true });
        throw new Error(`大小不符：期望 ${size}，实际 ${actualSize}`);
      }
      const digest = hash.digest("hex");
      if (sha256 && digest !== sha256) {
        await fsp.rm(part, { force: true });
        throw new Error("sha256 不匹配");
      }
      await fsp.rm(dest, { force: true });
      await fsp.rename(part, dest);
      return;
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw new Error("cancelled");
      errors.push(`${url} -> ${error.message}`);
      // 换源时丢掉残包，避免不同镜像的内容拼在一起；
      // 整个下载重新开始时，第一个源仍会从 0 继续。
      await fsp.rm(part, { force: true });
    }
  }
  throw new Error(`下载失败：\n${errors.join("\n")}`);
}

function safeName(value) {
  return String(value || "manual").replace(/[^\w.-]+/g, "_");
}

function appChanged(appVersion, manifest) {
  const latest = String(manifest?.app?.version || "");
  if (!latest) return false;
  return normalizeVersion(appVersion) !== normalizeVersion(latest);
}

function runtimeEntry(key, manifest, result, assets) {
  const item = manifest?.runtime?.[key];
  if (!item) return null;
  const idKey = key === "blender" ? "blenderId" : "covtraceId";
  const labelKey = key === "blender" ? "blenderBuild" : "covtraceVersion";
  const installedId = String(assets?.[idKey] || "");
  const installedLabel = String(result?.[labelKey] || "");
  const changed = installedId
    ? installedId !== String(item.id || "")
    : !installedLabel || installedLabel !== String(item.version || "");
  return {
    id: key,
    changed,
    bytes: Number(item.size) || 0,
    current: installedId || installedLabel,
    latest: String(item.version || item.id || ""),
    installedId,
    installedLabel,
    item,
  };
}

function buildPlan(manifest, result, assets) {
  const app = manifest?.app;
  const changedApp = Boolean(app && appChanged(manifest.__appVersion, manifest));
  const runtime = ["blender", "covtrace"]
    .map((key) => runtimeEntry(key, manifest, result, assets))
    .filter(Boolean);

  const components = [];
  if (app) {
    components.push({
      id: "app",
      changed: changedApp,
      bytes: Number(app.installer?.size) || 0,
      current: String(manifest.__appVersion || ""),
      latest: String(app.version || ""),
    });
  }
  for (const entry of runtime) {
    components.push({
      id: entry.id,
      changed: entry.changed,
      bytes: entry.bytes,
      current: entry.current,
      latest: entry.latest,
    });
  }
  const totalBytes = components
    .filter((item) => item.changed)
    .reduce((sum, item) => sum + item.bytes, 0);
  return { app, changedApp, runtime, components, totalBytes };
}

export function createUpdater({
  installRoot,
  appVersion,
  setupResultPath,
  onEvent = () => {},
} = {}) {
  if (!installRoot) throw new Error("createUpdater: 需要 installRoot");

  let manifest = null;
  let running = false;
  let controller = null;

  async function loadManifest() {
    const data = await fetchManifest();
    data.__appVersion = appVersion;
    manifest = data;
    return data;
  }

  async function installed() {
    const result = (await readJson(setupResultPath)) || {};
    const assets = await readInstalledAssets(installRoot);
    return { result, assets };
  }

  async function check() {
    // 手动检查每次都拉最新清单；start 复用这里缓存的结果。
    const data = await loadManifest();
    data.__appVersion = appVersion;
    const { result, assets } = await installed();
    const plan = buildPlan(data, result, assets);

    /* 没有标记但标签对得上：认为已装的就是清单里的内容，补上 ID。 */
    const seed = {};
    for (const entry of plan.runtime) {
      if (!entry.changed && !entry.installedId && entry.item.id) {
        seed[entry.id === "blender" ? "blenderId" : "covtraceId"] = entry.item.id;
      }
    }
    if (Object.keys(seed).length) {
      try {
        await writeInstalledAssets(installRoot, { ...assets, ...seed });
      } catch {
        // 标记写不进去不影响本次检查，下次再补。
      }
    }

    const changed = plan.components.some((item) => item.changed);
    return {
      status: changed ? "available" : "none",
      current: String(appVersion || ""),
      latest: String(data.app?.version || ""),
      components: plan.components,
      totalBytes: plan.totalBytes,
    };
  }

  async function run() {
    const data = manifest || (await loadManifest());
    data.__appVersion = appVersion;
    const { result, assets } = await installed();
    const plan = buildPlan(data, result, assets);
    if (!plan.components.some((item) => item.changed)) {
      onEvent({ phase: "ready" });
      return;
    }

    const updateDir = path.join(installRoot, "updates", safeName(data.app?.version));
    await fsp.mkdir(updateDir, { recursive: true });

    const tasks = [];
    if (plan.changedApp && plan.app?.installer) {
      const name = path.basename(String(plan.app.installer.file || ""));
      tasks.push({
        id: "app",
        dest: path.join(updateDir, name),
        urls: plan.app.installer.urls || [],
        sha256: plan.app.installer.sha256,
        size: Number(plan.app.installer.size) || 0,
      });
    }
    for (const entry of plan.runtime) {
      if (!entry.changed) continue;
      const name = path.basename(String(entry.item.file || ""));
      tasks.push({
        id: entry.id,
        dest: path.join(updateDir, name),
        urls: entry.item.urls || [],
        sha256: entry.item.sha256,
        size: Number(entry.item.size) || 0,
      });
    }

    const total = tasks.reduce((sum, task) => sum + task.size, 0);
    const free = await freeSpace(installRoot);
    const reserve = 64 * 1024 * 1024;
    if (free > 0 && free < total + reserve) {
      throw new Error(
        `磁盘空间不足：需要约 ${mb(total + reserve)}，当前可用 ${mb(free)}。`
        + "请清理磁盘后重试。",
      );
    }

    const receivedByTask = new Map();
    let lastAt = Date.now();
    let lastBytes = 0;

    const emitProgress = (task, received) => {
      const now = Date.now();
      const done = [...receivedByTask.values()].reduce((sum, value) => sum + value, 0);
      const overall = Math.min(total, received + done - (receivedByTask.get(task.id) || 0));
      const elapsed = Math.max(0.001, (now - lastAt) / 1000);
      const speed = Math.max(0, Math.round((overall - lastBytes) / elapsed));
      lastAt = now;
      lastBytes = overall;
      onEvent({
        phase: "progress",
        percent: total > 0 ? Math.round((overall / total) * 100) : 0,
        received: overall,
        total,
        component: task.id,
        speed,
      });
    };

    for (const task of tasks) {
      receivedByTask.set(task.id, 0);
      await downloadOne(task.urls, task.dest, {
        sha256: task.sha256,
        size: task.size,
        signal: controller?.signal,
        onProgress: ({ received }) => {
          receivedByTask.set(task.id, received);
          emitProgress(task, received);
        },
      });
      receivedByTask.set(task.id, task.size);
      emitProgress(task, task.size);
    }

    const blenderName = path.basename(String(data.runtime?.blender?.file || ""));
    const covtraceName = path.basename(String(data.runtime?.covtrace?.file || ""));
    const appInstallerName = plan.changedApp && plan.app?.installer
      ? path.basename(String(plan.app.installer.file || ""))
      : "";

    await writePending(installRoot, {
      schema: 1,
      appVersion: String(data.app?.version || ""),
      createdAt: new Date().toISOString(),
      updateDir,
      blender: data.runtime?.blender
        ? {
          id: data.runtime.blender.id,
          version: data.runtime.blender.version,
          file: blenderName,
          path: path.join(updateDir, blenderName),
        }
        : null,
      covtrace: data.runtime?.covtrace
        ? {
          id: data.runtime.covtrace.id,
          version: data.runtime.covtrace.version,
          file: covtraceName,
          path: path.join(updateDir, covtraceName),
        }
        : null,
      appInstaller: appInstallerName
        ? { file: appInstallerName, path: path.join(updateDir, appInstallerName) }
        : null,
    });

    onEvent({ phase: "ready" });
  }

  return {
    check,
    async start() {
      if (running) return { ok: true };
      running = true;
      controller = new AbortController();
      void (async () => {
        try {
          await run();
        } catch (error) {
          if (!isAbort(error)) {
            onEvent({ phase: "error", message: String(error?.message || error) });
          }
        } finally {
          running = false;
          controller = null;
        }
      })();
      return { ok: true };
    },
    cancel() {
      controller?.abort();
    },
    getManifest() {
      return manifest;
    },
  };
}
