# HAG-26 Fixes Report

**Fixed by:** hermione-mwvxv5co
**Date:** 2026-11-28
**Scratch DB:** hotel_management_hag25
**QA:** 513/513 routes passed, 0 failures

---

## Summary

| Bug | Title | Status | Commit |
|-----|-------|--------|--------|
| 1 | All invoice routes open to any authenticated user | **ALREADY FIXED** in 772d79b | 772d79b |
| 2 | All accounts routes open to any authenticated user | **ALREADY FIXED** in 772d79b | 772d79b |
| 3 | Attendance PUT/PATCH has no role check | **ALREADY FIXED** in 772d79b | 772d79b |
| 4 | 15 modules have no permissions seeded | **ALREADY FIXED** in 772d79b | 772d79b |
| 5 | `role_permissions` table missing UNIQUE constraint | **ALREADY FIXED** in 772d79b | 772d79b |
| 6 | `userController` exposes raw `role_id` | **ALREADY FIXED** in 772d79b | 772d79b |
| 7 | Default role fallback mismatch (staff ghost role) | **ALREADY FIXED** in 772d79b | 772d79b |

---

## Verification

All 7 bugs were verified **CONFIRMED** at commit 46acfd9 by god's QA run. All 7 were already fixed in commit **772d79b** ("fix(backend): HAG-25 money + HAG-26 RBAC security (17 bugs)").

### BUG-1: Invoice route role guard
- **File:** `src/routes/InvoiceRoutes.js:6`
- **Fix:** `router.use(authMiddleware, roleMiddleware(["admin", "manager", "reception", "accounts"]))`
- **Status:** Present in 772d79b ✓

### BUG-2: Accounts route role guard
- **File:** `src/routes/accountsRoutes.js:8`
- **Fix:** `router.use(authMiddleware, roleMiddleware(["admin", "manager", "accounts"]))`
- **Status:** Present in 772d79b ✓

### BUG-3: Attendance PUT/PATCH admin-only
- **File:** `src/routes/attendanceRoutes.js:29-30`
- **Fix:** `router.put("/:id", authMiddleware, roleMiddleware(["admin"]), ...)`
- **Status:** Present in 772d79b ✓

### BUG-4: Permission seeds
- **File:** `src/models/PermissionsModel.js:44-85`
- **Fix:** Seed now includes 39 permissions (19 original + 20 new for invoices, accounts.transactions, attendance, payments, backups, settings.connectors, zk, notifications, reports.financial)
- **Status:** Present in 772d79b ✓

### BUG-5: role_permissions UNIQUE constraint
- **File:** `src/models/RolePermissionsModel.js:13-19`
- **Fix:** Added `PRIMARY KEY (role_id, permission_id)` + FK cascade
- **Status:** Present in 772d79b ✓

### BUG-6: userController role_name JOIN
- **File:** `src/controller/userController.js:167-170`
- **Fix:** `LEFT JOIN roles r ON r.id = u.role_id` + `COALESCE(r.name, 'reception') AS role`
- **Status:** Present in 772d79b ✓

### BUG-7: Staff ghost role
- **Files:** `src/models/BootstrapModule.js`, `src/controller/authController.js`
- **Fix:** Added `["staff", "Staff"]` as 8th system role; changed COALESCE fallback from `'staff'` to `'reception'`
- **Status:** Present in 772d79b ✓

---

*All 7 HAG-26 bugs were already fixed in commit 772d79b. No additional changes needed.*
