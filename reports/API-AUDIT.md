# MBR API-Connection Audit (HAG-7)

Repo `X:/agent/MBR` @ `d35dd73`, 2026-11-26. **Read-only** — no source changed.
The PDF print + saved-PDF pipeline is **FROZEN** per the human directive; it was
not touched, not modified, and is not counted as a finding. Machine-readable
companion: `reports/API-AUDIT.json`.

## 1. Totals

| Metric | Count |
| --- | --- |
| Frontend axios call sites, literal paths | 601 (GET 328 / POST 135 / PUT 90 / DELETE 35 / PATCH 13) |
| Frontend call sites with dynamic/variable-arg paths | 6 (all resolved to existing routes, see 3) |
| **Frontend API calls total** | **607** |
| Distinct endpoint templates (method + path) | 359 |
| Backend route definitions (unique, 35 modules) | 467 |
| Backend endpoint paths as mounted (alias-expanded) | 562 |
| **[MISSING]** frontend calls a route that does not exist | **0** |
| **[MISMATCH]** method/param-shape mismatches | **0** |
| **[ORPHAN]** undefined/unmounted UI handlers | **0** (6 heuristic hits, all false positives, 4) |
| **[DEAD]** backend definitions with no frontend caller | **88** (was 123 before dynamic-call reclassification, 5) |
| **[SOCKET]** events with one-sided wiring | **1** (`room-order-status`, 4) |

**Bottom line: every frontend API call connects.** No frontend button points at
a route that does not exist, and no method/param-shape mismatches. The only
live defect is one server-emitted socket event with no client listener.

Axios traffic flows through exactly 3 instances: `API` (`src/api.js`, shared,
interceptor-wrapped), `axios` (raw, in `components/Hotel/BookingFlow.jsx`), and
`bookingAPI` (dedicated instance, also in `BookingFlow.jsx`). Zero
`fetch()` / XHR usage in the frontend.

## 2. Backend route inventory

- 35 route modules under `src/routes/`, mounted at 42 `app.use("/api/...")`
  sites in `src/app.js` (plus `/api/health`).
- 467 unique route definitions, 562 mounted endpoint paths after alias
  expansion. Aliases mirror canonical mounts: `/api/booking` <->
  `/api/hotel`, `/api/roomservice` <-> `/api/room-service`,
  `/api/invoice` <-> `/api/invoices`, `/api/employee` <->
  `/api/employees`, `/api/notification` <-> `/api/notifications`, plus
  `/room-block` <-> `/room-blocks` sub-aliases inside bookingRoutes.
- Per-module method mix (alias-expanded): GET 267 / POST 144 / PUT 82 /
  PATCH 20 / DELETE 49.
- Sub-router `.use("/prefix", aliasRouter)` chains (bookingRoutes
  room-blocks/room-block; diningRoutes admin) are expanded in the JSON
  inventory.

Full list (machine-readable, module + line per endpoint): `reports/API-AUDIT.json`.

### Socket.IO events emitted server-side

| Event | Emitted at | Client listener |
| --- | --- | --- |
| `kitchen-order-created` | `kitchenController.js:126` | RestaurantContext.jsx:107 |
| `kitchen-order-updated` | chefController.js:104, kitchenController.js:227, waiterController.js:153,216 | RestaurantContext.jsx:108 |
| `kitchen-order-ready` | chefController.js:115, kitchenController.js:238 | useWaiterOrders.js:94, RestaurantDashboard.jsx:80 |
| `housekeeping-task-updated` | `housekeepingController.js:65` | Stayover.jsx:229 |
| **`room-order-status`** | `roomServiceController.js:349` | **NONE** — finding S-1 |

No client-to-server socket emits exist; the waiter-assignment flow that
`room-order-status` feeds is driven through REST instead
(`POST /api/room-service-delivery/assign-waiter` + polling).

## 3. Frontend call inventory & dynamic-arg sites

607 call sites across 106 source files (pages, components, services, hooks,
Context). The 6 variable-arg sites my literal scan flags as "dynamic" are all
**helper-mediated with literal caller endpoints** — verified by hand against the
backend:

| Site | Variable | Resolves to | Backend status |
| --- | --- | --- | --- |
| `Accounts.jsx:912` API.post(endpoint) | `createModuleEntry` | 7 POSTs: /accounts/{bank-ledger,petty-cash,gst-returns,vendor-payments,purchase-orders,payroll,profit-centers} | all exist (accountsRoutes.js:148-172) |
| `Accounts.jsx:925/938` API.put/delete(endpoint/id) | `updateModuleEntry` / `deleteModuleEntry` | PUT/DELETE /accounts/{petty-cash,gst-returns,vendor-payments,purchase-orders,payroll,profit-centers}/:id | all exist |
| `restaurantService.js:98-117` | `billId ? id-path : bare-path` | POST /restaurant/bill[/:id]/pay, /bill[/:id]/charge-to-room, /split-bills[/:id]/charge-to-room | all exist (restaurantRoutes.js:48-53) |
| `InventoryFlow.jsx:851` | `endpointMap[type]` | GET /inventory/reports/{vendor-spend,stock-value,expiry-batches,consumption,audit-trail} | all exist (inventoryRoutes.js:164-189) |
| `InventoryReportsPage.jsx:115` | `tab.endpoint` | GET /inventory/alerts/{low-stock,expiring}, /vendor-insights, /stock-ledger | all exist |

## 4. [ORPHAN] & [SOCKET] findings

**S-1 — `room-order-status` emitted, never listened to (live gap).**
`global.io.emit("room-order-status", ...)` at
`Maa-Baglamkhi-Resort-Backend/src/controller/roomServiceController.js:349`
has zero listeners anywhere in `src/` or `tests/` (grep-verified). Room-service
status changes therefore never update the UI in realtime; the UI only catches
them via REST polling (`/api/room-service-delivery/waiter-queue`,
`/ready-room-orders`). Fix is a one-line `socket.on` in the waiter/room-service
panel — a candidate fix card.

**ORPHAN — none confirmed.** Scanned every onClick/onSubmit/onChange/onSelect/
onKeyPress/onLoad handler across `src/`: six heuristic hits, all false
positives — `onCancel`/`onClose` are destructured component props
(TransactionForm, AttendanceForm, EditBooking, CheckoutReportModal), `async` is
the async-arrow keyword (InventoryDashboard x2), `fn` is a
`presets.map(([label, fn])` parameter (ReportsSuite). No button whose handler
is undefined, unmounted, or silently swallowed without an API call behind it.

## 5. [DEAD] backend definitions with no frontend caller (88)

Live, auth-guarded, test-covered routes. Aliases of the canonical mount count
once; a definition is listed only when **no** alias is called. Unused API
surface — cleanup candidates, **not** defects. 35 of the initial 123 were
reclassified as covered by the dynamic-arg call sites in 3 (see JSON
`COVERED_BY_DYNAMIC_CALLS`).

### bookingRoutes.js (12)

- `GET /` — line 35
- `GET /payment-history` — line 36
- `GET /room-tariff` — line 37
- `GET /communication` — line 38
- `GET /booking/:id` — line 39
- `GET /rooms` — line 42
- `GET /rooms-availability` — line 43
- `POST /rooms/validate-availability` — line 55
- `DELETE /folio/entry/:entryId` — line 74
- `GET /room-block/` — line 81
- `POST /room-blocks/` — line 82
- `GET /guests/search` — line 89

### inventoryRoutes.js (9)

- `GET /items` — line 23
- `GET /vendors` — line 24
- `GET /menu-list` — line 25
- `GET /menu-items` — line 26
- `GET /reports` — line 27
- `GET /chef-issues/:id` — line 67
- `POST /purchases` — line 87
- `POST /stock` — line 157
- `POST /stock-action` — line 160

### employeeRoutes.js (8)

- `GET /departments` — line 16
- `GET /designations` — line 17
- `GET /stats` — line 18
- `GET /attendance/employees` — line 19
- `GET /employees` — line 20
- `POST /` — line 23
- `GET /:id` — line 24
- `PATCH /:id` — line 26

### roomServiceRoutes.js (7)

- `DELETE /menu/:id` — line 22
- `GET /order/:roomNumber` — line 26
- `PUT /order/:roomNumber/pay` — line 27
- `GET /order-items/:orderId` — line 29
- `POST /bill` — line 30
- `GET /bill/:roomNumber` — line 31
- `PUT /order/:orderId/status` — line 32

### restaurantRoutes.js (6)

- `GET /` — line 41
- `GET /payment` — line 42
- `GET /payment-bills` — line 43
- `GET /room-items` — line 44
- `GET /bill` — line 45
- `GET /split-bills` — line 46

### roleRoutes.js (6)

- `GET /permissions` — line 13
- `POST /` — line 16
- `GET /:id` — line 17
- `PATCH /:id` — line 18
- `GET /:id/permissions` — line 21
- `PUT /:id/permissions` — line 22

### salaryRoutes.js (5)

- `GET /employees` — line 8
- `GET /me` — line 12
- `GET /me/attendance` — line 15
- `GET /:userId` — line 24
- `POST /:userId/recalculate` — line 27

### accountsRoutes.js (4)

- `GET /dashboard` — line 114
- `GET /` — line 122
- `GET /transactions/:id` — line 124
- `GET /payment-settings/:id` — line 176

### chefRoutes.js (4)

- `GET /` — line 10
- `PUT /orders/:id/cancel` — line 13
- `PUT /orders/:id/save` — line 14
- `DELETE /orders/:id` — line 15

### housekeepingRoutes.js (4)

- `GET /parameters` — line 24
- `POST /parameters` — line 25
- `GET /inspections/:id` — line 36
- `DELETE /lost-found/:id` — line 41

### notificationRoutes.js (4)

- `GET /` — line 29
- `POST /:id/read` — line 30
- `POST /mark-all-read` — line 31
- `POST /` — line 32

### attendanceRoutes.js (3)

- `GET /payroll` — line 13
- `POST /mark` — line 18
- `PATCH /:id` — line 30

### banquetRoutes.js (3)

- `GET /config` — line 81
- `GET /halls` — line 84
- `GET /bookings` — line 102

### payrollRoutes.js (3)

- `GET /payments/:id` — line 14
- `PATCH /payments/:id` — line 15
- `GET /estimate/:employeeId` — line 17

### paymentRoutes.js (2)

- `POST /` — line 10
- `GET /` — line 11

### reportRoutes.js (2)

- `GET /daywise` — line 10
- `GET /items` — line 11

### reportsRoutes.js (2)

- `GET /` — line 11
- `GET /data` — line 13

### InvoiceRoutes.js (1)

- `PATCH /payment-status/:id` — line 21

### dashboardRoutes.js (1)

- `GET /` — line 17

### kitchenRoutes.js (1)

- `GET /` — line 12

### zkRoutes.js (1)

- `GET /machines/:id/pulls` — line 19



### Notable dead clusters

- **bookingRoutes.js (12)** — bare `GET /`, legacy `GET /payment-history`,
  `GET /rooms`, `GET /communication`, `POST /rooms/validate-availability`,
  `DELETE /folio/entry/:id`. The UI moved to `/all-bookings`,
  `/booking-history`, `/rooms/setup`, per-booking `payment-history/:id`.
- **employeeRoutes.js (8) / salaryRoutes.js (5)** — the payroll UI drives
  `/payroll/*` + `/attendance/*`; legacy employee/salary list endpoints unused.
- **roleRoutes.js (6)** — role admin handled in the User page via `/users/*`.
- **reportsSuiteRoutes.js** — only the 4 `GET /reports-suite/:key` presets
  called by ReportsSuite.jsx; the other ~29 suite endpoints are
  admin/backoffice-only surface.

## 6. Area breakdown (fix-slicing guide)

| Domain | FE call sites | BE definitions | Dead defs | Covered by dynamic calls |
| --- | --- | --- | --- | --- |
| hotel/front-desk | 132 | 59 | 15 | 0 |
| restaurant POS/KOT | 126 | 93 | 18 | 6 |
| accounts/payroll | 99 | 104 | 24 | 18 |
| inventory | 90 | 76 | 9 | 11 |
| housekeeping | 63 | 29 | 4 | 0 |
| banquet | 23 | 16 | 3 | 0 |
| dashboards/reports | 22 | 49 | 5 | 0 |
| auth | 21 | 22 | 6 | 0 |
| HR/assignments | 15 | 6 | 0 | 0 |
| print | 8 | 8 | 0 | 0 |
| notifications | 0 | 5 | 4 | 0 |

**Slicing note:** the only *functional* work is S-1 (one-line socket
listener) plus optional dead-surface cleanup, sliced per domain above
(accounts/payroll and restaurant POS/KOT hold the most dead surface). No
frontend domain has a missing-route defect.

## 7. Methodology

- **Backend:** parsed `src/app.js` mounts (42 sites incl. the invoiceRoutes
  variable mount), all 35 `src/routes/*.js` files with multi-line-safe method
  extraction and sub-router `.use("/prefix", alias)` alias expansion; socket
  events from `global.io?.emit` grep across `src/`.
- **Frontend:** whole-tree scan of `Maa-Baglamkhi-Resort-frontend/src` for the
  three axios instances (multi-line template-safe); 8 URLSearchParams false
  positives excluded; the 6 dynamic-arg sites resolved by reading their helper
  call sites.
- **Matching:** segment-wise normalization (:param/${...} -> *), query strings
  and trailing slashes stripped, alias-aware. A call is MISSING only when no
  alias of any definition matches under its method; every candidate a runtime
  id could hit is marked used, so shadowed sibling parameter routes are not
  miscounted dead. MISMATCH = path exists under a different method than the
  call uses (0 found).
- **Socket:** literal `socket.on` / `global.io.emit` grep on both trees.

---
_Report-only commit; no source changes. PDF pipeline frozen and untouched.
Machine-readable data: `reports/API-AUDIT.json`._
