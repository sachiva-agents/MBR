// models/BootstrapModule.js
//
// Boot-time schema bootstrap for objects that no other code path creates:
//
//   - lazy tables whose DDL lives in models that only run on request (or
//     never — kitchen_orders' only trigger is a commented-out sync call):
//     kitchen_orders, token_items, restaurant_item_action_requests,
//     room_tariff, hotel_room_inventory, and the InventoryModel table
//     family (inventory_purchase_orders, inventory_chef_issues, ...).
//   - migrated columns that only arrive via request-time lazy migrations
//     (invoices.customer_name/room_no, po_id, quantity_issued, vendor_name,
//     audit_logs.response_body).
//   - the seven production roles, so a fresh install's login JWT carries a
//     real role instead of falling back to 'staff'.
//
// Every step is additive and pre-checked (SHOW TABLES / SHOW COLUMNS /
// CREATE TABLE IF NOT EXISTS / INSERT IGNORE) — a running install is
// never modified, only missing objects are created.
const db = require("../config/db");

const SYSTEM_ROLES = [
  // The seven production role names that roleMiddleware + every role-gated
  // route actually use. Do NOT use RolesModel.seed() names (front_desk,
  // staff, accountant) — no route resolves those.
  ["admin", "Administrator"],
  ["manager", "Manager"],
  ["reception", "Reception"],
  ["accounts", "Accounts"],
  ["housekeeping", "Housekeeping"],
  ["waiter", "Waiter"],
  ["kitchen", "Kitchen"],
];

const tableExists = async (name) => {
  const [rows] = await db.query("SHOW TABLES LIKE ?", [name]);
  return Array.isArray(rows) && rows.length > 0;
};

const columnExists = async (table, column) => {
  const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return Array.isArray(rows) && rows.length > 0;
};

// Portable column add: SHOW COLUMNS pre-check, plain ALTER only when the
// column is actually missing. Skips silently when the table is absent so
// one missing object can't abort the rest of the boot.
const ensureColumnSafe = async (table, column, definition) => {
  if (!(await tableExists(table))) return false;
  if (await columnExists(table, column)) return false;
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  return true;
};

const createTable = async (ddl) => {
  await db.query(ddl);
};

const ensureSystemRoles = async () => {
  if (!(await tableExists("roles"))) return;
  for (const [name, displayName] of SYSTEM_ROLES) {
    // INSERT IGNORE against the UNIQUE key on roles.name: additive only.
    // Existing installs keep their rows; a fresh install gets all seven.
    // No explicit ids: an install whose auto ids already differ keeps its
    // mapping; only genuinely missing names are added.
    await db.query("INSERT IGNORE INTO `roles` (`name`, `display_name`, `is_system`) VALUES (?, ?, 0)", [
      name,
      displayName,
    ]);
  }
};

const ensureLazyTables = async () => {
  // kitchen_orders — canonical DDL owned by kitchen.js (CREATE + its own
  // column backfills); add the two waiter status columns that otherwise
  // only self-heal on the first waiter request.
  await require("./kitchen").ensureSchema();
  await ensureColumnSafe("kitchen_orders", "picked_up_at", "DATETIME NULL");
  await ensureColumnSafe("kitchen_orders", "served_at", "DATETIME NULL");

  // token_items — the legacy token flow's item table; no boot-time DDL
  // anywhere. Shape mirrors the production table.
  await createTable(`
    CREATE TABLE IF NOT EXISTS token_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      token_id BIGINT UNSIGNED NOT NULL,
      item_name VARCHAR(191) NOT NULL,
      qty INT NOT NULL DEFAULT 1,
      rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_token_id (token_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // restaurant_item_action_requests — its DDL sits inside RestaurantModel's
  // one-shot bootstrap (which also runs data migrations); keep the boot
  // path DDL-only, mirroring the production table.
  await createTable(`
    CREATE TABLE IF NOT EXISTS restaurant_item_action_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token_item_id BIGINT UNSIGNED NULL,
      table_number VARCHAR(50) NULL,
      action_type VARCHAR(50) NOT NULL,
      reason TEXT NOT NULL,
      requested_by VARCHAR(191) NULL,
      status VARCHAR(50) DEFAULT 'Pending',
      manager_note TEXT NULL,
      approved_by VARCHAR(191) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // restaurant_split_bills — HAG-18: same owner as the requests table above
  // (RestaurantModel.ensureSchema, which boot never runs — only
  // MenuRecipeModel chains to it, and that isn't a boot step). The split-bill
  // write (POST /restaurant/split-bills) and its list both touch this table,
  // so a fresh install 500s without it. DDL mirrors the production table.
  await createTable(`
    CREATE TABLE IF NOT EXISTS restaurant_split_bills (
      id INT AUTO_INCREMENT PRIMARY KEY,
      bill_id INT DEFAULT NULL,
      table_number VARCHAR(50) NOT NULL,
      entity_type VARCHAR(30) DEFAULT 'Table',
      split_label VARCHAR(80) NOT NULL,
      split_no INT NOT NULL,
      split_count INT NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
      gst DECIMAL(10,2) NOT NULL DEFAULT 0,
      total DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(50) DEFAULT NULL,
      items_json LONGTEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // room_tariff — owned by roomTariffModel.js (app.js historically wired
  // ensureRoomTariffSchema to the wrong model, RatePlansModel).
  await require("./roomTariffModel").ensureSchema();

  // rate_plans — kept covered here; a fresh install gets it, a running one
  // is a no-op.
  await require("./RatePlansModel").ensureSchema();

  // hotel_room_inventory — no DDL anywhere in src; the housekeeping +
  // reports queries guard on its presence but crash on the column lookups
  // when it is absent. Shape mirrors the production table.
  await createTable(`
    CREATE TABLE IF NOT EXISTS hotel_room_inventory (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_number VARCHAR(50) NULL,
      category_id INT NULL,
      status VARCHAR(30) NULL,
      rate DECIMAL(12,2) NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_hri_room_number (room_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // inventory purchase/chef-issue families — InventoryModel owns the full
  // DDL (purchase_orders, chef_issues, stock_ledger, vendor_inwards, ...).
  // Its ensureSchema is DDL + guarded column backfills only, no data
  // statements, safe at boot.
  await require("./InventoryModel").ensureSchema();
};

const ensureMigratedColumns = async () => {
  // Columns that prod installs got from request-time lazy migrations.
  // All pre-checked; every one of these is a no-op on the production DB.
  await ensureColumnSafe("invoices", "customer_name", "VARCHAR(255) DEFAULT NULL");
  await ensureColumnSafe("invoices", "room_no", "VARCHAR(255) DEFAULT NULL");
  await ensureColumnSafe("inventory_vendor_inwards", "po_id", "INT NULL");
  await ensureColumnSafe("inventory_chef_issues", "quantity_issued", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await ensureColumnSafe("inventory_stock_ledger", "vendor_name", "VARCHAR(255) NULL");
  await ensureColumnSafe("audit_logs", "response_body", "JSON NULL");
  // restaurant table capacity: the controller INSERTs it on every new table,
  // so a fresh install 500s without it (production DBs already carry it).
  await ensureColumnSafe("restaurant_tables", "guestCount", "INT DEFAULT 4");
};

// Default payment method rows for fresh installs (HAG-18). The accounts
// payment-settings form and every generic payment capture need this table to
// carry at least one row, but its DDL only runs on demand (the accounts
// controller) and nothing ever seeds it — a fresh install has an empty table,
// so the Payment Desk method picker has nothing to choose. Mirrors the
// ProductionDefaults + model column set; INSERT IGNORE and empty-table guard
// make this a no-op on every running install.
const ensurePaymentMethodSeed = async () => {
  await createTable(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL UNIQUE,
      code VARCHAR(30) NOT NULL UNIQUE,
      is_active TINYINT(1) DEFAULT 1,
      icon VARCHAR(100),
      department VARCHAR(100),
      provider_name VARCHAR(255),
      upi_id VARCHAR(255),
      account_holder_name VARCHAR(255),
      bank_name VARCHAR(255),
      qr_image_url LONGTEXT,
      notes TEXT,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [rows] = await db.query("SELECT COUNT(*) AS c FROM payment_methods");
  if (!Array.isArray(rows) || rows.length === 0 || Number(rows[0].c || 0) > 0) return;
  const defaults = [
    ["Cash", "cash"],
    ["Credit Card", "card"],
    ["Debit Card", "debit_card"],
    ["UPI", "upi"],
    ["Net Banking", "net_banking"],
    ["Credit (Hotel)", "credit"],
  ];
  for (const [name, code] of defaults) {
    await db.query("INSERT IGNORE INTO payment_methods (name, code, is_active) VALUES (?, ?, 1)", [
      name,
      code,
    ]);
  }
};

// Single entry point wired into initializeDatabase() at boot and run by
// `npm run init`. Each phase is fault-isolated: one failing object must
// never block the ones after it (especially the roles seed).
const ensureBootSchema = async () => {
  const [probe] = await db.query("SELECT 1");
  if (!probe || !probe.length) return;
  for (const [label, step] of [
    ["Boot schema: lazy tables", ensureLazyTables],
    ["Boot schema: migrated columns", ensureMigratedColumns],
    ["Boot schema: system roles", ensureSystemRoles],
    ["Boot schema: payment method seed", ensurePaymentMethodSeed],
  ]) {
    try {
      await step();
    } catch (error) {
      console.error(`${label} failed:`, error.message || error);
    }
  }
};

module.exports = {
  ensureBootSchema,
  ensureColumnSafe,
  SYSTEM_ROLES,
};
