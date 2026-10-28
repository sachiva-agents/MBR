const db = require("../config/db");


const DEFAULT_SETTINGS = {
  adminWhatsappNumber: "",
  adminWhatsappUsername: "ankit",
  smsEnabled: false,
  businessName: "Maa Baglamukhi Resort",
  businessContact: "",
  // Pay as a % of the full daily wage, per attendance status.
  presentPay: 100,
  latePay: 50,
  halfDayPay: 50,
  absentPay: 0,
  leavePay: 0,
};

// New columns added to existing installs (CREATE TABLE below covers fresh ones).
// An app_settings table created before a column existed is never altered by
// CREATE TABLE IF NOT EXISTS — every column the table must carry is migrated
// individually here, not just the pay ones.
const PAY_COLUMNS = [
  ["present_pay", "DECIMAL(5,2) NOT NULL DEFAULT 100"],
  ["late_pay", "DECIMAL(5,2) NOT NULL DEFAULT 50"],
  ["half_day_pay", "DECIMAL(5,2) NOT NULL DEFAULT 50"],
  ["absent_pay", "DECIMAL(5,2) NOT NULL DEFAULT 0"],
  ["leave_pay", "DECIMAL(5,2) NOT NULL DEFAULT 0"],
];
const MIGRATED_COLUMNS = [
  ["admin_whatsapp_number", "VARCHAR(30) NULL"],
  ["admin_whatsapp_username", "VARCHAR(80) NULL"],
  ["sms_enabled", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["business_name", "VARCHAR(120) DEFAULT 'Maa Baglamukhi Resort'"],
  ["business_contact", "VARCHAR(120) NULL"],
  ...PAY_COLUMNS,
];

const ensureSettingsRow = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT NOT NULL PRIMARY KEY,
      admin_whatsapp_number VARCHAR(30) DEFAULT NULL,
      admin_whatsapp_username VARCHAR(80) DEFAULT NULL,
      sms_enabled TINYINT(1) NOT NULL DEFAULT 0,
      business_name VARCHAR(120) DEFAULT 'Maa Baglamukhi Resort',
      business_contact VARCHAR(120) DEFAULT NULL,
      present_pay DECIMAL(5,2) NOT NULL DEFAULT 100,
      late_pay DECIMAL(5,2) NOT NULL DEFAULT 50,
      half_day_pay DECIMAL(5,2) NOT NULL DEFAULT 50,
      absent_pay DECIMAL(5,2) NOT NULL DEFAULT 0,
      leave_pay DECIMAL(5,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  // MySQL has no ADD COLUMN IF NOT EXISTS — check per column instead.
  for (const [column, def] of MIGRATED_COLUMNS) {
    const [check] = await db.query(
      "SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'app_settings' AND column_name = ?",
      [column]
    );
    if (check[0].c === 0) {
      await db.query(`ALTER TABLE app_settings ADD COLUMN ${column} ${def}`);
    }
  }
  const [existing] = await db.query("SELECT id FROM app_settings WHERE id = 1");
  // `existing` is the rows array: an empty result is [] — truthy — so check
  // length or the seed INSERT below is skipped and the row never gets created.
  if (!existing || existing.length === 0) {
    // Some installs carry a pre-existing key/value shape app_settings where
    // `key` is NOT NULL + UNIQUE; the fresh CREATE TABLE above has no such
    // column. Seed the row in the shape the table actually has.
    const [cols] = await db.query(
      "SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'app_settings' AND column_name = 'key'"
    );
    if (cols[0].c > 0) {
      await db.query(`INSERT INTO app_settings (\`key\`) VALUES ('default')`);
    } else {
      await db.query(`INSERT INTO app_settings (id) VALUES (1)`);
    }
  }
};

// Pay-percentage fields: js key -> column. Only numbers 0–100 are stored.
const PAY_KEYS = ["presentPay", "latePay", "halfDayPay", "absentPay", "leavePay"];

const clampPercent = (value, fallback) => {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, n));
};

const payFromRow = (row) => {
  const out = {};
  for (const key of PAY_KEYS) {
    const column = key === "presentPay" ? "present_pay"
      : key === "latePay" ? "late_pay"
      : key === "halfDayPay" ? "half_day_pay"
      : key === "absentPay" ? "absent_pay"
      : "leave_pay";
    out[key] = clampPercent(row[column], DEFAULT_SETTINGS[key]);
  }
  return out;
};

const getSettings = async () => {
  await ensureSettingsRow();
  const [rows] = await db.query("SELECT * FROM app_settings WHERE id = 1 LIMIT 1");
  const row = rows[0] || {};
  return {
    id: row.id,
    adminWhatsappNumber:
      row.admin_whatsapp_number ||
      process.env.ADMIN_WHATSAPP_NUMBER ||
      "",
    adminWhatsappUsername:
      row.admin_whatsapp_username ||
      process.env.WASACHIVA_USERNAME ||
      "ankit",
    smsEnabled: Number(row.sms_enabled) === 1,
    businessName:
      row.business_name ||
      process.env.BUSINESS_NAME ||
      "Maa Baglamukhi Resort",
    businessContact:
      row.business_contact ||
      process.env.BUSINESS_CONTACT ||
      "",
    ...payFromRow(row),
    updatedAt: row.updated_at || null,
  };
};

const updateSettings = async (patch = {}) => {
  await ensureSettingsRow();

  const map = {
    adminWhatsappNumber: "admin_whatsapp_number",
    adminWhatsappUsername: "admin_whatsapp_username",
    smsEnabled: "sms_enabled",
    businessName: "business_name",
    businessContact: "business_contact",
    presentPay: "present_pay",
    latePay: "late_pay",
    halfDayPay: "half_day_pay",
    absentPay: "absent_pay",
    leavePay: "leave_pay",
  };

  const setParts = [];
  const values = [];
  for (const [jsKey, dbCol] of Object.entries(map)) {
    if (!(jsKey in patch)) continue;
    let value = patch[jsKey];
    if (jsKey === "smsEnabled") {
      value = value ? 1 : 0;
    }
    if (PAY_KEYS.includes(jsKey)) {
      // Never null: a bad/empty value keeps the current default instead of
      // wiping pay rules. Clamped to 0–100.
      value = clampPercent(value, DEFAULT_SETTINGS[jsKey]);
    }
    if (PAY_KEYS.includes(jsKey)) {
      // clampPercent already guarantees a number; skip the null coercion.
    } else if (value === "" || value === null || value === undefined) {
      value = null;
    }
    setParts.push(`${dbCol} = ?`);
    values.push(value);
  }

  if (setParts.length) {
    await db.query(
      `UPDATE app_settings SET ${setParts.join(", ")} WHERE id = 1`,
      values,
    );
  }

  return getSettings();
};

/**
 * Pay percentages for attendance status, as fractions of the full daily
 * wage (0–100). Used by the salary/attendance calculators so the rules
 * live in app_settings, editable by admin from the Salary page.
 *
 * Unknown statuses still default to full pay (same policy as before):
 * returning 0 for an unrecognised status could wipe a whole month of pay.
 */
// Report/payroll handlers call this once per request; a short cache keeps
// them from re-running ensureSettingsRow (5 information_schema checks) per call.
let payPctCache = { at: 0, value: null };
const PAY_PCT_CACHE_MS = 30_000;

// Test hook: force the next getPayPercentages() to re-read settings.
exports.__resetPayPctCache = () => {
  payPctCache = { at: 0, value: null };
};

exports.getPayPercentages = async () => {
  // Fractions of the full daily wage, matching DEFAULT_SETTINGS above.
  const defaults = {
    present: 1,      // Present: full day
    late: 0.5,      // Late: 50% deduction
    half_day: 0.5,  // Half day
    absent: 0,      // Absent: no pay
    on_leave: 0,    // On leave: no pay
    holiday: 1,     // Holiday: full pay
    week_off: 1,    // Week off: full pay
  };

  if (payPctCache.value && Date.now() - payPctCache.at < PAY_PCT_CACHE_MS) {
    return payPctCache.value;
  }

  let result;
  try {
    const s = await getSettings();
    result = {
      present: clampPercent(s.presentPay, 100) / 100,
      late: clampPercent(s.latePay, 50) / 100,
      half_day: clampPercent(s.halfDayPay, 50) / 100,
      absent: clampPercent(s.absentPay, 0) / 100,
      on_leave: clampPercent(s.leavePay, 0) / 100,
      holiday: defaults.holiday,
      week_off: defaults.week_off,
    };
  } catch (err) {
    console.warn("getPayPercentages: falling back to defaults", err.message || err);
    return defaults;
  }

  payPctCache = { at: Date.now(), value: result };
  return result;
};

exports.getSettings = async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    console.error("getSettings error:", err);
    res.status(500).json({ error: err.message || "Failed to load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const allowed = [
      "adminWhatsappNumber",
      "adminWhatsappUsername",
      "smsEnabled",
      "businessName",
      "businessContact",
      ...PAY_KEYS,
    ];
    const patch = {};
    for (const key of allowed) {
      if (key in (req.body || {})) {
        patch[key] = req.body[key];
      }
    }

    // An empty {} or whitespace-only body (and one carrying only unknown
    // keys) used to 200 without touching anything; reject it instead.
    if (!Object.keys(patch).length) {
      return res.status(400).json({
        error:
          "Request body must contain at least one settings field to update",
      });
    }

    if (patch.adminWhatsappNumber) {
      const digits = String(patch.adminWhatsappNumber).replace(/\D+/g, "");
      if (digits.length < 10 || digits.length > 15) {
        return res.status(400).json({
          error:
            "adminWhatsappNumber must be a valid phone number (10–15 digits, with country code)",
        });
      }
      patch.adminWhatsappNumber = digits;
    }

    const settings = await updateSettings(patch);
    payPctCache = { at: 0, value: null }; // force a fresh read on next use
    res.json({ message: "Settings updated", settings });
  } catch (err) {
    console.error("updateSettings error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to update settings" });
  }
};
