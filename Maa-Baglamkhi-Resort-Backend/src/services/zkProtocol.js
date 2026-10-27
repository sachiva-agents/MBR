// ZKTeco / ESSL attendance machines use the binary ZK packet protocol over
// TCP (usually port 4370; this application keeps the configured port, which
// may be 4380 on some eSSL installations).
//
// The low-level packet helpers below remain exported for protocol regressions;
// live device operations use zkteco-js so the binary framing and chunked
// attendance download match the machine firmware.

const net = require('net')
const Zkteco = require('zkteco-js')

const ZK_PORT = 4380
const SOCKET_TIMEOUT_MS = 15000

const connectDevice = async (machine) => {
  const configuredPort = Number(machine.machinePort || machine.port || ZK_PORT)
  const ports = [...new Set([configuredPort, configuredPort === 4380 ? 4370 : null].filter(Boolean))]
  let lastError = null
  for (const port of ports) {
    const device = new Zkteco(
      machine.machineIp || machine.ip,
      port,
      Number(machine.timeoutMs || SOCKET_TIMEOUT_MS),
      0
    )
    try {
      await device.createSocket()
      return { device, port }
    } catch (error) {
      lastError = error
      await device.disconnect().catch(() => {})
    }
  }
  throw lastError || new Error('device connection failed')
}

const toDeviceDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Unparseable device timestamp: "${value}"`)
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const toDate = (value) => {
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid attendance window timestamp: "${value}"`)
  return parsed
}

const pad2 = (value) => String(value).padStart(2, '0')

/** (sum of ASCII bytes of text) & 0xFF */
function checksum(text) {
  let total = 0
  for (let i = 0; i < text.length; i += 1) {
    total = (total + text.charCodeAt(i)) & 0xFF
  }
  return total
}

function buildPacket(command, ...params) {
  const body = [command, ...params].join(',')
  return `${body}${checksum(body)}`
}

/**
 * "2026-10-24 20:15:09" -> { year, month, day, hour, minute, second }
 * Throws when the text is not a device timestamp.
 */
function parseTimestamp(text) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(String(text).trim())
  if (!m) {
    throw new Error(`Unparseable ZK timestamp: "${text}"`)
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6])
  }
}

function formatTimestamp(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ` +
    `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`
}

/** Strip the leading ACK/NAK reply line; result lines follow it. */
function splitResultLines(raw) {
  return String(raw)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(ACK|NAK)(,|$)/i.test(line))
}

function openSocket({ host, port, timeoutMs = SOCKET_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => fail(new Error(`ZK socket timed out after ${timeoutMs} ms`)))
    socket.on('error', (error) => fail(error))
    socket.connect(port, host, () => {
      if (settled) return
      settled = true
      socket.setTimeout(0) // connection made; command timeouts are enforced below
      resolve(socket)
    })
  })
}

/**
 * Exchange one packet with the device. `send` writes the packet and collects
 * the device's byte stream until it goes quiet for 800 ms.
 */
function exchange(socket, packet) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let finished = false
    let quietTimer = null

    const finish = (error, data) => {
      if (finished) return
      finished = true
      if (quietTimer) clearTimeout(quietTimer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onSocketError)
      if (error) reject(error)
      else resolve(data)
    }

    const onData = (chunk) => {
      buffer += chunk.toString('binary')
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => {
        finish(
          /^NAK/i.test(buffer) ? new Error(`ZK device answered NAK: ${buffer.slice(0, 120)}`) : null,
          buffer
        )
      }, 800)
    }

    const onSocketError = (error) => finish(error)

    socket.on('data', onData)
    socket.on('error', onSocketError)

    socket.write(packet, (error) => {
      if (error && !finished) finish(error)
    })
  })
}

/**
 * Connect to one machine and run a list of commands in order. Returns the
 * combined result text of every ACKed command. The socket is always closed.
 */
async function runCommands({ host, port = ZK_PORT, commands = [], timeoutMs = SOCKET_TIMEOUT_MS }) {
  const socket = await openSocket({ host, port, timeoutMs })
  try {
    const outputs = []
    for (const packet of commands) {
      const raw = await exchange(socket, packet)
      outputs.push(splitResultLines(raw))
    }
    return outputs.flat()
  } finally {
    socket.end()
  }
}

const zk = {
  ZK_PORT,

  /** Server time: "GETTIME" -> "yyyy-MM-dd HH:mm:ss" */
  getTime() {
    return buildPacket('GETTIME')
  },

  /** "yyyy-MM-dd HH:mm:ss[,yyyy-MM-dd HH:mm:ss]" -> attendance log lines */
  getAttendanceLog(from, to) {
    return buildPacket('GETATTLOG', from, to)
  },

  /** "yyyy-MM-dd HH:mm:ss[,yyyy-MM-dd HH:mm:ss]" -> delete log lines from the device */
  clearLogs(from, to) {
    return buildPacket('CLEARDATA', from, to)
  },

  /** "yyyy-MM-dd HH:mm:ss[,yyyy-MM-dd HH:mm:ss]" -> delete fingerprint records from the device */
  clearPunchRecords(from, to) {
    return buildPacket('CLEARFP', from, to)
  },

  /** Connect and verify that the device answers the binary ZK protocol. */
  async testConnection(machine) {
    const startedAt = Date.now()
    const connection = await connectDevice(machine)
    const { device, port } = connection
    try {
      const deviceTime = toDeviceDate(await device.getTime())
      return {
        connected: true,
        deviceTime,
        latencyMs: Date.now() - startedAt,
        address: `${machine.machineIp || machine.ip}:${port}`
      }
    } finally {
      await device.disconnect().catch(() => {})
    }
  },

  /** Download attendance logs, filter by window, and optionally delete them. */
  async pullLogs(machine, { from, to, deleteAfter = false } = {}) {
    const { device } = await connectDevice(machine)
    try {
      const machineTime = toDeviceDate(await device.getTime())
      const response = await device.getAttendances()
      const start = toDate(from)
      const end = toDate(to)
      const rawLogs = (response?.data || [])
        .map((record) => {
          const userId = String(record.user_id ?? '').trim()
          const recordTime = toDeviceDate(record.record_time)
          return `${userId},0,${record.type ?? 0},${record.state ?? 0},0,${recordTime}`
        })
        .filter((record) => {
          const timestamp = toDate(record.split(',')[5])
          return timestamp >= start && timestamp <= end
        })

      if (deleteAfter) await device.clearAttendanceLog()
      return {
        machineTime,
        rawLogs,
        machineTimeParsed: parseTimestamp(machineTime)
      }
    } finally {
      await device.disconnect().catch(() => {})
    }
  },

  /**
   * Read the users (fingerprint enrolments) currently registered on the
   * device. Fingerprint capture itself happens on the machine's keypad; this
   * lists what is enrolled so unmatched ids can be pinned in the badge map.
   */
  async getDeviceUsers(machine) {
    const { device } = await connectDevice(machine)
    try {
      const response = await device.getUsers()
      return (response?.data || []).map((user) => ({
        uid: Number(user.uid),
        name: user.name,
        deviceId: String(user.userId ?? '').trim(),
      }))
    } finally {
      await device.disconnect().catch(() => {})
    }
  },

  /**
   * Align the machine clock with the server clock. ESSL / ZKTeco units are not
   * NTP-synced; a drifted device clock is the #1 cause of punches landing in
   * the wrong shift day (or falling outside the pull window and being lost).
   *
   * Pushes the server's LOCAL time to the device only when |drift| exceeds
   * `toleranceSeconds` — the shift split is configured against device local
   * time, so the two clocks must agree on local wall time. Returns
   * { deviceTime, serverTime, driftSeconds, corrected, newDeviceTime }.
   */
  async setDeviceTime(machine, { toleranceSeconds = 30 } = {}) {
    const { device } = await connectDevice(machine)
    try {
      const deviceTime = toDeviceDate(await device.getTime())
      const now = new Date()
      const deviceParts = parseTimestamp(deviceTime)
      const toEpoch = (p) =>
        new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)).getTime()
      const serverParts = {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
      }
      const driftSeconds = Math.round((toEpoch(deviceParts) - toEpoch(serverParts)) / 1000)
      const corrected = Math.abs(driftSeconds) > toleranceSeconds
      let newDeviceTime = deviceTime
      if (corrected) {
        await device.setTime(now)
        newDeviceTime = toDeviceDate(await device.getTime())
      }
      return {
        deviceTime,
        serverTime: formatTimestamp(serverParts),
        driftSeconds,
        corrected,
        newDeviceTime,
      }
    } finally {
      await device.disconnect().catch(() => {})
    }
  },

  /**
   * Verify the machine clock against the server. Returns { deviceTime, serverTime,
   * driftSeconds } — an operator sets the shift split relative to this clock.
   */
  async verifyTime(machine) {
    const { device } = await connectDevice(machine)
    try {
      const deviceText = toDeviceDate(await device.getTime())
      if (!deviceText) return { deviceTime: null, driftSeconds: null }
      const deviceParts = parseTimestamp(deviceText)
      const now = new Date()
      const server = {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds()
      }
      const toEpoch = (parts) => new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)).getTime()
      return {
        deviceTime: deviceText,
        serverTime: formatTimestamp(server),
        driftSeconds: Math.round((toEpoch(deviceParts) - toEpoch(server)) / 1000)
      }
    } finally {
      await device.disconnect().catch(() => {})
    }
  }
}

module.exports = {
  checksum,
  buildPacket,
  parseTimestamp,
  formatTimestamp,
  splitResultLines,
  runCommands,
  openSocket,
  exchange,
  zk,
  ZK_PORT
}
