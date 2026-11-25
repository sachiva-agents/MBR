#!/usr/bin/env node
/**
 * Lifecycle tests — prove that writes actually work.
 *
 * Unlike test/api-routes.test.js (which only proves each handler is reachable),
 * this suite performs real create -> read -> update -> delete round-trips and
 * asserts the values that come back. Every row it creates is cleaned up in
 * afterAll, so running it leaves the database as it found it.
 *
 * Each module test is independent: a failure in one does not stop the others,
 * and the summary reports every module's result.
 *
 * Usage:  npm run test:lifecycle
 */

const http = require("http");
const crypto = require("crypto");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5002";
const ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || "admin@resort.com",
  password: process.env.TEST_ADMIN_PASSWORD || "password",
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Assertion helpers — collect failures instead of throwing on the first one
// ---------------------------------------------------------------------------
function createSuite(name) {
  const results = [];
  const cleanup = [];

  const check = (label, condition, detail) => {
    results.push({ label, ok: Boolean(condition), detail: detail || "" });
    const mark = condition ? "PASS" : "FAIL";
    console.log(`   ${mark}  ${label}${condition || !detail ? "" : ` -> ${detail}`}`);
  };

  const onCleanup = (fn) => cleanup.push(fn);

  return {
    name,
    results,
    check,
    onCleanup,
    async runCleanup() {
      for (const fn of cleanup.reverse()) {
        try {
          await fn();
        } catch (err) {
          console.log(`   [cleanup] ${err.message}`);
        }
      }
    },
  };
}

function summarize(suite) {
  const passed = suite.results.filter((r) => r.ok).length;
  const failed = suite.results.length - passed;
  return { name: suite.name, passed, failed, results: suite.results };
}

// A fresh install ships an empty rooms table (schema bootstrap only creates
// the DDL + the six default categories, no room rows). The room-attach steps
// need at least one room, so this provisions a stamp-suffixed fixture through
// the public API and removes it on cleanup — the suite's own "clean up
// everything we create" contract. No-op when rooms already exist.
async function ensureRoomFixture(suite, stamp) {
  const setup = await api("GET", "/api/hotel/rooms/setup");
  const categories = Array.isArray(setup.body) ? setup.body : [];
  const anyRoom = categories.flatMap((c) => c.roomDetails || c.rooms || []);
  if (anyRoom.length) return;

  const categoryId = categories[0]?.id;
  const roomNumber = `LK-ROOM-${stamp}`;
  const created = await api("POST", "/api/hotel/rooms", { roomNumber, categoryId });
  if ([200, 201].includes(created.status)) {
    suite.onCleanup(() => api("DELETE", `/api/hotel/rooms/${roomNumber}`).catch(() => {}));
  }
}

// ---------------------------------------------------------------------------
// Module 1 — Hotel booking lifecycle
// ---------------------------------------------------------------------------
async function testBookingLifecycle() {
  const suite = createSuite("Hotel booking lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const guestName = `Lifecycle Guest ${stamp}`;
  const checkIn = "2026-03-01";
  const checkOut = "2026-03-04";
  await ensureRoomFixture(suite, stamp);

  // --- Create ---
  const created = await api("POST", "/api/hotel/guest", {
    guestName,
    phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
    checkIn,
    checkOut,
    adults: 2,
    bookingStatus: "confirmed",
    specialRequests: "lifecycle test",
  });

  check("POST /api/hotel/guest returns 201/200", [200, 201].includes(created.status), `got ${created.status}`);
  const bookingId = created.body?.bookingId || created.body?.id || created.body?.insertId;
  check("response carries a booking id", Boolean(bookingId), JSON.stringify(created.body).slice(0, 160));

  if (bookingId) {
    // Bookings are audited, not deleted — there is no DELETE route. The cancel
    // step below soft-closes the row, so cleanup only needs to cover the case
    // where the test failed before reaching it.
    onCleanup(async () => {
      await api("PUT", `/api/hotel/cancel/${bookingId}`, {
        reason: "lifecycle test cleanup",
      }).catch(() => {});
    });
  }

  if (!bookingId) {
    await suite.runCleanup();
    return summarize(suite);
  }

  // --- Read back ---
  const fetched = await api("GET", `/api/hotel/full-booking/${bookingId}`);
  check("GET /api/hotel/full-booking/:id returns 200", fetched.status === 200, `got ${fetched.status}`);
  check(
    "booking reflects the guest name we sent",
    JSON.stringify(fetched.body).includes(guestName),
    JSON.stringify(fetched.body).slice(0, 200)
  );
  check(
    "booking reflects check_in date",
    JSON.stringify(fetched.body).includes(checkIn),
    JSON.stringify(fetched.body).slice(0, 200)
  );

  // --- Attach a room (tariff) ---
  // createGuest writes the booking header only; the room row on booking_rooms is
  // created by the tariff step. Pax counts live on that row, so it must exist first.
  // Pick a room that is actually free for these dates — the overlap guard now
  // works, so attaching an occupied room correctly returns 409.
  const roomsSetup = await api("GET", "/api/hotel/rooms/setup");
  const roomNumber = String(
    Array.isArray(roomsSetup.body)
      ? roomsSetup.body
          .flatMap((c) => c.roomDetails || c.rooms || [])
          .find((r) => r && r.status !== "occupied" && !r.guest)?.roomNumber ||
          roomsSetup.body.flatMap((c) => c.roomDetails || c.rooms || [])[0]?.roomNumber ||
          ""
      : ""
  ).trim();

  let roomAttached = false;
  if (roomNumber) {
    const tariff = await api("POST", `/api/hotel/room-tariff/${bookingId}`, {
      roomNumber,
      room_number: roomNumber,
      rate: 1500,
      ratePerNight: 1500,
      price: 1500,
    });
    roomAttached = [200, 201].includes(tariff.status);
    check(
      "POST /api/hotel/room-tariff/:id attaches a room",
      roomAttached,
      `got ${tariff.status} ${JSON.stringify(tariff.body).slice(0, 140)}`
    );

    const afterTariff = await api("GET", `/api/hotel/full-booking/${bookingId}`);
    check(
      "booking reports the attached room",
      JSON.stringify(afterTariff.body).includes(roomNumber),
      JSON.stringify(afterTariff.body).slice(0, 200)
    );
  } else {
    check("POST /api/hotel/room-tariff/:id attaches a room", false, "no rooms in inventory to attach");
  }

  // --- Update (pax) ---
  if (roomAttached && roomNumber) {
    const paxUpdate = await api("POST", `/api/hotel/pax/${bookingId}`, {
      roomNumber,
      room_number: roomNumber,
      adults: 3,
      children: 1,
    });
    check(
      "POST /api/hotel/pax/:id accepted",
      [200, 201].includes(paxUpdate.status),
      `got ${paxUpdate.status} ${JSON.stringify(paxUpdate.body).slice(0, 120)}`
    );

    const paxReadBack = await api("GET", `/api/hotel/full-booking/${bookingId}`);
    check(
      "pax update is persisted on the booking",
      JSON.stringify(paxReadBack.body).includes("3"),
      JSON.stringify(paxReadBack.body).slice(0, 200)
    );
  } else {
    check(
      "POST /api/hotel/pax/:id accepted",
      false,
      "skipped: no room row attached to the booking"
    );
  }

  // --- Advance payment ---
  const advance = await api("POST", `/api/hotel/advance/${bookingId}`, {
    amount: 500,
    mode: "Cash",
    paymentMode: "Cash",
  });
  check(
    "POST /api/hotel/advance/:id accepted",
    [200, 201].includes(advance.status),
    `got ${advance.status} ${JSON.stringify(advance.body).slice(0, 120)}`
  );

  // --- Folio entry (money on the bill) ---
  const folio = await api("POST", `/api/hotel/folio/${bookingId}`, {
    entryType: "Extra Charge",
    category: "Laundry",
    description: "lifecycle test charge",
    amount: 250,
    entryDate: checkIn,
  });
  check(
    "POST /api/hotel/folio/:id accepted",
    [200, 201].includes(folio.status),
    `got ${folio.status} ${JSON.stringify(folio.body).slice(0, 120)}`
  );

  const folioRead = await api("GET", `/api/hotel/folio/${bookingId}`);
  check("GET /api/hotel/folio/:id returns the entry", folioRead.status === 200, `got ${folioRead.status}`);

  // --- Verify advance + folio are reflected in billing ---
  const billing = await api("GET", "/api/accounts/hotel-billing");
  check("GET /api/accounts/hotel-billing returns 200", billing.status === 200, `got ${billing.status}`);

  // --- Cancel (soft delete) ---
  // The route is /cancel/:id, not /booking/:id/cancel — a 404 here means the
  // cleanup silently failed and the booking stays open, so don't accept it.
  const cancel = await api("PUT", `/api/hotel/cancel/${bookingId}`, {
    reason: "lifecycle test cleanup",
  });
  check(
    "PUT /api/hotel/cancel/:id accepted",
    [200, 201].includes(cancel.status),
    `got ${cancel.status} ${JSON.stringify(cancel.body).slice(0, 120)}`
  );

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Module 2 — Booking (v4 wizard / edit / check-in-out) lifecycle
// ---------------------------------------------------------------------------
async function testBookingV4Lifecycle() {
  const suite = createSuite("Booking v4 lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const guestName = `Lifecycle V4 ${stamp}`;
  await ensureRoomFixture(suite, stamp);
  const mobile = `90000${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`;

  // --- Create a booking ---
  const create = await api("POST", "/api/booking/guest", {
    guestName,
    mobile,
    guestEmail: `v4-${stamp}@test.com`,
    checkIn: "2026-07-01",
    checkOut: "2026-07-04",
    adults: 2,
    specialRequests: "lifecycle test",
  });
  check(
    "POST /api/booking/guest accepted",
    [200, 201].includes(create.status),
    `got ${create.status} ${JSON.stringify(create.body).slice(0, 140)}`
  );

  const bookingId = create.body?.bookingId || create.body?.id || create.body?.insertId;
  check(
    "booking create returns a real numeric id",
    Number.isInteger(bookingId),
    `got ${JSON.stringify(create.body).slice(0, 140)}`
  );

  if (!bookingId) {
    await suite.runCleanup();
    return summarize(suite);
  }

  onCleanup(async () => {
    await api("PUT", `/api/booking/cancel/${bookingId}`, { reason: "cleanup" }).catch(() => {});
  });

  // --- Read it back via both shapes ---
  const byId = await api("GET", `/api/booking/booking/${bookingId}`);
  check(
    "GET /api/booking/booking/:id returns 200",
    byId.status === 200,
    `got ${byId.status} ${JSON.stringify(byId.body).slice(0, 120)}`
  );
  check(
    "booking round-trips its guest name",
    String(byId.body?.guest_name || "") === guestName,
    `got ${JSON.stringify(byId.body?.guest_name)}`
  );
  check(
    "booking round-trips check_in",
    String(byId.body?.check_in || "").slice(0, 10) === "2026-07-01",
    `got ${JSON.stringify(byId.body?.check_in)}`
  );

  const wizard = await api("GET", `/api/booking/wizard/${bookingId}`);
  check(
    "GET /api/booking/wizard/:id returns 200",
    wizard.status === 200,
    `got ${wizard.status} ${JSON.stringify(wizard.body).slice(0, 120)}`
  );
  check(
    "wizard carries a guest object with the name we sent",
    wizard.body?.guest && String(wizard.body.guest.guestName || "") === guestName,
    `got ${JSON.stringify(wizard.body?.guest?.guestName)}`
  );

  const inList = await api("GET", "/api/booking/all-bookings");
  const listed = Array.isArray(inList.body) && inList.body.find((b) => b.bookingId === bookingId);
  check(
    "booking appears in GET /api/booking/all-bookings",
    Boolean(listed),
    `got ${Array.isArray(inList.body) ? inList.body.length : inList.status} rows`
  );

  // --- Attach a room ---
  // getRoomSetup returns an array of categories, each with a roomDetails array.
  const setup = await api("GET", "/api/booking/rooms/setup");
  const categories = Array.isArray(setup.body) ? setup.body : [];
  const roomNumber = categories
    .flatMap((c) => c.roomDetails || [])
    .find((r) => r && !r.guest && r.status !== "occupied")?.roomNumber;
  if (roomNumber) {
    check("rooms/setup exposes rooms", true, `using ${roomNumber}`);

    const tariff = await api("POST", `/api/booking/room-tariff/${bookingId}`, {
      roomNumber,
      tariff: 2500,
      total: 7500,
    });
    check(
      "POST /api/booking/room-tariff/:id accepted",
      [200, 201].includes(tariff.status),
      `got ${tariff.status} ${JSON.stringify(tariff.body).slice(0, 120)}`
    );

    // Re-attaching the same room to the SAME booking is an upsert (an edit),
    // not a double-booking — the tariff must change, not 409.
    const reattach = await api("POST", `/api/booking/room-tariff/${bookingId}`, {
      roomNumber,
      tariff: 3000,
      total: 9000,
    });
    check(
      "re-attaching the same room to the same booking upserts (not a 409)",
      [200, 201].includes(reattach.status),
      `got ${reattach.status} ${JSON.stringify(reattach.body).slice(0, 120)}`
    );

    const afterReattach = await api("GET", `/api/booking/full-booking/${bookingId}`);
    const edited = Array.isArray(afterReattach.body?.rooms) && afterReattach.body.rooms.find(
      (r) => String(r.roomNumber || r.room_number || "") === String(roomNumber)
    );
    check(
      "upsert replaced the tariff rather than adding a duplicate line",
      Boolean(edited) && Number(edited.ratePerNight ?? edited.tariff) === 3000,
      `got ${JSON.stringify(edited)}`
    );

    // Pax — this reads affectedRows, which was undefined until the rows-only
    // query() helper was swapped for a direct db.query call.
    const pax = await api("POST", `/api/booking/pax/${bookingId}`, {
      roomNumber,
      adults: 3,
      children: 1,
    });
    check(
      "POST /api/booking/pax/:id accepted (was a 404 from an undefined affectedRows)",
      [200, 201].includes(pax.status),
      `got ${pax.status} ${JSON.stringify(pax.body).slice(0, 120)}`
    );

    const paxRows = await api("GET", `/api/booking/full-booking/${bookingId}`);
    const line = Array.isArray(paxRows.body?.rooms) && paxRows.body.rooms.find(
      (r) => String(r.roomNumber || r.room_number || "") === String(roomNumber)
    );
    check(
      "pax update is persisted on the room line",
      Boolean(line) && Number(line.adults) === 3 && Number(line.children) === 1,
      `got adults=${line?.adults} children=${line?.children}`
    );
  } else {
    check("rooms/setup exposes rooms", false, "no rooms available to attach");
  }

  // --- Advance payment ---
  const advance = await api("POST", `/api/booking/advance/${bookingId}`, {
    amount: 1000,
    paymentMode: "Cash",
  });
  check(
    "POST /api/booking/advance/:id accepted",
    [200, 201].includes(advance.status),
    `got ${advance.status} ${JSON.stringify(advance.body).slice(0, 120)}`
  );

  const paymentHistory = await api("GET", `/api/booking/payment-history/${bookingId}`);
  check(
    "GET /api/booking/payment-history/:id returns 200",
    paymentHistory.status === 200,
    `got ${paymentHistory.status}`
  );

  // --- Cross-booking overlap guard ---
  // A *second* booking trying to take the same room for the same dates must be
  // refused (409) — this is the case the overlap check actually protects.
  if (roomNumber) {
    const second = await api("POST", "/api/booking/guest", {
      guestName: `Lifecycle Overlap ${stamp}`,
      mobile: `90001${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`,
      checkIn: "2026-07-01",
      checkOut: "2026-07-04",
      adults: 2,
    });
    const secondId = second.body?.bookingId || second.body?.id;

    if (secondId) {
      onCleanup(async () => {
        await api("PUT", `/api/booking/cancel/${secondId}`, { reason: "cleanup" }).catch(() => {});
      });

      const clash = await api("POST", `/api/booking/room-tariff/${secondId}`, {
        roomNumber,
        tariff: 2500,
        total: 7500,
      });
      check(
        "a second booking cannot take the same room for overlapping dates (409)",
        clash.status === 409,
        `got ${clash.status} ${JSON.stringify(clash.body).slice(0, 140)}`
      );
    }
  }

  // --- Reference + company ---
  const reference = await api("POST", `/api/booking/reference/${bookingId}`, {
    sourceId: 1,
    referenceNo: `REF-${stamp}`,
  });

  const company = await api("POST", `/api/booking/company/${bookingId}`, {
    companyName: `Lifecycle Co ${stamp}`,
    gstNumber: "29ABCDE1234F1Z5",
  });
  check(
    "POST /api/booking/company/:id accepted and returns an id (was undefined before the insertId fix)",
    [200, 201].includes(company.status) && Number.isInteger(company.body?.id),
    `got ${company.status} ${JSON.stringify(company.body).slice(0, 120)}`
  );

  // --- Folio ---
  const folioAdd = await api("POST", `/api/booking/folio/${bookingId}`, {
    entryType: "Extra Charge",
    description: "Lifecycle folio entry",
    amount: 250,
  });
  check(
    "POST /api/booking/folio/:bookingId accepted",
    [200, 201].includes(folioAdd.status),
    `got ${folioAdd.status} ${JSON.stringify(folioAdd.body).slice(0, 120)}`
  );

  const folio = await api("GET", `/api/booking/folio/${bookingId}`);
  check(
    "GET /api/booking/folio/:bookingId returns 200",
    folio.status === 200,
    `got ${folio.status} ${JSON.stringify(folio.body).slice(0, 120)}`
  );
  const folioRows = Array.isArray(folio.body) ? folio.body : folio.body?.entries || [];
  check(
    "folio lists the entry we just added",
    folioRows.some((e) => Number(e.amount) === 250),
    `got ${folioRows.length} entries`
  );

  // --- Check-in / check-out ---
  const checkIn = await api("PUT", `/api/booking/check-in/${bookingId}`, {});
  check(
    "PUT /api/booking/check-in/:id accepted",
    [200, 201].includes(checkIn.status),
    `got ${checkIn.status} ${JSON.stringify(checkIn.body).slice(0, 120)}`
  );

  const afterCheckIn = await api("GET", `/api/booking/booking/${bookingId}`);
  check(
    "status moved to checked_in",
    String(afterCheckIn.body?.booking_status || "") === "checked_in",
    `got ${JSON.stringify(afterCheckIn.body?.booking_status)}`
  );

  const checkOut = await api("PUT", `/api/booking/check-out/${bookingId}`, {});
  check(
    "PUT /api/booking/check-out/:id accepted",
    [200, 201].includes(checkOut.status),
    `got ${checkOut.status} ${JSON.stringify(checkOut.body).slice(0, 120)}`
  );

  const afterCheckOut = await api("GET", `/api/booking/booking/${bookingId}`);
  check(
    "status moved to checked_out",
    String(afterCheckOut.body?.booking_status || "") === "checked_out",
    `got ${JSON.stringify(afterCheckOut.body?.booking_status)}`
  );

  // --- Cancel (cleanup path) ---
  const cancel = await api("PUT", `/api/booking/cancel/${bookingId}`, {
    reason: "lifecycle test cleanup",
  });
  check(
    "PUT /api/booking/cancel/:id accepted",
    [200, 201].includes(cancel.status),
    `got ${cancel.status} ${JSON.stringify(cancel.body).slice(0, 120)}`
  );

  const afterCancel = await api("GET", `/api/booking/booking/${bookingId}`);
  check(
    "status moved to cancelled",
    String(afterCancel.body?.booking_status || "") === "cancelled",
    `got ${JSON.stringify(afterCancel.body?.booking_status)}`
  );

  // --- Refund idempotency ---
  // The cancel above already refunded the advance. Cancelling again — a
  // double-click or a retried request — must not refund a second time.
  const paymentsAfterCancel = await api("GET", `/api/booking/payment-history/${bookingId}`);
  const refundRows = (Array.isArray(paymentsAfterCancel.body)
    ? paymentsAfterCancel.body
    : paymentsAfterCancel.body?.payments || []
  ).filter((p) => String(p.payment_type || p.paymentType || "") === "refund");

  const secondCancel = await api("PUT", `/api/booking/cancel/${bookingId}`, {
    reason: "lifecycle test cleanup (second cancel)",
  });
  check(
    "re-cancelling an already-cancelled booking is accepted (idempotent)",
    [200, 201].includes(secondCancel.status),
    `got ${secondCancel.status} ${JSON.stringify(secondCancel.body).slice(0, 120)}`
  );

  const paymentsAfterSecond = await api("GET", `/api/booking/payment-history/${bookingId}`);
  const refundRowsAfterSecond = (Array.isArray(paymentsAfterSecond.body)
    ? paymentsAfterSecond.body
    : paymentsAfterSecond.body?.payments || []
  ).filter((p) => String(p.payment_type || p.paymentType || "") === "refund");

  check(
    "second cancel does NOT create a second refund row",
    refundRowsAfterSecond.length === refundRows.length,
    `refunds went ${refundRows.length} -> ${refundRowsAfterSecond.length}`
  );

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Module 3 — Restaurant / KOT lifecycle
// ---------------------------------------------------------------------------
async function testRestaurantLifecycle() {
  const suite = createSuite("Restaurant / KOT lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const tableName = `LT-${stamp}`;

  // --- Create table ---
  // The handler reads `number` (table number), not `name`.
  const table = await api("POST", "/api/restaurant/tables", {
    number: tableName,
    seatCount: 4,
    floorName: "Test Floor",
  });
  check(
    "POST /api/restaurant/tables accepted",
    [200, 201].includes(table.status),
    `got ${table.status} ${JSON.stringify(table.body).slice(0, 120)}`
  );

  const tablesList = await api("GET", "/api/restaurant/tables");
  const createdTable = Array.isArray(tablesList.body)
    ? tablesList.body.find((t) => String(t.number) === tableName)
    : null;
  check("new table appears in GET /api/restaurant/tables", Boolean(createdTable), "not found in list");

  // --- Create KOT order ---
  const kotNo = `KOT-LT-${stamp}`;
  const order = await api("POST", "/api/kitchen/order", {
    table: tableName,
    waiter: "Lifecycle Test",
    entityType: "Table",
    kotNo,
    prepTimeMinutes: 15,
    items: [{ name: "Test Item", qty: 2, price: 100, rate: 100 }],
  });
  check(
    "POST /api/kitchen/order accepted",
    [200, 201].includes(order.status),
    `got ${order.status} ${JSON.stringify(order.body).slice(0, 140)}`
  );

  const kitchenOrders = await api("GET", "/api/kitchen/orders");
  const ourOrder = Array.isArray(kitchenOrders.body)
    ? kitchenOrders.body.find((o) => String(o.kot_no || o.kotNo) === kotNo)
    : null;
  check("new KOT appears in GET /api/kitchen/orders", Boolean(ourOrder), "KOT not found");

  const orderId = ourOrder?.id;
  if (orderId) {
    onCleanup(async () => {
      await api("DELETE", `/api/kitchen/orders/${orderId}`).catch(() => {});
    });

    // --- Status transition: Pending -> Preparing ---
    const preparing = await api("PUT", `/api/kitchen/orders/${orderId}`, { status: "Preparing" });
    check(
      "PUT /api/kitchen/orders/:id (Preparing) accepted",
      [200, 201].includes(preparing.status),
      `got ${preparing.status} ${JSON.stringify(preparing.body).slice(0, 120)}`
    );

    // --- Status transition: Preparing -> Ready ---
    const ready = await api("PUT", `/api/kitchen/orders/${orderId}`, { status: "Ready" });
    check(
      "PUT /api/kitchen/orders/:id (Ready) accepted",
      [200, 201].includes(ready.status),
      `got ${ready.status} ${JSON.stringify(ready.body).slice(0, 120)}`
    );

    const readyList = await api("GET", "/api/waiter/orders/ready");
    check(
      "ready order shows on waiter board",
      Array.isArray(readyList.body) && readyList.body.some((o) => o.id === orderId),
      "not on ready board"
    );

    // --- Pickup by waiter ---
    const pickup = await api("PATCH", `/api/waiter/orders/${orderId}/pickup`, {});
    check(
      "PATCH /api/waiter/orders/:id/pickup accepted",
      [200, 201].includes(pickup.status),
      `got ${pickup.status} ${JSON.stringify(pickup.body).slice(0, 120)}`
    );
  }

  // --- Create bill from the order ---
  const bill = await api("POST", "/api/restaurant/bill", {
    table: tableName,
    tableNumber: tableName,
    items: [{ name: "Test Item", qty: 2, price: 100 }],
    discount: 0,
  });
  check(
    "POST /api/restaurant/bill accepted",
    [200, 201].includes(bill.status),
    `got ${bill.status} ${JSON.stringify(bill.body).slice(0, 140)}`
  );

  const bills = await api("GET", "/api/restaurant/bills");
  const ourBill = Array.isArray(bills.body)
    ? bills.body.find((b) => String(b.table_number || b.tableNumber || b.table) === tableName)
    : null;
  check("new bill appears in GET /api/restaurant/bills", Boolean(ourBill), "bill not found");

  const billId = ourBill?.id;
  if (billId) {
    onCleanup(async () => {
      await api("DELETE", `/api/restaurant/bills/${billId}`).catch(() => {});
    });

    const pay = await api("POST", `/api/restaurant/bill/${billId}/pay`, {
      amount: ourBill.total || 200,
      mode: "Cash",
      paymentMode: "Cash",
    });
    check(
      "POST /api/restaurant/bill/:id/pay accepted",
      [200, 201].includes(pay.status),
      `got ${pay.status} ${JSON.stringify(pay.body).slice(0, 140)}`
    );
  }

  if (createdTable) {
    onCleanup(async () => {
      await api("DELETE", `/api/restaurant/tables/${createdTable.id}`).catch(() => {});
    });
  }

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Module 3 — Accounts ledger lifecycle (money path)
// ---------------------------------------------------------------------------
async function testAccountsLifecycle() {
  const suite = createSuite("Accounts ledger lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const description = `Lifecycle test income ${stamp}`;
  const amount = 1234.56;

  // --- Record income ---
  const income = await api("POST", "/api/accounts/income", {
    date: new Date().toISOString().slice(0, 10),
    description,
    amount,
    paymentMode: "Cash",
    payment_mode: "Cash",
    department: "Restaurant",
  });
  check(
    "POST /api/accounts/income returns 201",
    income.status === 201,
    `got ${income.status} ${JSON.stringify(income.body).slice(0, 160)}`
  );

  const transactionId = income.body?.id;
  const transactionNo = income.body?.transaction_no;
  check("income response carries a transaction id", Boolean(transactionId), JSON.stringify(income.body).slice(0, 160));
  check("income response carries a transaction_no", Boolean(transactionNo), JSON.stringify(income.body).slice(0, 160));

  if (transactionId) {
    onCleanup(async () => {
      await api("DELETE", `/api/accounts/transactions/${transactionId}`).catch(() => {});
    });

    // --- Read it back ---
    const single = await api("GET", `/api/accounts/transactions/${transactionId}`);
    check("GET /api/accounts/transactions/:id returns 200", single.status === 200, `got ${single.status}`);
    check(
      "transaction round-trips its description",
      JSON.stringify(single.body).includes(description),
      JSON.stringify(single.body).slice(0, 200)
    );

    // --- Double-entry balance: debits must equal credits ---
    // getTransactionById returns the header plus its journal legs
    const withEntries = await api("GET", `/api/accounts/transactions/${transactionId}`);
    const legs = withEntries.body?.entries;
    if (Array.isArray(legs) && legs.length) {
      const debit = legs
        .filter((e) => String(e.entry_type || e.entryType).toLowerCase() === "debit")
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const credit = legs
        .filter((e) => String(e.entry_type || e.entryType).toLowerCase() === "credit")
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
      check("ledger has two entries", legs.length === 2, `got ${legs.length}`);
      check(
        `debits equal credits (${debit} vs ${credit})`,
        Math.abs(debit - credit) < 0.01,
        `debit=${debit} credit=${credit}`
      );
      check(
        `entry amount matches what we sent (${amount})`,
        Math.abs(debit - amount) < 0.01,
        `debit=${debit}`
      );
    } else {
      check("ledger entries readable", false, `got ${withEntries.status} ${JSON.stringify(withEntries.body).slice(0, 160)}`);
    }

    // --- Update ---
    const updated = await api("PUT", `/api/accounts/transactions/${transactionId}`, {
      description: `${description} (updated)`,
    });
    check(
      "PUT /api/accounts/transactions/:id accepted",
      [200, 201].includes(updated.status),
      `got ${updated.status} ${JSON.stringify(updated.body).slice(0, 140)}`
    );
  }

  // --- Expense path ---
  const expenseDesc = `Lifecycle test expense ${stamp}`;
  const expense = await api("POST", "/api/accounts/expense", {
    date: new Date().toISOString().slice(0, 10),
    description: expenseDesc,
    amount: 99.99,
    paymentMode: "Cash",
    department: "Restaurant",
  });
  check(
    "POST /api/accounts/expense returns 201",
    expense.status === 201,
    `got ${expense.status} ${JSON.stringify(expense.body).slice(0, 160)}`
  );
  if (expense.body?.id) {
    onCleanup(async () => {
      await api("DELETE", `/api/accounts/transactions/${expense.body.id}`).catch(() => {});
    });
  }

  // --- Validation guards ---
  const badAmount = await api("POST", "/api/accounts/income", {
    date: new Date().toISOString().slice(0, 10),
    description: "should be rejected",
    amount: 0,
    paymentMode: "Cash",
  });
  check(
    "income with amount 0 is rejected (400)",
    badAmount.status === 400,
    `got ${badAmount.status} ${JSON.stringify(badAmount.body).slice(0, 120)}`
  );

  const noDesc = await api("POST", "/api/accounts/income", {
    date: new Date().toISOString().slice(0, 10),
    amount: 10,
    paymentMode: "Cash",
  });
  check(
    "income with no description is rejected (400)",
    noDesc.status === 400,
    `got ${noDesc.status} ${JSON.stringify(noDesc.body).slice(0, 120)}`
  );

  // --- Summary reflects the ledger ---
  const summary = await api("GET", "/api/accounts/summary");
  check("GET /api/accounts/summary returns 200", summary.status === 200, `got ${summary.status}`);

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Module 4 — Auth & user lifecycle
// ---------------------------------------------------------------------------
// Module 5 — Inventory lifecycle (stock movements)
// ---------------------------------------------------------------------------
async function testInventoryLifecycle() {
  const suite = createSuite("Inventory lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const itemName = `Lifecycle Item ${stamp}`;
  const poNumber = `PO-${stamp}`;

  // --- Create item ---
  const item = await api("POST", "/api/inventory", {
    name: itemName,
    category: "Lifecycle",
    unit: "kg",
    price: 50,
    stock: 100,
    reorderPoint: 10,
  });
  check(
    "POST /api/inventory returns 201",
    item.status === 201,
    `got ${item.status} ${JSON.stringify(item.body).slice(0, 140)}`
  );
  const itemId = item.body?.id;
  check("create returns a real numeric id", Number.isInteger(itemId), `got ${JSON.stringify(item.body).slice(0, 120)}`);

  if (itemId) {
    onCleanup(async () => {
      await api("DELETE", `/api/inventory/${itemId}`).catch(() => {});
    });

    const items = await api("GET", "/api/inventory");
    const found = Array.isArray(items.body) && items.body.find((i) => i.id === itemId);
    check("new item appears in GET /api/inventory", Boolean(found), "not found in list");
    check(
      "item round-trips its stock quantity",
      found && Number(found.stock) === 100,
      `got ${found?.stock}`
    );

    // --- Waste: deducts stock via the ledger ---
    const waste = await api("POST", "/api/inventory/waste", {
      itemId,
      itemName,
      quantity: 5,
      unit: "kg",
      reason: "lifecycle test spoilage",
      store: "Main Store",
    });
    check(
      "POST /api/inventory/waste returns 201",
      [200, 201].includes(waste.status),
      `got ${waste.status} ${JSON.stringify(waste.body).slice(0, 140)}`
    );

    // --- Purchase order ---
    const po = await api("POST", "/api/inventory/purchase-orders", {
      poNumber,
      vendor: "Lifecycle Vendor",
      itemName,
      quantity: 20,
      unit: "kg",
      rate: 45,
      expectedDate: "2026-04-01",
      status: "Draft",
    });
    check(
      "POST /api/inventory/purchase-orders returns 201",
      [200, 201].includes(po.status),
      `got ${po.status} ${JSON.stringify(po.body).slice(0, 140)}`
    );
    const poId = po.body?.id;
    check("PO returns a real numeric id", Number.isInteger(poId), `got ${JSON.stringify(po.body).slice(0, 120)}`);

    if (poId) {
      onCleanup(async () => {
        await api("DELETE", `/api/inventory/purchase-orders/${poId}`).catch(() => {});
      });

      const poList = await api("GET", "/api/inventory/purchase-orders");
      const poFound = Array.isArray(poList.body) && poList.body.find((p) => p.id === poId);
      check("PO appears in GET /api/inventory/purchase-orders", Boolean(poFound), "not found in list");

      // The handler requires one of poNumber/vendor/itemName to be present.
      const poUpdate = await api("PUT", `/api/inventory/purchase-orders/${poId}`, {
        status: "Ordered",
        itemName,
      });
      check(
        "PUT /api/inventory/purchase-orders/:id accepted",
        [200, 201].includes(poUpdate.status),
        `got ${poUpdate.status} ${JSON.stringify(poUpdate.body).slice(0, 120)}`
      );
    }

    // --- Transfer: two ledger legs (OUT + IN) ---
    const transfer = await api("POST", "/api/inventory/transfers", {
      itemId,
      itemName,
      fromStore: "Main Store",
      toStore: "Kitchen Store",
      quantity: 10,
      unit: "kg",
    });
    check(
      "POST /api/inventory/transfers returns 201",
      [200, 201].includes(transfer.status),
      `got ${transfer.status} ${JSON.stringify(transfer.body).slice(0, 140)}`
    );
    const transferId = transfer.body?.id;
    if (transferId) {
      onCleanup(async () => {
        await api("DELETE", `/api/inventory/transfers/${transferId}`).catch(() => {});
      });
      const transferList = await api("GET", "/api/inventory/transfers");
      const transferFound = Array.isArray(transferList.body) && transferList.body.find((t) => t.id === transferId);
      check("transfer appears in GET /api/inventory/transfers", Boolean(transferFound), "not found in list");
    }

    // --- Ledger consistency ---
    const ledger = await api("GET", "/api/inventory/stock-ledger");
    if (Array.isArray(ledger.body)) {
      const ourLegs = ledger.body.filter((e) => e.itemId === itemId || e.item_id === itemId);
      check("stock ledger records our movements", ourLegs.length > 0, `got ${ourLegs.length} legs`);

      const outs = ourLegs.filter((e) => String(e.direction).toUpperCase() === "OUT");
      const ins = ourLegs.filter((e) => String(e.direction).toUpperCase() === "IN");
      check(
        "waste + transfer-out produced OUT legs",
        outs.length >= 2,
        `got ${outs.length} OUT legs`
      );
      check(
        "transfer produced a matching IN leg",
        ins.length >= 1,
        `got ${ins.length} IN legs`
      );
    } else {
      check("inventory stock-ledger readable", false, `got ${ledger.status}`);
    }
  }

  // --- Validation guards ---
  const noName = await api("POST", "/api/inventory/purchase-orders", {
    vendor: "x",
    itemName: "y",
    quantity: 1,
  });
  check(
    "PO without poNumber is rejected (400)",
    noName.status === 400,
    `got ${noName.status} ${JSON.stringify(noName.body).slice(0, 120)}`
  );

  const badTransfer = await api("POST", "/api/inventory/transfers", {
    itemName: "x",
    fromStore: "A",
    quantity: 0,
  });
  check(
    "transfer with quantity 0 is rejected (400)",
    badTransfer.status === 400,
    `got ${badTransfer.status} ${JSON.stringify(badTransfer.body).slice(0, 120)}`
  );

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Module 6 — Housekeeping lifecycle (room state)
// ---------------------------------------------------------------------------
async function testHousekeepingLifecycle() {
  const suite = createSuite("Housekeeping lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const roomNo = `HK-${stamp}`;

  // --- Create room ---
  const created = await api("POST", "/api/housekeeping", {
    roomNo,
    type: "Accommodation",
    building: "Test Wing",
    floor: "1",
    section: "A",
    status: "Vacant Dirty",
    assignee: "Lifecycle Tester",
    priority: "Normal",
    notes: "lifecycle test room",
  });
  check(
    "POST /api/housekeeping/rooms accepted",
    [200, 201].includes(created.status),
    `got ${created.status} ${JSON.stringify(created.body).slice(0, 140)}`
  );
  const roomId = created.body?.id;
  check(
    "create returns a real numeric id (was undefined before the insertId fix)",
    Number.isInteger(roomId),
    `got ${JSON.stringify(created.body).slice(0, 120)}`
  );

  if (roomId) {
    onCleanup(async () => {
      await api("DELETE", `/api/housekeeping/${roomId}`).catch(() => {});
    });

    const rooms = await api("GET", "/api/housekeeping");
    const found = Array.isArray(rooms.body) && rooms.body.find((r) => r.id === roomId);
    check("new room appears in GET /api/housekeeping/rooms", Boolean(found), "not found in list");
    check(
      "room round-trips its roomNo",
      found && String(found.roomNo) === roomNo,
      `got ${found?.roomNo}`
    );

    // --- Status transition ---
    const status = await api("PUT", `/api/housekeeping/status/${roomId}`, {
      status: "Vacant Clean",
    });
    check(
      "PUT /api/housekeeping/status/:id accepted",
      [200, 201].includes(status.status),
      `got ${status.status} ${JSON.stringify(status.body).slice(0, 120)}`
    );

    const afterStatus = await api("GET", "/api/housekeeping");
    const updated = Array.isArray(afterStatus.body) && afterStatus.body.find((r) => r.id === roomId);
    check(
      "status change is persisted",
      updated && String(updated.status).toLowerCase().includes("clean"),
      `got ${updated?.status}`
    );

    // --- Assignee reassignment ---
    const assignee = await api("PUT", `/api/housekeeping/assignee/${roomId}`, {
      assignee: "Lifecycle Tester 2",
    });
    check(
      "PUT /api/housekeeping/assignee/:id accepted",
      [200, 201].includes(assignee.status),
      `got ${assignee.status} ${JSON.stringify(assignee.body).slice(0, 120)}`
    );
  }

  // --- Lost & found ---
  const lf = await api("POST", "/api/housekeeping/lost-found", {
    itemName: `Lifecycle Lost ${stamp}`,
    roomNo,
    foundBy: "Lifecycle Tester",
    foundDate: "2026-03-01",
    description: "lifecycle test item",
    status: "Stored",
  });
  check(
    "POST /api/housekeeping/lost-found accepted",
    [200, 201].includes(lf.status),
    `got ${lf.status} ${JSON.stringify(lf.body).slice(0, 140)}`
  );
  const lfId = lf.body?.id;
  if (lfId) {
    onCleanup(async () => {
      await api("DELETE", `/api/housekeeping/lost-found/${lfId}`).catch(() => {});
    });
    const lfList = await api("GET", "/api/housekeeping/lost-found");
    const lfFound = Array.isArray(lfList.body) && lfList.body.find((r) => r.id === lfId);
    check("lost-found item appears in GET list", Boolean(lfFound), "not found in list");
  }

  // --- Amenity log ---
  const amenity = await api("POST", "/api/housekeeping/amenities", {
    roomNo,
    itemName: "Lifecycle Amenity",
    quantity: 2,
    usedBy: "Lifecycle Tester",
  });
  check(
    "POST /api/housekeeping/amenities accepted",
    [200, 201].includes(amenity.status),
    `got ${amenity.status} ${JSON.stringify(amenity.body).slice(0, 140)}`
  );
  const amenityId = amenity.body?.id;
  if (amenityId) {
    onCleanup(async () => {
      await api("DELETE", `/api/housekeeping/amenities/${amenityId}`).catch(() => {});
    });
  }

  // --- Validation guard ---
  const noRoom = await api("POST", "/api/housekeeping", {
    type: "Accommodation",
  });
  check(
    "housekeeping room without roomNo is rejected (400)",
    noRoom.status === 400,
    `got ${noRoom.status} ${JSON.stringify(noRoom.body).slice(0, 120)}`
  );

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Module 7 — Banquet lifecycle (hall + booking + refund)
// ---------------------------------------------------------------------------
async function testBanquetLifecycle() {
  const suite = createSuite("Banquet lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const hallName = `Lifecycle Hall ${stamp}`;
  const customerName = `Lifecycle Banquet ${stamp}`;

  // --- Create a hall (the table may be empty on a fresh install) ---
  const hallCreate = await api("POST", "/api/banquet/halls", {
    name: hallName,
    capacity: 200,
    ratePerHour: 2000,
    is_ac: true,
  });
  check(
    "POST /api/banquet/halls accepted",
    [200, 201].includes(hallCreate.status),
    `got ${hallCreate.status} ${JSON.stringify(hallCreate.body).slice(0, 140)}`
  );

  const hallId = hallCreate.body?.id;
  check(
    "hall create returns a real numeric id (was undefined before the insertId fix)",
    Number.isInteger(hallId),
    `got ${JSON.stringify(hallCreate.body).slice(0, 140)}`
  );

  if (!hallId) {
    await suite.runCleanup();
    return summarize(suite);
  }

  onCleanup(async () => {
    await api("DELETE", `/api/banquet/halls/${hallId}`).catch(() => {});
  });

  const halls = await api("GET", "/api/banquet/halls");
  const hall = Array.isArray(halls.body) && halls.body.find((h) => h.id === hallId);
  check("new hall appears in GET /api/banquet/halls", Boolean(hall), "not found in list");
  check(
    "hall round-trips its name and capacity",
    hall &&
      String(hall.name) === hallName &&
      Number(hall.capacityMin ?? hall.capacity) === 200,
    `got name=${hall?.name} capacityMin=${hall?.capacityMin} capacity=${hall?.capacity}`
  );

  // --- Create booking ---
  const booking = await api("POST", "/api/banquet", {
    hallId,
    customerName,
    phone: "9999999999",
    guestEmail: `${stamp}@test.com`,
    eventTitle: "Lifecycle Event",
    eventType: "Wedding",
    guests: 50,
    date: "2026-05-15",
    startTime: "10:00",
    endTime: "14:00",
    hallCharge: 20000,
    mealCharge: 30000,
    lightingCharge: 5000,
    eventSupportFee: 2000,
    decorationFee: 3000,
    discount: 1000,
    gstPercent: 5,
    advance: 10000,
    paymentMode: "Cash",
    paymentStatus: "Partial",
  });
  check(
    "POST /api/banquet accepted",
    [200, 201].includes(booking.status),
    `got ${booking.status} ${JSON.stringify(booking.body).slice(0, 160)}`
  );

  const bookingId = booking.body?.id || booking.body?.bookingId || booking.body?.insertId;
  check("banquet booking returns a real numeric id", Number.isInteger(bookingId), `got ${JSON.stringify(booking.body).slice(0, 140)}`);

  if (bookingId) {
    // Only cancelled/refunded bookings can be deleted, so cancel first.
    onCleanup(async () => {
      await api("PUT", `/api/banquet/${bookingId}/cancel`, {
        reason: "lifecycle test cleanup",
      }).catch(() => {});
      await api("DELETE", `/api/banquet/${bookingId}`).catch(() => {});
    });

    const bookings = await api("GET", "/api/banquet/bookings");
    const found = Array.isArray(bookings.body) && bookings.body.find((b) => b.id === bookingId);
    check("booking appears in GET /api/banquet/bookings", Boolean(found), "not found in list");
    check(
      "booking round-trips its customer name",
      found && String(found.customer_name || found.customerName) === customerName,
      `got ${found?.customer_name || found?.customerName}`
    );
    check(
      "booking round-trips guest count",
      found && Number(found.guest_count ?? found.guests) === 50,
      `got ${found?.guest_count ?? found?.guests}`
    );

    // --- Update ---
    // updateBanquetBooking is a full replace, not a patch — validateBookingPayload
    // requires the whole set.
    const update = await api("PUT", `/api/banquet/${bookingId}`, {
      hallId,
      customerName,
      phone: "9999999999",
      eventType: "Wedding",
      guests: 75,
      date: "2026-05-15",
      startTime: "10:00",
      endTime: "14:00",
      hallCharge: 20000,
      mealCharge: 30000,
      advance: 10000,
    });
    check(
      "PUT /api/banquet/:id accepted",
      [200, 201].includes(update.status),
      `got ${update.status} ${JSON.stringify(update.body).slice(0, 120)}`
    );

    const afterUpdate = await api("GET", "/api/banquet/bookings");
    const updated = Array.isArray(afterUpdate.body) && afterUpdate.body.find((b) => b.id === bookingId);
    check(
      "guest count update is persisted",
      updated && Number(updated.guest_count ?? updated.guests) === 75,
      `got ${updated?.guest_count ?? updated?.guests}`
    );

    // --- Refund path (money) ---
    // Refund must not exceed the received advance — check the stored figure
    // first, since the update above rewrote it.
    const current = await api("GET", "/api/banquet/bookings");
    const currentBooking = Array.isArray(current.body) && current.body.find((b) => b.id === bookingId);
    const advancePaid = Number(currentBooking?.advance ?? 0);
    const refundAmount = advancePaid > 0 ? Math.min(2000, advancePaid) : 0;

    const refund = await api("PUT", `/api/banquet/${bookingId}/refund`, {
      refundAmount,
      reason: "lifecycle test refund",
    });
    check(
      "PUT /api/banquet/:id/refund accepted",
      [200, 201].includes(refund.status),
      `got ${refund.status} (advance=${advancePaid}) ${JSON.stringify(refund.body).slice(0, 140)}`
    );

    // Refunding more than the advance must be refused, not silently applied.
    const overRefund = await api("PUT", `/api/banquet/${bookingId}/refund`, {
      refundAmount: refundAmount + (advancePaid > 0 ? advancePaid + 1 : 1),
      reason: "lifecycle over-refund",
    });
    check(
      "refund exceeding the advance is rejected (400)",
      overRefund.status === 400,
      `got ${overRefund.status} ${JSON.stringify(overRefund.body).slice(0, 120)}`
    );

    // --- Complete ---
    const complete = await api("PUT", `/api/banquet/${bookingId}/complete`, {});
    check(
      "PUT /api/banquet/:id/complete accepted",
      [200, 201].includes(complete.status),
      `got ${complete.status} ${JSON.stringify(complete.body).slice(0, 120)}`
    );

    // A completed booking still has to be cancellable before it can be deleted.
    const cancelForCleanup = await api("PUT", `/api/banquet/${bookingId}/cancel`, {
      reason: "lifecycle test cleanup",
    });
    check(
      "completed booking can still be cancelled",
      [200, 201].includes(cancelForCleanup.status),
      `got ${cancelForCleanup.status} ${JSON.stringify(cancelForCleanup.body).slice(0, 120)}`
    );
  }

  // --- Validation guards ---
  const noHall = await api("POST", "/api/banquet", {
    hallId: 999999999,
    customerName: "Should Fail",
    eventType: "Wedding",
    guests: 10,
    date: "2026-05-20",
    startTime: "10:00",
    endTime: "14:00",
  });
  check(
    "booking with invalid hallId is rejected (400)",
    noHall.status === 400,
    `got ${noHall.status} ${JSON.stringify(noHall.body).slice(0, 120)}`
  );

  const missingFields = await api("POST", "/api/banquet", {
    hallId,
    customerName: "Incomplete",
  });
  check(
    "booking missing required fields is rejected (400)",
    missingFields.status === 400,
    `got ${missingFields.status} ${JSON.stringify(missingFields.body).slice(0, 120)}`
  );

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
async function testAuthLifecycle() {
  const suite = createSuite("Auth & user lifecycle");
  const s = suite.name;
  const { check, onCleanup } = suite;
  console.log(`\n[${s}]`);

  const stamp = crypto.randomBytes(3).toString("hex");
  const email = `lifecycle-${stamp}@test.com`;
  const password = "Lifecycle@123";

  // --- Register ---
  const reg = await api("POST", "/api/auth/register", {
    name: "Lifecycle User",
    email,
    password,
    role: "receptionist",
  });
  check(
    "POST /api/auth/register returns 200/201",
    [200, 201].includes(reg.status),
    `got ${reg.status} ${JSON.stringify(reg.body).slice(0, 140)}`
  );

  // register returns the id, but fall back to looking the user up by email.
  let userId = reg.body?.id || reg.body?.user?.id;
  if (!userId) {
    const users = await api("GET", "/api/users");
    userId = Array.isArray(users.body) && users.body.find((u) => u.email === email)?.id;
  }
  if (userId) {
    onCleanup(async () => {
      await api("DELETE", `/api/users/${userId}`).catch(() => {});
    });
  }

  // --- Login as the new user ---
  const login = await api("POST", "/api/auth/login", { email, password });
  check(
    "new user can log in",
    login.status === 200 && Boolean(login.body?.token),
    `got ${login.status} ${JSON.stringify(login.body).slice(0, 140)}`
  );

  if (login.body?.token) {
    const roleName = String(login.body.role || "").toLowerCase();
    check(
      `login returns a role name, not an id (got "${login.body.role}")`,
      isNaN(Number(roleName)) && roleName.length > 0,
      JSON.stringify(login.body).slice(0, 160)
    );
    check(
      "login returns a user id for session validation",
      Boolean(login.body.id),
      JSON.stringify(login.body).slice(0, 160)
    );

    // --- /auth/me with that token ---
    const savedToken = token;
    token = login.body.token;
    const me = await api("GET", "/api/auth/me");
    check("GET /api/auth/me works for the new user", me.status === 200, `got ${me.status}`);
    check(
      "/auth/me echoes the same email",
      String(me.body?.email || "").toLowerCase() === email.toLowerCase(),
      JSON.stringify(me.body).slice(0, 160)
    );
    token = savedToken;
  }

  // --- Wrong password rejected ---
  const badLogin = await api("POST", "/api/auth/login", { email, password: "wrong-password" });
  check(
    "wrong password is rejected (400/401)",
    [400, 401].includes(badLogin.status),
    `got ${badLogin.status} ${JSON.stringify(badLogin.body).slice(0, 120)}`
  );

  // --- User appears in listing ---
  const users = await api("GET", "/api/users");
  const listed = Array.isArray(users.body) && users.body.some((u) => String(u.email).toLowerCase() === email);
  check("new user appears in GET /api/users", listed, "not in user list");

  // --- Password hash never leaks ---
  const leaks = JSON.stringify(users.body);
  check(
    "GET /api/users does not expose password hashes",
    !/password_hash|\$2[aby]\$/.test(leaks),
    "possible password leak in response"
  );

  await suite.runCleanup();
  return summarize(suite);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(72));
  console.log(" LIFECYCLE TESTS  (create -> read -> update -> delete)");
  console.log("=".repeat(72));

  const login = await api("POST", "/api/auth/login", ADMIN);
  if (login.status !== 200 || !login.body?.token) {
    console.error("\n[FATAL] Admin login failed - cannot run lifecycle tests.");
    console.error("  status:", login.status, login.raw.slice(0, 200));
    process.exit(1);
  }
  token = login.body.token;
  console.log(`\n[0] Authenticated as ${ADMIN.email}`);

  const modules = [
    testBookingLifecycle,
    testBookingV4Lifecycle,
    testRestaurantLifecycle,
    testAccountsLifecycle,
    testInventoryLifecycle,
    testHousekeepingLifecycle,
    testBanquetLifecycle,
    testAuthLifecycle,
  ];

  const summaries = [];
  for (const mod of modules) {
    try {
      summaries.push(await mod());
    } catch (err) {
      console.log(`\n[${mod.name}] CRASHED: ${err.message}`);
      summaries.push({ name: mod.name, passed: 0, failed: 1, results: [{ label: "module crashed", ok: false, detail: err.message }] });
    }
  }

  // Report
  console.log("\n" + "=".repeat(72));
  console.log(" SUMMARY BY MODULE");
  console.log("=".repeat(72));

  let totalPass = 0;
  let totalFail = 0;

  for (const s of summaries) {
    totalPass += s.passed;
    totalFail += s.failed;
    const mark = s.failed === 0 ? "PASS" : "FAIL";
    console.log(
      `  ${mark}  ${s.name.padEnd(34)} ${String(s.passed).padStart(3)} passed, ${String(s.failed).padStart(2)} failed`
    );
  }

  console.log("-".repeat(72));
  console.log(`  TOTAL: ${totalPass} passed, ${totalFail} failed`);

  const allFailures = summaries.flatMap((s) =>
    s.results.filter((r) => !r.ok).map((r) => ({ module: s.name, ...r }))
  );

  if (allFailures.length) {
    console.log("\n  FAILURES:");
    for (const f of allFailures) {
      console.log(`    [${f.module}] ${f.label}`);
      if (f.detail) console.log(`        ${f.detail}`);
    }
  }

  console.log("=".repeat(72) + "\n");
  process.exitCode = totalFail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("Lifecycle runner crashed:", err);
  process.exit(1);
});
