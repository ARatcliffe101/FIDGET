
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function makeCacheKey(docId, filePath) {
  if (docId) return docId.replace(/[^A-Za-z0-9_-]/g, "_");
  const h = crypto.createHash("sha1").update(filePath).digest("hex");
  return `fp_${h}`;
}

function tryLoadFromCache(rootCacheDir, docId, filePath) {
  const key = makeCacheKey(docId, filePath);
  const dir = path.join(rootCacheDir, "extracted");
  const txtPath = path.join(dir, `${key}.txt`);
  const candPath = path.join(dir, `${key}.candidates.json`);

  if (
    !fs.existsSync(txtPath) ||
    !fs.existsSync(filePath) ||
    fs.statSync(txtPath).mtimeMs < fs.statSync(filePath).mtimeMs
  ) {
    return null;
  }

  const text = fs.readFileSync(txtPath, "utf8");
  let candidates = null;
  if (fs.existsSync(candPath)) {
    try {
      candidates = JSON.parse(fs.readFileSync(candPath, "utf8"));
    } catch {
      candidates = null;
    }
  }

  return { text, candidates, key };
}

function writeToCache(rootCacheDir, docId, filePath, text, candidates) {
  const key = makeCacheKey(docId, filePath);
  const dir = path.join(rootCacheDir, "extracted");
  ensureDir(dir);

  const txtPath = path.join(dir, `${key}.txt`);
  const candPath = path.join(dir, `${key}.candidates.json`);

  fs.writeFileSync(txtPath, text ?? "", "utf8");
  if (candidates) {
    fs.writeFileSync(candPath, JSON.stringify(candidates, null, 2), "utf8");
  }

  return { key, txtPath, candPath };
}

module.exports = {
  tryLoadFromCache,
  writeToCache,
};
