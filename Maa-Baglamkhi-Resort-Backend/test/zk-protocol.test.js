// Plain-node regression suite for the ZK protocol + shift logic.
// Shape follows test/token-create-regression.test.js: raw checks, own
// expectations, process.exit(failed ? 1 : 0). No jest.
//
//   node test/zk-protocol.test.js
//
const zk = require("../src/services/zkProtocol");
const {
  parseLogLine,
  parseLogLines,
  resolveShiftDay,
  groupByShift,
} = require("../src/services/zkLogParser");

let passed = 0;
let failed = 0;

const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}: ${err.message}`);
  }
};

const eq = (a, b, label) => {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${label || "mismatch"}: ${ja} !== ${jb}`);
};

// ── checksum ────────────────────────────────────────────────────────────────
check("checksum('GETTIME') is a byte", () => {
  const c = zk.checksum("GETTIME");
  eq(typeof c, "number", "type");
  eq(c >= 0 && c <= 255, true, "range");
});

check("checksum is deterministic and ASCII-sum based", () => {
  eq(zk.checksum("ABC"), zk.checksum("ABC"), "repeat");
  eq(zk.checksum("ABC"), (65 + 66 + 67) & 0xFF, "manual sum");
});

check("buildPacket appends the checksum", () => {
  eq(zk.buildPacket("GETTIME"), `GETTIME${zk.checksum("GETTIME")}`, "shape");
  eq(
    zk.buildPacket("GETATTLOG", "2026-10-01 00:00:00", "2026-10-24 23:59:59"),
    `GETATTLOG,2026-10-01 00:00:00,2026-10-24 23:59:59${zk.checksum(
      "GETATTLOG,2026-10-01 00:00:00,2026-10-24 23:59:59"
    )}`,
    "full"
  );
});

// ── parseTimestamp ───────────────────────────────────────────────────────────
check("parseTimestamp handles a full timestamp", () => {
  eq(zk.parseTimestamp("2026-10-24 08:55:01"), {
    year: 2026, month: 10, day: 24, hour: 8, minute: 55, second: 1,
  });
});

check("parseTimestamp throws on garbage", () => {
  let threw = false;
  try { zk.parseTimestamp("garbage"); } catch { threw = true; }
  eq(threw, true, "must throw");
});

// ── splitResultLines ────────────────────────────────────────────────────────
check("splitResultLines strips ACK/NAK and keeps content lines", () => {
  const lines = zk.splitResultLines("ACK,GETTIME,2026-10-24 08:00:00\n1,2,3\nNAK,GETATTLOG\n");
  eq(lines, ["1,2,3"], "content only");
});

// ── log line parsing ─────────────────────────────────────────────────────────
check("parseLogLine reads the 64-char device line", () => {
  const line =
    "01,0000000003,1,0,133,2026-10-24 08:55:01,                      "
      .padEnd(64);
  const parsed = parseLogLine(line);
  eq(parsed.employeeId, "1", "device id");
  eq(parsed.date, "2026-10-24", "date");
  eq(parsed.time, "08:55:01", "time");
  eq(parsed.hour, 8, "hour");
});

check("parseLogLine drops leading zeros from the device id", () => {
  const line =
    "00000000042,0000000007,1,0,0,2026-10-24 19:01:00,".padEnd(64);
  eq(parseLogLine(line).employeeId, "42");
});

check("parseLogLine skips blank padding lines", () => {
  eq(parseLogLine("   "), null);
  eq(parseLogLine(""), null);
});

check("parseLogLine throws on a truncated line", () => {
  let threw = false;
  try { parseLogLine("01,0000000003,1,0"); } catch { threw = true; }
  eq(threw, true, "must throw");
});

check("parseLogLines skips blanks and returns records", () => {
  const lines = [
    "01,0000000003,1,0,133,2026-10-24 08:55:01".padEnd(64),
    "",
    "02,0000000007,1,0,133,2026-10-24 20:15:09".padEnd(64),
  ];
  eq(parseLogLines(lines).length, 2, "two records");
});

// ── shift day resolution ────────────────────────────────────────────────────
const shifts = { dayStart: "09:00", dayEnd: "18:00" };

check("punch at 08:59 reports the previous day (night)", () => {
  eq(resolveShiftDay({ date: "2026-10-24", hour: 8, minute: 59 }, shifts), {
    shiftDay: "2026-10-23", shift: "night",
  });
});

check("punch at 09:00 starts the day shift of the same day", () => {
  eq(resolveShiftDay({ date: "2026-10-24", hour: 9, minute: 0 }, shifts), {
    shiftDay: "2026-10-24", shift: "day",
  });
});

check("punch at 17:59 is the last day-shift minute", () => {
  eq(resolveShiftDay({ date: "2026-10-24", hour: 17, minute: 59 }, shifts), {
    shiftDay: "2026-10-24", shift: "day",
  });
});

check("punch at 18:00 starts the night shift of the same day", () => {
  eq(resolveShiftDay({ date: "2026-10-24", hour: 18, minute: 0 }, shifts), {
    shiftDay: "2026-10-24", shift: "night",
  });
});

check("punch at 06:30 on the 1st of a month crosses back into the prior month", () => {
  eq(resolveShiftDay({ date: "2026-11-01", hour: 6, minute: 30 }, shifts), {
    shiftDay: "2026-10-31", shift: "night",
  });
});

// ── shift grouping ──────────────────────────────────────────────────────────
check("groupByShift merges in/out of one shift window", () => {
  const lines = [
    "01,0000000003,1,0,0,2026-10-24 08:55:01".padEnd(64), // night of 23rd
    "01,0000000003,1,0,0,2026-10-24 17:30:00".padEnd(64), // day of 24th
  ];
  const groups = groupByShift(parseLogLines(lines), shifts);
  eq(groups.length, 2, "two shift days");
  // lone punch (first ≈ last, <60s gap) → checkOut nulled by the single-touch
  // guard, so a one-finger day is NOT closed the instant it opens.
  eq(groups[0], {
    employeeId: "1", shiftDay: "2026-10-23", shift: "night",
    punches: 1, checkIn: "08:55:01", checkOut: null,
    firstTime: "2026-10-24 08:55:01", lastTime: "2026-10-24 08:55:01",
  });
  eq(groups[1].shiftDay, "2026-10-24", "second group day");
  eq(groups[1].checkIn, "17:30:00");
});

check("groupByShift keeps the earliest in and latest out of a day", () => {
  const lines = [
    "02,0000000007,1,0,0,2026-10-24 10:15:00".padEnd(64),
    "02,0000000007,1,0,0,2026-10-24 12:00:00".padEnd(64),
    "02,0000000007,1,0,0,2026-10-24 18:45:00".padEnd(64), // night
    "02,0000000007,1,0,0,2026-10-24 16:00:00".padEnd(64),
  ];
  const groups = groupByShift(parseLogLines(lines), shifts);
  const day = groups.find((g) => g.shift === "day");
  const night = groups.find((g) => g.shift === "night");
  eq(day.checkIn, "10:15:00", "earliest in");
  eq(day.checkOut, "16:00:00", "latest out");
  eq(night.checkIn, "18:45:00", "night start");
  eq(night.shiftDay, "2026-10-24", "night owns 24th");
});

console.log(`\nzk-protocol: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
