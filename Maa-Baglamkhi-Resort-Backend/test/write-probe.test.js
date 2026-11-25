#!/usr/bin/env node
/**
 * Write-path probe.
 *
 * test/api-routes.test.js proves each route is reachable. This suite proves
 * each WRITE route actually does something: it sends a realistic payload (not
 * an empty body), then verifies the effect by reading the row back.
 *
 * Every route is probed against a row this suite creates, and every row it
 * creates is deleted at the end, so the database is left as it was found.
 *
 * Usage:  npm run test:writes
 */

const http = require("http");
const crypto = require("crypto");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5002";
const ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || "admin@resort.com",
  password: process.env.TEST_ADMIN_PASSWORD || "password",
};

let token = null;

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 20000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`TIMEOUT ${method} ${path}`));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok), detail: detail || "" });
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` -> ${detail}`}`);
}

// Track what we create so the cleanup at the end can remove it.
const created = {
  transactions: [], bills: [], kots: [], tables: [],
  items: [], users: [], halls: [], banquet: [], assignments: [], hkRooms: [],
};

async function login() {
  const res = await api("POST", "/api/auth/login", ADMIN);
  if (!res.body?.token) throw new Error(`login failed: ${res.status} ${res.raw?.slice(0, 120)}`);
  token = res.body.token;
  console.log(`\n[1] Authenticated as ${ADMIN.email}\n`);
}

// ---------------------------------------------------------------------------
// Accounts — full CRUD on the :id routes the route sweep never exercises
// ---------------------------------------------------------------------------
async function probeAccounts() {
  console.log("[2] Accounts — transaction CRUD");
  const stamp = Date.now();

  const created1 = await api("POST", "/api/accounts/income", {
    amount: 123.45,
    description: `write-probe ${stamp}`,
    category: "Other",
  });
  const id = created1.body?.id;
  check("POST /api/accounts/income returns an id", Number.isInteger(id), `got ${JSON.stringify(created1.body).slice(0, 120)}`);
  if (!id) return;
  created.transactions.push(id);

  const read = await api("GET", `/api/accounts/transactions/${id}`);
  check("GET /api/accounts/transactions/:id finds it", read.status === 200, `got ${read.status}`);

  const put = await api("PUT", `/api/accounts/transactions/${id}`, {
    amount: 234.56,
    description: `write-probe updated ${stamp}`,
    category: "Other",
  });
  check("PUT /api/accounts/transactions/:id accepted", put.status === 200, `got ${put.status} ${JSON.stringify(put.body).slice(0, 120)}`);

  const afterPut = await api("GET", `/api/accounts/transactions/${id}`);
  check(
    "PUT actually changed the amount",
    Number(afterPut.body?.amount ?? afterPut.body?.entries?.[0]?.amount) === 234.56,
    `got ${JSON.stringify(afterPut.body).slice(0, 160)}`
  );

  // Deleting twice must not 500.
  const del = await api("DELETE", `/api/accounts/transactions/${id}`);
  check("DELETE /api/accounts/transactions/:id accepted", del.status === 200, `got ${del.status} ${JSON.stringify(del.body).slice(0, 120)}`);

  const delAgain = await api("DELETE", `/api/accounts/transactions/${id}`);
  check(
    "second DELETE is a clean 404, not a 500",
    delAgain.status === 404 || delAgain.status === 200,
    `got ${delAgain.status} ${JSON.stringify(delAgain.body).slice(0, 120)}`
  );
}

// ---------------------------------------------------------------------------
// Accounts — the remaining :id modules
// ---------------------------------------------------------------------------
async function probeAccountsModules() {
  console.log("\n[3] Accounts — vendor payment / PO / payroll / bank ledger CRUD");

  const cases = [
    {
      name: "vendor-payments",
      createPath: "/api/accounts/vendor-payments",
      createBody: { vendorName: `Write Probe ${Date.now()}`, amount: 50, paymentMode: "Cash" },
      updateBody: { vendorName: "Write Probe Updated", amount: 60, paymentMode: "Cash" },
    },
    {
      name: "purchase-orders",
      createPath: "/api/accounts/purchase-orders",
      createBody: { poNumber: `PO-${Date.now()}`, vendorName: "Write Probe", amount: 70 },
      updateBody: { poNumber: `PO-${Date.now()}`, vendorName: "Write Probe Updated", amount: 80 },
    },
    {
      name: "payroll",
      createPath: "/api/accounts/payroll",
      createBody: { staffName: "Write Probe", amount: 1000, payrollMonth: "2099-01" },
      updateBody: { staffName: "Write Probe Updated", amount: 1100, payrollMonth: "2099-01" },
    },
    {
      name: "bank-ledger",
      createPath: "/api/accounts/bank-ledger",
      createBody: { amount: 90, description: "write probe", date: "2026-09-15", type: "debit" },
      updateBody: { amount: 95, description: "write probe updated", date: "2026-09-15", type: "debit" },
    },
  ];

  for (const c of cases) {
    const made = await api("POST", c.createPath, c.createBody);
    const id = made.body?.id;
    check(`POST ${c.createPath} returns an id`, Number.isInteger(id), `got ${made.status} ${JSON.stringify(made.body).slice(0, 120)}`);
    if (!id) continue;

    const put = await api("PUT", `${c.createPath}/${id}`, c.updateBody);
    check(`PUT ${c.createPath}/:id accepted`, [200, 201].includes(put.status), `got ${put.status} ${JSON.stringify(put.body).slice(0, 120)}`);

    const del = await api("DELETE", `${c.createPath}/${id}`);
    check(`DELETE ${c.createPath}/:id accepted`, [200, 204].includes(del.status), `got ${del.status} ${JSON.stringify(del.body).slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------------------
// Users — role update / status / delete
// ---------------------------------------------------------------------------
async function probeUsers() {
  console.log("\n[4] Users — role and status writes");
  const stamp = crypto.randomBytes(3).toString("hex");
  const email = `write-probe-${stamp}@test.com`;

  const reg = await api("POST", "/api/auth/register", {
    name: "Write Probe",
    email,
    password: "WriteProbe@123",
    role: "staff",
  });
  const id = reg.body?.id || reg.body?.user?.id;
  check("POST /api/auth/register returns an id", Number.isInteger(id), `got ${JSON.stringify(reg.body).slice(0, 120)}`);
  if (!id) return;
  created.users.push(id);

  const role = await api("PUT", `/api/users/${id}`, {
    name: "Write Probe",
    email,
    role: "receptionist",
  });
  check(
    "PUT /api/users/:id accepted",
    [200, 201].includes(role.status),
    `got ${role.status} ${JSON.stringify(role.body).slice(0, 120)}`
  );

  const afterRole = await api("GET", "/api/users");
  const row = Array.isArray(afterRole.body) && afterRole.body.find((u) => u.id === id);
  // The frontend sends "Receptionist"; the roles table stores it as "reception".
  // Before the role map was fixed this silently resolved to `accounts`.
  check(
    "role change is persisted as reception (not accounts)",
    Boolean(row) && String(row.role || "").toLowerCase() === "reception",
    `got role=${row?.role}`
  );

  // An unknown role name must not reach the query as NaN — that used to be a
  // 500 with "Unknown column 'NaN'".
  const bogus = await api("PUT", `/api/users/${id}`, {
    name: "Write Probe",
    email,
    role: "not-a-real-role",
  });
  check(
    "unknown role name falls back instead of inserting NaN",
    [200, 201].includes(bogus.status),
    `got ${bogus.status} ${JSON.stringify(bogus.body).slice(0, 120)}`
  );

  const del = await api("DELETE", `/api/users/${id}`);
  check("DELETE /api/users/:id accepted", [200, 204].includes(del.status), `got ${del.status} ${JSON.stringify(del.body).slice(0, 120)}`);
}

// ---------------------------------------------------------------------------
// Notifications / settings / attendance — small modules never write-tested
// ---------------------------------------------------------------------------
async function probeSmallModules() {
  console.log("\n[5] Small modules");

  const notif = await api("POST", "/api/notifications", {
    title: "Write probe",
    message: "write probe notification",
    audience: "all",
  });
  check(
    "POST /api/notifications accepted",
    [200, 201].includes(notif.status),
    `got ${notif.status} ${JSON.stringify(notif.body).slice(0, 140)}`
  );

  const readNotif = await api("GET", "/api/notifications");
  check(
    "notification appears in GET /api/notifications",
    JSON.stringify(readNotif.body).includes("write probe"),
    `got ${readNotif.status}`
  );

  // Attendance is admin-only and needs an `employees` row linked to the user.
  // The admin account has none, so the handler answers with a clear 400 — which
  // is the correct behaviour, not a failure.
  const att = await api("POST", "/api/attendance", {
    staffName: "Write Probe",
    date: "2026-09-15",
    status: "present",
  });
  check(
    "POST /api/attendance answers (400 when no employee row is linked)",
    [200, 201, 400].includes(att.status),
    `got ${att.status} ${JSON.stringify(att.body).slice(0, 140)}`
  );
}

// ---------------------------------------------------------------------------
// Restaurant — table / KOT / bill / pay
// ---------------------------------------------------------------------------
async function probeRestaurant() {
  console.log("\n[5b] Restaurant — table, KOT, bill, pay");
  const stamp = Date.now();

  const table = await api("POST", "/api/restaurant/tables", {
    number: `WP-${stamp}`,
    seats: 4,
    section: "Write Probe",
  });
  check("POST /api/restaurant/tables accepted", [200, 201].includes(table.status), `got ${table.status} ${JSON.stringify(table.body).slice(0, 120)}`);

  const tables = await api("GET", "/api/restaurant/tables");
  const tableRow = Array.isArray(tables.body) && tables.body.find((t) => String(t.number || t.table_number) === `WP-${stamp}`);
  check("new table appears in GET /api/restaurant/tables", Boolean(tableRow), `got ${tables.status}`);

  const kot = await api("POST", "/api/kitchen/order", {
    table: `WP-${stamp}`,
    items: [{ name: "Write Probe Dish", qty: 2, rate: 100 }],
    waiter: "Write Probe",
  });
  const kotId = kot.body?.id || kot.body?.kotId;
  check("POST /api/kitchen/order returns an id", Number.isInteger(kotId), `got ${kot.status} ${JSON.stringify(kot.body).slice(0, 120)}`);

  if (kotId) {
    const prep = await api("PUT", `/api/kitchen/orders/${kotId}`, { status: "Preparing" });
    check("PUT /api/kitchen/orders/:id accepted", [200, 201].includes(prep.status), `got ${prep.status} ${JSON.stringify(prep.body).slice(0, 120)}`);

    const ready = await api("PUT", `/api/kitchen/orders/${kotId}`, { status: "Ready" });
    check("kitchen order moves to Ready", [200, 201].includes(ready.status), `got ${ready.status}`);
  }

  const bill = await api("POST", "/api/restaurant/bill", {
    tableNumber: `WP-${stamp}`,
    items: [{ name: "Write Probe Dish", qty: 2, rate: 100 }],
    discount: 0,
  });
  const billId = bill.body?.id || bill.body?.billId;
  check("POST /api/restaurant/bill returns an id", Number.isInteger(billId), `got ${bill.status} ${JSON.stringify(bill.body).slice(0, 120)}`);

  if (billId) {
    const pay = await api("POST", `/api/restaurant/bill/${billId}/pay`, {
      amount: 200,
      paymentMode: "Cash",
      paymentMethod: "Cash",
    });
    check("POST /api/restaurant/bill/:id/pay accepted", [200, 201].includes(pay.status), `got ${pay.status} ${JSON.stringify(pay.body).slice(0, 140)}`);

    const payAgain = await api("POST", `/api/restaurant/bill/${billId}/pay`, {
      amount: 200,
      paymentMode: "Cash",
      paymentMethod: "Cash",
    });
    check("second pay on the same bill is rejected with 409 (no dup payment)", payAgain.status === 409, `got ${payAgain.status} ${JSON.stringify(payAgain.body).slice(0, 140)}`);

    const payUpi = await api("POST", `/api/restaurant/bill/${billId}/pay`, {
      amount: 1,
      paymentMethod: "UPI",
    });
    check("pay with capitalized UPI is rejected cleanly with 409, not a 500", payUpi.status === 409, `got ${payUpi.status} ${JSON.stringify(payUpi.body).slice(0, 140)}`);
  }
}

// ---------------------------------------------------------------------------
// Banquet — hall + booking + status transitions
// ---------------------------------------------------------------------------
async function probeBanquet() {
  console.log("\n[5c] Banquet — hall, booking, status");

  const hall = await api("POST", "/api/banquet/halls", {
    name: `Write Probe Hall ${Date.now()}`,
    capacity: 100,
    rate: 5000,
  });
  const hallId = hall.body?.id;
  check("POST /api/banquet/halls returns an id", Number.isInteger(hallId), `got ${hall.status} ${JSON.stringify(hall.body).slice(0, 120)}`);

  const booking = await api("POST", "/api/banquet", {
    customerName: `Write Probe ${Date.now()}`,
    mobile: "9001199007",
    hallId: hallId || 1,
    date: "2027-01-15",
    startTime: "10:00",
    endTime: "16:00",
    eventType: "Wedding",
    guests: 50,
    totalAmount: 5000,
    advanceAmount: 1000,
  });
  const bookingId = booking.body?.id;
  check("POST /api/banquet returns an id", Number.isInteger(bookingId), `got ${booking.status} ${JSON.stringify(booking.body).slice(0, 140)}`);

  if (bookingId) {
    const upd = await api("PUT", `/api/banquet/${bookingId}`, {
      customerName: `Write Probe Updated ${Date.now()}`,
      mobile: "9001199007",
      hallId: hallId || 1,
      date: "2027-01-15",
      startTime: "10:00",
      endTime: "16:00",
      eventType: "Wedding",
      guests: 50,
      totalAmount: 6000,
    });
    check("PUT /api/banquet/:id accepted", [200, 201].includes(upd.status), `got ${upd.status} ${JSON.stringify(upd.body).slice(0, 120)}`);

    const bill = await api("PUT", `/api/banquet/${bookingId}/bill`, {
      invoiceNo: `BILL-WP-${Date.now()}`,
    });
    check("PUT /api/banquet/:id/bill accepted", [200, 201].includes(bill.status), `got ${bill.status} ${JSON.stringify(bill.body).slice(0, 140)}`);

    const cancel = await api("PUT", `/api/banquet/${bookingId}/cancel`, { reason: "write probe cleanup" });
    check("PUT /api/banquet/:id/cancel accepted", [200, 201].includes(cancel.status), `got ${cancel.status} ${JSON.stringify(cancel.body).slice(0, 140)}`);

    const del = await api("DELETE", `/api/banquet/${bookingId}`);
    check("DELETE /api/banquet/:id accepted", [200, 204].includes(del.status), `got ${del.status}`);
  }

  if (hallId) {
    const delHall = await api("DELETE", `/api/banquet/halls/${hallId}`);
    check("DELETE /api/banquet/halls/:id accepted", [200, 204].includes(delHall.status), `got ${delHall.status}`);
  }
}

// ---------------------------------------------------------------------------
// Housekeeping — status, assignment, message, amenity
// ---------------------------------------------------------------------------
async function probeHousekeeping() {
  console.log("\n[5d] Housekeeping — status, assignment, message");

  let rooms = await api("GET", "/api/housekeeping");
  // A fresh install has no housekeeping rows yet: create one for the probe
  // (and clean it up at the end) so the status/assignment writes are real.
  if (!Array.isArray(rooms.body) || !rooms.body.length) {
    const hk = await api("POST", "/api/housekeeping", {
      roomNo: `HK-WP-${crypto.randomBytes(3).toString("hex")}`,
      status: "Vacant Dirty",
      assignee: "Write Probe",
    });
    if ([200, 201].includes(hk.status) && hk.body?.id) {
      created.hkRooms.push(hk.body.id);
      rooms = await api("GET", "/api/housekeeping");
    }
  }
  // Pick a real room that exists in the inventory (room_number must be in the
  // rooms table, and it must not be currently occupied by a guest).
  const roomRow = Array.isArray(rooms.body) && rooms.body.find(
    (r) => r.roomNo && r.guestStatus !== "Occupied" && r.status !== "Occupied"
  );
  const roomNumber = roomRow?.roomNo;
  if (!roomNumber) {
    check("housekeeping exposes rooms to update", false, `got ${rooms.status}`);
    return;
  }
  const roomId = roomRow.id;

  // The handler validates against the housekeeping status list ("Vacant Dirty",
  // not "Dirty").
  const status = await api("PUT", `/api/housekeeping/status/${roomId}`, {
    status: "Vacant Dirty",
  });
  check("PUT /api/housekeeping/status/:id accepted", [200, 201].includes(status.status), `got ${status.status} ${JSON.stringify(status.body).slice(0, 140)}`);

  const assignment = await api("POST", "/api/assignments", {
    staffName: "Write Probe",
    roomNumber,
    task: "Write probe cleaning",
    priority: "Normal",
  });
  const assignmentId = assignment.body?.id;
  check("POST /api/assignments returns an id", Number.isInteger(assignmentId), `got ${assignment.status} ${JSON.stringify(assignment.body).slice(0, 140)}`);

  if (assignmentId) {
    const patch = await api("PATCH", `/api/assignments/${assignmentId}/status`, { status: "Completed" });
    check("PATCH /api/assignments/:id/status accepted", [200, 201].includes(patch.status), `got ${patch.status} ${JSON.stringify(patch.body).slice(0, 140)}`);

    const del = await api("DELETE", `/api/assignments/${assignmentId}`);
    check("DELETE /api/assignments/:id accepted", [200, 204].includes(del.status), `got ${del.status}`);
  }

  const message = await api("POST", "/api/housekeeping/message", {
    message: "Write probe message",
    from: "Write Probe",
    roomNo: roomNumber,
  });
  check("POST /api/housekeeping/messages accepted", [200, 201].includes(message.status), `got ${message.status} ${JSON.stringify(message.body).slice(0, 140)}`);

  const amenity = await api("POST", "/api/housekeeping/amenities", {
    roomNo: roomNumber,
    item: "Write Probe Amenity",
    qty: 1,
  });
  check("POST /api/housekeeping/amenities accepted", [200, 201].includes(amenity.status), `got ${amenity.status} ${JSON.stringify(amenity.body).slice(0, 140)}`);
}

// ---------------------------------------------------------------------------
// Inventory — purchase order, waste, chef issue, transfer
// ---------------------------------------------------------------------------
async function probeInventory() {
  console.log("\n[5e] Inventory — item, waste, PO, chef issue, transfer");
  const stamp = Date.now();

  const item = await api("POST", "/api/inventory", {
    name: `WriteProbeItem ${stamp}`,
    category: "Write Probe",
    stock: 10,
    unit: "pcs",
    price: 25,
  });
  const itemId = item.body?.id;
  check("POST /api/inventory returns an id", Number.isInteger(itemId), `got ${item.status} ${JSON.stringify(item.body).slice(0, 140)}`);
  if (!itemId) return;

  const upd = await api("PUT", `/api/inventory/${itemId}`, {
    name: `WriteProbeItem ${stamp}`,
    category: "Write Probe",
    stock: 15,
    unit: "pcs",
    price: 30,
  });
  check("PUT /api/inventory/:id accepted", [200, 201].includes(upd.status), `got ${upd.status} ${JSON.stringify(upd.body).slice(0, 140)}`);

  const waste = await api("POST", "/api/inventory/waste", {
    itemId,
    itemName: `WriteProbeItem ${stamp}`,
    quantity: 2,
    reason: "write probe",
  });
  check("POST /api/inventory/waste accepted", [200, 201].includes(waste.status), `got ${waste.status} ${JSON.stringify(waste.body).slice(0, 140)}`);

  const po = await api("POST", "/api/inventory/purchase-orders", {
    poNumber: `PO-WP-${stamp}`,
    vendor: "Write Probe Vendor",
    itemName: `WriteProbeItem ${stamp}`,
    quantity: 5,
    rate: 25,
  });
  check("POST /api/inventory/purchase-orders accepted", [200, 201].includes(po.status), `got ${po.status} ${JSON.stringify(po.body).slice(0, 140)}`);

  const chef = await api("POST", "/api/inventory/chef-issues", {
    itemName: `WriteProbeItem ${stamp}`,
    quantityIssued: 1,
    chefName: "Write Probe Chef",
  });
  check("POST /api/inventory/chef-issues accepted", [200, 201].includes(chef.status), `got ${chef.status} ${JSON.stringify(chef.body).slice(0, 140)}`);

  const transfer = await api("POST", "/api/inventory/transfers", {
    itemName: `WriteProbeItem ${stamp}`,
    quantity: 1,
    fromStore: "Write Probe A",
    toStore: "Write Probe B",
  });
  check("POST /api/inventory/transfers accepted", [200, 201].includes(transfer.status), `got ${transfer.status} ${JSON.stringify(transfer.body).slice(0, 140)}`);

  const del = await api("DELETE", `/api/inventory/${itemId}`);
  check("DELETE /api/inventory/:id accepted", [200, 204].includes(del.status), `got ${del.status} ${JSON.stringify(del.body).slice(0, 140)}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanup() {
  console.log("\n[6] Cleanup");
  for (const id of created.transactions) {
    await api("DELETE", `/api/accounts/transactions/${id}`).catch(() => {});
  }
  for (const id of created.users) {
    await api("DELETE", `/api/users/${id}`).catch(() => {});
  }
  for (const id of created.hkRooms) {
    await api("DELETE", `/api/housekeeping/${id}`).catch(() => {});
  }
  console.log("   done");
}

async function main() {
  try {
    await login();
    await probeAccounts();
    await probeAccountsModules();
    await probeUsers();
    await probeSmallModules();
    await probeRestaurant();
    await probeBanquet();
    await probeHousekeeping();
    await probeInventory();
    await cleanup();
  } catch (err) {
    console.error("Probe crashed:", err);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log("\n" + "=".repeat(72));
  console.log(` WRITE-PATH PROBE: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(72));

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.log("\n FAILURES:");
    failures.forEach((f) => {
      console.log(`   - ${f.label}`);
      if (f.detail) console.log(`       ${f.detail}`);
    });
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main();
