import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLocale, t } from "../shared/messages.mjs";
import { ensureAgents, ensureRuntime, inspectRuntime, installRoot, isSetupRunning, RESOURCES_DIR, runtimePaths, runtimeVersionMismatches, SHARD_DIR, stopSetup } from "./runtime.mjs";
import { createUpdater } from "./updater.mjs";
import { readPending } from "./update-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETUP_UI_DIR = path.join(RESOURCES_DIR, "scripts", "setup-ui");

// 打包后代码在 app.asar 里，数据必须写到用户目录；开发时留在项目里的 data/，方便直接查看产物。
// 注意不能用 app.isPackaged 单独判断：某些环境会设置 ELECTRON_FORCE_IS_PACKAGED。
const IS_PACKAGED = __dirname.includes("app.asar");

let httpServer = null;
let bootLogFile = null;
let minWindowSize = { width: 960, height: 640 };
let singleApi = null;

function windowOf(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : null;
}

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
  const agent = singleApi ? singleApi.path() : "";
  if (!agent) throw new Error(t("单人模式路径尚未就绪"));
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
    width: 700,
    height: 620,
    frame: false,
    maximizable: false,
    resizable: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "pi-flow-icon.png"),
    title: t("Pi Flow 运行环境"),
    webPreferences: {
      preload: path.join(SETUP_UI_DIR, "setup-preload.cjs"),
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

/* 前端手动保存的“有未保存改动”标记；关闭窗口的确认也在这里协调。 */
let windowDirty = false;
let allowClose = false;
let closePending = false;

ipcMain.on("window:dirty", (_event, value) => {
  windowDirty = Boolean(value);
});

/* 渲染进程对关窗询问的回复：close = 可以关，其它 = 留在窗口。 */
ipcMain.on("window:close-response", (event, action) => {
  closePending = false;
  if (action !== "close") return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  allowClose = true;
  win.close();
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

/* ---------- 应用内更新 ----------
 * mock：开发模式或 PI_FLOW_UPDATE_MOCK=1，用模拟数据调 UI。
 * real：打包版或设置了 PI_FLOW_UPDATE_URL，拉 update.json 并真实下载。
 */
const updateTimers = new Map();
let activeUpdater = null;

function updateMode() {
  if (process.env.PI_FLOW_UPDATE_MOCK === "1") return "mock";
  if (IS_PACKAGED || process.env.PI_FLOW_UPDATE_URL) return "real";
  return "mock";
}

function createRealUpdater(sender) {
  return createUpdater({
    installRoot: installRoot(),
    appVersion: app.getVersion(),
    setupResultPath: runtimePaths().result,
    onEvent: (payload) => {
      if (payload.phase === "ready" || payload.phase === "error") {
        activeUpdater = null;
      }
      if (sender && !sender.isDestroyed()) sender.send("update:event", payload);
    },
  });
}

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ""));
  if (!match) return String(version || "");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function mockUpdatePayload() {
  const current = app.getVersion();
  const latest = nextPatchVersion(current);
  const components = [
    { id: "app", current, latest, bytes: 38_000_000, changed: true },
    { id: "blender", current: "2026-11-22", latest: "2026-12-01", bytes: 720_000_000, changed: true },
    { id: "covtrace", current: "1.0.0", latest: "1.0.0", bytes: 32_000_000, changed: false },
  ];
  return {
    status: "available",
    current,
    latest,
    components,
    totalBytes: components
      .filter((item) => item.changed)
      .reduce((sum, item) => sum + item.bytes, 0),
  };
}

function clearUpdateTimer(sender) {
  const timer = updateTimers.get(sender.id);
  if (timer == null) return;
  clearInterval(timer);
  updateTimers.delete(sender.id);
}

ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("update:check", async () => {
  if (updateMode() === "real") {
    try {
      return await createRealUpdater(null).check();
    } catch (error) {
      return { status: "error", message: String(error?.message || error) };
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
  return mockUpdatePayload();
});

ipcMain.handle("update:start", async (event) => {
  const sender = event.sender;
  clearUpdateTimer(sender);

  if (updateMode() === "real") {
    activeUpdater?.cancel?.();
    activeUpdater = createRealUpdater(sender);
    return activeUpdater.start();
  }

  const payload = mockUpdatePayload();
  const changed = payload.components.filter((item) => item.changed);
  const total = payload.totalBytes;
  const steps = 40;
  let step = 0;

  const timer = setInterval(() => {
    step += 1;
    const ratio = Math.min(1, step / steps);
    const received = Math.round(total * ratio);
    let accumulated = 0;
    let component = changed[changed.length - 1]?.id || "";
    for (const item of changed) {
      accumulated += item.bytes;
      if (received <= accumulated) {
        component = item.id;
        break;
      }
    }
    if (!sender.isDestroyed()) {
      sender.send("update:event", {
        phase: "progress",
        percent: Math.round(ratio * 100),
        received,
        total,
        component,
        speed: Math.round(total / (steps * 0.12)),
      });
    }
    if (ratio >= 1) {
      clearUpdateTimer(sender);
      if (!sender.isDestroyed()) sender.send("update:event", { phase: "ready" });
    }
  }, 120);

  updateTimers.set(sender.id, timer);
  sender.once("destroyed", () => clearUpdateTimer(sender));
  return { ok: true };
});

ipcMain.handle("update:cancel", (event) => {
  clearUpdateTimer(event.sender);
  activeUpdater?.cancel?.();
  activeUpdater = null;
  if (!event.sender.isDestroyed()) {
    event.sender.send("update:event", { phase: "cancelled" });
  }
  return { ok: true };
});

ipcMain.handle("update:restart", async () => {
  const pending = await readPending(installRoot());
  const installer = pending?.appInstaller?.path;

  if (installer && fs.existsSync(installer)) {
    // 开发/演示模式下不启动真实安装器，避免误装。
    if (!IS_PACKAGED) return { ok: true, mock: true };

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      await dialog.showMessageBox(win, {
        type: "info",
        title: t("更新"),
        message: t("安装程序即将启动"),
        detail: t("请按提示完成安装；完成后重新打开 Pi Flow，已下载的运行时会在启动时应用。"),
        buttons: [t("继续")],
        defaultId: 0,
        noLink: true,
      });
    }
    // 安装包会替换程序文件；先启动它，再退出当前进程。
    // 新程序启动后会读到 pending，把已经下好的运行时应用掉。
    spawn(installer, [], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return { ok: true };
  }

  // 开发/演示模式下不真的重启，避免调 UI 时反复退出。
  if (!IS_PACKAGED && process.env.PI_FLOW_UPDATE_MOCK !== "1") {
    return { ok: true, mock: true };
  }
  app.relaunch();
  app.exit(0);
  return { ok: true };
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
  // 主进程对话框默认英文；安装窗口或界面切到中文后会通过 IPC 改回来。
  setLocale("en");

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
  const versionIssues = before.ready ? await runtimeVersionMismatches(before) : [];
  bootLog(`runtime version issues=${versionIssues.join(",") || "none"}`);
  const needsSetup = (!before.ready || versionIssues.length > 0)
    && (IS_PACKAGED || process.env.PI_FLOW_SETUP === "1");
  let setupWin = null;
  let setup = null;
  if (needsSetup) {
    // 安装窗口默认英文；页面加载后若有中文偏好会通过 IPC 切回来。
    setLocale("en");
    setupWin = createSetupWindow();
    setup = createSetupLogger(setupWin);
    await setupWin.loadFile(path.join(SETUP_UI_DIR, "setup.html"));
  }

  bootLog(`ensureRuntime start needsSetup=${needsSetup}`);
  try {
    await ensureRuntime({ onStep: setup?.step });
    bootLog("ensureRuntime done");
  } catch (error) {
    bootLog(`ensureRuntime failed: ${error?.stack || error}`);
    setup?.error(String(error?.message || error));
    throw error;
  }

  // 开发模式读仓库里的 agents/，打包后读安装目录；两边都走同一套播种逻辑。
  bootLog("ensureAgents start");
  const agentSetup = await ensureAgents();
  bootLog(`ensureAgents done dir=${agentSetup.dir}`);

  bootLog("import server modules start");
  const { createServer } = await import("../server/http.mjs");
  bootLog("import server modules done");

  bootLog("createServer start");
  const { port, server, apis } = await createServer({ port: 0, host: "127.0.0.1" });
  httpServer = server;
  singleApi = apis.single;
  bootLog(`createServer done port=${port}`);

  let seededChanged = false;
  const loaded = agentSetup.packaged
    ? await apis.registry.loadTemplates({
        manifestPath: agentSetup.manifestPath,
        resolveProjectPath: (project, entry) =>
          path.join(agentSetup.dir, path.basename(entry?.path || project)),
      })
    : await apis.registry.loadTemplates({ manifestPath: agentSetup.manifestPath });
  for (const warning of loaded.diagnostics.warnings) bootLog(`registry warning: ${warning}`);
  for (const item of loaded.diagnostics.skipped) {
    bootLog(`registry skip: ${item.project} ${item.reason}${item.path ? ` ${item.path}` : ""}`);
  }

  const preset = await apis.registry.readPreset(path.join(RESOURCES_DIR, "presets", "default-flow.json"));
  bootLog(`preset loaded nodes=${preset?.nodes?.length ?? 0} edges=${preset?.edges?.length ?? 0}`);
  if (!preset) bootLog(t("没有加载默认预设"));

  const seeded = await apis.registry.seed({
    templates: loaded.agents,
    preset,
    diagnostics: loaded.diagnostics,
  });
  seededChanged = seeded.changed;
  const single = apis.registry.singleProject(loaded.agents);
  if (single) process.env.PI_FLOW_SINGLE_AGENT = single;
  bootLog(`seed done changed=${seededChanged} agents=${apis.agents.list().length}`);
  bootLog(t("已准备 {n} 个 agent", { n: apis.agents.list().length }));

  const workArea = screen.getPrimaryDisplay().workAreaSize;
  minWindowSize = {
    width: Math.max(800, Math.min(1100, workArea.width - 32)),
    height: Math.max(560, Math.min(680, workArea.height - 32)),
  };
  const width = Math.min(1480, Math.max(minWindowSize.width, workArea.width - 32));
  const height = Math.min(920, Math.max(minWindowSize.height, workArea.height - 32));
  bootLog(`window size=${width}x${height} min=${minWindowSize.width}x${minWindowSize.height} workArea=${workArea.width}x${workArea.height}`);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: minWindowSize.width,
    minHeight: minWindowSize.height,
    center: true,
    // 无边框窗口：标题栏由 UI 自己画（顶栏 + 右上角三个点），
    // thickFrame 保留系统的缩放边框、阴影、最大化/还原动画和贴边分屏。
    // 拖动交给顶栏的 -webkit-app-region: drag，不写 JS。
    frame: false,
    thickFrame: true,
    // 只能用不透明窗口：Windows 上透明窗口是分层窗口，会丢掉 DWM 的
    // 最大化/还原动画、Aero Snap 和原生缩放边框。圆角交给系统裁。
    // 底色和素底背景的主色一致，首帧/圆角就不会闪出另一种颜色。
    backgroundColor: "#a6a6a6",
    resizable: true,
    maximizable: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "pi-flow-icon.png"),
    title: "Pi Flow",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 界面按这个标记决定总线要不要"未登记意图直接抛错"。
      // 打包版必须宽松：一条没登记的意图不该把正在跑的流程打断。
      additionalArguments: [IS_PACKAGED ? "--pi-flow-prod" : "--pi-flow-dev"],
    },
  });

  /* 关窗保护：先问后端有没有节点在跑，再把结果交给界面画自己的确认框。
   * close 必须先同步拦住，否则窗口已经关掉了。 */
  win.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closePending) return;      // 已经在问，别重复弹
    closePending = true;

    (async () => {
      let running = 0;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/runs/active`, {
          signal: AbortSignal.timeout(1500),
        });
        const data = await res.json();
        running = Number(data?.count) || 0;
      } catch {
        running = 0;   // 问不到（后端已停）就不拦
      }

      win.webContents.send("app:close-request", { running, dirty: windowDirty });

      /* 渲染进程没回（崩了 / 卡住）就兜底放行，别让窗口永远关不掉。 */
      setTimeout(() => {
        if (!closePending) return;
        closePending = false;
        allowClose = true;
        win.close();
      }, 15000);
    })();
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
    const agent = apis.agents.get(agentId);
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

  win.webContents.on("did-finish-load", async () => {
    try {
      const info = await win.webContents.executeJavaScript(
        "({ drag: Boolean(document.querySelector('.window-drag')), api: typeof window.piFlow })",
      );
      bootLog(`ui chrome=${JSON.stringify(info)}`);
    } catch (error) {
      bootLog(`ui chrome check failed: ${error.message}`);
    }
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
