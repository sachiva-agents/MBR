// Automatic ESSL / ZKTeco attendance sync.
//
// Runs the full syncMachine() pass (clock align -> pull -> shift groups ->
// attendance_records) for every ACTIVE machine on an interval, so punches
// land in the database without an admin clicking "Sync" in the UI.
//
//   ZK_AUTO_SYNC_DISABLED=true     turn the scheduler off
//   ZK_AUTO_SYNC_INTERVAL_MINUTES  interval between runs (default 15)
//   ZK_AUTO_SYNC_WINDOW_HOURS      look-back window per run (default 4)
//
// A PID lock file under /tmp keeps pm2 cluster workers from running several
// schedulers against the same machines (the ZK protocol is not safe for
// concurrent pullers on one device).

const fs = require("fs");
const os = require("os");
const path = require("path");

const machinesModel = require("../models/AttendanceMachinesModel");
const { syncMachine } = require("./zkSyncService");

const LOCK_FILE = path.join(os.tmpdir(), "zk-auto-sync.lock");

const readLock = () => {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")) || null;
  } catch {
    return null;
  }
};

const acquireLock = () => {
  const lock = readLock();
  if (lock && lock.pid === process.pid) return true;
  // A lock left by a dead process is stale: take it over.
  try {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
      "utf8"
    );
    return true;
  } catch {
    return false;
  }
};

const isProcessAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EACCES: the pid exists but belongs to another process — on Windows
    // signalling a foreign pid always raises EACCES even when it is alive,
    // so it must count as a live lock owner, not a stale one.
    if (err && (err.code === "EACCES" || err.code === "EPERM")) return true;
    return false; // ESRCH/EINVAL: pid is gone.
  }
};

const buildWindow = (now, windowHours) => {
  const pad2 = (v) => String(v).padStart(2, "0");
  const stamp = (d) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return { from: stamp(new Date(now.getTime() - windowHours * 60 * 60 * 1000)), to: stamp(now) };
};

// One pass over every active machine. Runs sequentially per machine; a
// device that is offline must not block or delay the rest.
async function runOnce() {
  const lock = readLock();
  if (lock && lock.pid !== process.pid && isProcessAlive(lock.pid)) {
    console.log("[zk-auto-sync] another process owns the lock; skipping this run");
    return [];
  }
  if (!acquireLock()) {
    console.log("[zk-auto-sync] could not acquire lock; skipping this run");
    return [];
  }

  const results = [];
  try {
    await machinesModel.ensureSchema();
    const machines = (await machinesModel.listMachines()).filter(
      (m) => m.status === "active"
    );
    for (const machine of machines) {
      try {
        const { from, to } = buildWindow(new Date(), Number(process.env.ZK_AUTO_SYNC_WINDOW_HOURS || 4));
        const summary = await syncMachine(machine, { from, to, deleteAfter: false, actor: "zk-auto-sync" });
        results.push(summary);
        console.log(
          `[zk-auto-sync] ${machine.name}: ${summary.logsPulled} punches, ` +
            `${summary.recordsCreated} created, ${summary.recordsUpdated} updated, ` +
            `${summary.recordsAlreadyMarked || 0} already marked (${summary.status})`
        );
      } catch (err) {
        console.error(`[zk-auto-sync] ${machine.name} sync failed:`, err.message);
        results.push({ machine: machine.name, error: err.message });
      }
    }
  } catch (err) {
    console.error("[zk-auto-sync] run failed:", err.message);
  }
  return results;
}

// Idempotent: a second call returns the existing timer. pm2 cluster mode is
// covered by the lock file; module re-require returns the same instance.
let timer = null;
let started = false;

function start() {
  if (started) return timer;
  if (String(process.env.ZK_AUTO_SYNC_DISABLED || "").toLowerCase() === "true") {
    console.log("[zk-auto-sync] disabled by ZK_AUTO_SYNC_DISABLED");
    return null;
  }
  const intervalMs = Number(process.env.ZK_AUTO_SYNC_INTERVAL_MINUTES || 15) * 60 * 1000;
  started = true;
  // First run shortly after boot so punches from the last window are picked
  // up immediately; unref() keeps a running server from blocking on the timer.
  const kickoff = setTimeout(() => { runOnce().catch(() => {}); }, 30_000);
  kickoff.unref?.();
  timer = setInterval(() => {
    runOnce().catch(() => {});
  }, intervalMs);
  timer.unref?.();
  console.log(
    `[zk-auto-sync] started — every ${intervalMs / 60000} min, ` +
      `window ${Number(process.env.ZK_AUTO_SYNC_WINDOW_HOURS || 4)} h`
  );
  return timer;
}

module.exports = { start, runOnce };
