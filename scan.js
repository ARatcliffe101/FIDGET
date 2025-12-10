
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const { getTextAndCandidates } = require("./text-extraction");
const { computeRollups } = require("./rollups");
const { validateInvoices } = require("./validation");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) return [];
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
  return records;
}

function writeCsv(filePath, rows, columns) {
  ensureDir(path.dirname(filePath));
  const csv = stringify(rows, { header: true, columns });
  fs.writeFileSync(filePath, csv, "utf8");
}

function resolveJobsFolder(root) {
  const jobsNew = path.join(root, "Jobs");
  const jobsOld = path.join(root, "AS");
  if (fs.existsSync(jobsNew)) return jobsNew;
  if (fs.existsSync(jobsOld)) return jobsOld;
  fs.mkdirSync(jobsNew, { recursive: true });
  return jobsNew;
}

function getCsvPaths(root) {
  const invoicesCsv = path.join(root, "invoices.csv");
  const jobsCsv = fs.existsSync(path.join(root, "jobs.csv"))
    ? path.join(root, "jobs.csv")
    : fs.existsSync(path.join(root, "assignments.csv"))
      ? path.join(root, "assignments.csv")
      : path.join(root, "jobs.csv");
  const contractsCsv = path.join(root, "contracts.csv");
  return { invoicesCsv, jobsCsv, contractsCsv };
}

function ensureSubfolders(root) {
  const invoicesDir = path.join(root, "Invoices");
  const jobsDir = resolveJobsFolder(root);
  const contractsDir = path.join(root, "Contracts");
  [invoicesDir, jobsDir, contractsDir].forEach(ensureDir);
  return { invoicesDir, jobsDir, contractsDir };
}

function makeId(prefix) {
  const rnd = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${rnd}`;
}

function basicGuessFromCandidates(candidates) {
  const out = {};
  if (!candidates) return out;
  if (candidates.totals && candidates.totals.length) {
    out.Amount = candidates.totals[0].raw;
  }
  if (candidates.dates && candidates.dates.length) {
    out.InvoiceDate = candidates.dates[0].raw;
  }
  return out;
}

async function ensureCandidatesForRow(root, areaName, row, file) {
  if (row._candidatesTotals && row._candidatesDates && row.RawText) return;

  const id = row.InvoiceID || row.JobID || row.ContractID;
  try {
    const { text, candidates } = await getTextAndCandidates(root, areaName, id, file);
    row.RawText = text.slice(0, 4000);
    row._candidatesTotals = candidates?.totals || [];
    row._candidatesDates = candidates?.dates || [];
  } catch (e) {
    row.RawText = row.RawText || "";
  }
}

async function processArea(root, areaName, files, csvRows) {
  const rowsByPath = new Map();
  for (const row of csvRows) {
    if (row.FilePath) rowsByPath.set(path.normalize(row.FilePath), row);
  }

  const rows = [];
  for (const file of files) {
    const norm = path.normalize(file);
    const stat = fs.statSync(file);
    let row = rowsByPath.get(norm);
    const isNew = !row;

    if (!row) {
      if (areaName === "invoices") {
        row = {
          InvoiceID: makeId("INV"),
          FileName: path.basename(file),
          FilePath: norm,
          FileLastModified: stat.mtime.toISOString(),
          FileSize: String(stat.size),
          Vendor: "",
          InvoiceNumber: "",
          InvoiceDate: "",
          DueDate: "",
          Amount: "",
          Currency: "GBP",
          ContractID: "",
          JobID: "",
          Status: "New",
          Approved: "No",
          ApprovedBy: "",
          ApprovedDate: "",
          Sent: "No",
          SentDate: "",
          Notes: "",
          CreatedUTC: new Date().toISOString(),
        };
      } else if (areaName === "jobs") {
        row = {
          JobID: makeId("JOB"),
          FileName: path.basename(file),
          FilePath: norm,
          FileLastModified: stat.mtime.toISOString(),
          FileSize: String(stat.size),
          Vendor: "",
          Description: "",
          AmountExpected: "",
          Currency: "GBP",
          ContractID: "",
          InvoiceID: "",
          Status: "New",
          ApprovedBy: "",
          ApprovedDate: "",
          Notes: "",
          CreatedUTC: new Date().toISOString(),
        };
      } else if (areaName === "contracts") {
        row = {
          ContractID: makeId("CON"),
          FileName: path.basename(file),
          FilePath: norm,
          FileLastModified: stat.mtime.toISOString(),
          FileSize: String(stat.size),
          Vendor: "",
          StartDate: "",
          EndDate: "",
          Price: "",
          Currency: "GBP",
          Status: "Active",
          Notes: "",
          CreatedUTC: new Date().toISOString(),
        };
      }
    } else {
      row.FileName = path.basename(file);
      row.FilePath = norm;
      row.FileLastModified = stat.mtime.toISOString();
      row.FileSize = String(stat.size);
    }

    await ensureCandidatesForRow(root, areaName, row, file);

    if (isNew && areaName === "invoices") {
      const guessed = basicGuessFromCandidates({
        totals: row._candidatesTotals,
        dates: row._candidatesDates,
      });
      for (const [k, v] of Object.entries(guessed)) {
        if (row[k] === "") row[k] = v;
      }
    }

    rows.push(row);
  }

  return rows;
}

async function scanRoot(root) {
  ensureSubfolders(root);
  const { invoicesCsv, jobsCsv, contractsCsv } = getCsvPaths(root);
  const invoicesCsvRows = readCsv(invoicesCsv);
  const jobsCsvRows = readCsv(jobsCsv);
  const contractsCsvRows = readCsv(contractsCsv);

  const { invoicesDir, jobsDir, contractsDir } = ensureSubfolders(root);

  const invoiceFiles = listFilesRecursive(invoicesDir);
  const jobFiles = listFilesRecursive(jobsDir);
  const contractFiles = listFilesRecursive(contractsDir);

  const invoices = await processArea(root, "invoices", invoiceFiles, invoicesCsvRows);
  const jobs = await processArea(root, "jobs", jobFiles, jobsCsvRows);
  const contracts = await processArea(root, "contracts", contractFiles, contractsCsvRows);

  const { jobsRollupById, contractsRollupById } = computeRollups({ invoices, jobs, contracts });

  const invoiceIssues = validateInvoices(invoices);
  for (const inv of invoices) {
    const id = inv.InvoiceID;
    inv._validationIssues = invoiceIssues[id] || [];
  }

  for (const job of jobs) {
    const id = job.JobID;
    job._rollup = jobsRollupById[id] || null;
  }
  for (const con of contracts) {
    const id = con.ContractID;
    con._rollup = contractsRollupById[id] || null;
  }

  const invoiceCols = [
    "InvoiceID","FileName","FilePath","FileLastModified","FileSize",
    "Vendor","InvoiceNumber","InvoiceDate","DueDate","Amount","Currency",
    "ContractID","JobID","Status","Approved","ApprovedBy","ApprovedDate",
    "Sent","SentDate","Notes","CreatedUTC"
  ];
  const jobCols = [
    "JobID","FileName","FilePath","FileLastModified","FileSize",
    "Vendor","Description","AmountExpected","Currency",
    "ContractID","InvoiceID","Status","ApprovedBy","ApprovedDate",
    "Notes","CreatedUTC"
  ];
  const contractCols = [
    "ContractID","FileName","FilePath","FileLastModified","FileSize",
    "Vendor","StartDate","EndDate","Price","Currency",
    "Status","Notes","CreatedUTC"
  ];

  writeCsv(invoicesCsv, invoices, invoiceCols);
  writeCsv(jobsCsv, jobs, jobCols);
  writeCsv(contractsCsv, contracts, contractCols);

  return {
    rootPath: root,
    invoices,
    jobs,
    contracts,
  };
}

async function saveTabRows(root, tab, rows) {
  const { invoicesCsv, jobsCsv, contractsCsv } = getCsvPaths(root);
  if (tab === "invoices") {
    const cols = [
      "InvoiceID","FileName","FilePath","FileLastModified","FileSize",
      "Vendor","InvoiceNumber","InvoiceDate","DueDate","Amount","Currency",
      "ContractID","JobID","Status","Approved","ApprovedBy","ApprovedDate",
      "Sent","SentDate","Notes","CreatedUTC"
    ];
    writeCsv(invoicesCsv, rows, cols);
  } else if (tab === "jobs") {
    const cols = [
      "JobID","FileName","FilePath","FileLastModified","FileSize",
      "Vendor","Description","AmountExpected","Currency",
      "ContractID","InvoiceID","Status","ApprovedBy","ApprovedDate",
      "Notes","CreatedUTC"
    ];
    writeCsv(jobsCsv, rows, cols);
  } else if (tab === "contracts") {
    const cols = [
      "ContractID","FileName","FilePath","FileLastModified","FileSize",
      "Vendor","StartDate","EndDate","Price","Currency",
      "Status","Notes","CreatedUTC"
    ];
    writeCsv(contractsCsv, rows, cols);
  }
}

module.exports = {
  scanRoot,
  saveTabRows,
};
