
const rootLabel = document.getElementById("root-path-label");
const btnSetRoot = document.getElementById("btn-set-root");
const btnScan = document.getElementById("btn-scan");
const btnSaveAll = document.getElementById("btn-save-all");
const tabs = Array.from(document.querySelectorAll(".tab"));
const lists = {
  invoices: document.getElementById("list-invoices"),
  jobs: document.getElementById("list-jobs"),
  contracts: document.getElementById("list-contracts"),
};
const searchBox = document.getElementById("search-box");

const detailTitle = document.getElementById("detail-title");
const detailFields = document.getElementById("detail-fields");
const detailValidation = document.getElementById("detail-validation");
const detailCandidates = document.getElementById("detail-candidates"); // kept but hidden via CSS
const btnSave = document.getElementById("btn-save");
const btnOpenDoc = document.getElementById("btn-open-doc");
const btnOpenFolder = document.getElementById("btn-open-folder");

const previewFilename = document.getElementById("preview-filename");
const previewLoading = document.getElementById("preview-loading");
const previewCanvas = document.getElementById("preview-canvas");
const previewText = document.getElementById("preview-text");

// Folder & year setup overlay
const setupOverlay = document.getElementById("setup-overlay");
const setupYearInput = document.getElementById("setup-year");
const setupStatus = document.getElementById("setup-status");
const btnSetupCreate = document.getElementById("setup-create");
const btnSetupClose = document.getElementById("setup-close");

let state = {
  rootPath: "",
  activeTab: "invoices",
  data: {
    invoices: [],
    jobs: [],
    contracts: [],
  },
  filtered: {
    invoices: [],
    jobs: [],
    contracts: [],
  },
  selected: {
    invoices: null,
    jobs: null,
    contracts: null,
  },
};

let autosaveTimer = null;

if (window["pdfjsLib"]) {
  window["pdfjsLib"].GlobalWorkerOptions.workerSrc =
    "../node_modules/pdfjs-dist/build/pdf.worker.js";
}

/* ---------------------- Root / config ---------------------- */

function setRootLabel(rootPath) {
  state.rootPath = rootPath || "";
  rootLabel.textContent = rootPath ? `Root: ${rootPath}` : "Root: (not set)";
}

async function initConfig() {
  const cfg = await window.fidget.getConfig();
  setRootLabel(cfg.rootPath || "");
}

/* ---------------------- Autosave --------------------------- */

function scheduleAutosave() {
  if (!state.rootPath) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saveAll(true);
  }, 2000);
}

/* ---------------------- Event wiring ----------------------- */

btnSetRoot.addEventListener("click", async () => {
  const cfg = await window.fidget.askSetRoot();
  setRootLabel(cfg.rootPath || "");
});

btnScan.addEventListener("click", async () => {
  if (!state.rootPath) {
    const cfg = await window.fidget.askSetRoot();
    setRootLabel(cfg.rootPath || "");
    if (!cfg.rootPath) return;
  }
  await runScan();
});

if (btnSaveAll) {
  btnSaveAll.addEventListener("click", () => {
    saveAll(false);
  });
}

window.fidget.onConfigUpdated((cfg) => {
  setRootLabel(cfg.rootPath || "");
});

// Folder & year setup overlay wiring
if (window.fidget.onShowSetup) {
  window.fidget.onShowSetup(() => {
    const currentYear = new Date().getFullYear();
    setupYearInput.value = String(currentYear);
    setupStatus.textContent = "";
    setupOverlay.classList.remove("hidden");
  });
}

if (btnSetupClose) {
  btnSetupClose.addEventListener("click", () => {
    setupOverlay.classList.add("hidden");
  });
}

if (btnSetupCreate) {
  btnSetupCreate.addEventListener("click", async () => {
    const year = parseInt(setupYearInput.value, 10);
    if (!year || year < 2000 || year > 2100) {
      setupStatus.textContent = "Please enter a valid year (2000–2100).";
      return;
    }
    setupStatus.textContent = "Creating folders…";
    try {
      const res = await window.fidget.setupYear(year);
      if (res && res.ok) {
        setupStatus.textContent = `Created folder structure for ${res.year}.`;
      } else {
        setupStatus.textContent =
          (res && res.error) || "Could not create folders.";
      }
    } catch (e) {
      setupStatus.textContent = e?.message || String(e);
    }
  });
}

tabs.forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    const tab = tabBtn.dataset.tab;
    setActiveTab(tab);
  });
});

searchBox.addEventListener("input", () => {
  applyFilter();
});

btnSave.addEventListener("click", onSaveClicked);
btnOpenDoc.addEventListener("click", onOpenDocClicked);
btnOpenFolder.addEventListener("click", onOpenFolderClicked);

/* ---------------------- Filtering / list ------------------- */

function setActiveTab(tab) {
  state.activeTab = tab;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  Object.entries(lists).forEach(([k, el]) => {
    el.classList.toggle("active", k === tab);
  });
  applyFilter();
  renderDetail();
}

function applyFilter() {
  const term = searchBox.value.trim().toLowerCase();
  ["invoices", "jobs", "contracts"].forEach((tab) => {
    const src = state.data[tab] || [];
    let filtered = src;
    if (term) {
      filtered = src.filter((row) => {
        const hay = JSON.stringify(row).toLowerCase();
        return hay.includes(term);
      });
    }
    state.filtered[tab] = filtered;
    renderList(tab);
  });
}

function renderList(tab) {
  const listEl = lists[tab];
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = state.filtered[tab] || [];
  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    rowEl.dataset.id =
      row.InvoiceID || row.JobID || row.ContractID || row.FilePath || "";
    rowEl.dataset.path = row.FilePath || "";

    let title = row.FileName || row.Description || row.Vendor || "(untitled)";
    let subParts = [];
    if (tab === "invoices") {
      if (row.InvoiceNumber) subParts.push(`#${row.InvoiceNumber}`);
      if (row.Amount) subParts.push(`${row.Amount} ${row.Currency || ""}`);
      if (row.Status) subParts.push(row.Status);
      if (row.JobID) subParts.push(`Job: ${row.JobID}`);
      if (row.ContractID) subParts.push(`Contract: ${row.ContractID}`);
      if (row._validationIssues && row._validationIssues.length) {
        subParts.push("⚠ Issues");
      }
    } else if (tab === "jobs") {
      if (row.Description) subParts.push(row.Description);
      if (row.ContractID) subParts.push(`Contract: ${row.ContractID}`);
      if (row.InvoiceID) subParts.push(`Invoices: ${row.InvoiceID}`);
      const roll = row._rollup;
      if (roll) {
        subParts.push(`Invoiced: ${roll.invoicedTotal?.toFixed(2) || "0.00"}`);
        if (roll.remaining != null) {
          subParts.push(`Remaining: ${roll.remaining.toFixed(2)}`);
        }
        if (roll.status) subParts.push(roll.status);
      }
    } else if (tab === "contracts") {
      const roll = row._rollup;
      if (row.Price) subParts.push(`Price: ${row.Price} ${row.Currency || ""}`);
      if (roll) {
        subParts.push(`Invoiced: ${roll.invoicedTotal?.toFixed(2) || "0.00"}`);
        if (roll.committedTotal != null) {
          subParts.push(`Committed: ${roll.committedTotal.toFixed(2)}`);
        }
      }
    }

    rowEl.innerHTML = `
      <div class="row-main">
        <div class="row-title">${title}</div>
        <div class="row-sub">
          ${subParts.map((p) => `<span class="pill">${p}</span>`).join("")}
          ${
            row._validationIssues && row._validationIssues.length
              ? `<span class="pill pill-warning">Issues: ${row._validationIssues.length}</span>`
              : ""
          }
        </div>
      </div>
      <div class="row-right">${row.Vendor || ""}</div>
    `;

    rowEl.addEventListener("click", () => {
      setSelectedRow(tab, row);
      renderDetail();
      loadPreviewForRow(row);
      highlightActiveRow(tab, rowEl);
    });

    listEl.appendChild(rowEl);
  });

  if (!state.selected[tab] && rows.length) {
    state.selected[tab] = rows[0];
    renderDetail();
    loadPreviewForRow(rows[0]);
    const firstRowEl = listEl.querySelector(".row");
    if (firstRowEl) highlightActiveRow(tab, firstRowEl);
  }
}

function highlightActiveRow(tab, rowEl) {
  const listEl = lists[tab];
  if (!listEl) return;
  listEl.querySelectorAll(".row").forEach((el) => {
    el.classList.toggle("active", el === rowEl);
  });
}

function setSelectedRow(tab, row) {
  state.selected[tab] = row;
}

/* --------------------- Linking helpers --------------------- */

function getInvoiceId(row) {
  return row.InvoiceID || row.FileName || "";
}

function getJobId(row) {
  return row.JobID || row.FileName || "";
}

function getContractId(row) {
  return row.ContractID || row.FileName || "";
}

function linkInvoiceToJob(invoiceRow, jobRow) {
  const invId = getInvoiceId(invoiceRow);
  const jobId = getJobId(jobRow);
  if (!jobId) return;

  invoiceRow.JobID = jobId;

  if (invId) {
    const existing = (jobRow.InvoiceID || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!existing.includes(invId)) {
      existing.push(invId);
      jobRow.InvoiceID = existing.join(", ");
    }
  }

  if (jobRow.ContractID && !invoiceRow.ContractID) {
    invoiceRow.ContractID = jobRow.ContractID;
  }
}

function linkInvoiceToContract(invoiceRow, contractRow) {
  const contractId = getContractId(contractRow);
  if (!contractId) return;

  invoiceRow.ContractID = contractId;

  if (invoiceRow.JobID) {
    const job = (state.data.jobs || []).find(
      (j) => getJobId(j) === invoiceRow.JobID
    );
    if (job && !job.ContractID) {
      job.ContractID = contractId;
    }
  }
}

function linkJobToContract(jobRow, contractRow) {
  const contractId = getContractId(contractRow);
  if (!contractId) return;

  jobRow.ContractID = contractId;

  const jobId = getJobId(jobRow);
  if (!jobId) return;

  (state.data.invoices || []).forEach((inv) => {
    if (inv.JobID === jobId && !inv.ContractID) {
      inv.ContractID = contractId;
    }
  });
}

function linkJobToInvoice(jobRow, invoiceRow) {
  const invId = getInvoiceId(invoiceRow);
  const jobId = getJobId(jobRow);
  if (!invId || !jobId) return;

  const existing = (jobRow.InvoiceID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!existing.includes(invId)) {
    existing.push(invId);
    jobRow.InvoiceID = existing.join(", ");
  }

  invoiceRow.JobID = jobId;

  if (jobRow.ContractID && !invoiceRow.ContractID) {
    invoiceRow.ContractID = jobRow.ContractID;
  }
}

/* -------------- Dropdown helpers for linking --------------- */

function addJobDropdown(wrapper, inputEl, currentRow, forTab) {
  const jobs = state.data.jobs || [];
  if (!jobs.length) return;
  const select = document.createElement("select");
  select.className = "link-select";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "(no linked job)";
  select.appendChild(emptyOpt);

  jobs.forEach((job) => {
    const opt = document.createElement("option");
    const id = getJobId(job);
    opt.value = id;
    opt.textContent = id || job.FileName || "(job)";
    select.appendChild(opt);
  });

  select.value = currentRow.JobID || "";
  select.addEventListener("change", () => {
    const selectedId = select.value;
    const job = jobs.find((j) => getJobId(j) === selectedId);
    if (job) {
      if (forTab === "invoices") {
        linkInvoiceToJob(currentRow, job);
      }
    } else {
      currentRow.JobID = "";
    }
    inputEl.value = currentRow.JobID || "";
    scheduleAutosave();
    renderDetail();
  });

  wrapper.appendChild(select);
}

function addContractDropdown(wrapper, inputEl, currentRow, forTab) {
  const contracts = state.data.contracts || [];
  if (!contracts.length) return;

  const select = document.createElement("select");
  select.className = "link-select";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "(no linked contract)";
  select.appendChild(emptyOpt);

  contracts.forEach((con) => {
    const opt = document.createElement("option");
    const id = getContractId(con);
    opt.value = id;
    opt.textContent = id || con.FileName || "(contract)";
    select.appendChild(opt);
  });

  select.value = currentRow.ContractID || "";
  select.addEventListener("change", () => {
    const selectedId = select.value;
    const con = contracts.find((c) => getContractId(c) === selectedId);
    if (con) {
      if (forTab === "invoices") {
        linkInvoiceToContract(currentRow, con);
      } else if (forTab === "jobs") {
        linkJobToContract(currentRow, con);
      }
    } else {
      currentRow.ContractID = "";
    }
    inputEl.value = currentRow.ContractID || "";
    scheduleAutosave();
    renderDetail();
  });

  wrapper.appendChild(select);
}

function addInvoiceDropdown(wrapper, inputEl, currentRow) {
  const invoices = state.data.invoices || [];
  if (!invoices.length) return;

  const select = document.createElement("select");
  select.className = "link-select";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "(no linked invoice)";
  select.appendChild(emptyOpt);

  invoices.forEach((inv) => {
    const opt = document.createElement("option");
    const id = getInvoiceId(inv);
    opt.value = id;
    opt.textContent = id || inv.FileName || "(invoice)";
    select.appendChild(opt);
  });

  const firstInvoiceId = (currentRow.InvoiceID || "").split(",")[0].trim();
  select.value = firstInvoiceId || "";
  select.addEventListener("change", () => {
    const selectedId = select.value;
    const inv = invoices.find((i) => getInvoiceId(i) === selectedId);
    if (inv) {
      linkJobToInvoice(currentRow, inv);
    } else {
      currentRow.InvoiceID = "";
    }
    inputEl.value = currentRow.InvoiceID || "";
    scheduleAutosave();
    renderDetail();
  });

  wrapper.appendChild(select);
}

/* ---------------------- Detail rendering ------------------- */

function renderDetail() {
  const tab = state.activeTab;
  const row = state.selected[tab];
  detailFields.innerHTML = "";
  detailValidation.innerHTML = "";
  detailCandidates.innerHTML = "";

  if (!row) {
    detailTitle.textContent = "Details";
    return;
  }

  const id =
    row.InvoiceID || row.JobID || row.ContractID || row.FileName || "(record)";

  detailTitle.textContent = `${tab[0].toUpperCase() + tab.slice(1)} – ${id}`;

  const fieldsConfig =
    tab === "invoices"
      ? [
          "Vendor",
          "InvoiceNumber",
          "InvoiceDate",
          "DueDate",
          "Amount",
          "Currency",
          "ContractID",
          "JobID",
          "Status",
          "Approved",
          "ApprovedBy",
          "ApprovedDate",
          "Sent",
          "SentDate",
          "Notes",
        ]
      : tab === "jobs"
      ? [
          "Vendor",
          "Description",
          "AmountExpected",
          "Currency",
          "ContractID",
          "InvoiceID",
          "Status",
          "ApprovedBy",
          "ApprovedDate",
          "Notes",
        ]
      : [
          "Vendor",
          "StartDate",
          "EndDate",
          "Price",
          "Currency",
          "Status",
          "Notes",
        ];

  const candTotals = row._candidatesTotals || [];
  const candDates = row._candidatesDates || [];

  fieldsConfig.forEach((field) => {
    const wrapper = document.createElement("div");
    wrapper.className = "detail-field";

    const label = document.createElement("label");
    label.textContent = field;

    let inputEl;
    if (field === "Notes" || field === "Description") {
      inputEl = document.createElement("textarea");
      inputEl.value = row[field] || "";
      inputEl.addEventListener("input", () => {
        row[field] = inputEl.value;
        scheduleAutosave();
      });
      wrapper.appendChild(label);
      wrapper.appendChild(inputEl);
    } else {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.value = row[field] || "";
      inputEl.addEventListener("input", () => {
        row[field] = inputEl.value;
        scheduleAutosave();
      });
      wrapper.appendChild(label);
      wrapper.appendChild(inputEl);
    }

    // OCR suggestions directly under relevant box
    if (["Amount", "AmountExpected", "Price"].includes(field) && candTotals.length) {
      const g = document.createElement("div");
      g.className = "candidate-group";
      candTotals.slice(0, 10).forEach((c) => {
        const chip = document.createElement("span");
        chip.className = "candidate-chip";
        chip.textContent = c.raw;
        chip.title = c.line;
        chip.addEventListener("click", () => {
          row[field] = c.raw;
          inputEl.value = c.raw;
          scheduleAutosave();
        });
        g.appendChild(chip);
      });
      wrapper.appendChild(g);
    }

    if (
      ["InvoiceDate", "DueDate", "StartDate", "EndDate"].includes(field) &&
      candDates.length
    ) {
      const g = document.createElement("div");
      g.className = "candidate-group";
      candDates.slice(0, 10).forEach((c) => {
        const chip = document.createElement("span");
        chip.className = "candidate-chip";
        chip.textContent = c.raw;
        chip.title = c.line;
        chip.addEventListener("click", () => {
          row[field] = c.raw;
          inputEl.value = c.raw;
          scheduleAutosave();
        });
        g.appendChild(chip);
      });
      wrapper.appendChild(g);
    }

    // Linking dropdowns for relevant fields
    if (tab === "invoices" && field === "JobID") {
      addJobDropdown(wrapper, inputEl, row, "invoices");
    }

    if (tab === "invoices" && field === "ContractID") {
      addContractDropdown(wrapper, inputEl, row, "invoices");
    }

    if (tab === "jobs" && field === "ContractID") {
      addContractDropdown(wrapper, inputEl, row, "jobs");
    }

    if (tab === "jobs" && field === "InvoiceID") {
      addInvoiceDropdown(wrapper, inputEl, row);
    }

    detailFields.appendChild(wrapper);
  });

  // Validation messages
  if (row._validationIssues && row._validationIssues.length) {
    const ul = document.createElement("ul");
    row._validationIssues.forEach((msg) => {
      const li = document.createElement("li");
      li.textContent = msg;
      ul.appendChild(li);
    });
    detailValidation.textContent = "Validation / warnings:";
    detailValidation.appendChild(ul);
  }
}

/* --------------------- Save / open / scan ------------------ */

async function onSaveClicked() {
  const tab = state.activeTab;
  const rows = state.data[tab];
  const result = await window.fidget.saveRecords(tab, rows);
  state.data = {
    invoices: result.invoices || [],
    jobs: result.jobs || [],
    contracts: result.contracts || [],
  };
  applyFilter();
}

async function saveAll(silent) {
  if (!state.rootPath) return;
  // save each tab's data so all CSVs are persisted
  await window.fidget.saveRecords("invoices", state.data.invoices || []);
  const resultJobs = await window.fidget.saveRecords("jobs", state.data.jobs || []);
  const resultContracts = await window.fidget.saveRecords(
    "contracts",
    state.data.contracts || []
  );
  // last call returns full rescan
  const data = resultContracts || {};
  state.data = {
    invoices: data.invoices || [],
    jobs: data.jobs || [],
    contracts: data.contracts || [],
  };
  applyFilter();
}

async function onOpenDocClicked() {
  const tab = state.activeTab;
  const row = state.selected[tab];
  if (!row || !row.FilePath) return;
  await window.fidget.openPath(row.FilePath);
}

async function onOpenFolderClicked() {
  const tab = state.activeTab;
  const row = state.selected[tab];
  if (!row || !row.FilePath) return;
  await window.fidget.openFolder(row.FilePath);
}

async function runScan() {
  detailFields.innerHTML = "";
  detailValidation.innerHTML = "";
  detailCandidates.innerHTML = "";
  previewFilename.textContent = "Preview";
  previewCanvas.classList.add("hidden");
  previewText.classList.add("hidden");

  const result = await window.fidget.scan();
  state.data = {
    invoices: result.invoices || [],
    jobs: result.jobs || [],
    contracts: result.contracts || [],
  };
  applyFilter();
}

/* ------------------------ Preview -------------------------- */

async function loadPreviewForRow(row) {
  previewFilename.textContent = row.FileName || "(no file)";
  previewLoading.classList.remove("hidden");
  previewCanvas.classList.add("hidden");
  previewText.classList.add("hidden");

  const filePath = row.FilePath;
  if (!filePath) {
    previewLoading.classList.add("hidden");
    previewText.textContent = "No file path";
    previewText.classList.remove("hidden");
    return;
  }

  const ext = (filePath.split(".").pop() || "").toLowerCase();

  try {
    if (ext === "pdf" && window["pdfjsLib"]) {
      const pdfjsLib = window["pdfjsLib"];

      const bytes = await window.fidget.readFileBytes(filePath);
      const typedArray = new Uint8Array(bytes.data || bytes);

      const loadingTask = pdfjsLib.getDocument({ data: typedArray });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 1.3 });
      const ctx = previewCanvas.getContext("2d");
      previewCanvas.width = viewport.width;
      previewCanvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      previewLoading.classList.add("hidden");
      previewCanvas.classList.remove("hidden");
      previewText.classList.add("hidden");
      return;
    }

    if (row.RawText) {
      previewText.textContent = row.RawText.slice(0, 4000);
    } else {
      previewText.textContent = `Preview not available for .${ext}. Use "Open document" to view it.`;
    }
    previewLoading.classList.add("hidden");
    previewCanvas.classList.add("hidden");
    previewText.classList.remove("hidden");
  } catch (e) {
    previewText.textContent = `Preview failed.\n\n${String(e?.message || e)}`;
    previewLoading.classList.add("hidden");
    previewCanvas.classList.add("hidden");
    previewText.classList.remove("hidden");
  }
}

/* ------------------------ Bootstrap ------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  initConfig();
});
