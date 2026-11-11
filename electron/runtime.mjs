import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../app/js/core/i18n.mjs";

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

export async function runSetup({ onLog, onStep } = {}) {
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

  const logPath = paths.log;
  const tail = [];
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
      tail.push(line);
      if (tail.length > 8) tail.shift();
      appendLog(line);
      onLog?.(line);
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
        const context = tail.slice(-4).join(" ");
        appendLog(`[exit ${code}]`);
        reject(
          new Error(
            t("安装脚本退出码 {code}{context}\n日志：{log}", {
              code,
              context: context ? `: ${context}` : "",
              log: logPath,
            }),
          ),
        );
      }
    });
  });

  const info = await inspectRuntime();
  if (!info.ready) {
    throw new Error(t("安装完成，但运行时文件仍不完整\n日志：{log}", { log: logPath }));
  }
  return info;
}

function shouldCopyAgentPath(file) {
  const rel = path.relative(AGENTS_TEMPLATE_DIR, file).split(path.sep).join("/");
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

async function copyAgentTemplates(dest) {
  if (!(await exists(AGENTS_TEMPLATE_DIR))) {
    throw new Error(t("找不到 agent 模板：{path}", { path: AGENTS_TEMPLATE_DIR }));
  }
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(AGENTS_TEMPLATE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const src = path.join(AGENTS_TEMPLATE_DIR, entry.name);
    const target = path.join(dest, entry.name);
    await fsp.cp(src, target, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (file) => shouldCopyAgentPath(file),
    });
  }
}

async function runAgentSync(dir, onLog) {
  const script = path.join(SHARD_DIR, "sync.mjs");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "sync"], {
      cwd: SHARD_DIR,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_FLOW_AGENTS_DIR: dir },
      windowsHide: true,
    });
    let stderr = "";
    const forward = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) onLog?.(line);
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      forward(chunk);
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

async function readTemplateAgents(dir) {
  const manifest = await readJson(AGENTS_JSON);
  const projects = manifest?.projects || {};
  const agents = [];
  for (const [project, entry] of Object.entries(projects)) {
    if (entry?.enabled === false) continue;
    const rel = entry?.path || project;
    const projectPath = path.join(dir, path.basename(rel));
    if (!(await exists(projectPath))) continue;
    agents.push({
      project,
      name: entry?.displayName || project,
      projectPath,
      register: entry?.register !== false,
    });
  }
  return agents;
}

export async function ensureAgents({ onLog } = {}) {
  if (!IS_PACKAGED) return { dir: agentsDir(), agents: [] };
  const dir = agentsDir();
  onLog?.(t("准备 agent 模板…"));
  await copyAgentTemplates(dir);
  onLog?.(t("同步 agent 配置…"));
  await runAgentSync(dir, onLog);
  return { dir, agents: await readTemplateAgents(dir) };
}

export async function ensureRuntime({ onLog, onStep, force = false } = {}) {
  let info = await inspectRuntime();
  if (info.ready && !force) {
    await applyRuntimeEnv(info);
    return { ...info, ranSetup: false, skipped: false };
  }

  const allowSetup = IS_PACKAGED || process.env.PI_FLOW_SETUP === "1" || force;
  if (!allowSetup) {
    process.env.PI_FLOW_HOME = SHARD_DIR;
    onLog?.(t("开发模式：使用 shard/py_environment.json"));
    return { ...info, ranSetup: false, skipped: true };
  }

  onLog?.(t("开始安装运行环境…"));
  info = await runSetup({ onLog, onStep });
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
