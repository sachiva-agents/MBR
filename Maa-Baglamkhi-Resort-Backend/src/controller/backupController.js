const db = require("../config/db");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getDatabaseName } = require("../config/databaseConfig");

const DEFAULTS = {
  enabled: 0,
  schedule_type: "none",
  daily_time: "03:00",
  weekly_day: 0,
  custom_cron: "",
  dest_dir: "/tmp/mbr-backups",
  last_run_at: null,
  last_run_status: null,
  last_file: null,
};

const SCHEDULE_TYPES = ["none", "daily", "weekly", "custom"];

// Fallbacks keyed by the JS (camelCase) names used in a PUT patch. Every value
// is a legal non-NULL for its column, so an empty/absent field never writes NULL.
const JS_DEFAULTS = {
  enabled: 0,
  scheduleType: "none",
  dailyTime: "03:00",
  weeklyDay: 0,
  customCron: "",
  destDir: "/tmp/mbr-backups",
};

// mysqldump/mysql live under XAMPP on this machine, not on a bare shell PATH.
const XAMPP_BIN = "/Applications/XAMPP/xamppfiles/bin";
function tool(name) {
  const x = path.join(XAMPP_BIN, name);
  return fs.existsSync(x) ? x : name;
}

const ensureBackupSettingsRow = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS backup_settings (
      id INT NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      schedule_type VARCHAR(10) NOT NULL DEFAULT 'none',
      daily_time VARCHAR(5) NOT NULL DEFAULT '03:00',
      weekly_day TINYINT NOT NULL DEFAULT 0,
      custom_cron VARCHAR(64) NOT NULL DEFAULT '',
      dest_dir VARCHAR(255) NOT NULL DEFAULT '/tmp/mbr-backups',
      last_run_at DATETIME DEFAULT NULL,
      last_run_status VARCHAR(255) DEFAULT NULL,
      last_file VARCHAR(255) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await db.query("INSERT IGNORE INTO backup_settings (id) VALUES (1)");
};

const readSettings = async () => {
  await ensureBackupSettingsRow();
  const [rows] = await db.query("SELECT * FROM backup_settings WHERE id = 1 LIMIT 1");
  const row = rows[0] || {};
  return {
    enabled: Number(row.enabled ?? DEFAULTS.enabled) === 1,
    scheduleType: row.schedule_type || DEFAULTS.schedule_type,
    dailyTime: row.daily_time || DEFAULTS.daily_time,
    weeklyDay: Number(row.weekly_day ?? DEFAULTS.weekly_day),
    customCron: row.custom_cron || "",
    destDir: row.dest_dir || DEFAULTS.dest_dir,
    lastRunAt: row.last_run_at || null,
    lastRunStatus: row.last_run_status,
    lastFile: row.last_file,
  };
};

const writeSettings = async (patch) => {
  await ensureBackupSettingsRow();
  const setParts = [];
  const values = [];
  const map = {
    enabled: "enabled",
    scheduleType: "schedule_type",
    dailyTime: "daily_time",
    weeklyDay: "weekly_day",
    customCron: "custom_cron",
    destDir: "dest_dir",
  };
  for (const [jsKey, dbCol] of Object.entries(map)) {
    if (!(jsKey in patch)) continue;
    let value = patch[jsKey];
    if (jsKey === "enabled") value = value ? 1 : 0;
    if (value === undefined || value === null || value === "") value = JS_DEFAULTS[jsKey];
    setParts.push(`${dbCol} = ?`);
    values.push(value);
  }
  if (setParts.length) {
    await db.query(`UPDATE backup_settings SET ${setParts.join(", ")} WHERE id = 1`, values);
  }
  return readSettings();
};

const recordRun = async (status, file) => {
  await ensureBackupSettingsRow();
  const now = new Date();
  const at = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  if (file) {
    await db.query(
      "UPDATE backup_settings SET last_run_at = ?, last_run_status = ?, last_file = ? WHERE id = 1",
      [at, status, file],
    );
  } else {
    await db.query(
      "UPDATE backup_settings SET last_run_at = ?, last_run_status = ? WHERE id = 1",
      [at, status],
    );
  }
};

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// DB client identity: the web app's own credentials so the shell tools hit
// the same account the pool uses.
const dbUser = () => process.env.DB_USER || "root";
const dbPassword = () => process.env.DB_PASSWORD || "";

const spawnFile = (cmd, args, outPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const stream = fs.createWriteStream(outPath);
    child.stdout.pipe(stream);
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => {
      stream.end();
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });

const spawnStdin = (cmd, args, inputPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    const src = fs.createReadStream(inputPath);
    src.on("error", reject);
    src.pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });

// Shared by POST /run and the scheduler so the two paths never diverge.
const runBackup = async () => {
  const s = await readSettings();
  fs.mkdirSync(s.destDir, { recursive: true });
  const base = stamp();
  const partial = path.join(s.destDir, `${base}.part`);
  const args = ["-u", dbUser(), "--databases", getDatabaseName(), "--single-transaction"];
  if (dbPassword()) args.push(`--password=${dbPassword()}`);
  try {
    await spawnFile(tool("mysqldump"), args, partial);
  } catch (err) {
    // a failed dump leaves a partial file; drop it so restore can never
    // pick up a corrupt dump
    fs.rmSync(partial, { force: true });
    await recordRun(`failed: ${err.message}`, null);
    throw err;
  }
  const name = `${base}.sql`;
  fs.renameSync(partial, path.join(s.destDir, name));
  await recordRun("ok", name);
  const st = fs.statSync(path.join(s.destDir, name));
  return { file: name, sizeBytes: st.size };
};

// Minimal 5-field cron matcher: * or */N in minute+hour; fixed values allowed
// anywhere; day/month/weekday other than * are not supported (rejects them).
const parseCron = (expr) => {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("customCron must have 5 fields");
  const field = (f, min, max, named) => {
    if (f === "*") return new Set(Array.from({ length: max - min + 1 }, (_, i) => min + i));
    const m = /^\*\/(\d+)$/.exec(f);
    if (m) {
      const n = Number(m[1]);
      if (n < 1 || n > max - min) throw new Error(`bad step */${n} in ${named}`);
      return new Set(Array.from({ length: Math.floor((max - min) / n) + 1 }, (_, i) => min + i * n));
    }
    const v = Number(f);
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`bad value ${f} in ${named}`);
    return new Set([v]);
  };
  return {
    min: field(parts[0], 0, 59, "minute"),
    hour: field(parts[1], 0, 23, "hour"),
    dom: field(parts[2], 1, 31, "day-of-month"),
    mon: field(parts[3], 1, 12, "month"),
    dow: field(parts[4], 0, 7, "day-of-week"),
  };
};

const cronDue = (expr, lastRunAt, now) => {
  const c = parseCron(expr);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const candidates = [];
  for (let h = 0; h < 24; h++) {
    if (!c.hour.has(h)) continue;
    for (let m = 0; m < 60; m++) {
      if (!c.min.has(m)) continue;
      if (h * 60 + m > nowMin) break;
      candidates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m));
    }
  }
  // only fire if the last matching slot (today) has not fired yet
  const due = candidates[candidates.length - 1];
  if (!due) return false;
  const last = lastRunAt ? new Date(String(lastRunAt).replace(" ", "T")) : null;
  return !last || last.getTime() < due.getTime();
};

exports.getSettings = async (_req, res) => {
  try {
    res.json(await readSettings());
  } catch (err) {
    console.error("backup getSettings error:", err);
    res.status(500).json({ error: err.message || "Failed to load backup settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    for (const k of ["enabled", "scheduleType", "dailyTime", "weeklyDay", "customCron", "destDir"]) {
      if (k in body) patch[k] = body[k];
    }
    if (patch.scheduleType !== undefined && !SCHEDULE_TYPES.includes(patch.scheduleType)) {
      return res
        .status(400)
        .json({ error: `scheduleType must be one of: ${SCHEDULE_TYPES.join(", ")}` });
    }
    if (patch.dailyTime !== undefined && !/^\d{2}:\d{2}$/.test(String(patch.dailyTime))) {
      return res.status(400).json({ error: "dailyTime must be HH:MM" });
    }
    if (patch.weeklyDay !== undefined && (Number(patch.weeklyDay) < 0 || Number(patch.weeklyDay) > 6)) {
      return res.status(400).json({ error: "weeklyDay must be 0-6" });
    }
    if (patch.customCron !== undefined && patch.scheduleType === "custom") {
      try {
        parseCron(patch.customCron);
      } catch (e) {
        return res.status(400).json({ error: `customCron: ${e.message}` });
      }
    }
    if (patch.destDir !== undefined) {
      if (typeof patch.destDir !== "string" || !path.isAbsolute(patch.destDir)) {
        return res.status(400).json({ error: "destDir must be an absolute server path" });
      }
      fs.mkdirSync(patch.destDir, { recursive: true });
    }
    const settings = await writeSettings(patch);
    res.json({ message: "Backup settings updated", settings });
  } catch (err) {
    console.error("backup updateSettings error:", err);
    res.status(500).json({ error: err.message || "Failed to update backup settings" });
  }
};

exports.runNow = async (_req, res) => {
  try {
    const { file, sizeBytes } = await runBackup();
    res.json({ file, sizeBytes });
  } catch (err) {
    console.error("backup run error:", err);
    res.status(500).json({ error: err.message || "Backup failed" });
  }
};

exports.list = async (_req, res) => {
  try {
    const s = await readSettings();
    let files = [];
    if (fs.existsSync(s.destDir)) {
      files = fs
        .readdirSync(s.destDir)
        .filter((f) => /^backup_.*\.sql$/.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(s.destDir, f));
          return { name: f, sizeBytes: st.size, mtimeISO: st.mtime.toISOString() };
        })
        .sort((a, b) => (a.name < b.name ? 1 : -1));
    }
    res.json({ destDir: s.destDir, files });
  } catch (err) {
    console.error("backup list error:", err);
    res.status(500).json({ error: err.message || "Failed to list backups" });
  }
};

exports.restore = async (req, res) => {
  try {
    const name = String((req.body || {}).file || "");
    if (!/^[A-Za-z0-9._-]+\.sql$/.test(name) || name.includes("..")) {
      return res.status(400).json({ error: "file must be a bare .sql basename" });
    }
    const s = await readSettings();
    fs.mkdirSync(s.destDir, { recursive: true });
    const target = path.join(s.destDir, name);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: "backup file not found" });
    }
    // safety copy of the live DB before clobbering it
    const safetyName = `pre-restore_${Date.now()}.sql`;
    const dumpArgs = ["-u", dbUser(), "--databases", getDatabaseName(), "--single-transaction"];
    if (dbPassword()) dumpArgs.push(`--password=${dbPassword()}`);
    await spawnFile(tool("mysqldump"), dumpArgs, path.join(s.destDir, safetyName));
    const mysqlArgs = ["-u", dbUser(), getDatabaseName()];
    if (dbPassword()) mysqlArgs.push(`--password=${dbPassword()}`);
    await spawnStdin(tool("mysql"), mysqlArgs, target);
    res.json({ ok: true, safetyFile: safetyName, file: name });
  } catch (err) {
    console.error("backup restore error:", err);
    res.status(500).json({ error: err.message || "Restore failed" });
  }
};

exports.readSettings = readSettings;
exports.runBackup = runBackup;
exports.cronDue = cronDue;
exports.parseCron = parseCron;
