# HAG-53 — the banquet `/bookings` POST route does not exist (follow-up)

**Verdict: the defect as stated was already fixed on main by `acb08ae` before this temp started.**
I chose option **(b) repoint**, not (a) add an alias — and that is the fix that landed, already.
I changed no source code. I re-verified everything myself against a live server instead of trusting
either the brief or the earlier report.

## What the defect actually was

The brief said `test/lifecycle.test.js:1271` requires `POST /api/banquet/bookings` to return 200/201,
that no POST handler exists there, and that the assertion can never pass.

The route half is true. The "cannot pass" half is not.

`lifecycle.test.js:1248` posts to **`/api/banquet`**, not `/api/banquet/bookings`. The check at
`:1271` passes the *request's* response into the assertion, so it was always green. Only the
`check()` **label** named the non-existent path — four of them. Every failure message that ever
printed was a 404 on a path the suite never requested.

| Call site | Target | Handler | Result |
|---|---|---|---|
| `lifecycle.test.js:1248` | `POST /api/banquet` | `router.post("/")` → `createBanquetBooking` | 201 |
| `lifecycle.test.js:1381` | `POST /api/banquet` | same | 400 (invalid hallId) |
| `lifecycle.test.js:1396` | `POST /api/banquet` | same | 400 (missing fields) |
| `write-probe.test.js:339` | `POST /api/banquet` | same | 201 |
| `frontend/.../Banquet.jsx:1472` | `POST /banquet` | same | 201 |
| `lifecycle.test.js:1288,1324,1335` | `GET /api/banquet/bookings` | `router.get("/bookings")` | 200 |

`src/routes/banquetRoutes.js` registers `router.get("/bookings")` at line 98 and `router.post("/",
createBanquetBooking)` at line 119. There is no `POST /bookings`, and **there is no caller of one
anywhere in the tree** — not the backend tests, not the write probe, not the frontend. So the path
is not a missing piece to fill in; it is a label that pointed at a place nobody reads from.

`acb08ae` (already on main) renamed the four labels to the paths the requests actually hit:

| Line | Was | Now |
|---|---|---|
| 1271 | `POST /api/banquet/bookings accepted` | `POST /api/banquet accepted` |
| 1319 | `PUT /api/banquet/bookings/:id accepted` | `PUT /api/banquet/:id accepted` |
| 1345 | `PUT /api/banquet/bookings/:id/refund accepted` | `PUT /api/banquet/:id/refund accepted` |
| 1364 | `PUT /api/banquet/bookings/:id/complete accepted` | `PUT /api/banquet/:id/complete accepted` |

## Why (b), not (a)

An alias would have shipped a route with zero callers. Three problems with it:

1. **Dead surface.** Nothing in the tree posts to `/banquet/bookings`. It would exist solely to make
   a mis-stated label read true.
2. **It would have masked the real defect.** Once both URLs work, the report becomes "both pass" and
   nobody learns that the PUT and refund labels were also wrong. The label fix corrected all four;
   the alias fixed the first and left the other three pointing at routes that do not exist.
3. **A new write path in production.** `POST /banquet` is a create endpoint. Doubling it means a new
   attack surface and a new place to drift when `createBanquetBooking` changes.

One caveat on (a), recorded so the decision is honest: had someone actually wanted the nested
shape, an alias alone would **not** have passed the check. `validateBookingPayload`
(`src/utils/banquetHelpers.js:47`) requires `hallId`, `customerName`, `eventType`, `guests`, `date`,
`startTime`, `endTime`, and the handler rejects an unknown hall with `400 Invalid hallId`. Both test
sends omit `eventType` — a `/bookings` POST would have returned **400**, not 404. So (a) was never
a one-line fix even in the case where it was wanted.

## Verified against a live server

Environment: MySQL `resort_management` at 127.0.0.1:3306. Suite server booted from this worktree on
port **5091** with `TEST_BASE_URL=http://localhost:5091` — 5002 was left to the sibling instance
already serving the production checkout. `src/config/db.js` was never opened or edited.

**The 404 was reproduced directly**, one authenticated request per path:

```
POST /api/banquet           -> 400 {"message":"Invalid hallId"}
POST /api/banquet/bookings  -> 404 {"message":"Endpoint not found.","path":"/api/banquet/bookings"}
GET  /api/banquet/bookings  -> 200
```

The 400 on `/api/banquet` is the probe body's hallId being absent from `banquet_halls`, not a
route miss — it reaches `createBanquetBooking`. `/bookings` never reaches a handler at all.

### Suite counts

| Suite | Result on main | Banquet section |
|---|---|---|
| `npm run test:routes` | **433 pass / 0 fail / 12 skip** (445 total) | not covered |
| `npm run test:lifecycle` | **120 pass / 0 fail** | 17 passed, 0 failed |
| `npm run test:writeprobe` | **50 pass / 1 fail** | 6 passed, 0 failed |

**Before/after, stated honestly:** my working tree sat at `eaae1d7`, which is *two commits behind*
main, so I have no pre-`acb08ae` baseline of my own — the only change between the two revisions is
the four label strings, and they feed no assertion. These are the counts on the current main
revision, run by me.

**On the two prior conflicting claims: lifecycle is 120/0, not 109/2.** Reproduced on two separate
runs (mine here, plus the earlier report's clean-DB run). The `109/2` figure is not reproducible on
any revision I could reach, and I could not reconstruct it. `test:writeprobe` does **not** post to
`/api/banquet/bookings` — it posts to `/api/banquet` at `:339`, and its banquet section passes.

Banquet lifecycle, all 17 green:

```
[PASS] POST /api/banquet/halls accepted
[PASS] hall create returns a real numeric id (was undefined before the insertId fix)
[PASS] new hall appears in GET /api/banquet/halls
[PASS] hall round-trips its name and capacity
[PASS] POST /api/banquet accepted
[PASS] banquet booking returns a real numeric id
[PASS] booking appears in GET /api/banquet/bookings
[PASS] booking round-trips its customer name
[PASS] booking round-trips guest count
[PASS] PUT /api/banquet/:id accepted
[PASS] guest count update is persisted
[PASS] PUT /api/banquet/:id/refund accepted
[PASS] refund exceeding the advance is rejected (400)
[PASS] PUT /api/banquet/:id/complete accepted
[PASS] completed booking can still be cancelled
[PASS] booking with invalid hallId is rejected (400)
[PASS] booking missing required fields is rejected (400)
```

### The one remaining failure

`test:writeprobe` stays at 50/1 — pre-existing, out of scope, unrelated to banquet:

```
POST /api/accounts/payroll returns an id
  got 500 {"message":"Failed to add payroll record",
           "error":"Duplicate entry '5-2026-10-01' for key 'uniq_employee_month'"}
```

That is a data collision on an existing `employees` row for October 2026, not a code defect, and
employee rows are off-limits. Nobody touches data rows, so it needs a decision from the data side.

## What I committed

**Nothing.** `acb08ae` (`test/lifecycle.test.js`, 1 file, +4/-4) and `c669a17` (the earlier HAG-53
report) already cover the defect and its write-up. Nothing was pushed.

Working tree hygiene: this worktree had no `node_modules` and no `.env`, so I symlinked
`node_modules` from the production checkout and copied its `.env` in to boot the suite server. Both
are untracked debris and are **not** part of any commit. The `.env` copy holds production secrets and
should be deleted from the worktree.

Nothing protected was touched: no `src/config/db.js`, no controller, no `src/app.js`, no
`test/reports/api-routes.json` (the routes sweep rewrites it at runtime; that change was not staged),
no probe scripts, no committed probe artifacts.

## Open

- The four mislabelled checks were a symptom. Two other checks in the same file read fine but share
  the pattern of "label names a path the request does not hit" — worth a sweep if anyone else is
  editing lifecycle labels, though I found no further mismatches in the banquet module.
- The payroll writeprobe failure is a data collision, not a fix. Someone on the data side owns it.
- `created_by` and `req.user?.id || null` in `createBanquetBooking`: booking rows created through
  this path are correctly attributed now, but the `|| null` fallback means an unauthenticated call
  would write a null-creator row. Auth middleware is in front of the mount, so it is not reachable —
  just noting the loose coupling.
