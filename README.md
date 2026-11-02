# Maa Baglamukhi Resort — Management System (MBR)

All-in-one resort/hotel management platform: front desk, restaurant & kitchen POS,
banquets, housekeeping, inventory, payroll/attendance, and a double-entry accounts
ledger — with live dashboards per role, thermal KOT printing, WhatsApp booking
confirmation, and PDF invoice generation.

```
MBR/
├── Maa-Baglamkhi-Resort-frontend/    React 19 + Vite SPA (port 5173)
└── Maa-Baglamkhi-Resort-Backend/     Node/Express + MySQL API & services (port 5002)
```

---

## Modules

| Module | What it does |
| --- | --- |
| **Hotel / Front Desk** | Room inventory & categories, new bookings (single/group), folios, advance payments, check-in/check-out, invoice generation (Print + Download PDF — one shared A4 document), WhatsApp confirmation on booking |
| **Restaurant POS / Dining** | Table & token orders, split bills, menu, waiter delivery queue, live kitchen board |
| **Kitchen / KOT** | KOT creation with sequential numbers (`KOT-0001`, `KOT-0002`, … after a reset), auto thermal printing, chef dashboard |
| **Banquet** | Halls, pricing plans, event bookings, banquet invoices |
| **Housekeeping** | Room status, assignments, shift roster, inspections, lost & found, amenity consumption, room costing |
| **Inventory** | Item masters, categories, units, locations, vendors, purchase orders, chef issues, stock ledger, waste log, procurement |
| **Accounts** | Double-entry ledger (transactions + entries + chart of accounts), bank reconciliation, petty cash, profit-center entries, customer invoices, GST returns; name/department grouping with a standard chart auto-seeded on boot |
| **Payroll & Attendance** | Employee masters, salary records, ZKTime device sync (`zk_*`), attendance pages |
| **HR / Assignments** | Task assignment & notifications to staff |
| **Reports & Audit** | Night audit snapshots, audit log, configurable reports, backup settings |
| **Print Management** | Central print queue, print logs, thermal/A4/restaurant printers |
| **Notifications** | In-app + WhatsApp gateway (WASachiva), booking auto-confirmation (text-only) |

Role-based dashboards: Admin, Manager, Reception, Staff, Chef, Housekeeping,
Kitchen, Restaurant, Waiter, Accounts — each renders its own home after login.

---

## Architecture

```
Browser (React SPA, 5173)
   │  REST  /api/*  ───────────────►  Express API (5002)
   │  Socket.IO (live KOT, boards)   │   ├── controllers (35 route modules)
   └──► Vite dev proxy /api, /socket ─┤   ├── services (print queue, WhatsApp,
                                       │    ZKTime sync, PDF generators, backups)
                                       └──► MariaDB/MySQL (resort_management1)
```

- **Frontend** — React 19, Vite, Tailwind CSS 4, Ant Design 6, react-router v7,
  socket.io-client, axios. JWT in `localStorage` + role-based route guards
  (`ProtectedRoute`, `RoleHomeRedirect`).
- **Backend** — Express 5, mysql2 (connection pool, schema bootstrap on boot),
  socket.io, pdfkit + pdf-to-printer (print pipeline), multer uploads,
  zkteco-js (attendance devices), helmet/rate-limit, JWT auth.
- **Realtime** — Socket.IO on the API port for KOT events, live board, waiter
  queues, housekeeping updates.
- **WhatsApp** — `wasachiva_key` gateway; booking confirmations are text-only,
  per-channel logging, admin notification via `ADMIN_WHATSAPP_NUMBER`/role lookup.
- **Invoices** — hotel invoice is one shared A4 document rendered by both
  "Print" and "Download PDF" (html2canvas → jsPDF), so the file always matches
  the printed sheet. Advances print the full GST Tax_Invoice design (no thin
  duplicates).
- **Accounts** — portable migrations: `ensureColumn` (SHOW COLUMNS pre-check)
  and `INSERT IGNORE` chart seeding, so upgrades never break a running install.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js 18+** | npm ships with it |
| **MariaDB/MySQL 10.4+** | XAMPP on Windows works: `C:\xampp\mysql_start.bat` |
| **Database** | `resort_management1` (name is per-PC, see `DB_NAME` in the backend `.env`). Bootstraps its own schema on first backend start |
| **Optional** | ZKTime device (IP in `.env`), Razorpay keys, WhatsApp gateway key, print server on Windows |

---

## Setup on any PC

```bash
git clone https://github.com/sachiva-agents/MBR.git
cd MBR

# 1. MariaDB: create the database once (skip if it already exists)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS resort_management1
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. Backend
cd Maa-Baglamkhi-Resort-Backend
npm install
# edit .env — at minimum: DB_NAME, DB_PASSWORD, JWT_SECRET
npm start            # or: npm run dev (nodemon, auto-restart)
# → API on http://127.0.0.1:5002  (schema self-bootstraps on boot)

# 3. Frontend (new terminal, from the repo root)
cd ../Maa-Baglamkhi-Resort-frontend
npm install
npm run dev          # → http://127.0.0.1:5173
```

Production: `npm run build` in the frontend, serve the dist folder; the backend
serves the API on 5002 (CORS via `CORS_ORIGINS`).

---

## Environment variables

### Backend (`.env` in `Maa-Baglamkhi-Resort-Backend/`)

| Key | Purpose |
| --- | --- |
| `PORT` | API port (default 5002) |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MariaDB connection |
| `DB_NAME_TEST` | Database used when `NODE_ENV=test` |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Auth tokens |
| `CORS_ORIGINS` | Allowed browser origins |
| `ALLOW_REGISTER` | Open registration (keep off in production) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Online payments |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `CLIENT_URL` | Google OAuth login |
| `ADMIN_WHATSAPP_NUMBER` | Booking admin notification fallback |
| `PUBLIC_BASE_URL` | Public base used when sending PDFs over WhatsApp (ngrok) |
| `wasachiva_key` | WhatsApp gateway bearer key |
| `AUTO_PRINT_ENABLED` + `PRINT_*` | Thermal printer settings (KOT, A4, restaurant) |

### Frontend (`.env` in `Maa-Baglamkhi-Resort-frontend/`)

| Key | Purpose |
| --- | --- |
| `VITE_API_BASE` | REST base — use **`http://127.0.0.1:5002/api`** (IPv4; `localhost` resolves to `::1` on Windows and the proxy fails) |
| `VITE_BACKEND_URL` | Socket/URL base — **`http://127.0.0.1:5002`** |
| `VITE_ADMIN_WHATSAPP_NUMBER` | UI-side WhatsApp number |
| `VITE_PUBLIC_BASE_URL` | Public base for shared links |

---

## Operating tools (backend)

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Run the API (dev = nodemon) |
| `npm run init` | Run schema bootstrap + seeds (`initialize.js`) |
| `npm run seed` | Seed demo/reference data |
| `npm run reset` | **Full data reset** — wipes all transactional data, keeps masters, auto-backup first, restarts every counter at 1. Interactive: type `RESET` |
| `npm run reset:dry` | Same report, changes nothing |
| `npm run repair:payments` | Reconcile payments vs. bills |
| `npm test` | API route + lifecycle + write-probe suites |

Reset flags: `--yes` (no prompt), `--no-backup`, `--clean-uploads` (delete
generated PDFs from disk). Full documentation:
[`Maa-Baglamkhi-Resort-Backend/src/tools/README.md`](Maa-Baglamkhi-Resort-Backend/src/tools/README.md).

After any reset: restart the backend so sequential KOT numbers
(`KOT-0001`, …) and the re-seeded standard chart of accounts take effect.

---

## Data & numbering

- Numbering restarts at **0001 after a reset**: invoice `HOTINV-YYYYMMDD-0001`
  (booking id), kitchen order `#1` (table id), KOT `KOT-0001` (order id).
- Generated PDFs land in `Maa-Baglamkhi-Resort-Backend/uploads/invoices/`
  and `src/uploads/invoices/` (gitignored).
- Resets create a local backup per PC (`data-reset-backup/`, gitignored) plus
  an in-database clone `mbb_backup_<timestamp>` when `mysqldump` is unavailable.

---

## Tests

- `Maa-Baglamkhi-Resort-Backend/test/` — API routes, lifecycle, write-probe
  suites (Jest + supertest). `DB_NAME_TEST` must point at a scratch database.
- `run-tests.sh` / `test-results/` at repo root — CI-style runner and last
  results.

---

## Troubleshooting (quick hits)

| Symptom | Fix |
| --- | --- |
| Frontend loads but every API call fails / routes bounce to login | MariaDB or the API isn't running, **or** the Vite proxy can't reach the API. Confirm `http://127.0.0.1:5002` answers, and that frontend `.env` uses `127.0.0.1`, never `localhost` (Windows IPv6 `::1` issue) |
| `ECONNREFUSED ::1:5002` in the Vite log | Same root cause — switch `.env` to `127.0.0.1` and restart Vite |
| API won't start: `Can't connect to MySQL` | Start MariaDB first (`C:\xampp\mysql_start.bat` or the mysql service) |
| `Field 'invoice_date' doesn't have a default value` on old installs | The portable migration in `InvoiceModel` fixes it on next boot — restart the backend |
| KOT still shows timestamp numbers after pulling | Backend process predates the change — restart it |
| Downloads/PDFs look clipped | Layout is fixed in the shared invoice document (`BookingFlow.jsx`); hard-refresh the browser after pulling |

---

## Project conventions (learned the hard way — keep them)

1. **Portable migrations only** — new columns use `ensureColumn` with a
   `SHOW COLUMNS` pre-check; seed rows use `INSERT IGNORE` against a unique
   key. Never raw `ALTER TABLE` / plain `INSERT` in boot paths.
2. **One shared invoice document** — hotel Print and Download PDF both render
   `buildHotelInvoiceDocument()`, so they can't drift apart.
3. **IPv4 loopback** — every frontend-facing URL uses `127.0.0.1`.
4. **No API-contract breaks on backend upgrades** — add columns/tables
   additively; keep response shapes stable.
5. **Backups before wipes** — the reset tool refuses to run without a backup
   unless you explicitly pass `--no-backup`.
