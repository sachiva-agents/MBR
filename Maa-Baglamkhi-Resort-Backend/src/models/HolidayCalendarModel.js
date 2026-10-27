const { pool, getConnection } = require('../utils/poolPromise')

// Festival / holiday calendar. Each row is a date the resort treats as a
// holiday; the payroll engine pays `holiday` attendance rows in full, so
// marking staff against this calendar is how a festival day counts in salary.
class HolidayCalendar {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()
      await conn.query(`CREATE TABLE IF NOT EXISTS \`holiday_calendar\` (
            \`holiday_date\` DATE NOT NULL,
            \`name\` VARCHAR(120) NOT NULL,
            \`full_pay\` TINYINT(1) NOT NULL DEFAULT 1,
            \`notes\` TEXT,
            \`created_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`holiday_date\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for holiday_calendar:', err.message)
    } finally {
      conn.release()
    }
  }

  async list(from, to) {
    if (from && to) {
      const [rows] = await this.pool.query(
        'SELECT * FROM holiday_calendar WHERE holiday_date >= ? AND holiday_date <= ? ORDER BY holiday_date',
        [from, to]
      )
      return rows
    }
    const [rows] = await this.pool.query('SELECT * FROM holiday_calendar ORDER BY holiday_date')
    return rows
  }

  async getByDate(date) {
    const [rows] = await this.pool.query('SELECT * FROM holiday_calendar WHERE holiday_date = ? LIMIT 1', [date])
    return rows[0] || null
  }

  async add({ date, name, fullPay = true, notes = null }) {
    await this.pool.query(
      `INSERT INTO holiday_calendar (holiday_date, name, full_pay, notes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), full_pay = VALUES(full_pay), notes = VALUES(notes)`,
      [date, name, fullPay ? 1 : 0, notes]
    )
    return this.getByDate(date)
  }

  async remove(date) {
    const [result] = await this.pool.query('DELETE FROM holiday_calendar WHERE holiday_date = ?', [date])
    return result.affectedRows > 0
  }
}

module.exports = new HolidayCalendar()
