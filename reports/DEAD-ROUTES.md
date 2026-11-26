# DEAD-ROUTES: 88 unused backend routes, redundant vs genuine gaps

Classification of the [DEAD] list in reports/API-AUDIT.json (main @ 449da93). Evidence chain: (1) same-handler sibling that the UI calls; (2) resource-keyword cross-check against 607 live calls; (3) remainder = GAP.

## Totals
- REDUNDANT: 59 - keep as-is, no UI needed (feature reachable another way)
- GAP: 29 - backend features with no live frontend caller (HAG-12 UI candidates)

### InvoiceRoutes.js (1)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| PATCH | `/payment-status/:id` | **GAP** | Hotel / Front Desk (invoices) - no live frontend caller of this feature |

### accountsRoutes.js (4)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/dashboard` | **GAP** | Accounts - no live frontend caller of this feature |
| GET | `/` | **GAP** | Accounts - no live frontend caller of this feature |
| GET | `/transactions/:id` | **REDUNDANT** | GET /accounts/transactions @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx; PUT /accounts/transactions/${editingRecord.id} @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx; DELETE /accounts/transactions/${id} @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx |
| GET | `/payment-settings/:id` | **REDUNDANT** | GET /accounts/payment-settings @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx; GET /accounts/payment-history @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx; GET /accounts/payment-history @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx |

### attendanceRoutes.js (3)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/payroll` | **REDUNDANT** | GET /accounts/payroll @ Maa-Baglamkhi-Resort-frontend\src\pages\Accounts.jsx |
| POST | `/mark` | **REDUNDANT** | POST /attendance/mark-holiday @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; POST /attendance/mark-own @ Maa-Baglamkhi-Resort-frontend\src\pages\MyAttendance.jsx |
| PATCH | `/:id` | **GAP** | Attendance - no live frontend caller of this feature |

### banquetRoutes.js (3)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/config` | **REDUNDANT** | PUT /banquet/config @ Maa-Baglamkhi-Resort-frontend\src\pages\Banquet.jsx; GET /web/dining/config @ Maa-Baglamkhi-Resort-frontend\src\services\websiteDiningService.js |
| GET | `/halls` | **REDUNDANT** | PUT /banquet/halls/${editingHallId} @ Maa-Baglamkhi-Resort-frontend\src\pages\Banquet.jsx; POST /banquet/halls @ Maa-Baglamkhi-Resort-frontend\src\pages\Banquet.jsx; DELETE /banquet/halls/${hallDeleteTarget.id} @ Maa-Baglamkhi-Resort-frontend\src\pages\Banquet.jsx |
| GET | `/bookings` | **GAP** | Banquet - no live frontend caller of this feature |

### bookingRoutes.js (12)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **GAP** | Hotel / Front Desk - no live frontend caller of this feature |
| GET | `/payment-history` | **REDUNDANT** | GET /hotel/booking-history @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\AllBooking.jsx; GET /hotel/payment-history/${booking.bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx; GET /hotel/payment-history/${bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx |
| GET | `/room-tariff` | **REDUNDANT** | POST /hotel/room-tariff/${bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx; GET /hotel/room-blocks @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\OccupancyForecast.jsx; GET /hotel/room-blocks?status=Active @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\Room.jsx |
| GET | `/communication` | **GAP** | Hotel / Front Desk - no live frontend caller of this feature |
| GET | `/booking/:id` | **REDUNDANT** | GET /hotel/full-booking/${selectedRoom.booking.bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; PUT /hotel/full-booking/${selectedRoom.booking.bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; PUT /hotel/${action}/${selectedRoom.booking.bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx |
| GET | `/rooms` | **REDUNDANT** | PUT /hotel/rooms/state/${roomNumber} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; PUT /hotel/rooms/state/${roomNumber} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /hotel/rooms/setup @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx |
| GET | `/rooms-availability` | **REDUNDANT** | PUT /hotel/rooms/state/${roomNumber} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; PUT /hotel/rooms/state/${roomNumber} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /hotel/rooms/setup @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx |
| POST | `/rooms/validate-availability` | **REDUNDANT** | PUT /hotel/rooms/state/${roomNumber} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; PUT /hotel/rooms/state/${roomNumber} @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /hotel/rooms/setup @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx |
| DELETE | `/folio/entry/:entryId` | **REDUNDANT** | GET /hotel/folio/${bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx; GET /hotel/folio/${bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx; GET /hotel/folio/${booking.bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx |
| GET | `/room-block/` | **REDUNDANT** | POST /hotel/room-tariff/${bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx; GET /hotel/room-blocks @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\OccupancyForecast.jsx; GET /hotel/room-blocks?status=Active @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\Room.jsx |
| POST | `/room-blocks/` | **REDUNDANT** | POST /hotel/room-tariff/${bookingId} @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\BookingFlow.jsx; GET /hotel/room-blocks @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\OccupancyForecast.jsx; GET /hotel/room-blocks?status=Active @ Maa-Baglamkhi-Resort-frontend\src\components\Hotel\Room.jsx |
| GET | `/guests/search` | **GAP** | Hotel / Front Desk - no live frontend caller of this feature |

### chefRoutes.js (4)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **GAP** | Chef dashboard - no live frontend caller of this feature |
| PUT | `/orders/:id/cancel` | **REDUNDANT** | PUT /banquet/${editingBookingId}/cancel @ Maa-Baglamkhi-Resort-frontend\src\pages\Banquet.jsx; PUT /banquet/${booking.id}/cancel @ Maa-Baglamkhi-Resort-frontend\src\pages\Banquet.jsx; GET /chef/orders @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js |
| PUT | `/orders/:id/save` | **REDUNDANT** | GET /chef/orders @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js; PUT /chef/orders/${id}/status @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js; PUT /kitchen/orders/${id}/save @ Maa-Baglamkhi-Resort-frontend\src\services\restaurantService.js |
| DELETE | `/orders/:id` | **REDUNDANT** | GET /chef/orders @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js; PUT /chef/orders/${id}/status @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js |

### dashboardRoutes.js (1)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **GAP** | Dashboards - no live frontend caller of this feature |

### employeeRoutes.js (8)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/departments` | **GAP** | HR / Employees - no live frontend caller of this feature |
| GET | `/designations` | **GAP** | HR / Employees - no live frontend caller of this feature |
| GET | `/stats` | **REDUNDANT** | GET /inventory/stats @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryFlow.jsx; GET /assignments/stats @ Maa-Baglamkhi-Resort-frontend\src\pages\Assignments.jsx |
| GET | `/attendance/employees` | **REDUNDANT** | GET /attendance/employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\ZkAttendance.jsx |
| GET | `/employees` | **REDUNDANT** | GET /attendance/employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\ZkAttendance.jsx |
| POST | `/` | **REDUNDANT** | GET /attendance/employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\ZkAttendance.jsx |
| GET | `/:id` | **GAP** | HR / Employees - no live frontend caller of this feature |
| PATCH | `/:id` | **GAP** | HR / Employees - no live frontend caller of this feature |

### housekeepingRoutes.js (4)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/parameters` | **GAP** | Housekeeping - no live frontend caller of this feature |
| POST | `/parameters` | **GAP** | Housekeeping - no live frontend caller of this feature |
| GET | `/inspections/:id` | **REDUNDANT** | GET /housekeeping/inspections @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\InspectionChecklistModal.jsx; POST /housekeeping/inspections @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\InspectionChecklistModal.jsx |
| DELETE | `/lost-found/:id` | **REDUNDANT** | GET /housekeeping/lost-found @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\LostFoundModal.jsx; PUT /housekeeping/lost-found/${id} @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\LostFoundModal.jsx; POST /housekeeping/lost-found @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\LostFoundModal.jsx |

### inventoryRoutes.js (9)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/items` | **REDUNDANT** | PUT /token/item @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\EditToken.jsx; PUT /token/item @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\EditToken.jsx; POST /token/item @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\MenuPage.jsx |
| GET | `/vendors` | **REDUNDANT** | GET /inventory/setup/vendors @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryFlow.jsx; GET /inventory-masters/vendors @ Maa-Baglamkhi-Resort-frontend\src\pages\InventoryHubPage.jsx |
| GET | `/menu-list` | **REDUNDANT** | GET /inventory-masters/menu-categories @ Maa-Baglamkhi-Resort-frontend\src\pages\InventoryHubPage.jsx; GET /inventory-masters/menu-categories @ Maa-Baglamkhi-Resort-frontend\src\pages\InventoryMenuItemsPage.jsx; GET /menu-recipes/inventory-items @ Maa-Baglamkhi-Resort-frontend\src\services\menuRecipeService.js |
| GET | `/menu-items` | **REDUNDANT** | GET /inventory-masters/menu-categories @ Maa-Baglamkhi-Resort-frontend\src\pages\InventoryHubPage.jsx; GET /inventory-masters/menu-categories @ Maa-Baglamkhi-Resort-frontend\src\pages\InventoryMenuItemsPage.jsx; GET /menu-recipes/menu-items @ Maa-Baglamkhi-Resort-frontend\src\services\menuRecipeService.js |
| GET | `/reports` | **REDUNDANT** | GET /inventory/audit/report @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/reports/stock-flow @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/audit/report @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx |
| GET | `/chef-issues/:id` | **REDUNDANT** | GET /inventory/chef-issues @ Maa-Baglamkhi-Resort-frontend\src\pages\AdminChefIssuesPage.jsx; GET /inventory/chef-issues${qs ?  @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js; POST /inventory/chef-issues @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js |
| POST | `/purchases` | **REDUNDANT** | GET /inventory/purchases @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryFlow.jsx |
| POST | `/stock` | **REDUNDANT** | GET /inventory/stock-ledger @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/reports/stock-flow @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/stock-ledger @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx |
| POST | `/stock-action` | **REDUNDANT** | GET /inventory/stock-ledger @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/reports/stock-flow @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/stock-ledger @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx |

### kitchenRoutes.js (1)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **GAP** | Kitchen / KOT - no live frontend caller of this feature |

### notificationRoutes.js (4)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **REDUNDANT** | GET /housekeeping/notifications @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /housekeeping/notifications @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /housekeeping/notifications @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\Housekeeping.jsx |
| POST | `/:id/read` | **REDUNDANT** | POST /chef/notifications/${id}/read @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js; POST /chef/notifications/mark-all-read @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js |
| POST | `/mark-all-read` | **REDUNDANT** | POST /chef/notifications/${id}/read @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js; POST /chef/notifications/mark-all-read @ Maa-Baglamkhi-Resort-frontend\src\services\chefService.js |
| POST | `/` | **REDUNDANT** | GET /housekeeping/notifications @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /housekeeping/notifications @ Maa-Baglamkhi-Resort-frontend\src\components\Dashboard\Stayover.jsx; GET /housekeeping/notifications @ Maa-Baglamkhi-Resort-frontend\src\components\Housekeeping\Housekeeping.jsx |

### paymentRoutes.js (2)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| POST | `/` | **REDUNDANT** | GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; POST /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx |
| GET | `/` | **REDUNDANT** | GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; POST /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx |

### payrollRoutes.js (3)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/payments/:id` | **REDUNDANT** | GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; POST /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx |
| PATCH | `/payments/:id` | **REDUNDANT** | GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; POST /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx |
| GET | `/estimate/:employeeId` | **GAP** | Payroll - no live frontend caller of this feature |

### reportRoutes.js (2)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/daywise` | **GAP** | Reports - no live frontend caller of this feature |
| GET | `/items` | **REDUNDANT** | PUT /token/item @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\EditToken.jsx; PUT /token/item @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\EditToken.jsx; POST /token/item @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\MenuPage.jsx |

### reportsRoutes.js (2)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **REDUNDANT** | GET /inventory/audit/report @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /inventory/audit/report @ Maa-Baglamkhi-Resort-frontend\src\components\Inventory\InventoryDashboard.jsx; GET /attendance/report @ Maa-Baglamkhi-Resort-frontend\src\pages\Reports.jsx |
| GET | `/data` | **GAP** | Reports - no live frontend caller of this feature |

### restaurantRoutes.js (6)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/` | **GAP** | Restaurant POS - no live frontend caller of this feature |
| GET | `/payment` | **REDUNDANT** | GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; POST /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /payroll/payments @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx |
| GET | `/payment-bills` | **REDUNDANT** | GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Payment.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\PaymentBills.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Roomitem.jsx |
| GET | `/room-items` | **REDUNDANT** | GET /restaurant/order-items/${orderId} @ Maa-Baglamkhi-Resort-frontend\src\services\restaurantService.js |
| GET | `/bill` | **REDUNDANT** | GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Payment.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\PaymentBills.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Roomitem.jsx |
| GET | `/split-bills` | **REDUNDANT** | GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Payment.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\PaymentBills.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Roomitem.jsx |

### roleRoutes.js (6)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/permissions` | **GAP** | Admin / Roles - no live frontend caller of this feature |
| POST | `/` | **REDUNDANT** | GET /roles @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx |
| GET | `/:id` | **GAP** | Admin / Roles - no live frontend caller of this feature |
| PATCH | `/:id` | **GAP** | Admin / Roles - no live frontend caller of this feature |
| GET | `/:id/permissions` | **GAP** | Admin / Roles - no live frontend caller of this feature |
| PUT | `/:id/permissions` | **GAP** | Admin / Roles - no live frontend caller of this feature |

### roomServiceRoutes.js (7)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| DELETE | `/menu/:id` | **REDUNDANT** | POST /room-service-delivery/assign-waiter @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; POST /room-service-delivery/mark-delivered/${assignmentId} @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; GET /room-service-delivery/waiter-queue @ Maa-Baglamkhi-Resort-frontend\src\pages\WaiterDeliveryQueue.jsx |
| GET | `/order/:roomNumber` | **REDUNDANT** | POST /room-service-delivery/assign-waiter @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; POST /room-service-delivery/mark-delivered/${assignmentId} @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; GET /room-service-delivery/waiter-queue @ Maa-Baglamkhi-Resort-frontend\src\pages\WaiterDeliveryQueue.jsx |
| PUT | `/order/:roomNumber/pay` | **REDUNDANT** | PUT /restaurant/order/${invoice.table}/pay @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Payment.jsx; POST /room-service-delivery/assign-waiter @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; POST /room-service-delivery/mark-delivered/${assignmentId} @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx |
| GET | `/order-items/:orderId` | **REDUNDANT** | POST /room-service-delivery/assign-waiter @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; POST /room-service-delivery/mark-delivered/${assignmentId} @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; GET /room-service-delivery/waiter-queue @ Maa-Baglamkhi-Resort-frontend\src\pages\WaiterDeliveryQueue.jsx |
| POST | `/bill` | **REDUNDANT** | GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Payment.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\PaymentBills.jsx; GET /restaurant/bills @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\Roomitem.jsx |
| GET | `/bill/:roomNumber` | **REDUNDANT** | POST /room-service-delivery/assign-waiter @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; POST /room-service-delivery/mark-delivered/${assignmentId} @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; GET /room-service-delivery/waiter-queue @ Maa-Baglamkhi-Resort-frontend\src\pages\WaiterDeliveryQueue.jsx |
| PUT | `/order/:orderId/status` | **REDUNDANT** | POST /room-service-delivery/assign-waiter @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; POST /room-service-delivery/mark-delivered/${assignmentId} @ Maa-Baglamkhi-Resort-frontend\src\components\Restaurant\WaiterAssignmentCard.jsx; PATCH /assignments/${item.id}/status @ Maa-Baglamkhi-Resort-frontend\src\pages\assignmentnotification.jsx |

### salaryRoutes.js (5)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/employees` | **REDUNDANT** | GET /attendance/employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\Payroll.jsx; GET /employees @ Maa-Baglamkhi-Resort-frontend\src\pages\ZkAttendance.jsx |
| GET | `/me` | **REDUNDANT** | GET /auth/me @ Maa-Baglamkhi-Resort-frontend\src\App.jsx; GET /auth/me @ Maa-Baglamkhi-Resort-frontend\src\components\ProtectedRoute.jsx; GET /auth/me @ Maa-Baglamkhi-Resort-frontend\src\components\RoleHomeRedirect.jsx |
| GET | `/me/attendance` | **REDUNDANT** | GET /attendance @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; POST /attendance @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx; POST /attendance @ Maa-Baglamkhi-Resort-frontend\src\pages\Attendance.jsx |
| GET | `/:userId` | **GAP** | Payroll / Salary - no live frontend caller of this feature |
| POST | `/:userId/recalculate` | **GAP** | Payroll / Salary - no live frontend caller of this feature |

### zkRoutes.js (1)

| method | route | verdict | evidence / suggested area |
| --- | --- | --- | --- |
| GET | `/machines/:id/pulls` | **GAP** | Attendance (ZKTime) - no live frontend caller of this feature |