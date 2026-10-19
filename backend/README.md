# InvoiceBridge — experimental AI extraction service

This is **not** a copy of SynTally and does **not** use REA as an OCR engine. It is an independently implemented, Google Gemini vision-based adapter intended to replace the limitations of phone-browser Tesseract on difficult invoice layouts. The live GitHub Pages app does **not** call this code yet. No Tally posting is added.

## Quick verification

Run `node --test backend/worker.test.mjs` from the repository root. Tests mock upstream AI; they do **not** prove real handwriting or model accuracy.

## Deploy to Cloudflare Workers (requires your own account and key)

1. Open the `backend` directory and run `npx wrangler deploy` after authenticating Wrangler. (Wrangler may require installation.)
2. Run `npx wrangler secret put GEMINI_API_KEY` and paste your **Google AI Studio API key** when prompted.
3. Run `npx wrangler secret put INVOICEBRIDGE_ACCESS_TOKEN` and set a unique random string at least 24 characters long. Never commit it or paste it into a public issue.
4. Deploy again if requested; set `ALLOWED_ORIGIN` to the exact origin hosting the app. The default is `https://vsshegur.github.io`.
5. Before enabling a browser client, add proper accounts/rate limits, consent notices and financial-data retention policies. A shared token is only a private test gate, **not** production-grade authentication.

## API contract

`POST /v1/extract` with `Origin: https://vsshegur.github.io`, `Content-Type: application/json`, and `X-InvoiceBridge-Key: <server-configured-private-test-token>`.

Body: `{"file":{"mime_type":"image/jpeg","base64":"..."}}`. Input supports JPEG, PNG, WEBP and PDF up to 8 MiB. Excel/CSV must be parsed by a separate structured path; never OCR Excel images unnecessarily.

Response: `{"schema_version":1,"provider":"gemini","model":"gemini-3.8-flash","requires_human_review":true,"invoices":[...]}`.

Invoice keys: `supplier_name`, `supplier_gstin`, `buyer_name`, `buyer_gstin`, `invoice_number`, `invoice_date`, `currency`, `source_taxable`, `source_discount`, `source_cgst`, `source_sgst`, `source_igst`, `round_off`, `invoice_total`, `items[]`, `warnings[]`.

All values are **unverified suggestions**. Do not post to Tally without human review. The service does not store invoice images or extracted results, but sends submitted document data to the selected AI provider. Review the provider's privacy/retention policy and any accounting-data obligations before using real private invoices. Apply rate limiting at Cloudflare; this starter has no durable per-user rate limiting.

## What REA can and cannot do

The user-provided [REA repository](https://github.com/morluto/rea) is an MIT-licensed reverse-engineering toolkit. Its browser inspector attaches to a *user-controlled local Chrome debugging endpoint*. REA cannot access a paid account session in ChatGPT's remote environment, read SynTally's private server-side models, or provide equivalent OCR on its own. Use REA only to study permitted observable behavior; build an independent implementation, not a copy of proprietary code.

## Benchmark gate

Before production usage, evaluate at least 100 varied bills, handwritten and printed, against manually verified ground truth (including Indian tax rules). Record per-field and line-item exact accuracy, ambiguous handwriting, missing information, image orientation, latency and provider cost. Do not promise 100% accuracy.
