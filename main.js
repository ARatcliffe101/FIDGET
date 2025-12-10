
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const { scanRoot, saveTabRows } = require("./scan");

let mainWindow = null;
let config = null;
const CONFIG_FILE = "fidget-config.json";

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function loadConfig() {
  if (config) return config;
  const cfgPath = getConfigPath();
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    config = JSON.parse(raw);
  } catch {
    config = { rootPath: "" };
  }
  return config;
}

function saveConfig() {
  const cfgPath = getConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf8");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function createYearFolders(rootPath, year) {
  if (!rootPath) {
    throw new Error("Root folder is not set.");
  }
  const y = parseInt(year, 10);
  if (!y || y < 2000 || y > 2100) {
    throw new Error("Year must be between 2000 and 2100.");
  }

  const areas = ["Invoices", "Jobs", "Contracts"];
  const months = [
    "01-Jan",
    "02-Feb",
    "03-Mar",
    "04-Apr",
    "05-May",
    "06-Jun",
    "07-Jul",
    "08-Aug",
    "09-Sep",
    "10-Oct",
    "11-Nov",
    "12-Dec",
  ];

  for (const area of areas) {
    const yearRoot = path.join(rootPath, area, String(y));
    ensureDir(yearRoot);
    for (const m of months) {
      ensureDir(path.join(yearRoot, m));
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Set root folder…",
          click: async () => {
            if (!mainWindow) return;
            const cfg = loadConfig();
            const res = await dialog.showOpenDialog(mainWindow, {
              properties: ["openDirectory"],
            });
            if (!res.canceled && res.filePaths[0]) {
              cfg.rootPath = res.filePaths[0];
              saveConfig();
              mainWindow.webContents.send("config-updated", cfg);
            }
          },
        },
        {
          label: "Folder & year setup…",
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.send("show-setup");
          },
        },
        { type: "separator" },
        {
          role: "quit",
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About / ASR 2025",
          click: async () => {
            await dialog.showMessageBox({
              type: "info",
              title: "FIDGET",
              message: "ASR copyright 2025\nVersion 1.00",
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function ensureInitialRoot() {
  const cfg = loadConfig();
  if (cfg.rootPath) return cfg;

  const docsDefault = app.getPath("documents");
  const res = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Use Documents", "Choose folder…", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Set FIDGET root",
    message: "No root folder is configured yet.",
    detail:
      "FIDGET needs a root folder to manage Invoices, Jobs and Contracts.\n\n" +
      "You can use your Documents folder as the root, or choose a different location.",
  });

  if (res.response === 0) {
    cfg.rootPath = docsDefault;
    saveConfig();
    if (mainWindow) mainWindow.webContents.send("config-updated", cfg);
    return cfg;
  }

  if (res.response === 1) {
    const dirRes = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (!dirRes.canceled && dirRes.filePaths[0]) {
      cfg.rootPath = dirRes.filePaths[0];
      saveConfig();
      if (mainWindow) mainWindow.webContents.send("config-updated", cfg);
    }
  }

  return cfg;
}

app.whenReady().then(async () => {
  loadConfig();
  createWindow();

  await ensureInitialRoot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC

ipcMain.handle("config:get", () => {
  return loadConfig();
});

ipcMain.handle("config:askSetRoot", async () => {
  const cfg = loadConfig();
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (!res.canceled && res.filePaths[0]) {
    cfg.rootPath = res.filePaths[0];
    saveConfig();
    if (mainWindow) mainWindow.webContents.send("config-updated", cfg);
  }
  return cfg;
});

ipcMain.handle("scan:run", async () => {
  const cfg = loadConfig();
  if (!cfg.rootPath) {
    throw new Error("Root folder is not set.");
  }
  return await scanRoot(cfg.rootPath);
});

ipcMain.handle("records:save", async (_evt, { tab, rows }) => {
  const cfg = loadConfig();
  if (!cfg.rootPath) {
    throw new Error("Root folder is not set.");
  }
  await saveTabRows(cfg.rootPath, tab, rows);
  return await scanRoot(cfg.rootPath);
});

ipcMain.handle("open:path", async (_evt, filePath) => {
  if (!filePath) return;
  await shell.openPath(filePath);
});

ipcMain.handle("open:folder", async (_evt, filePath) => {
  if (!filePath) return;
  let target = filePath;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isDirectory()) {
      target = path.dirname(filePath);
    }
  } catch {
    target = path.dirname(filePath);
  }
  await shell.openPath(target);
});

ipcMain.handle("readFileBytes", async (_evt, filePath) => {
  const buf = fs.readFileSync(filePath);
  return buf;
});

ipcMain.handle("setup:createYear", async (_evt, year) => {
  const cfg = loadConfig();
  if (!cfg.rootPath) {
    throw new Error("Root folder is not set.");
  }
  createYearFolders(cfg.rootPath, year);
  return { ok: true, year: parseInt(year, 10) };
});
