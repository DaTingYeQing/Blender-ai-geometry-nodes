const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  onLog: (callback) => ipcRenderer.on("setup:log", (_event, line) => callback(String(line))),
  onStep: (callback) => ipcRenderer.on("setup:step", (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on("setup:error", (_event, message) => callback(String(message))),
  minimize: () => ipcRenderer.send("setup:minimize"),
  close: () => ipcRenderer.send("setup:close"),
  setLocale: (locale) => ipcRenderer.send("setup:set-locale", String(locale)),
});
