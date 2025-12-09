# FIDGET
**Financial Invoice, Deal & Job Engagement Tracker**

FIDGET is a local desktop app that watches a folder of **Invoices**, **Jobs** and **Contracts** and maintains an **Excel-friendly CSV backend** you can edit directly.

- Runs locally (no cloud required)
- Auto-scans folders and extracts details from documents (PDF/Email/Word/Excel + OCR for scans)
- Lets you approve/send/track status and link invoices to jobs and contracts
- Stores everything as CSV so you can work in Excel anytime

---

## How it works

1. You choose a **root folder** in the app.
2. FIDGET ensures these subfolders exist under the root:
   - `Invoices`
   - `AS` (Jobs)
   - `Contracts`
3. FIDGET creates (if missing) these CSV files in the root:
   - `invoices.csv`
   - `assignments.csv`
   - `contracts.csv`
4. FIDGET scans the folders (including subfolders). For each file it:
   - creates a unique ID (e.g. `INV-XXXXXXX`)
   - extracts text (PDF/Office/email parsing and OCR when needed)
   - guesses key fields (vendor, invoice number, dates, total, currency)
5. FIDGET keeps watching the folders. Dropping new files into them adds new rows automatically.

You can edit any fields in-app and click **Save** (writes back to the CSVs).  
You can also open the CSVs in Excel, edit, save, then click **Refresh** in FIDGET.

---

## Folder structure

Expected under your chosen root:

```text
<ROOT>/
  Invoices/
  AS/
  Contracts/
  invoices.csv
  assignments.csv
  contracts.csv
```

### Optional year/month setup

In **Setup / Settings**, you can generate:

```text
Invoices/YYYY/MM - Month/
AS/YYYY/MM - Month/
Contracts/YYYY/MM - Month/
```

---

## Where data is saved

### CSV backend (editable in Excel)

All records are stored in the root folder as CSV:

- `invoices.csv` (invoice records)
- `assignments.csv` (job records)
- `contracts.csv` (contract records)

**Important:**
- Don’t delete the header row.
- After editing in Excel, click **Refresh** in FIDGET.

### App configuration

FIDGET stores a small config JSON in Electron’s standard `userData` location (per user).  
This includes the selected `rootPath`.

---

## Supported file types

FIDGET can extract text from:

- PDF: `.pdf` (embedded text; OCR only if it’s an image/scan)
- Images: `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp` (OCR)
- Word: `.docx`
- Excel: `.xlsx`, `.xls`, `.xlsm`, `.xlsb`
- Email: `.eml`, `.msg`

Extraction is **generic** (no vendor templates). If OCR guesses the wrong total/date, the invoice editor shows clickable **Detected totals** and **Detected dates** chips to fill fields quickly.

---

## Linking invoices, jobs and contracts

FIDGET supports linking:

- Invoice → Job via `AssignmentID`
- Job → Invoice via `InvoiceID`
- Both can reference a contract via `ContractID`

The UI keeps invoice↔job linking consistent (setting one updates the other).


---

## Notes / limitations

- OCR is best-effort: clean PDFs work best; poor scans may need manual correction.
- Heuristics are generic and may not always pick the right field automatically.
- FIDGET is local-first; sharing relies on your folder sync (e.g. OneDrive/SharePoint/etc.).
