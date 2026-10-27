// Shared helpers for the /api/reports-suite router.
// Plain Node, no new deps: CSV is built by string, schema checks go through
// information_schema so a missing table or column degrades to an empty report
// instead of a 500.

const db = require("../config/db");

const round2 = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const safeArray = (rows) => (Array.isArray(rows) ? rows : []);

const toDateOnly = (value) => {
  if (!value) return null;
  const text = String(value);
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

// ISO date, local calendar (the DB server's "today").
const isoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// ?from&to, default: last 30 days (from = to - 29).
function dateRange(req) {
  const now = new Date();
  let to = toDateOnly(req.query.to);
  if (!to) to = isoDate(now);
  let from = toDateOnly(req.query.from);
  if (!from) {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    from = isoDate(d);
  }
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

// RFC 4180-ish CSV: quote when the value contains , " \n \r.
// Date values come back from MySQL as JS Date objects; plain String(value)
// would dump "Fri Oct 26 2026 00:00:00 GMT" into the file, so serialise
// them as local YYYY-MM-DD (with HH:MM when they carry a time of day).
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    const h = String(value.getHours()).padStart(2, "0");
    const mi = String(value.getMinutes()).padStart(2, "0");
    value =
      value.getHours() === 0 && value.getMinutes() === 0
        ? `${y}-${m}-${d}`
        : `${y}-${m}-${d} ${h}:${mi}`;
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns, rows) {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(","));
  }
  return lines.join("\n");
}

// Runs a SELECT; returns [] instead of throwing when a table or column the
// report needs does not exist on this deployment. Other errors propagate.
async function queryOrEmpty(sql, params = []) {
  try {
    const [rows] = await db.query(sql, params);
    return safeArray(rows);
  } catch (err) {
    if (
      err &&
      (err.code === "ER_NO_SUCH_TABLE" || err.code === "ER_BAD_FIELD_ERROR")
    ) {
      return [];
    }
    throw err;
  }
}

// information_schema, not SHOW: this server's shim returns SHOW output as
// two result sets, so a length check on it is wrong (see reportsController).
const tableExists = async (tableName) => {
  const rows = await queryOrEmpty(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [tableName],
  );
  return rows.length > 0;
};

// One report response, two shapes. CSV takes priority: when the client asks
// for it, the summary still rides along as "# key=value" comment lines so a
// downloaded file keeps its headline numbers.
async function sendReport(req, res, { reportKey, columns, rows, summary }) {
  const filename = `${reportKey}_${isoDate(new Date())}.csv`;
  const csv = toCsv(columns, rows);
  if (String(req.query.format || "").toLowerCase() === "csv") {
    const header = summary
      ? Object.entries(summary)
          .map(([k, v]) => `# ${k}=${v}`)
          .join("\n")
      : null;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // BOM so Excel/Numbers open UTF-8 files (rupee sign, Hindi text, dashes)
    // with the correct encoding.
    const BOM = String.fromCharCode(0xfeff);
    res.send(BOM + (header ? header + "\n" : "") + csv + "\n");
    return;
  }
  res.json({ report: reportKey, columns, rows, summary: summary || null });
}

module.exports = {
  dateRange,
  toCsv,
  csvEscape,
  queryOrEmpty,
  tableExists,
  sendReport,
  safeArray,
  round2,
  toDateOnly,
  isoDate,
};
