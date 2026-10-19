# InvoiceBridge Windows Connector (read-only proof of concept)

**Status:** Experimental code, not production. This directory is intentionally kept on a feature branch. It never writes or posts to Tally, and it does not connect to InvoiceBridge's GitHub Pages app yet.

## Purpose

SynTally-style architecture needs **two distinct applications**:

1. A Windows process on the machine running TallyPrime, that can contact Tally's *local* HTTP XML integration gateway and read accounting/inventory masters.
2. An authenticated cloud web application that receives a company-scoped master snapshot, processes documents, matches ledgers and stock items, and queues approved vouchers for the connector to deliver.

GitHub Pages is static hosting. It cannot store secrets, execute server-side AI vision, or directly connect to local Tally. A server API and persistent storage are therefore required before direct sync is possible.

## Run locally on Windows

Install Python 3.11+ (standard library only). Open TallyPrime with **a test/backup company**, ensure its local integration HTTP port is enabled, and double-click `run_windows.bat`. Type the exact company name and the local port (default `9000`). Click **Read masters from Tally**. If the query succeeds, choose **Save master snapshot** to create a JSON file *locally*.

The collection definitions must be tested on your TallyPrime version; some versions use different object methods and collection tags. An empty ledger result is an error, not a successful sync.

To use command line:

```bat
py -3 tally_agent.py --company "YOUR TEST COMPANY NAME" --port 9000 --export "test_masters.json"
```

Run Python unit tests:

```bat
py -3 -m unittest discover -s . -p "test_*.py" -v
```

**Never upload the resulting master JSON to a public repository.** It can contain customer/supplier names and GST identifiers.

## Explicit safety boundaries

- Only calls `http://127.0.0.1:<port>/`.
- No Tally voucher creation, editing or deletion.
- No internet upload, background job, login tokens or device pairing.
- No automated creation of ledgers/stock items.
- Takes an explicit company name to prevent mixing masters from multiple companies.
- Files are exported only on user action; refuses overwriting an existing snapshot.

## Next phase before production

- Test queries with TallyPrime releases and different Tally company settings.
- Implement secure one-time pairing through the authenticated API: 8-digit short-lived user-visible code, user confirmation, rate limiting, one-time exchange for a **revocable device certificate/token**; never use the code itself as permanent authentication.
- Agent polls outbound-only over HTTPS; no inbound exposure of the Tally XML port.
- Company-scoped encrypted masters (ledger groups, GSTIN, stock items, HSN, UOM, tax config); versioned delta sync and sync status.
- Backend Gemini/other multimodal document analysis, human review, and remembered company-scoped aliases.
- **Only after review/approval:** use a separate code path for create-voucher commands with idempotency key + Tally response verification + duplicate lookup before retry. Test with a copy of the real company.
- Provide a signed Windows installer, auto-update, service restart, diagnostics and staff/admin permissions.

The recording supplied by the owner shows a five-step process (Party, Stock, Ledger, Tax+round-off, Sync), plus master imports and a successful voucher push. This is **a behavior reference**, not proof that the proprietary implementation uses any particular library or network protocol.
