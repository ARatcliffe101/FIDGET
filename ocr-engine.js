
const sharp = require("sharp");
const Tesseract = require("tesseract.js");

async function preprocessImageForOcr(buffer) {
  return await sharp(buffer)
    .resize({ width: 2400, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

function mergeOcrTexts(generalText, digitsText) {
  const gLines = (generalText || "").split(/\r?\n/);
  const dLines = (digitsText || "").split(/\r?\n/);
  const maxLen = Math.max(gLines.length, dLines.length);
  const merged = [];

  for (let i = 0; i < maxLen; i++) {
    const g = gLines[i] || "";
    const d = dLines[i] || "";

    const gNumericRatio = g.replace(/[^0-9.,-]/g, "").length / (g.length || 1);
    const dNumericRatio = d.replace(/[^0-9.,-]/g, "").length / (d.length || 1);

    if (d && dNumericRatio > gNumericRatio + 0.15) {
      merged.push(d);
    } else if (g) {
      merged.push(g);
    } else {
      merged.push(d);
    }
  }

  return merged.join("\n");
}

async function ocrMultiPass(imageBuffer) {
  const pre = await preprocessImageForOcr(imageBuffer);

  const [general, digits] = await Promise.all([
    Tesseract.recognize(pre, "eng", { logger: () => {} }),
    Tesseract.recognize(pre, "eng", {
      logger: () => {},
      tessedit_char_whitelist: "0123456789.,-",
    }),
  ]);

  const generalText = general?.data?.text || "";
  const digitsText = digits?.data?.text || "";
  const merged = mergeOcrTexts(generalText, digitsText);

  return {
    merged,
    generalText,
    digitsText,
  };
}

module.exports = {
  ocrMultiPass,
  preprocessImageForOcr,
  mergeOcrTexts,
};
