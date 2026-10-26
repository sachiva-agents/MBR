// Throwaway E2E check against the scratch backend on :5099 (new code, same DB).
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
  const login = await j("POST", "/api/auth/login", {
    body: { email: "admin@resort.com", password: "password" },
  });
  const token = login.data.token;
  if (!token) {
    console.log("LOGIN FAILED", login.status, JSON.stringify(login.data));
    process.exit(1);
  }
  console.log("1. login OK, role:", login.data.role);

  const before = await j("GET", "/api/settings", { token });
  const p = before.data;
  console.log("2. GET settings pay keys:", JSON.stringify({
    presentPay: p.presentPay, latePay: p.latePay, halfDayPay: p.halfDayPay,
    absentPay: p.absentPay, leavePay: p.leavePay,
  }));

  const put = await j("PUT", "/api/settings", {
    token,
    body: { latePay: p.latePay ?? 90 }, // restore/echo the original (idempotent)
  });
  console.log("3. PUT settings OK:", put.status, "latePay now:", put.data.settings?.latePay);

  const after = await j("GET", "/api/settings", { token });
  console.log("4. GET after PUT latePay:", after.data.latePay, "(should equal PUT value)");

  const unauth = await j("PUT", "/api/settings", { body: { latePay: 1 } });
  console.log("5. unauth PUT blocked:", unauth.status, JSON.stringify(unauth.data));
})();
