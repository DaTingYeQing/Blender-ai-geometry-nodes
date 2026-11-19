// 预览运行环境安装界面（模拟进度，不执行真实安装）。
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLocale } from "../../shared/messages.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 700,
    height: 620,
    frame: false,
    maximizable: false,
    resizable: false,
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

  const steps = [
    "检查网络",
    "准备 pi",
    "准备 Git Bash",
    "部署 Blender",
    "部署 CovTrace 工具链",
    "准备 fd / rg",
    "写入配置",
  ];
  send("setup:step", { type: "plan", titles: steps });

  for (let i = 1; i <= steps.length; i += 1) {
    send("setup:step", { type: "state", index: i, total: steps.length, title: steps[i - 1], status: "running" });
    await wait(1100);
    if (win.isDestroyed()) return;
    send("setup:step", { type: "state", index: i, total: steps.length, title: steps[i - 1], status: "done" });
  }
});

app.on("window-all-closed", () => app.quit());
