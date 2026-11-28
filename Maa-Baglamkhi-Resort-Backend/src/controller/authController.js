const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const UsersModel = require("../models/UsersModel");
const { getJwtSecret } = require("../config/security");
const ALLOW_REGISTER = String(process.env.ALLOW_REGISTER || "").toLowerCase() === "true";

const LOGIN_EMAIL_ALIASES = {
  "admin@resort.com": "admin@test.com",
  "manager@resort.com": "manager@test.com",
  "reception@resort.com": "reception@test.com",
  "accounts@resort.com": "accounts@test.com",
  "tarun@resort.com": "hk@test.com",
  "waiter@resort.com": "waiter@test.com",
  "waiter@test.com": "waiter@resort.com",
  "kitchen@resort.com": "kitchen@test.com",
  "kitchen@test.com": "kitchen@resort.com",
  "chef@resort.com": "kitchen@test.com",
};

const buildCandidateEmails = (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const aliasEmail = LOGIN_EMAIL_ALIASES[normalizedEmail];

  return [aliasEmail, normalizedEmail].filter((value, index, values) => {
    return value && values.indexOf(value) === index;
  });
};

exports.login = async (req, res) => {
  // req.body can be an empty object (non-JSON body) or undefined if a proxy
  // cleared it; destructuring either crashes the request with a 500.
  const body = req.body || {};
  const { email, password } = body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const candidateEmails = buildCandidateEmails(normalizedEmail);

  req.setAuditContext?.({
    action: "login",
    newValue: normalizedEmail ? { email: normalizedEmail } : null,
  });

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const tryLookup = async (index) => {
    if (index >= candidateEmails.length) {
      return res.status(400).json({ message: "Invalid Email" });
    }

    const [userRows] = await db.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role_id,
              COALESCE(r.name, 'reception') AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = LOWER(?) AND u.status = 'active'
       LIMIT 1`,
      [candidateEmails[index]],
    );
    const user = userRows[0] || null;
    if (!user) {
      return tryLookup(index + 1);
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      req.setAuditContext?.({
        action: "login_failed",
        userId: user.id,
      });
      return res.status(400).json({ message: "Invalid Password" });
    }

    req.setAuditContext?.({
      userId: user.id,
      action: "login",
      newValue: {
        id: user.id,
        email: user.email,
        role: user.role_name,
      },
    });

    // Lazy: read at sign time, not module load, so requiring this module
    // before dotenv/.env is loaded does not crash app.js (HAG-56).
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role_name,
      },
      getJwtSecret(),
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    const cookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
    // Legacy cookie kept for old clients only. The frontend reads the Bearer
    // header returned below, which works on every origin; a cookie set
    // secure + sameSite=none cannot be sent over plain localhost, and that is
    // what made every cross-origin call fail.
    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: cookieMaxAgeMs,
      path: "/",
    });

    return res.json({
      token,
      id: user.id,
      name: user.name,
      role: user.role_name,
      email: user.email,
    });
  };

  return tryLookup(0);
};

/**
 * Register endpoint (for initial setup).
 * - Allowed if ALLOW_REGISTER=true OR there are no users in DB yet.
 * - Creates user in `register` with hashed password.
 */
/**
 * Resolve a role from either an id (role_id) or a name (role).
 * The frontend sends a role *name* (e.g. "reception"), so a bare Number() cast
 * would produce NaN and break the INSERT with "Unknown column 'NaN'".
 */
const resolveRoleId = async (roleIdInput, roleNameInput) => {
  const numericId = Number(roleIdInput);
  if (Number.isInteger(numericId) && numericId > 0) {
    const [rows] = await db.query("SELECT id FROM roles WHERE id = ? LIMIT 1", [numericId]);
    if (rows.length) return rows[0].id;
  }

  const roleName = String(roleNameInput || "").trim().toLowerCase();
  if (roleName) {
    const [byName] = await db.query("SELECT id FROM roles WHERE LOWER(name) = ? LIMIT 1", [roleName]);
    if (byName.length) return byName[0].id;
  }

  return 1; // default role
};

exports.register = async (req, res) => {
  const { name, email, password, role_id, role } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email, password required" });
  }

  try {
    const existing = await UsersModel.findByEmail(email).then(rows => rows[0] || null);
    if (existing) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const roleId = await resolveRoleId(role_id, role);
    const [result] = await db.query(
      "INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, 'active')",
      [name, email, hashedPassword, roleId]
    );

    return res.status(201).json({
      message: "Registered successfully",
      id: result.insertId,
      user: { id: result.insertId, name, email },
    });
  } catch (hashErr) {
    console.error("Register error:", hashErr);
    return res.status(500).json({ message: "Internal server error" });
  }
};
