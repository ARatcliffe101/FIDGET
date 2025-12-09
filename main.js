
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const chokidar = require("chokidar");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const { simpleParser } = require("mailparser");
const MsgReader = (require("@kenjiuno/msgreader").default || require("@kenjiuno/msgreader"));
const mammoth = require("mammoth");
const XLSX = require("xlsx");

const CONFIG_NAME = "fidget-config.json";

function getConfigPath() {
  try {
    const userData = app.getPath("userData");
    return path.join(userData, CONFIG_NAME);
  } catch {
    return path.join(os.homedir(), CONFIG_NAME);
  }
}

function loadConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch (e) {
    console.error("loadConfig error", e);
  }
  return {};
}

function saveConfig(cfg) {
  try {
    const p = getConfigPath();
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), "utf-8");
  } catch (e) {
    console.error("saveConfig error", e);
  }
}

let config = {};
let rootPath = null;
let mainWindow = null;
let watcher = null;

const CSV_FILES = {
  invoices: "invoices.csv",
  assignments: "assignments.csv",
  contracts: "contracts.csv"
};

const SCHEMA = {
  invoices: [
    "InvoiceID","FileName","FilePath","FileLastModified","FileSize",
    "Vendor","InvoiceNumber","InvoiceDate","DueDate","Amount","Currency",
    "ContractID","AssignmentID",
    "Status","Approved","ApprovedBy","ApprovedDate","Sent","SentDate",
    "Notes","CreatedUTC"
  ],
  assignments: [
    "AssignmentID","FileName","FilePath","FileLastModified","FileSize",
    "Vendor","Description","AmountExpected","Currency",
    "ContractID","InvoiceID",
    "Status","ApprovedBy","ApprovedDate",
    "Notes","CreatedUTC"
  ],
  contracts: [
    "ContractID","FileName","FilePath","FileLastModified","FileSize",
    "Vendor","StartDate","EndDate","Price","Currency",
    "Status","Notes","CreatedUTC"
  ]
};

function createId(prefix) {
  return prefix + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ---- CSV helpers ----

function csvPath(root, key) {
  return path.join(root, CSV_FILES[key]);
}

function toCSV(headers, objects) {
  const esc = (v) => {
    const s = (v ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const obj of objects) {
    lines.push(headers.map(h => esc(obj[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function ensureCsvs(root) {
  for (const key of Object.keys(CSV_FILES)) {
    const p = csvPath(root, key);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, toCSV(SCHEMA[key], []), "utf-8");
    }
  }
}

function loadTable(root, key) {
  ensureCsvs(root);
  const p = csvPath(root, key);
  const text = fs.readFileSync(p, "utf-8");
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = r[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

function writeTable(root, key, rows) {
  fs.writeFileSync(csvPath(root, key), toCSV(SCHEMA[key], rows), "utf-8");
}

function loadAll(root) {
  return {
    invoices: loadTable(root, "invoices"),
    assignments: loadTable(root, "assignments"),
    contracts: loadTable(root, "contracts")
  };
}

// ---- folders ----

function getDirs(root) {
  return {
    invoices: path.join(root, "Invoices"),
    assignments: path.join(root, "AS"),
    contracts: path.join(root, "Contracts")
  };
}

function ensureRootFolders(root) {
  const d = getDirs(root);
  for (const p of [d.invoices, d.assignments, d.contracts]) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

function monthNames() {
  return [
    "01 - January","02 - February","03 - March","04 - April","05 - May","06 - June",
    "07 - July","08 - August","09 - September","10 - October","11 - November","12 - December"
  ];
}

function ensureYearStructure(root, year) {
  if (!year) return;
  const y = String(year);
  ensureRootFolders(root);
  const d = getDirs(root);
  const months = monthNames();
  for (const base of [d.invoices, d.assignments, d.contracts]) {
    const yearDir = path.join(base, y);
    if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });
    for (const m of months) {
      const md = path.join(yearDir, m);
      if (!fs.existsSync(md)) fs.mkdirSync(md, { recursive: true });
    }
  }
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function isRealFile(p) {
  const base = path.basename(p);
  if (base.startsWith("~$")) return false;
  const ext = path.extname(p).toLowerCase();
  if (ext === ".tmp" || ext === ".part") return false;
  return true;
}

// ---- text extraction / OCR ----

function normalizeText(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const OCR_CACHE = new Map();

async function readImageTextOCR(input, cacheKey) {
  try {
    const key = cacheKey || (typeof input === "string" ? input : null);
    if (key && OCR_CACHE.has(key)) return OCR_CACHE.get(key);
    const res = await Tesseract.recognize(input, "eng", {
      logger: () => {},
      tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz£$€.,-/: "
    });
    const text = normalizeText(res?.data?.text || "");
    if (key) OCR_CACHE.set(key, text);
    return text;
  } catch (e) {
    console.error("OCR error", e);
    return "";
  }
}

async function readPdfEmbeddedText(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const res = await pdfParse(dataBuffer);
    return normalizeText(res?.text || "");
  } catch (e) {
    console.error("pdf-parse error", e);
    return "";
  }
}

async function readEmlText(filePath) {
  try {
    const raw = fs.readFileSync(filePath);
    const parsed = await simpleParser(raw);
    const parts = [
      parsed.subject || "",
      parsed.text || "",
      parsed.html ? String(parsed.html).replace(/<[^>]+>/g, " ") : ""
    ];
    return normalizeText(parts.join("\n"));
  } catch (e) {
    console.error("eml parse error", e);
    return "";
  }
}

async function readMsgText(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const reader = new MsgReader(buf);
    const msg = reader.getFileData();
    const parts = [
      msg?.subject || "",
      msg?.body || "",
      msg?.bodyHTML ? String(msg.bodyHTML).replace(/<[^>]+>/g, " ") : ""
    ];
    return normalizeText(parts.join("\n"));
  } catch (e) {
    console.error("msg parse error", e);
    return "";
  }
}

async function readWordText(filePath) {
  try {
    const res = await mammoth.extractRawText({ path: filePath });
    return normalizeText(res?.value || "");
  } catch (e) {
    console.error("word parse error", e);
    return "";
  }
}

function readExcelText(filePath) {
  try {
    const wb = XLSX.readFile(filePath, { cellText: true, cellDates: true });
    const parts = [];
    for (const name of wb.SheetNames.slice(0, 5)) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      for (const r of rows.slice(0, 300)) {
        parts.push((r || []).join(" "));
      }
    }
    return normalizeText(parts.join("\n"));
  } catch (e) {
    console.error("excel parse error", e);
    return "";
  }
}

function isImageExt(ext) {
  return [".png",".jpg",".jpeg",".tif",".tiff",".bmp"].includes(ext);
}
function isPdfExt(ext) { return ext === ".pdf"; }
function isWordExt(ext) { return ext === ".docx"; }
function isExcelExt(ext) {
  return [".xlsx",".xls",".xlsm",".xlsb"].includes(ext);
}

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (isPdfExt(ext)) return await readPdfEmbeddedText(filePath);
  if (isImageExt(ext)) return await readImageTextOCR(filePath);
  if (ext === ".eml") return await readEmlText(filePath);
  if (ext === ".msg") return await readMsgText(filePath);
  if (isWordExt(ext)) return await readWordText(filePath);
  if (isExcelExt(ext)) return readExcelText(filePath);
  return "";
}

// ---- heuristics ----

function cleanVendorGuess(stem) {
  if (!stem) return "";
  const noise = new Set(["invoice","inv","bill","eemua","assignment","as","job","contract","po","purchase","order","quote","quotation","scan","scanned"]);
  const parts = stem.split(/[\s._-]+/).filter(Boolean);
  const kept = parts.filter(p => !noise.has(p.toLowerCase()));
  return kept.slice(0, 3).join(" ").trim();
}

function guessVendorFromText(text) {
  if (!text) return "";
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const raw of lines.slice(0, 40)) {
    const m = raw.match(/\b(From|Supplier|Vendor|Consultant|Name)\s*:\s*(.+)$/i);
    if (m && m[2]) {
      const cand = m[2].trim();
      if (cand && !/EEMUA/i.test(cand)) return cand.slice(0, 80);
    }
  }

  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const l = lines[i];
    if (/\b(invoice|facture)\b/i.test(l)) {
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j];
        if (!prev) continue;
        if (/EEMUA/i.test(prev)) continue;
        if (/invoice|facture|page\s+\d+|total|amount due|vat/i.test(prev)) continue;
        if (/^\d/.test(prev)) continue;
        return prev.slice(0, 80);
      }
      break;
    }
  }

  for (const l of lines.slice(0, 20)) {
    if (!l) continue;
    if (/EEMUA/i.test(l)) continue;
    if (/invoice|facture|page\s+\d+|total|amount due|vat/i.test(l)) continue;
    if (/^\d/.test(l)) continue;
    if (l.length < 3) continue;
    return l.slice(0, 80);
  }

  return "";
}

function findInvoiceNumber(str) {
  if (!str) return "";
  let m = str.match(/\binvoice\s*(?:no\.?|number|#)\s*[:\s]*([A-Z0-9-]{2,})\b/i);
  if (m) return m[1];
  m = str.match(/\bInvoice\s+([A-Z0-9-]{3,})\b/i);
  if (m) return m[1];
  m = str.match(/\bfacture\s+([0-9]{3,})\b/i);
  if (m) return m[1];
  return "";
}

function toISODate(d, m, y) {
  return `${y}-${m.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;
}

function findDate(str) {
  if (!str) return "";
  let m = str.match(/\b(20\d{2})[-_.\/](0[1-9]|1[0-2])[-_.\/]([0-2]\d|3[01])\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/\b([0-2]\d|3[01])[-_.\/](0[1-9]|1[0-2])[-_.\/](20\d{2})\b/);
  if (m) return toISODate(m[1], m[2], m[3]);
  return "";
}

function extractAllDates(str) {
  const out = [];
  if (!str) return out;
  const seen = new Set();
  const isoRe = /\b(20\d{2})[-_.\/](0[1-9]|1[0-2])[-_.\/](0[1-9]|[12]\d|3[01])\b/g;
  const dmyRe = /\b(0[1-9]|[12]\d|3[01])[-_.\/](0[1-9]|1[0-2])[-_.\/](20\d{2})\b/g;
  let m;
  while ((m = isoRe.exec(str)) !== null) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  }
  while ((m = dmyRe.exec(str)) !== null) {
    const iso = toISODate(m[1], m[2], m[3]);
    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  }
  out.sort();
  return out;
}

function findDueDate(str) {
  if (!str) return "";
  let m = str.match(/\bdue\s+date\s*[:\s]*([0-2]\d|3[01])[-_.\/](0[1-9]|1[0-2])[-_.\/](20\d{2})\b/i);
  if (m) return toISODate(m[1], m[2], m[3]);
  m = str.match(/\b(?:payment\s+due|due\s+on|payable\s+by)\b[^0-9]{0,15}([0-2]\d|3[01])[-_.\/](0[1-9]|1[0-2])[-_.\/](20\d{2})\b/i);
  if (m) return toISODate(m[1], m[2], m[3]);
  return "";
}

function extractMoneyCandidates(str) {
  const results = [];
  if (!str) return results;
  const lines = str.split(/\r?\n/);
  const moneyRe = /([£$€]?\s*[0-9][0-9.,]*[.,][0-9]{2})/g;

  function parseAmount(raw) {
    if (!raw) return null;
    let s = raw.replace(/[^0-9.,]/g, "");
    if (!s) return null;
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let decPos = Math.max(lastDot, lastComma);
    if (decPos === -1) return null;
    let intPart = s.slice(0, decPos).replace(/[.,]/g, "");
    let fracPart = s.slice(decPos + 1);
    if (!/^[0-9]+$/.test(intPart) || !/^[0-9]{2}$/.test(fracPart)) return null;
    const normalized = intPart + "." + fracPart;
    const value = parseFloat(normalized);
    if (!isFinite(value)) return null;
    return { normalized, value };
  }

  const rawCandidates = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    let weight = 1;
    if (/amount\s+due|balance\s+due|total\s+due|grand\s+total|invoice\s+total/.test(lower)) weight = 4;
    else if (/total/.test(lower)) weight = 2;
    else if (/subtotal|net/.test(lower)) weight = 1.5;

    let m;
    while ((m = moneyRe.exec(line)) !== null) {
      const parsed = parseAmount(m[1]);
      if (!parsed) continue;
      const score = parsed.value * weight;
      rawCandidates.push({
        normalized: parsed.normalized,
        value: parsed.value,
        score,
        context: line.trim().slice(0, 120)
      });
    }
  }

  const bestByNorm = new Map();
  for (const c of rawCandidates) {
    const prev = bestByNorm.get(c.normalized);
    if (!prev || c.score > prev.score) bestByNorm.set(c.normalized, c);
  }
  const unique = Array.from(bestByNorm.values());
  unique.sort((a, b) => b.score - a.score);
  return unique;
}

function findMoney(str) {
  const cands = extractMoneyCandidates(str);
  return cands.length ? cands[0].normalized : "";
}

function findCurrency(str) {
  if (!str) return "";
  if (str.includes("£") || /\bGBP\b/i.test(str)) return "GBP";
  if (str.includes("€") || /\bEUR\b/i.test(str)) return "EUR";
  if (str.includes("$") || /\bUSD\b/i.test(str)) return "USD";
  return "";
}

// ---- upsert helpers ----

function findByFileKey(rows, filePath, fileLastModified) {
  return rows.find(r => r.FilePath === filePath && r.FileLastModified === fileLastModified);
}

async function upsertInvoiceFile(root, filePath, stat) {
  const rows = loadTable(root, "invoices");
  const fileLastModified = new Date(stat.mtimeMs).toISOString();
  const existing = findByFileKey(rows, filePath, fileLastModified);
  if (existing) return existing.InvoiceID;

  const rec = Object.fromEntries(SCHEMA.invoices.map(h => [h, ""]));
  rec.InvoiceID = createId("INV");
  rec.FileName = path.basename(filePath);
  rec.FilePath = filePath;
  rec.FileLastModified = fileLastModified;
  rec.FileSize = String(stat.size);
  rec.Status = "New";
  rec.Approved = "No";
  rec.Sent = "No";
  rec.CreatedUTC = new Date().toISOString();

  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const stem = name.slice(0, name.length - ext.length);
  const text = await extractTextFromFile(filePath);
  const combined = `${stem}\n${text}`;

  rec.Vendor = guessVendorFromText(text) || cleanVendorGuess(stem);
  rec.InvoiceNumber = findInvoiceNumber(combined);
  rec.InvoiceDate = findDate(combined);
  rec.DueDate = findDueDate(combined);
  rec.Amount = findMoney(combined);
  rec.Currency = findCurrency(combined) || "GBP";

  if (rec.InvoiceDate && rec.DueDate && rec.InvoiceDate > rec.DueDate) {
    const tmp = rec.InvoiceDate;
    rec.InvoiceDate = rec.DueDate;
    rec.DueDate = tmp;
  }

  rows.unshift(rec);
  writeTable(root, "invoices", rows);
  return rec.InvoiceID;
}

async function upsertAssignmentFile(root, filePath, stat) {
  const rows = loadTable(root, "assignments");
  const fileLastModified = new Date(stat.mtimeMs).toISOString();
  const existing = findByFileKey(rows, filePath, fileLastModified);
  if (existing) return existing.AssignmentID;

  const rec = Object.fromEntries(SCHEMA.assignments.map(h => [h, ""]));
  rec.AssignmentID = createId("JOB");
  rec.FileName = path.basename(filePath);
  rec.FilePath = filePath;
  rec.FileLastModified = fileLastModified;
  rec.FileSize = String(stat.size);
  rec.Currency = "GBP";
  rec.Status = "New";
  rec.CreatedUTC = new Date().toISOString();

  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const stem = name.slice(0, name.length - ext.length);
  const text = await extractTextFromFile(filePath);
  const combined = `${stem}\n${text}`;

  rec.Vendor = guessVendorFromText(text) || cleanVendorGuess(stem);
  rec.AmountExpected = findMoney(combined);
  const cur = findCurrency(combined);
  if (cur) rec.Currency = cur;

  rows.unshift(rec);
  writeTable(root, "assignments", rows);
  return rec.AssignmentID;
}

async function upsertContractFile(root, filePath, stat) {
  const rows = loadTable(root, "contracts");
  const fileLastModified = new Date(stat.mtimeMs).toISOString();
  const existing = findByFileKey(rows, filePath, fileLastModified);
  if (existing) return existing.ContractID;

  const rec = Object.fromEntries(SCHEMA.contracts.map(h => [h, ""]));
  rec.ContractID = createId("CON");
  rec.FileName = path.basename(filePath);
  rec.FilePath = filePath;
  rec.FileLastModified = fileLastModified;
  rec.FileSize = String(stat.size);
  rec.Currency = "GBP";
  rec.Status = "Active";
  rec.CreatedUTC = new Date().toISOString();

  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const stem = name.slice(0, name.length - ext.length);
  const text = await extractTextFromFile(filePath);
  const combined = `${stem}\n${text}`;

  rec.Vendor = guessVendorFromText(text) || cleanVendorGuess(stem);
  rec.Price = findMoney(combined);
  const cur = findCurrency(combined);
  if (cur) rec.Currency = cur;
  rec.StartDate = findDate(combined);

  rows.unshift(rec);
  writeTable(root, "contracts", rows);
  return rec.ContractID;
}

// ---- updates ----

function updateInvoice(root, invoiceId, patch) {
  const rows = loadTable(root, "invoices");
  const idx = rows.findIndex(r => r.InvoiceID === invoiceId);
  if (idx < 0) return;
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SCHEMA.invoices.includes(k) || k === "InvoiceID") continue;
    rows[idx][k] = (v ?? "").toString();
  }
  const today = new Date().toISOString().slice(0,10);
  if (rows[idx].Approved === "Yes" && !rows[idx].ApprovedDate) rows[idx].ApprovedDate = today;
  if (rows[idx].Sent === "Yes" && !rows[idx].SentDate) rows[idx].SentDate = today;

  writeTable(root, "invoices", rows);

  if (patch && Object.prototype.hasOwnProperty.call(patch, "AssignmentID")) {
    const as = loadTable(root, "assignments");
    for (const a of as) {
      if (a.AssignmentID === patch.AssignmentID) {
        a.InvoiceID = invoiceId;
      } else if (a.InvoiceID === invoiceId && a.AssignmentID !== patch.AssignmentID) {
        a.InvoiceID = "";
      }
    }
    writeTable(root, "assignments", as);
  }
}

function updateAssignment(root, assignmentId, patch) {
  const rows = loadTable(root, "assignments");
  const idx = rows.findIndex(r => r.AssignmentID === assignmentId);
  if (idx < 0) return;
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SCHEMA.assignments.includes(k) || k === "AssignmentID") continue;
    rows[idx][k] = (v ?? "").toString();
  }
  const today = new Date().toISOString().slice(0,10);
  if (!rows[idx].ApprovedDate && rows[idx].ApprovedBy) rows[idx].ApprovedDate = today;
  writeTable(root, "assignments", rows);

  if (patch && Object.prototype.hasOwnProperty.call(patch, "InvoiceID")) {
    const inv = loadTable(root, "invoices");
    for (const i of inv) {
      if (i.InvoiceID === patch.InvoiceID) {
        i.AssignmentID = assignmentId;
      } else if (i.AssignmentID === assignmentId && i.InvoiceID !== patch.InvoiceID) {
        i.AssignmentID = "";
      }
    }
    writeTable(root, "invoices", inv);
  }
}

function updateContract(root, contractId, patch) {
  const rows = loadTable(root, "contracts");
  const idx = rows.findIndex(r => r.ContractID === contractId);
  if (idx < 0) return;
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SCHEMA.contracts.includes(k) || k === "ContractID") continue;
    rows[idx][k] = (v ?? "").toString();
  }
  writeTable(root, "contracts", rows);
}

// ---- scanning / watcher ----

async function scanFolder(root, dir, handler) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanFolder(root, full, handler);
    } else {
      const st = statSafe(full);
      if (!st || !st.isFile() || !isRealFile(full)) continue;
      await handler(root, full, st);
    }
  }
}

async function scanAll(root) {
  ensureCsvs(root);
  const d = getDirs(root);
  await scanFolder(root, d.invoices, upsertInvoiceFile);
  await scanFolder(root, d.assignments, upsertAssignmentFile);
  await scanFolder(root, d.contracts, upsertContractFile);
}

function startWatching(root) {
  stopWatching();
  ensureRootFolders(root);
  const d = getDirs(root);
  watcher = chokidar.watch([d.invoices, d.assignments, d.contracts], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 }
  });
  watcher.on("add", async (filePath) => {
    try {
      if (!isRealFile(filePath)) return;
      const st = statSafe(filePath);
      if (!st || !st.isFile()) return;
      if (filePath.startsWith(d.invoices)) await upsertInvoiceFile(root, filePath, st);
      else if (filePath.startsWith(d.assignments)) await upsertAssignmentFile(root, filePath, st);
      else if (filePath.startsWith(d.contracts)) await upsertContractFile(root, filePath, st);
    } catch (e) {
      console.error("watch add error", e);
    }
  });
}

function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

// ---- window ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#fafafa",
    icon: path.join(__dirname, "ui", "assets", "FIDGET.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
}

app.whenReady().then(async () => {
  config = loadConfig();
  if (config.rootPath && fs.existsSync(config.rootPath)) {
    rootPath = config.rootPath;
    try {
      ensureCsvs(rootPath);
      ensureRootFolders(rootPath);
      await scanAll(rootPath);
      startWatching(rootPath);
    } catch (e) {
      console.error("initial scan error", e);
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopWatching();
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC ----

ipcMain.handle("pick-root-folder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  rootPath = res.filePaths[0];
  config.rootPath = rootPath;
  saveConfig(config);
  ensureCsvs(rootPath);
  ensureRootFolders(rootPath);
  await scanAll(rootPath);
  startWatching(rootPath);
  return rootPath;
});

ipcMain.handle("get-root-folder", async () => {
  return rootPath;
});

ipcMain.handle("rescan", async () => {
  if (!rootPath) throw new Error("Root folder not set.");
  ensureCsvs(rootPath);
  await scanAll(rootPath);
  return true;
});

ipcMain.handle("get-data", async (_evt, args) => {
  if (!rootPath) {
    return { invoices: [], assignments: [], contracts: [] };
  }
  const all = loadAll(rootPath);
  const reqTab = (args?.tab || "invoices").toLowerCase();
  const status = (args?.status || "").trim();
  const q = (args?.q || "").trim().toLowerCase();

  function filt(rows, statusField) {
    return rows.filter(r => {
      if (status && (r[statusField] || "") !== status) return false;
      if (!q) return true;
      const hay = Object.values(r).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  if (reqTab === "all") return all;
  return {
    invoices: reqTab === "invoices" ? filt(all.invoices, "Status") : all.invoices,
    assignments: reqTab === "assignments" ? filt(all.assignments, "Status") : all.assignments,
    contracts: reqTab === "contracts" ? filt(all.contracts, "Status") : all.contracts
  };
});

ipcMain.handle("update-row", async (_evt, { tab, id, patch }) => {
  if (!rootPath) throw new Error("Root folder not set.");
  const t = (tab || "").toLowerCase();
  if (t === "invoices") updateInvoice(rootPath, id, patch);
  else if (t === "assignments") updateAssignment(rootPath, id, patch);
  else if (t === "contracts") updateContract(rootPath, id, patch);
  else throw new Error("Unknown tab: " + tab);
  return true;
});

ipcMain.handle("get-preview", async (_evt, args) => {
  if (!rootPath) return { kind: "none" };
  const { tab, id } = args || {};
  const t = (tab || "").toLowerCase();
  const all = loadAll(rootPath);
  let rec = null;
  if (t === "invoices") rec = all.invoices.find(r => r.InvoiceID === id);
  else if (t === "assignments") rec = all.assignments.find(r => r.AssignmentID === id);
  else if (t === "contracts") rec = all.contracts.find(r => r.ContractID === id);
  if (!rec || !rec.FilePath || !fs.existsSync(rec.FilePath)) return { kind: "none" };

  const ext = path.extname(rec.FilePath).toLowerCase();
  if (ext === ".pdf" || isImageExt(ext)) {
    return { kind: "file", path: rec.FilePath };
  }
  try {
    const text = await extractTextFromFile(rec.FilePath);
    const snippet = text.split(/\r?\n/).slice(0, 40).join("\n");
    return { kind: "text", snippet, path: rec.FilePath };
  } catch {
    return { kind: "file", path: rec.FilePath };
  }
});

ipcMain.handle("get-field-candidates", async (_evt, args) => {
  if (!rootPath) return { amounts: [], dates: [] };
  const { tab, id } = args || {};
  const t = (tab || "").toLowerCase();
  const all = loadAll(rootPath);
  let rec = null;
  if (t === "invoices") rec = all.invoices.find(r => r.InvoiceID === id);
  else if (t === "assignments") rec = all.assignments.find(r => r.AssignmentID === id);
  else if (t === "contracts") rec = all.contracts.find(r => r.ContractID === id);
  if (!rec || !rec.FilePath || !fs.existsSync(rec.FilePath)) return { amounts: [], dates: [] };

  try {
    const text = await extractTextFromFile(rec.FilePath);
    const amounts = extractMoneyCandidates(text).map(c => c.normalized);
    const dates = extractAllDates(text);
    return { amounts, dates };
  } catch (e) {
    console.error("get-field-candidates error", e);
    return { amounts: [], dates: [] };
  }
});

ipcMain.handle("open-document", async (_evt, filePath) => {
  if (!filePath) return false;
  try {
    await shell.openPath(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("get-year-options", async () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = new Set();
  if (rootPath) {
    const d = getDirs(rootPath);
    for (const base of [d.invoices, d.assignments, d.contracts]) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (/^\d{4}$/.test(entry.name)) years.add(parseInt(entry.name, 10));
      }
    }
  }
  return { currentYear, years: Array.from(years).sort((a,b)=>a-b) };
});

ipcMain.handle("setup-year-structure", async (_evt, year) => {
  if (!rootPath) throw new Error("Root folder not set.");
  ensureYearStructure(rootPath, year);
  await scanAll(rootPath);
  return true;
});
