// ZK attendance log line, exactly 64 characters:
//
//   01,0000000003,1,0,133,2026-10-24 08:55:01,123
//   ^^^ ^^^^^^^^^^ ^ ^ ^^^^^ ^^^^^^^^^^^^^^^^^^^^ ^^^
//   emp fingerprint type? flag pincode timestamp           pad
//
// Fields: employeeId (3), fingerprintId (10), verificationType (1),
// verificationMode (1), pincode (5), timestamp (19), padding (25).
//
// verificationMode: 0 = normal, 2 = card only, 4 = card + pin.

const pad2 = (value) => String(value).padStart(2, '0')

/**
 * Parse one 64-char log line. Returns null for blank lines (devices pad the
 * last chunk of a transfer with empty lines) and throws for malformed lines
 * so a sync fails loudly instead of skipping punches.
 */
function parseLogLine(line) {
  const text = String(line).trim()
  if (text === '') return null

  const fields = text.split(',')
  if (fields.length < 6) {
    throw new Error(`Malformed ZK log line (expected 6+ fields): "${text}"`)
  }

  const employeeId = String(fields[0]).replace(/^0+/, '')
  if (employeeId === '' || !/^\d+$/.test(employeeId)) {
    throw new Error(`Malformed ZK employee id in log line: "${text}"`)
  }

  const timestamp = String(fields[5]).trim()
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(timestamp)
  if (!m) {
    throw new Error(`Unparseable ZK timestamp in log line: "${text}"`)
  }

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])
  const time = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`

  return {
    employeeId,
    fingerprintId: String(fields[1]).trim(),
    verificationType: String(fields[2]).trim(),
    verificationMode: String(fields[3]).trim(),
    pincode: String(fields[4]).trim(),
    timestamp,
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    time,
    hour,
    minute,
    second
  }
}

/** Parse every line; blank lines are skipped, errors propagate. */
function parseLogLines(rawLines) {
  return (rawLines || [])
    .map(parseLogLine)
    .filter(Boolean)
}

/** "YYYY-MM-DD" -> the previous calendar day. */
function previousDay(date) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/**
 * Resolve the shift day a punch belongs to, given the machine's shift split.
 *
 * The day window [dayStart, dayEnd) owns the punch when the clock time falls
 * inside it on the same calendar day. Everything outside the day window is
 * the night shift, whose *report* day is:
 *   - the punch's calendar day, when the punch is in the late part of the
 *     day (after dayEnd, e.g. 18:00-23:59 for a 09:00-18:00 split), or
 *   - the *previous* calendar day, when the punch is in the early part of
 *     the day (before dayStart, e.g. 00:00-08:59) — that is the tail of
 *     the night shift that started the day before.
 *
 * A punch at 06:00 on the 25th therefore reports against shift day 24.
 *
 * @param {object} punch  { date: "YYYY-MM-DD", hour, minute }
 * @param {object} shifts { dayStart: "HH:MM", dayEnd: "HH:MM" }
 * @returns {{ shiftDay: string, shift: 'day' | 'night' }}
 */
function resolveShiftDay({ date, hour, minute }, { dayStart = '09:00', dayEnd = '18:00' } = {}) {
  const toMinutes = (text) => {
    const [h, mm] = String(text).split(':').map(Number)
    return h * 60 + mm
  }

  const dayStartMin = toMinutes(dayStart)
  const dayEndMin = toMinutes(dayEnd)
  const clockMin = hour * 60 + minute

  if (dayStartMin < dayEndMin) {
    // Normal same-day window: 09:00 -> 18:00.
    if (clockMin >= dayStartMin && clockMin < dayEndMin) {
      return { shiftDay: date, shift: 'day' }
    }
    return clockMin >= dayEndMin
      ? { shiftDay: date, shift: 'night' }
      : { shiftDay: previousDay(date), shift: 'night' }
  }

  // Window crosses midnight (rare config, e.g. day 18:00 -> 06:00):
  // 18:00-23:59 belongs to this calendar day, 00:00-05:59 to the previous.
  if (clockMin >= dayStartMin || clockMin < dayEndMin) {
    return { shiftDay: clockMin >= dayStartMin ? date : previousDay(date), shift: 'day' }
  }
  // The rest is "night" in the gap between the two windows.
  return { shiftDay: date, shift: 'night' }
}

/**
 * Group parsed logs by (employeeId, shiftDay) and keep the first/last punch of
 * each shift window. A shift with only a check-in reports no check-out.
 *
 * Returns [ { employeeId, shiftDay, shift, checkIn, checkOut, punches } ].
 */
function groupByShift(parsed, shifts) {
  const buckets = new Map()
  for (const entry of parsed) {
    const { shiftDay, shift } = resolveShiftDay(entry, shifts)
    const key = `${entry.employeeId}|${shiftDay}|${shift}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        employeeId: entry.employeeId,
        shiftDay,
        shift,
        punches: 0,
        checkIn: null,
        checkOut: null,
        firstTime: null,
        lastTime: null
      })
    }
    const bucket = buckets.get(key)
    bucket.punches += 1
    if (bucket.firstTime === null || entry.timestamp < bucket.firstTime) {
      bucket.firstTime = entry.timestamp
      bucket.checkIn = entry.time
    }
    if (bucket.lastTime === null || entry.timestamp > bucket.lastTime) {
      bucket.lastTime = entry.timestamp
      bucket.checkOut = entry.time
    }
  }

  // A lone punch — or a physical touch that the device echoes as two log lines a
  // moment apart — is a check-IN only. Without this, first ≈ last stamps
  // check_out to the same instant as check_in, so a single fingerprint touch
  // both opens and closes the day. A real in/out pair is always many minutes
  // apart, so a 60 s gap is the safe line between "same touch" and "worked a
  // stretch".
  const toMs = (ts) => (ts ? new Date(`${ts}Z`).getTime() : null)
  for (const bucket of buckets.values()) {
    if (bucket.firstTime !== null && bucket.firstTime !== bucket.lastTime) {
      const gapMs = toMs(bucket.lastTime) - toMs(bucket.firstTime)
      if (gapMs > 0 && gapMs < 60_000) bucket.checkOut = null
    } else {
      bucket.checkOut = null
    }
  }

  return [...buckets.values()].sort(
    (a, b) => a.shiftDay.localeCompare(b.shiftDay) || a.shift.localeCompare(b.shift) || a.employeeId.localeCompare(b.employeeId)
  )
}

module.exports = {
  parseLogLine,
  parseLogLines,
  resolveShiftDay,
  groupByShift
}
