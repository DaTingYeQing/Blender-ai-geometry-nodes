const { contextBridge, ipcRenderer } = require("electron");

// 主进程通过 additionalArguments 传进来：打包版是 --pi-flow-prod，开发版是 --pi-flow-dev。
// 界面用它决定总线要不要在"意图没登记"时直接抛错。
const devMode = !process.argv.includes("--pi-flow-prod");

contextBridge.exposeInMainWorld("piFlow", {
  dev: devMode,
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  openAgentWorkspace: (agentId) => ipcRenderer.invoke("open-agent-workspace", agentId),
  getSoloWorkspace: () => ipcRenderer.invoke("get-solo-workspace"),
  openSoloWorkspace: () => ipcRenderer.invoke("open-solo-workspace"),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  /* 手动保存：dirty 状态同步给主进程；关窗前由它把情况发回来，界面自己弹框。 */
  setDirty: (dirty) => ipcRenderer.send("window:dirty", Boolean(dirty)),
  onCloseRequest: (handler) => ipcRenderer.on("app:close-request", (_event, info) => handler(info)),
  respondClose: (action) => ipcRenderer.send("window:close-response", action),
});
