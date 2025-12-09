
const $ = (id) => document.getElementById(id);

let cache = { invoices: [], assignments: [], contracts: [] };
let tab = "invoices";
let selectedId = null;
let lastPreview = null;

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function showSettingsOverlay(show) {
  const ov = $("settingsOverlay");
  if (!ov) return;
  ov.classList.toggle("hidden", !show);
  if (show) {
    const rootText = $("rootLabel").textContent || "";
    $("settingsRootLabel").textContent = rootText.replace(/^Root:\s*/, "") || "(not set)";
  }
}

function fillSelect(sel, items, getValue, getLabel) {
  sel.innerHTML = "";
  sel.appendChild(new Option("(none)", ""));
  for (const it of items) sel.appendChild(new Option(getLabel(it), getValue(it)));
}

function renderRows(which, rows, cols, selectFn) {
  const tbody = $(which);
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = cols(r) + `<td><button>Select</button></td>`;
    tr.querySelector("button").onclick = selectFn(r);
    tbody.appendChild(tr);
  }
}

function selectRow(which, id) {
  selectedId = id;
  $("btnSave").disabled = !id;
  $("btnOpen").disabled = !id;
  $("previewBox").textContent = "";
  lastPreview = null;

  if (which === "invoices") {
    const inv = cache.invoices.find(x => x.InvoiceID === id);
    $("sel").textContent = inv ? `${inv.InvoiceID} — ${inv.FileName}` : "(none selected)";
    if (!inv) return;
    for (const k of ["Vendor","InvoiceNumber","InvoiceDate","DueDate","Amount","Currency","Status","Approved","ApprovedBy","Sent","Notes"]) {
      $(k).value = inv[k] || "";
    }
    $("AssignmentID").value = inv.AssignmentID || "";
    $("ContractID").value = inv.ContractID || "";
  }

  if (which === "assignments") {
    const a = cache.assignments.find(x => x.AssignmentID === id);
    $("sel").textContent = a ? `${a.AssignmentID} — ${a.FileName}` : "(none selected)";
    if (!a) return;
    $("A_Vendor").value = a.Vendor || "";
    $("A_Description").value = a.Description || "";
    $("A_AmountExpected").value = a.AmountExpected || "";
    $("A_Currency").value = a.Currency || "GBP";
    $("A_Status").value = a.Status || "New";
    $("A_ApprovedBy").value = a.ApprovedBy || "";
    $("A_InvoiceID").value = a.InvoiceID || "";
    $("A_ContractID").value = a.ContractID || "";
    $("A_Notes").value = a.Notes || "";
  }

  if (which === "contracts") {
    const c = cache.contracts.find(x => x.ContractID === id);
    $("sel").textContent = c ? `${c.ContractID} — ${c.FileName}` : "(none selected)";
    if (!c) return;
    $("C_Vendor").value = c.Vendor || "";
    $("C_Price").value = c.Price || "";
    $("C_Currency").value = c.Currency || "GBP";
    $("C_Status").value = c.Status || "Active";
    $("C_StartDate").value = c.StartDate || "";
    $("C_EndDate").value = c.EndDate || "";
    $("C_Notes").value = c.Notes || "";
  }

  updatePreview();
}

async function loadInvoiceCandidates() {
  const holderA = $("candAmounts");
  const holderD = $("candDates");
  if (!holderA || !holderD) return;
  holderA.innerHTML = "";
  holderD.innerHTML = "";
  if (!selectedId || tab !== "invoices" || !window.api.getFieldCandidates) return;

  try {
    const res = await window.api.getFieldCandidates("invoices", selectedId);
    const amounts = (res && res.amounts) || [];
    const dates = (res && res.dates) || [];

    amounts.slice(0, 5).forEach(a => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = a;
      chip.title = "Set Amount to " + a;
      chip.onclick = () => { $("Amount").value = a; };
      holderA.appendChild(chip);
    });

    dates.slice(0, 6).forEach(d => {
      const chipInv = document.createElement("span");
      chipInv.className = "chip";
      chipInv.textContent = "Inv " + d;
      chipInv.title = "Set Invoice date to " + d;
      chipInv.onclick = () => { $("InvoiceDate").value = d; };
      holderD.appendChild(chipInv);

      const chipDue = document.createElement("span");
      chipDue.className = "chip";
      chipDue.textContent = "Due " + d;
      chipDue.title = "Set Due date to " + d;
      chipDue.onclick = () => { $("DueDate").value = d; };
      holderD.appendChild(chipDue);
    });
  } catch (e) {
    // ignore
  }
}

async function updatePreview() {
  const box = $("previewBox");
  if (!box) return;
  box.textContent = "";
  lastPreview = null;
  $("btnOpen").disabled = !selectedId;
  if (!selectedId) {
    const holderA = $("candAmounts");
    const holderD = $("candDates");
    if (holderA) holderA.innerHTML = "";
    if (holderD) holderD.innerHTML = "";
    return;
  }
  try {
    const res = await window.api.getPreview(tab, selectedId);
    if (!res) { box.textContent = "(no preview)"; return; }
    lastPreview = res;
    if (res.kind === "text") {
      box.textContent = res.snippet || "(no text found)";
    } else if (res.kind === "file") {
      box.textContent = "Preview not available here. Click 'Open document' to view this file.\n" + (res.path || "");
    } else {
      box.textContent = "(no preview)";
    }
  } catch (e) {
    box.textContent = "(error loading preview)";
  }
  if (tab === "invoices" && selectedId) {
    loadInvoiceCandidates();
  } else {
    const holderA = $("candAmounts");
    const holderD = $("candDates");
    if (holderA) holderA.innerHTML = "";
    if (holderD) holderD.innerHTML = "";
  }
}

async function loadSetupYears() {
  if (!window.api.getYearOptions) return;
  const sel = $("setupYear");
  if (!sel) return;
  try {
    const info = await window.api.getYearOptions();
    const currentYear = info.currentYear;
    const years = Array.isArray(info.years) ? info.years : [];
    const set = new Set();
    if (currentYear) {
      set.add(currentYear);
      set.add(currentYear - 1);
      set.add(currentYear + 1);
    }
    for (const y of years) if (y) set.add(y);
    const sorted = Array.from(set).filter(Boolean).sort((a,b)=>a-b);
    sel.innerHTML = "";
    for (const y of sorted) {
      const opt = new Option(String(y), String(y));
      if (y === currentYear) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch (e) {
    // ignore
  }
}

async function refresh() {
  const status = $("filterStatus").value.trim();
  const q = $("search").value.trim();

  cache = await window.api.getData({ tab, status, q });
  const all = await window.api.getData({ tab: "all", status: "", q: "" });

  $("invCount").textContent = all.invoices.length;
  $("asCount").textContent = all.assignments.length;
  $("conCount").textContent = all.contracts.length;

  fillSelect($("AssignmentID"), all.assignments, a => a.AssignmentID, a => `${a.AssignmentID}${a.Vendor ? " — " + a.Vendor : ""}`);
  fillSelect($("ContractID"), all.contracts, c => c.ContractID, c => `${c.ContractID}${c.Vendor ? " — " + c.Vendor : ""}`);
  fillSelect($("A_InvoiceID"), all.invoices, i => i.InvoiceID, i => `${i.InvoiceID}${i.Vendor ? " — " + i.Vendor : ""}`);
  fillSelect($("A_ContractID"), all.contracts, c => c.ContractID, c => `${c.ContractID}${c.Vendor ? " — " + c.Vendor : ""}`);

  if (tab === "invoices") {
    renderRows("rowsInvoices", cache.invoices, (inv)=>`
      <td>${inv.InvoiceID||""}</td>
      <td>${inv.FileName||""}<div class="muted">${(inv.FileLastModified||"").slice(0,10)}</div></td>
      <td>${inv.Vendor||""}</td>
      <td>${inv.Amount||""} ${inv.Currency||""}</td>
      <td>${inv.Status||""}</td>
      <td>${inv.AssignmentID||""}</td>
    `, inv => () => selectRow("invoices", inv.InvoiceID));
  }
  if (tab === "assignments") {
    renderRows("rowsAssignments", cache.assignments, (a)=>`
      <td>${a.AssignmentID||""}</td>
      <td>${a.FileName||""}<div class="muted">${(a.FileLastModified||"").slice(0,10)}</div></td>
      <td>${a.Vendor||""}</td>
      <td>${a.AmountExpected||""} ${a.Currency||""}</td>
      <td>${a.Status||""}</td>
      <td>${a.InvoiceID||""}</td>
    `, a => () => selectRow("assignments", a.AssignmentID));
  }
  if (tab === "contracts") {
    renderRows("rowsContracts", cache.contracts, (c)=>`
      <td>${c.ContractID||""}</td>
      <td>${c.FileName||""}<div class="muted">${(c.FileLastModified||"").slice(0,10)}</div></td>
      <td>${c.Vendor||""}</td>
      <td>${c.Price||""} ${c.Currency||""}</td>
      <td>${c.Status||""}</td>
      <td>${[c.StartDate,c.EndDate].filter(Boolean).join(" → ")}</td>
    `, c => () => selectRow("contracts", c.ContractID));
  }

  setStatus("Loaded.");
}

function showTab(newTab) {
  tab = newTab;
  selectedId = null;
  $("sel").textContent = "(none selected)";
  $("btnSave").disabled = true;
  $("btnOpen").disabled = true;
  $("previewBox").textContent = "";
  const holderA = $("candAmounts");
  const holderD = $("candDates");
  if (holderA) holderA.innerHTML = "";
  if (holderD) holderD.innerHTML = "";

  $("tblInvoices").classList.toggle("hidden", tab !== "invoices");
  $("tblAssignments").classList.toggle("hidden", tab !== "assignments");
  $("tblContracts").classList.toggle("hidden", tab !== "contracts");

  $("editorInvoices").classList.toggle("hidden", tab !== "invoices");
  $("editorAssignments").classList.toggle("hidden", tab !== "assignments");
  $("editorContracts").classList.toggle("hidden", tab !== "contracts");

  $("filterStatus").value = "";
  refresh();
}

// buttons
$("btnPick").onclick = async () => {
  const root = await window.api.pickRootFolder();
  if (root) {
    $("rootLabel").textContent = `Root: ${root}`;
    await loadSetupYears();
  }
  await refresh();
};

$("btnRescan").onclick = async () => {
  setStatus("Rescanning...");
  await window.api.rescan();
  await refresh();
};
$("btnRefresh").onclick = refresh;

$("btnOpen").onclick = async () => {
  if (!selectedId) return;
  if (!lastPreview) lastPreview = await window.api.getPreview(tab, selectedId);
  if (lastPreview && lastPreview.path) await window.api.openDocument(lastPreview.path);
};

$("btnSettings").onclick = async () => {
  await loadSetupYears();
  showSettingsOverlay(true);
};

$("btnCloseSettings").onclick = () => showSettingsOverlay(false);

$("btnSetupPickRoot").onclick = async () => {
  const root = await window.api.pickRootFolder();
  if (root) {
    $("rootLabel").textContent = `Root: ${root}`;
    $("settingsRootLabel").textContent = root;
    await loadSetupYears();
    await refresh();
  }
};

$("btnSetupThisYear").onclick = async () => {
  if (!window.api.setupYearStructure || !window.api.getYearOptions) return;
  const info = await window.api.getYearOptions();
  const year = info.currentYear;
  if (!year) return;
  await window.api.setupYearStructure(year);
  setStatus(`Created folder structure for ${year}`);
  await refresh();
};

$("btnSetupYear").onclick = async () => {
  if (!window.api.setupYearStructure) return;
  const sel = $("setupYear");
  if (!sel || !sel.value) return;
  const year = parseInt(sel.value, 10) || sel.value;
  await window.api.setupYearStructure(year);
  setStatus(`Created folder structure for ${year}`);
  await refresh();
};

$("filterStatus").onchange = refresh;
$("search").oninput = () => {
  clearTimeout(window.__t);
  window.__t = setTimeout(refresh, 250);
};

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    showTab(btn.dataset.tab);
  });
});

$("btnSave").onclick = async () => {
  if (!selectedId) return;
  if (tab === "invoices") {
    const patch = {
      Vendor: $("Vendor").value.trim(),
      InvoiceNumber: $("InvoiceNumber").value.trim(),
      InvoiceDate: $("InvoiceDate").value.trim(),
      DueDate: $("DueDate").value.trim(),
      Amount: $("Amount").value.trim(),
      Currency: $("Currency").value,
      Status: $("Status").value,
      Approved: $("Approved").value,
      ApprovedBy: $("ApprovedBy").value.trim(),
      Sent: $("Sent").value,
      AssignmentID: $("AssignmentID").value,
      ContractID: $("ContractID").value,
      Notes: $("Notes").value
    };
    await window.api.updateRow("invoices", selectedId, patch);
  }
  if (tab === "assignments") {
    const patch = {
      Vendor: $("A_Vendor").value.trim(),
      Description: $("A_Description").value.trim(),
      AmountExpected: $("A_AmountExpected").value.trim(),
      Currency: $("A_Currency").value,
      Status: $("A_Status").value,
      ApprovedBy: $("A_ApprovedBy").value.trim(),
      InvoiceID: $("A_InvoiceID").value,
      ContractID: $("A_ContractID").value,
      Notes: $("A_Notes").value
    };
    await window.api.updateRow("assignments", selectedId, patch);
  }
  if (tab === "contracts") {
    const patch = {
      Vendor: $("C_Vendor").value.trim(),
      Price: $("C_Price").value.trim(),
      Currency: $("C_Currency").value,
      Status: $("C_Status").value,
      StartDate: $("C_StartDate").value.trim(),
      EndDate: $("C_EndDate").value.trim(),
      Notes: $("C_Notes").value
    };
    await window.api.updateRow("contracts", selectedId, patch);
  }
  setStatus("Saved to CSV.");
  await refresh();
};

// init
(async () => {
  const root = await window.api.getRootFolder();
  if (root) {
    $("rootLabel").textContent = `Root: ${root}`;
    await loadSetupYears();
    showSettingsOverlay(false);
  } else {
    await loadSetupYears();
    showSettingsOverlay(true);
  }
  await refresh();
})();
