# InvoiceBridge Pro — Mobile Testing Edition 0.5.0

**Scope:** mobile-friendly, browser-only, local-first invoice-to-Tally **purchase voucher** reviewing. Open a hosted HTTPS page on Android Chrome, use your phone camera, OCR invoices, import exported Tally masters, correct fields, approve, then download a **test-only** Tally XML file. No Tally connector, no backend, no server data storage.

## What works today

- Android camera capture, multiple photo/PDF/Excel/CSV uploads (15 MB max per file).
- Local-first device storage using IndexedDB. **Your invoices are kept only on the browser/device where they were uploaded.** No cross-device sync; browser clearing/incognito can delete records.
- Lazy-loaded Tesseract.js local English OCR, optionally English+Hindi+Marathi (OCR on handwriting varies significantly); PDF.js digital text or scanned-page OCR; SheetJS for XLS/XLSX; CSV text/limited row hints.
- Import existing Tally ledger/group/stock masters from XML, keep Vipul and Vijayalaxmi companies separate.
- Side-by-side original document & manually editable review fields. Suggested CSV item rows are NOT confirmed stock mappings.
- Existing-creditor/item/UOM validations, GST and amount reconciliation with decimal fixed-point maths, duplicate file and duplicate supplier bill detection.
- Human approval required before XML creation; edits invalidate approval. No automatic posting.
- One-button demo; 20 automated deterministic accounting tests.
- Export **metadata** backup without original scanned files. Preserve originals separately.

## What is NOT completed

- Cloud sync / secure accounts, AI/multimodal OCR, robust arbitrary handwritten invoice or line-table reading, multi-invoice PDF splitting, learning verified item mappings, stable high-volume processing, automatic Tally posting, or full accounting/GST edge cases. PDF limited to first 12 pages; one invoice per file.
- This XML is a preliminary Purchase Invoice template. It **must** be tested against a voucher exported from your actual TallyPrime version and imported into a **copy/test company**, never directly into live books.
- Hosted static pages are publicly visitable. The app has **no user authentication** because invoice contents remain only in the local browser. Anyone with access to your unlocked device/browser profile can access that stored data. Do not test with sensitive customer or vendor information until security review.
- OCR libraries are downloaded from third-party CDNs on first use. OCR runs on-device, but loading remote code has supply-chain risks; sensitive production accounting requires self-hosted pinned assets and security review.

## Deploy on GitHub Pages or Vercel (no backend)

1. Create an empty GitHub repository (e.g. `InvoiceBridge-Pro`). Upload the **contents** of this project folder to the repository root, including the `.github/workflows/pages.yml` workflow.
2. Import the repo at https://vercel.com/new. Framework **Other**; build command **blank**; output directory `.`. Production branch `main`.
3. Wait for the deploy to succeed, open its `.vercel.app` URL from Android Chrome.
4. Tap **Try demo** to load test ledgers and sample invoice. Review and approve it and download test XML.
5. For your own ledger matching, export **All Masters** XML from TallyPrime for the correct company and import it in the app. Do not upload real sensitive invoices to a shared or untrusted phone.

Alternative static hosting: Cloudflare Pages (no build, root output directory) or **GitHub Pages**. This package includes `.github/workflows/pages.yml` and relative asset paths for a project subpath. In GitHub, open **Settings → Pages**, select **GitHub Actions** as the build and deployment source, then push `main`.

## Run locally on a laptop

```bash
python -m http.server 8787
```

Open http://127.0.0.1:8787. This build uses the browser for extraction, without Python server libraries. Localhost supports IndexedDB and camera permissions where the browser allows them.

## Tests

```bash
node --test tests/*.mjs
```

Test 20 accounting cases. The test environment blocks Chromium navigation to localhost, so **a real Android Chrome smoke test is still required**. Please send your screen recording or browser screenshot of issues.

## Privacy/security boundaries

No API endpoints send your invoice bytes anywhere. There is no login, cloud storage, server-side permissions, analytics, or live Tally posting. Original documents and matches are saved in your phone's IndexedDB, and do not sync to another phone. If you need cross-device access, this should be replaced with an encrypted authenticated backend, not a static fake-login page.

## Architecture

- `index.html`, `style.css`, `app.js`: mobile UI and human-review workflow.
- `src/local-api.mjs`: client-only processing, OCR, storage and approval lifecycle.
- `src/core.mjs`: fixed-point calculations, master validations and XML generation.
- `src/storage.mjs`: IndexedDB.
- `sw.js`, `manifest.webmanifest`: PWA shell caching, offline after first visit (OCR libraries may still need Internet).
- `examples`: non-sensitive demo.
- `tests`: deterministic validation tests.

## Future phases

1. Harden browser OCR and improve printed-line extraction; test real supplier documents using controlled fixtures.
2. Evaluate at least two high-grade cloud/vision OCR providers on real handwritten English/Hindi/Marathi examples with human correction.
3. Secure accounts, company permissions, proper storage, backups, audit logs and cross-device synchronization.
4. Windows Tally connector: read-only master synchronization first, then explicit approved transaction transmission, Tally response verification and idempotency.

## October 2026 OCR update (v0.7.0)

- Image OCR now has optional targeted header, item-table, and totals re-scans. Basic OCR is attempted first; extra passes are used when vital fields are missing. A detailed re-scan is also available from invoice review.
- Tally-style OCR parsing recognizes column headers, GST, discounts, amount in words, and printed line amounts. It does **not** invent unclear handwritten invoice numbers.
- Amounts obtained by cross-checking printed tax/discount values and apparent OCR conflicts are flagged for human verification.
- No Tally master imports required for extraction review. Live posting remains unavailable.
- The public repository contains synthetic redacted OCR test fixtures only; uploaded supplier documents are never committed to GitHub.
- This remains a **prototype**. Tesseract is not a reliable replacement for production handwriting/document-AI extraction, and device/browser OCR results need live validation.
