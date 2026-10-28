# HAG-123 — POST /banquet 500: gate-verify

**Verdict:** No code defect in the handler. The reported 500 is an environmental symptom of
MySQL (XAMPP) being down; with the DB up the endpoint returns 201 for a full booking and the two
edge cases behave. The arity concern in the card is already resolved (33/33/33, fixed in 7e5b098).

## What I checked

- **Arity:** `createBanquetBooking` INSERT in `src/controller/banquetBookingsController.js` lists
  33 columns, 33 `?` placeholders, 33 bind values. Balanced. Nothing to fix.
- **Column existence:** every INSERT column (`email`, `guest_count`, `menu_package`, `event_date`,
  `subtotal`, `total`, `balance`, `payment_*`, `refund_amount`, `net_received`, `billed_at`,
  `created_by`, …) exists on the live `banquet_bookings` table in `resort_management`. Verified via
  `SHOW COLUMNS`. The `banquetMigrations` block in `banquetRoutes.js` adds the v4 financial columns
  on boot.
- **Live behaviour (DB up):** I started XAMPP MySQL (was not running — port 3306 closed, and every
  :5002 endpoint including `/api/auth/login` was returning 500 because the pool couldn't connect).
  After MySQL came up, against the running :5002 backend on tree `/Users/apple/Documents/agents/resort`
  (banquet controller is byte-identical to the worktree):
  - Full booking payload → `HTTP 201 {"id":141}`
  - Minimal required-only payload → `HTTP 201 {"id":142}`
  - Zero guests / no financials → `HTTP 400 Required fields missing` (validateBookingPayload guard)
- **Root cause of the QA 500:** With MySQL stopped, `db.query` in the try-block rejects, the
  controller's catch returns 500 on *every* route. So the banquet 500 is a global DB-down
  condition, not a banquet-specific bug.

## Probe cleanup

Two rows created during verification, both deleted, confirmed absent:
- `id 141` (HAG-123 Probe), `id 142` (HAG-123 Min) — `DELETE ... WHERE customer_name LIKE 'HAG-123 %'`
  → 1 row each; re-query returns 0.

## For the floor

- The fix is "none" — nothing to commit. Close the card on this gate-verify trail.
- If a future 500 reproduces **with MySQL confirmed up**, that is a different bug: re-open and capture
  the `console.error("createBanquetBooking error:", ...)` line from the backend log — that string is
  the only thing that distinguishes a real handler fault from a DB-down symptom.
