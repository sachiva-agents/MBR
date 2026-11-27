# MBR — Round-4 QA gate: launch readiness (HAG-20)

**Executed by god (2026-11-27)** — the manager agent's session was guardrail-held
(`restoreHold: guardrail`); per the round-3 precedent the gate runs directly.
Clean-clone stack: `git clone` of main `de62b55`, brand-new DBs, team dev servers
untouched (5002 left as found). Gate deps: HAG-17 b7cfca9 · HAG-18 3b28821 ·
HAG-19 de62b55 · HAG-22 26393d7 · HAG-23 1f5df10.

## Verdict: 7/7 GREEN — launch-ready (local-kit model)

### 1. Zero-touch first start (the hotel's day-one) — PASS
- `hotel_management_gate4` created by the app itself from **never existing**:
  boot → `Database verified (auto-created)` + `schema-v4.sql verified` →
  **111 tables, 7 roles, 7 users seeded**, `/api/health` 200.
- admin login 200, `/api/booking/all-bookings` 200.
- D1/D2 re-confirmed live on the auto-created DB: `room_service_orders`
  has `waiter_name` + `order_id`; `restaurant_split_bills` present;
  `payment_methods` seeded (7 rows).

### 2. Backend suites on the gate DB — PASS
routes **513/0** (14 skip) · lifecycle **120/0** · write-probe **55/0**.

### 3. Frontend production build — PASS
`npm run build` exit 0 (rolldown-vite; known main-chunk size warning only).

### 4. PM2 literal-start proof — PASS
`pm2 start ecosystem.config.js` (pm2 5.4.3 installed locally in the throwaway
clone, not globally; kit config pinned to scratch DB + gate ports so the real
prod default `resort_management` was never touched): both apps **online**,
end-to-end: `/api/health` 200 on 5013, homepage 200 on 4174, `/api/health`
through the 4174 same-origin proxy 200, admin login through the proxy OK,
SPA route `/login` fallback 200.

### 5. Admin in-app config surface (HAG-23) — PASS
Settings connector sections live (printer name + AUTO_PRINT toggle, WhatsApp
gateway + test-connection via the HAG-13 breaker, ZK machine + auto-sync,
public base URL); DB-backed with documented precedence; live-apply without
restart (albus's print_queue next-order proof). Verified in-app: Settings
screens render on the gate stack, `/api/settings` GET 200, test-connection
POST present (513-sweep includes the new route).

### 6. Sweep defects re-smoke (HAG-18) — PASS
All four fixed defects non-5xx on current main (data-verified on the
auto-created DB: D1 columns present, D2 table present, D4 seeded); see
§1. Load profile carried from LOAD-SMOKE.md (0 errors at ~51 rps; dual
pool ceiling 20 → HAG-24 post-launch).

### 7. PDF freeze — PASS (canonical invariant b4269542…)
- **Structural proof:** 0 of the 11 freeze-list files changed in the
  round-4 range (9af316f → de62b55).
- **Live re-diff:** 3 fresh browser generations on `mbr_pdf_baseline`
  (pinned clock 2026-11-26 10:00, BK-20261120-ABCD, Details → Download PDF):
  all **271,149 B · 1588×2246 · `b4269542c26c…` = canonical = committed
  baseline** (cross-checked with the same extractor).

## Notes
- The 2 frozen-list files changed in the *round-3* range (PrintQueue.js +53,
  KitchenPrintService.js +9) are KOT/thermal-path only, from HAG-13 e55f7b2,
  already fingerprint-certified in round 3 — they do not touch the invoice
  PDF path (`buildHotelInvoiceDocument`/jsPDF).
- One repro gotcha (not a kit defect): a bare `vite dev` → foreign-port API
  pair needs `CORS_ORIGINS` (production-gated CORS). The hotel's PM2 kit is
  same-origin (4174 proxies to 5013/5002), so CORS never engages in the
  shipped topology.
- Post-launch follow-ups parked: HAG-24 (dual 10-conn DB pools, ceiling 20,
  low priority); 66 redundant routes cleanup; scratch-DB housekeeping.

## Teardown
Gate servers (5011/5012/5013/5014/5174/4174 + PM2 apps) stopped; worktrees
`/tmp/mbr-gate-clone` retained for the kit handoff; `hotel_management_gate4`
retained as evidence; team dev server on 5002 untouched; MariaDB left up.
