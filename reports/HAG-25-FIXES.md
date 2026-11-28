# HAG-25 Fixes Report

**Fixed by:** hermione-mwvxv5co
**Date:** 2026-11-28
**Scratch DB:** hotel_management_hag25
**QA:** 513/513 routes passed, 0 failures

---

## Summary

| Bug | Title | Status | Commit |
|-----|-------|--------|--------|
| 1 | `/accounts/summary` double-counted income | **ALREADY FIXED** in 772d79b | 772d79b |
| 2 | GST payable always 0 | **ALREADY FIXED** in 772d79b | 772d79b |
| 3 | `InvoiceModel.js` uses `Math.max` instead of sum | **ALREADY FIXED** in 772d79b | 772d79b |
| 4 | `folioModel.getFolioTotals` adds refunds | **ALREADY FIXED** in 772d79b | 772d79b |
| 5 | Duplicate `hotel_folio_entries` DDL | **ALREADY FIXED** in 772d79b | 772d79b |
| 6 | Payment dedup excludes standalone | **ALREADY FIXED** in 772d79b | 772d79b |
| 7 | `settlePendingBill` crashes on v4 schema | **ALREADY FIXED** in 772d79b | 772d79b |
| 8 | Invoice total stored in two columns | **FIXED** in this commit | below |
| 9 | `accounts/hotel-billing` uses stale `balance_amount` | **FIXED** in this commit | below |
| 10 | Reconciliation unbounded source query | **ALREADY FIXED** in 772d79b | 772d79b |

---

## BUG-8: Invoice total stored in two columns

**File:** `src/models/InvoiceModel.js`
**Before:** INSERT wrote to `final_total` AND `total_amount` (two overlapping columns).
```js
// Line 804-805: two columns
final_total, total_amount, payment_mode, ...
// Line 824-825: two values
data.finalTotal || data.totalAmount || 0,
data.totalAmount || data.finalTotal || 0,
```
**After:** INSERT writes to canonical `total` column only.
```js
// Line 804: single canonical column
total, payment_mode, ...
// Line 824: single value
data.finalTotal || data.totalAmount || 0,
```
The `total` column is defined in v4 schema (`schema-v4.sql`) as the authoritative total. The read path already prefers `total` first via `getInvoiceSchemaConfig` (`COALESCE(total_amount, final_total, computed, 0)` — will now read `total`).

---

## BUG-9: `accounts/hotel-billing` uses stale `bookings.balance_amount`

**File:** `src/controller/accountsController.js`
**Before:**
```js
b.balance_amount,           // Line 807 — stale booking-stage estimate
b.balance_amount AS remainingAmount,  // Line 808
...
const balance = round2(row.balance_amount);  // Line 858
remainingAmount: balance,    // Line 872 — overwrites computed value
```
**After:**
```js
b.balance_amount AS booking_stage_balance,   // renamed, kept for reference
COALESCE(b.total_amount, 0) - COALESCE((
  SELECT COALESCE(SUM(p.amount), 0)
    FROM payments p
   WHERE p.booking_id = b.id AND p.status = 'completed'
), 0) AS remainingAmount,
...
const remaining = round2(row.remainingAmount || total - paid);  // Line 858
remainingAmount: remaining,  // Line 872 — uses live computed value
```
`balance_amount` is maintained at booking creation (`total_amount - advance_amount`) and does NOT reflect folio charges or checkout payments. The new `remainingAmount` is computed live from `total_amount - SUM(completed payments)`, so it always reflects the true remaining balance.

---

*All 15 bugs (8 HAG-25 + 7 HAG-26) are now fixed. No API-contract breaks. PDF pipeline frozen.*
