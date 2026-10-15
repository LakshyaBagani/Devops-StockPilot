# Frontend QA checklist

Manual checks for the StockPilot UI, run at four stages: dev mode (S3 exit), compose, kind/EKS and demo day. Each row is an action and the result it must produce. Record a pass in the last column as `YYYY-MM-DD · <sha7>` (the commit under test), or `FAIL: <note>` followed by the fix commit.

Reference data comes from the seed (`python -m app.seed`): about 40 products with 60 days of history. 'Reynolds pen (blue)' is seeded just above twice its lead time of cover, so one OUT 20 turns its bar from green to amber.

## A. Dev mode (S3 exit)

Setup: `make dev` (seeded dev database on 127.0.0.1:55433, uvicorn on :8000, Vite on :5173). To use a port-forwarded API instead: `API_PROXY_TARGET=http://127.0.0.1:18000 npm --prefix frontend run dev`.

| # | Action | Expected | Result |
|---|---|---|---|
| A1 | On Stock, press Record on 'Reynolds pen (blue)', enter 20 and submit. Then press Undo in the toast. | The toast reads exactly `Reynolds pen (blue) −20 → N left`, where N is `on_hand` from `curl -s 'http://localhost:8000/api/products?q=Reynolds&limit=5'`. The row, its bar (green → amber) and the summary line refresh without a reload. Undo shows 'Undone' and restores on hand. | 2026-10-15 · a6a48ff |
| A2 | Record OUT 99999 on the same product. | The server text `Insufficient stock: on hand N, requested 99999` appears under the quantity; the sheet stays open and no toast appears. `curl -s localhost:8000/metrics \| grep '^stockpilot_insufficient_stock_total'` rises by exactly 1. | 2026-10-15 · a6a48ff |
| A3 | On Planner, press Run simulation with the defaults and read the request in DevTools → Network. | The request is exactly `/api/reorder-plan?service_level=95&horizon_days=30`, the same query as the loadgen `TARGET_URL` in `k8s/loadgen.yaml` (no `scenarios`; the server default is echoed). The header reads '… · from 1,000 simulated months · …'. | 2026-10-15 · a6a48ff |
| A4 | DevTools device mode at 375×667 and 1440×900 on all 7 routes (`/`, `/ledger`, `/planner`, `/products`, `/products/new`, `/products/1`, `/products/1/edit`), with and without the record sheet open. | 375: a fixed bottom tab bar with 5 items of at least 44×44 px, rows as cards, the sheet rising from the bottom, `document.documentElement.scrollWidth <= innerWidth`. 1440: tabs in the header, ruled table rows, the sheet docked right. | 2026-10-15 · a6a48ff |
| A5 | Stop uvicorn and click any tab. Start uvicorn again and wait. | Within 5 s the banner reads 'Can't reach the StockPilot API — showing the last data loaded' and the footer shows `api —`. Within 10 s of the restart the banner goes and the data reloads, with no page reload. | 2026-10-15 · a6a48ff |
| A6 | `cd frontend && npm ci && npm run lint && npm test && VITE_GIT_SHA=$(git rev-parse HEAD) npm run build` | ESLint with 0 warnings, then `guardrails: OK`; at least 30 node:test cases pass; the build exits 0. `gzip -c dist/assets/index-*.js \| wc -c` ≤ 92160 and `du -sk dist` ≤ 700. | 2026-10-15 · a6a48ff |

## B. Compose at http://localhost:3000

Setup: `make up`, then `make seed`.

| # | Action | Expected | Result |
|---|---|---|---|
| B1 | Open `/`. | At least 40 rows and the summary line. The console shows 0 errors and 0 CSP violations on every route. | |
| B2 | Search 'pen'; then the Grocery chip; then the 'at/below reorder' toggle. | `/?q=pen` survives a reload; only grocery rows show; the toggle sends `below_reorder=true` and the REORDER tags equal `curl -s 'http://localhost:3000/api/products?below_reorder=true&limit=100' \| jq length`. | |
| B3 | Record OUT 20 on 'Reynolds pen (blue)'. | The toast text as in A1, the bar turns amber, and the movement is the top row of the Ledger. | |
| B4 | Record an OUT larger than on hand. | The server text shows inline under the quantity; no toast. | |
| B5 | Undo the top Ledger row (Undo, then Confirm undo). | The row disappears and on hand is restored. | |
| B6 | Create a product with SKU `test-01` and unit cost `12.5`; create it again; edit only its name; look at Delete on a product with movements; delete the new product. | The POST sends `TEST-01` and `unit_cost_paise` 1250 (201); the second create shows 'SKU TEST-01 already exists'; the PUT body is exactly `{"name": …}`; Delete is disabled with the visible hint 'Has N movements — kept for the audit trail'; deleting the new product returns 204 and its row goes. | |
| B7 | Open a product. | At most 20 recent movements and a 'Full ledger →' link; 30 bars once the deferred sparkline lands (B80/K.1). | |
| B8 | Planner: defaults, then +20% with 60 d. | The default URL as in A3; rows in descending risk; the second request ends `horizon_days=60&surge_pct=20`. | |
| B9 | Read the footer. | `StockPilot v1.0.0 · ui <sha7> · api <sha7>`, both equal to the commit `make up` built. | |
| B10 | `docker compose stop backend`, then `docker compose start backend`. | The banner appears, then disappears, without a reload. | |
| B11 | 375×667, then 1440×900. | 375: bottom bar, cards, the sheet from the bottom, no horizontal scroll, no zoom when an input gets focus. 1440: top nav, table, the sheet docked right. | |
| B12 | Reload `/products/3` and `/ledger?kind=OUT`; open `/nope`; open `/api/docs` and use Try it out on GET /api/products. | Deep links render; `/nope` shows 'No such page'; Swagger works through nginx (`curl -s -D - -o /dev/null http://localhost:3000/api/docs \| grep -ci content-security-policy` prints 0). | |
| B13 | Keyboard only, then DevTools → Rendering → prefers-reduced-motion: reduce. | The skip link appears first; every stop has the focus ring; Esc closes the sheet and focus returns to Record; Back closes the sheet. With reduced motion nothing animates. | |
| B14 | Anti-resemblance review against the hard rules in `frontend/src/styles/components.css`. | No sidebar or drawer, no stat cards, no status-filter pills, no activity feed, no centred modal, no greeting or profile block. | |

## C. kind and EKS, through the Ingress

kind: http://localhost:8080. EKS: `$APP_URL`.

| # | Action | Expected | Result |
|---|---|---|---|
| C1 | `curl -s -D - -o /dev/null <base>/` and `curl -s -D - -o /dev/null <base>/api/version` | `/` carries the nginx headers (CSP, `Cache-Control: no-cache`); `/api/version` shows `server: uvicorn` (the Ingress routes `/api` straight to the backend). | |
| C2 | Read the footer. | `ui` equals the image's `VITE_GIT_SHA` build arg and `api` equals `backend.gitSha`. | |
| C3 | Reload `/products/3`. | 200 through Traefik, and the page renders. | |
| C4 | Open `/api/docs`. | Swagger UI loads. | |
| C5 | Record and undo 5–10 movements during the HPA load window. | Every movement and undo succeeds. | |
| C6 | Record one OUT larger than on hand. | Grafana panel 10 moves (only once that deferred panel lands, B87). | |

## D. Demo day (T-3 h)

| # | Action | Expected | Result |
|---|---|---|---|
| D1 | Open `$APP_URL`. | The Stock page loads with the seeded rows. | |
| D2 | Read the footer. | Both SHAs equal the last `main` commit. | |
| D3 | OUT 20 on 'Reynolds pen (blue)', then Undo. | The bar flips green → amber, and back after the undo. | |
| D4 | Run the planner with the defaults. | Results in under 2 s. | |

## Run log

| Date | Commit | Where | Items | Outcome |
|---|---|---|---|---|
| 2026-10-15 | pre-commit tree on 04c78c3 | Vite dev server (StrictMode) and the production build on `nginxinc/nginx-unprivileged:1.30-alpine-slim` with `templates/default.conf.template`, each against (1) the real backend (its routers, `alembic upgrade head` and `python -m app.seed` on a scratch SQLite file, uvicorn on 127.0.0.1:18001) and (2) a stub of the Part C contract; driven by headless Chrome 155 at 375, 768, 1024 and 1440 px | A1–A6, plus the parts of B1–B6, B8, B9 and B11–B13 that need no compose stack | Passed in all four runs (308–309 automated checks each), with 0 console errors and 0 CSP violations. Lighthouse mobile through nginx: Performance 99–100, Accessibility 100, Best Practices 100 on `/`, `/planner`, `/ledger` and `/products`. |

Still open: re-run section A once on `make dev` (Postgres on 127.0.0.1:55433), now that LC-05 has landed.
