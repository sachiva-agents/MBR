/**
 * Pay-rules tests.
 *
 * `getPayPercentages()` in settingsController is the single source both the
 * salary and attendance calculators now read from, so these tests pin down
 * its contract: it returns fractions of the full daily wage, clamped 0..1,
 * and falls back to safe defaults when the settings row is missing columns
 * or the DB is unreachable.
 *
 * We mock the DB pool (../config/db) so no real MySQL is needed.
 */

jest.mock("../src/config/db", () => {
  // Mutable so each test can set what the "SELECT * FROM app_settings" returns.
  global.__appSettingsRow = null;
  global.__dbShouldThrow = false;

  const makeQuery = () => (sql, params) => {
    if (global.__dbShouldThrow) {
      return Promise.reject(new Error("db down"));
    }
    const s = String(sql || "");
    // The single data read in getSettings.
    if (/FROM app_settings/i.test(s) && /SELECT/i.test(s)) {
      return Promise.resolve([[global.__appSettingsRow], []]);
    }
    // information_schema column-existence checks and CREATE/INSERT: shape-agnostic.
    if (/information_schema/i.test(s)) {
      return Promise.resolve([[{ c: 1 }], []]);
    }
    return Promise.resolve([[], []]);
  };

  let query = makeQuery();
  let execute = makeQuery();

  return {
    __setQuery: (fn) => {
      query = fn;
      execute = fn;
    },
    query,
    execute,
  };
});

const db = require("../src/config/db");
const settingsController = require("../src/controller/settingsController");

const setRow = (row) => {
  global.__appSettingsRow = row;
  global.__dbShouldThrow = false;
};

describe("getPayPercentages", () => {
  beforeEach(async () => {
    // Drop any cached value so each case re-reads the (mocked) DB.
    if (settingsController.__resetPayPctCache) settingsController.__resetPayPctCache();
  });

  test("maps stored percent columns to 0..1 fractions", async () => {
    setRow({
      present_pay: 100,
      late_pay: 90,
      half_day_pay: 50,
      absent_pay: 0,
      leave_pay: 25,
    });
    const p = await settingsController.getPayPercentages();
    expect(p).toMatchObject({
      present: 1,
      late: 0.9,
      half_day: 0.5,
      absent: 0,
      on_leave: 0.25,
    });
    // Non-configurable statuses always pay full.
    expect(p.holiday).toBe(1);
    expect(p.week_off).toBe(1);
  });

  test("clamps out-of-range values into 0..100 before scaling", async () => {
    setRow({ present_pay: 150, late_pay: -20, half_day_pay: 40, absent_pay: 300, leave_pay: 5 });
    const p = await settingsController.getPayPercentages();
    expect(p.present).toBe(1); // 150 -> 100 -> 1.0
    expect(p.late).toBe(0); // -20 -> 0
    expect(p.absent).toBe(1); // 300 -> 100 -> 1.0
    expect(p.half_day).toBe(0.4);
    expect(p.on_leave).toBe(0.05);
  });

  test("missing columns fall back to the documented defaults", async () => {
    setRow({}); // no pay columns at all (legacy row before migration)
    const p = await settingsController.getPayPercentages();
    expect(p.present).toBe(1);
    expect(p.late).toBe(0.5);
    expect(p.half_day).toBe(0.5);
    expect(p.absent).toBe(0);
    expect(p.on_leave).toBe(0);
  });

  test("DB unreachable returns safe defaults, not a throw", async () => {
    global.__dbShouldThrow = true;
    global.__appSettingsRow = null;
    const p = await settingsController.getPayPercentages();
    expect(p.present).toBe(1);
    expect(p.absent).toBe(0);
    expect(p.holiday).toBe(1);
  });
});
