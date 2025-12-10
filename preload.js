
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fidget", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  askSetRoot: () => ipcRenderer.invoke("config:askSetRoot"),
  scan: () => ipcRenderer.invoke("scan:run"),
  saveRecords: (tab, rows) => ipcRenderer.invoke("records:save", { tab, rows }),
  openPath: (p) => ipcRenderer.invoke("open:path", p),
  openFolder: (p) => ipcRenderer.invoke("open:folder", p),
  readFileBytes: (p) => ipcRenderer.invoke("readFileBytes", p),
  setupYear: (year) => ipcRenderer.invoke("setup:createYear", year),
  onConfigUpdated: (handler) =>
    ipcRenderer.on("config-updated", (_evt, cfg) => handler(cfg)),
  onShowSetup: (handler) =>
    ipcRenderer.on("show-setup", () => handler()),
});
