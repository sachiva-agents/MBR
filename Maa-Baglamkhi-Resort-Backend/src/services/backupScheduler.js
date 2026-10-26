/*
 * In-app backup scheduler: 60s tick, no cron packages.
 * Fires the same runBackup() the POST /api/backups/run endpoint uses, so the
 * two paths never diverge. customCron supports a minimal subset (see
 * backupController.parseCron: a star or a star-slash-N step in minute/hour,
 * fixed values allowed, day/month/weekday other than star are rejected).
 */

const backupController = require("../controller/backupController");

let timer = null;
let running = false;

const parseHHMM = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const slotDue = async () => {
  const s = await backupController.readSettings();
  if (!s.enabled || s.scheduleType === "none") return false;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const last = s.lastRunAt ? new Date(String(s.lastRunAt).replace(" ", "T")) : null;

  if (s.scheduleType === "daily") {
    const slot = parseHHMM(s.dailyTime);
    if (slot === null) return false;
    const due = nowMin >= slot && (!last || last.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, slot).getTime());
    return due;
  }

  if (s.scheduleType === "weekly") {
    const slot = parseHHMM(s.dailyTime);
    if (slot === null) return false;
    if (now.getDay() !== Number(s.weeklyDay)) return false;
    const due = nowMin >= slot && (!last || last.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, slot).getTime());
    return due;
  }

  // custom
  if (!s.customCron) return false;
  return backupController.cronDue(s.customCron, s.lastRunAt, now);
};

const tick = async () => {
  if (running) return;
  running = true;
  try {
    if (await slotDue()) {
      await backupController.runBackup();
    }
  } catch (err) {
    console.error("[backupScheduler]", err.message);
  } finally {
    running = false;
  }
};

const start = () => {
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  timer.unref();
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { start, stop };
