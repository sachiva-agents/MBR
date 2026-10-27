// models/UserModel.js
// Manages the `register` table — staff users (admin, manager, receptionist, accountant, housekeeping, waiter, kitchen)
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const { addColumnIfMissing } = require("../utils/schemaMigrations");

const runQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) { reject(err); return; }
      resolve(rows);
    });
  });

const ensureSchema = async () => {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS register (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL UNIQUE,
      phone VARCHAR(20) DEFAULT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'staff',
      avatar_url VARCHAR(255) DEFAULT NULL
    )
  `);

  // Backfill phone for `register` tables created before the column existed.
  // Portable across MariaDB and plain MySQL (no MariaDB-only IF NOT EXISTS).
  try {
    await addColumnIfMissing(db, "register", "phone", "VARCHAR(20) DEFAULT NULL");
  } catch {
    // Phone is optional metadata; never block schema on it.
  }
};

const seedDefaults = async () => {
  const hashedPassword = await bcrypt.hash("password", 10);
  const defaultUsers = [
    ["Admin User", "admin@resort.com", "admin"],
    ["Rajesh Manager", "manager@resort.com", "manager"],
    ["Priya Reception", "reception@resort.com", "receptionist"],
    ["CA Accounts", "accounts@resort.com", "accountant"],
    ["Tarun HK", "tarun@resort.com", "housekeeping"],
    ["Ramu Waiter", "waiter@resort.com", "waiter"],
    ["Chef Kumar", "kitchen@resort.com", "kitchen"],
  ];

  for (const [name, email, role] of defaultUsers) {
    const [existingRows] = await runQuery(
      "SELECT id FROM register WHERE LOWER(email) = LOWER(?) LIMIT 1",
      [email]
    );
    if (existingRows.length > 0) continue;
    await runQuery(
      "INSERT INTO register (name, email, password, role) VALUES (?, ?, ?, ?)",
      [name, email, hashedPassword, role]
    );
  }
};

const createUser = (data) => {
  const sql = "INSERT INTO register (name, email, password, role) VALUES (?, ?, ?, ?)";
  return runQuery(sql, [data.name, data.email, data.password, data.role]);
};

const findUserByEmail = (email) => {
  return runQuery("SELECT * FROM register WHERE email = ?", [email]).then(rows => rows[0] || null);
};

const findUserById = (id) => {
  return runQuery("SELECT * FROM register WHERE id = ?", [id]).then(rows => rows[0] || null);
};

const countUsers = () => {
  return runQuery("SELECT COUNT(*) AS c FROM register").then(rows => rows[0]?.c ?? 0);
};

const updatePasswordByEmail = (email, hashedPassword) => {
  return runQuery("UPDATE register SET password = ? WHERE email = ?", [hashedPassword, email]);
};

const updateAvatarUrlByEmail = (email, avatarUrl) => {
  return runQuery("UPDATE register SET avatar_url = ? WHERE email = ?", [avatarUrl, email]);
};

const updatePhoneByEmail = (phone, email) => {
  return runQuery("UPDATE register SET phone = ? WHERE email = ?", [phone, email]);
};

const findAdminUser = () => {
  return runQuery("SELECT id, name, email, phone FROM register WHERE LOWER(role) = 'admin' ORDER BY id ASC LIMIT 1")
    .then(rows => rows[0] || null);
};

const findAdminWithPhone = () => {
  return runQuery(
      "SELECT id, name, email, phone FROM register WHERE LOWER(role) = 'admin' AND phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id ASC LIMIT 1"
    )
    .then(rows => rows[0] || null)
    .then(found => found || runQuery("SELECT id, name, email, phone FROM register WHERE LOWER(role) = 'admin' ORDER BY id ASC LIMIT 1").then(rows => rows[0] || null));
};

const getAllUsers = () => runQuery("SELECT id, name, email, role FROM register");

const deleteUserById = (id) => runQuery("DELETE FROM register WHERE id = ?", [id]);

const updateUserById = (id, data) => {
  const fields = ["name = ?", "email = ?", "role = ?"];
  const values = [data.name, data.email, data.role];
  if (data.password) {
    fields.push("password = ?");
    values.push(data.password);
  }
  values.push(id);
  return runQuery(`UPDATE register SET ${fields.join(", ")} WHERE id = ?`, values);
};

module.exports = {
  ensureSchema,
  seedDefaults,
  createUser,
  findUserByEmail,
  findUserById,
  countUsers,
  updatePasswordByEmail,
  updateAvatarUrlByEmail,
  updatePhoneByEmail,
  findAdminUser,
  findAdminWithPhone,
  getAllUsers,
  deleteUserById,
  updateUserById,
};
