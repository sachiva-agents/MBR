// Controlled round-trip: prove the salary calculators follow app_settings.
// Changes latePay 50 -> 25, verifies a live calculation shifts, restores 50.
const BASE = "http://127.0.0.1:5099";

async function j(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  const token = (await j("POST", "/api/auth/login", {
    body: { email: "admin@resort.com", password: "password" },
  })).data.token;

  const month = new Date().toISOString().slice(0, 7);

  // Snapshot with current rules (latePay=50).
  const before = await j("GET", `/api/attendance/payroll?month=${month}`, { token });
  const lateCountBefore = before.data.employees.filter((e) => e.totals.late > 0).length;
  const earnedBefore = before.data.summary.totalEarned;
  console.log(`month ${month}: employees=${before.data.employees.length}, ` +
    `employees with late days=${lateCountBefore}, totalEarned=${earnedBefore}`);

  await j("PUT", "/api/settings", { token, body: { latePay: 25 } });
  const changed = await j("GET", `/api/attendance/payroll?month=${month}`, { token });
  const earnedChanged = changed.data.summary.totalEarned;
  console.log(`with latePay=25: totalEarned=${earnedChanged}`);
  console.log(`shift: ${earnedChanged < earnedBefore ? "earned DROPPED (rule applied) " : "earned unchanged "}${
    earnedChanged !== earnedBefore ? `(Δ ${(earnedBefore - earnedChanged).toFixed(2)})` : ""}`);

  // Restore.
  const restore = await j("PUT", "/api/settings", { token, body: { latePay: 50 } });
  const after = await j("GET", `/api/attendance/payroll?month=${month}`, { token });
  console.log(`restored latePay=${restore.data.settings.latePay}, totalEarned=${after.data.summary.totalEarned} (== original: ${after.data.summary.totalEarned === earnedBefore})`);
})();
