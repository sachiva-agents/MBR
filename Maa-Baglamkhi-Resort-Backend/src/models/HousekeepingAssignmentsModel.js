const { pool, getConnection } = require('../utils/poolPromise')
const { addColumnIfMissing, addKeyIfMissing } = require('../utils/schemaMigrations')

class HousekeepingAssignments {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`housekeeping_assignments\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`room_id\` INT UNSIGNED,
  \`room_number\` VARCHAR(50),
  \`assigned_to\` BIGINT UNSIGNED,
  \`assigned_to_name\` VARCHAR(191),
  \`task_type\` ENUM(\'cleaning\',\'deep_clean\',\'inspection\',\'setup\',\'maintenance\',\'other\') DEFAULT \'cleaning\',
  \`priority\` ENUM(\'urgent\',\'high\',\'normal\',\'low\') DEFAULT \'normal\',
  \`status\` ENUM(\'pending\',\'in_progress\',\'completed\',\'verified\',\'cancelled\') DEFAULT \'pending\',
  \`notes\` TEXT,
  \`assigned_by\` BIGINT UNSIGNED,
  \`assigned_by_name\` VARCHAR(191),
  \`due_time\` DATETIME,
  \`started_at\` DATETIME,
  \`completed_at\` DATETIME,
  \`verified_by\` BIGINT UNSIGNED,
  \`verified_at\` DATETIME,
  \`created_at\` TIMESTAMP,
  \`updated_at\` TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_room\` (\`room_number\`),
  KEY \`idx_assignee\` (\`assigned_to\`),
  KEY \`idx_status\` (\`status\`),
  FOREIGN KEY (\`assigned_to\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      // Additive backfill for databases that already have the stricter v4
      // columns. CREATE TABLE IF NOT EXISTS never relaxes an existing column,
      // and assignments for rooms outside the Rooms inventory must still work.
      // Column/key adds go through the portable helper (information_schema
      // pre-check) because "ADD COLUMN IF NOT EXISTS" is MariaDB-only syntax
      // that plain MySQL rejects outright.
      await conn.query(`ALTER TABLE \`housekeeping_assignments\` MODIFY \`room_id\` INT UNSIGNED`)
      await conn.query(`ALTER TABLE \`housekeeping_assignments\` MODIFY \`room_number\` VARCHAR(50)`)
      await addColumnIfMissing(conn, 'housekeeping_assignments', 'assigned_by', 'BIGINT UNSIGNED')
      await addColumnIfMissing(conn, 'housekeeping_assignments', 'assigned_by_name', 'VARCHAR(191)')
      await addColumnIfMissing(conn, 'housekeeping_assignments', 'due_time', 'DATETIME')
      await addKeyIfMissing(conn, 'housekeeping_assignments', 'idx_assigner', '`assigned_by`')

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for housekeeping_assignments:', err.message)
    } finally {
      conn.release()
    }
  }

  async findByStatus(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`housekeeping_assignments\` WHERE \`status\` = ? ORDER BY \`priority\`, \`created_at\`", args)
    return rows
  }

  async findByRoom(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`housekeeping_assignments\` WHERE \`room_number\` = ? ORDER BY \`created_at\` DESC", args)
    return rows
  }

  async findById(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`housekeeping_assignments\` WHERE \`id\` = ?", args)
    return rows
  }

  async findAll(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`housekeeping_assignments\` ORDER BY \`created_at\` DESC", args)
    return rows
  }
}

module.exports = new (HousekeepingAssignments)()
