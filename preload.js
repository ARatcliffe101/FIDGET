
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickRootFolder: () => ipcRenderer.invoke("pick-root-folder"),
  getRootFolder: () => ipcRenderer.invoke("get-root-folder"),
  rescan: () => ipcRenderer.invoke("rescan"),
  getData: (args) => ipcRenderer.invoke("get-data", args),
  updateRow: (tab, id, patch) => ipcRenderer.invoke("update-row", { tab, id, patch }),
  getPreview: (tab, id) => ipcRenderer.invoke("get-preview", { tab, id }),
  getFieldCandidates: (tab, id) => ipcRenderer.invoke("get-field-candidates", { tab, id }),
  openDocument: (filePath) => ipcRenderer.invoke("open-document", filePath),
  getYearOptions: () => ipcRenderer.invoke("get-year-options"),
  setupYearStructure: (year) => ipcRenderer.invoke("setup-year-structure", year)
});
