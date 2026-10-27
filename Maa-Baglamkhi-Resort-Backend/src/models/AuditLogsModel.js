const { pool, getConnection } = require('../utils/poolPromise')

class AuditLogs {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`audit_logs\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`user_id\` BIGINT UNSIGNED,
  \`user_name\` VARCHAR(191),
  \`user_role\` VARCHAR(50),
  \`action\` VARCHAR(100) NOT NULL,
  \`module\` VARCHAR(50) NOT NULL,
  \`endpoint\` VARCHAR(255),
  \`http_method\` VARCHAR(10),
  \`request_data\` JSON,
  \`response_status\` INT,
  \`old_value\` JSON,
  \`new_value\` JSON,
  \`response_body\` JSON,
  \`ip_address\` VARCHAR(64),
  \`user_agent\` VARCHAR(255),
  \`created_at\` DATETIME,
  PRIMARY KEY (\`id\`),
  KEY \`idx_user\` (\`user_id\`),
  KEY \`idx_module\` (\`module\`),
  KEY \`idx_created\` (\`created_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for audit_logs:', err.message)
    } finally {
      conn.release()
    }
  }

  async findByModule(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`audit_logs\` WHERE \`module\` = ? ORDER BY \`created_at\` DESC", args)
    return rows
  }

  async findByUserId(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`audit_logs\` WHERE \`user_id\` = ? ORDER BY \`created_at\` DESC", args)
    return rows
  }

  async findById(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`audit_logs\` WHERE \`id\` = ?", args)
    return rows
  }

  async findAll(limit) {
    // pool.query, not pool.execute: MySQL's prepared-statement protocol
    // rejects a bound value for LIMIT ? (ER_WRONG_ARGUMENTS 1210) while
    // MariaDB tolerates it — this server runs on plain MySQL. limit is a
    // server-side integer (coerced in the controller), so text
    // interpolation is safe.
    const [rows] = await this.pool.query(
      "SELECT * FROM `audit_logs` ORDER BY `created_at` DESC LIMIT ?",
      [Number(limit) || 100]
    )
    return rows
  }
}

module.exports = new (AuditLogs)()
