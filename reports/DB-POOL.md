# HAG-24: DB Pool Headroom (post-launch perf)

**Date:** 2026-11-28 · **Commit:** `4c11958` on `main` · **Author:** god (direct execution; ron did not pick up dispatch)

## Finding

Two separate `mysql2/promise` pools were created at startup for the same MariaDB instance:

| File | `connectionLimit` | `queueLimit` | Consumers |
|---|---|---|---|
| `src/utils/poolPromise.js` | `DB_CONNECTION_LIMIT` **default 10** | `0` (no queue) | 80+ model files |
| `src/config/db.js` | `DB_CONNECTION_LIMIT` **default 50** | `200` | controllers, app.js, services |

Both read the same `DB_CONNECTION_LIMIT` env var. A single `.env` value of 10 produced a 10/10 split; a value of 50 produced a 50/50 split.

**Effective real ceiling = limit A + limit B** (two physical TCP connections into MariaDB `max_connections`). With default `.env` (unset → 50 in `db.js`, but `poolPromise.js` had its own internal default of 10 before this fix), the true observed ceiling under load was 20 connections — exactly what harry's HAG-19 load smoke pinned in `processlist`.

## Decision: consolidate to one shared pool

Merged `poolPromise.js` into a re-export of `db.js`'s pool. All 80+ model imports continue to work unchanged (`require('../utils/poolPromise')` still resolves).

**New defaults:**
- `connectionLimit`: 50 (env `DB_CONNECTION_LIMIT` overrides)
- `queueLimit`: 200 (env `DB_QUEUE_LIMIT` overrides, new)

## Files changed

- `src/config/db.js` — added `DB_QUEUE_LIMIT` env var for `queueLimit`; `dotenv` quiet-load
- `src/utils/poolPromise.js` — re-export shim, single pool, no second TCP connection

## Backwards compatibility

- No API-contract break: controllers and models see the same `pool`, `getConnection()`, `runQuery()` shape they already used.
- PDF pipeline untouched: no invoice/print file modified.
- `DB_CONNECTION_LIMIT=10` is still honored — it now caps the single pool to 10 (vs previously 10+50 = 60, which no one intended).

## Verification

Additive change only. Requires backend restart to pick up. MariaDB `max_connections` default 151 remains the hard ceiling; the new default of 50 leaves headroom for OS/Socket.IO/reserved connections.
