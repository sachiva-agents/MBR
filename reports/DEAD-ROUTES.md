# DEAD-ROUTES — classification of the 88 [DEAD] endpoints

Source: `reports/API-AUDIT.json` (`details.DEAD`, 88 entries), commit 449da93. Strictly read-only analysis — no code touched.

## Method
- Indexed every `.get/.post/.put/.delete/.patch(…)` call in `Maa-Baglamkhi-Resort-frontend/src` (600 literal call sites, 309 distinct method+resource shapes).
- **REDUNDANT**: a live sibling in the same resource family is what the UI actually calls (same handler / alias mount / verb variant).
- **GAP**: no sibling in the family is called by any UI — the feature exists only on the backend. Each gap gets a suggested UI placement for HAG-12.
- Sibling relationships verified against the route files (`src/routes/*.js` + `src/app.js` mounts).

## Totals

| | count |
|---|---|
| DEAD routes | **88** |
| REDUNDANT (alias/variant of a live route the UI already calls) | **66** |
| GAP (backend-only feature, no UI exposes it or its payload shape) | **22** |

GAP domains: employees (6), notifications (4), housekeeping (2), payment (2), roles (2), room-service (2), payroll (1), restaurant (1), salary (1), zk (1)

## REDUNDANT (66)

| # | Route | Live sibling the UI calls | FE evidence |
|---|---|---|---|
| 1 | `PATCH /api/invoices/payment-status/:id` (InvoiceRoutes.js) | PUT /api/accounts/payment-settings/:id (live: Accounts.jsx:1639) is the payment-settings write the UI uses; no UI references the invoice payment-status patch | no FE caller for this path (sibling family covered by live routes) |
| 2 | `GET /api/accounts/dashboard` (accountsRoutes.js) | GET /api/accounts/summary (live: Accounts.jsx, AccountsDashboard.jsx; same handler getSummary) | FE caller(s): pages/Accounts.jsx, pages/AccountsDashboard.jsx, pages/reports/IncomeExpenditure.jsx |
| 3 | `GET /api/accounts/` (accountsRoutes.js) | GET /api/accounts/summary (live: Accounts.jsx, AccountsDashboard.jsx; same handler getSummary) | FE caller(s): pages/Accounts.jsx, pages/AccountsDashboard.jsx, pages/reports/IncomeExpenditure.jsx |
| 4 | `GET /api/accounts/transactions/:id` (accountsRoutes.js) | GET/PUT/DELETE /api/accounts/transactions (list+item CRUD live: Accounts.jsx) | FE caller(s): pages/Accounts.jsx, pages/Accounts.jsx, pages/Accounts.jsx |
| 5 | `GET /api/accounts/payment-settings/:id` (accountsRoutes.js) | GET /api/accounts/payment-settings (live: Accounts.jsx:800); :id read has no UI (UI works off the list) | FE caller(s): pages/Accounts.jsx, pages/Accounts.jsx, pages/Accounts.jsx |
| 6 | `GET /api/attendance/payroll` (attendanceRoutes.js) | GET /api/attendance (live: Attendance.jsx) + GET /api/accounts/payroll (live) | FE caller(s): pages/Attendance.jsx, pages/Attendance.jsx, pages/Attendance.jsx |
| 7 | `POST /api/attendance/mark` (attendanceRoutes.js) | POST /api/attendance (live: Attendance.jsx, same handler markAttendance) | no FE caller for this path (sibling family covered by live routes) |
| 8 | `PATCH /api/attendance/:id` (attendanceRoutes.js) | PUT /api/attendance/:id (live shape, same handler updateAttendanceRecord); UI uses the PUT verb | no FE caller for this path (sibling family covered by live routes) |
| 9 | `GET /api/banquet/config` (banquetRoutes.js) | GET /api/banquet dashboard (live: Banquet page, bundles pricing config) + PUT /api/banquet/config (live) | FE caller(s): pages/Accounts.jsx, pages/AccountsCustomerInvoices.jsx, pages/AccountsDashboard.jsx |
| 10 | `GET /api/banquet/halls` (banquetRoutes.js) | GET /api/banquet dashboard (live: Banquet page, includes halls) | FE caller(s): pages/Accounts.jsx, pages/AccountsCustomerInvoices.jsx, pages/AccountsDashboard.jsx |
| 11 | `GET /api/banquet/bookings` (banquetRoutes.js) | GET /api/banquet dashboard (live: Banquet page, includes bookings) | FE caller(s): pages/Accounts.jsx, pages/AccountsCustomerInvoices.jsx, pages/AccountsDashboard.jsx |
| 12 | `GET /api/hotel/` (bookingRoutes.js) | GET /api/hotel/all-bookings (live: 15 call sites, same handler getAllBookings) | FE caller(s): components/Dashboard/Stayover.jsx, components/Hotel/AllBooking.jsx, components/Hotel/BookingFlow.jsx |
| 13 | `GET /api/hotel/payment-history` (bookingRoutes.js) | GET /api/hotel/payment-history/:id (live: 5 call sites) + GET /api/accounts/payment-history (live) | FE caller(s): components/Hotel/BookingFlow.jsx, components/Hotel/BookingFlow.jsx, components/Hotel/BookingFlow.jsx |
| 14 | `GET /api/hotel/room-tariff` (bookingRoutes.js) | POST /api/hotel/room-tariff/:id (live) is the write the UI uses; GET /api/hotel/booking-history (live) is the read | FE caller(s): components/Hotel/RoomTariff.jsx, components/Hotel/AllBooking.jsx, components/Hotel/BookingFlow.jsx |
| 15 | `GET /api/hotel/communication` (bookingRoutes.js) | GET /api/hotel/booking-history (live; same handler getBookingHistory) | FE caller(s): components/Hotel/AllBooking.jsx, components/Hotel/BookingFlow.jsx, components/Hotel/BookingHistory.jsx |
| 16 | `GET /api/hotel/booking/:id` (bookingRoutes.js) | GET /api/hotel/full-booking/:id (live: 10 call sites) | FE caller(s): components/Dashboard/Stayover.jsx, components/Dashboard/Stayover.jsx, components/Hotel/BookingFlow.jsx |
| 17 | `GET /api/hotel/rooms` (bookingRoutes.js) | GET /api/hotel/rooms/setup (live: 10 call sites, same handler getRoomSetup) | FE caller(s): components/Hotel/BookingFlow.jsx, components/Hotel/GroupBooking.jsx, components/Hotel/OccupancyForecast.jsx |
| 18 | `GET /api/hotel/rooms-availability` (bookingRoutes.js) | GET /api/hotel/rooms/setup (live, same handler getRoomSetup) | FE caller(s): components/Hotel/BookingFlow.jsx, components/Hotel/GroupBooking.jsx, components/Hotel/OccupancyForecast.jsx |
| 19 | `POST /api/hotel/rooms/validate-availability` (bookingRoutes.js) | POST /api/hotel/rooms + POST /api/hotel/room-block (live) cover create/block; availability is validated server-side on booking | no FE caller for this path (sibling family covered by live routes) |
| 20 | `DELETE /api/hotel/folio/entry/:entryId` (bookingRoutes.js) | GET /api/hotel/folio/:id + POST /api/hotel/folio/:id (live: 5+2 call sites); entry deletion has no UI (void is done by re-posting) | FE caller(s): components/Hotel/BookingFlow.jsx, components/Hotel/BookingFlow.jsx, components/Hotel/BookingFlow.jsx |
| 21 | `GET /api/hotel/room-block/` (bookingRoutes.js) | GET /api/hotel/room-blocks (live: 4 call sites; /room-block and /room-blocks mount the SAME sub-router) | FE caller(s): components/Hotel/OccupancyForecast.jsx, components/Hotel/Room.jsx, components/Hotel/RoomMaintenance.jsx |
| 22 | `POST /api/hotel/room-blocks/` (bookingRoutes.js) | POST /api/hotel/room-block (live: 1 call site; same sub-router under both mounts) | no FE caller for this path (sibling family covered by live routes) |
| 23 | `GET /api/hotel/guests/search` (bookingRoutes.js) | GET /api/hotel/guest-profile (live: 2 call sites, same controller family) | FE caller(s): components/Hotel/GuestProfile.jsx, components/Hotel/GuestProfile.jsx |
| 24 | `GET /api/chef/` (chefRoutes.js) | GET /api/chef/orders (live: chefService.js, same handler getKitchenOrders) | FE caller(s): services/chefService.js, services/chefService.js |
| 25 | `PUT /api/chef/orders/:id/cancel` (chefRoutes.js) | PUT /api/kitchen/orders/:id/cancel (live: restaurantService.js; chef mount is the duplicate) | FE caller(s): services/restaurantService.js, services/restaurantService.js, services/restaurantService.js |
| 26 | `PUT /api/chef/orders/:id/save` (chefRoutes.js) | PUT /api/kitchen/orders/:id/save (live: restaurantService.js) | FE caller(s): services/restaurantService.js, services/restaurantService.js, services/restaurantService.js |
| 27 | `DELETE /api/chef/orders/:id` (chefRoutes.js) | DELETE /api/kitchen/orders/:id (live: restaurantService.js) | FE caller(s): services/restaurantService.js, services/restaurantService.js, services/restaurantService.js |
| 28 | `GET /api/dashboard/` (dashboardRoutes.js) | GET /api/dashboard/metrics (live: Dashboard.jsx, AccountsDashboard.jsx; same handler getMetrics) | FE caller(s): pages/AccountsDashboard.jsx, pages/Dashboard.jsx, pages/ManagerDashboard.jsx |
| 32 | `GET /api/employees/attendance/employees` (employeeRoutes.js) | GET /api/employees/employees (live) + GET /api/attendance/employees (live) | no FE caller for this path (sibling family covered by live routes) |
| 33 | `GET /api/employees/employees` (employeeRoutes.js) | GET /api/employees (live: Payroll.jsx, ZkAttendance.jsx, same handler listEmployees) | no FE caller for this path (sibling family covered by live routes) |
| 39 | `GET /api/housekeeping/inspections/:id` (housekeepingRoutes.js) | GET /api/housekeeping/inspections (live list; :id read has no UI) | FE caller(s): components/Housekeeping/InspectionChecklistModal.jsx, components/Housekeeping/InspectionChecklistModal.jsx |
| 40 | `DELETE /api/housekeeping/lost-found/:id` (housekeepingRoutes.js) | GET/POST /api/housekeeping/lost-found + PUT /:id (live: Housekeeping.jsx, LostFoundModal.jsx) — delete is the missing tail of that UI | FE caller(s): components/Housekeeping/LostFoundModal.jsx, components/Housekeeping/LostFoundModal.jsx, components/Housekeeping/LostFoundModal.jsx |
| 41 | `GET /api/inventory/items` (inventoryRoutes.js) | GET /api/inventory (live: 6 call sites, same handler getItems) | no FE caller for this path (sibling family covered by live routes) |
| 42 | `GET /api/inventory/vendors` (inventoryRoutes.js) | GET /api/inventory/vendor-inwards (live: 4 call sites, same handler getVendorInwards) | FE caller(s): components/Inventory/InventoryDashboard.jsx, components/Inventory/InventoryDashboard.jsx, components/Inventory/InventoryDashboard.jsx |
| 43 | `GET /api/inventory/menu-list` (inventoryRoutes.js) | GET /api/inventory (live, same handler getItems) — legacy alias name | no FE caller for this path (sibling family covered by live routes) |
| 44 | `GET /api/inventory/menu-items` (inventoryRoutes.js) | GET /api/inventory (live, same handler getItems) — legacy alias name | no FE caller for this path (sibling family covered by live routes) |
| 45 | `GET /api/inventory/reports` (inventoryRoutes.js) | GET /api/inventory/stock-ledger (live: 2 call sites, same handler getStockLedger) | FE caller(s): components/Inventory/InventoryDashboard.jsx |
| 46 | `GET /api/inventory/chef-issues/:id` (inventoryRoutes.js) | GET /api/inventory/chef-issues (live) + PUT /:id/return (live); :id read has no UI | no FE caller for this path (sibling family covered by live routes) |
| 47 | `POST /api/inventory/purchases` (inventoryRoutes.js) | GET /api/inventory/purchases (live stub pair, both 501/[]); real purchase flow is /api/inventory/purchase-orders (live: 5 call sites) | no FE caller for this path (sibling family covered by live routes) |
| 48 | `POST /api/inventory/stock` (inventoryRoutes.js) | GET /api/inventory/stock (live stub pair, 501); live stock ops run on /api/inventory/stock-ledger + /api/inventory/vendor-inwards | no FE caller for this path (sibling family covered by live routes) |
| 49 | `POST /api/inventory/stock-action` (inventoryRoutes.js) | 501 stub; live audit action is POST /api/inventory/audit (live, same editor role) | no FE caller for this path (sibling family covered by live routes) |
| 50 | `GET /api/kitchen/` (kitchenRoutes.js) | GET /api/kitchen/orders (live: kitchen board, same handler getOrders) | FE caller(s): components/Restaurant/EditToken.jsx, services/restaurantService.js, services/restaurantService.js |
| 57 | `GET /api/payroll/payments/:id` (payrollRoutes.js) | GET /api/payroll/payments (live: Payroll.jsx); :id read has no UI | no FE caller for this path (sibling family covered by live routes) |
| 58 | `PATCH /api/payroll/payments/:id` (payrollRoutes.js) | POST /api/payroll/payments + POST /:id/mark-paid (live: Payroll.jsx) — UI uses those verbs | FE caller(s): pages/Payroll.jsx, pages/Payroll.jsx, pages/Payroll.jsx |
| 60 | `GET /api/report/daywise` (reportRoutes.js) | GET /api/reports/summary (live: Reports.jsx) — the singular /report mount is a dead alias | FE caller(s): pages/Reports.jsx |
| 61 | `GET /api/report/items` (reportRoutes.js) | GET /api/reports/summary (live: Reports.jsx) | FE caller(s): pages/Reports.jsx |
| 62 | `GET /api/reports/` (reportsRoutes.js) | GET /api/reports/summary (live: Reports.jsx, same handler summary) | FE caller(s): pages/Reports.jsx |
| 63 | `GET /api/reports/data` (reportsRoutes.js) | GET /api/reports/summary (live) + GET /api/reports-suite/:key (live: 3 call sites) | FE caller(s): pages/Reports.jsx, pages/reports/ReportsSuite.jsx, pages/reports/ReportsSuite.jsx |
| 64 | `GET /api/restaurant/` (restaurantRoutes.js) | GET /api/restaurant/bills (live: 7 call sites, same handler getBills) | FE caller(s): components/Restaurant/Payment.jsx, components/Restaurant/PaymentBills.jsx, components/Restaurant/Roomitem.jsx |
| 65 | `GET /api/restaurant/payment` (restaurantRoutes.js) | GET /api/restaurant/bills (live, same handler getBills) | FE caller(s): components/Restaurant/Payment.jsx, components/Restaurant/PaymentBills.jsx, components/Restaurant/Roomitem.jsx |
| 66 | `GET /api/restaurant/payment-bills` (restaurantRoutes.js) | GET /api/restaurant/bills (live, same handler getBills) | FE caller(s): components/Restaurant/Payment.jsx, components/Restaurant/PaymentBills.jsx, components/Restaurant/Roomitem.jsx |
| 67 | `GET /api/restaurant/room-items` (restaurantRoutes.js) | GET /api/restaurant/order (live: 2 call sites, same handler getOrders) | FE caller(s): components/Restaurant/Payment.jsx, services/restaurantService.js, services/restaurantService.js |
| 68 | `GET /api/restaurant/bill` (restaurantRoutes.js) | GET /api/restaurant/bills (live, same handler getBills) | FE caller(s): components/Restaurant/Payment.jsx, components/Restaurant/PaymentBills.jsx, components/Restaurant/Roomitem.jsx |
| 70 | `GET /api/roles/permissions` (roleRoutes.js) | GET /api/roles (live: Payroll.jsx area) — catalog read has no UI | no FE caller for this path (sibling family covered by live routes) |
| 72 | `GET /api/roles/:id` (roleRoutes.js) | GET /api/roles (live list); :id read has no UI | no FE caller for this path (sibling family covered by live routes) |
| 74 | `GET /api/roles/:id/permissions` (roleRoutes.js) | GET /api/roles (live) — per-role permissions read has no UI | no FE caller for this path (sibling family covered by live routes) |
| 75 | `PUT /api/roles/:id/permissions` (roleRoutes.js) | GET /api/roles (live) — permission assignment has no UI | no FE caller for this path (sibling family covered by live routes) |
| 76 | `DELETE /api/room-service/menu/:id` (roomServiceRoutes.js) | GET+POST /api/room-service/menu (live) — read/create only today; delete has no UI | no FE caller for this path (sibling family covered by live routes) |
| 77 | `GET /api/room-service/order/:roomNumber` (roomServiceRoutes.js) | POST /api/room-service/order/add (live) + GET /api/room-service/rooms (live) — order read-back has no UI | no FE caller for this path (sibling family covered by live routes) |
| 79 | `GET /api/room-service/order-items/:orderId` (roomServiceRoutes.js) | POST /api/room-service/order/add (live) — item read-back has no UI | FE caller(s): services/roomService.js, services/roomService.js, services/roomService.js |
| 81 | `GET /api/room-service/bill/:roomNumber` (roomServiceRoutes.js) | POST /api/room-service/order/add (live) — bill read has no UI | FE caller(s): services/roomService.js, services/roomService.js, services/roomService.js |
| 82 | `PUT /api/room-service/order/:orderId/status` (roomServiceRoutes.js) | POST /api/room-service/order/add (live); delivery status moves via /api/room-service-delivery (live: 6 call sites) | FE caller(s): components/Restaurant/WaiterAssignmentCard.jsx, components/Restaurant/WaiterAssignmentCard.jsx, pages/WaiterDeliveryQueue.jsx |
| 83 | `GET /api/salary/employees` (salaryRoutes.js) | GET /api/salary (live: Salary page) | no FE caller for this path (sibling family covered by live routes) |
| 84 | `GET /api/salary/me` (salaryRoutes.js) | GET /api/salary (live); the self-view has no UI | no FE caller for this path (sibling family covered by live routes) |
| 85 | `GET /api/salary/me/attendance` (salaryRoutes.js) | GET /api/attendance/me/salary (live: the per-user salary view lives under /attendance) | FE caller(s): pages/MyAttendance.jsx |
| 86 | `GET /api/salary/:userId` (salaryRoutes.js) | GET /api/salary (live list); per-user read has no UI | no FE caller for this path (sibling family covered by live routes) |

## GAP — backend-only features, suggested UI placement for HAG-12 (22)

| # | Route | Suggested UI placement |
|---|---|---|
| 29 | `GET /api/employees/departments` (employeeRoutes.js) | HAG-12: department picker on the Employees page (feeds the create/edit form) |
| 30 | `GET /api/employees/designations` (employeeRoutes.js) | HAG-12: designation picker on the Employees page |
| 31 | `GET /api/employees/stats` (employeeRoutes.js) | HAG-12: HR headcount strip on a people/dashboard page |
| 34 | `POST /api/employees/` (employeeRoutes.js) | HAG-12: employee create form on the Employees page (POST /api/employees) |
| 35 | `GET /api/employees/:id` (employeeRoutes.js) | HAG-12: employee detail view on the Employees page |
| 36 | `PATCH /api/employees/:id` (employeeRoutes.js) | HAG-12: employee edit form on the Employees page |
| 37 | `GET /api/housekeeping/parameters` (housekeepingRoutes.js) | HAG-12: housekeeping parameters dialog (read current values via GET) |
| 38 | `POST /api/housekeeping/parameters` (housekeepingRoutes.js) | HAG-12: same parameters dialog as #37 (both verbs are one feature) |
| 51 | `GET /api/notifications/` (notificationRoutes.js) | HAG-12: global notification bell in the app header (GET /api/notifications) |
| 52 | `POST /api/notifications/:id/read` (notificationRoutes.js) | HAG-12: notification bell — mark single item read |
| 53 | `POST /api/notifications/mark-all-read` (notificationRoutes.js) | HAG-12: notification bell — mark all read |
| 54 | `POST /api/notifications/` (notificationRoutes.js) | HAG-12: admin create-notification from a notifications admin page |
| 55 | `POST /api/payment/` (paymentRoutes.js) | HAG-12: generic payment capture (booking top-up) on the front-desk booking view |
| 56 | `GET /api/payment/` (paymentRoutes.js) | HAG-12: payment history list on the front-desk view |
| 59 | `GET /api/payroll/estimate/:employeeId` (payrollRoutes.js) | HAG-12: 'estimate salary' button on the Payroll page |
| 69 | `GET /api/restaurant/split-bills` (restaurantRoutes.js) | HAG-12: split-bill list/detail view on the restaurant POS page |
| 71 | `POST /api/roles/` (roleRoutes.js) | HAG-12: role management (create + assign permissions) on an admin Roles page |
| 73 | `PATCH /api/roles/:id` (roleRoutes.js) | HAG-12: role edit on the admin Roles page |
| 78 | `PUT /api/room-service/order/:roomNumber/pay` (roomServiceRoutes.js) | HAG-12: room-service pay step on the room-service order view |
| 80 | `POST /api/room-service/bill` (roomServiceRoutes.js) | HAG-12: room-service bill action on the room-service order view |
| 87 | `POST /api/salary/:userId/recalculate` (salaryRoutes.js) | HAG-12: 'recalculate attendance' button next to salary save on the Salary page |
| 88 | `GET /api/zk/machines/:id/pulls` (zkRoutes.js) | HAG-12: sync-history panel per ZK machine on the ZkAttendance page |
