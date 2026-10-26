const machinesModel = require("../models/AttendanceMachinesModel");
const { syncMachine } = require("../services/zkSyncService");
const zk = require("../services/zkProtocol");

const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const toTimeHms = (value, fallback) => {
  const text = String(value ?? "").trim();
  return TIME_RE.test(text) ? (text.length >= 8 ? text : `${text}:00`) : fallback;
};

const pad2 = (value) => String(value).padStart(2, "0");

// Default pull window: the last 24 hours of device time.
const defaultWindow = () => {
  const now = new Date();
  const end = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const startMs = now.getTime() - 24 * 60 * 60 * 1000;
  const start = new Date(startMs);
  const startText = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())} ${pad2(start.getHours())}:${pad2(start.getMinutes())}:${pad2(start.getSeconds())}`;
  return { from: startText, to: end };
};

/**
 * Machine rows are stored in UTC, but the shift split is set against the
 * device clock, which usually runs local time. Apply the server offset so the
 * admin UI edits the same instants the punches are measured against.
 */
const shiftTimesForUi = (machine) => {
  const offsetMinutes = new Date().getTimezoneOffset();
  const shift = (text, fallback) => {
    const hms = toTimeHms(text, fallback);
    const [h, m] = hms.split(":").map(Number);
    const shifted = ((h * 60 + m + offsetMinutes) % 1440 + 1440) % 1440;
    return `${pad2(Math.floor(shifted / 60))}:${pad2(shifted % 60)}:00`;
  };
  return {
    dayShiftStart: shift(machine.day_shift_start, "09:00:00"),
    dayShiftEnd: shift(machine.day_shift_end, "18:00:00"),
    nightShiftStart: shift(machine.night_shift_start, "18:00:00"),
    nightShiftEnd: shift(machine.night_shift_end, "09:00:00"),
  };
};

const parseWindow = (body) => {
  if (!body || body.from === undefined || body.to === undefined) return defaultWindow();
  if (!WINDOW_RE.test(String(body.from)) || !WINDOW_RE.test(String(body.to))) {
    const error = new Error("from/to must be 'YYYY-MM-DD HH:mm:ss'");
    error.statusCode = 400;
    throw error;
  }
  return { from: String(body.from), to: String(body.to) };
};

const validateMachineBody = (body) => {
  const host = String(body.ip ?? body.host ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host !== "localhost" && !/^\[?[0-9a-fA-F:]+\]?$/.test(host)) {
    const error = new Error("ip must be an IPv4 address");
    error.statusCode = 400;
    throw error;
  }
  const name = String(body.name ?? "").trim();
  if (name === "") {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const port = Number(body.port ?? 4380);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error("port must be 1-65535");
    error.statusCode = 400;
    throw error;
  }
  const machineIp = String(body.machineIp ?? body.machine_ip ?? host).trim();
  const machinePort = Number(body.machinePort ?? body.machine_port ?? port);
  const password = String(body.machinePassword ?? body.machine_password ?? "00000000");
  return {
    name,
    ip: host,
    port,
    machineIp,
    machinePort,
    machinePassword: password.length > 0 ? password : "00000000",
    status: body.status === "inactive" ? "inactive" : "active",
    dayShiftStart: toTimeHms(body.dayShiftStart ?? body.day_shift_start, "09:00:00"),
    dayShiftEnd: toTimeHms(body.dayShiftEnd ?? body.day_shift_end, "18:00:00"),
    nightShiftStart: toTimeHms(body.nightShiftStart ?? body.night_shift_start, "18:00:00"),
    nightShiftEnd: toTimeHms(body.nightShiftEnd ?? body.night_shift_end, "09:00:00"),
  };
};

const publicMachine = (row, lastPull) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    port: row.port,
    machineIp: row.machine_ip,
    machinePort: row.machine_port,
    status: row.status,
    dayShiftStart: row.day_shift_start,
    dayShiftEnd: row.day_shift_end,
    nightShiftStart: row.night_shift_start,
    nightShiftEnd: row.night_shift_end,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastPull,
  };
};

// POST /api/zk/machines
async function createMachine(req, res) {
  try {
    await machinesModel.ensureSchema();
    const machine = await machinesModel.createMachine(validateMachineBody(req.body));
    res.status(201).json({ message: "Machine registered", machine: publicMachine(machine) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message, error });
  }
}

// GET /api/zk/machines
async function listMachines(req, res) {
  try {
    await machinesModel.ensureSchema();
    const machines = await machinesModel.listMachines();
    const withPulls = await Promise.all(
      machines.map(async (m) => ({ row: m, lastPull: await machinesModel.lastPull(m.id) }))
    );
    res.json({ machines: withPulls.map(({ row, lastPull }) => publicMachine(row, lastPull)) });
  } catch (error) {
    res.status(500).json({ message: error.message, error });
  }
}

// PUT /api/zk/machines/:id
async function updateMachine(req, res) {
  try {
    await machinesModel.ensureSchema();
    const id = Number(req.params.id);
    const machine = await machinesModel.updateMachine(id, req.body || {});
    if (!machine) return res.status(404).json({ message: "Machine not found" });
    res.json({ message: "Machine updated", machine: publicMachine(machine) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message, error });
  }
}

// DELETE /api/zk/machines/:id
async function deleteMachine(req, res) {
  try {
    await machinesModel.ensureSchema();
    const id = Number(req.params.id);
    const deleted = await machinesModel.deleteMachine(id);
    if (!deleted) return res.status(404).json({ message: "Machine not found" });
    res.json({ message: "Machine removed", id });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message, error });
  }
}

// POST /api/zk/machines/:id/verify-time
async function verifyTime(req, res) {
  try {
    await machinesModel.ensureSchema();
    const machine = await machinesModel.getMachine(Number(req.params.id));
    if (!machine) return res.status(404).json({ message: "Machine not found" });
    const result = await zk.verifyTime(machine);
    res.json({ machine: machine.name, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message, error });
  }
}

// POST /api/zk/machines/:id/test-connection
async function testConnection(req, res) {
  try {
    await machinesModel.ensureSchema();
    const machine = await machinesModel.getMachine(Number(req.params.id));
    if (!machine) return res.status(404).json({ message: "Machine not found" });
    const result = await zk.testConnection(machine);
    res.json({ machine: machine.name, ...result });
  } catch (error) {
    res.status(error.statusCode || 502).json({ message: error.message, error });
  }
}

// POST /api/zk/machines/:id/sync
async function sync(req, res) {
  try {
    await machinesModel.ensureSchema();
    const machine = await machinesModel.getMachine(Number(req.params.id));
    if (!machine) return res.status(404).json({ message: "Machine not found" });

    const body = req.body || {};
    const window = parseWindow(body);
    const deleteAfter = body.deleteAfter === true;
    const summary = await syncMachine(machine, {
      from: window.from,
      to: window.to,
      deleteAfter,
      actor: req.user ? req.user.email || req.user.username || req.user.id : null,
    });
    res.json({ message: "ZK sync complete", ...summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message, error });
  }
}

// GET /api/zk/machines/:id/pulls
async function pulls(req, res) {
  try {
    await machinesModel.ensureSchema();
    const machine = await machinesModel.getMachine(Number(req.params.id));
    if (!machine) return res.status(404).json({ message: "Machine not found" });
    const rows = await machinesModel.pullsForMachine(machine.id, Number(req.query.limit) || 20);
    res.json({ pulls: rows });
  } catch (error) {
    res.status(500).json({ message: error.message, error });
  }
}

module.exports = {
  createMachine,
  listMachines,
  updateMachine,
  deleteMachine,
  verifyTime,
  sync,
  pulls,
};
