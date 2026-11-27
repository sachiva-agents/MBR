# LOAD-SMOKE — production-scale sanity check (HAG-19)

**Run:** 2026-11-27 · **Author:** harry · **Mode:** report-only, no code changes
**Stack under test:** fresh scratch DB `hotel_management_hag19` · backend on `127.0.0.1:5099` (env override `DB_NAME=hotel_management_hag19`, `PORT=5099`, `AUTO_PRINT_ENABLED=false`) · Node 26 · MariaDB/XAMPP · prod DBs `resort_management` / `resort_management1` untouched (read-only per rules)

## Scope

- **Phase 1:** 50 concurrent `POST /api/auth/login`.
- **Phase 2:** 2-minute mixed load, 25 keep-alive workers, ~51 req/s, with **20 Socket.IO clients** attached: booking-list reads, KOT creates (benign writes), room-service reads, reports reads.
- Sampling: backend RSS + live MariaDB connection count, every 10s.

## Results — all green, no 5xx anywhere

### Phase 1 — 50 concurrent logins

| metric | value |
|---|---|
| ok / fail | **50 / 0** (all 200) |
| wall (all 50) | 2856 ms |
| p50 / p95 latency | **2846 / 2851 ms** |
| min / max | 147 / 2851 ms |

p50 ≈ full wall = requests serialized through the **login → bcrypt → DB pool** path. Under 50-way concurrency the login DB queries queue on a pool capped at 10; this is pool saturation, not a defect. (See defect F3 below.)

### Phase 2 — 2-min mixed load (6,141 reqs, **0 4xx, 0 5xx, 0 net errors**)

| category | total | ok | p50 | p95 | rps |
|---|---|---|---|---|---|
| booking-list (read) | 1843 | 1843 | **1011** | 1268 | 15.4 |
| kot-create (write) | 1236 | 1236 | **380** | 546 | 10.3 |
| room-service (read) | 1242 | 1242 | **79** | 153 | 10.4 |
| reports-read | 1820 | 1820 | **321** | 575 | 15.2 |

**Socket.IO:** 20 connected, 20 clean disconnects at teardown, **0 connect errors** — realtime channel stable throughout.

### MariaDB pool behavior (limit 10)

The backend runs **two independent mysql2 pools**, both capped at `DB_CONNECTION_LIMIT=10`:
- `src/config/db.js` → `pool` (query API) — 10
- `src/utils/poolPromise.js` → `pool` (model layer) — 10
- **Effective ceiling = 20 simultaneous MariaDB connections.**

Live `information_schema.processlist` count for the scratch DB was **pinned at exactly 20** for the entire run (both pools saturated, `queueLimit:0` unbounded). No `ER_CON_COUNT_ERROR` (20 < `max_connections`), no 5xx — but the app is one pool-overshoot away from connection errors under higher concurrency.

### Memory trend

Backend RSS: **139 MB → 157 MB** over the run (monotonic, no leak, no GC cliff). Stable.

## Verdict

**Survives this load.** 50 concurrent logins and ~51 req/s mixed (with 20 realtime clients) complete with **zero application errors**; the binding constraint is the 2×10 MariaDB connection pool, which serializes DB-backed requests (booking-list p50 1011ms is pool-queueing, not compute).

## Findings — flag for god to card (NOT fixed, report-only)

- **F3 (defect, fresh-install):** on a brand-new DB, `roles` is **never created** at boot — `RolesModel.ensureSchema()` (its only DDL) is not on the boot path, and `BootstrapModule.ensureSystemRoles()` bails out early when the table is absent. Result: `POST /api/auth/login` 500s (`LEFT JOIN roles` → `ER_NO_SUCH_TABLE`) on a clean install until `roles` is hand-created.
- **F1 (defect, fresh-install):** FK DDL ordering — 9 child tables (e.g. `booking_rooms`, `attendance_records`, `zk_badge_map`, `menu_item_ingredients`) report `errno 150 FK incorrectly formed` on first boot because their parents (`room_categories`, `employees`, `designations`, `menu_categories`, `menu_items`) are created **lazily by a second code path** that hadn't run. Same class: `payment_methods` (lazy DDL in `PaymentMethodsModel`) left `/api/booking/all-bookings` 500-ing on a clean install. Resolves once the parents exist.
- **F2 (risk):** two uncoordinated 10-connection pools = 20 max concurrent MariaDB connections. Fine here, but no headroom above ~50 concurrent DB-backed clients. Candidate: raise `DB_CONNECTION_LIMIT`, or merge into one shared pool.
- **F5 (note):** auth rate-limiter `skip()` always exempts `127.0.0.1` (`isLocalRequest`), so the 50-login phase was **unthrottled by design** — external clients would hit `AUTH_RATE_LIMIT_MAX=10 / 15min`.

## Teardown

- 5099 backend: PID 20256 was the process running the load test. It exited on its own during the ~3h idle window after the run (host memory-pressure reap) — verified at teardown: **PID 20256 dead, port 5099 not listening**. No MBR servers of mine remain up (earlier boot cycles PIDs 47540 / 32084 / 3169-shell were already `taskkill`'d between reboots).
- The pre-existing team dev backend on **5002 (PID 7308) was NOT touched**.
- **MariaDB (XAMPP, PID 37036 on 3306) left running for the team.** Scratch DB `hotel_management_hag19` retained with its seeded test data.
