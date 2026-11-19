import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../shared/messages.mjs";
import { mergeSeedTree } from "./seed.mjs";
import { normalizeVersion } from "../shared/versions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PACKAGED = __dirname.includes("app.asar");

export const RESOURCES_DIR = IS_PACKAGED ? process.resourcesPath : path.resolve(__dirname, "..");
export const SHARD_DIR = path.join(RESOURCES_DIR, "shard");
export const AGENTS_TEMPLATE_DIR = path.join(RESOURCES_DIR, "agents");
const SETUP_SCRIPT = path.join(RESOURCES_DIR, "scripts", "setup-runtime.ps1");
const ENV_TEMPLATE = path.join(SHARD_DIR, "py_environment.json");
const AGENTS_JSON = path.join(SHARD_DIR, "agents.json");
const BUNDLED_BLENDER_ZIP = path.join(
  IS_PACKAGED ? path.join(process.resourcesPath, "blender") : path.join(RESOURCES_DIR, "resources", "blender"),
  "blender-4.5.0-trace-win64.zip",
);
const BUNDLED_COVTRACE_ZIP = path.join(path.dirname(BUNDLED_BLENDER_ZIP), "covtrace-toolchain.zip");
const BUNDLE_DIR = IS_PACKAGED
  ? path.join(process.resourcesPath, "bundles")
  : path.join(RESOURCES_DIR, "resources", "bundles");

let setupChild = null;

function resolveFromConfig(configPath, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.resolve(path.dirname(configPath), text);
}

async function exists(file) {
  if (!file) return false;
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export function installRoot() {
  const override = String(process.env.PI_FLOW_RUNTIME_ROOT || "").trim();
  if (override) return path.resolve(override);
  return IS_PACKAGED ? app.getPath("userData") : path.join(RESOURCES_DIR, "data");
}

export function agentsDir() {
  return path.join(installRoot(), "agents");
}

export function runtimePaths() {
  const root = installRoot();
  return {
    root,
    config: path.join(root, "config", "py_environment.json"),
    result: path.join(root, "setup-result.json"),
    log: path.join(root, "setup.log"),
    workspace: path.join(root, "workspace"),
  };
}

/** 本版期望的分层版本：来自 bundled 的 shard/versions.json，Blender 版本取压缩包名。 */
async function expectedVersions() {
  const versions = (await readJson(path.join(SHARD_DIR, "versions.json"))) || {};
  const match = /blender-([\d.]+)/.exec(path.basename(BUNDLED_BLENDER_ZIP));
  return {
    appVersion: app.getVersion(),
    runtimeLayout: String(versions.runtimeLayout || ""),
    covtraceVersion: String(versions.covtraceVersion || ""),
    configVersion: String(versions.configVersion || ""),
    blenderVersion: match ? normalizeVersion(match[1]) : "",
  };
}

/** 对比已安装清单和本版期望，返回需要处理的层。空数组表示可以直接复用。 */
export async function runtimeVersionMismatches(info) {
  const expected = await expectedVersions();
  const result = info?.resultData || {};
  // 旧版清单没有版本字段：跑一次幂等 setup 把版本补上，不重建 Blender。
  if (!result.runtimeLayout && !result.blenderVersion) return ["legacy"];

  const mismatches = [];
  if (expected.runtimeLayout && String(result.runtimeLayout || "") !== expected.runtimeLayout) {
    mismatches.push("runtimeLayout");
  }
  if (expected.blenderVersion && String(result.blenderVersion || "") !== expected.blenderVersion) {
    mismatches.push("blenderVersion");
  }
  if (expected.covtraceVersion && String(result.covtraceVersion || "") !== expected.covtraceVersion) {
    mismatches.push("covtraceVersion");
  }
  if (expected.configVersion && String(info?.configData?.configVersion || "") !== expected.configVersion) {
    mismatches.push("configVersion");
  }
  return mismatches;
}

/** 布局变化：先把旧 runtime 挪开，setup 失败时还能还原。 */
async function moveAsideRuntime() {
  const runtime = path.join(installRoot(), "runtime");
  if (!(await exists(runtime))) return "";
  const backup = `${runtime}.old-${Date.now()}`;
  await fsp.rename(runtime, backup);
  return backup;
}

/** 把当前版本携带的卸载脚本覆盖到数据目录；失败不影响启动，下次再试。 */
async function refreshCleanupScript() {
  const source = path.join(RESOURCES_DIR, "scripts", "uninstall-runtime.ps1");
  const root = runtimePaths().root;
  try {
    await fsp.mkdir(root, { recursive: true });
    await fsp.copyFile(source, path.join(root, "uninstall-runtime.ps1"));
  } catch {
    // 数据目录不可写或脚本缺失时保持旧副本。
  }
}

export async function inspectRuntime() {
  const paths = runtimePaths();
  const configData = await readJson(paths.config);
  const resultData = await readJson(paths.result);
  const python = resolveFromConfig(paths.config, configData?.python?.exe);
  const blender = resolveFromConfig(paths.config, configData?.blender?.exe);
  const workspace = resolveFromConfig(paths.config, configData?.workspace?.root) || paths.workspace;
  const piCli = String(resultData?.piCli || "").trim();
  const nodeExe = String(resultData?.nodeExe || "").trim();
  const ready =
    Boolean(python && blender && piCli) &&
    (await exists(python)) &&
    (await exists(blender)) &&
    (await exists(piCli));
  return { ...paths, configData, resultData, python, blender, workspace, piCli, nodeExe, ready };
}

export async function applyRuntimeEnv(info) {
  process.env.PI_ENV_JSON = info.config;
  process.env.PI_FLOW_HOME = SHARD_DIR;
  if (IS_PACKAGED) process.env.PI_FLOW_AGENTS_ROOT = agentsDir();
  if (info.piCli) process.env.PI_BIN = info.piCli;
  if (info.nodeExe) process.env.PI_NODE = info.nodeExe;
  // pi 的 bash 工具按 PATH 找 bash；内置 Git 解压在 runtime 下时需要显式加入。
  const gitBash = String(info.resultData?.gitBash || "").trim();
  if (gitBash) {
    const gitBin = path.dirname(gitBash);
    const currentPath = String(process.env.PATH || "");
    const alreadyIncluded = currentPath
      .split(path.delimiter)
      .some((item) => item.toLowerCase() === gitBin.toLowerCase());
    if (!alreadyIncluded) {
      process.env.PATH = currentPath ? `${gitBin}${path.delimiter}${currentPath}` : gitBin;
    }
  }
  if (info.workspace) {
    process.env.PI_FLOW_WORKSPACE = info.workspace;
    await fsp.mkdir(info.workspace, { recursive: true });
  }
}

const STEP_PLAN_RE = /^PIFLOW_STEPS=(.+)$/;
const STEP_STATE_RE = /^PIFLOW_STEP=(\d+)\/(\d+)\|(running|done|failed)\|(.*)$/;
const STEP_ERROR_RE = /^PIFLOW_ERROR=(.*)$/;
const ERROR_LINE_RE = /^ERROR:\s*(.*)$/;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export async function runSetup({ onStep, forceBlender = false } = {}) {
  const paths = runtimePaths();
  await fsp.mkdir(paths.root, { recursive: true });
  if (!(await exists(SETUP_SCRIPT))) {
    throw new Error(t("找不到安装脚本：{path}", { path: SETUP_SCRIPT }));
  }
  if (!(await exists(ENV_TEMPLATE))) {
    throw new Error(t("找不到地址簿模板：{path}", { path: ENV_TEMPLATE }));
  }
  if (!(await exists(BUNDLED_BLENDER_ZIP))) {
    throw new Error(t("安装包缺少 Blender：{path}", { path: BUNDLED_BLENDER_ZIP }));
  }
  if (!(await exists(BUNDLED_COVTRACE_ZIP))) {
    throw new Error(t("安装包缺少 CovTrace 工具链：{path}", { path: BUNDLED_COVTRACE_ZIP }));
  }

  const logPath = paths.log;
  const appendLog = (line) => {
    try {
      fs.appendFileSync(logPath, line + "\n", "utf8");
    } catch {
      // 日志写不进去不影响安装
    }
  };
  try {
    fs.writeFileSync(logPath, `[${new Date().toISOString()}] setup start\n`, "utf8");
  } catch {
    // 同上
  }

  // 窗口只需要步骤和一条人能读懂的原因；子进程的完整输出只进 setup.log。
  let failure = "";

  await new Promise((resolve, reject) => {
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SETUP_SCRIPT,
      "-InstallRoot",
      paths.root,
      "-EnvTemplate",
      ENV_TEMPLATE,
      "-BundleDir",
      BUNDLE_DIR,
      "-BlenderArchive",
      BUNDLED_BLENDER_ZIP,
      "-ResultPath",
      paths.result,
      "-AppVersion",
      app.getVersion(),
      ...(forceBlender ? ["-ForceBlender"] : []),
      "-AutoUpgradeNode",
    ];
    const child = spawn("powershell.exe", args, { windowsHide: true, env: { ...process.env } });
    setupChild = child;
    const handleLine = (line) => {
      const plan = line.match(STEP_PLAN_RE);
      if (plan) {
        onStep?.({ type: "plan", titles: plan[1].split("|").filter(Boolean) });
        return;
      }
      const state = line.match(STEP_STATE_RE);
      if (state) {
        onStep?.({
          type: "state",
          index: Number(state[1]),
          total: Number(state[2]),
          status: state[3],
          title: state[4].trim(),
        });
        return;
      }
      const marked = line.match(STEP_ERROR_RE);
      if (marked) {
        failure = marked[1].trim();
        appendLog(`ERROR: ${failure}`);
        return;
      }
      const plainError = line.replace(ANSI_RE, "").match(ERROR_LINE_RE);
      if (plainError && !failure) failure = plainError[1].trim();
      appendLog(line);
    };
    // stdout/stderr 分开缓冲，避免标记行被 chunk 边界切断。
    const createForwarder = () => {
      let buffer = "";
      const run = (chunk) => {
        buffer += String(chunk);
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop();
        for (const line of parts) {
          if (line.trim()) handleLine(line);
        }
      };
      run.flush = () => {
        if (buffer.trim()) handleLine(buffer);
        buffer = "";
      };
      return run;
    };
    const stdoutForward = createForwarder();
    const stderrForward = createForwarder();
    child.stdout?.on("data", stdoutForward);
    child.stderr?.on("data", stderrForward);
    child.on("error", (error) => {
      setupChild = null;
      reject(error);
    });
    child.on("exit", (code) => {
      stdoutForward.flush();
      stderrForward.flush();
      setupChild = null;
      if (code === 0) resolve();
      else {
        appendLog(`[exit ${code}]`);
        reject(new Error(failure || t("安装脚本异常退出（代码 {code}）", { code })));
      }
    });
  });

  const info = await inspectRuntime();
  if (!info.ready) {
    throw new Error(t("安装完成，但运行时文件仍不完整"));
  }
  return info;
}

/** 哪些相对路径由播种层管理；生成的配置和运行时产物不碰。 */
function shouldCopyRel(rel) {
  if (!rel) return true;
  if (rel.includes("/.pi/flow")) return false;
  if (
    rel.endsWith("/.pi/settings.json") ||
    rel.endsWith("/.pi/pi-flow.json") ||
    rel.endsWith("/.pi/py_environment.json")
  ) {
    return false;
  }
  const parts = rel.split("/");
  if (parts.includes("extensions.legacy") || parts.includes("__pycache__")) return false;
  if (rel.endsWith(".pyc")) return false;
  return true;
}

async function runAgentSync(dir) {
  const script = path.join(SHARD_DIR, "sync.mjs");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "sync"], {
      cwd: SHARD_DIR,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_FLOW_AGENTS_DIR: dir },
      windowsHide: true,
    });
    let stderr = "";
    child.stdout?.resume();
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
        reject(
          new Error(
            t("同步 agent 配置失败（退出码 {code}）{tail}", {
              code,
              tail: tail ? `: ${tail}` : "",
            }),
          ),
        );
      }
    });
  });
}

/** 把播种结果写回 agents/.pi-flow-seed.json；先写临时文件再改名，避免半份清单。 */
async function writeSeedMarker(dir, marker) {
  const target = path.join(dir, ".pi-flow-seed.json");
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(marker, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, target);
}

export async function ensureAgents() {
  // 开发模式直接用仓库里的 agents/，不复制、不同步
  if (!IS_PACKAGED) {
    return { dir: AGENTS_TEMPLATE_DIR, manifestPath: AGENTS_JSON, packaged: false };
  }
  const dir = agentsDir();
  if (!(await exists(AGENTS_TEMPLATE_DIR))) {
    throw new Error(t("找不到 agent 模板：{path}", { path: AGENTS_TEMPLATE_DIR }));
  }
  const versions = (await readJson(path.join(SHARD_DIR, "versions.json"))) || {};
  const previous = (await readJson(path.join(dir, ".pi-flow-seed.json"))) || {};
  const { marker, stats } = await mergeSeedTree({
    templateRoot: AGENTS_TEMPLATE_DIR,
    targetRoot: dir,
    previous,
    seedVersion: String(versions.seedVersion || ""),
    filter: shouldCopyRel,
  });
  await runAgentSync(dir);
  await writeSeedMarker(dir, marker);
  return { dir, manifestPath: AGENTS_JSON, packaged: true, seedStats: stats };
}

export async function ensureRuntime({ onStep, force = false } = {}) {
  // 清理脚本随应用版本走：更新覆盖安装后 setup 通常不会再跑，
  // 这里每次启动都刷新一次，老用户才能用上修好的卸载逻辑。
  await refreshCleanupScript();

  let info = await inspectRuntime();
  const allowSetup = IS_PACKAGED || process.env.PI_FLOW_SETUP === "1" || force;

  // 环境完整时再对账版本：全部一致才跳过，有差异按层补。
  if (info.ready && !force) {
    const mismatches = await runtimeVersionMismatches(info);
    if (mismatches.length === 0) {
      await applyRuntimeEnv(info);
      return { ...info, ranSetup: false, skipped: false, mismatches };
    }

    if (!allowSetup) {
      process.env.PI_FLOW_HOME = SHARD_DIR;
      return { ...info, ranSetup: false, skipped: true, mismatches };
    }

    console.log(`Pi Flow 运行时版本变化：${mismatches.join(", ")}`);
    // 只有布局变化才重建整个 runtime；旧清单和配置版本只跑幂等补件。
    const rebuild = mismatches.includes("runtimeLayout");
    const forceBlender = mismatches.includes("blenderVersion") && !rebuild;
    const backup = rebuild ? await moveAsideRuntime() : "";
    try {
      info = await runSetup({ onStep, forceBlender });
    } catch (error) {
      if (backup) {
        try {
          await fsp.rm(path.join(installRoot(), "runtime"), { recursive: true, force: true });
          await fsp.rename(backup, path.join(installRoot(), "runtime"));
        } catch {
          // 还原失败时保留备份目录，原路径在错误日志里
        }
      }
      throw error;
    }
    if (backup) void fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    await applyRuntimeEnv(info);
    return { ...info, ranSetup: true, skipped: false, mismatches };
  }

  if (!allowSetup) {
    process.env.PI_FLOW_HOME = SHARD_DIR;
    return { ...info, ranSetup: false, skipped: true };
  }

  info = await runSetup({ onStep });
  await applyRuntimeEnv(info);
  return { ...info, ranSetup: true, skipped: false };
}

export function stopSetup() {
  if (!setupChild) return;
  try {
    setupChild.kill();
  } catch {
    // 已退出
  }
  setupChild = null;
}

export function isSetupRunning() {
  return Boolean(setupChild);
}
