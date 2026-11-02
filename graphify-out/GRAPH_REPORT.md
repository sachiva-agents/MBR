# Graph Report - MBR  (2026-11-02)

## Corpus Check
- Large corpus: 555 files · ~626,953 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 4255 nodes · 9421 edges · 257 communities (173 shown, 84 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 401 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Accounts Ledger Controller
- Frontend App Shell & Routes
- Invoice & Folio Verify Scripts
- Attendance UI Components
- Hotel Booking & Guest Model
- Attendance & Payroll Controller
- Inventory Operations Controller
- Backend Boot & Express App
- Banquet Billing & WhatsApp UI
- Auth, JWT & Audit Middleware
- Booking Advance & Cancel UI
- Banquet Halls & Bookings API
- Collections & Reports UI
- Inventory Dashboard UI
- Restaurant & Dining Model
- Housekeeping Controller
- Frontend API Client Layer
- Customer Invoice & History UI
- Report Charts Components
- Booking Wizard Steps UI
- Banquet Booking & Addons Model
- Hotel Booking Flow UI
- E2E & Diagnostic Scripts
- Room Service Controller
- Dashboard UI (New Dash, Topbar)
- Print Queue Controller
- Banquet Bookings Controller V2
- Reports Controller
- POS Payment & Receipt UI
- Order & Menu Actions Model
- Hotel Booking Controller
- Route Guards & Role Redirects
- Kitchen KOT UI Cards
- Inventory Flow UI
- Shared DB Model Suite
- Frontend Tooling & Dependencies
- Inventory Masters UI Config
- Database Probe Scripts
- PDF & Print Utilities
- Inventory Data Model
- Dashboard Notification Store
- Frontend Pages & URL Config
- Dashboards Controller
- Restaurant POS Controller
- Housekeeping Stayover UI
- Security & CORS Config
- Revenue Charts UI
- Backup & Scheduler Controller
- Employee & HR Controller
- Kitchen & KOT Controller
- Users & Auth Controller
- Inventory Adjustments Model
- Assignments Page UI
- Accounts Expansion Model
- API Registry & Audit Reports
- Folio & Bill UI
- Inventory Masters Module Pages
- Backend Dependencies Manifest
- Inventory Masters Controller
- Restaurant WhatsApp & Invoice PDF
- Housekeeping Assignments Model
- API Routes Test Suite
- Restaurant Table UI
- Community 63
- Community 64
- Community 65
- Frontend Dependencies Manifest
- Inventory Purchases UI
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 237
- Community 238
- Community 239
- Community 246
- Community 249

## God Nodes (most connected - your core abstractions)
1. `react` - 151 edges
2. `getConnection()` - 149 edges
3. `API` - 112 edges
4. `react-icons` - 100 edges
5. `AppRoutes()` - 76 edges
6. `pool` - 75 edges
7. `react-router-dom` - 67 edges
8. `getRequestActor()` - 55 edges
9. `query()` - 52 edges
10. `localDate()` - 50 edges

## Surprising Connections (you probably didn't know these)
- `HAG-46 report: accounts schema drift (9 tables folded into schema-v4.sql)` --references--> `Accounts Module (double-entry ledger, bank reconciliation, petty cash, GST)`  [INFERRED]
  reports/HAG-46-accounts-schema-drift.md → README.md
- `resort_management database (live, 127.0.0.1:3306)` --semantically_similar_to--> `resort_management1 database`  [INFERRED] [semantically similar]
  hive/reports/HAG-210-token-create-500.md → README.md
- `migrations/20261018_accounts_schema_drift.sql (additive, IF NOT EXISTS guarded)` --semantically_similar_to--> `ensureColumn portable migration (SHOW COLUMNS pre-check)`  [INFERRED] [semantically similar]
  reports/HAG-46-accounts-schema-drift.md → README.md
- `HAG-32/33/34 report: dashboard, reports, hotel metrics aggregates (VERIFIED LIVE)` --references--> `Maa Baglamukhi Resort Management Platform (MBR)`  [INFERRED]
  reports/HAG-37-dashboard-metrics.md → README.md
- `HAG-52 report: banquet INSERT arity mismatch` --references--> `Maa Baglamukhi Resort Management Platform (MBR)`  [INFERRED]
  reports/HAG-52-banquet-arity.md → README.md

## Import Cycles
- 2-file cycle: `Maa-Baglamkhi-Resort-Backend/src/services/InvoicePrintService.js -> Maa-Baglamkhi-Resort-Backend/src/services/PrintQueue.js -> Maa-Baglamkhi-Resort-Backend/src/services/InvoicePrintService.js`
- 2-file cycle: `Maa-Baglamkhi-Resort-Backend/src/services/KitchenPrintService.js -> Maa-Baglamkhi-Resort-Backend/src/services/PrintQueue.js -> Maa-Baglamkhi-Resort-Backend/src/services/KitchenPrintService.js`
- 2-file cycle: `Maa-Baglamkhi-Resort-Backend/src/services/PrintQueue.js -> Maa-Baglamkhi-Resort-Backend/src/services/RestaurantPrintService.js -> Maa-Baglamkhi-Resort-Backend/src/services/PrintQueue.js`
- 3-file cycle: `Maa-Baglamkhi-Resort-Backend/src/services/InvoicePrintService.js -> Maa-Baglamkhi-Resort-Backend/src/services/PrintQueue.js -> Maa-Baglamkhi-Resort-Backend/src/services/RestaurantPrintService.js -> Maa-Baglamkhi-Resort-Backend/src/services/InvoicePrintService.js`

## Hyperedges (group relationships)
- **Four movement screens write to the shared stock ledger** — maa_baglamkhi_resort_backend_docs_inventory_full_documentation_vendor_inward, maa_baglamkhi_resort_backend_docs_inventory_full_documentation_stock_transfer, maa_baglamkhi_resort_backend_docs_inventory_full_documentation_waste_spoilage, maa_baglamkhi_resort_backend_docs_inventory_full_documentation_stock_audit, maa_baglamkhi_resort_backend_docs_inventory_full_documentation_stock_ledger [EXTRACTED 1.00]
- **Admin reporting suite over the v4 financial tables** — maa_baglamkhi_resort_backend_docs_reports_suite_reports_suite, maa_baglamkhi_resort_backend_docs_reports_suite_night_audit, maa_baglamkhi_resort_backend_docs_v4_schema_design_double_entry_ledger, maa_baglamkhi_resort_backend_docs_v4_schema_design_payments_consolidation [INFERRED 0.75]
- **501 stub routes and the insert/read table mismatch in the v4 inventory backend** — maa_baglamkhi_resort_backend_reports_hag_58_inventory_501s_stub_routes, maa_baglamkhi_resort_backend_reports_hag_58_inventory_501s_items_table_mismatch, src_controller_inventorycontroller, src_routes_inventoryroutes [INFERRED 0.75]
- **Backend defects flagged across the HAG-54 slices** — maa_baglamkhi_resort_frontend_reports_hag_54_accounts, maa_baglamkhi_resort_frontend_reports_hag_54_hotel_core, maa_baglamkhi_resort_frontend_reports_maa_frontend_inventoryflow, maa_baglamkhi_resort_backend_test_reports_api_routes [INFERRED 0.85]
- **Shared verification path across the slices** — maa_baglamkhi_resort_frontend_reports_maa_frontend_viteproxy, maa_baglamkhi_resort_frontend_reports_maa_frontend_apiclient, maa_baglamkhi_resort_backend_test_reports_api_routes [INFERRED 0.95]
- **Sidebar duplicate-entry avoidance around role home paths** — maa_baglamkhi_resort_frontend_reports_maa_frontend_sidebar, maa_baglamkhi_resort_frontend_reports_maa_frontend_rolehome, maa_baglamkhi_resort_frontend_reports_maa_frontend_kitchendashboard, maa_baglamkhi_resort_frontend_reports_maa_frontend_restaurantdashboard [INFERRED 0.95]
- **mysql2 pool tuple-contract bugs: asRows, half-create, and banquet overlap guard all hinge on [rows/ResultSetHeader, fields]** — reports_hag_213_asrows, reports_hag_47_pool_tuple_contract, reports_hag_52_check_booking_overlap [INFERRED 0.85]
- **GET /api/dashboard/metrics and /charts: verified live, then guarded and re-measured by later tickets** — reports_hag_37_dashboard_metrics_endpoint, reports_hag_51_dashboard_controller, reports_hag_46_accounts_transactions_table [INFERRED 0.85]
- **Double-entry accounts write path: controller writes balanced two-leg transactions + transaction_entries, fixed at the tuple level** — reports_hag_213_accounts_controller, reports_hag_213_transactions_table, reports_hag_213_transaction_entries_table [EXTRACTED 1.00]

## Communities (257 total, 84 thin omitted)

### Community 0 - "Accounts Ledger Controller"
Cohesion: 0.07
Nodes (88): ACCOUNT_SEEDS, addBankLedger(), addExpense(), addIncome(), addPaymentGatewaySetting(), addPayrollRecord(), addPurchaseOrder(), addVendorPayment() (+80 more)

### Community 1 - "Frontend App Shell & Routes"
Cohesion: 0.05
Nodes (57): App(), AppRoutes(), isValidSession(), Layout(), ROLES, DashboardFooter(), dashboardFooterHighlights, ErrorBoundary (+49 more)

### Community 2 - "Invoice & Folio Verify Scripts"
Cohesion: 0.07
Nodes (72): call(), main(), main(), q(), addEntry(), deleteEntry(), ensureSchema(), getByBooking() (+64 more)

### Community 3 - "Attendance UI Components"
Cohesion: 0.05
Nodes (56): getErrorMessage(), AttendanceForm(), LEAVE_OPTIONS, STATUS_OPTIONS, AttendanceRow(), formatCurrency(), METHOD_COLORS, normalizeLabel() (+48 more)

### Community 4 - "Hotel Booking & Guest Model"
Cohesion: 0.05
Nodes (56): http, createGuest(), crypto, generateBookingCode(), normalizeStatus(), runQuery(), STATUS_MAP, assignMissingVisitCodes() (+48 more)

### Community 5 - "Attendance & Payroll Controller"
Cohesion: 0.06
Nodes (62): buildRangeWhere(), calculateDaySalary(), calculateMySalary(), currentMonthParts(), deleteAttendanceRecord(), deleteHolidayCalendarEntry(), deriveMethod(), getAllAttendance() (+54 more)

### Community 6 - "Inventory Operations Controller"
Cohesion: 0.13
Nodes (65): beginTransaction(), columnExists(), commitTransaction(), createChefIssue(), createItem(), createPurchaseOrder(), createVendorInward(), createVendorPayment() (+57 more)

### Community 7 - "Backend Boot & Express App"
Cohesion: 0.04
Nodes (25): app, bcrypt, bootstrapSchema(), cookieParser, cors, corsOptions, ensureDefaultStaffLogins(), express (+17 more)

### Community 8 - "Banquet Billing & WhatsApp UI"
Cohesion: 0.07
Nodes (55): BanquetBill(), BanquetWhatsAppModal(), buildFullNumber(), COUNTRY_CODES, STATUS, STATUS_LABELS, stripCountryCode(), validateLocalNumber() (+47 more)

### Community 9 - "Auth, JWT & Audit Middleware"
Cohesion: 0.05
Nodes (42): getJwtSecret(), getAuditLogs(), authMiddleware(), jwt, normalizeRole(), ROLE_ALIASES, roleMiddleware(), ASSIGNEES (+34 more)

### Community 10 - "Booking Advance & Cancel UI"
Cohesion: 0.12
Nodes (47): Advance(), formatCurrency(), PAYMENT_MODES, BookingCancelAction(), clearBookingSession(), getBookingDraft(), getStoredBookingCode(), getStoredBookingId() (+39 more)

### Community 11 - "Banquet Halls & Bookings API"
Cohesion: 0.06
Nodes (39): formatINR(), getBookingRowById(), getHallName(), getPublicBaseUrl(), round2(), sendBanquetInvoiceWhatsApp(), round2(), sendInvoiceWhatsApp() (+31 more)

### Community 12 - "Collections & Reports UI"
Cohesion: 0.10
Nodes (51): Card(), CollectionReport(), DAY_KEYS, METHOD_KEYS, REF_KEYS, STATUS_KEYS, statusTone(), TOTAL_KEYS (+43 more)

### Community 13 - "Inventory Dashboard UI"
Cohesion: 0.09
Nodes (52): API_BACKED_MASTER_SECTIONS, Badge(), buildInitialForm(), buildSelectOptions(), DataTable(), DEFAULT_MASTER_DATA, findSegmentPreset(), findUnitPreset() (+44 more)

### Community 14 - "Restaurant & Dining Model"
Cohesion: 0.06
Nodes (28): assert, bootstrapLegacyBills(), buildResolvedWaiterName(), chargeBillToRoom(), createBill(), createBillRecord(), createRestaurantBill(), deleteTable() (+20 more)

### Community 15 - "Housekeeping Controller"
Cohesion: 0.06
Nodes (35): completeNotification(), createInspection(), deleteAmenity(), deleteLostFound(), emitHousekeepingUpdate(), formatBusyUntil(), getActiveTaskForAssignee(), getActiveTaskForRoom() (+27 more)

### Community 16 - "Frontend API Client Layer"
Cohesion: 0.06
Nodes (31): API, PRIORITY_CONFIG, STATUS_CONFIG, CreateUser(), STATUS_CONFIG, STATUS_ORDER, BookingHistory(), dedupeBookings() (+23 more)

### Community 17 - "Customer Invoice & History UI"
Cohesion: 0.08
Nodes (44): CustomerHistoryModal(), digits(), formatDay(), formatINR(), isQueryNumberish(), KpiTile(), matches(), pill() (+36 more)

### Community 18 - "Report Charts Components"
Cohesion: 0.09
Nodes (45): Card(), CustomPieTooltip(), EmptyChartState(), formatCompactNumber(), groupByDateSum(), groupCount(), groupSum(), palette (+37 more)

### Community 19 - "Booking Wizard Steps UI"
Cohesion: 0.07
Nodes (41): actionButtonClassName(), BookingSteps(), MGMT_LINKS, WIZARD_STEPS, buildUploadUrl(), documentTypeLabels, formatCurrency(), formatDate() (+33 more)

### Community 20 - "Banquet Booking & Addons Model"
Cohesion: 0.05
Nodes (9): BanquetBookingAddons, BillSplits, Designations, InventoryLocations, InventoryPurchases, RolePermissions, RoomCategoryAmenities, UserSessions (+1 more)

### Community 21 - "Hotel Booking Flow UI"
Cohesion: 0.08
Nodes (40): bookingAPI, BookingFlow(), buildUploadUrl(), cardActionBtn(), DOCUMENT_TYPE_LABELS, documentTypeOptions, DocumentUploadModal(), emptyForm() (+32 more)

### Community 22 - "E2E & Diagnostic Scripts"
Cohesion: 0.05
Nodes (28): fs, http, files, fs, modelsDir, path, files, fs (+20 more)

### Community 23 - "Room Service Controller"
Cohesion: 0.06
Nodes (7): computeTotals(), generateBillForRoom(), parseMoney(), RoomCategories, addRoom(), ensureSchema(), runQuery()

### Community 24 - "Dashboard UI (New Dash, Topbar)"
Cohesion: 0.10
Nodes (22): stats, CategoryInventory(), formatCurrency(), getExpiryStatus(), TokenPage(), DELIVERY_ETA_OPTIONS, WaiterAssignmentCard(), formatCurrency() (+14 more)

### Community 25 - "Print Queue Controller"
Cohesion: 0.09
Nodes (10): fs, path, queuePrint(), reprint(), payBill(), fs, path, PrintService (+2 more)

### Community 26 - "Banquet Bookings Controller V2"
Cohesion: 0.14
Nodes (29): buildFinancialSnapshot(), checkBookingOverlap(), createBanquetBooking(), deleteBanquetBooking(), generateBanquetBill(), getBanquetDashboard(), normalizePaymentStatus(), refundBanquetBooking() (+21 more)

### Community 27 - "Reports Controller"
Cohesion: 0.13
Nodes (31): columnExists(), columnMapCache, getAllBillsRows(), getBanquetHallRateColumn(), getColumnMap(), getReportData(), getRestaurantBillsColumnMap(), normalizePaymentMode() (+23 more)

### Community 28 - "POS Payment & Receipt UI"
Cohesion: 0.13
Nodes (31): buildReceiptHtml(), clearPersistedInvoice(), createBoardCardKey(), createSessionKey(), escapeReceiptHtml(), FeatureModal(), formatCurrency(), formatDate() (+23 more)

### Community 29 - "Order & Menu Actions Model"
Cohesion: 0.15
Nodes (31): cancelOrder(), removeOrder(), addItemActionRequest(), addMenuItem(), addOrderItem(), deleteMenuItem(), deleteOrder(), deleteTable() (+23 more)

### Community 30 - "Hotel Booking Controller"
Cohesion: 0.14
Nodes (32): cancelBooking(), checkInBooking(), checkOutBooking(), createGuest(), crypto, deleteBooking(), fireWhatsAppInvoice(), getAllBookings() (+24 more)

### Community 31 - "Route Guards & Role Redirects"
Cohesion: 0.12
Nodes (25): isValidSession(), ProtectedRoute(), isValidSession(), RoleHomeRedirect(), ROLE_LABEL_MAP, SECTION_LABELS, SECTION_ORDER, Sidebar() (+17 more)

### Community 32 - "Kitchen KOT UI Cards"
Cohesion: 0.12
Nodes (24): formatCountdown(), formatTime(), getRemainingMinutes(), KitchenOrderCard(), PREP_TIME_OPTIONS, STATUS_CONFIG, toMillis(), KitchenOrdersList() (+16 more)

### Community 33 - "Inventory Flow UI"
Cohesion: 0.13
Nodes (27): ACTION_TABS, ActionModal(), AddStockModal(), c, DRAWER_TABS, EmptyState(), FLOW_STEPS, FlowRail() (+19 more)

### Community 34 - "Shared DB Model Suite"
Cohesion: 0.07
Nodes (5): BanquetPricingPlans, Employees, InventoryConsumption, SalaryPayments, mysql

### Community 35 - "Frontend Tooling & Dependencies"
Cohesion: 0.10
Nodes (28): devDependencies, eslint@^9.39.1, @eslint/js@^9.39.1, eslint-plugin-react-hooks@^7.0.1, eslint-plugin-react-refresh@^0.4.24, globals@^16.5.0, jest@^30.3.0, playwright@^1.58.2 (+20 more)

### Community 36 - "Inventory Masters UI Config"
Cohesion: 0.14
Nodes (22): buildInitialMasterForm(), INVENTORY_MASTER_SECTIONS, FieldInput(), formatLabel(), InventoryMastersManager(), c, CategoryFormModal(), ConfirmDelete() (+14 more)

### Community 37 - "Database Probe Scripts"
Cohesion: 0.09
Nodes (11): main(), q(), TABLES, main(), q(), mysql, originalExecute, originalGetConnection (+3 more)

### Community 38 - "PDF & Print Utilities"
Cohesion: 0.09
Nodes (23): getPrinterStatus(), immediatePrintInvoice(), checkPrinterStatus(), drawTaxInvoice(), ensureDir(), { exec }, execAsync, formatINR() (+15 more)

### Community 39 - "Inventory Data Model"
Cohesion: 0.13
Nodes (20): columnExists(), deleteAccountsPurchaseOrderMirror(), deleteAccountsVendorPaymentMirror(), ensureAccountsMirrorSchema(), ensureSchema(), findInventoryItem(), getInventoryItemDetails(), getInventoryStock() (+12 more)

### Community 40 - "Dashboard Notification Store"
Cohesion: 0.13
Nodes (20): clearDashboardNotifications(), getDashboardNotifications(), pushDashboardNotification(), safeParse(), safeStringify(), upsertDashboardNotification(), Header(), addCompletedCleaningLog() (+12 more)

### Community 41 - "Frontend Pages & URL Config"
Cohesion: 0.12
Nodes (21): getBackendBaseURL(), BanquetHallCard(), buildMenuPlaceholder(), createOrderEntry(), getOrderItemKey(), MenuPage(), normalizeCategory(), normalizeItemName() (+13 more)

### Community 42 - "Dashboards Controller"
Cohesion: 0.19
Nodes (25): classifyRoomStatus(), columnExists(), detectDateColumn(), formatDateKey(), getArrivalMetrics(), getCharts(), getCount(), getFoodSalesChart() (+17 more)

### Community 43 - "Restaurant POS Controller"
Cohesion: 0.13
Nodes (21): addTable(), buildBillDateFilter(), buildResolvedWaiterName(), chargeBillToRoom(), createBill(), createRestaurantBill(), findReusableOpenBill(), getBills() (+13 more)

### Community 44 - "Housekeeping Stayover UI"
Cohesion: 0.17
Nodes (25): getHousekeepingUsers(), normalizeDateInput(), normalizeStaffName(), popupTone, resolveHousekeepingId(), Stayover(), BOARD_BUCKET_META, buildDailyBoard() (+17 more)

### Community 45 - "Security & CORS Config"
Cohesion: 0.12
Nodes (20): authRateLimiter, createCorsOriginHandler(), DEFAULT_DEV_ALLOWED_ORIGINS, getAllowedOrigins(), getCorsOptions(), isLocalDevelopmentOrigin(), isLocalRequest(), isOriginAllowed() (+12 more)

### Community 46 - "Revenue Charts UI"
Cohesion: 0.14
Nodes (23): FoodSalesChart(), formatCompactValue(), formatTooltipValue(), MonthlyRevenueChart(), RevenueTooltip(), RoomOccupancyChart(), MetricCard(), TONE_ACCENT (+15 more)

### Community 47 - "Backup & Scheduler Controller"
Cohesion: 0.16
Nodes (24): cronDue(), dbPassword(), dbUser(), DEFAULTS, ensureBackupSettingsRow(), fs, getSettings(), JS_DEFAULTS (+16 more)

### Community 48 - "Employee & HR Controller"
Cohesion: 0.10
Nodes (15): bcrypt, createEmployee(), createUserRecordTx(), EMPLOYEE_COLUMNS, ensureEmployeeForUser(), nextEmployeeCode(), nextEmployeeCodeOn(), resolveRoleId() (+7 more)

### Community 49 - "Kitchen & KOT Controller"
Cohesion: 0.15
Nodes (16): createOrder(), formatMySqlDateTime(), getOrders(), inferEntityType(), KITCHEN_STATUSES, normalizeOrder(), normalizePrepTime(), parseItems() (+8 more)

### Community 50 - "Users & Auth Controller"
Cohesion: 0.14
Nodes (20): bcrypt, changePassword(), createUser(), deleteUser(), fs, getMe(), getUserById(), getUsers() (+12 more)

### Community 51 - "Inventory Adjustments Model"
Cohesion: 0.08
Nodes (4): InventoryAdjustments, MenuItems, RatePlans, pool

### Community 52 - "Assignments Page UI"
Cohesion: 0.20
Nodes (23): assignableRoles, Assignment(), compactRoomStatus(), compactRoomType(), DISPLAY_STATUS, DISPLAY_TASK, displayStatus(), displayTask() (+15 more)

### Community 53 - "Accounts Expansion Model"
Cohesion: 0.21
Nodes (21): columnExists(), deleteRow(), ensureColumn(), ensureSchema(), getBankLedgerBySource(), getDerivedMatchStatus(), getExtendedSummary(), getInvoiceSchemaConfig() (+13 more)

### Community 54 - "API Registry & Audit Reports"
Cohesion: 0.22
Nodes (20): api-routes.json (445-route registry), HAG-42 Report: Frontend Failure States, Hotel-Core Slice, HAG-54 Report: Accounts Slice Dead-Control Wiring, HAG-54 Report: Chef-Kitchen Slice Dead-Button Audit, HAG-54 Report: Hotel Frontend Buttons (6 files, 27 alerts + 1 prompt), HAG-54 Report: Hotel-Core Slice (10 files), HAG-54 Report: Inventory Slice Dead-Button Wiring, HAG-54 Report: Restaurant / Banquet / POS Slice (+12 more)

### Community 55 - "Folio & Bill UI"
Cohesion: 0.14
Nodes (20): AddEntryModal(), canonicalFolioType(), CATEGORIES, CHARGE_TYPES, CURRENCY, DEDUCTION_TYPES, ENTRY_TYPES, FolioView() (+12 more)

### Community 56 - "Inventory Masters Module Pages"
Cohesion: 0.16
Nodes (18): BACK_ROUTES, BackButton(), findPrevRoute(), InventoryMastersModulePage(), c, ConfirmDelete(), InventoryMenuItemsPage(), MenuItemFormModal() (+10 more)

### Community 57 - "Backend Dependencies Manifest"
Cohesion: 0.10
Nodes (21): dependencies, bcryptjs@^3.0.3, cookie-parser@^1.4.7, cors@^2.8.6, dotenv@^17.3.1, express@^5.2.1, express-rate-limit@^8.3.2, helmet@^8.1.0 (+13 more)

### Community 58 - "Inventory Masters Controller"
Cohesion: 0.20
Nodes (18): boolLabel(), buildWriteSet(), createRecord(), DEFAULTS, deleteRecord(), ensureColumns(), fieldDefs(), FIELDS (+10 more)

### Community 59 - "Restaurant WhatsApp & Invoice PDF"
Cohesion: 0.14
Nodes (19): formatINR(), getPublicBaseUrl(), round2(), sendRestaurantInvoiceWhatsApp(), CONTENT, drawRoundedRect(), ensureOutputDir(), formatINR() (+11 more)

### Community 60 - "Housekeeping Assignments Model"
Cohesion: 0.13
Nodes (7): HousekeepingAssignments, PaymentMethods, ensureBanquetSchema(), addColumnIfMissing(), addKeyIfMissing(), columnExists(), keyExists()

### Community 61 - "API Routes Test Suite"
Cohesion: 0.14
Nodes (20): ADMIN, APP_FILE, BACKUP_DEST, EMPTY_BODY, extractRoutes(), fillParams(), fs, getMounts() (+12 more)

### Community 62 - "Restaurant Table UI"
Cohesion: 0.18
Nodes (14): AddTableModal(), formatMoney(), OrderSummaryPage(), canReuseStoredInvoice(), createBillLookupKey(), getReusableBill(), isOpenInvoiceStatus(), isPaidBill() (+6 more)

### Community 63 - "Community 63"
Cohesion: 0.15
Nodes (12): badgeMapSet(), createMachine(), defaultWindow(), listMachines(), pad2(), parseWindow(), publicMachine(), shiftTimesForUi() (+4 more)

### Community 64 - "Community 64"
Cohesion: 0.22
Nodes (18): backfillDepartmentClassification(), columnExists(), createTransaction(), deleteTransaction(), ensureColumn(), ensureSchema(), getAllPaymentHistory(), getDepartmentSummary() (+10 more)

### Community 65 - "Community 65"
Cohesion: 0.14
Nodes (18): args, autoIncrementTables(), backupWithClone(), backupWithDump(), { execSync, spawnSync }, existingTables(), fail(), findMysqldump() (+10 more)

### Community 66 - "Frontend Dependencies Manifest"
Cohesion: 0.10
Nodes (20): dependencies, antd@^6.3.3, axios@^1.13.6, country-state-city@^3.2.1, date-fns@^4.1.0, jsonwebtoken@^9.0.3, lucide-react@^0.575.0, react@^19.2.0 (+12 more)

### Community 67 - "Inventory Purchases UI"
Cohesion: 0.17
Nodes (18): InventoryPurchasesPage(), Modal(), PurchaseFormModal(), STATUS_ICON, STATUS_STYLES, statusBadge(), Toast(), c (+10 more)

### Community 68 - "Community 68"
Cohesion: 0.12
Nodes (18): author, pdf-to-printer@^5.8.0, zkteco-js@^1.7.2, description, devDependencies, jest@^30.3.0, nodemon@^3.1.14, supertest@^7.2.2 (+10 more)

### Community 69 - "Community 69"
Cohesion: 0.25
Nodes (17): applyConsumption(), computeRequiredQuantity(), deleteRecipeRow(), getConsumptionLog(), getInventoryItems(), getMenuItems(), getRecipeByMenuItem(), getRecipeCatalogue() (+9 more)

### Community 70 - "Community 70"
Cohesion: 0.24
Nodes (18): testPrint(), generateThermalPdf(), printPdfToPrinter(), buildKOTReceipt(), buildPaymentReceipt(), centerText(), divider(), ESC_POS (+10 more)

### Community 71 - "Community 71"
Cohesion: 0.23
Nodes (16): expandBookings(), getRoomBookingForDate(), getRoomBookingReference(), normalizeRoomKey(), normalizeRooms(), todayISO(), toRoomList(), buildChargeableRooms() (+8 more)

### Community 72 - "Community 72"
Cohesion: 0.23
Nodes (18): AccountsCustomerInvoices(), formatINR(), getBanquetHallValue(), getBanquetPaymentMode(), getBanquetPaymentStatus(), getBanquetReference(), getHotelBookingPaymentMode(), getHotelBookingPaymentStatus() (+10 more)

### Community 73 - "Community 73"
Cohesion: 0.24
Nodes (15): RFC-4180, countRows(), ensureNightAuditSnapshotTable(), router, sumColumn(), csvEscape(), dateRange(), isoDate() (+7 more)

### Community 74 - "Community 74"
Cohesion: 0.20
Nodes (15): create(), emitAssignmentNotifications(), emitCompletionNotification(), getAll(), getStats(), getVisibilityContext(), isAssigneeRole(), isManagerRole() (+7 more)

### Community 75 - "Community 75"
Cohesion: 0.15
Nodes (5): isTestEnv(), numericUserId(), PrintQueue, printQueue, PrintServiceClass

### Community 76 - "Community 76"
Cohesion: 0.18
Nodes (11): assignTable(), BOOKING_STATUS_TO_DINING, confirmReservation(), createReservation(), DINING_STATUS_TO_BOOKING, generateReservationCode(), getAdminReservations(), getReservationByCode() (+3 more)

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (16): bcrypt, countUsers(), createUser(), deleteUserById(), ensureSchema(), findAdminUser(), findAdminWithPhone(), findUserByEmail() (+8 more)

### Community 78 - "Community 78"
Cohesion: 0.16
Nodes (12): buildPacket(), checksum(), connectDevice(), exchange(), formatTimestamp(), net, openSocket(), pad2() (+4 more)

### Community 79 - "Community 79"
Cohesion: 0.12
Nodes (5): { chromium }, PAGES, errors, events, playwright

### Community 80 - "Community 80"
Cohesion: 0.25
Nodes (11): createEmptyRow(), formatNumber(), MenuRecipeManager(), MenuRecipeModulePage(), fetchConsumptionLog(), fetchRecipeCatalogue(), fetchRecipeForMenuItem(), fetchRecipeInventoryItems() (+3 more)

### Community 81 - "Community 81"
Cohesion: 0.17
Nodes (14): controller/inventoryController.js (legacy-layout inventory controller), Inventory API endpoint reference (/api/inventory/*), Inventory Module Documentation (MBR), Menu Items (customer-facing; inventory impact only via recipes/consumption), Purchase Orders (procurement requests), Stock Audit (physical vs system stock), Stock Ledger (referenceType entries: opening_balance, vendor_inward, transfer_in/out, waste OUT), Stock Report (stock flow: opening + received - used) (+6 more)

### Community 82 - "Community 82"
Cohesion: 0.25
Nodes (13): ensureDatabaseExists(), ensureUploadsDir(), fs, getMissingEnvVars(), mysql, path, requiredEnvVars, run() (+5 more)

### Community 83 - "Community 83"
Cohesion: 0.16
Nodes (10): createRole(), displayForRole(), getRole(), listRoles(), SYSTEM_ROLE_IDS, updateRole(), ADMIN, express (+2 more)

### Community 84 - "Community 84"
Cohesion: 0.29
Nodes (15): addRoom(), CATEGORY_SLUG(), columnExists(), DEFAULT_CATEGORIES, deleteRoom(), ensureSchema(), getRoomSetup(), normalizeDateValue() (+7 more)

### Community 85 - "Community 85"
Cohesion: 0.27
Nodes (13): create(), crypto, generateBookingCode(), isDuplicateCode(), query(), updateRoomOperationalState(), create(), ensureSchema() (+5 more)

### Community 86 - "Community 86"
Cohesion: 0.23
Nodes (13): react-dom@^19.2.0, createBillCardKey(), formatCurrency(), formatDate(), formatVisitId(), getCustomerDisplay(), getStatusMeta(), IconBillDoc() (+5 more)

### Community 87 - "Community 87"
Cohesion: 0.24
Nodes (12): src/pages/Accounts.jsx (accounts hub page), buildBankOptionLabel(), formatINR(), ReconciliationOverview(), toKey(), BankReconciliation(), formatINR(), formatInputDate() (+4 more)

### Community 88 - "Community 88"
Cohesion: 0.21
Nodes (14): ensureColumn portable migration (SHOW COLUMNS pre-check), accountsController.js query() helper (rewritten to resolve the raw tuple), transaction_entries table (two-leg journal entries), transactions table (double-entry header rows), GET /api/reports/data (type guard, schema-drift columnExists), AccountsExpansionModel.js (unwired DDL for 9 accounts tables), accountsRoutes.js (50 routes, local ensureAccountsSchema ALTERs payments), HAG-46 report: accounts schema drift (9 tables folded into schema-v4.sql) (+6 more)

### Community 89 - "Community 89"
Cohesion: 0.14
Nodes (14): scripts, dev, init, init:prod, repair:payments, reset, reset:dry, seed (+6 more)

### Community 90 - "Community 90"
Cohesion: 0.25
Nodes (12): cli(), deleteInTransaction(), ensureLogTable(), findDupeGroups(), findLedgerRows(), findOrphanBills(), fs, getDb() (+4 more)

### Community 91 - "Community 91"
Cohesion: 0.25
Nodes (13): auditLogger(), createAuditLog(), ensureAuditLogSchema(), getClientIp(), getPendingAuditLogSet(), inferAction(), inferModule(), isPlainObject() (+5 more)

### Community 93 - "Community 93"
Cohesion: 0.16
Nodes (12): ADMIN, express, READERS, router, ADMIN, datesOf(), estimate(), express (+4 more)

### Community 94 - "Community 94"
Cohesion: 0.18
Nodes (12): express, router, ADMIN, api(), app, check(), express, http (+4 more)

### Community 95 - "Community 95"
Cohesion: 0.21
Nodes (11): drawTaxInvoice(), ensureOutputDir(), formatINR(), formatPhoneDisplay(), fs, generateInvoicePdf(), numberToWordsINR(), OUTPUT_DIR (+3 more)

### Community 96 - "Community 96"
Cohesion: 0.23
Nodes (7): formatMySqlDateTime(), getKitchenOrders(), normalizeOrder(), normalizePrepTime(), parseItems(), updateOrderStatus(), resolveKitchenStatus()

### Community 97 - "Community 97"
Cohesion: 0.21
Nodes (10): query(), updateGuestPhone(), create(), ensureSchema(), getAll(), updateStatus(), express, guestAdminRouter (+2 more)

### Community 98 - "Community 98"
Cohesion: 0.32
Nodes (12): checkHallBookingConflict(), createBooking(), createHall(), DEFAULT_BANQUET_PRICING_CONFIG, ensureColumn(), ensureSchema(), getAllBookings(), getAllHalls() (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.44
Nodes (12): columnExists(), getAllBillsRows(), getBanquetHallRateColumn(), getReportData(), getRestaurantBillsColumnMap(), getSummaryCounts(), normalizePaymentMode(), runQuery() (+4 more)

### Community 101 - "Community 101"
Cohesion: 0.15
Nodes (12): compilerOptions, allowSyntheticDefaultImports, baseUrl, checkJs, ignoreDeprecations, jsx, module, paths (+4 more)

### Community 102 - "Community 102"
Cohesion: 0.15
Nodes (13): scripts, build, dev, lint, preview, test, test:accounts, test:advanced (+5 more)

### Community 103 - "Community 103"
Cohesion: 0.24
Nodes (12): defaultGuestState(), defaultPaymentState(), formatCurrency(), formatStayDate(), GroupBooking(), GST_RATES, modalToneClasses, PAYMENT_MODES (+4 more)

### Community 104 - "Community 104"
Cohesion: 0.24
Nodes (9): AdminChefIssuesPage(), StatusBadge(), buildKOTHtml(), buildPrintDocument(), escapeHtml(), getBackendBaseURL(), printKOT(), printViaIframe() (+1 more)

### Community 105 - "Community 105"
Cohesion: 0.23
Nodes (12): AssignmentNotification(), DISPLAY_TASK, fetchNotifications_safe(), FilterDropdown(), formatDate(), formatTime(), normalizeAssignment(), PAGE_SIZES (+4 more)

### Community 106 - "Community 106"
Cohesion: 0.31
Nodes (12): c, ConfirmDelete(), InventoryVendorsPage(), Modal(), PageBackground(), primaryBtnStyle, rowActionBtn(), statusBadge() (+4 more)

### Community 107 - "Community 107"
Cohesion: 0.27
Nodes (11): FieldInput(), FieldLabel(), FieldSelect(), Modal(), PageButton(), PRINT_TYPE_LABELS, PrintManagement(), SectionCard() (+3 more)

### Community 108 - "Community 108"
Cohesion: 0.23
Nodes (7): addDaysISO(), buildGuestPayload(), cancelHotelBookingViaApi(), createHotelBookingViaApi(), fetchHotelRoomSetup(), fetchHotelSnapshot(), getHotelAuthHeaders()

### Community 109 - "Community 109"
Cohesion: 0.26
Nodes (10): acquireLock(), buildWindow(), fs, isProcessAlive(), LOCK_FILE, os, path, readLock() (+2 more)

### Community 110 - "Community 110"
Cohesion: 0.27
Nodes (11): buildFixturePool(), check(), count(), createFixture(), fs, main(), mysql, os (+3 more)

### Community 111 - "Community 111"
Cohesion: 0.30
Nodes (10): durationFromTimestamps(), floorFromRoom(), HousekeepingDashboard(), normalizeNotification(), normalizeStatus(), roomTypeLabel(), statusPill(), TASK_TYPE_LABEL (+2 more)

### Community 112 - "Community 112"
Cohesion: 0.30
Nodes (11): Badge(), BADGE_PALETTE, c, hashStr(), InventoryItemsPage(), ItemCard(), ItemFormModal(), Modal() (+3 more)

### Community 113 - "Community 113"
Cohesion: 0.23
Nodes (10): accountsController.js (summary, reconciliation, extended-summary aggregates), bookingController.js (paymentsJoin at :157, cancel refund at :1968), folioTotals.getAdvancePaid (single-booking dedup), guestProfileController.js (paidAmount over-count), InvoiceModel.js customer invoice (paidAmount over-count), HAG-212 report: money integrity, duplicate bill payments, payments table (bill_id, booking_id, invoice_id, banquet_booking_id), reportController.js daywise (no status/payment_type filter) (+2 more)

### Community 114 - "Community 114"
Cohesion: 0.32
Nodes (11): GET /api/dashboard/charts (monthlyRevenue, roomOccupancy, foodSales), Dashboard controller code (complete from prior session), HAG-32/33/34 report: dashboard, reports, hotel metrics aggregates (VERIFIED LIVE), GET /api/dashboard/metrics (six revenue sources), columnExists guard (rewritten to information_schema), dashboardController.js (29 insertions, 16 deletions), HAG-51 report: dashboard schema guards, guest_profiles leg, detectDateColumn guard (one query, Set membership) (+3 more)

### Community 115 - "Community 115"
Cohesion: 0.18
Nodes (10): catalog, DEFAULT_ROOMS, mappedOptions, next, oldCatalog, oldIds, orphaned, realIds (+2 more)

### Community 116 - "Community 116"
Cohesion: 0.25
Nodes (10): pdfkit@^0.19.1, ensureOutputDir(), formatINR(), fs, generateBanquetInvoicePdf(), OUTPUT_DIR, path, PDFDocument (+2 more)

### Community 117 - "Community 117"
Cohesion: 0.38
Nodes (10): addItem(), buildTokenCode(), closeTokenByTable(), createToken(), deleteItem(), denyIfNotOwnedByWaiter(), getActiveTokenByTable(), getItems() (+2 more)

### Community 118 - "Community 118"
Cohesion: 0.25
Nodes (9): CREATE_STATEMENTS, generateAutoInvoiceNo(), getDefinition(), InventoryMastersModel, normalizePayload(), quoteIdentifier(), SECTION_DEFINITIONS, selectColumns() (+1 more)

### Community 119 - "Community 119"
Cohesion: 0.35
Nodes (7): groupByShift(), pad2(), parseLogLine(), parseLogLines(), previousDay(), resolveShiftDay(), shifts

### Community 120 - "Community 120"
Cohesion: 0.25
Nodes (9): html2canvas@^1.4.1, jspdf@^4.2.1, CustomerInvoicePage(), formatCurrency(), formatDate(), formatINR(), toNumber(), html2canvas (+1 more)

### Community 121 - "Community 121"
Cohesion: 0.29
Nodes (10): AllBooking(), feedbackToneClasses, formatCurrency(), formatDate(), getActionMeta(), getBookingStatusMeta(), getGuestInitials(), getPaymentStatusMeta() (+2 more)

### Community 122 - "Community 122"
Cohesion: 0.33
Nodes (9): ACTION_OPTIONS, AuditLogCard(), AuditReport(), ExpandableJsonBlock(), ExpandableJsonCell(), formatDateTime(), formatJsonPreview(), getStatusTone() (+1 more)

### Community 124 - "Community 124"
Cohesion: 0.22
Nodes (10): MBR README (Maa Baglamukhi Resort Management System), Accounts Module (double-entry ledger, bank reconciliation, petty cash, GST), BookingFlow.jsx (hotel invoice layout, shared A4 document), buildHotelInvoiceDocument() (one shared A4 invoice document), Kitchen / KOT Module (sequential KOT numbers, thermal printing), Maa Baglamukhi Resort Management Platform (MBR), Maa-Baglamkhi-Resort-frontend (React 19 + Vite SPA, port 5173), ProtectedRoute / RoleHomeRedirect (role-based route guards) (+2 more)

### Community 125 - "Community 125"
Cohesion: 0.24
Nodes (10): HAG-213 report: POST /api/accounts/income & /expense return 400 (fixed), asRows callback defect in src/config/db.js, lifecycle.test.js (109 passed / 2 failed), write-probe.test.js (30/6 → 45/2 passed), HAG-52 report: banquet INSERT arity mismatch, banquetBookingsController.js (33-column INSERT fixed at :394), banquet_bookings table (33-column row shape), banquetHallController.js (INSERT/UPDATE, arity consistent) (+2 more)

### Community 126 - "Community 126"
Cohesion: 0.22
Nodes (8): Night-audit endpoint (upserts night_audit_snapshots, the suite's only write), Reports Suite (/api/reports-suite, 33 read-only admin endpoints), Suite auth: JWT + roleMiddleware(["admin", "manager", "accountant"]), Double-entry ledger (transactions + transaction_entries, replaces accounts_transactions), v4 Entity Group 9: Inventory & Procurement tables (inventory_categories, inventory_items, inventory_stock, inventory_vendors, ...), Consolidated payments table (merges payment_history, payments, advance_payment), User-based RBAC (roles + granular permissions per module), Resort Management System v4 Normalized Schema Design

### Community 127 - "Community 127"
Cohesion: 0.33
Nodes (8): createNotification(), deleteNotification(), insertNotification(), listNotifications(), markAllAsRead(), markAsRead(), express, router

### Community 130 - "Community 130"
Cohesion: 0.22
Nodes (8): express, router, ADMIN, billsBetween(), express, http, request, SEED

### Community 131 - "Community 131"
Cohesion: 0.40
Nodes (8): formatClock(), formatCountdown(), getRemainingMinutes(), getRemainingSeconds(), isOrderOverdue(), Kitchen(), PREP_TIME_OPTIONS, toMillis()

### Community 132 - "Community 132"
Cohesion: 0.22
Nodes (10): Maa-Baglamkhi-Resort-Backend (Node/Express + MySQL API, port 5002), src/assets.zip (1.09 MB tracked, unreferenced binary), board.md (hive shared plan file), Build gate: node --check 217/217, boot clean, 9/9 HTTP probes, vite build clean, CollectPayment.jsx (conditional useState calls, rules-of-hooks bug), .DS_Store files tracked by git (no .gitignore rule), Header.jsx (Date.now during render, impure), Housekeeping.jsx (components defined inside render) (+2 more)

### Community 133 - "Community 133"
Cohesion: 0.28
Nodes (7): auditLogController.js (getAuditLogs with ?limit clamp), src/controller/banquetBookingsController.js (createBanquetBooking, 33-column INSERT), v4 Entity Group 6: Banquet & Events tables (banquet_halls, banquet_pricing_plans, banquet_bookings, ...), HAG-123 report: POST /banquet 500 gate-verify, HAG-44 report: unbounded GET /api/audit-logs and banquet list endpoints (title card says HAG-38), AuditLogsModel.js (findAll(limit) appends LIMIT ?), banquetRoutes.js (banquetMigrations adds v4 financial columns on boot)

### Community 134 - "Community 134"
Cohesion: 0.31
Nodes (9): buildTokenCode() (VIS-YYYYMMDD-6 random chars), _hag210-probe.js probe script (untracked), resort_management database (live, 127.0.0.1:3306), tokenController.js (createToken, token status literals), HAG-210 report: 500 on POST /api/token/create (not reproducible), token-create-regression.test.js (12/12 passing, added by acdb5d5), TOKEN_OPEN_STATUS = "active" / TOKEN_CLOSED_STATUS = "completed", tokens table (status enum active/completed, UNIQUE token_code) (+1 more)

### Community 135 - "Community 135"
Cohesion: 0.42
Nodes (8): create(), ensureSchema(), getAll(), getStats(), remove(), runQuery(), update(), updateStatus()

### Community 137 - "Community 137"
Cohesion: 0.53
Nodes (8): buildPrintNo(), createPrintLog(), ensureSchema(), getLastPrint(), getPrintCount(), getPrintHistory(), runQuery(), updatePrintLog()

### Community 139 - "Community 139"
Cohesion: 0.53
Nodes (8): clearWaiterNotifications(), getWaiterNotifications(), markAllWaiterNotificationsRead(), markWaiterNotificationRead(), pushWaiterNotification(), safeParse(), safeStringify(), WaiterNotificationPanel()

### Community 140 - "Community 140"
Cohesion: 0.44
Nodes (8): cancelPendingDisconnect(), getHousekeepingSocket(), getSocketScriptURL(), getSocketServerURL(), loadSocketScript(), releaseHousekeepingSocket(), resolveSocketBaseURL(), scheduleDisconnect()

### Community 141 - "Community 141"
Cohesion: 0.28
Nodes (9): Payroll & Attendance Module (ZKTime device sync, zk_*), api-routes.test.js (210/445 failing → all 433 routes pass), Employee/payroll frontend wiring gap (zero frontend callers), createUserRecordTx (two INSERTs on one pooled connection), employeeController.js (+73/-33, transactional create), HAG-47 report: POST /api/employees half-create, payrollController.js (+23/-3, requireEmployeeRow), requireEmployeeRow (strict 404 when no employees row) (+1 more)

### Community 142 - "Community 142"
Cohesion: 0.32
Nodes (5): fs, normalizeDocumentType(), parseBoolean(), path, uploadByBooking()

### Community 148 - "Community 148"
Cohesion: 0.64
Nodes (7): createDocument(), ensureColumn(), ensureIndex(), ensureSchema(), getDocumentsByBookingId(), getDocumentsByMobile(), runQuery()

### Community 151 - "Community 151"
Cohesion: 0.46
Nodes (7): create(), ensureSchema(), list(), markAllAsRead(), markAsRead(), remove(), runQuery()

### Community 154 - "Community 154"
Cohesion: 0.50
Nodes (7): createPayment(), createTablespaceError(), createUnavailableError(), ensureSchema(), getPayments(), isPaymentsSchemaAvailable(), runQuery()

### Community 158 - "Community 158"
Cohesion: 0.61
Nodes (7): columnExists(), DEFAULT_ROW, ensureColumn(), ensureSchema(), getSettings(), runQuery(), updateSettings()

### Community 160 - "Community 160"
Cohesion: 0.29
Nodes (4): getPrinterForType(), PRINT_TYPES, PRINTERS, resolvePrinterWithOverride()

### Community 161 - "Community 161"
Cohesion: 0.32
Nodes (7): ADMIN, app, check(), ENDPOINTS, express, main(), request

### Community 162 - "Community 162"
Cohesion: 0.36
Nodes (7): buildFullNumber(), COUNTRY_CODES, STATUS, STATUS_LABELS, stripCountryCode(), validateLocalNumber(), WhatsAppInvoiceModal()

### Community 163 - "Community 163"
Cohesion: 0.46
Nodes (7): FoodTypeBadge(), FoodTypeIcon(), InventoryMenuListPage(), NonVegMark(), StatusBadge(), Toast(), VegMark()

### Community 164 - "Community 164"
Cohesion: 0.29
Nodes (7): InventoryDashboard.jsx (frontend inventory dashboard), InventoryFlow.jsx (frontend inventory flow, repointed from 501 stubs to real routes), Defect: /inventory/items CRUD inserts into inventory_items (ensureSchema) but getItems reads table inventory, HAG-58 report: three 501 inventory stubs and the handler that never called the API, 501 stub routes in src/routes/inventoryRoutes.js (:87, :157, :160), src/controller/inventoryController.js (createPurchaseOrder :1032, createVendorInward :1141, logWaste :814, submitAudit :2059, recordTransfer :2109, createItem :587), src/routes/inventoryRoutes.js (v4-layout inventory routes, incl. 501 stubs)

### Community 165 - "Community 165"
Cohesion: 0.29
Nodes (6): compilerOptions, checkJs, module, target, exclude, include

### Community 166 - "Community 166"
Cohesion: 0.43
Nodes (4): documentsForBookings(), loadProfileForMobile(), profileWithDocuments(), search()

### Community 167 - "Community 167"
Cohesion: 0.38
Nodes (5): daywise(), ensureSchema(), itemConsumption(), express, router

### Community 168 - "Community 168"
Cohesion: 0.52
Nodes (6): deviceUsers(), getAttendanceColumns(), resolveEmployeeId(), syncMachine(), toTimeCol(), toTimeHms()

### Community 171 - "Community 171"
Cohesion: 0.62
Nodes (6): columnExists(), createRecord(), ensureSchema(), getByDate(), getSchemaProfile(), runQuery()

### Community 195 - "Community 195"
Cohesion: 0.71
Nodes (6): createBlock(), ensureSchema(), getAllBlocks(), isRoomBlocked(), runQuery(), updateBlockStatus()

### Community 200 - "Community 200"
Cohesion: 0.29
Nodes (6): @tailwindcss/vite@^4.1.18, vite@npm:rolldown-vite@7.2.5, @vitejs/plugin-react@^5.1.1, @tailwindcss/vite, vite, @vitejs/plugin-react

### Community 201 - "Community 201"
Cohesion: 0.52
Nodes (6): DataTable(), HeroStatCard(), InsightCard(), QuickAction(), ReceptionDashboardLayout(), StatCard()

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (5): DEFAULT_ROOMS, mappedOptions, noFakes, realIds, setupRows

### Community 203 - "Community 203"
Cohesion: 0.33
Nodes (4): mysql2@^3.17.4, EXECUTE, mysql, mysql2

### Community 204 - "Community 204"
Cohesion: 0.40
Nodes (5): Upstream defect: busboy@1.6.0 multipart 500 'Unexpected end of form' on node 20.20.0, HAG-60 report: four 404s + payment-settings round-trip fixes, src/controller/accountsController.js (payment-settings GET/:id + PUT fixes), src/routes/accountsRoutes.js (dashboard + payment-settings aliases), src/routes/bookingRoutes.js (hotel /rooms and /rooms-availability aliases)

### Community 206 - "Community 206"
Cohesion: 0.47
Nodes (4): createLog(), listLogs(), parseJson(), safeSerialize()

### Community 211 - "Community 211"
Cohesion: 0.53
Nodes (4): parseHHMM(), slotDue(), start(), tick()

### Community 213 - "Community 213"
Cohesion: 0.33
Nodes (3): react-big-calendar@^1.19.4, localizer, react-big-calendar

### Community 214 - "Community 214"
Cohesion: 0.53
Nodes (4): nowId(), run(), attemptLogin(), waitForAny()

### Community 215 - "Community 215"
Cohesion: 0.33
Nodes (5): events, formBtn, statSel, submit, suffix

### Community 216 - "Community 216"
Cohesion: 0.40
Nodes (5): accountsController.js (payroll handler at :1761 defaults to current month), v4 Entity Group 10: HR & Attendance tables (employees, attendance_records, salary_structures, salary_payments), HAG-47 report: uniq_employee_month duplicate key on salary_payments, uniq_employee_month(employee_id, month) collision from probe row id 22 (employee 5, 2026-10-01), test/write-probe.test.js (payroll write probe, collides monthly without payrollMonth)

### Community 217 - "Community 217"
Cohesion: 0.60
Nodes (4): call(), CASES, iso(), main()

### Community 218 - "Community 218"
Cohesion: 0.50
Nodes (3): LOG, login(), note()

### Community 220 - "Community 220"
Cohesion: 0.40
Nodes (3): Data Reset Tool documentation (reset-data.js, 87-table wipe + master preservation), Sequential KOT numbering (KOT-0001, replaces timestamp-based; needs backend restart), src/tools/reset-data.js (portable data-reset script, npm run reset)

### Community 222 - "Community 222"
Cohesion: 0.67
Nodes (3): call(), main(), ROOM_PLAN

### Community 223 - "Community 223"
Cohesion: 0.83
Nodes (3): call(), iso(), main()

### Community 224 - "Community 224"
Cohesion: 0.83
Nodes (3): call(), iso(), main()

### Community 225 - "Community 225"
Cohesion: 0.83
Nodes (3): call(), iso(), main()

### Community 226 - "Community 226"
Cohesion: 0.83
Nodes (3): call(), iso(), main()

### Community 230 - "Community 230"
Cohesion: 0.83
Nodes (3): addPax(), ensureSchema(), runQuery()

### Community 231 - "Community 231"
Cohesion: 1.00
Nodes (3): addPayment(), ensureSchema(), runQuery()

### Community 233 - "Community 233"
Cohesion: 0.83
Nodes (3): addTariff(), ensureSchema(), runQuery()

## Ambiguous Edges - Review These
- `HAG-42 Report: Frontend Failure States, Hotel-Core Slice` → `src/components/Dashboard/Stayover.jsx (embeds EditBooking)`  [AMBIGUOUS]
  Maa-Baglamkhi-Resort-frontend/reports/HAG-42-hotel-core.md · relation: references
- `/kitchen-dashboard route (KitchenDashboard page)` → `ROLES.RESTAURANT role list`  [AMBIGUOUS]
  Maa-Baglamkhi-Resort-frontend/reports/HAG-54-restaurant.md · relation: conceptually_related_to

## Knowledge Gaps
- **46 isolated node(s):** `RFC-4180`, `../src/components/Hotel/bookingWizardApi.js`, `Stock Audit (physical vs system stock)`, `Vendor Payments (invoice payment tracking)`, `Menu Items (customer-facing; inventory impact only via recipes/consumption)` (+41 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1348 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **84 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getConnection()` connect `Banquet Booking & Addons Model` to `Community 128`, `Community 129`, `Backend Boot & Express App`, `Community 136`, `Community 138`, `Community 144`, `Community 145`, `Community 146`, `Community 147`, `Community 149`, `Community 150`, `Room Service Controller`, `Community 152`, `Community 153`, `Community 155`, `Community 156`, `Community 159`, `Shared DB Model Suite`, `Community 169`, `Community 170`, `Community 172`, `Community 173`, `Community 174`, `Community 175`, `Community 176`, `Community 177`, `Community 178`, `Community 179`, `Community 180`, `Community 181`, `Inventory Adjustments Model`, `Community 182`, `Community 183`, `Community 184`, `Community 185`, `Community 186`, `Housekeeping Assignments Model`, `Community 187`, `Community 188`, `Community 189`, `Community 190`, `Community 191`, `Community 192`, `Community 193`, `Community 194`, `Community 196`, `Community 197`, `Community 198`, `Community 199`, `Community 207`, `Community 208`, `Community 209`, `Community 210`, `Community 100`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `../src/components/Hotel/bookingWizardApi.js`, `Stock Audit (physical vs system stock)` to the rest of the system?**
  _46 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Accounts Ledger Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.07326732673267326 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Frontend App Shell & Routes` to `Attendance UI Components`, `Community 131`, `Banquet Billing & WhatsApp UI`, `Booking Advance & Cancel UI`, `Community 139`, `Collections & Reports UI`, `Inventory Dashboard UI`, `Frontend API Client Layer`, `Customer Invoice & History UI`, `Report Charts Components`, `Booking Wizard Steps UI`, `Hotel Booking Flow UI`, `Dashboard UI (New Dash, Topbar)`, `POS Payment & Receipt UI`, `Route Guards & Role Redirects`, `Kitchen KOT UI Cards`, `Inventory Flow UI`, `Community 162`, `Frontend Tooling & Dependencies`, `Inventory Masters UI Config`, `Community 163`, `Dashboard Notification Store`, `Frontend Pages & URL Config`, `Housekeeping Stayover UI`, `Revenue Charts UI`, `Assignments Page UI`, `Folio & Bill UI`, `Inventory Masters Module Pages`, `Restaurant Table UI`, `Frontend Dependencies Manifest`, `Inventory Purchases UI`, `Community 71`, `Community 72`, `Community 80`, `Community 86`, `Community 87`, `Community 103`, `Community 104`, `Community 105`, `Community 106`, `Community 107`, `Community 239`, `Community 111`, `Community 112`, `Community 120`, `Community 121`, `Community 122`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `Frontend App Shell & Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `HAG-42 Report: Frontend Failure States, Hotel-Core Slice` and `src/components/Dashboard/Stayover.jsx (embeds EditBooking)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `/kitchen-dashboard route (KitchenDashboard page)` and `ROLES.RESTAURANT role list`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._