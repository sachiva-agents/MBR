const { pool, getConnection } = require('../utils/poolPromise')

class PrintLogs {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`print_logs\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`print_type\` VARCHAR(50) NOT NULL,
  \`reference_id\` BIGINT UNSIGNED,
  \`reference_type\` VARCHAR(50),
  \`status\` ENUM(\'pending\',\'printing\',\'completed\',\'failed\',\'cancelled\') DEFAULT \'pending\',
  \`printer_name\` VARCHAR(100),
  \`error_message\` TEXT,
  \`printed_by\` BIGINT UNSIGNED,
  \`printed_at\` DATETIME,
  \`created_at\` TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_status\` (\`status\`),
  KEY \`idx_created\` (\`created_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for print_logs:', err.message)
    } finally {
      conn.release()
    }
  }

  async findByStatus(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`print_logs\` WHERE \`status\` = ? ORDER BY \`created_at\` DESC", args)
    return rows
  }

  async findById(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`print_logs\` WHERE \`id\` = ?", args)
    return rows
  }

  async findAll(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`print_logs\` ORDER BY \`created_at\` DESC", args)
    return rows
  }

  async buildPrintNo() {
    return `PRN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`
  }

  async createPrintLog(logData = {}) {
    const printNo = logData.printNo || await this.buildPrintNo()
    // printed_by is a bigint FK to users.id; coerce label fallbacks ("System") to NULL
    const printedByRaw = logData.printedBy || logData.printed_by
    const printedByNum = Number(printedByRaw)
    const printedBy = Number.isInteger(printedByNum) && printedByNum > 0 ? printedByNum : null
    const [result] = await this.pool.execute(
      `INSERT INTO print_logs
        (print_type, reference_id, reference_type, status, printer_name, error_message, printed_by, printed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logData.printType || null,
        logData.referenceId || logData.reference_id || null,
        logData.referenceType || logData.reference_type || null,
        logData.status || 'pending',
        logData.printerName || logData.printer_name || null,
        logData.errorMessage || logData.error_message || null,
        printedBy,
        logData.printedAt || logData.printed_at || new Date(),
      ]
    )
    return { id: result.insertId, printNo }
  }

  async getPrintHistory(filters = {}) {
    const conditions = []
    const params = []

    if (filters.printType) {
      conditions.push('print_type = ?')
      params.push(filters.printType)
    }
    if (filters.printerName) {
      conditions.push('printer_name = ?')
      params.push(filters.printerName)
    }
    if (filters.referenceId) {
      conditions.push('reference_id = ?')
      params.push(filters.referenceId)
    }
    if (filters.referenceType) {
      conditions.push('reference_type = ?')
      params.push(filters.referenceType)
    }
    if (filters.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }
    if (filters.printedBy) {
      conditions.push('printed_by = ?')
      params.push(filters.printedBy)
    }
    if (filters.fromDate) {
      conditions.push('printed_at >= ?')
      params.push(filters.fromDate)
    }
    if (filters.toDate) {
      conditions.push('printed_at <= ?')
      params.push(filters.toDate)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    // pool.query, not pool.execute: MySQL's prepared-statement protocol
    // rejects bound LIMIT ? / OFFSET ? values (ER_WRONG_ARGUMENTS 1210)
    // while MariaDB tolerates them — this server runs plain MySQL. Every
    // parameter is a value supplied by this handler (filter strings plus
    // server-side page numbers), so client-side interpolation is safe.
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 50
    const offset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : 0
    const [rows] = await this.pool.query(
      `SELECT * FROM print_logs ${whereClause} ORDER BY printed_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    return rows
  }

  async getPrintCount(invoiceNo, kotNo) {
    if (!invoiceNo && !kotNo) return 0
    const conditions = []
    const params = []
    if (invoiceNo) {
      conditions.push('reference_id = ?')
      params.push(invoiceNo)
    }
    if (kotNo) {
      conditions.push('reference_id = ?')
      params.push(kotNo)
    }
    const whereClause = conditions.join(' AND ')
    const [[{ count }]] = await this.pool.execute(
      `SELECT COUNT(*) AS count FROM print_logs WHERE ${whereClause} AND status = 'completed'`,
      params
    )
    return Number(count || 0)
  }
}

module.exports = new (PrintLogs)()
