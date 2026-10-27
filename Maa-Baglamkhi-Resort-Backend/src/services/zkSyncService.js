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

const getAttendanceColumns = async (conn) => {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'attendance_records'`
  )
  return new Set(rows.map((row) => row.COLUMN_NAME))
}

// Resolution order for a device punch-in id:
//   1. explicit zk_badge_map row (operator-assigned, FK -> employees)
//   2. employees.employee_code equal to the device id
//   3. numeric device id equal to employees.id
// Step 1 exists for ESSL sites that enroll fingerprints under badge numbers
// that differ from the employee codes; 2/3 stay for devices enrolled directly
// by code or id.
const resolveEmployeeId = async (conn, deviceUserId) => {
  const deviceId = String(deviceUserId || '').trim()
  if (!deviceId) return null

  const [mapped] = await conn.query(
    `SELECT employee_id FROM zk_badge_map WHERE device_user_id = ? LIMIT 1`,
    [deviceId]
  )
  if (mapped[0]) return Number(mapped[0].employee_id)

  const [byCode] = await conn.query(
    'SELECT id FROM employees WHERE employee_code = ? LIMIT 1',
    [deviceId]
  )
  if (byCode[0]) return Number(byCode[0].id)

  if (/^\d+$/.test(deviceId)) {
    const [byId] = await conn.query(
      'SELECT id FROM employees WHERE id = ? LIMIT 1',
      [Number(deviceId)]
    )
    if (byId[0]) return Number(byId[0].id)
  }

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

  // ESSL units are not NTP-synced: a clock drifted past the shift split sends
  // today's punches to yesterday (or past the pull window entirely, where they
  // are lost with deleteAfter). Align the device clock first — best effort, so
  // a failed SET TIME never blocks attendance pulling.
  let clock = null
  try {
    clock = await zk.setDeviceTime(machine, { toleranceSeconds: 30 })
  } catch (error) {
    console.error(`[zk sync ${machine.name}] clock check failed:`, error.message)
  }

  const { rawLogs, machineTime } = await zk.pullLogs(machine, { from, to, deleteAfter })
  const parsed = parseLogLines(rawLogs)
  const groups = groupByShift(parsed, shifts)

  let created = 0
  let updated = 0
  let alreadyMarked = 0
  const skippedDeviceIds = new Set()

  for (const group of groups) {
    const deviceUserId = String(group.employeeId)
    const notes = `ZK ${machine.name} device ${group.employeeId} (${group.shift} shift)`
    const checkIn = toTimeCol(group.checkIn)
    const checkOut = toTimeCol(group.checkOut)
    const date = group.shiftDay

    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const employeeId = await resolveEmployeeId(conn, deviceUserId)
      if (!employeeId) {
        skippedDeviceIds.add(deviceUserId)
        await conn.rollback()
        continue
      }
      const columns = await getAttendanceColumns(conn)
      const hasMethod = columns.has('method')
      const [existing] = await conn.query(
        'SELECT id, check_in, check_out FROM attendance_records WHERE employee_id = ? AND date = ? LIMIT 1 FOR UPDATE',
        [employeeId, date]
      )

      if (existing.length > 0) {
        const record = existing[0]
        const curIn = toTimeCol(record.check_in)
        const curOut = toTimeCol(record.check_out)

        // A day that already has both stamps is complete. Later same-day
        // punches (re-tapping the thumb) would just re-stamp it — count them
        // as "already marked" and leave the row untouched, so check-in stays
        // the first punch of the day, never the last one.
        if (curIn && curOut) {
          alreadyMarked += 1
          await conn.rollback()
          continue
        }

        // Keep the earlier check-in and the later check-out across sources.
        const keepIn = curIn ? (checkIn && checkIn < curIn ? checkIn : curIn) : checkIn
        const keepOut = curOut ? (checkOut && checkOut > curOut ? checkOut : curOut) : checkOut

        const methodClause = hasMethod ? ", method = 'ZK fingerprint'" : ''
        // notes: append only when the marker is not already there — the auto
        // sync re-runs the same punches every interval and would otherwise
        // pile "ZK ... | ZK ... | ZK ..." duplicates onto the row.
        await conn.query(
          `UPDATE attendance_records
              SET check_in = COALESCE(?, check_in),
                  check_out = COALESCE(?, check_out),
                  status = 'present'
                  ${methodClause},
                  notes = IF(
                    INSTR(IFNULL(notes, ''), ?) > 0,
                    notes,
                    CONCAT(IFNULL(notes, ''), IF(notes IS NOT NULL AND ? <> '', ' | ', ''), ?)
                  ),
                  updated_at = NOW()
            WHERE id = ?`,
          [keepIn, keepOut, notes, notes, notes, record.id]
        )
        updated += 1
      } else {
        const methodColumns = hasMethod ? ', method' : ''
        const methodValues = hasMethod ? ", 'ZK fingerprint'" : ''
        const [result] = await conn.query(
          `INSERT INTO attendance_records
             (employee_id, date, check_in, check_out, status, notes${methodColumns}, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'present', ?${methodValues}, NOW(), NOW())`,
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

  const status =
    created + updated > 0
      ? skippedDeviceIds.size
        ? 'partial'
        : 'ok'
      : skippedDeviceIds.size
        ? 'unmatched'
        : alreadyMarked > 0
          ? 'already-marked'
          : 'empty'
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
    // The device clock we pulled against, plus whether it was auto-corrected
    // this run (drifted ESSL units otherwise send today's punches to
    // yesterday's shift day).
    clock,
    logsPulled: parsed.length,
    shiftsWritten: created + updated,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsAlreadyMarked: alreadyMarked,
    recordsSkipped: skippedDeviceIds.size,
    skippedDeviceIds: [...skippedDeviceIds],
    window: { from, to },
    syncedAt: new Date().toISOString(),
    actor: actor || null
  }
}

module.exports = {
  syncMachine,
  resolveEmployeeId
}
