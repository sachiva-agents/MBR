const db = require("../config/db");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const UsersModel = require("../models/UsersModel");


function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role_id || user.role,
    avatar_url: user.avatar_url || null,
  };
}

// ================= UPLOAD SETUP =================

const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext)
      ? ext
      : ".jpg";

    const userPart = req.user?.id ? `u${req.user.id}` : "user";
    cb(null, `avatar_${userPart}_${Date.now()}${safeExt}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ok = ["image/jpeg", "image/png", "image/webp"].includes(
    file.mimetype
  );
  cb(ok ? null : new Error("Only JPG/PNG/WEBP images allowed"), ok);
};

exports.avatarUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ================= CREATE USER =================

// Roles live in the `roles` table; this map is only a fallback for when that
// lookup fails. It must stay in sync with the table (verified by the tests).
//
// The keys include the display names the frontend sends (CreateUser.jsx offers
// Admin / Manager / Staff / Receptionist / Housekeeping / Accountant / Waiter /
// Kitchen) as well as the raw table names. Missing one here used to silently
// fall back to `accounts`, which gave receptionists accountant permissions.
const ROLE_NAME_TO_ID = {
  admin: 1,
  administrator: 1,
  manager: 2,
  management: 2,
  reception: 3,
  receptionist: 3,
  frontdesk: 3,
  accounts: 4,
  accountant: 4,
  accounting: 4,
  housekeeping: 5,
  housekeeper: 5,
  waiter: 6,
  server: 6,
  kitchen: 7,
  chef: 7,
};

// `staff` is a generic label, not a role in the `roles` table. Treat it as the
// least-privileged real role so a mislabelled account cannot gain access.
const STAFF_ROLE_ID = 3; // reception

const DEFAULT_ROLE_ID = 4; // accounts

// Resolve a role name (or id) to a role_id. An unknown name must never reach
// the query as NaN: `Number("staff")` is NaN, and `NaN ?? default` keeps NaN
// because ?? only catches null/undefined — which is how this used to fail.
const resolveRoleId = (raw) => {
  if (Number.isInteger(raw)) return raw;

  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized in ROLE_NAME_TO_ID) return ROLE_NAME_TO_ID[normalized];
  if (normalized === "staff") return STAFF_ROLE_ID;

  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber > 0) return asNumber;

  return DEFAULT_ROLE_ID;
};

exports.createUser = async (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "name, email, password and role required" });
  }

  try {
    const existing = await UsersModel.findByEmail(email);
    const first = Array.isArray(existing) ? existing[0] : null;
    if (first) {
      return res.status(400).json({
        message: "Email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const roleId = resolveRoleId(role);

    const [userHeader] = await db.query(
      "INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, 'active')",
      [name, email, hashedPassword, roleId]
    );

    // v4 schema: salary, designation and attendance all key off
    // employees.user_id, so every user gets an employee row from birth.
    // Best-effort: the user is already created, a failure here must not
    // turn the request into a 500.
    let employeeId = null;
    try {
      const parts = String(name).trim().split(/\s+/);
      const [empHeader] = await db.execute(
        "INSERT INTO employees (user_id, first_name, last_name, base_salary) VALUES (?, ?, ?, 0)",
        [userHeader.insertId, parts[0] || name, parts.slice(1).join(" ") || null]
      );
      employeeId = empHeader.insertId;
    } catch (empErr) {
      console.error(`Could not create employee row for user ${userHeader.insertId}:`, empErr.message);
    }

    return res.json({
      message: "User created successfully",
      user: {
        id: userHeader.insertId,
        employeeId,
        name,
        email,
        role: String(roleId),
      },
    });
  } catch (hashErr) {
    console.error("Create error:", hashErr);
    return res.status(500).json({
      message: "User creation failed",
    });
  }
};

// ================= GET USERS =================

exports.getUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.avatar_url, u.status, u.last_login_at, u.created_at, u.updated_at,
              COALESCE(r.name, 'staff') AS role
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "Error fetching users" });
  }
};

exports.getUserById = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "User id required" });
  }

  try {
    const rows = await UsersModel.findById(id);
    const user = rows[0] || null;
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(sanitizeUser(user));
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ message: "Error fetching user" });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "User id required" });
  }

  try {
    const rows = await UsersModel.findById(id);
    const existingUser = rows[0] || null;
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    req.setAuditContext?.({
      action: "delete_user",
      oldValue: sanitizeUser(existingUser),
      newValue: null,
      userId: req.user?.id || existingUser.id,
    });

    await db.query("DELETE FROM users WHERE id = ?", [id]);
    return res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ message: "User delete failed" });
  }
};

exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email, role, password } = req.body || {};

  if (!id) {
    return res.status(400).json({ message: "User id required" });
  }

  if (!name || !email || !role) {
    return res.status(400).json({ message: "name, email and role required" });
  }

  try {
    const rows = await UsersModel.findById(id);
    const existingUser = rows[0] || null;
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : "";
    const nextUser = {
      ...sanitizeUser(existingUser),
      id: Number(id),
      name,
      email,
      role,
    };

    const roleId = resolveRoleId(role);

    req.setAuditContext?.({
      action: "update_user",
      oldValue: sanitizeUser(existingUser),
      newValue: {
        ...nextUser,
        role: String(roleId),
      },
      userId: req.user?.id || existingUser.id,
    });

    await db.query(
      "UPDATE users SET name = ?, email = ?, role_id = ?, password_hash = ?, updated_at = NOW() WHERE id = ?",
      [name, email, roleId, hashedPassword || existingUser.password_hash, id]
    );

    return res.json({
      message: "User updated successfully",
      user: nextUser,
    });
  } catch (err) {
    console.error("Error updating user:", err);
    return res.status(500).json({ message: "Internal server error", error: err.message });
  }
};

exports.getMe = async (req, res) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(400).json({ message: "Missing user context" });
  }

  try {
    const rows = await UsersModel.findByEmail(email);
    const user = rows[0] || null;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Resolve the role to its NAME (like authController's login query does),
    // not the raw role_id. The frontend's role system (Sidebar menu map,
    // normalizeRole, ROLE_HOME) is keyed on role names; a bare "3" matches
    // nothing, which blanked out the whole sidebar menu.
    // No hardcoded fallback role: if the lookup misses, tell the client
    // explicitly so it can force a re-login (login is where the role name
    // is always resolved via the roles join).
    const [[roleRow]] = await db.query(
      "SELECT name FROM roles WHERE id = ? LIMIT 1",
      [user.role_id]
    );
    if (!roleRow?.name) {
      return res.status(400).json({
        code: "ROLE_NOT_DEFINED",
        message: "Role not defined for this account. Please login again.",
      });
    }

    const roleName = String(roleRow.name).toLowerCase();

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: roleName,
      phone: user.phone || null,
      avatarUrl: user.avatar_url || null,
    });
  } catch (err) {
    return res.status(500).json({ message: "DB Error" });
  }
};

exports.updateMyPhone = async (req, res) => {
  const email = req.user?.email;
  const { phone } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Missing user context" });
  }

  const digitsOnly = String(phone || "").replace(/\D+/g, "").slice(0, 15);
  if (!digitsOnly) {
    return res.status(400).json({ message: "Please provide a valid phone number" });
  }

  try {
    const [result] = await db.query("UPDATE users SET phone = ?, updated_at = NOW() WHERE email = ?", [digitsOnly, email]);

    if (!result?.affectedRows) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      message: "Phone number updated successfully.",
      phone: digitsOnly,
    });
  } catch (err) {
    return res.status(500).json({ message: "DB Error", error: err.message });
  }
};

// ================= CHANGE PASSWORD =================

exports.changePassword = async (req, res) => {
  const emailFromToken = req.user?.email;
  const { email, currentPassword, newPassword } = req.body || {};

  const targetEmail = emailFromToken || email;

  if (!targetEmail || !currentPassword || !newPassword) {
    return res.status(400).json({
      message: "email, currentPassword, newPassword required",
    });
  }

  if (emailFromToken && email && emailFromToken !== email) {
    return res.status(403).json({
      message: "Cannot change another user's password",
    });
  }

  try {
    const rows = await UsersModel.findByEmail(targetEmail);
    const user = rows[0] || null;

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash || user.password);
    if (!match) {
      return res.status(400).json({
        message: "Current password incorrect",
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    req.setAuditContext?.({
      action: "change_password",
      userId: user.id,
      oldValue: { id: user.id, email: user.email, password: "[REDACTED]" },
      newValue: { id: user.id, email: user.email, password: "[REDACTED]" },
    });

    await db.query("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE email = ?", [hashed, targetEmail]);

    return res.json({
      message: "Password updated successfully",
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to update password",
    });
  }
};

// ================= UPDATE AVATAR =================

exports.updateMyAvatar = async (req, res) => {
  const emailFromToken = req.user?.email;
  const emailFromBody = req.body?.email;
  const email = emailFromToken || emailFromBody;

  if (emailFromToken && emailFromBody && emailFromToken !== emailFromBody) {
    return res.status(403).json({
      message: "Cannot update another user's avatar",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      message: "No avatar file uploaded (field name: avatar)",
    });
  }

  const avatarUrl = `/uploads/${req.file.filename}`;

  try {
    const rows = await UsersModel.findByEmail(email);
    const existingUser = rows[0] || null;

    req.setAuditContext?.({
      action: "update_profile_avatar",
      userId: req.user?.id || existingUser?.id || null,
      oldValue: sanitizeUser(existingUser),
      newValue: {
        ...sanitizeUser(existingUser),
        avatar_url: avatarUrl,
      },
    });

    await db.query("UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE email = ?", [avatarUrl, email]);

    return res.json({
      message: "Avatar updated",
      avatarUrl,
      persisted: true,
    });
  } catch (err) {
    return res.json({
      message: "Avatar uploaded (not persisted in DB)",
      avatarUrl,
      persisted: false,
    });
  }
};

exports.updateMe = async (req, res) => {
  const id = req.user?.id;
  const { name, email } = req.body || {};

  if (!id) {
    return res.status(401).json({ message: "Missing authenticated user" });
  }

  if (!name || !email) {
    return res.status(400).json({ message: "name and email required" });
  }

  try {
    const rows = await UsersModel.findById(id);
    const existingUser = rows[0] || null;
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const nextUser = {
      ...sanitizeUser(existingUser),
      name,
      email,
    };

    req.setAuditContext?.({
      action: "update_profile",
      userId: id,
      oldValue: sanitizeUser(existingUser),
      newValue: nextUser,
    });

    await db.query("UPDATE users SET name = ?, email = ?, updated_at = NOW() WHERE id = ?", [name, email, id]);

    return res.json({
      message: "Profile updated successfully",
      user: nextUser,
    });
  } catch (err) {
    return res.status(500).json({ message: "Profile update failed" });
  }
};
