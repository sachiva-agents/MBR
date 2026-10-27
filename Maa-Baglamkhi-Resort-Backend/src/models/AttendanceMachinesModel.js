const { pool, getConnection } = require('../utils/poolPromise')

class AttendanceMachines {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`zk_attendance_machines\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(120) NOT NULL,
        \`ip\` VARCHAR(45) NOT NULL,
        \`port\` SMALLINT UNSIGNED NOT NULL DEFAULT 4380,
        \`machine_ip\` VARCHAR(45) NOT NULL,
        \`machine_port\` SMALLINT UNSIGNED NOT NULL DEFAULT 4380,
        \`machine_password\` VARCHAR(16) NOT NULL DEFAULT '00000000',
        \`status\` ENUM('active','inactive') NOT NULL DEFAULT 'active',
        \`day_shift_start\` TIME NOT NULL DEFAULT '09:00:00',
        \`day_shift_end\` TIME NOT NULL DEFAULT '18:00:00',
        \`night_shift_start\` TIME NOT NULL DEFAULT '18:00:00',
        \`night_shift_end\` TIME NOT NULL DEFAULT '09:00:00',
        \`last_sync_at\` DATETIME,
        \`last_sync_status\` VARCHAR(40),
        \`created_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`zk_machines_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      await conn.query(`CREATE TABLE IF NOT EXISTS \`zk_attendance_pulls\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`machine_id\` BIGINT UNSIGNED NOT NULL,
        \`pulled_at\` DATETIME NOT NULL,
        \`raw_logs\` MEDIUMTEXT,
        \`records_created\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`records_matched\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`status\` VARCHAR(40) NOT NULL DEFAULT 'ok',
        \`error_message\` TEXT,
        PRIMARY KEY (\`id\`),
        KEY \`zk_pulls_machine\` (\`machine_id\`),
        FOREIGN KEY (\`machine_id\`) REFERENCES \`zk_attendance_machines\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      // Badge map: ESSL/ZKTeco fingerprint users often punch in under a badge
      // number that is not the employee_code, so an explicit device-badge ->
      // employees.id map is kept here. Empty table = fall back to code/numeric
      // resolution. Self-migrates on boot alongside the rest of ensureSchema.
      await conn.query(`CREATE TABLE IF NOT EXISTS \`zk_badge_map\` (
        \`device_user_id\` VARCHAR(40) NOT NULL,
        \`employee_id\` BIGINT UNSIGNED NOT NULL,
        \`created_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`device_user_id\`),
        FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for zk attendance machines:', err.message)
    } finally {
      conn.release()
    }
  }

  async listMachines() {
    const [rows] = await pool.query(
      'SELECT * FROM `zk_attendance_machines` ORDER BY `id`'
    )
    return rows
  }

  async getMachine(id) {
    const [rows] = await pool.query(
      'SELECT * FROM `zk_attendance_machines` WHERE `id` = ? LIMIT 1',
      [id]
    )
    return rows[0] || null
  }

  async createMachine(data) {
    const [result] = await pool.query(
      `INSERT INTO \`zk_attendance_machines\`
        (\`name\`, \`ip\`, \`port\`, \`machine_ip\`, \`machine_port\`, \`machine_password\`, \`status\`,
         \`day_shift_start\`, \`day_shift_end\`, \`night_shift_start\`, \`night_shift_end\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.ip,
        Number(data.port || 4380),
        data.machineIp || data.machine_ip || data.ip,
        Number(data.machinePort || data.machine_port || 4380),
        String(data.machinePassword || data.machine_password || '00000000'),
        data.status === 'inactive' ? 'inactive' : 'active',
        data.dayShiftStart || data.day_shift_start || '09:00:00',
        data.dayShiftEnd || data.day_shift_end || '18:00:00',
        data.nightShiftStart || data.night_shift_start || '18:00:00',
        data.nightShiftEnd || data.night_shift_end || '09:00:00',
      ]
    )
    return this.getMachine(result.insertId)
  }

  async updateMachine(id, data) {
    const machine = await this.getMachine(id)
    if (!machine) return null
    await pool.query(
      `UPDATE \`zk_attendance_machines\` SET
        \`name\` = ?, \`ip\` = ?, \`port\` = ?, \`machine_ip\` = ?, \`machine_port\` = ?,
        \`machine_password\` = ?, \`status\` = ?,
        \`day_shift_start\` = ?, \`day_shift_end\` = ?, \`night_shift_start\` = ?, \`night_shift_end\` = ?
       WHERE \`id\` = ?`,
      [
        data.name ?? machine.name,
        data.ip ?? machine.ip,
        Number(data.port ?? machine.port),
        data.machineIp || data.machine_ip || machine.machine_ip,
        Number(data.machinePort || data.machine_port || machine.machine_port),
        String(data.machinePassword || data.machine_password || machine.machine_password),
        data.status === 'inactive' ? 'inactive' : 'active',
        data.dayShiftStart || data.day_shift_start || machine.day_shift_start,
        data.dayShiftEnd || data.day_shift_end || machine.day_shift_end,
        data.nightShiftStart || data.night_shift_start || machine.night_shift_start,
        data.nightShiftEnd || data.night_shift_end || machine.night_shift_end,
        id
      ]
    )
    return this.getMachine(id)
  }

  async deleteMachine(id) {
    const [result] = await pool.query(
      'DELETE FROM `zk_attendance_machines` WHERE `id` = ?',
      [id]
    )
    return result.affectedRows > 0
  }

  async recordPull(machineId, payload) {
    const [result] = await pool.query(
      `INSERT INTO \`zk_attendance_pulls\`
        (\`machine_id\`, \`pulled_at\`, \`raw_logs\`, \`records_created\`, \`records_matched\`, \`status\`, \`error_message\`)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        machineId,
        new Date(),
        payload.rawLogs ? JSON.stringify(payload.rawLogs) : null,
        Number(payload.recordsCreated || 0),
        Number(payload.recordsMatched || 0),
        payload.status || 'ok',
        payload.errorMessage || null
      ]
    )
    return result.insertId
  }

  async lastPull(machineId) {
    const [rows] = await pool.query(
      `SELECT * FROM \`zk_attendance_pulls\` WHERE \`machine_id\` = ? ORDER BY \`id\` DESC LIMIT 1`,
      [machineId]
    )
    return rows[0] || null
  }

  async pullsForMachine(machineId, limit = 20) {
    const [rows] = await pool.query(
      `SELECT id, pulled_at, records_created, records_matched, status, error_message
         FROM \`zk_attendance_pulls\` WHERE \`machine_id\` = ? ORDER BY \`id\` DESC LIMIT ?`,
      [machineId, Number(limit) || 20]
    )
    return rows
  }

  async markSynced(machineId, status) {
    await pool.query(
      'UPDATE `zk_attendance_machines` SET `last_sync_at` = NOW(), `last_sync_status` = ? WHERE `id` = ?',
      [status, machineId]
    )
  }

  // --- zk_badge_map: device fingerprint id -> employees.id -------------------

  async listBadgeMappings() {
    const [rows] = await pool.query(
      `SELECT m.device_user_id, m.employee_id,
              e.employee_code, e.first_name, e.last_name
         FROM zk_badge_map m
         JOIN employees e ON e.id = m.employee_id
         ORDER BY m.employee_id`
    )
    return rows
  }

  async mapBadge(deviceUserId, employeeId) {
    await pool.query(
      `INSERT INTO zk_badge_map (device_user_id, employee_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id)`,
      [String(deviceUserId), Number(employeeId)]
    )
  }

  async unmapBadge(deviceUserId) {
    await pool.query('DELETE FROM zk_badge_map WHERE device_user_id = ?', [String(deviceUserId)])
  }
}

module.exports = new (AttendanceMachines)()
