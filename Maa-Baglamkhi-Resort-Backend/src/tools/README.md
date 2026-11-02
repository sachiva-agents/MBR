# Data Reset Tool — Maa Baglamukhi Resort (MBR)

`reset-data.js` gives the resort a clean handoff: it wipes all transactional
data on **any PC where the app is installed**, keeps the masters the app
needs to run, auto-increment counters restart at 1, and always backs up
first.

```
node src/tools/reset-data.js          (or: npm run reset)
```

---

## What it does

1. **Reads DB credentials from this PC's `.env`** (same config the app uses —
   nothing is hardcoded, so the script works on every installation).
2. **Backs up the whole database** before touching anything:
   - uses `mysqldump` if it can find it (XAMPP or MySQL install on a drive),
     dumps to `data-reset-backup\<DB>_backup_<timestamp>.sql`
   - if no `mysqldump` is found, falls back to cloning the whole database
     into a sibling database `mbb_backup_<timestamp>` (delete that database
     once you've confirmed the reset is good)
3. **Clears 87 operational tables** — bookings, guests, invoices, orders,
   KOTs, payments, accounts ledger, housekeeping logs, notifications,
   print logs, audit logs, etc. Tables that don't exist on that PC are
   skipped automatically.
4. **Keeps master/config data** — `users`, `roles`, `permissions`,
   `employees`, `rooms`, room categories, `menu_*`, `restaurant_tables`,
   banquet halls and pricing, settings, payment methods. The app still
   boots and logins keep working.
5. **Resets every auto-increment to 1** — so the next invoice is
   `HOTINV-YYYYMMDD-0001`, the next kitchen order is `#1`, and the first
   KOT prints as `KOT-0001` (sequential KOT numbering shipped in the same
   release; KOTs used to be timestamp-based).
6. **Normalises the operational state *inside* the kept master tables** —
   `rooms.status` → `available` (+ `current_booking_id` cleared),
   `restaurant_tables` → available / guests cleared, `banquet_halls` →
   available. Wiping the bookings alone leaves rooms flagged "occupied"
   with a dangling `current_booking_id`, which is what makes the room board
   show "occupied" rooms and the Accounts dashboard keep showing stale
   billing/payment counts after a reset.
7. **Verifies the post-state** — re-counts every wiped table and scans the
   kept masters for rows still in a non-clean state, printing either
   `Verified: all wiped tables are empty…` or a `WARNING: …` list naming
   exactly which tables are not clean.
8. **Prints a before/after report** — which tables, how many rows, where
   the backup went.

The standard chart of accounts (22 accounts) re-seeds itself automatically
the first time the Accounts section is opened after a reset — no action
needed.

---

## How to run

From the backend folder on **any PC where MBR is installed**:

```bash
cd Maa-Baglamkhi-Resort-Backend

# 0) MariaDB/MySQL must be running (XAMPP: start the MySQL service)

# 1) See exactly what would be cleared — changes nothing:
npm run reset:dry

# 2) Do the reset (interactive — asks you to type RESET, backs up first):
npm run reset
```

### Flags

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print the tables and row counts that would be cleared, then stop. Safe to run any time. |
| `--yes` / `-y` | Skip the interactive "type RESET" confirmation (for scripted use). |
| `--no-backup` | Skip the backup step. **Not recommended.** |
| `--clean-uploads` | Also delete generated invoice PDFs from `uploads/invoices` and `src/uploads/invoices` on disk. |

Flags combine: `node src/tools/reset-data.js --yes --clean-uploads`

---

## Setting up on a new PC

```bash
git pull                                  # get the script + KOT change
cd Maa-Baglamkhi-Resort-Backend
npm install                               # once
# start MariaDB/MySQL, then:
npm run reset
# restart the backend so the sequential KOT code change is live:
npm run dev      # or: npm start
```

Backups the script creates are **gitignored** (`data-reset-backup/`,
`resort_backup_*.sql`) — each PC keeps its own local backup, and large
dump files never get committed to the repo.

---

## Restoring after a reset (if needed)

The safest restore is the in-database clone (created automatically when
`mysqldump` is unavailable):

```sql
-- rename the backup database and switch the app to it, or dump+reload:
mysqldump -u root mbb_backup_<timestamp> -p > restore.sql
mysql -u root -p resort_management1 < restore.sql
```

Or with a SQL dump (when `mysqldump` was found):

```bash
mysql -u root -p resort_management1 < data-reset-backup/resort_management1_backup_<timestamp>.sql
```

Keep the backup around for a day or two before deleting it.

---

## What is cleared (full list)

Wiped and counter-reset:

- **Hotel** — `bookings`, `booking_guests`, `booking_rooms`,
  `booking_status_history`, `guests`, `guest_profiles`,
  `guest_identifications`, `guest_documents`, `guest_reviews`,
  `hotel_group_bookings`, `hotel_room_blocks`, `hotel_room_inventory`,
  `hotel_folio_entries`, `folio_entries`, `advance_payment`,
  `room_orders`, `room_order_items`, `room_service_orders`,
  `special_requests`, `other_booking`
- **Restaurant / POS / kitchen** — `orders`, `order_items`, `bills`,
  `bill_splits`, `restaurant_bills`, `restaurant_split_bills`,
  `restaurant_item_action_requests`, `room_bills`, `tokens`,
  `token_items`, `kitchen_orders`, `kot_orders`
- **Invoices & payments** — `invoices`, `invoice_lines`, `payments`,
  `payments_dedupe_log`, `payment_history`, `vendor_payment_records`,
  `purchase_orders`, `inventory_purchase_orders`,
  `inventory_purchase_items`, `inventory_purchase_services`,
  `inventory_vendor_inwards`, `inventory_vendor_payments`
- **Accounts** — `accounts_transactions`, `account_bank_ledgers`,
  `transactions`, `transaction_entries`, `bank_reconciliation_matches`,
  `petty_cash_entries`, `profit_center_entries`, `register`,
  `night_audit_snapshots`, `gst_return_records`, `chart_of_accounts`
  (re-seeded on boot)
- **Housekeeping / maintenance** — `housekeeping`,
  `housekeeping_assignments`, `housekeeping_logs`,
  `completed_cleaning_logs`, `hk_amenities_consumption`,
  `hk_completed_cleaning_logs`, `hk_inspections`, `hk_lost_found`,
  `hk_messages`, `hk_shift_roster`, `hk_room_costing`,
  `maintenance_requests`, `assignments`
- **Inventory operations** — `inventory`, `inventory_adjustments`,
  `inventory_chef_issues`, `inventory_consumption`,
  `inventory_consumption_log`, `inventory_stock`,
  `inventory_stock_audit`, `inventory_stock_categories`,
  `inventory_stock_ledger`, `inventory_transfers`, `inventory_waste_log`
- **Banquet operations** — `banquet_bookings`, `banquet_booking_addons`
- **HR records** — `attendance_records`, `salary_payments`,
  `payroll_records`
- **Notifications / logs / audit** — `notifications`,
  `communication_logs`, `audit_logs`, `print_logs`, `print_queue`,
  `user_sessions`, `reports`, `review_media`, `promo_usages`

Kept (masters): `users`, `roles`, `permissions`, `role_permissions`,
`departments`, `designations`, `employees`, `rooms`, `room_categories`,
`room_tariff`, `room_rates`, `rate_plans`, `room_menu_items`, `amenities`,
`menu_categories`, `menu_items`, `menu_item_ingredients`,
`restaurant_tables`, `banquet_halls`, `banquet_pricing_config`,
`banquet_pricing_plans`, `booking_sources`, `app_settings`,
`backup_settings`, `payment_gateway_settings`, `payment_methods`,
`hk_parameters`, `holiday_calendar`, `companies`, `resort_profiles`,
`promotions`, inventory masters (`inventory_categories`,
`inventory_items`, `inventory_item_groups`, `inventory_locations`,
`inventory_units`, `inventory_vendors`, `inventory_segments`,
`inventory_menu_categories`), `zk_attendance_machines`,
`zk_attendance_pulls`, `zk_badge_map`.

---

## Troubleshooting

- **`Can't connect to MySQL server`** — MariaDB/MySQL isn't running.
  XAMPP: run `C:\xampp\mysql_start.bat` (or start the mysql service).
- **`Access denied for user`** — the backend `.env` credentials are
  wrong/missing on that PC. The script uses exactly what the app uses,
  so if the app connects, the script connects.
- **No `mysqldump` found** — no problem: the in-database clone fallback
  runs automatically. You'll see `in-database clone → mbb_backup_...`
  in the output.
- **Reset ran but old numbers still appear** — the backend process is
  still on the old code / has stale data in memory. Restart it
  (`npm run dev` / `npm start`).
- **KOT still prints a timestamp number** — same fix: the sequential-KOT
  code change requires a backend restart on that PC (`git pull` first on
  older installs).
