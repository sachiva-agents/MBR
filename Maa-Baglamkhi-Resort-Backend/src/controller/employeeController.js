const db = require("../config/db");
const bcrypt = require("bcryptjs");

const ROLE_NAME_TO_ID = {
  admin: 1,
  manager: 2,
  reception: 3,
  accounts: 4,
  housekeeping: 5,
  waiter: 6,
  kitchen: 7,
};

// `staff` is a generic label, not a real row in `roles`. Map it to the
// least-privileged real role so a mislabelled account cannot gain access.
const STAFF_ROLE_ID = 3;

const DEFAULT_PASSWORD = "password";

function normalizeRoleName(raw) {
  const base = String(raw == null ? "" : raw).trim().toLowerCase();
  if (base === "receptionist") return "reception";
  if (base === "accountant") return "accounts";
  if (base === "staff") return String(STAFF_ROLE_ID);
  return base;
}

function resolveRoleId(raw) {
  if (Number.isInteger(raw) && raw > 0) return raw;
  const base = String(raw == null ? "" : raw).trim().toLowerCase();
  if (base in ROLE_NAME_TO_ID) return ROLE_NAME_TO_ID[base];
  const asNumber = Number(base);
  if (Number.isInteger(asNumber) && asNumber > 0) return asNumber;
  return STAFF_ROLE_ID;
}

function resolveRoleName(roleId, name) {
  if (name) return name;
  if (String(roleId) === "1") return "admin";
  if (String(roleId) === "2") return "manager";
  if (String(roleId) === "3") return "reception";
  if (String(roleId) === "4") return "accounts";
  if (String(roleId) === "5") return "housekeeping";
  if (String(roleId) === "6") return "waiter";
  if (String(roleId) === "7") return "kitchen";
  return "staff";
}

const EMPLOYEE_COLUMNS = [
  "employee_code",
  "first_name",
  "last_name",
  "phone",
  "emergency_contact",
  "address",
  "aadhaar_no",
  "pan_no",
  "bank_account",
  "bank_ifsc",
  "base_salary",
];

const LIST_QUERY = `
SELECT e.id AS employee_id,
       e.employee_code,
       COALESCE(e.first_name, '') AS first_name,
       e.last_name,
       d.name AS designation,
       dep.name AS department,
       e.date_of_joining,
       e.date_of_leaving,
       e.phone AS employee_phone,
       e.address AS employee_address,
       e.aadhaar_no,
       e.pan_no,
       e.bank_account,
       e.bank_ifsc,
       e.base_salary,
       e.is_active,
       e.created_at AS employee_created_at,
       e.user_id,
       u.id,
       u.name AS username,
       u.email,
       u.phone,
       u.avatar_url,
       u.status AS user_status,
       u.last_login_at,
       u.created_at AS user_created_at,
       COALESCE(r.name, 'staff') AS role
  FROM employees e
  LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN designations d ON d.id = e.designation_id
  LEFT JOIN departments dep ON dep.id = e.department_id`;

async function nextEmployeeCode() {
  try {
    const [rows] = await db.query(
      "SELECT employee_code FROM employees WHERE employee_code IS NOT NULL ORDER BY id DESC LIMIT 1"
    );
    const last = rows && rows[0] && rows[0].employee_code;
    const match = last && String(last).match(/(\d+)$/);
    const next = match ? Number(match[1]) + 1 : 1;
    return `EMP-${String(next).padStart(4, "0")}`;
  } catch (err) {
    return `EMP-${Date.now()}`;
  }
}

async function nextEmployeeCodeOn(connection) {
  const [rows] = await connection.query(
    "SELECT employee_code FROM employees WHERE employee_code IS NOT NULL ORDER BY id DESC LIMIT 1"
  );
  const last = rows && rows[0] && rows[0].employee_code;
  const match = last && String(last).match(/(\d+)$/);
  const next = match ? Number(match[1]) + 1 : 1;
  return `EMP-${String(next).padStart(4, "0")}`;
}

// One users row plus one employees row, committed together. `user_id` is a
// UNIQUE index in employees, so the row has to carry a real user id: passing
// null is accepted by MySQL and silently produces an account the payroll and
// attendance modules can never find. On failure the users row is rolled back
// instead of being left half-created, and the raw error is reported so the
// duplicate and FK failures stay distinguishable.
async function createUserRecordTx(connection, { name, email, password, role, phone, department, designation, baseSalary }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const roleId = resolveRoleId(role);

  const [userHeader] = await connection.query(
    "INSERT INTO users (name, email, password_hash, role_id, phone, status) VALUES (?, ?, ?, ?, ?, 'active')",
    [name, email, hashedPassword, roleId, phone || null]
  );
  const userId = userHeader && userHeader.insertId;
  if (!userId) {
    const err = new Error("Could not create the user record");
    err.code = "ER_NO_USER_ROW";
    throw err;
  }

  const employeeCode = await nextEmployeeCodeOn(connection);
  const [employeeHeader] = await connection.query(
    `INSERT INTO employees (user_id, employee_code, first_name, last_name, department_id, designation_id,
                            phone, base_salary, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      userId,
      employeeCode,
      name.split(/\s+/)[0] || "Staff",
      null,
      department ? Number(department) : null,
      designation ? Number(designation) : null,
      phone || null,
      Number(baseSalary || 0),
    ]
  );
  if (!employeeHeader || !employeeHeader.insertId) {
    const err = new Error("Could not create the employee record");
    err.code = "ER_NO_EMPLOYEE_ROW";
    throw err;
  }

  return { userId };
}

// Self-heals a login account that has no employee row. Kept for the legacy
// users id address forms in PUT/DELETE, which resolve through user_id.
async function ensureEmployeeForUser(userId) {
  const [userRows] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [userId]);
  const user = userRows && userRows[0];
  if (!user) return null;

  const [empRows] = await db.query("SELECT id FROM employees WHERE user_id = ? LIMIT 1", [userId]);
  if (empRows && empRows[0]) return empRows[0].id;

  const parts = String(user.name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "Staff";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  const code = await nextEmployeeCode();

  try {
    await db.query(
      `INSERT INTO employees (user_id, employee_code, first_name, last_name, phone, base_salary, is_active)
       VALUES (?, ?, ?, ?, ?, 0.00, 1)`,
      [userId, code, firstName, lastName, user.phone || null]
    );
  } catch (err) {
    // user_id is UNIQUE, so a second account for this user is a no-op, not
    // a failure: the row already exists and the lookup below will find it.
    if (err && err.code !== "ER_DUP_ENTRY") throw err;
  }

  const [inserted] = await db.query("SELECT id FROM employees WHERE user_id = ? LIMIT 1", [userId]);
  return (inserted && inserted[0] && inserted[0].id) || null;
}

// CREATE /api/employees — admin only
exports.createEmployee = async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || body.fullName || body.first_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role ?? body.role_name;

  if (!name) {
    return res.status(400).json({ message: "Employee name is required" });
  }
  if (!role) {
    return res.status(400).json({ message: "Role is required" });
  }
  if (email) {
    const [existing] = await db.query("SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1", [email]);
    if (existing && existing[0]) {
      return res.status(400).json({ message: "A user with this email already exists" });
    }
  }

  const password = body.password || DEFAULT_PASSWORD;

  // The users row only means something together with its employees row, so
  // both run on one connection inside one transaction. Anything wrong with
  // either statement rolls both back; a 201 here always means both exist.
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { userId } = await createUserRecordTx(connection, {
      name,
      email,
      password,
      role,
      phone: body.phone,
      department: body.department_id ?? body.department,
      designation: body.designation_id ?? body.designation,
      baseSalary: body.base_salary ?? body.salary,
    });
    await connection.commit();

    const [rows] = await db.query(
      LIST_QUERY + " WHERE u.id = ? ORDER BY u.id LIMIT 1",
      [userId]
    );
    const employee = rows && rows[0];
    if (!employee) {
      const err = new Error(`read-back found no employee for user id ${userId}`);
      err.code = "ER_NO_EMPLOYEE_ROW";
      throw err;
    }
    return res.status(201).json({
      message: "Employee created successfully",
      defaultPassword: DEFAULT_PASSWORD,
      employee,
    });
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      console.error("createEmployee rollback failed:", rollbackErr.message || rollbackErr);
    }
    console.error("createEmployee error:", err.code || "", err.message || err);
    return res.status(500).json({
      message: "Failed to create employee",
      error: err.message,
      code: err.code || "ER_FAILED",
    });
  } finally {
    connection.release();
  }
};

// LIST /api/employees — admin only. Returns every employee, including
// accounts that have a users row but no employees row yet.
exports.listEmployees = async (req, res) => {
  try {
    const params = req.query ? req.query : {};
    const department = params.department;
    const search = String(params.q || params.search || "").trim();
    const activeOnly = String(params.active ?? "").toLowerCase();

    let sql = LIST_QUERY;
    const where = [];
    const values = [];

    if (department && department !== "all" && department !== "All Departments") {
      where.push("dep.name = ?");
      values.push(String(department));
    }
    if (activeOnly === "1" || activeOnly === "true") {
      where.push("e.is_active = 1");
    }
    if (search) {
      where.push("(e.first_name LIKE ? OR e.employee_code LIKE ? OR u.name LIKE ? OR u.email LIKE ?)");
      const like = `%${search}%`;
      values.push(like, like, like, like);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY e.first_name, e.last_name";

    const [rows] = await db.query(sql, values);
    return res.json(rows || []);
  } catch (err) {
    console.error("listEmployees error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch employees", error: err.message });
  }
};

exports.getEmployee = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Employee id required" });

  try {
    const [rows] = await db.query(
      LIST_QUERY + " WHERE e.id = ? OR u.id = ? ORDER BY e.id LIMIT 1",
      [id, id]
    );
    const employee = rows && rows[0];
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    return res.json(employee);
  } catch (err) {
    console.error("getEmployee error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch employee", error: err.message });
  }
};

// UPDATE /api/employees/:id — admin only. Handles both employees.id and
// users.id, because the salary and attendance modules address staff by user id.
exports.updateEmployee = async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  if (!id) return res.status(400).json({ message: "Employee id required" });

  try {
    let [empRows] = await db.query("SELECT id, user_id FROM employees WHERE id = ? LIMIT 1", [id]);
    if (!empRows || !empRows[0]) {
      const [userRows] = await db.query("SELECT id FROM users WHERE id = ? LIMIT 1", [id]);
      if (!userRows || !userRows[0]) {
        return res.status(404).json({ message: "Employee not found" });
      }
      empRows = await db.query("SELECT id, user_id FROM employees WHERE user_id = ? LIMIT 1", [id]);
    }
    const employee = empRows && empRows[0];
    if (!employee) {
      const ensured = await ensureEmployeeForUser(id);
      if (!ensured) return res.status(404).json({ message: "Employee not found" });
      empRows = await db.query("SELECT id, user_id FROM employees WHERE id = ? LIMIT 1", [ensured]);
      const retried = empRows && empRows[0];
      if (!retried) return res.status(404).json({ message: "Employee not found" });
    }
    const empId = employee.id;
    const userId = employee.user_id;

    const assignments = [];
    const values = [];
    for (const col of EMPLOYEE_COLUMNS) {
      if (body[col] !== undefined) {
        assignments.push(`${col} = ?`);
        values.push(col === "base_salary" ? Number(body[col] || 0) : body[col]);
      }
    }
    if (body.base_salary !== undefined && body.salary !== undefined) {
      // fall through: base_salary handled above
    } else if (body.salary !== undefined) {
      assignments.push("base_salary = ?");
      values.push(Number(body.salary || 0));
    }
    if (body.designation !== undefined && body.designation_id === undefined) {
      assignments.push("designation_id = ?");
      values.push(body.designation ? Number(body.designation) : null);
    }
    if (body.department !== undefined && body.department_id === undefined) {
      assignments.push("department_id = ?");
      values.push(body.department ? Number(body.department) : null);
    }
    if (body.employee_code !== undefined) {
      assignments.push("employee_code = ?");
      values.push(body.employee_code);
    }

    if (userId) {
      if (body.name !== undefined) {
        const [first, ...rest] = String(body.name).trim().split(/\s+/).filter(Boolean);
        assignments.push("first_name = ?");
        values.push(first || "Staff");
        assignments.push("last_name = ?");
        values.push(rest.join(" ") || null);
      }
    }

    if (assignments.length) {
      assignments.push("updated_at = NOW()");
      await db.query(
        `UPDATE employees SET ${assignments.join(", ")} WHERE id = ?`,
        [...values, empId]
      );
    } else {
      const [empRows2] = await db.query(
        "SELECT id, user_id FROM employees WHERE id = ? LIMIT 1",
        [empId]
      );
      employee.user_id = (empRows2 && empRows2[0] && empRows2[0].user_id) || userId;
    }

    const userAssignments = [];
    const userValues = [];
    if (userId) {
      if (body.name !== undefined) {
        userAssignments.push("name = ?");
        userValues.push(String(body.name).trim());
      }
      if (body.phone !== undefined) {
        userAssignments.push("phone = ?");
        userValues.push(body.phone);
      }
      if (body.email !== undefined && body.email) {
        const [dup] = await db.query(
          "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1",
          [body.email, userId]
        );
        if (dup && dup[0]) {
          return res.status(400).json({ message: "Another user already uses this email" });
        }
        userAssignments.push("email = ?");
        userValues.push(String(body.email).trim().toLowerCase());
      }
      if (body.role !== undefined) {
        userAssignments.push("role_id = ?");
        userValues.push(resolveRoleId(body.role));
      }
      if (body.status !== undefined) {
        userAssignments.push("status = ?");
        userValues.push(String(body.status).toLowerCase());
      }
      if (body.password) {
        userAssignments.push("password_hash = ?");
        userValues.push(await bcrypt.hash(String(body.password), 10));
      }
      if (userAssignments.length) {
        userAssignments.push("updated_at = NOW()");
        userValues.push(userId);
        await db.query(`UPDATE users SET ${userAssignments.join(", ")} WHERE id = ?`, userValues);
      }
    }

    const [rows] = await db.query(LIST_QUERY + " WHERE e.id = ? ORDER BY e.id LIMIT 1", [empId]);
    return res.json({ message: "Employee updated successfully", employee: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error("updateEmployee error:", err.message || err);
    return res.status(500).json({ message: "Failed to update employee", error: err.message });
  }
};

// DELETE /api/employees/:id — admin only. Deactivates instead of deleting:
// attendance_records and salary_payments reference employees.id, so removing
// the row would orphan payroll history.
exports.deactivateEmployee = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ message: "Employee id required" });

  try {
    let [empRows] = await db.query("SELECT id, user_id FROM employees WHERE id = ? LIMIT 1", [id]);
    if (!empRows || !empRows[0]) {
      const [userRows] = await db.query("SELECT id FROM users WHERE id = ? LIMIT 1", [id]);
      if (!userRows || !userRows[0]) return res.status(404).json({ message: "Employee not found" });
      empRows = await db.query("SELECT id, user_id FROM employees WHERE user_id = ? LIMIT 1", [id]);
    }
    const employee = empRows && empRows[0];
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    if (Number(req.user && req.user.id) === Number(employee.user_id)) {
      return res.status(400).json({ message: "You cannot deactivate your own account" });
    }

    await db.query("UPDATE employees SET is_active = 0, updated_at = NOW() WHERE id = ?", [employee.id]);
    if (employee.user_id) {
      await db.query("UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = ?", [
        employee.user_id,
      ]);
    }

    return res.json({ message: "Employee deactivated", employeeId: employee.id });
  } catch (err) {
    console.error("deactivateEmployee error:", err.message || err);
    return res.status(500).json({ message: "Failed to deactivate employee", error: err.message });
  }
};

// /api/employees/departments and /api/employees/designations — feed the
// filters and forms on the Attendance and Salary screens.
exports.listDepartments = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name FROM departments ORDER BY name");
    return res.json(rows || []);
  } catch (err) {
    console.error("listDepartments error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch departments" });
  }
};

exports.listDesignations = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT d.id, d.name, d.department_id, dep.name AS department_name FROM designations d LEFT JOIN departments dep ON dep.id = d.department_id ORDER BY d.name"
    );
    return res.json(rows || []);
  } catch (err) {
    console.error("listDesignations error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch designations" });
  }
};

// /api/employees/stats — counts for the attendance summary cards.
// Daily status tallies straight from attendance_records; "earned today" is
// computed from each employee's base salary and the per-status pay convention
// (attendance_records has no denormalised salary column — the old query read
// a non-existent ar.salary_amount and 500'd on every date).
exports.getEmployeeStats = async (req, res) => {
  const date = String(req.query && req.query.date || "").slice(0, 10);
  try {
    const [total] = await db.query("SELECT COUNT(*) AS total FROM employees WHERE is_active = 1");
    const tally = { present: 0, absent: 0, late: 0, on_leave: 0, half_day: 0, holiday: 0, week_off: 0 };
    let totalSalary = 0;

    if (date) {
      const [statusRows] = await db.query(
        "SELECT status, COUNT(*) AS c FROM attendance_records WHERE DATE(date) = ? GROUP BY status",
        [date]
      );
      for (const row of statusRows || []) {
        const key = String(row.status || "").toLowerCase();
        if (Object.prototype.hasOwnProperty.call(tally, key)) tally[key] = Number(row.c || 0);
      }

      const [payRows] = await db.query(
        `SELECT ar.status, COALESCE(SUM(e.base_salary), 0) AS base
           FROM attendance_records ar
           JOIN employees e ON e.id = ar.employee_id
          WHERE DATE(ar.date) = ?
          GROUP BY ar.status`,
        [date]
      );
      // Same pay convention as the salary engine: full for present / holiday /
      // week off, half for late and half day, zero for absent / on leave.
      for (const row of payRows || []) {
        const key = String(row.status || "").toLowerCase();
        const base = Number(row.base || 0);
        if (key === "present" || key === "holiday" || key === "week_off") totalSalary += base;
        else if (key === "late" || key === "half_day") totalSalary += base / 2;
      }
      totalSalary = Number(totalSalary.toFixed(2));
    }

    return res.json({
      total: Number((total && total[0] && total[0].total) || 0),
      date: date || null,
      ...tally,
      totalSalary,
    });
  } catch (err) {
    console.error("getEmployeeStats error:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch employee stats", error: err });
  }
};

exports.normalizeRoleName = normalizeRoleName;
exports.resolveRoleId = resolveRoleId;
exports.ensureEmployeeForUser = ensureEmployeeForUser;
