const db = require("../config/db");
const AttendanceRecordsModel = require("../models/AttendanceRecordsModel");

const DAY_STATUS_MULTIPLIER = {
  present: 1,
  absent: 0,
  late: 0.5,
  half_day: 0.5,
  on_leave: 0,
  holiday: 1,
  week_off: 1,
};

const calculateDaySalary = (monthlySalary, status, year, month) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const daily = Number(monthlySalary || 0) / daysInMonth;
  const key = String(status || "").toLowerCase();
  let multiplier = DAY_STATUS_MULTIPLIER[key];
  // An unrecognised status is paid at full rate and logged, never paid zero.
  // Returning 0 here was how a typo could wipe a whole month of pay.
  if (multiplier === undefined) {
    console.warn(`salary: unknown attendance status "${status}" — paid at full rate`);
    multiplier = 1;
  }
  return Number((daily * multiplier).toFixed(2));
};

// v4 schema: users has no salary/designation columns. Salary is
// employees.base_salary, designation is employees.designation_id ->
// designations.name, and attendance_records keys off employees.id.
const STAFF_QUERY = `
SELECT u.id, u.name AS full_name, u.email, u.phone, u.status AS user_status,
       COALESCE(r.name, 'staff') AS role,
       e.id AS employee_id, e.employee_code, e.base_salary, e.is_active,
       d.name AS designation, dep.name AS department
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN employees e ON e.user_id = u.id
  LEFT JOIN designations d ON d.id = e.designation_id
  LEFT JOIN departments dep ON dep.id = e.department_id`;

async function employeeForUser(userId) {
  const [rows] = await db.query(
    "SELECT id, base_salary, employee_code FROM employees WHERE user_id = ? ORDER BY id LIMIT 1",
    [userId]
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

// ADMIN: Set or update salary + designation for an employee.
// POST /api/salary/:userId — body: { salary, designation }
exports.setEmployeeSalary = async (req, res) => {
  const userId = req.params.userId;
  const { salary, designation } = req.body || {};

  if (!userId || salary === undefined || salary === null) {
    return res.status(400).json({ message: "userId and salary required" });
  }
  const salaryNum = Number(salary);
  if (!Number.isFinite(salaryNum) || salaryNum < 0) {
    return res.status(400).json({ message: "Salary must be a number >= 0" });
  }

  try {
    const employee = await employeeForUser(userId);
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    // `designation` arrives as a free-text NAME from the admin UI, but
    // employees.designation_id is a foreign key to designations.id. Bind a real
    // integer (or null) here — never the raw name. The old Number(name) path
    // produced NaN, which db.query inlined into the SQL and crashed with
    // "Unknown column 'NaN' in 'field list'".
    let designationId = null;
    const designationName = String(designation ?? "").trim();
    if (designationName) {
      const [existing] = await db.query(
        "SELECT id FROM designations WHERE name = ? ORDER BY id LIMIT 1",
        [designationName]
      );
      if (existing && existing[0]) {
        designationId = existing[0].id;
      } else {
        // Insert only the name column: some deployments' designations table
        // has no department_id column (first CREATE TABLE IF NOT EXISTS wins).
        const [header] = await db.execute(
          "INSERT INTO designations (name) VALUES (?)",
          [designationName]
        );
        designationId = header.insertId;
      }
    }

    await db.execute(
      "UPDATE employees SET base_salary = ?, designation_id = ?, updated_at = NOW() WHERE id = ?",
      [salaryNum, designationId, employee.id]
    );

    const [rows] = await db.query(`${STAFF_QUERY} WHERE u.id = ? LIMIT 1`, [userId]);
    return res.json({ message: "Salary saved", user: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error("setEmployeeSalary error:", err.message || err);
    return res.status(500).json({ message: "Failed to set salary", error: err.message });
  }
};

// Shape each raw STAFF_QUERY row for the frontend: it expects `name`
// (not `full_name`) and `salary` (not `base_salary`). Without this the
// Salary page rendered an empty name cell and every salary as 0.00.
const shapeStaffRow = (row) => ({ ...row, salary: row.base_salary, name: row.full_name });

// ADMIN: Get all employees with their salaries. GET /api/salary
exports.getAllEmployeesWithSalary = async (req, res) => {
  try {
    const [rows] = await db.query(`${STAFF_QUERY} ORDER BY u.name`);
    return res.json((rows || []).map(shapeStaffRow));
  } catch (err) {
    console.error("getAllEmployeesWithSalary error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch salaries", error: err.message });
  }
};

// ADMIN or SELF: Get salary of a user. GET /api/salary/:userId
exports.getEmployeeSalary = async (req, res) => {
  const userId = req.params.userId;
  const requester = req.user;

  if (!requester) return res.status(401).json({ message: "Authentication required" });
  if (requester.role !== "admin" && Number(requester.id) !== Number(userId)) {
    return res.status(403).json({ message: "Forbidden: can only view your own salary" });
  }

  try {
    const [rows] = await db.query(`${STAFF_QUERY} WHERE u.id = ? LIMIT 1`, [userId]);
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ message: "User not found" });
    return res.json({ ...row, salary: row.base_salary, name: row.full_name });
  } catch (err) {
    console.error("getEmployeeSalary error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch salary", error: err.message });
  }
};

// SELF: Get the currently logged-in user's salary + designation. GET /api/salary/me
exports.getMySalary = async (req, res) => {
  const id = req.user && req.user.id;
  if (!id) return res.status(401).json({ message: "Authentication required" });

  try {
    const [rows] = await db.query(`${STAFF_QUERY} WHERE u.id = ? LIMIT 1`, [id]);
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ message: "User not found" });
    return res.json({ ...row, salary: row.base_salary, name: row.full_name });
  } catch (err) {
    console.error("getMySalary error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch salary", error: err.message });
  }
};

// Get my attendance + calculated salary (logged-in user).
// GET /api/salary/me/attendance?month=YYYY-MM
exports.getMyAttendanceWithSalary = async (req, res) => {
  const id = req.user && req.user.id;
  if (!id) return res.status(401).json({ message: "Authentication required" });

  let year, month;
  if (req.query.month) {
    const parts = String(req.query.month).split("-").map(Number);
    year = parts[0];
    month = parts[1];
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  try {
    const employee = await employeeForUser(id);
    const monthlySalary = Number(employee && employee.base_salary || 0);

    let records = [];
    if (employee) {
      records = await AttendanceRecordsModel.findByEmployeeAndMonth(
        employee.id,
        month,
        year
      );
    }

    const attendanceRecords = records.map((r) => {
      const status = String(r.status || "").toLowerCase();
      return {
        id: r.id,
        date: r.date,
        status,
        checkIn: r.check_in,
        checkOut: r.check_out,
        daySalary: calculateDaySalary(monthlySalary, status, year, month),
        leaveType: r.leave_type,
        notes: r.notes,
      };
    });
    const totalPaid = attendanceRecords.reduce((sum, r) => sum + r.daySalary, 0);

    // No employee record or no attendance yet is a valid state: zeroed totals.
    return res.json({
      employee: {
        id,
        employeeId: employee && employee.id || null,
        employeeCode: employee && employee.employee_code || null,
        salary: monthlySalary,
        designation: null,
      },
      month: `${year}-${String(month).padStart(2, "0")}`,
      attendanceRecords,
      totalPaid: Number(totalPaid.toFixed(2)),
    });
  } catch (err) {
    console.error("getMyAttendanceWithSalary error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch attendance", error: err.message });
  }
};

// ADMIN: Recalculate the per-day amount for an employee's current month.
// POST /api/salary/:userId/recalculate
exports.recalculateAttendance = async (req, res) => {
  const userId = req.params.userId;

  try {
    const employee = await employeeForUser(userId);
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const now = new Date();
    const records = await AttendanceRecordsModel.findByEmployeeAndMonth(
      employee.id,
      now.getMonth() + 1,
      now.getFullYear()
    );

    const updates = records.map((r) => {
      const [y, m] = String(r.date || "").slice(0, 7).split("-").map(Number);
      return { id: r.id, date: r.date, status: r.status, amount: calculateDaySalary(employee.base_salary, r.status, y, m) };
    });

    return res.json({
      message: "Attendance recalculated",
      updates,
      total: Number(updates.reduce((sum, r) => sum + r.amount, 0).toFixed(2)),
    });
  } catch (err) {
    console.error("recalculateAttendance error:", err.message || err);
    return res.status(500).json({ message: "Failed to recalculate", error: err.message });
  }
};
