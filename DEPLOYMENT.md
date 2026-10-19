# Safe deploy guide

Target: **static hosting**, no Python backend or server state. Use Vercel Other/Static; do not select FastAPI. This app has no secrets or Vercel environment variables.

1. Publish these files in a GitHub repository with branch `main`.
2. Vercel > Add New > Project > Import repo.
3. Framework Other; no install or build command; output directory `.`.
4. Add no server-side API endpoints and no Tally port exposure.
5. Preview with non-sensitive demo data on Android first.

**Warning:** The `vercel.json` CSP currently permits pinned third-party OCR/PDF/Excel JS CDN hosts. Before processing confidential financial data, vendor dependencies into the repo, review their security, and tighten CSP.

## Production blockers

Auth + row-level company isolation in cloud, encrypted document storage and backups, OCR quality benchmark, sample Tally-voucher compatibility, tax edge-case coverage, import idempotency and audit logs, real Android device testing. The test build makes no claims to production readiness.

## Free GitHub Pages deployment (alternative)

Create a repository named `InvoiceBridge-Pro`, upload contents of this folder at repository root, go to **Settings → Pages → Build and deployment**, choose **GitHub Actions**, and push `main`. Included workflow `.github/workflows/pages.yml` deploys the static project. The resulting URL follows `https://<your-github-username>.github.io/InvoiceBridge-Pro/`. Confirm the actual URL in the completed Actions deployment; don't guess it.

Asset paths use `./` to work at GitHub Pages project subpaths. The app remains browser-local with no login and no cross-device data sync.
