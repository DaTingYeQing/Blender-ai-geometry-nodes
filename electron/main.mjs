import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLocale, t } from "../app/js/core/i18n.mjs";
import { ensureAgents, ensureRuntime, inspectRuntime, isSetupRunning, RESOURCES_DIR, runtimePaths, SHARD_DIR, stopSetup } from "./runtime.mjs";
import { seedAgents } from "./agents-seed.mjs";
import { seedPresetFlow } from "./preset-seed.mjs";
import { singleAgentPath } from "./server/single.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 打包后代码在 app.asar 里，数据必须写到用户目录；开发时留在项目里的 data/，方便直接查看产物。
// 注意不能用 app.isPackaged 单独判断：某些环境会设置 ELECTRON_FORCE_IS_PACKAGED。
const IS_PACKAGED = __dirname.includes("app.asar");

let httpServer = null;
let bootLogFile = null;

/** 启动诊断：每一步都落盘，失败时把堆栈也写进去。 */
function bootLog(line) {
  try {
    if (!bootLogFile) {
      let root;
      try {
        root = runtimePaths().root;
      } catch {
        root = path.join(process.env.APPDATA || __dirname, "Pi Flow");
      }
      fs.mkdirSync(root, { recursive: true });
      bootLogFile = path.join(root, "startup.log");
    }
    fs.appendFileSync(bootLogFile, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    // 诊断日志写不进去不影响启动。
  }
}

process.on("uncaughtException", (error) => {
  bootLog(`uncaughtException: ${error?.stack || error}`);
});

process.on("unhandledRejection", (reason) => {
  bootLog(`unhandledRejection: ${reason?.stack || reason}`);
});

async function readJsonFile(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** 与 shard/lib/env.ts 的 workspaceOf 对齐：共享地址簿 + 项目级覆盖。 */
async function resolveSoloWorkspace() {
  const agent = singleAgentPath();
  const info = await inspectRuntime();

  let configPath = String(process.env.PI_ENV_JSON || "").trim();
  if (!configPath) {
    const installed = await fsp.access(info.config).then(() => true, () => false);
    configPath = installed ? info.config : path.join(SHARD_DIR, "py_environment.json");
  }
  configPath = path.resolve(configPath);

  const shared = await readJsonFile(configPath);
  let root = String(shared?.workspace?.root || "").trim();
  let baseDir = path.dirname(configPath);

  const localPath = path.join(agent, ".pi", "py_environment.json");
  const local = await readJsonFile(localPath);
  const localRoot = String(local?.workspace?.root || "").trim();
  if (localRoot) {
    root = localRoot;
    baseDir = path.dirname(localPath);
  }

  const workspace = root
    ? path.isAbsolute(root)
      ? root
      : path.resolve(baseDir, root)
    : info.workspace;

  return { agent, workspace };
}

function createSetupWindow() {
  return new BrowserWindow({
    width: 660,
    height: 540,
    minWidth: 560,
    minHeight: 480,
    frame: false,
    maximizable: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "pi-flow-icon.png"),
    title: t("Pi Flow 运行环境"),
    webPreferences: {
      preload: path.join(__dirname, "setup-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}

ipcMain.on("setup:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("setup:set-locale", async (_event, locale) => {
  const next = locale === "zh" ? "zh" : "en";
  setLocale(next);
  try {
    const root = runtimePaths().root;
    await fsp.mkdir(root, { recursive: true });
    await fsp.writeFile(path.join(root, "ui-locale.txt"), next, "utf8");
  } catch {
    // 写不进语言标记不影响安装；卸载时按默认英文处理。
  }
});

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on("setup:close", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (isSetupRunning()) {
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      title: t("Pi Flow 运行环境"),
      message: t("安装还没完成，确定要退出吗？"),
      detail: t("下次启动会从上次的进度继续。"),
      buttons: [t("退出"), t("继续等待")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
  }
  win.close();
});

function createSetupLogger(win) {
  let ready = false;
  const pending = [];
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  win.webContents.on("did-finish-load", () => {
    ready = true;
    for (const [channel, payload] of pending) send(channel, payload);
    pending.length = 0;
  });
  return {
    log: (line) => {
      if (ready) send("setup:log", line);
      else pending.push(["setup:log", line]);
    },
    step: (payload) => {
      if (ready) send("setup:step", payload);
      else pending.push(["setup:step", payload]);
    },
    error: (message) => {
      if (ready) send("setup:error", message);
      else pending.push(["setup:error", message]);
    },
  };
}

async function boot() {
  bootLog("==== boot start ====");
  bootLog(`execPath=${process.execPath}`);
  bootLog(`userData=${app.getPath("userData")}`);
  bootLog(`resources=${RESOURCES_DIR}`);
  bootLog(`packaged=${IS_PACKAGED}`);

  if (IS_PACKAGED) {
    process.env.PI_FLOW_DATA_DIR = path.join(app.getPath("userData"), "data");
  }

  bootLog("inspectRuntime start");
  const before = await inspectRuntime();
  bootLog(
    `inspectRuntime done ready=${before.ready} config=${before.config} result=${before.result}`,
  );
  const needsSetup = !before.ready && (IS_PACKAGED || process.env.PI_FLOW_SETUP === "1");
  let setupWin = null;
  let setup = null;
  if (needsSetup) {
    // 安装窗口默认英文；页面加载后若有中文偏好会通过 IPC 切回来。
    setLocale("en");
    setupWin = createSetupWindow();
    setup = createSetupLogger(setupWin);
    await setupWin.loadFile(path.join(__dirname, "setup.html"));
    setup.log(t("正在检查运行环境…"));
    setup.log(t("日志文件：{path}", { path: runtimePaths().log }));
  }

  bootLog(`ensureRuntime start needsSetup=${needsSetup}`);
  try {
    await ensureRuntime({ onLog: setup?.log, onStep: setup?.step });
    bootLog("ensureRuntime done");
    setup?.log(t("运行环境就绪，正在启动…"));
  } catch (error) {
    bootLog(`ensureRuntime failed: ${error?.stack || error}`);
    setup?.error(String(error?.message || error));
    throw error;
  }

  let templateAgents = [];
  let preset = null;
  if (IS_PACKAGED) {
    bootLog("ensureAgents start");
    const agentSetup = await ensureAgents({ onLog: setup?.log });
    templateAgents = agentSetup.agents;
    bootLog(`ensureAgents done agents=${templateAgents.length}`);
    try {
      const file = path.join(RESOURCES_DIR, "presets", "default-flow.json");
      preset = JSON.parse((await fsp.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
      bootLog(`preset loaded nodes=${preset?.nodes?.length ?? 0} edges=${preset?.edges?.length ?? 0}`);
    } catch (error) {
      bootLog(`preset failed: ${error?.stack || error}`);
      setup?.log(t("没有加载默认预设：{message}", { message: error.message }));
    }
  }

  bootLog("import server modules start");
  const store = await import("./server/store.mjs");
  const { createServer } = await import("./server/http.mjs");
  bootLog("import server modules done");

  bootLog("store.loadState start");
  await store.loadState();
  bootLog("store.loadState done");
  if (templateAgents.length) {
    bootLog("seed start");
    let changed = seedAgents(store.db.state, templateAgents, store);
    if (preset) {
      changed = seedPresetFlow(store.db.state, preset, templateAgents, store) || changed;
    }
    if (changed) await store.saveState();
    bootLog(`seed done changed=${changed} agents=${store.db.state.agents.length}`);
    setup?.log(t("已准备 {n} 个 agent", { n: store.db.state.agents.length }));
  }

  bootLog("createServer start");
  const { port, server } = await createServer({ port: 0, host: "127.0.0.1" });
  httpServer = server;
  bootLog(`createServer done port=${port}`);

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    backgroundColor: "#0b0f14",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "pi-flow-icon.png"),
    title: "Pi Flow",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ipcMain.removeHandler("pick-directory");
  ipcMain.handle("pick-directory", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t("选择项目目录"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.removeHandler("get-solo-workspace");
  ipcMain.handle("get-solo-workspace", () => resolveSoloWorkspace());

  ipcMain.removeHandler("open-solo-workspace");
  ipcMain.handle("open-solo-workspace", async () => {
    const { workspace } = await resolveSoloWorkspace();
    try {
      await fsp.mkdir(workspace, { recursive: true });
      const stat = await fsp.stat(workspace);
      if (!stat.isDirectory()) return t("Solo 工作区不是目录：{path}", { path: workspace });
    } catch (error) {
      return t("无法准备 Solo 工作区：{path}（{message}）", { path: workspace, message: error.message });
    }
    return (await shell.openPath(workspace)) || null;
  });

  ipcMain.removeHandler("open-agent-workspace");
  ipcMain.handle("open-agent-workspace", async (_event, agentId) => {
    const agent = store.db.state.agents.find((item) => item.id === agentId);
    if (!agent) return t("Agent 不存在");
    if (!agent.projectPath) return t("Agent 未配置项目路径");

    const target = path.resolve(agent.projectPath);
    try {
      const stat = await fsp.stat(target);
      if (!stat.isDirectory()) return t("工作区不是目录：{path}", { path: target });
    } catch {
      return t("工作区不存在：{path}", { path: target });
    }
    return (await shell.openPath(target)) || null;
  });

  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    bootLog(`did-fail-load code=${code} description=${description} url=${url}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    bootLog(`render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`);
  });

  bootLog(`loadURL start ${port}`);
  await win.loadURL(`http://127.0.0.1:${port}`);
  bootLog("loadURL done");
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  console.log(`Pi Flow 窗口已加载：http://127.0.0.1:${port}`);
}

app.whenReady().then(boot).catch(async (error) => {
  console.error(error);
  bootLog(`BOOT FAILED: ${error?.stack || error}`);
  const logPath = bootLogFile || runtimePaths().log;
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: t("Pi Flow 启动失败"),
    message: t("Pi Flow 启动失败"),
    detail: `${String(error?.message || error)}\n\n${t("启动日志：{path}", { path: logPath })}`,
    buttons: [t("打开日志文件夹"), t("关闭")],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) shell.showItemInFolder(logPath);
  app.quit();
});

app.on("activate", () => {
  if (!httpServer && BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopSetup();
  httpServer?.close();
});
