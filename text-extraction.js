
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { simpleParser } = require("mailparser");
const { MsgReader } = require("@kenjiuno/msgreader");
const { ocrMultiPass } = require("./ocr-engine");
const { tryLoadFromCache, writeToCache } = require("./text-cache");
const { findAmountCandidates, findDateCandidates } = require("./heuristics");

function isImageExt(ext) {
  return ["png","jpg","jpeg","tif","tiff","bmp"].includes(ext.toLowerCase());
}

async function extractRawText(filePath) {
  const ext = (path.extname(filePath) || "").toLowerCase().replace(".", "");
  const buf = fs.readFileSync(filePath);

  try {
    if (ext === "pdf") {
      const data = await pdfParse(buf);
      return data.text || "";
    }
    if (isImageExt(ext)) {
      const { merged } = await ocrMultiPass(buf);
      return merged;
    }
    if (ext === "docx") {
      const res = await mammoth.extractRawText({ buffer: buf });
      return res.value || "";
    }
    if (["xlsx","xls","xlsm","xlsb"].includes(ext)) {
      const wb = XLSX.read(buf, { type: "buffer" });
      let out = "";
      for (const sheetName of wb.SheetNames.slice(0, 3)) {
        const ws = wb.Sheets[sheetName];
        const sheetText = XLSX.utils.sheet_to_csv(ws);
        out += sheetText + "\n";
      }
      return out;
    }
    if (ext === "eml") {
      const mail = await simpleParser(buf);
      return [
        mail.subject || "",
        mail.from?.text || "",
        mail.to?.text || "",
        mail.text || "",
      ].join("\n");
    }
    if (ext === "msg") {
      const r = new MsgReader(buf);
      const msg = r.getFileData();
      return [
        msg.subject || "",
        msg.senderName || "",
        msg.senderEmail || "",
        msg.body || "",
      ].join("\n");
    }
  } catch (e) {
    console.error("extractRawText error for", filePath, e);
  }

  try {
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

async function getTextAndCandidates(root, docType, docId, filePath) {
  const cacheRoot = path.join(root, ".fidget-cache");

  const cached = tryLoadFromCache(cacheRoot, docId, filePath);
  if (cached) {
    return { text: cached.text, candidates: cached.candidates || {} };
  }

  const text = await extractRawText(filePath);
  const candidates = {
    totals: findAmountCandidates(text),
    dates: findDateCandidates(text),
  };

  writeToCache(cacheRoot, docId, filePath, text, candidates);

  return { text, candidates };
}

module.exports = {
  getTextAndCandidates,
};
