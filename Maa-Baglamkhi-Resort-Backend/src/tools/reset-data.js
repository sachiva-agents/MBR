#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MBR — Maa Baglamukhi Resort · full data reset (portable, any PC)
 *
 *  Usage (from the backend folder, where the app is installed):
 *
 *      node src/tools/reset-data.js            # interactive, asks for RESET
 *      node src/tools/reset-data.js --dry-run  # report what would clear, change nothing
 *      node src/tools/reset-data.js --yes      # no prompt (scripted)
 *      node src/tools/reset-data.js --no-backup
 *      node src/tools/reset-data.js --clean-uploads   # also delete generated PDFs
 *
 *  npm run reset                               # same as first line
 *
 *  What it does:
 *    1. Reads DB credentials from THIS PC's .env (backend/src/config).
 *    2. Backs up the whole database (mysqldump if found, else a full
 *       clone into a sibling database mbb_backup_<timestamp>).
 *    3. Clears every operational/transactional table (bookings, orders,
 *       KOTs, invoices, accounts, housekeeping logs, notifications...).
 *    4. Keeps all master/config data (users, roles, rooms, room types,
 *       menu, restaurant tables, banquet halls, settings, employees).
 *    5. Resets every auto-increment counter to 1 — so the first new
 *       booking is HOTINV-...-0001, the first kitchen order is #1,
 *       and the first KOT prints as KOT-0001.
 *
 *  After running: restart the backend. Accounts' standard chart of
 *  accounts re-seeds itself on boot (INSERT IGNORE in accountsController).
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawnSync } = require("child_process");

// Reuse the app's own DB config so this works on any installed copy.
// databaseConfig loads the backend .env automatically.
const { getDatabaseName, getDbBaseConfig } = require("../config/databaseConfig");
const mysql = require("mysql2/promise");

// ── flags ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FLAG_YES = args.includes("--yes") || args.includes("-y");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_NO_BACKUP = args.includes("--no-backup");
const FLAG_CLEAN_UPLOADS = args.includes("--clean-uploads");

// Tables that hold live operational data. Wiped + counter reset to 1.
// Only tables that actually exist on this PC get touched (existence-checked).
const WIPE_TABLES = [
  // ── Hotel / bookings ──
  "bookings", "booking_guests", "booking_rooms", "booking_status_history",
  "guests", "guest_profiles", "guest_identifications", "guest_documents",
  "guest_reviews", "hotel_group_bookings", "hotel_room_blocks",
  "hotel_room_inventory", "hotel_folio_entries", "folio_entries",
  "advance_payment", "room_orders", "room_order_items",
  "room_service_orders", "special_requests", "other_booking",
  // ── Restaurant / POS / kitchen ──
  "orders", "order_items", "bills", "bill_splits", "restaurant_bills",
  "restaurant_split_bills", "restaurant_item_action_requests",
  "room_bills", "tokens", "token_items", "kitchen_orders", "kot_orders",
  // ── Invoices & payments ──
  "invoices", "invoice_lines", "payments", "payments_dedupe_log",
  "payment_history", "vendor_payment_records", "purchase_orders",
  "inventory_purchase_orders", "inventory_purchase_items",
  "inventory_purchase_services", "inventory_vendor_inwards",
  "inventory_vendor_payments",
  // ── Accounts ledger ──
  "accounts_transactions", "account_bank_ledgers", "transactions",
  "transaction_entries", "bank_reconciliation_matches",
  "petty_cash_entries", "profit_center_entries", "register",
  "night_audit_snapshots", "gst_return_records",
  "chart_of_accounts", // re-seeded automatically on backend boot
  // ── Housekeeping / maintenance ──
  "housekeeping", "housekeeping_assignments", "housekeeping_logs",
  "completed_cleaning_logs", "hk_amenities_consumption",
  "hk_completed_cleaning_logs", "hk_inspections", "hk_lost_found",
  "hk_messages", "hk_shift_roster", "hk_room_costing",
  "maintenance_requests", "assignments",
  // ── Inventory operations (masters kept) ──
  "inventory", "inventory_adjustments", "inventory_chef_issues",
  "inventory_consumption", "inventory_consumption_log",
  "inventory_stock", "inventory_stock_audit", "inventory_stock_categories",
  "inventory_stock_ledger", "inventory_transfers", "inventory_waste_log",
  // ── Banquet operations (halls + pricing kept) ──
  "banquet_bookings", "banquet_booking_addons",
  // ── HR records (employees master kept) ──
  "attendance_records", "salary_payments", "payroll_records",
  // ── Notifications / logs / audit ──
  "notifications", "communication_logs", "audit_logs", "print_logs",
  "print_queue", "user_sessions", "reports", "review_media",
  "promo_usages",
];

// ── helpers ───────────────────────────────────────────────────────────────────
const log = (...m) => console.log(...m);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

async function existingTables(conn, schema) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
    [schema]
  );
  return new Set(rows.map((r) => r.TABLE_NAME));
}

async function autoIncrementTables(conn, schema, names) {
  // Tables where some column has EXTRA = auto_increment (counter to reset).
  const [rows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND EXTRA LIKE '%auto_increment%'`,
    [schema]
  );
  const set = new Set(rows.map((r) => r.TABLE_NAME));
  return names.filter((n) => set.has(n));
}

// Find a mysqldump executable on this PC (XAMPP or a normal install).
function findMysqldump() {
  const candidates = [];
  if (process.platform === "win32") {
    for (const drive of ["C:", "D:", "E:"]) {
      candidates.push(`${drive}\\xampp\\mysql\\bin\\mysqldump.exe`);
      candidates.push(`${drive}\\Program Files\\MySQL`);
    }
    try {
      // where returns full paths on PATH; also search Program Files\MySQL
      const out = execSync("where mysqldump 2>nul", { shell: true }).trim();
      if (out) candidates.unshift(out.split(/\r?\n/)[0]);
    } catch {
      /* not on PATH */
    }
    for (const pf of ["C:\\Program Files", "D:\\Program Files"]) {
      try {
        for (const d of fs.readdirSync(pf)) {
          if (d.toLowerCase().includes("mysql")) {
            candidates.push(`${pf}\\${d}\\bin\\mysqldump.exe`);
          }
        }
      } catch {
        /* drive not present */
      }
    }
  } else {
    try {
      const out = execSync("which mysqldump 2>/dev/null || true", {
        shell: true,
      }).trim();
      if (out) candidates.unshift(out);
    } catch {
      /* not found */
    }
  }
  for (const c of candidates) {
    if (c.endsWith("mysqldump.exe") || c.endsWith("mysqldump")) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

async function backupWithDump(db, cfg, outPath, password) {
  const tool = findMysqldump();
  if (!tool) return false;
  const cmd = [
    "-h", String(cfg.host || "127.0.0.1"),
    "-P", String(cfg.port || 3306),
    "-u", String(cfg.user || "root"),
    "--single-transaction",
    "--routines",
    "--triggers",
    db,
  ];
  const env = { ...process.env };
  // Pass password via env so it never lands in the process list.
  if (cfg.password) env.MYSQL_PWD = cfg.password;
  else delete env.MYSQL_PWD;
  const child = spawnSync(tool, cmd, { env, stdio: ["ignore", "pipe", "pipe"] });
  const buf = child.stdout;
  fs.writeFileSync(outPath, buf);
  return child.status === 0 && buf.length > 0;
}

async function backupWithClone(conn, schema, backupSchema) {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${backupSchema}\``);
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    const tables = await existingTables(conn, schema);
    for (const t of tables) {
      await conn.query(`CREATE TABLE IF NOT EXISTS \`${backupSchema}\`.\`${t}\` LIKE \`${schema}\`.\`${t}\``);
      await conn.query(`INSERT INTO \`${backupSchema}\`.\`${t}\` SELECT * FROM \`${schema}\`.\`${t}\``);
    }
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

async function main() {
  const db = getDatabaseName();
  const cfg = getDbBaseConfig();
  const when = new Date();
  const stamp = when
    .toISOString()
    .replace(/[-:.]/g, "")
    .slice(0, 15)
    .replace("T", "_");

  log("──────────────────────────────────────────────────────────");
  log(" MBR data reset");
  log(` Database : ${db}`);
  log(` Host     : ${cfg.host}:${cfg.port} (user ${cfg.user})`);
  log(` When     : ${when.toISOString()}`);
  log("──────────────────────────────────────────────────────────");

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password || "",
    database: db,
    multipleStatements: false,
    connectTimeout: 15000,
  });

  const have = await existingTables(conn, db);
  const toWipe = WIPE_TABLES.filter((t) => have.has(t));
  const unknown = WIPE_TABLES.filter((t) => !have.has(t));

  // Row counts for the report.
  const counts = {};
  for (const t of toWipe) {
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM \`${db}\`.\`${t}\``
    );
    counts[t] = n;
  }
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

  log("");
  log(` Will clear ${toWipe.length} operational tables (~${totalRows} rows).`);
  if (unknown.length)
    log(` Not present here (skipped): ${unknown.length} table(s), e.g. ${unknown.slice(0, 4).join(", ")}${unknown.length > 4 ? ", …" : ""}`);
  log(" Masters kept: users, roles, employees, rooms, room types, menu,");
  log(" restaurant tables, banquet halls/pricing, settings, payment methods.");

  if (FLAG_DRY_RUN) {
    log("\n --dry-run: printing what would be cleared, then stopping.");
    for (const t of toWipe) {
      if (counts[t]) log(`   ${String(counts[t]).padStart(9)}  ${t}`);
    }
    await conn.end();
    log(" (nothing was changed)");
    return;
  }

  log("");

  // ── 1. Confirm ──────────────────────────────────────────────────────────────
  if (!FLAG_YES) {
    const rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise((res) =>
      rl.question(" Type RESET to continue: ", res)
    );
    rl.close();
    if (String(answer).trim().toUpperCase() !== "RESET") {
      fail("Aborted — nothing changed.");
    }
  }

  // ── 2. Backup ──────────────────────────────────────────────────────────────
  let backupPath = null;
  let backupNote = "";
  if (FLAG_NO_BACKUP) {
    backupNote = "skipped (--no-backup)";
  } else {
    const outDir = path.join(__dirname, "..", "..", "data-reset-backup");
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${db}_backup_${stamp}.sql`);
    const ok = await backupWithDump(db, cfg, out, cfg.password);
    if (ok) {
      backupPath = out;
      backupNote = `SQL dump → ${out}`;
    } else {
      // Fallback: full clone into a sibling database (no external tools).
      const bs = `mbb_backup_${stamp.replace(/[^0-9]/g, "")}`;
      await backupWithClone(conn, db, bs);
      backupNote = `in-database clone → ${bs} (delete that database when the reset is confirmed good)`;
      if (!fs.existsSync(out)) {
        fs.rmSync(out, { force: true });
      }
    }
  }
  log(`\n Backup : ${backupNote || "done"}`);

  // ── 3. Wipe + counter reset + master-state normalisation ───────────────────
  // Kept master tables carry live operational state (rooms flagged occupied,
  // tables reserved, a current_booking_id pointing at a wiped booking). Wiping
  // the bookings does NOT clean those up — that is what leaves rooms showing
  // "occupied" and dashboards showing stale counts after a reset.
  const MASTER_STATE_RESETS = [
    {
      table: "rooms",
      set: ["status = 'available'", "current_booking_id = NULL"],
      dirty: ["status <> 'available'", "current_booking_id IS NOT NULL"],
    },
    {
      table: "restaurant_tables",
      set: ["status = 'available'", "guestCount = 0", "status_color = NULL"],
      dirty: ["status <> 'available'"],
    },
    {
      table: "banquet_halls",
      set: ["status = 'available'"],
      dirty: ["status <> 'available'"],
    },
  ];

  // Which columns actually exist per table on this PC's schema.
  const tableCols = {};
  for (const { table } of MASTER_STATE_RESETS) {
    if (!have.has(table)) continue;
    const [[{ cols }]] = await conn.query(
      `SELECT GROUP_CONCAT(COLUMN_NAME) AS cols FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [db, table]
    );
    tableCols[table] = new Set((cols || "").split(",").filter(Boolean).map((c) => c.toLowerCase()));
  }
  const keep = (spec, arr) =>
    arr.filter((s) => spec.has(s.split("=")[0].trim().toLowerCase()));

  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const t of toWipe) {
      await conn.query(`DELETE FROM \`${db}\`.\`${t}\``);
    }
    const withCounter = await autoIncrementTables(conn, db, toWipe);
    for (const t of withCounter) {
      await conn.query(`ALTER TABLE \`${db}\`.\`${t}\` AUTO_INCREMENT = 1`);
    }

    let normalised = 0;
    for (const spec of MASTER_STATE_RESETS) {
      if (!have.has(spec.table)) continue;
      const applied = keep(tableCols[spec.table] || new Set(), spec.set);
      if (applied.length === 0) continue;
      await conn.query(`UPDATE \`${db}\`.\`${spec.table}\` SET ${applied.join(", ")}`);
      normalised += 1;
    }
    log(` Cleared ${toWipe.length} table(s); reset ${withCounter.length} auto-increment counter(s) to 1;`);
    log(` normalised operational state in ${normalised} master table(s) (rooms/tables/halls → available).`);
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  }

  // ── 3b. Verify the post-state: every wiped table must now be empty, and no
  //      kept master row may be left in a "dirty" operational state. ─────────
  const dirty = [];
  for (const t of toWipe) {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${db}\`.\`${t}\``);
    if (n > 0) dirty.push(`${t} (${n})`);
  }
  for (const spec of MASTER_STATE_RESETS) {
    if (!have.has(spec.table)) continue;
    const conds = keep(tableCols[spec.table] || new Set(), spec.dirty);
    if (conds.length === 0) continue;
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM \`${db}\`.\`${spec.table}\` WHERE ${conds.join(" OR ")}`
    );
    if (n > 0) dirty.push(`${spec.table} has ${n} row(s) in a non-clean state`);
  }
  if (dirty.length) {
    log(` WARNING: ${dirty.length} check(s) failed: ${dirty.join("; ")}`);
  } else {
    log(" Verified: all wiped tables are empty; master tables are in a clean state.");
  }

  // ── 4. Optional: remove generated PDFs from disk ───────────────────────────
  if (FLAG_CLEAN_UPLOADS) {
    const roots = ["uploads/invoices", "src/uploads/invoices", "uploads"];
    let removed = 0;
    for (const rel of roots) {
      const dir = path.join(__dirname, "..", "..", rel);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.toLowerCase().endsWith(".pdf")) {
          fs.rmSync(path.join(dir, f), { force: true });
          removed += 1;
        }
      }
    }
    log(` Generated PDFs removed: ${removed}`);
  }

  await conn.end();

  log("\n Done. Next steps:");
  log("  1. Restart the backend (npm run dev / node index.js).");
  log("  2. Log in with an existing user — numbers now start at 0001");
  log("     (HOTINV-…-0001, kitchen order #1, KOT-0001).");
  log("  3. The standard accounts chart re-seeds itself on boot.");
  log("  4. HARD-REFRESH the browser (Ctrl+Shift+R) — pages keep old numbers");
  log("     in memory until they reload, which looks like the reset failed.");
  log("");
}

main().catch((err) => fail(`Could not complete reset: ${err.message}`));
