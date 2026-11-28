const { pool, getConnection } = require('../utils/poolPromise')

class Permissions {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`permissions\` (
            \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`module\` VARCHAR(50) NOT NULL,
  \`action\` VARCHAR(50) NOT NULL,
  \`description\` VARCHAR(255),
  PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for permissions:', err.message)
    } finally {
      conn.release()
    }
  }

  async findAll(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`permissions\` ORDER BY \`module\`, \`action\`", args)
    return rows
  }

  async findById(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`permissions\` WHERE \`id\` = ?", args)
    return rows
  }

  async seed() {
    try {
      const [existing] = await this.pool.execute('SELECT COUNT(*) as cnt FROM `permissions`')
      if (existing[0] && existing[0].cnt > 0) return
      const rows = [
        // --- original 19 ---
        {"module":"dashboard","action":"read"},
        {"module":"bookings","action":"create"},
        {"module":"bookings","action":"read"},
        {"module":"bookings","action":"update"},
        {"module":"bookings","action":"delete"},
        {"module":"restaurant","action":"create"},
        {"module":"restaurant","action":"read"},
        {"module":"kitchen","action":"read"},
        {"module":"kitchen","action":"update"},
        {"module":"housekeeping","action":"read"},
        {"module":"housekeeping","action":"update"},
        {"module":"inventory","action":"read"},
        {"module":"inventory","action":"update"},
        {"module":"accounts","action":"read"},
        {"module":"accounts","action":"update"},
        {"module":"reports","action":"read"},
        {"module":"users","action":"read"},
        {"module":"users","action":"update"},
        {"module":"settings","action":"update"},
        // --- HAG-26 additions ---
        {"module":"invoices","action":"create"},
        {"module":"invoices","action":"read"},
        {"module":"invoices","action":"update"},
        {"module":"invoices","action":"delete"},
        {"module":"invoices","action":"pdf"},
        {"module":"accounts","action":"transactions.create"},
        {"module":"accounts","action":"transactions.read"},
        {"module":"accounts","action":"transactions.update"},
        {"module":"accounts","action":"transactions.delete"},
        {"module":"attendance","action":"manage"},
        {"module":"payments","action":"create"},
        {"module":"payments","action":"read"},
        {"module":"payments","action":"update"},
        {"module":"payments","action":"delete"},
        {"module":"backups","action":"manage"},
        {"module":"settings","action":"connectors"},
        {"module":"zk","action":"manage"},
        {"module":"notifications","action":"manage"},
        {"module":"reports","action":"financial"},
      ]
      const placeholders = Array(rows.length).fill("?").join(", ")
      const sql = 'INSERT IGNORE INTO `permissions` (`module`, `action`, `description`) VALUES (' + placeholders + ')'
      const vals = rows.flatMap(r => [r.module, r.action, r.description || null])
      await this.pool.execute(sql, vals)
    } catch (err) {
      console.error('Seed error for permissions:', err.message)
    }
  }
}

module.exports = new (Permissions)()
