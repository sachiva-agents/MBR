# MBR Deploy Kit — Maa Baglamukhi Resort Management System

HAG-17 · round 4 · main @ commit containing this file. Companion doc: `SECURITY-DEPLOY.md` (what was hardened + threat notes).

## 1. Host requirements

| Component | Minimum | Notes |
|---|---|---|
| Node.js | 20 LTS+ | `npm ci` in `Maa-Baglamkhi-Resort-Backend` |
| Database | MariaDB 10.4+ (or MySQL 8+) | `explicit_defaults_for_timestamp=OFF` on MariaDB 10.4 is fine — schema-v4.sql + boot DDL are portable (TIMESTAMP NULL DEFAULT / SHOW COLUMNS pre-checks) |
| OS | Windows (XAMPP) or Linux | XAMPP on Windows: start with `C:\xampp\mysql_start.bat`; if the .bat doesn't stick, start `C:\xampp\mysql\bin\mysqld.exe --datadir=C:\xampp\mysql\data --basedir=C:\xampp\mysql --port=3306` directly |
| RAM/CPU | 2 GB / 1 vCPU | single-site resort load |

Frontend: `Maa-Baglamkhi-Resort-frontend` is Vite + React 19. Production build = `npm run build` → static files served by the reverse proxy (or any static host). No Node required on the frontend box.

## 2. Network topology (mandatory convention)

- **DB binds to 127.0.0.1 only.** `DB_HOST=127.0.0.1` (IPv4 loopback) — never a raw LAN IP. The API process and the DB live on the same host.
- **All external traffic goes through TLS at the reverse proxy.** The Express app is plain HTTP on `127.0.0.1:5002`; Nginx/Caddy terminates TLS on 443 and proxies to it.
- Frontend and API share the proxy origin → same-origin browser traffic → `CORS_ORIGINS` can stay empty (or list the domain anyway, additive).

### Nginx sketch

```nginx
server {
  listen 443 ssl;
  server_name resort.example;
  # ssl_certificate / ssl_certificate_key: your certs
  location / { root /var/www/mbr-frontend; try_files $uri /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:5002; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header Host $host; }
  location /uploads/ { proxy_pass http://127.0.0.1:5002; }
}
```

Set `PUBLIC_BASE_URL=https://resort.example` so invoice PDFs and WhatsApp attachment links use the public origin.

## 3. Fresh-DB bootstrap (one-time)

1. `CREATE DATABASE <DB_NAME> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. Copy `.env.production.example` → `.env`; fill every `(REQUIRED)` value (`DB_*`, `JWT_SECRET` — 64+ hex chars, `WHATSAPP_API_KEY` if WhatsApp is used, `CORS_ORIGINS` if any cross-origin caller).
3. `npm ci` in `Maa-Baglamkhi-Resort-Backend`.
4. `npm run init` — applies `schema-v4.sql` (81 tables + role seed) then bootstraps lazily-created tables (kitchen_orders, token_items, room_tariff, hotel_room_inventory, inventory family, …), migrated columns, and the 7 production roles. Idempotent; re-running is safe.
5. `npm start` (or under your service manager: `NODE_ENV=production PORT=5002 node index.js` as a systemd unit / scheduled task).
6. Login with the seeded user `admin@resort.com / password` — **immediately change that password** (Users screen or `UPDATE users SET password_hash=...`).

Boot-time DDL is fully additive (`CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`, SHOW COLUMNS-gated `ensureColumn`) — a running install re-boots cleanly with zero schema errors (verified on MariaDB 10.4, rounds 1–3).

## 4. Backup / restore runbook

Endpoints (admin-only): `GET /api/backups/settings`, `PUT /api/backups/settings`, `POST /api/backups/run`, `GET /api/backups/list`, `POST /api/backups/restore`.

- **Schedule**: `PUT /api/backups/settings` with `scheduleType`/`schedule` — the backup scheduler service runs in-process; no external cron needed.
- **Run**: `POST /api/backups/run` tries `mysqldump` in this order: `MYSQLDUMP_BIN` env override → known XAMPP bin dirs (Windows/macOS) → bare `mysqldump` on PATH. **If none exist (typical Windows box), it automatically falls back to an in-database clone** `mbb_backup_<stamp>` (CREATE DATABASE + CREATE TABLE LIKE + INSERT…SELECT with FOREIGN_KEY_CHECKS off) and records it in the same backup manifest. `GET /api/backups/list` shows both kinds (clones flagged `inDbClone: true`).
- **Restore**: `POST /api/backups/restore` with the file/clone name from `list`. Traversal-checked; refuses paths outside the backup dir.
- **Retention**: prune old `mbb_backup_%` schemas by hand (`DROP DATABASE mbb_backup_<oldstamp>`) — keep at least one 7-day-old clone plus any `.sql` dumps for off-host copies.

Off-site copy of `.sql` dumps (not in-DB clones) is recommended: a DB-level clone is only as safe as the DB itself.

## 5. Fresh-host smoke checklist

Run top-to-bottom after step 6 above; each check is a public-API call (token = JWT from `POST /api/auth/login` as the admin):

- [ ] `GET /api/health` → `{"status":"ok"}`
- [ ] `SHOW TABLES LIKE 'print%'` → `print_logs` + `print_queue` present at boot (HAG-16)
- [ ] `GET /api/backups/list` → 200 (admin token)
- [ ] `POST /api/backups/run` → 200; returns a `.sql` file **or** `inDbClone` (`mbb_backup_*`) — either is a PASS
- [ ] `POST /api/kitchen/order {table:"T1",waiter:"smoke",items:[{"name":"Water","qty":1,"price":50}]}` → 200 `kotNo: KOT-…`; then `GET /api/print/queue` → 200 (job `skipped` on a host without the KOT printer = expected, log shows `[HAG-13]` notice, no retry storm; set `KOT_PRINTER_NAME` to the real printer or `AUTO_PRINT_ENABLED=false` to quiet it)
- [ ] `GET /api/dashboard` → 200
- [ ] `GET /api/notifications` → 200
- [ ] `POST /api/auth/login` ×11 in a row from a non-local client → 429 after 10 (auth limiter active; local/test traffic is exempt)
- [ ] Browser: frontend loads, admin login works, room/booking/invoice screens render, one invoice PDF prints to the configured A4 printer
- [ ] PDF pipeline is FROZEN (HAG-14 round 3): if you re-run the PDF fingerprint suite after deploy, the canonical invariant is **`b4269542c26c3ecd33d4d1cffafe7f6a693f88c8467e7e76d7863a489685e9c1`** (the corrected ROUND3-QA constant, NOT the old `364fa75d`)

## 6. Operating notes

- **Printers absent?** `AUTO_PRINT_ENABLED=false` stops KOT auto-print entirely; A4/thermal jobs still queue. The poller marks unavailable jobs `skipped` after one attempt (no retry storm, one rate-limited admin notice).
- **WhatsApp gateway down?** Delivery degrades to text-failure + in-app admin notice; booking/invoice flows are not blocked.
- **ZK biometrics** off by default in `.env.production.example` (`ZK_AUTO_SYNC_DISABLED=true`); enable only with a device on the LAN.
- **Ops tooling**: Sentry (if wired in Settings), in-app admin notices for infra gaps (HAG-13), audit log (`audit_logs`, gated writes — a missing `response_body` column is healed at boot, not by hand).
