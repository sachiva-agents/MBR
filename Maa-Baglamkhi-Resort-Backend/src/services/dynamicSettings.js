/**
 * dynamicSettings — DB-backed connector config the admin sets from the UI.
 *
 * Zero-config promise (HAG-23): a hotel installs on a local machine and the
 * admin configures connectors in-app, no .env edits. The values are stored in
 * the `app_settings` single-row table next to the pay/business settings and
 * loaded into a live in-memory snapshot so a saved value takes effect without
 * restarting the process.
 *
 * ── PRECEDENCE (the single place this is defined) ────────────────────────
 *   1. DB      — the app_settings column, when it holds a non-NULL value
 *                (the admin's most recent in-app choice; wins).
 *   2. .env    — the operator's .env value, using each key's documented
 *                override order.
 *   3. default — the built-in fallback so a fresh install still works.
 *
 * A DB value is used only when the column exists AND is non-NULL; a NULL /
 * missing column falls through to .env, so an install that never opened the
 * settings screen behaves exactly as before.
 *
 * ── LIVE MODEL ──────────────────────────────────────────────────────────────
 * `live` holds the last-resolved values. It is populated from .env/default at
 * module load (no DB), then `refresh()` re-reads the DB row, recomputes every
 * value by precedence, and applies the result to the two consumers that are
 * read synchronously (the print path):
 *   - patching PrintConfig's KITCHEN_PRINTER name, and
 *   - storing the auto-print flag.
 * `refresh()` is called at boot (index.js) and after every settings save, so
 * the print + WhatsApp paths see saved values with no restart. Sync
 * accessors below just read `live`.
 *
 * Nothing here may throw: on any DB error the snapshot keeps its last value
 * (or the env/default fallbacks at cold start).
 */

const db = require("../config/db");

const CACHE_TTL_MS = 10 * 1000;
let cache = { row: null, at: 0 };

// Column → env override order + built-in default.
const COLUMNS = {
  kot_printer_name: {
    env: ["KOT_PRINTER_NAME", "KITCHEN_PRINTER_NAME"],
    default: "kitchen",
  },
  auto_print_enabled: {
    env: ["AUTO_PRINT_ENABLED"],
    default: null, // null → fall back to env, then "on"
  },
  whatsapp_gateway_url: {
    env: ["WHATSAPP_GATEWAY_URL", "wasachiva_url", "WASACHIVA_URL"],
    default: "https://wasend.sachiva.cloud",
  },
  whatsapp_api_key: {
    env: ["WHATSAPP_API_KEY", "WASACHIVA_KEY", "wasachiva_key"],
    default: "",
  },
  zk_auto_sync_disabled: {
    env: ["ZK_AUTO_SYNC_DISABLED"],
    default: null, // null → fall back to env, then "enabled"
  },
  zk_auto_sync_interval_minutes: {
    env: ["ZK_AUTO_SYNC_INTERVAL_MINUTES"],
    default: 15,
  },
  zk_auto_sync_window_hours: {
    env: ["ZK_AUTO_SYNC_WINDOW_HOURS"],
    default: 4,
  },
  public_base_url: {
    env: ["PUBLIC_BASE_URL"],
    default: "",
  },
};

// Portable migration: CREATE with the full column set on a fresh DB, and ALTER
// in any column missing on an existing one. Idempotent. The base + pay columns
// are owned by settingsController.ensureSettingsRow; we declare the superset so
// the table converges regardless of which CREATE ran first.
const ALL_KNOWN_COLUMNS = [
  ["id", "INT NOT NULL PRIMARY KEY"],
  ["admin_whatsapp_number", "VARCHAR(30) DEFAULT NULL"],
  ["admin_whatsapp_username", "VARCHAR(80) DEFAULT NULL"],
  ["sms_enabled", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["business_name", "VARCHAR(120) DEFAULT 'Maa Baglamukhi Resort'"],
  ["business_contact", "VARCHAR(120) DEFAULT NULL"],
  ["present_pay", "DECIMAL(5,2) NOT NULL DEFAULT 100"],
  ["late_pay", "DECIMAL(5,2) NOT NULL DEFAULT 50"],
  ["half_day_pay", "DECIMAL(5,2) NOT NULL DEFAULT 50"],
  ["absent_pay", "DECIMAL(5,2) NOT NULL DEFAULT 0"],
  ["leave_pay", "DECIMAL(5,2) NOT NULL DEFAULT 0"],
  // ── connector columns (HAG-23) ──
  ["kot_printer_name", "VARCHAR(120) DEFAULT NULL"],
  ["auto_print_enabled", "TINYINT(1) DEFAULT NULL"],
  ["whatsapp_gateway_url", "VARCHAR(255) DEFAULT NULL"],
  ["whatsapp_api_key", "VARCHAR(255) DEFAULT NULL"],
  ["zk_auto_sync_disabled", "TINYINT(1) DEFAULT NULL"],
  ["zk_auto_sync_interval_minutes", "INT DEFAULT NULL"],
  ["zk_auto_sync_window_hours", "INT DEFAULT NULL"],
  ["public_base_url", "VARCHAR(255) DEFAULT NULL"],
  ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"],
];

async function ensureSchema() {
  const colDefs = ALL_KNOWN_COLUMNS.map(([n, d]) => `\`${n}\` ${d}`).join(",\n  ");
  await db.query(`CREATE TABLE IF NOT EXISTS app_settings (\n  ${colDefs}\n)`);

  const [have] = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'app_settings'`,
  );
  const present = new Set(have.map((r) => r.column_name));
  for (const [name, def] of ALL_KNOWN_COLUMNS) {
    if (name === "id") continue;
    if (!present.has(name)) {
      await db.query(`ALTER TABLE app_settings ADD COLUMN \`${name}\` ${def}`);
    }
  }

  const [rows] = await db.query("SELECT id FROM app_settings WHERE id = 1 LIMIT 1");
  if (!rows || rows.length === 0) {
    // Seed a single-row id=1. schema-v4's key/value app_shape can carry a
    // NOT-NULL `key` column (no default) — seed that too when present.
    // A seed failure is non-fatal: getRow() degrades to {} (env/default),
    // and settingsController.ensureSettingsRow() re-tries on the next call.
    try {
      const [keyCols] = await db.query(
        `SELECT is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'app_settings' AND column_name = 'key'`
      );
      const keyRequiresValue =
        keyCols.length > 0 && keyCols[0].is_nullable === "NO" && keyCols[0].column_default === null;
      if (keyRequiresValue) {
        await db.query("INSERT INTO app_settings (id, `key`) VALUES (1, 'default')");
      } else {
        await db.query("INSERT INTO app_settings (id) VALUES (1)");
      }
    } catch (err) {
      console.warn("[dynamic-settings] app_settings seed skipped:", err.message);
    }
  }
}

// Read the raw row (cached). Never throws: on any DB error it returns {}.
async function getRow() {
  const now = Date.now();
  if (cache.row && now - cache.at < CACHE_TTL_MS) return cache.row;
  let row = {};
  try {
    const [rows] = await db.query("SELECT * FROM app_settings WHERE id = 1 LIMIT 1");
    row = (rows && rows[0]) || {};
  } catch {
    row = {};
  }
  cache = { row, at: now };
  return row;
}

/** Drop the read cache so the next refresh re-reads the DB. */
function invalidate() {
  cache = { row: null, at: 0 };
}

// Resolve one key by precedence: DB (non-null) → first set .env → default.
async function resolve(dbCol) {
  const spec = COLUMNS[dbCol];
  if (!spec) return undefined;
  const row = await getRow();
  const dbVal = row[dbCol];
  if (dbVal !== null && dbVal !== undefined && dbVal !== "") return dbVal;
  for (const envName of spec.env) {
    const v = process.env[envName];
    if (v !== undefined && v !== "") return v;
  }
  return spec.default;
}

const toBool = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v === 1;
  return !["false", "0", "off", "no"].includes(String(v).trim().toLowerCase());
};

// ── Live snapshot (sync accessors for the print + WhatsApp paths) ────────
const PrintConfig = require("../PrintConfig");

// Populated from env/default at load so sync accessors are safe pre-boot;
// refresh() overlays the DB-resolved values.
const live = {
  kotPrinterName:
    process.env.KOT_PRINTER_NAME || process.env.KITCHEN_PRINTER_NAME || "kitchen",
  autoPrintEnabled: toBool(process.env.AUTO_PRINT_ENABLED) ?? true,
  whatsappGatewayUrl:
    (process.env.WHATSAPP_GATEWAY_URL ||
      process.env.wasachiva_url ||
      process.env.WASACHIVA_URL ||
      "https://wasend.sachiva.cloud")
      .replace(/\/+$/, "")
      .replace(/\?.*$/, ""),
  whatsappApiKey:
    process.env.WHATSAPP_API_KEY ||
    process.env.WASACHIVA_KEY ||
    process.env.wasachiva_key ||
    "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  zkAutoSync: {
    disabled: toBool(process.env.ZK_AUTO_SYNC_DISABLED) ?? false,
    intervalMinutes: Number(process.env.ZK_AUTO_SYNC_INTERVAL_MINUTES) || 15,
    windowHours: Number(process.env.ZK_AUTO_SYNC_WINDOW_HOURS) || 4,
  },
};

/**
 * Re-read the DB row, resolve every connector value by precedence, update the
 * live snapshot, and apply it to the synchronous print-path consumers
 * (PrintConfig's KITCHEN_PRINTER name). Idempotent + never throws. Call at
 * boot and after each settings save so saved values apply with no restart.
 */
async function refresh() {
  try {
    await ensureSchema();
    const row = await getRow();

    const kotName = (row.kot_printer_name ||
      process.env.KOT_PRINTER_NAME ||
      process.env.KITCHEN_PRINTER_NAME ||
      "kitchen");
    live.kotPrinterName = kotName;
    if (PrintConfig.PRINTERS && PrintConfig.PRINTERS.KITCHEN_PRINTER) {
      PrintConfig.PRINTERS.KITCHEN_PRINTER.name = kotName;
    }

    const autoRaw =
      row.auto_print_enabled !== null && row.auto_print_enabled !== undefined
        ? row.auto_print_enabled
        : process.env.AUTO_PRINT_ENABLED;
    live.autoPrintEnabled = toBool(autoRaw) ?? true;

    live.whatsappGatewayUrl = (row.whatsapp_gateway_url ||
      process.env.WHATSAPP_GATEWAY_URL ||
      process.env.wasachiva_url ||
      process.env.WASACHIVA_URL ||
      "https://wasend.sachiva.cloud")
      .replace(/\/+$/, "")
      .replace(/\?.*$/, "");
    live.whatsappApiKey = row.whatsapp_api_key ||
      process.env.WHATSAPP_API_KEY ||
      process.env.WASACHIVA_KEY ||
      process.env.wasachiva_key ||
      "";

    live.publicBaseUrl = row.public_base_url || process.env.PUBLIC_BASE_URL || "";

    const zkDisabledRaw =
      row.zk_auto_sync_disabled !== null && row.zk_auto_sync_disabled !== undefined
        ? row.zk_auto_sync_disabled
        : process.env.ZK_AUTO_SYNC_DISABLED;
    live.zkAutoSync = {
      disabled: toBool(zkDisabledRaw) ?? false,
      intervalMinutes:
        Number(row.zk_auto_sync_interval_minutes || process.env.ZK_AUTO_SYNC_INTERVAL_MINUTES) || 15,
      windowHours:
        Number(row.zk_auto_sync_window_hours || process.env.ZK_AUTO_SYNC_WINDOW_HOURS) || 4,
    };

    invalidate(); // the next getRow() re-reads; keep TTL fresh
    return live;
  } catch (err) {
    // Never throw into the print/WhatsApp path — keep last good snapshot,
    // but surface the reason so a boot-time schema hiccup is diagnosable.
    console.warn("[dynamic-settings] refresh failed:", err.message || err);
    return live;
  }
}

// Sync accessors (read the primed snapshot; no DB hit, no throw).
const getKotPrinterName = () => live.kotPrinterName;
const isAutoPrintEnabled = () => live.autoPrintEnabled;
const getWhatsappGatewayUrl = () => live.whatsappGatewayUrl;
const getWhatsappApiKey = () => live.whatsappApiKey;
const getPublicBaseUrl = () => live.publicBaseUrl;
const getZkAutoSync = () => ({ ...live.zkAutoSync });

/** The merged connector settings object, for the GET /settings surface. */
const getConnectorSettings = () => ({
  kotPrinterName: live.kotPrinterName,
  autoPrintEnabled: live.autoPrintEnabled,
  whatsappGatewayUrl: live.whatsappGatewayUrl,
  whatsappApiKey: live.whatsappApiKey ? redactKey(live.whatsappApiKey) : "",
  zkAutoSyncDisabled: live.zkAutoSync.disabled,
  zkAutoSyncIntervalMinutes: live.zkAutoSync.intervalMinutes,
  zkAutoSyncWindowHours: live.zkAutoSync.windowHours,
  publicBaseUrl: live.publicBaseUrl,
});

// Show enough of the key to confirm which one is active without echoing it.
const redactKey = (k) =>
  k.length <= 8 ? "****" : `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} chars)`;

// Test hook.
const __resetCache = invalidate;

module.exports = {
  COLUMNS,
  ensureSchema,
  invalidate,
  refresh,
  getConnectorSettings,
  getKotPrinterName,
  isAutoPrintEnabled,
  getWhatsappGatewayUrl,
  getWhatsappApiKey,
  getPublicBaseUrl,
  getZkAutoSync,
  __resetCache,
};
