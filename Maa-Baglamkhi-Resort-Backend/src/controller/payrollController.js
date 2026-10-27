const db = require("../config/db");
const SalaryPaymentsModel = require("../models/SalaryPaymentsModel");
const { getPayPercentages } = require("./settingsController");

const PAYMENT_STATUSES = ["draft", "approved", "paid", "cancelled"];

const PAYMENTS_LIST_QUERY = `
SELECT sp.id,
       sp.employee_id,
       sp.month,
       sp.basic_salary,
       sp.allowances,
       sp.deductions,
       sp.net_salary,
       sp.paid_amount,
       sp.payment_date,
       sp.payment_method,
       sp.status,
       sp.approved_by,
       sp.paid_by,
       sp.created_at,
       sp.updated_at,
       e.employee_code,
       e.user_id,
       COALESCE(e.first_name, u.name) AS name,
       u.email,
       COALESCE(r.name, 'staff') AS role,
       d.name AS designation,
       dep.name AS department
  FROM salary_payments sp
  LEFT JOIN employees e ON e.id = sp.employee_id
  LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN designations d ON d.id = e.designation_id
  LEFT JOIN departments dep ON dep.id = e.department_id`;

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Money must not vanish for an unrecognised status. An unknown value is paid at
// full rate and logged, so a new status or a typo surfaces in the backend log
// instead of silently earning the person zero.
//
// Percentages come from the settings-driven getPayPercentages() (the same source
// the salary/attendance pages read), so a status pays identically everywhere;
// the hardcoded per-status table would drift from what an operator configured.
function statusMultiplier(status, payPct) {
  const key = String(status || "").toLowerCase();
  const multiplier = payPct && payPct[key];
  if (multiplier === undefined) {
    console.warn(`payroll: unknown attendance status "${status}" — paid at full rate`);
    return 1;
  }
  return multiplier;
}

// Accepts employees.id OR users.id. A bare `id` match alone is ambiguous —
// employee ids and user ids are separate sequences, so an unknown users.id can
// collide with a real employees.id and pay the wrong person. Prefer the explicit
// employees row when both exist, then fall back to the user link.
async function resolveEmployee(userIdOrEmployeeId) {
  const [rows] = await db.query("SELECT id, user_id FROM employees WHERE id = ? LIMIT 1", [
    userIdOrEmployeeId,
  ]);
  const byId = rows && rows[0];
  if (byId && byId.user_id !== null && byId.user_id !== undefined) {
    return byId.id;
  }
  const [byUser] = await db.query("SELECT id FROM employees WHERE user_id = ? LIMIT 1", [
    userIdOrEmployeeId,
  ]);
  if (byUser && byUser[0]) {
    return byUser[0].id;
  }
  if (byId) {
    return byId.id;
  }
  return null;
}

// Payroll amounts must attach to a real employees row: employee_id is a
// UNIQUE composite key with month, and writing a bare users.id creates a
// payment for someone who is not in the roster.
async function requireEmployeeRow(userIdOrEmployeeId) {
  const [rows] = await db.query("SELECT id, user_id FROM employees WHERE id = ? LIMIT 1", [
    userIdOrEmployeeId,
  ]);
  const byId = rows && rows[0];
  if (byId) return byId.id;
  const [byUser] = await db.query("SELECT id FROM employees WHERE user_id = ? LIMIT 1", [
    userIdOrEmployeeId,
  ]);
  return byUser && byUser[0] ? byUser[0].id : null;
}

// GET /api/payroll/payments — admin only.
exports.listPayments = async (req, res) => {
  try {
    const params = req.query || {};
    const status = String(params.status || "").toLowerCase();
    const month = String(params.month || "").slice(0, 7);
    const employeeId = params.employee_id;

    let sql = PAYMENTS_LIST_QUERY;
    const where = [];
    const values = [];
    if (status && PAYMENT_STATUSES.includes(status)) {
      where.push("sp.status = ?");
      values.push(status);
    }
    if (month) {
      where.push("sp.month = ?");
      values.push(`${month}-01`);
    }
    if (employeeId) {
      where.push("sp.employee_id = ?");
      values.push(employeeId);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY sp.created_at DESC";

    const [rows] = await db.query(sql, values);
    return res.json(rows || []);
  } catch (err) {
    console.error("listPayments error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch salary payments" });
  }
};

// POST /api/payroll/payments — admin only.
// { employee_id|user_id, month: 'YYYY-MM', basic_salary, allowances, deductions, payment_method }
exports.createPayment = async (req, res) => {
  const body = req.body || {};
  const month = String(body.month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ message: "month (YYYY-MM) is required" });
  }

  let employeeId = body.employee_id ? Number(body.employee_id) : body.user_id ? Number(body.user_id) : null;
  if (!employeeId) {
    return res.status(400).json({ message: "employee_id is required" });
  }

  try {
    employeeId = await requireEmployeeRow(employeeId);
    if (!employeeId) {
      return res.status(404).json({
        message: "Employee not found — pass an existing employee id, or create the employee first",
      });
    }

    if (body.basic_salary === undefined) {
      const [empRows] = await db.query(
        "SELECT base_salary FROM employees WHERE id = ? LIMIT 1",
        [employeeId]
      );
      const emp = empRows && empRows[0];
      if (!emp) return res.status(404).json({ message: "Employee not found" });
      if (body.salary === undefined) body.basic_salary = emp.base_salary;
    }

    const basic = Number(body.basic_salary || 0);
    const allowances = Number(body.allowances || 0);
    const deductions = Number(body.deductions || 0);
    if (basic < 0 || allowances < 0 || deductions < 0) {
      return res.status(400).json({ message: "Salary amounts must be >= 0" });
    }
    const net = Number((basic + allowances - deductions).toFixed(2));
    const status = String(body.status || "draft").toLowerCase();

    if (!PAYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${PAYMENT_STATUSES.join(", ")}` });
    }

    const monthDate = `${month}-01`;
    const [existing] = await db.query(
      "SELECT id FROM salary_payments WHERE employee_id = ? AND month = ? LIMIT 1",
      [employeeId, monthDate]
    );
    if (existing && existing[0]) {
      return res.status(409).json({
        message: "A salary payment already exists for this employee and month",
        id: existing[0].id,
      });
    }

    const paidNow = status === "paid";
    const paidAmount = paidNow ? net : 0;

    await SalaryPaymentsModel.ensureSchema();
    await db.query(
      `INSERT INTO salary_payments (employee_id, month, basic_salary, allowances, deductions,
                                    net_salary, paid_amount, payment_date, payment_method,
                                    status, approved_by, paid_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        monthDate,
        basic,
        allowances,
        deductions,
        net,
        paidAmount,
        paidNow ? new Date().toISOString().slice(0, 10) : null,
        body.payment_method || null,
        status,
        status === "approved" || paidNow ? req.user && req.user.id : null,
        paidNow ? req.user && req.user.id : null,
      ]
    );

    const [created] = await db.query(
      PAYMENTS_LIST_QUERY + " ORDER BY sp.id DESC LIMIT 1"
    );
    return res.status(201).json({
      message: paidNow ? "Salary paid" : "Salary payment created",
      payment: created && created[0] ? created[0] : null,
    });
  } catch (err) {
    console.error("createPayment error:", err.message || err);
    return res.status(500).json({ message: "Failed to create salary payment", error: err.message });
  }
};

// PATCH /api/payroll/payments/:id — admin only. Move through draft -> approved -> paid.
exports.updatePayment = async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  if (!id) return res.status(400).json({ message: "Payment id required" });

  try {
    const [rows] = await db.query("SELECT * FROM salary_payments WHERE id = ? LIMIT 1", [id]);
    const payment = rows && rows[0];
    if (!payment) return res.status(404).json({ message: "Salary payment not found" });

    if (!Object.keys(body).length) {
      const [rows] = await db.query(PAYMENTS_LIST_QUERY + " WHERE sp.id = ? LIMIT 1", [id]);
      return res.json({ message: "Salary payment unchanged", payment: rows && rows[0] ? rows[0] : null });
    }

    const assignments = ["updated_at = NOW()"];
    const values = [];

    for (const col of ["basic_salary", "allowances", "deductions"]) {
      if (body[col] !== undefined) {
        assignments.push(`${col} = ?`);
        values.push(Number(body[col] || 0));
      }
    }
    if (body.status !== undefined) {
      const status = String(body.status).toLowerCase();
      if (!PAYMENT_STATUSES.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${PAYMENT_STATUSES.join(", ")}` });
      }
      assignments.push("status = ?");
      values.push(status);
      if (status === "approved" || status === "paid") {
        assignments.push("approved_by = ?");
        values.push(req.user && req.user.id);
      }
      if (status === "paid") {
        assignments.push("paid_by = ?");
        values.push(req.user && req.user.id);
        assignments.push("paid_amount = COALESCE(?, net_salary)");
        values.push(body.paid_amount !== undefined ? Number(body.paid_amount || 0) : null);
        assignments.push("payment_date = ?");
        values.push(body.payment_date || new Date().toISOString().slice(0, 10));
      }
    }
    if (body.payment_method !== undefined) {
      assignments.push("payment_method = ?");
      values.push(body.payment_method);
    }

    await db.query(
      `UPDATE salary_payments SET ${assignments.join(", ")} WHERE id = ?`,
      [...values, id]
    );

    const [updated] = await db.query(PAYMENTS_LIST_QUERY + " WHERE sp.id = ? LIMIT 1", [id]);
    return res.json({ message: "Salary payment updated", payment: updated && updated[0] ? updated[0] : null });
  } catch (err) {
    console.error("updatePayment error:", err.message || err);
    return res.status(500).json({ message: "Failed to update salary payment", error: err.message });
  }
};

// GET /api/payroll/payments/:id — admin only.
exports.getPayment = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Payment id required" });

  try {
    const [rows] = await db.query(PAYMENTS_LIST_QUERY + " WHERE sp.id = ? LIMIT 1", [id]);
    const payment = rows && rows[0];
    if (!payment) return res.status(404).json({ message: "Salary payment not found" });
    return res.json(payment);
  } catch (err) {
    console.error("getPayment error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch salary payment" });
  }
};

// POST /api/payroll/payments/:id/mark-paid — admin only. Marks an existing
// payment as paid. Convenience wrapper so the frontend needs one obvious action.
exports.markPaid = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Payment id required" });

  try {
    const [rows] = await db.query("SELECT * FROM salary_payments WHERE id = ? LIMIT 1", [id]);
    const payment = rows && rows[0];
    if (!payment) return res.status(404).json({ message: "Salary payment not found" });
    if (payment.status === "cancelled") {
      return res.status(400).json({ message: "A cancelled payment cannot be marked paid" });
    }

    const actorId = req.user && req.user.id;
    await db.query(
      `UPDATE salary_payments SET status = 'paid',
                                  paid_amount = ?,
                                  payment_date = ?,
                                  payment_method = COALESCE(?, payment_method),
                                  approved_by = COALESCE(approved_by, ?),
                                  paid_by = ?,
                                  updated_at = NOW()
       WHERE id = ?`,
      [
        Number(payment.paid_amount) > 0 ? payment.paid_amount : payment.net_salary,
        new Date().toISOString().slice(0, 10),
        (req.body && req.body.payment_method) || null,
        actorId,
        actorId,
        id,
      ]
    );

    const [updated] = await db.query(PAYMENTS_LIST_QUERY + " WHERE sp.id = ? LIMIT 1", [id]);
    return res.json({ message: "Salary marked as paid", payment: updated && updated[0] ? updated[0] : null });
  } catch (err) {
    console.error("markPaid error:", err.message || err);
    return res.status(500).json({ message: "Failed to mark salary as paid", error: err.message });
  }
};

// GET /api/payroll/estimate/:employeeId?month=YYYY-MM — admin only.
// Salary earned from that employee's attendance for the month.
exports.estimateSalary = async (req, res) => {
  const rawId = req.params.employeeId;
  if (!rawId || !Number.isFinite(Number(rawId))) {
    return res.status(400).json({ message: "Employee id required" });
  }

  const now = new Date();
  let year = Number(String(req.query && req.query.year || "").slice(0, 4)) || now.getFullYear();
  let month = Number(String(req.query && req.query.month || "").slice(0, 7).split("-")[1]) || now.getMonth() + 1;
  if (req.query && req.query.month && !req.query.year) {
    const [y, m] = String(req.query.month).split("-").map(Number);
    year = y;
    month = m;
  }

  try {
    const payPct = await getPayPercentages();
    const employeeId = (await resolveEmployee(Number(rawId))) || Number(rawId);

    const [empRows] = await db.query(
      `SELECT e.id, e.employee_code, e.base_salary, u.id AS user_id, u.name AS username, u.email,
              COALESCE(r.name, 'staff') AS role, d.name AS designation
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN designations d ON d.id = e.designation_id
       WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    const employee = empRows && empRows[0];
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const baseSalary = Number(employee.base_salary || 0);
    const totalDays = daysInMonth(year, month);
    const dailyRate = totalDays > 0 ? Number((baseSalary / totalDays).toFixed(2)) : 0;

    // Range predicate so idx_date is usable — MONTH()/YEAR() wrappers would scan the table.
    const pad = (n) => String(n).padStart(2, "0");
    const monthFrom = `${year}-${pad(month)}-01`;
    const monthTo = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    const [records] = await db.query(
      "SELECT * FROM attendance_records WHERE employee_id = ? AND date >= ? AND date < ? ORDER BY date",
      [employeeId, monthFrom, monthTo]
    );

    const attendanceRecords = (records || []).map((record) => {
      const daySalary = Number((dailyRate * statusMultiplier(record.status, payPct)).toFixed(2));
      return {
        id: record.id,
        date: record.date,
        status: record.status,
        check_in: record.check_in,
        check_out: record.check_out,
        daySalary,
        leave_type: record.leave_type,
        notes: record.notes,
      };
    });

    const totalEarned = Number(
      attendanceRecords.reduce((sum, record) => sum + record.daySalary, 0).toFixed(2)
    );
    const allowedAmount = Math.min(totalEarned, baseSalary);

    return res.json({
      employee: {
        id: employee.id,
        employeeCode: employee.employee_code,
        name: employee.username,
        email: employee.email,
        role: employee.role,
        designation: employee.designation,
      },
      month: `${year}-${String(month).padStart(2, "0")}`,
      baseSalary,
      totalDays,
      daysPresent: attendanceRecords.length,
      dailyRate,
      totalEarned,
      netPayable: allowedAmount,
      attendanceRecords,
    });
  } catch (err) {
    console.error("estimateSalary error:", err.message || err);
    return res.status(500).json({ message: "Failed to estimate salary", error: err.message });
  }
};

exports.resolveEmployee = resolveEmployee;
exports.requireEmployeeRow = requireEmployeeRow;
