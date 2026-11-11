const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piFlow", {
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  openAgentWorkspace: (agentId) => ipcRenderer.invoke("open-agent-workspace", agentId),
  getSoloWorkspace: () => ipcRenderer.invoke("get-solo-workspace"),
  openSoloWorkspace: () => ipcRenderer.invoke("open-solo-workspace"),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
});
