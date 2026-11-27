# HAG-23 — In-app admin config surface (printer / ZK / WhatsApp / connectors)

**Date:** 2026-11-27 · **Repo:** `X:/agent/MBR` · **Base:** main `3b28821` (post HAG-18/22)
**Verified on:** scratch DB `hotel_management_hag23` (never the prod `resort_management1`).

## What was audited (existing mechanism, not duplicated)

- A settings mechanism **already exists**: `app_settings` single-row table +
  `settingsController.js` (portable per-column migration, admin-gated
  `PUT /api/settings`, open `GET`) + the admin-only `Settings.jsx` screen.
  This change **extends it** — no second config store, no new screens besides
  the sections added to `Settings.jsx`.
- ZK **machine** config (IP/port/credentials, test-connection, sync) was
  **already in-app** (`zkRoutes.js` CRUD + `POST /machines/:id/test-connection`,
  admin-gated, UI on `/zk-attendance`). Only the auto-sync **scheduler**
  (enabled / interval / window) was env-only — now in-app too; the Settings
  section links to `/zk-attendance` for the machines themselves.
- `models/settingsModel.js` is dead code (no `require` anywhere); left alone.
- The WhatsApp "test connection" button exercises the **HAG-13 circuit
  breaker** via a new side-effect-free `whatsappService.testGatewayConnection()`.

## New files / changed files

| File | Change |
| --- | --- |
| `src/services/dynamicSettings.js` (new) | DB-backed config reader with a live in-memory snapshot; **documents the precedence in one place** (`app_settings` DB → `.env` → default); portable migration (CREATE superset + per-column ALTER, handles the key/value legacy table shape); sync accessors for the print path; `refresh()` re-reads the DB and re-patches `PrintConfig` so saved values apply without a restart. |
| `src/controller/settingsController.js` | +8 connector fields to the portable migration, GET response (merged `getConnectorSettings()`, API key redacted), PUT allow-list + validation (URL shape, 1–1440 / 1–168 ranges, ≤120-char printer name); empty value clears the column (falls back to env); redacted-key echo guard (never writes the preview back); `testConnection` handler. |
| `src/routes/settingsRoutes.js` | +`POST /settings/test-connection` (admin-gated, like every settings write). |
| `src/services/whatsappService.js` | Gateway URL + key now resolved live (`dynamicSettings`) at send time; `testGatewayConnection()` routes through the HAG-13 breaker — a dead gateway trips it + fires the one rate-limited admin notice, an open breaker short-circuits; never sends a message. |
| `src/services/printerAvailability.js` | `isAutoPrintEnabled` reads the live DB-backed flag; admin notice now points at Settings → Printers. |
| `src/services/zkAutoSync.js` | Fixed 60 s **heartbeat** that re-reads live settings each tick — the disabled flag, interval and window all apply without a restart. |
| `src/app.js` | `initializeDatabase` bootstraps `app_settings` (+connector columns) at first start — zero-config. |
| `index.js` | Primes `dynamicSettings.refresh()` at boot before the print queue / ZK scheduler start. |
| `frontend/src/pages/Settings.jsx` | New connector sections (Kitchen printer + auto-print toggle; WhatsApp gateway URL + key + **Test connection** button with result banner; ZK auto-sync enabled/interval/window + "Manage machines →" link; public base URL), matching the existing card/input styling of `BackupSettings.jsx` (HAG-12 reference). |
| `.env.production.example`, `README.md` | Operator-facing precedence note + `(IN-APP)` markers on the connector variables; host-fixed vars explicitly marked not in-app configurable. |

## Precedence (documented in `dynamicSettings.js`, mirrored in `.env.production.example` + README)

1. **`app_settings` DB value** (admin's most recent in-app save) — wins when the column holds a non-NULL value.
2. **`.env` value** (each key's documented override order, e.g. `WHATSAPP_GATEWAY_URL` → legacy `wasachiva_url`).
3. **Built-in default**.

Leaving a field blank in the UI clears the DB column → falls back to `.env`/default.

## What applies live vs. what would need a restart

| Setting | Applies without restart? |
| --- | --- |
| KOT printer name | **Yes** — save re-patches `PrintConfig` + the printer-availability cache; next queued job uses it (verified: saved name `kitchen-hag23-probe` appeared in `print_queue.printer_name`). |
| Auto-print toggle | **Yes** — read live by the queue gate and `autoPrintKOT`. |
| WhatsApp gateway URL + API key | **Yes** — resolved live at every send; test-connection probes the live value. |
| ZK auto-sync enabled / interval / window | **Yes** — 60 s heartbeat re-reads live settings. |
| Public base URL | **Yes** — all 4 PDF/attachment link sites (banquet, restaurant, booking, invoice WhatsApp controllers) now check the live DB value first, then the `PUBLIC_BASE_URL`/`PUBLIC_URL`/`CLIENT_URL` env fallbacks. |

So **every** connector value on the Settings surface applies without a restart.

UI note: the WhatsApp API key is stored in the DB row; the GET surface returns a
**redacted preview** (`wsk_…6789 (32 chars)`) and the PUT handler ignores
redacted previews so the Settings form's full-object PUT cannot clobber the
real key.

## Verification (scratch DB `hotel_management_hag23`, server on :5014, prod never touched)

- Boot auto-created `app_settings` with all connector columns; `GET /settings`
  returns every connector field resolved by precedence (DB→env→default).
- Save flow: `PUT /settings` (all 8 connector values) → 200; GET shows the saved
  values; redacted-echo PUT did **not** clobber the key (still
  `hag23-dummy-key-abcdef0123456789` in the DB row).
- **Test connection** against the dead gateway saved in the DB
  (`http://127.0.0.1:59999`): `{"status":"unreachable","reachable":false,
  "error":"connect ECONNREFUSED 127.0.0.1:59999"}` + breaker open + one
  rate-limited admin notice — the HAG-13 path exercised from the UI button.
- KOT order after the save: job stored `printer_name=kitchen-hag23-probe`
  (the saved DB value, not `.env`'s `kitchen`), status `skipped` retries 0.
- ZK heartbeat log line confirms live-config read: "60s heartbeat honoring
  Settings (currently every 5 min, window 2 h)" after the save.
- PDF pipeline **frozen**: the diff touches none of
  `buildHotelInvoiceDocument` / html2canvas / jsPDF / invoice templates /
  `InvoicePdfService` / `ThermalPrintService` / print-queue ordering
  (checked `git diff --name-only` against the freeze list).

### Suites (0-fail)

| Suite | Result |
| --- | --- |
| `test/api-routes.test.js` | **513 pass / 0 fail** (512 baseline + the new `/settings/test-connection` route auto-swept in) |
| `test/lifecycle.test.js` | **120 pass / 0 fail** |
| `test/write-probe.test.js` | **55 pass / 0 fail** |

Frontend: `npm run build` green (vite, 4.87 s).

## Boundaries honored

- Additive API only: new columns, one new admin POST route, extended PUT
  allow-list; nothing removed or contract-broken (`GET /settings` gains keys,
  existing ones unchanged).
- Admin role gate on every write (`PUT /settings`, `POST /settings/test-connection`
  both `roleMiddleware(["admin"])`).
- No new env-var requirements — every new variable is optional and falls
  through to the existing ones.
