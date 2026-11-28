const { pool, getConnection } = require('../utils/poolPromise')

class RolePermissions {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`role_permissions\` (
            \`role_id\` INT UNSIGNED NOT NULL,
  \`permission_id\` INT UNSIGNED NOT NULL,
  PRIMARY KEY (\`role_id\`, \`permission_id\`),
  FOREIGN KEY (\`role_id\`) REFERENCES \`roles\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (\`permission_id\`) REFERENCES \`permissions\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      // Seed role_permissions with sensible defaults. Skipped when the table
      // already has rows (INSERT IGNORE + the PK prevents duplicates).
      const [existing] = await conn.query('SELECT COUNT(*) AS cnt FROM `role_permissions`')
      if (!existing[0] || existing[0].cnt === 0) {
        const permRows = await conn.query('SELECT id, `module`, `action` FROM `permissions`')
        const perms = permRows[0] || []
        const byMod = {}
        for (const p of perms) {
          const key = p.module + ':' + p.action
          byMod[key] = p.id
        }
        const roleDefaults = [
          [1, ["dashboard.read","bookings.*","restaurant.*","kitchen.*","housekeeping.*","inventory.*","accounts.*","reports.*","users.*","settings.*","invoices.*","payments.*","attendance.manage","backups.manage","settings.connectors","zk.manage","notifications.manage","reports.financial"]],
          [2, ["dashboard.read","bookings.read","bookings.update","restaurant.read","kitchen.read","housekeeping.read","inventory.read","accounts.read","reports.read","users.read","invoices.read","payments.read"]],
          [3, ["dashboard.read","bookings.read","bookings.create","restaurant.read","kitchen.read","housekeeping.read","invoices.read","payments.read"]],
          [4, ["dashboard.read","accounts.*","reports.*","invoices.*","payments.*","reports.financial"]],
          [5, ["dashboard.read","housekeeping.*"]],
          [6, ["dashboard.read","restaurant.read","kitchen.read"]],
          [7, ["dashboard.read","kitchen.*"]],
        ]
        for (const [roleId, patterns] of roleDefaults) {
          for (const pat of patterns) {
            if (pat.endsWith('.*')) {
              const mod = pat.slice(0, -2)
              for (const [key, pid] of Object.entries(byMod)) {
                if (key.startsWith(mod + ':')) {
                  await conn.query('INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`) VALUES (?, ?)', [roleId, pid])
                }
              }
            } else if (byMod[pat]) {
              await conn.query('INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`) VALUES (?, ?)', [roleId, byMod[pat]])
            }
          }
        }
      }

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for role_permissions:', err.message)
    } finally {
      conn.release()
    }
  }

  async findByRoleId(...args) {
    const [rows] = await this.pool.execute("SELECT p.* FROM \`permissions\` p JOIN \`role_permissions\` rp ON p.id = rp.permission_id WHERE rp.role_id = ?", args)
    return rows
  }
}

module.exports = new (RolePermissions)()
