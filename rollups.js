
function toNumberAmount(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s
    .replace(/[£$€]/g, "")
    .replace(/\s+/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  const n = Number(cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function approxZero(n, eps = 0.01) {
  return Math.abs(n) <= eps;
}

function safeUpper(v) {
  return (v ?? "").toString().trim().toUpperCase();
}

function computeRollups({ invoices, jobs, contracts }) {
  const invoicesByJob = new Map();
  const invoicesByContract = new Map();
  const jobsByContract = new Map();

  for (const inv of invoices) {
    const jobId = inv.JobID || "";
    const contractId = inv.ContractID || "";

    const amt = toNumberAmount(inv.Amount);
    const ccy = safeUpper(inv.Currency);

    if (jobId) {
      if (!invoicesByJob.has(jobId)) invoicesByJob.set(jobId, []);
      invoicesByJob.get(jobId).push({ amt, ccy, inv });
    }
    if (contractId) {
      if (!invoicesByContract.has(contractId)) invoicesByContract.set(contractId, []);
      invoicesByContract.get(contractId).push({ amt, ccy, inv });
    }
  }

  for (const job of jobs) {
    const contractId = job.ContractID || "";
    if (contractId) {
      if (!jobsByContract.has(contractId)) jobsByContract.set(contractId, []);
      jobsByContract.get(contractId).push(job);
    }
  }

  const jobsRollupById = {};
  for (const job of jobs) {
    const jobId = job.JobID;
    if (!jobId) continue;

    const expected = toNumberAmount(job.AmountExpected);
    const related = invoicesByJob.get(jobId) || [];

    let invoicedTotal = 0;
    let invoiceCount = 0;
    const currencies = new Set();

    for (const r of related) {
      if (r.amt != null) invoicedTotal += r.amt;
      invoiceCount += 1;
      if (r.ccy) currencies.add(r.ccy);
    }

    const remaining = expected == null ? null : expected - invoicedTotal;

    let status = "Not invoiced";
    if (invoiceCount === 0) status = "Not invoiced";
    else if (expected == null) status = "Invoiced (no expected)";
    else if (approxZero(remaining)) status = "Fully invoiced";
    else if (remaining > 0.01) status = "Part invoiced";
    else if (remaining < -0.01) status = "Over invoiced";

    jobsRollupById[jobId] = {
      invoiceCount,
      invoicedTotal,
      expected,
      remaining,
      currencies,
      status,
    };
  }

  const contractsRollupById = {};
  for (const con of contracts) {
    const contractId = con.ContractID;
    if (!contractId) continue;

    const price = toNumberAmount(con.Price);
    const relatedInvoices = invoicesByContract.get(contractId) || [];
    const relatedJobs = jobsByContract.get(contractId) || [];

    let invoicedTotal = 0;
    let invoiceCount = 0;
    const currencies = new Set();

    for (const r of relatedInvoices) {
      if (r.amt != null) invoicedTotal += r.amt;
      invoiceCount += 1;
      if (r.ccy) currencies.add(r.ccy);
    }

    let committedTotal = 0;
    let jobCount = 0;
    for (const j of relatedJobs) {
      const exp = toNumberAmount(j.AmountExpected);
      if (exp != null) committedTotal += exp;
      jobCount += 1;
      const ccy = safeUpper(j.Currency);
      if (ccy) currencies.add(ccy);
    }

    const remaining = price == null ? null : price - invoicedTotal;

    contractsRollupById[contractId] = {
      invoiceCount,
      invoicedTotal,
      jobCount,
      committedTotal,
      price,
      remaining,
      currencies,
    };
  }

  return { jobsRollupById, contractsRollupById };
}

module.exports = { computeRollups, toNumberAmount };
