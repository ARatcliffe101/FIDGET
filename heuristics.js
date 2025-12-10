
function findAmountCandidates(text) {
  const out = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const m = line.match(/([£$€]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/g);
    if (!m) continue;
    for (const raw of m) {
      out.push({
        raw: raw.trim(),
        line: line.trim(),
      });
    }
  }
  return out;
}

function findDateCandidates(text) {
  const out = [];
  const dateRegex =
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let m;
    while ((m = dateRegex.exec(line)) !== null) {
      out.push({
        raw: m[1],
        line: line.trim(),
      });
    }
  }
  return out;
}

module.exports = {
  findAmountCandidates,
  findDateCandidates,
};
