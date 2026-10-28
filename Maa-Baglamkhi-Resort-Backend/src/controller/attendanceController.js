const db = require("../config/db");
const AttendanceRecordsModel = require("../models/AttendanceRecordsModel");
const { getPayPercentages } = require("./settingsController");

const STATUSES = ["present", "absent", "late", "half_day", "on_leave", "holiday", "week_off"];

const STATUS_LABEL = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half Day",
  on_leave: "On Leave",
  holiday: "Holiday",
  week_off: "Week Off",
};

const LEAVE_TYPES = ["casual", "sick", "earned", "maternity", "paternity", "unpaid", "other"];

const SALARY_STATUS_MULTIPLIER = {
  present: 1,
  absent: 0,
  late: 0.5,
  half_day: 0.5,
  on_leave: 0,
  holiday: 1,
  week_off: 1,
};

// Multipliers come from app_settings (admin-editable on the Salary page) via
// getPayPercentages(); the built-in table below is only the unreachable-DB
// fallback. Unknown statuses pay full (never zero, to protect pay).
const calculateDaySalary = (monthlySalary, status, year, month, multipliers = SALARY_STATUS_MULTIPLIER) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const daily = Number(monthlySalary || 0) / daysInMonth;
  const key = String(status || "").toLowerCase();
  let multiplier = multipliers[key];
  if (multiplier === undefined) {
    console.warn(`attendance: unknown status "${status}" — paid at full rate`);
    multiplier = 1;
  }
  return Number((daily * multiplier).toFixed(2));
};

const normalizeStatus = (status) => String(status || "").toLowerCase().trim();

const isDateStr = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const isMonthStr = (value) => typeof value === "string" && /^\d{4}-\d{2}$/.test(value.trim());

const isTimeStr = (value) => typeof value === "string" && /^\d{1,2}:\d{2}/.test(value.trim());

const todayStr = () => new Date().toISOString().slice(0, 10);

const currentMonthParts = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};

const pad2 = (value) => String(value).padStart(2, "0");

// mysql2 returns DATE columns as JS Date objects, which String() renders as
// "Fri Oct 16", so the pieces must be pulled out of the object itself.
const toISODate = (value) => {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? text.trim() : null;
};

const toTime = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  if (/^\d{1,2}:\d{2}/.test(text)) return text.slice(0, 5);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }
  return text.slice(0, 5);
};

const withAttendanceSchema = async (res, task) => {
  try {
    await AttendanceRecordsModel.ensureSchema();
    await task();
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to prepare attendance schema.",
      error,
    });
  }
};

/**
 * Attendance is keyed by `attendance_records.employee_id` -> `employees.id`,
 * while requests carry a user id (`req.user.id`). Returns the linked employee
 * id, or null when the user has no employee row (a valid state, not an error).
 */
const resolveEmployeeId = async (userId) => {
  const [rows] = await db.query("SELECT id FROM employees WHERE user_id = ? LIMIT 1", [userId]);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? row.id : null;
};

// ZK sync appends a marker like "ZK <machine> device <id> (<shift> shift)" to
// the row's notes (and writes the method column only when it exists). With no
// method column on the live schema the notes marker is the only signal that a
// row came from a biometric device, not a manual entry.
const deriveMethod = (row) => {
  const stored = String(row.method || "").trim();
  if (stored && stored.toLowerCase() !== "manual") return stored;
  const notes = String(row.notes || "");
  if (/ZK\s+.*device.*\(\w+\s+shift\)/i.test(notes)) return "ZK fingerprint";
  return "Manual";
};

/**
 * Wire shape for one attendance record.
 *
 * The legacy schema stored denormalised text columns (employee_name, role,
 * method, salary_amount). The current schema does not, so those fields are
 * derived here to keep older frontends readable.
 */
const shapeRecord = (row, enrich = {}, multipliers = SALARY_STATUS_MULTIPLIER) => {
  const status = normalizeStatus(row.status);
  const date = toISODate(row.date);
  const d = new Date(`${date || "1970-01-01"}T00:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const monthlySalary = Number(enrich.monthlySalary || enrich.monthly_salary || 0);

  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeUserId: enrich.employeeUserId ?? enrich.employee_user_id ?? null,
    name: enrich.name || enrich.employee_name || "Unassigned",
    userName: enrich.name || enrich.employee_name || null,
    email: enrich.email || enrich.employee_email || null,
    user_salary: monthlySalary,
    salary_amount: calculateDaySalary(monthlySalary, status, year, month, multipliers),
    department: enrich.department || enrich.department_name || null,
    departmentName: enrich.department || enrich.department_name || null,
    designation: enrich.designation || null,
    role: enrich.designation || enrich.role || null,
    role_name: enrich.designation || enrich.role || null,
    date,
    status,
    statusLabel: STATUS_LABEL[status] || status,
    check_in: row.check_in || null,
    check_in_time: row.check_in || null,
    checkIn: toTime(row.check_in),
    in_time: toTime(row.check_in),
    check_out: row.check_out || null,
    check_out_time: row.check_out || null,
    checkOut: toTime(row.check_out),
    out_time: toTime(row.check_out),
    leave_type: row.leave_type || null,
    notes: row.notes || null,
    method: deriveMethod(row),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

// Every attendance row joined to its employee, user, department, designation.
const ENRICH_SELECT = `
  SELECT ar.*,
         e.user_id AS employee_user_id,
         CONCAT(e.first_name, ' ', IFNULL(e.last_name, '')) AS name,
         u.email,
         d.name AS department,
         g.name AS designation,
         e.base_salary AS monthly_salary
  FROM attendance_records ar
  LEFT JOIN employees e ON e.id = ar.employee_id
  LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN designations g ON g.id = e.designation_id`;

/** Explicit employeeId wins, then a user id, then a name match, then self. */
const resolveTargetEmployee = async ({ employeeId, actAsUserId, actingUserId, name }) => {
  if (employeeId) {
    const [rows] = await db.query("SELECT id FROM employees WHERE id = ? LIMIT 1", [employeeId]);
    const r = Array.isArray(rows) ? rows[0] : null;
    return r ? r.id : null;
  }
  if (actAsUserId) {
    return resolveEmployeeId(actAsUserId);
  }
  if (name) {
    const like = `%${String(name).trim().toLowerCase()}%`;
    const [byName] = await db.query(
      `SELECT e.id
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE LOWER(CONCAT(IFNULL(e.first_name,''), ' ', IFNULL(e.last_name,''))) LIKE ?
           OR LOWER(IFNULL(u.name,'')) LIKE ?
        ORDER BY e.id LIMIT 1`,
      [like, like]
    );
    if (Array.isArray(byName) && byName[0]) return byName[0].id;
  }
  return resolveEmployeeId(actingUserId);
};

/** Last day of a YYYY-MM month. */
const monthEnd = (monthStr) => {
  const y = Number(monthStr.slice(0, 4));
  const m = Number(monthStr.slice(5, 7));
  const days = new Date(y, m, 0).getDate();
  return `${monthStr}-${String(days).padStart(2, "0")}`;
};

const buildRangeWhere = (where, params, { date, month, from, to, employeeId }) => {
  let w = where;
  if (employeeId) {
    w += " AND ar.employee_id = ?";
    params.push(employeeId);
  }
  if (isDateStr(date)) {
    w += " AND DATE(ar.date) = ?";
    params.push(date.trim());
  }
  if (isMonthStr(month)) {
    w += " AND DATE_FORMAT(ar.date, '%Y-%m') = ?";
    params.push(month);
  }
  if (isDateStr(from)) {
    w += " AND DATE(ar.date) >= ?";
    params.push(from.trim());
  }
  if (isDateStr(to)) {
    w += " AND DATE(ar.date) <= ?";
    params.push(to.trim());
  }
  return w;
};

/**
 * GET /api/attendance
 * ?date=YYYY-MM-DD      one day
 * ?month=YYYY-MM        one calendar month
 * ?from&to=YYYY-MM-DD   arbitrary range
 * ?employeeId=1         scope to one employee
 * ?userId=2             scope to that user's employee row
 * Read-only for any authed user; marking is admin-only.
 */
exports.getAllAttendance = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const { date, month, from, to, employeeId, employee_id, userId } = req.query || {};

    let scopeEmployeeId = employeeId || employee_id || null;
    if (!scopeEmployeeId && userId) {
      scopeEmployeeId = await resolveEmployeeId(userId);
    }

    const params = [];
    const where = buildRangeWhere("WHERE 1=1", params, { date, month, from, to, employeeId: scopeEmployeeId });

    const [records] = await db.query(
      `${ENRICH_SELECT} ${where} ORDER BY DATE(ar.date) DESC, ar.id DESC`,
      params
    );
    const multipliers = await getPayPercentages();

    res.json((Array.isArray(records) ? records : []).map((r) => shapeRecord(r, r, multipliers)));
  });
};

/**
 * GET /api/attendance/me
 * The acting user's own records. ?date / ?month / ?from / ?to filter.
 */
exports.getMyAttendance = async (req, res) => {
  const id = req.user?.id;
  if (!id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const { date, month, from, to } = req.query || {};
  return withAttendanceSchema(res, async () => {
    const employeeId = await resolveEmployeeId(id);
    if (!employeeId) {
      return res.json([]);
    }

    const params = [employeeId];
    const where = buildRangeWhere("WHERE ar.employee_id = ?", params, { date, month, from, to });

    const [records] = await db.query(
      `${ENRICH_SELECT} ${where} ORDER BY DATE(ar.date) DESC, ar.id DESC`,
      params
    );
    const multipliers = await getPayPercentages();
    res.json((Array.isArray(records) ? records : []).map((r) => shapeRecord(r, r, multipliers)));
  });
};

/**
 * POST /api/attendance  (admin only)
 *
 * Marks attendance for the acting user, or for anyone else when the body
 * carries `employeeId` / `userId` / `actAsUserId`. Re-marking the same
 * employee + date updates the existing row instead of failing, so the UI's
 * Save / Resave flow always lands.
 */
exports.markAttendance = async (req, res) => {
  const id = req.user?.id;
  if (!id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const body = req.body || {};
  const normalized = normalizeStatus(body.status);

  if (!STATUSES.includes(normalized)) {
    return res.status(400).json({ message: "Invalid attendance status" });
  }

  const dateStr = isDateStr(body.date) ? body.date.trim() : todayStr();
  const nowTime = new Date().toISOString().slice(11, 16);
  const checkInVal = isTimeStr(body.checkIn)
    ? body.checkIn.trim()
    : isTimeStr(body.check_in)
      ? body.check_in.trim()
      : dateStr === todayStr()
        ? nowTime
        : null;
  const checkOutVal = isTimeStr(body.checkOut)
    ? body.checkOut.trim()
    : isTimeStr(body.check_out)
      ? body.check_out.trim()
      : null;
  const rawLeave = String(body.leaveType || body.leave_type || "").toLowerCase();
  const leaveTypeVal = LEAVE_TYPES.includes(rawLeave) ? rawLeave : null;
  const notesVal = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  return withAttendanceSchema(res, async () => {
    const employeeId = await resolveTargetEmployee({
      employeeId: body.employeeId ?? body.employee_id,
      actAsUserId: body.actAsUserId ?? body.userId ?? body.user_id,
      actingUserId: id,
      name: body.employeeName ?? body.name ?? body.employee,
    });

    if (!employeeId) {
      return res.status(400).json({
        message: "No employee record is linked to this user; cannot mark attendance.",
      });
    }

    const [existingRows] = await db.query(
      "SELECT id FROM attendance_records WHERE employee_id = ? AND DATE(date) = ? LIMIT 1",
      [employeeId, dateStr]
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;

    if (existing) {
      const [result] = await db.query(
        `UPDATE attendance_records
         SET status = ?, check_in = ?, check_out = ?, leave_type = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [normalized, checkInVal, checkOutVal, leaveTypeVal, notesVal, existing.id]
      );
      return res.json({
        message: "Attendance updated",
        id: existing.id,
        employeeId,
        date: dateStr,
        status: normalized,
        statusLabel: STATUS_LABEL[normalized],
        checkIn: checkInVal,
        checkOut: checkOutVal,
        updated: true,
        affectedRows: result?.affectedRows || 0,
      });
    }

    const [result] = await db.query(
      `INSERT INTO attendance_records (employee_id, date, status, check_in, check_out, leave_type, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [employeeId, dateStr, normalized, checkInVal, checkOutVal, leaveTypeVal, notesVal]
    );

    return res.json({
      message: "Attendance marked successfully",
      id: result.insertId,
      employeeId,
      date: dateStr,
      status: normalized,
      statusLabel: STATUS_LABEL[normalized],
      checkIn: checkInVal,
      checkOut: checkOutVal,
      method: body.method || "Manual",
      inserted: true,
    });
  });
};

// Self-service mark: any authenticated owner saves their own check-in/out.
// Ignores all impersonation fields (employeeId / actAsUserId / userId / name)
// so a user can only ever write their own row.
exports.markMyAttendance = async (req, res) => {
  const id = req.user?.id;
  if (!id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const body = req.body || {};
  const normalized = normalizeStatus(body.status);
  if (!STATUSES.includes(normalized)) {
    return res.status(400).json({ message: "Invalid attendance status" });
  }

  const dateStr = isDateStr(body.date) ? body.date.trim() : todayStr();
  const nowTime = new Date().toISOString().slice(11, 16);
  const checkInVal = isTimeStr(body.checkIn)
    ? body.checkIn.trim()
    : isTimeStr(body.check_in)
      ? body.check_in.trim()
      : dateStr === todayStr()
        ? nowTime
        : null;
  const checkOutVal = isTimeStr(body.checkOut)
    ? body.checkOut.trim()
    : isTimeStr(body.check_out)
      ? body.check_out.trim()
      : null;
  const rawLeave = String(body.leaveType || body.leave_type || "").toLowerCase();
  const leaveTypeVal = LEAVE_TYPES.includes(rawLeave) ? rawLeave : null;
  const notesVal = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  return withAttendanceSchema(res, async () => {
    const employeeId = await resolveEmployeeId(id);
    if (!employeeId) {
      return res.status(400).json({
        message: "No employee record is linked to this user; cannot mark attendance.",
      });
    }

    const [existingRows] = await db.query(
      "SELECT id FROM attendance_records WHERE employee_id = ? AND DATE(date) = ? LIMIT 1",
      [employeeId, dateStr]
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;

    if (existing) {
      const [result] = await db.query(
        `UPDATE attendance_records
         SET status = ?, check_in = ?, check_out = ?, leave_type = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [normalized, checkInVal, checkOutVal, leaveTypeVal, notesVal, existing.id]
      );
      return res.json({
        message: "Attendance updated",
        id: existing.id,
        employeeId,
        date: dateStr,
        status: normalized,
        statusLabel: STATUS_LABEL[normalized],
        checkIn: checkInVal,
        checkOut: checkOutVal,
        updated: true,
        affectedRows: result?.affectedRows || 0,
      });
    }

    const [result] = await db.query(
      `INSERT INTO attendance_records (employee_id, date, status, check_in, check_out, leave_type, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [employeeId, dateStr, normalized, checkInVal, checkOutVal, leaveTypeVal, notesVal]
    );

    return res.json({
      message: "Attendance marked successfully",
      id: result.insertId,
      employeeId,
      date: dateStr,
      status: normalized,
      statusLabel: STATUS_LABEL[normalized],
      checkIn: checkInVal,
      checkOut: checkOutVal,
      method: "Manual",
      inserted: true,
    });
  });
};

/**
 * PUT|PATCH /api/attendance/:id
 * Edit one record: status, check_in, check_out, leave_type, notes.
 */
exports.updateAttendanceRecord = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const body = req.body || {};
    const recordId = req.params.id;

    if (!recordId) {
      return res.status(400).json({ message: "Attendance record id required" });
    }

    const updates = [];
    const params = [];

    if (body.status) {
      const normalized = normalizeStatus(body.status);
      if (!STATUSES.includes(normalized)) {
        return res.status(400).json({ message: "Invalid attendance status" });
      }
      updates.push("status = ?");
      params.push(normalized);
    }
    if (isTimeStr(body.checkIn)) {
      updates.push("check_in = ?");
      params.push(body.checkIn.trim());
    } else if (isTimeStr(body.check_in)) {
      updates.push("check_in = ?");
      params.push(body.check_in.trim());
    }
    if (isTimeStr(body.checkOut)) {
      updates.push("check_out = ?");
      params.push(body.checkOut.trim());
    } else if (isTimeStr(body.check_out)) {
      updates.push("check_out = ?");
      params.push(body.check_out.trim());
    }
    if (body.leaveType !== undefined || body.leave_type !== undefined) {
      updates.push("leave_type = ?");
      const raw = String(body.leaveType || body.leave_type || "").toLowerCase();
      params.push(LEAVE_TYPES.includes(raw) ? raw : null);
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      params.push(typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null);
    }

    if (!updates.length) {
      return res.status(400).json({ message: "No updatable fields provided" });
    }

    params.push(recordId);
    const [result] = await db.query(
      `UPDATE attendance_records SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
      params
    );

    if (!result?.affectedRows) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const [rows] = await db.query(`${ENRICH_SELECT} WHERE ar.id = ?`, [recordId]);
    const row = Array.isArray(rows) ? rows[0] : null;
    const multipliers = await getPayPercentages();

    res.json({ message: "Attendance record updated", ...shapeRecord(row, row, multipliers) });
  });
};

/** DELETE /api/attendance/:id */
exports.deleteAttendanceRecord = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const recordId = req.params.id;
    if (!recordId) {
      return res.status(400).json({ message: "Attendance record id required" });
    }
    const [result] = await db.query("DELETE FROM attendance_records WHERE id = ?", [recordId]);
    if (!result?.affectedRows) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    res.json({ message: "Attendance record deleted", id: Number(recordId) });
  });
};

/**
 * POST /api/attendance/mark-holiday (admin only)
 * Body: { date: "YYYY-MM-DD", name?: "Diwali", force?: true }
 *
 * Marks EVERY active employee as `holiday` for the date so the payroll
 * engine pays it in full (holiday multiplier = 1.0, same as a present day)
 * and attendance reports count it under Holiday. Existing rows are
 * re-marked only when force=true; by default a row already carrying a real
 * status (present/late/half_day...) is left alone — a staff member who
 * actually worked on a festival day keeps that status.
 */
exports.markHolidayForAll = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const body = req.body || {};
    const dateStr = isDateStr(body.date) ? body.date.trim() : todayStr();
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    const force = body.force === true;
    const notes = name ? `Holiday: ${name}` : "Holiday";

    const [employees] = await db.query("SELECT id FROM employees WHERE is_active = 1");
    const activeEmployees = Array.isArray(employees) ? employees : [];

    let created = 0;
    let reMarked = 0;
    let kept = 0;

    for (const emp of activeEmployees) {
      const [existing] = await db.query(
        "SELECT id, status FROM attendance_records WHERE employee_id = ? AND DATE(date) = ? LIMIT 1",
        [emp.id, dateStr]
      );
      const row = Array.isArray(existing) ? existing[0] : null;

      if (row && !force && String(row.status || "").toLowerCase() !== "holiday") {
        kept += 1;
        continue;
      }
      if (row) {
        await db.query(
          `UPDATE attendance_records
             SET status = 'holiday', leave_type = NULL, notes = ?, updated_at = NOW()
           WHERE id = ?`,
          [notes, row.id]
        );
        reMarked += 1;
      } else {
        await db.query(
          `INSERT INTO attendance_records (employee_id, date, status, notes, created_at, updated_at)
           VALUES (?, ?, 'holiday', ?, NOW(), NOW())`,
          [emp.id, dateStr, notes]
        );
        created += 1;
      }
    }

    // Keep the festival in the calendar so future month reports can count it
    // even for days not yet marked.
    if (name) {
      try {
        const HolidayCalendarModel = require("../models/HolidayCalendarModel");
        await HolidayCalendarModel.ensureSchema();
        await HolidayCalendarModel.add({ date: dateStr, name, fullPay: true });
      } catch (calErr) {
        console.error("mark-holiday: calendar upsert failed:", calErr.message);
      }
    }

    res.json({
      message: `Holiday marked for ${dateStr}${name ? ` (${name})` : ""}`,
      date: dateStr,
      activeEmployees: activeEmployees.length,
      created,
      reMarked,
      kept,
      keptNote: kept
        ? `${kept} record(s) kept their existing status (worked on the holiday); use force=true to override.`
        : null,
    });
  });
};

/**
 * GET /api/attendance/holidays?from&to — festival calendar for the report UI.
 */
exports.getHolidayCalendar = async (req, res) => {
  const from = isDateStr(req.query?.from) ? req.query.from.trim() : null;
  const to = isDateStr(req.query?.to) ? req.query.to.trim() : null;
  try {
    const HolidayCalendarModel = require("../models/HolidayCalendarModel");
    await HolidayCalendarModel.ensureSchema();
    const rows = await HolidayCalendarModel.list(from, to);
    res.json((Array.isArray(rows) ? rows : []).map((r) => ({
      date: toISODate(r.holiday_date),
      name: r.name,
      fullPay: Boolean(r.full_pay),
      notes: r.notes || null,
    })));
  } catch (err) {
    res.status(500).json({ message: "Failed to load holiday calendar", error: err.message });
  }
};

/**
 * DELETE /api/attendance/holidays/:date — remove a festival day from the
 * calendar. Existing attendance rows are untouched; only the calendar entry
 * is dropped.
 */
exports.deleteHolidayCalendarEntry = async (req, res) => {
  const d = String(req.params?.date || "").trim();
  if (!isDateStr(d)) {
    return res.status(400).json({ message: "Valid date (YYYY-MM-DD) required" });
  }
  try {
    const HolidayCalendarModel = require("../models/HolidayCalendarModel");
    await HolidayCalendarModel.ensureSchema();
    const removed = await HolidayCalendarModel.remove(d.trim());
    res.json({ message: removed ? "Holiday removed from calendar" : "Holiday not in calendar", date: d.trim(), removed });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove holiday", error: err.message });
  }
};

/**
 * GET /api/attendance/employees
 * Who can be marked. ?date adds each employee's status for that day;
 * ?month adds month totals. Feeds the admin manual-entry flow.
 */
exports.getEmployees = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const { date, month } = req.query || {};

    const [employees] = await db.query(
      `SELECT e.id AS employeeId, e.user_id AS userId, e.employee_code AS employeeCode,
              CONCAT(e.first_name, ' ', IFNULL(e.last_name, '')) AS name,
              u.email, u.status AS userStatus, u.role_id AS roleId,
              d.name AS department, g.name AS designation,
              e.base_salary AS monthlySalary, e.is_active AS isActive
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations g ON g.id = e.designation_id
       ORDER BY e.id`
    );

    const base = employees.map((e) => ({
      ...e,
      name: (e.name || "").trim() || null,
      monthlySalary: Number(e.monthlySalary || 0),
    }));

    if (isDateStr(date)) {
      const [rows] = await db.query(
        "SELECT employee_id AS employeeId, status FROM attendance_records WHERE DATE(date) = ?",
        [date.trim()]
      );
      const byEmp = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.employeeId, r.status]));
      return res.json(
        base.map((e) => ({
          ...e,
          date: date.trim(),
          marked: byEmp.has(e.employeeId),
          status: byEmp.get(e.employeeId) || null,
        }))
      );
    }

    if (isMonthStr(month)) {
      const [rows] = await db.query(
        "SELECT employee_id AS employeeId, COUNT(*) AS days, SUM(status = 'present') AS presentDays FROM attendance_records WHERE DATE_FORMAT(date, '%Y-%m') = ? GROUP BY employee_id",
        [month]
      );
      const byEmp = new Map(
        (Array.isArray(rows) ? rows : []).map((r) => [
          r.employeeId,
          { days: Number(r.days || 0), presentDays: Number(r.presentDays || 0) },
        ])
      );
      return res.json(
        base.map((e) => ({
          ...e,
          month,
          monthlySummary: byEmp.get(e.employeeId) || { days: 0, presentDays: 0 },
        }))
      );
    }

    res.json(base.map((e) => ({ ...e, date: todayStr(), marked: false, status: null })));
  });
};

/**
 * GET /api/attendance/report?month=YYYY-MM|from&to&employeeId
 * Per-employee day counts, status totals and attendance-derived earned pay.
 */
exports.getAttendanceReport = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const { month, from, to, employeeId, employee_id } = req.query || {};
    const now = currentMonthParts();
    const rangeMonth = isMonthStr(month) ? month : `${now.year}-${String(now.month).padStart(2, "0")}`;

    const start = isDateStr(from) ? from.trim() : `${rangeMonth}-01`;
    const end = isDateStr(to) ? to.trim() : monthEnd(rangeMonth);

    const params = [start, end];
    let where = "WHERE DATE(ar.date) >= ? AND DATE(ar.date) <= ?";
    if (employeeId || employee_id) {
      where += " AND ar.employee_id = ?";
      params.push(employeeId || employee_id);
    }

    const [records] = await db.query(
      `${ENRICH_SELECT} ${where} ORDER BY ar.employee_id, DATE(ar.date)`,
      params
    );
    const multipliers = await getPayPercentages();

    const byEmployee = new Map();
    for (const r of Array.isArray(records) ? records : []) {
      const key = r.employee_id;
      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          employeeId: r.employee_id,
          employeeUserId: r.employee_user_id ?? null,
          name: r.name,
          email: r.email || null,
          department: r.department || null,
          departmentName: r.department || null,
          designation: r.designation || null,
          monthlySalary: Number(r.monthly_salary || 0),
          employee: {
            employeeId: r.employee_id,
            employeeUserId: r.employee_user_id ?? null,
            name: r.name,
            email: r.email || null,
            department: r.department || null,
            designation: r.designation || null,
            monthlySalary: Number(r.monthly_salary || 0),
          },
          days: [],
          totals: { present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0, holiday: 0, week_off: 0, earned: 0 },
        });
      }
      const group = byEmployee.get(key);
      const shaped = shapeRecord(r, r, multipliers);
      group.days.push(shaped);
      const status = normalizeStatus(r.status);
      group.totals[status] = (group.totals[status] || 0) + 1;
      group.totals.earned = Number((group.totals.earned + shaped.salary_amount).toFixed(2));
    }

    const employees = Array.from(byEmployee.values());
    const summary = employees.reduce(
      (acc, r) => {
        acc.employees += 1;
        acc.days += r.days.length;
        acc.present += r.totals.present;
        acc.absent += r.totals.absent;
        acc.late += r.totals.late;
        acc.half_day += r.totals.half_day;
        acc.on_leave += r.totals.on_leave;
        acc.holiday += r.totals.holiday;
        acc.week_off += r.totals.week_off;
        acc.earned += r.totals.earned;
        return acc;
      },
      { employees: 0, days: 0, present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0, holiday: 0, week_off: 0, earned: 0 }
    );

    res.json({
      period: { from: start, to: end, month: rangeMonth },
      summary: { ...summary, earned: Number(summary.earned.toFixed(2)) },
      employees,
      rows: records.map((r) => shapeRecord(r, r, multipliers)),
    });
  });
};

/**
 * GET /api/attendance/payroll?month=YYYY-MM
 *
 * Attendance -> payroll handoff. Every active employee gets their month's
 * status counts, the salary on file, and the attendance-derived earned amount.
 * HAG-8 (payroll) is the intended consumer.
 */
exports.getPayrollAttendance = async (req, res) => {
  return withAttendanceSchema(res, async () => {
    const now = currentMonthParts();
    const parsed = isMonthStr(req.query.month) ? req.query.month.split("-").map(Number) : [now.year, now.month];
    const year = parsed[0];
    const month = parsed[1];

    const [employees] = await db.query(
      `SELECT e.id AS employeeId, e.user_id AS userId, e.employee_code AS employeeCode,
              CONCAT(e.first_name, ' ', IFNULL(e.last_name, '')) AS name,
              u.email, u.status AS userStatus, u.role_id AS roleId,
              d.name AS department, g.name AS designation,
              e.base_salary AS monthlySalary
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations g ON g.id = e.designation_id
       WHERE e.is_active = 1
       ORDER BY e.id`
    );

    // Range predicate so idx_date is usable — YEAR()/MONTH() wrappers would scan the table.
    const pad = (n) => String(n).padStart(2, "0");
    const monthFrom = `${year}-${pad(month)}-01`;
    const monthTo = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    const [records] = await db.query(
      "SELECT * FROM attendance_records WHERE date >= ? AND date < ?",
      [monthFrom, monthTo]
    );
    const multipliers = await getPayPercentages();
    const byEmployee = new Map();
    for (const r of Array.isArray(records) ? records : []) {
      if (!byEmployee.has(r.employee_id)) byEmployee.set(r.employee_id, []);
      byEmployee.get(r.employee_id).push(r);
    }

    const daysInMonth = new Date(year, month, 0).getDate();

    const rows = employees.map((e) => {
      const empId = e.employeeId;
      const monthlySalary = Number(e.monthlySalary || 0);
      const monthRecords = byEmployee.get(empId) || [];
      const totals = { present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0, holiday: 0, week_off: 0 };
      for (const r of monthRecords) {
        const s = normalizeStatus(r.status);
        totals[s] = (totals[s] || 0) + 1;
      }
      const earned = monthRecords.reduce(
        (sum, r) => sum + calculateDaySalary(monthlySalary, normalizeStatus(r.status), year, month, multipliers),
        0
      );

      // Paid days = each status's day-count weighted by its pay multiplier,
      // so admin changes to the pay rules apply here too.
      const paidDays = Object.keys(totals).reduce(
        (acc, s) => acc + (totals[s] || 0) * (multipliers[s] ?? 0),
        0
      );

      return {
        employeeId: empId,
        userId: e.user_id || null,
        employeeCode: e.employeeCode || null,
        name: (e.name || "").trim() || null,
        email: e.email || null,
        department: e.department || null,
        designation: e.designation || null,
        monthlySalary,
        daysInMonth,
        daysRecorded: monthRecords.length,
        paidDays: Number(paidDays.toFixed(2)),
        totals,
        earned: Number(earned.toFixed(2)),
        payoutPercent: monthlySalary > 0 ? Math.round((earned / monthlySalary) * 100) : 0,
        attendanceRecords: monthRecords.map((r) => shapeRecord(r, { monthlySalary }, multipliers)),
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.employees += 1;
        acc.monthlySalary += r.monthlySalary;
        acc.earned += r.earned;
        acc.presentDays += r.totals.present;
        acc.absentDays += r.totals.absent;
        acc.lateDays += r.totals.late;
        acc.halfDayDays += r.totals.half_day;
        acc.onLeaveDays += r.totals.on_leave;
        acc.holidayDays += r.totals.holiday;
        acc.weekOffDays += r.totals.week_off;
        return acc;
      },
      {
        employees: 0, monthlySalary: 0, earned: 0,
        presentDays: 0, absentDays: 0, lateDays: 0,
        halfDayDays: 0, onLeaveDays: 0, holidayDays: 0, weekOffDays: 0,
      }
    );

    res.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      year,
      monthNum: month,
      daysInMonth,
      summary: {
        employees: totals.employees,
        grossMonthlySalary: Number(totals.monthlySalary.toFixed(2)),
        totalEarned: Number(totals.earned.toFixed(2)),
        totalPresentDays: totals.presentDays,
        totalAbsentDays: totals.absentDays,
        totalLateDays: totals.lateDays,
        totalHalfDayDays: totals.halfDayDays,
        totalOnLeaveDays: totals.onLeaveDays,
        totalHolidayDays: totals.holidayDays,
        totalWeekOffDays: totals.weekOffDays,
      },
      employees: rows,
    });
  });
};

/**
 * GET /api/attendance/me/salary?month=YYYY-MM
 * The acting user's own month: day-by-day pay plus totals.
 */
exports.calculateMySalary = async (req, res) => {
  const id = req.user?.id;
  if (!id) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const now = currentMonthParts();
  const targetMonth = Number(req.query.month?.split("-")[1] || now.month);
  const targetYear = Number(req.query.month?.split("-")[0] || now.year);

  return withAttendanceSchema(res, async () => {
    const employeeId = await resolveEmployeeId(id);

    let monthlySalary = 0;
    let designation = null;
    let employeeCode = null;
    if (employeeId) {
      const [empRows] = await db.query(
        `SELECT e.base_salary, e.employee_code, d.name AS designation
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         WHERE e.id = ? LIMIT 1`,
        [employeeId]
      );
      const emp = Array.isArray(empRows) ? empRows[0] : null;
      monthlySalary = Number(emp?.base_salary || 0);
      designation = emp?.designation || null;
      employeeCode = emp?.employee_code || null;
    }

    const records = employeeId
      ? await AttendanceRecordsModel.findByEmployeeAndMonth(employeeId, targetMonth, targetYear)
      : [];
    const multipliers = await getPayPercentages();

    const totals = { present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0, holiday: 0, week_off: 0 };
    for (const r of records) {
      const s = normalizeStatus(r.status);
      totals[s] = (totals[s] || 0) + 1;
    }

    const attendanceRecords = records.map((r) => {
      const status = normalizeStatus(r.status);
      return {
        id: r.id,
        date: toISODate(r.date),
        status,
        statusLabel: STATUS_LABEL[status] || status,
        checkIn: toTime(r.check_in),
        checkOut: toTime(r.check_out),
        leaveType: r.leave_type || null,
        daySalary: calculateDaySalary(monthlySalary, status, targetYear, targetMonth, multipliers),
      };
    });

    const totalPaid = attendanceRecords.reduce((sum, r) => sum + r.daySalary, 0);
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const monthLabel = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

    // Paid days honour the admin-configured pay multipliers.
    const paidDays = Object.keys(totals).reduce(
      (acc, s) => acc + (totals[s] || 0) * (multipliers[s] ?? 0),
      0
    );

    res.json({
      employee: {
        id,
        employeeId: employeeId || null,
        employeeCode,
        salary: monthlySalary,
        monthlySalary,
        designation,
      },
      month: monthLabel,
      year: targetYear,
      monthNum: targetMonth,
      daysInMonth,
      daysRecorded: attendanceRecords.length,
      summary: {
        month: monthLabel,
        monthlySalary,
        totalAmountEarned: Number(totalPaid.toFixed(2)),
        totalEarned: Number(totalPaid.toFixed(2)),
        totalWorkingDays: daysInMonth,
        paidDays: Number(paidDays.toFixed(2)),
        statusTotals: totals,
      },
      records: attendanceRecords,
      attendanceRecords,
      totalPaid: Number(totalPaid.toFixed(2)),
    });
  });
};
