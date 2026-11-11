// 预览运行环境安装界面（模拟进度，不执行真实安装）。
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLocale, t } from "../app/js/core/i18n.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 660,
    height: 540,
    minWidth: 560,
    minHeight: 480,
    frame: false,
    maximizable: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "pi-flow-icon.png"),
    title: "Pi Flow 运行环境（预览）",
    webPreferences: {
      preload: path.join(__dirname, "setup-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ipcMain.on("setup:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("setup:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.on("setup:set-locale", (_event, locale) => setLocale(locale));

  await win.loadFile(path.join(__dirname, "setup.html"));

  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const steps = ["检查网络与磁盘", "解压内置 Blender", "安装 Python 依赖", "校验 CovTrace 工具链", "准备 Agent 工作区"];
  send("setup:log", t("预览模式：不会执行真实安装。"));
  send("setup:log", t("日志文件：{path}", { path: "data/setup.log" }));
  send("setup:step", { type: "plan", titles: steps });

  for (let i = 1; i <= steps.length; i += 1) {
    send("setup:step", { type: "state", index: i, total: steps.length, title: steps[i - 1], status: "running" });
    for (let k = 1; k <= 4; k += 1) {
      await wait(700);
      if (win.isDestroyed()) return;
      send("setup:log", `[${i}/${steps.length}] ${steps[i - 1]} · 处理中 ${k * 25}%`);
    }
    if (win.isDestroyed()) return;
    send("setup:step", { type: "state", index: i, total: steps.length, title: steps[i - 1], status: "done" });
  }
  send("setup:log", t("运行环境就绪（预览）。"));
});

app.on("window-all-closed", () => app.quit());
