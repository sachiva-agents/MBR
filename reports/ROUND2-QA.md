# MBR Round-2 QA Gate (HAG-8)

**Date:** 2026-11-26 · **Run by:** manager (manager-mwx5ct2r) · **Repo @ main `f1f071c`**

**Verdict: GREEN — round 2 closes.** All four gate steps passed; the frozen PDF
pipeline produced a byte-identical image raster to the committed baseline.

## Gate inputs

- Blockers cleared: HAG-9 (PDF baseline, main `f1f071c`) + HAG-10 (S-1 socket
  listener, main `d67b54d`). No other source changes since round-1 main `d35dd73`.
- Scratch stack reused from ada: MariaDB 10.4 :3306, backend :5002 on
  `mbr_pdf_baseline`, Vite :5173. Prod DB `resort_management1` never touched.

## Step 1 — backend suites (npm test, scratch stack)

| Suite | Result |
| --- | --- |
| API route sweep (read-only, 520 unique routes discovered) | **512 pass / 0 fail / 14 skip** |
| Lifecycle (create→read→update→delete, 8 domains) | **120 pass / 0 fail** |
| Write-path probe | **55 pass / 0 fail** |

`npm test` exit 0. Identical to ron's HAG-6 clean-DB re-verify numbers
(512/120/55) — zero regressions.

## Step 2 — frontend production build

`npm run build` (rolldown-vite): **exit 0**, built in ~4.1 s. No new warnings
beyond the known chunk-size note (main chunk 3.55 MB raw / 851 kB gzip —
parked from round 1, non-blocking).

## Step 3 — E2E smoke (login → KOT → booking → invoice)

| # | Step | Result |
| --- | --- | --- |
| 1 | `POST /api/auth/login` admin@resort.com | 200, role=admin |
| 2 | `POST /api/kitchen/order` (T-8) | 200, **KOT-0005** |
| 3 | `POST /api/booking/guest` | 200, booking 8 **BK-20261126-6290** |
| 4 | `GET /api/invoices/8` | 200, **HOTINV-20261126-0008** |
| 5 | `GET /api/invoices/8/pdf` | 200 `application/pdf`, 2,989 B, valid 1-page PDF |

S-1 check: the fix commit only added the `room-order-status` listener to the
waiter delivery queue (`WaiterDeliveryQueue.jsx` +36); waiter flows are
unaffected and the smoke walk succeeded.

## Step 4 — PDF freeze diff (hard constraint)

Baseline reference: `reports/pdf-baseline/BASELINE.md` @ `f1f071c`
(captured @ `d67b54d` — byte-equivalent pipeline to `d35dd73`).

Regenerated per the BASELINE.md recipe (deterministic booking
`BK-20261120-ABCD` on `mbr_pdf_baseline`, pinned clock 2026-11-26 10:00,
two clicks / steady-state download, Playwright chromium headless):

| Invariant | Baseline | Regenerated | Match |
| --- | --- | --- | --- |
| DCTDecode image-stream fingerprint | `364fa75dfe38eca8bccaf0d59b7293bf9ed264272362b4058cbe47784f3c1ea8` | `364fa75d…` (identical) | ✅ |
| Embedded image /Length | 267,785 | 267,785 | ✅ |
| Page count | 1 | 1 | ✅ |
| Image dims | 1588 × 2246 | 1588 × 2246 | ✅ |
| PDF size | 271,149 B | 271,149 B | ✅ |

Raw PDF sha256 differs (`ce2bac30…` vs `0a762991…`) — **expected and not a
diff target**: jsPDF 4.2.1 embeds a random `/ID` + run-time `/CreationDate`
(documented in BASELINE.md). The layout-relevant invariant — the html2canvas
raster of `buildHotelInvoiceDocument` output — is **bit-identical**.

**Freeze commits reviewed:** `35ac681` (audit, report-only), `d67b54d` (S-1,
1 frontend file, no PDF/invoice/print/template code), `f1f071c` (baseline
artifact + notes). No commit in round 2 touched `buildHotelInvoiceDocument`,
the html2canvas/jsPDF path, print queue services, or invoice templates.

## Environmental notes (non-blocking, carried from round 1)

- No `kitchen` thermal printer on this host → KOT auto-print retry loop keeps
  failing (infra, not code; parked in `FINAL-COMPLETION.md`).
- Wasachiva WhatsApp gateway unreachable → booking auto-confirm 500 with text
  fallback unavailable (host infra; parked).
- Neither leg blocks any core flow; booking/KOT/invoice records all persist.

## Blockers

None.

## Artifacts left behind (scratch)

Smoke rows on `mbr_pdf_baseline`: KOT-0005, booking 8 / BK-20261126-6290,
invoice HOTINV-20261126-0008 + its backend-generated PDF in `uploads/invoices/`.
Regenerated invoice kept at gate-tools `out/regen-invoice.pdf` (scratch
worktree) — not committed.
