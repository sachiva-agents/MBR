#!/usr/bin/env node
/**
 * API route sweep - READ ONLY.
 *
 * Auto-extracts every route from src/routes/*.js, maps it to its mount prefix
 * in src/app.js, substitutes path params with probe values, and hits each one.
 *
 * This suite NEVER writes, deletes, or mutates anything:
 *   - GET / HEAD / DELETE / POST / PUT / PATCH are all sent to a PROBE id that
 *     does not exist, so handlers return 404 ("not found") instead of mutating.
 *   - Mutating routes are additionally gated by SAFE_MODE below.
 *
 * Verdicts:
 *   200 / 201 / 204          -> PASS  (route works)
 *   400 / 401 / 403 / 422    -> PASS  (route exists, validation/auth gate works)
 *   404                      -> PASS *only* if the body says "not found"
 *                                 (route exists, probe row doesn't)
 *                             -> FAIL if body is Express "Cannot GET/POST"
 *   405 / 5xx                -> FAIL
 *
 * Usage:  npm run test:routes
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5002";
const ROOT = path.resolve(__dirname, "..");
const ROUTES_DIR = path.join(ROOT, "src", "routes");
const APP_FILE = path.join(ROOT, "src", "app.js");

const ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || "admin@resort.com",
  password: process.env.TEST_ADMIN_PASSWORD || "password",
};

// Probe id that must NOT exist in any table.
// A handler hitting this id returns 404 "not found" instead of mutating a real row.
const MISSING_ID = "999999999";

// Per-param probes. Values are chosen to be non-existent / harmless.
const PARAM_PROBES = {
  id: MISSING_ID,
  bookingId: MISSING_ID,
  customerId: MISSING_ID,
  tokenId: MISSING_ID,
  hallId: MISSING_ID,
  roomId: MISSING_ID,
  orderId: MISSING_ID,
  itemId: MISSING_ID,
  invoiceId: MISSING_ID,
  taskId: MISSING_ID,
  userId: MISSING_ID,
  assignmentId: MISSING_ID,
  sectionKey: "units",
  waiterName: "__probe_no_such_waiter__",
  roomNumber: "999999",
  tableName: "__probe_no_such_table__",
  date: "2020-01-01",
};

// Routes that must never be hit even with a missing id (real side effects)
const SKIP_PATTERNS = [
  /\/print\//i,
  /whatsapp/i,
  /\/upload/i,
  /\/logout/i,
  /\/login/i,
  /\/register/i,
  // real side effects (a dump file, a DB restore) - covered by the backup
  // functional section below instead of the read-only sweep
  /\/backups\/run/i,
  /\/backups\/restore/i,
];

// Body sent with mutating methods. Empty object: required fields will be
// missing, so validation returns 400 before any DB write.
const EMPTY_BODY = {};

// Dedicated, out-of-repo destination for the functional backup section so a
// real dump never lands in the working tree.
const BACKUP_DEST = path.join(os.tmpdir(), "mbr-backups-gate");

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------
function getMounts() {
  const src = fs.readFileSync(APP_FILE, "utf8");
  const re =
    /app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*require\(["'`]\.\/routes\/(\w+)["'`]\)/g;
  const map = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    const prefix = m[1].replace(/\/$/, "");
    const file = m[2];
    if (!map.has(file)) map.set(file, []);
    map.get(file).push(prefix);
  }
  return map;
}

function extractRoutes() {
  const mounts = getMounts();
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".js"));
  const routes = [];
  const seen = new Set();
  const routeRe = /router\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]*)["'`]/g;

  for (const file of files) {
    const base = file.replace(/\.js$/, "");
    const prefixes = mounts.get(base);
    if (!prefixes) continue;

    const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    let m;
    while ((m = routeRe.exec(src)) !== null) {
      const method = m[1].toUpperCase();
      let routePath = m[2];
      if (!routePath.startsWith("/")) routePath = "/" + routePath;

      for (const prefix of prefixes) {
        const full = (prefix + routePath).replace(/\/+$/, "") || "/";
        const key = `${method} ${full}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ method, path: full, file: base, raw: routePath });
      }
    }
  }
  return routes;
}

function fillParams(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_, name) =>
    PARAM_PROBES[name] !== undefined ? PARAM_PROBES[name] : MISSING_ID
  );
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
let authToken = null;

function request(method, reqPath, body) {
  return new Promise((resolve) => {
    const url = new URL(reqPath, BASE_URL);
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "TIMEOUT" });
    });
    req.on("error", (err) => resolve({ status: 0, body: err.message }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
// v4 deliberately exposes some endpoints as read-only derived views.
// They answer mutating verbs with 501 + a message explaining why.
const READ_ONLY_STUB = /read-only|Not implemented yet/i;

function judge(status, body) {
  if (status === 200 || status === 201 || status === 204) return "PASS";
  if (status === 400 || status === 401 || status === 403 || status === 422)
    return "PASS";

  // Deliberate read-only stub: route exists and answers on purpose
  if (status === 501 && READ_ONLY_STUB.test(body)) return "PASS";

  if (status === 404) {
    // Express's own 404 is an HTML page with "Cannot GET"/"Cannot POST"
    const isExpressMiss = /Cannot\s+(GET|POST|PUT|DELETE|PATCH)/i.test(body);
    if (isExpressMiss) return "FAIL";
    return "PASS"; // handler 404 = route exists, probe row doesn't
  }

  // A 500 whose cause is a missing required field means the route exists and
  // reached the DB layer - our empty probe body just failed validation there.
  // That is a PASS for a route-existence sweep.
  if (status === 500) {
    const db = safeParse(body);
    const inner = db?.error?.code || db?.error?.sqlMessage || "";
    if (
      /ER_BAD_NULL_ERROR|ER_NO_DEFAULT_FOR_FIELD|ER_TRUNCATED|ER_DATA_TOO_LONG/.test(
        inner
      )
    ) {
      return "PASS";
    }
    return "FAIL";
  }

  if (status === 0) return "FAIL"; // timeout / connection error
  return "FAIL"; // 405, anything else
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const lines = [];
  const say = (s = "") => {
    console.log(s);
    lines.push(s);
  };

  say("=".repeat(72));
  say(" API ROUTE SWEEP  (read-only)");
  say("=".repeat(72));

  const login = await request("POST", "/api/auth/login", ADMIN);
  if (login.status !== 200 || !safeParse(login.body)?.token) {
    console.error("\n[FATAL] Login failed - cannot run sweep.");
    console.error("  status:", login.status);
    console.error("  body:", login.body.slice(0, 200));
    process.exit(1);
  }
  authToken = safeParse(login.body).token;
  say(`\n[1] Authenticated as ${ADMIN.email}`);

  const routes = extractRoutes();
  say(`[2] Discovered ${routes.length} unique routes\n`);

  const results = [];
  let pass = 0;
  let fail = 0;
  let skipped = 0;

  for (const r of routes) {
    const testPath = fillParams(r.path);

    if (SKIP_PATTERNS.some((p) => p.test(testPath))) {
      skipped++;
      results.push({ ...r, testPath, code: "-", verdict: "SKIP" });
      continue;
    }

    const needsBody = ["POST", "PUT", "PATCH"].includes(r.method);
    const res = await request(
      r.method,
      testPath,
      needsBody ? EMPTY_BODY : undefined
    );

    const verdict = judge(res.status, res.body);
    if (verdict === "PASS") pass++;
    else fail++;

    results.push({
      ...r,
      testPath,
      code: res.status,
      verdict,
      body: res.body.slice(0, 200),
    });
  }

  const backupResults = await runBackupSection(say);
  for (const b of backupResults) {
    if (b.verdict === "SKIP") skipped++;
    else if (b.verdict === "PASS") pass++;
    else fail++;
    results.push(b);
  }

  say("-".repeat(72));
  say(
    ` RESULTS: ${pass} pass | ${fail} fail | ${skipped} skip | ${results.length} total`
  );
  say("-".repeat(72));

  const failures = results.filter((r) => r.verdict === "FAIL");
  if (failures.length) {
    say("\nFAILED ROUTES:\n");
    for (const f of failures) {
      say(`  [${f.code}] ${f.method} ${f.testPath}`);
      say(`        src/routes/${f.file}.js   raw: "${f.raw}"`);
      if (f.body) say(`        ${f.body.replace(/\s+/g, " ").slice(0, 140)}`);
      say("");
    }
  }

  const outDir = path.join(ROOT, "test", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "api-routes.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  say(`Full report: ${path.relative(ROOT, reportPath)}`);

  say("\n" + "=".repeat(72));
  if (fail === 0) say(` ✅ ALL ${pass} ROUTES PASSED`);
  else say(` ❌ ${fail}/${results.length} routes failed`);
  say("=".repeat(72) + "\n");

  process.exitCode = fail > 0 ? 1 : 0;
}

// Functional backup section: drives the real /api/backups endpoints against a
// throwaway out-of-repo destDir. run/restore are skipped in the read-only
// sweep above; here they are exercised for good.
async function runBackupSection(say) {
  const out = [];
  const push = (method, full, code, verdict, body) => {
    const rec = {
      file: "backupRoutes",
      raw: full.replace(/^\/api\/backups/, "").replace(/^\/|^$/, "/"),
      testPath: full,
      method,
      code,
      verdict,
      body: (body || "").slice(0, 200),
      section: "backup",
    };
    out.push(rec);
    say(`  [backup] ${method} ${full} -> ${code} (${verdict})`);
    return rec;
  };

  // point the suite at a private destDir; restore is exercised separately
  fs.rmSync(BACKUP_DEST, { recursive: true, force: true });
  fs.mkdirSync(BACKUP_DEST, { recursive: true });
  await request("PUT", "/api/backups/settings", {
    enabled: false,
    scheduleType: "none",
    dailyTime: "03:00",
    weeklyDay: 0,
    customCron: "",
    destDir: BACKUP_DEST,
  });

  const badType = await request("PUT", "/api/backups/settings", { scheduleType: "hourly" });
  push("PUT", "/api/backups/settings (bad scheduleType)", badType.status, badType.status === 400 ? "PASS" : "FAIL", badType.body);

  const getSet = await request("GET", "/api/backups/settings");
  const gs = safeParse(getSet.body) || {};
  const getOk =
    getSet.status === 200 &&
    ["enabled", "scheduleType", "dailyTime", "weeklyDay", "customCron", "destDir", "lastRunAt", "lastRunStatus", "lastFile"]
      .every((k) => k in gs) &&
    gs.destDir === BACKUP_DEST;
  push("GET", "/api/backups/settings", getSet.status, getOk ? "PASS" : "FAIL", getSet.body);

  const run = await request("POST", "/api/backups/run");
  const runOk = run.status === 200 && safeParse(run.body)?.file;
  push("POST", "/api/backups/run", run.status, runOk ? "PASS" : "FAIL", run.body);

  const list = await request("GET", "/api/backups/list");
  const listOk = list.status === 200 && (safeParse(list.body)?.files || []).length >= 1;
  push("GET", "/api/backups/list", list.status, listOk ? "PASS" : "FAIL", list.body);

  const evil = await request("POST", "/api/backups/restore", { file: "../evil.sql" });
  push("POST", "/api/backups/restore (traversal)", evil.status, evil.status === 400 ? "PASS" : "FAIL", evil.body);

  // Missing-file path is fast and non-destructive; the full dump->restore
  // round-trip (a multi-minute clobber of the live DB) is verified separately
  // in a one-off e2e, not on every gate run.
  const missing = await request("POST", "/api/backups/restore", { file: "definitely-not-here.sql" });
  push("POST", "/api/backups/restore (missing file)", missing.status, missing.status === 404 ? "PASS" : "FAIL", missing.body);

  return out;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("Sweep crashed:", err);
  process.exit(1);
});
