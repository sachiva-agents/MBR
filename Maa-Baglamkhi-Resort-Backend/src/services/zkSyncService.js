const db = require('../config/db')
const { zk } = require('./zkProtocol')
const { parseLogLines, groupByShift } = require('./zkLogParser')
const machinesModel = require('../models/AttendanceMachinesModel')

const toTimeCol = (value) => {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text.length >= 8 ? text : `${text}:00`
  return null
}

const toTimeHms = (value) => {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text.slice(0, 8).padEnd(8, ':00')
  return null
}

/**
 * Pull one machine's logs, classify each punch into a shift window, and write
 * the result into attendance_records. Every device id is stored on the row
 * (notes, and employee_id when it matches a user id), so an admin can audit
 * who punched in. Returns the summary the API echoes back.
 *
 * Shift windows come from the machine row: a punch in the day window reports
 * against its calendar day, everything else against the "night" report day.
 */
async function syncMachine(machine, { from, to, deleteAfter = false, actor = null } = {}) {
  await machinesModel.ensureSchema()

  const shifts = {
    dayStart: toTimeHms(machine.day_shift_start) || '09:00:00',
    dayEnd: toTimeHms(machine.day_shift_end) || '18:00:00'
  }

  const { rawLogs, machineTime } = await zk.pullLogs(machine, { from, to, deleteAfter })
  const parsed = parseLogLines(rawLogs)
  const groups = groupByShift(parsed, shifts)

  let created = 0
  let updated = 0

  for (const group of groups) {
    const employeeId = Number(group.employeeId)
    const notes = `ZK ${machine.name} device ${group.employeeId} (${group.shift} shift)`
    const checkIn = toTimeCol(group.checkIn)
    const checkOut = toTimeCol(group.checkOut)
    const date = group.shiftDay

    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [existing] = await conn.query(
        'SELECT id, check_in, check_out FROM attendance_records WHERE employee_id = ? AND date = ? LIMIT 1 FOR UPDATE',
        [employeeId, date]
      )

      if (existing.length > 0) {
        const record = existing[0]
        // Keep the earlier check-in and the later check-out across sources.
        const curIn = toTimeCol(record.check_in)
        const curOut = toTimeCol(record.check_out)
        const keepIn = curIn ? (checkIn && checkIn < curIn ? checkIn : curIn) : checkIn
        const keepOut = curOut ? (checkOut && checkOut > curOut ? checkOut : curOut) : checkOut

        await conn.query(
          `UPDATE attendance_records
             SET check_in = COALESCE(?, check_in),
                 check_out = COALESCE(?, check_out),
                 status = 'present',
                 method = 'ZK fingerprint',
                 notes = CONCAT(IFNULL(notes, ''), IF(notes IS NOT NULL AND ? <> '', ' | ', ''), ?),
                 updated_at = NOW()
           WHERE id = ?`,
          [keepIn, keepOut, notes, notes, record.id]
        )
        updated += 1
      } else {
        const [result] = await conn.query(
          `INSERT INTO attendance_records
             (employee_id, date, check_in, check_out, status, notes, method, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'present', ?, 'ZK fingerprint', NOW(), NOW())`,
          [employeeId, date, checkIn, checkOut, notes]
        )
        if (result.affectedRows > 0) created += 1
      }
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    } finally {
      conn.release()
    }
  }

  const status = created + updated > 0 ? 'ok' : 'empty'
  await machinesModel.markSynced(machine.id, status)
  await machinesModel.recordPull(machine.id, {
    rawLogs: rawLogs.slice(0, 500),
    recordsCreated: created,
    recordsMatched: updated,
    status,
    errorMessage: null
  })

  return {
    machine: machine.name,
    machineTime,
    logsPulled: parsed.length,
    shiftsWritten: created + updated,
    recordsCreated: created,
    recordsUpdated: updated,
    window: { from, to },
    syncedAt: new Date().toISOString(),
    actor: actor || null
  }
}

module.exports = {
  syncMachine
}
