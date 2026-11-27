# MBR — Install & Run (zero-config first start)

Maa Baglamukhi Resort Management System. Ships as files to any hotel's local
computer; runs on that computer's local IP under **PM2**. No cloud hosting,
no hand-edited `.env`, no pre-created database.

## Prerequisites (the only external dependencies)

1. **Node.js 20 LTS or newer** — https://nodejs.org (check: `node -v`)
2. **MariaDB 10.4+ or MySQL 8+ installed and running** with the default local
   setup (`root` user, empty password, reachable on `127.0.0.1:3306` —
   stock XAMPP/official-installer behaviour). That's it — nothing else.

## One command

| OS | Command |
|---|---|
| Windows (target) | `start.bat` (double-click) |
| Linux / macOS | `bash start.sh` |

The script:

1. Installs the backend's npm dependencies (first run only).
2. Builds the frontend `dist/` (first run only; it ships prebuilt, so this
   is usually a no-op).
3. Installs PM2 globally (first run only), then runs
   `pm2 startOrReload ecosystem.config.js` and `pm2 save`.

## What happens on first start (zero-config)

- **Database** `resort_management` is created automatically
  (`CREATE DATABASE IF NOT EXISTS … utf8mb4`) — including on the plain
  `npm start` / `pm2 start` path, not only via `npm run init`.
- **All 81+ tables** are created (`schema-v4.sql` + boot-time lazy DDL),
  idempotent — every statement is an `IF NOT EXISTS` / `INSERT IGNORE` /
  `SHOW COLUMNS` pre-check, so re-boots never drop or alter anything.
- **Admin is auto-seeded**: `admin@resort.com / password` plus 6 staff
  accounts (manager, reception, accounts, housekeeping, waiter, kitchen) and
  the 7 production roles.
- **JWT secret**: if `JWT_SECRET` is unset or empty, the app **auto-generates
  a 64-char hex secret and persists it into `Maa-Baglamkhi-Resort-Backend/.env`**
  so it survives restarts. The console says so explicitly. **Change it before
  going live** (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
  An *explicitly set* `JWT_SECRET` is never overwritten.
- **`npm run init` stays idempotent**: re-run any time; on a working install
  it is a full no-op (all pre-checks pass, nothing written).

## Expected result

- Open **`http://localhost:4173`** on that PC, or
  **`http://<the PC's LAN IP>:4173`** from any phone/LAN device
  (the static server binds `0.0.0.0` on purpose, so LAN devices reach it;
  find the IP with `ipconfig` on Windows / `ip a` on Linux).
- Log in with **`admin@resort.com / password`** — the full system is
  usable immediately: books rooms, takes bookings, runs restaurant /
  kitchen / inventory / accounts.
- The frontend is served by a small built-in static server that proxies
  `/api` and `/socket.io` to the backend on `127.0.0.1:5002`, so there is a
  **single URL** to open and no CORS to configure (same-origin).

## After first start — in-app configuration

An admin configures the rest in the app's **Settings / admin screens**
(the in-app config surface is being built in **HAG-23**):

- **Printers** — point the KOT / A4 / thermal printers at real printer names
  (`KOT_PRINTER_NAME`, `KITCHEN_PRINTER_NAME`), or switch KOT auto-print
  off entirely (`AUTO_PRINT_ENABLED=false`). With no printer present the
  print queue degrades gracefully: jobs are marked `skipped`, one in-app
  admin notice fires, no retry storm.
- **Attendance machine** — ZK biometric device sync (`ZK_AUTO_SYNC_*`);
  off by default until a device is wired to the LAN.
- **WhatsApp / Wasachiva key** — invoice + booking-confirmation delivery
  (`WHATSAPP_GATEWAY_URL` / `WHATSAPP_API_KEY`). Without it, sends degrade
  gracefully and log in-app notices.
- **Connectors / business details** — name, contact, public URLs.

All of these are also settable by editing `Maa-Baglamkhi-Resort-Backend/.env`
and `pm2 restart all` — but the promise is that first start needs **none**
of that.

## Operations

```
pm2 list                 # status
pm2 logs                 # tail both apps
pm2 restart all          # after editing .env
pm2 stop all             # stop
pm2 save && pm2 startup  # optional: auto-start the stack when the PC boots
```

Logs land in `<repo>/logs/*.log`. Full host/backup/upgrade runbook:
`reports/DEPLOY.md`; security posture & threat notes: `reports/SECURITY-DEPLOY.md`.

## Notes & limits

- **PDF pipeline is frozen** (QA rounds 1–3): the invoice/receipt document
  rendering, templates, and jsPDF paths must not be modified. Canonical
  fingerprint invariant: `b4269542c26c3ecd33d4d1cffafe7f6a693f88c8467e7e76d7863a489685e9c1`
  (do NOT reference the old `364fa75d…` value superseded in round 3).
- The backend API is intentionally plain HTTP on `5002`; on a hotel LAN that
  is the deployment model. If a site later needs TLS, put a reverse proxy
  (nginx/caddy) in front of `4173`/`5002` — no code changes required.
- Backups: `POST /api/backups/run` (admin) — dumps via `mysqldump` when
  available, otherwise an in-database clone `mbb_backup_<stamp>`
  (runbook in `reports/DEPLOY.md`).
