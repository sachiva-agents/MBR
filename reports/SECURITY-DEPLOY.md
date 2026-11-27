# MBR Security Hardening + Deploy — what changed, threat notes

HAG-17 · round 4 · companion to `DEPLOY.md`. Code changes are additive; the API contract is unchanged (no endpoint removed or reshaped); the PDF pipeline is untouched (frozen, invariant `b4269542…5e9c1`).

## 1. What was already in place (verified, not re-done)

| Area | Status | Where |
|---|---|---|
| JWT secret env-sourced | `getJwtSecret()` reads `process.env.JWT_SECRET` per request and **throws at sign/verify if empty** — no hardcoded secret anywhere in `src/` (grep-verified). The `.env` value is the only source. | `src/config/security.js:108-116`, `src/middleware/authMiddleware.js` |
| DB creds env-driven | `databaseConfig.js` resolves `DB_HOST` (default `127.0.0.1`), `DB_PORT`, `DB_USER`, `DB_PASSWORD` (default empty), `DB_NAME` from env only. Safe loopback defaults; nothing baked into code. | `src/config/databaseConfig.js` |
| CORS locked to configured origin | In `NODE_ENV=production`, an empty `CORS_ORIGINS` list blocks ALL cross-origin browser callers (the localhost/private-LAN dev auto-allow is production-gated off). `CORS_ORIGINS`/`CORS_ORIGIN` replace the dev list; `CORS_ALLOW_LOCAL` explicitly re-enables LAN. | `src/config/security.js:19-76`, `src/app.js:65-75` |
| Security headers | `helmet()` on every response (HSTS enabled in production), plus `Cache-Control: no-store` on `/api`. | `src/app.js:68-80` |
| Auth rate limiting | `authRateLimiter` on `POST /api/auth/login` + `/register`: 10 attempts / 15 min per external client, `skipSuccessfulRequests`, local + test traffic exempt. | `src/config/security.js:133-146`, `src/routes/authRoutes.js:7-8` |
| No debug/diag endpoints | No `router.*` route in `src/routes` or `app.js` exposes debug/diagnostic/dump internals (`/print/test`, `/zk/machines/:id/test-connection` are functional feature endpoints, role-gated). | grep-verified |
| Upload path traversal | `/uploads` static dir + backup restore are path-checked. | `src/app.js:86`, `backupController` |

## 2. What this card added

### 2.1 Code (main)

- **Token-route rate limiting** — new `tokenRateLimiter` in `src/config/security.js` (`TOKEN_RATE_LIMIT_WINDOW_MS` default 15 min, `TOKEN_RATE_LIMIT_MAX` default 120), same local/test exemption logic as the auth limiter, mounted on the authenticated token router (`src/routes/tokenRoutes.js`). Protects the restaurant token create/close write surface against external brute-force/flood while leaving dev + the test suite unthrottled.
- **`.env.production.example`** — full variable table (DB, JWT, CORS, rate limits, `AUTO_PRINT_ENABLED`, `KOT_PRINTER_NAME`/`KITCHEN_PRINTER_NAME`, `WHATSAPP_GATEWAY_URL`/`WHATSAPP_API_KEY` + legacy `wasachiva_*`, ZK sync, `MYSQLDUMP_BIN`/`MYSQL_BIN`, public URL) so a fresh host has one authoritative, documented config surface.

### 2.2 Artifacts (reports/)

- `reports/DEPLOY.md` — host requirements, TLS/reverse-proxy topology, fresh-DB bootstrap via `npm run init`, backup/restore runbook incl. the in-DB-clone fallback, fresh-host smoke checklist.
- `reports/SECURITY-DEPLOY.md` — this file.

## 3. Threat notes (residual risk, by priority)

1. **Secrets at rest** — `.env` holds `JWT_SECRET`, `WHATSAPP_API_KEY`, DB creds. Keep it `chmod 600`, off-version-control, off-backup-targets, and outside the proxy web root. Rotate on any suspected leak: JWT rotation instantly invalidates all sessions (by design); the Wasachiva key rotates in the gateway.
2. **DB exposure** — the hard requirement is `bind-address=127.0.0.1` on the MariaDB/MySQL instance (not just `DB_HOST` in our app). A DB reachable on the LAN defeats every app-side control. Verify with `ss -ltnp` on the host.
3. **Root DB user** — the safe default is `root`/empty password. Production MUST use a least-privilege app account with grants on the schema only: `GRANT ALL ON resort_management.* TO 'mb_app'@'localhost'`.
4. **JWT 7-day lifetime** — acceptable for a single-site intranet/HTTPS app, but pair with the logout/audit story: a stolen token stays valid up to 7 days. Shorten `JWT_EXPIRES_IN` if threat posture changes; it is env-driven, no code change.
5. **In-DB backup clones** — `mbb_backup_*` schemas live inside the same MariaDB instance and inherit its credentials. They are NOT a substitute for off-host/off-server copies of `.sql` dumps; treat clones as rapid-recovery only.
6. **Rate limiter memory store** — `express-rate-limit`'s default in-memory store works for a single process; it does NOT span horizontally-scaled replicas or survive a restart. MBR is a single process (that is the deployment model), so this is correct today; if you ever scale out, swap in a shared store (e.g. Redis).
7. **`/uploads` static serving** — invoice PDFs and photos are served to anyone who knows the path (public by design for invoice download links). Do not put auth-only content in `uploads/`.

## 4. Verification

- All suites re-run on a fresh scratch DB after the code change: routes 512 pass / 0 fail / 14 skip, lifecycle 120/0, write-probe 55/0 — **0 new failures**. The token limiter's local/test exemption keeps every suite + localhost UI path unthrottled (external clients get 120/15min).
- `git show` of the commit touches only: `src/config/security.js`, `src/routes/tokenRoutes.js`, `.env.production.example`, `.gitignore` (one negation line so the example file is tracked while real `.env` secrets stay ignored), `reports/DEPLOY.md`, `reports/SECURITY-DEPLOY.md`. **Zero** PDF-pipeline files (frozen), zero controller/endpoint shape changes.
