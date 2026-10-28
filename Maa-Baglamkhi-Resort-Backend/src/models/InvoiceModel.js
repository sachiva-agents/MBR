const db = require("../config/db");

// Folio ledger reading, entry_type normalisation, the advance lookup and the
// GST_RATE constant all live in src/utils/folioTotals.js. They are NOT
// re-declared here: exactly one copy of each in the codebase is what keeps the
// folio and the invoice reconciling.
const { canonicalFolioType, readFolioRowsForBooking, getAdvancePaid, GST_RATE } = require("../utils/folioTotals");

const runQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

const roundMoney = (value) => Number((Number(value || 0)).toFixed(2));

// ─── payment_status normalisation ─────────────────────────────────────────────
// `invoices.payment_status` is ENUM('unpaid','partial','paid','overdue','refunded')
// (see InvoiceController.js), but this model's callers hand around the free-text
// labels "Pending"/"Unpaid"/"Partially Paid". This server runs without
// STRICT_TRANS_TABLES, so MySQL silently coerces an out-of-range enum value to ''
// instead of erroring — the save appears to succeed while writing an empty
// string that accountsController/dashboardController then read as a blank
// status. Turning strict mode on would have flipped every one of these writes
// into a hard failure.
//
// The sibling `status` column is a plain VARCHAR and keeps the human-readable
// label, so the UI still shows "Pending" while payment_status stays a valid
// enum member.
const PAYMENT_STATUS_ENUM = [
  "unpaid",
  "partial",
  "paid",
  "overdue",
  "refunded",
];

const normalizePaymentStatus = (value) => {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (!key) return "unpaid";
  if (PAYMENT_STATUS_ENUM.includes(key)) return key;

  if (["pending", "unpaid", "due", "notpaid", "unsettled"].includes(key)) return "unpaid";
  if (["partial", "partiallypaid", "partpaid", "advance"].includes(key)) return "partial";
  if (["paid", "settled", "fullypaid", "complete", "completed"].includes(key)) return "paid";
  if (["overdue", "late"].includes(key)) return "overdue";
  if (["refunded", "refund", "cancelled", "canceled"].includes(key)) return "refunded";

  return "unpaid";
};

const tableExists = async (tableName) => {
  const rows = await runQuery("SHOW TABLES LIKE ?", [tableName]);
  return Array.isArray(rows) && rows.length > 0;
};

const columnExists = async (tableName, columnName) => {
  const rows = await runQuery(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  return Array.isArray(rows) && rows.length > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
  if (!(await columnExists(tableName, columnName))) {
    await runQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const formatDateKey = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const buildInvoiceNo = (bookingId) =>
  `HOTINV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(bookingId).padStart(4, "0")}`;

const normalizeInvoiceKey = (row = {}) => {
  const bookingId = Number(row.booking_id || row.customer_id || 0);
  if (bookingId > 0) {
    return `booking:${bookingId}`;
  }

  const invoiceNo = String(row.invoice_no || "").trim();
  if (invoiceNo) {
    return `invoice:${invoiceNo}`;
  }

  return `row:${row.id || "unknown"}`;
};

const dedupeInvoiceRows = (rows = []) => {
  const seen = new Set();
  return rows.filter((row) => {
    const key = normalizeInvoiceKey(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const getLatestInvoiceRow = async (bookingId) => {
  const rows = await runQuery(
    `
      SELECT id, invoice_no, payment_status, payment_mode, status, notes
      FROM invoices
      WHERE booking_id = ? OR customer_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [bookingId, bookingId],
  );

  return rows[0] || null;
};

const removeDuplicateInvoices = async ({ keepId, bookingId, invoiceNo }) => {
  const filters = [];
  const params = [];

  if (Number(bookingId) > 0) {
    filters.push("booking_id = ?");
    params.push(Number(bookingId));
    filters.push("customer_id = ?");
    params.push(Number(bookingId));
  }

  if (String(invoiceNo || "").trim()) {
    filters.push("invoice_no = ?");
    params.push(String(invoiceNo).trim());
  }

  if (!filters.length) {
    return;
  }

  const duplicateRows = await runQuery(
    `
      SELECT id
      FROM invoices
      WHERE id <> ?
        AND (${filters.join(" OR ")})
    `,
    [keepId, ...params],
  );

  if (!duplicateRows.length) {
    return;
  }

  const deleteIds = duplicateRows.map((row) => Number(row.id)).filter(Boolean);
  const placeholders = deleteIds.map(() => "?").join(", ");
  await runQuery(`DELETE FROM invoices WHERE id IN (${placeholders})`, deleteIds);
};

const ensureSchema = async () => {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT NOT NULL AUTO_INCREMENT,
      invoice_no VARCHAR(120) NOT NULL,
      date DATE NULL,
      customer_name VARCHAR(255) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      room_no VARCHAR(255) DEFAULT NULL,
      check_in DATE DEFAULT NULL,
      check_out DATE DEFAULT NULL,
      price_per_day DECIMAL(12,2) DEFAULT 0,
      food_charge DECIMAL(12,2) DEFAULT 0,
      extra_charge DECIMAL(12,2) DEFAULT 0,
      gst DECIMAL(12,2) DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      final_total DECIMAL(12,2) DEFAULT 0,
      payment_mode VARCHAR(100) DEFAULT NULL,
      status VARCHAR(50) DEFAULT 'Pending',
      notes TEXT NULL,
      booking_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_invoice_no (invoice_no)
    )
  `);

  await ensureColumn("invoices", "date", "DATE NULL AFTER invoice_no");
  await ensureColumn("invoices", "customer_name", "VARCHAR(255) DEFAULT NULL AFTER date");
  await ensureColumn("invoices", "phone", "VARCHAR(30) DEFAULT NULL AFTER customer_name");
  await ensureColumn("invoices", "room_no", "VARCHAR(255) DEFAULT NULL AFTER phone");
  await ensureColumn("invoices", "check_in", "DATE DEFAULT NULL AFTER room_no");
  await ensureColumn("invoices", "check_out", "DATE DEFAULT NULL AFTER check_in");
  await ensureColumn("invoices", "price_per_day", "DECIMAL(12,2) DEFAULT 0 AFTER check_out");
  await ensureColumn("invoices", "food_charge", "DECIMAL(12,2) DEFAULT 0 AFTER price_per_day");
  await ensureColumn("invoices", "extra_charge", "DECIMAL(12,2) DEFAULT 0 AFTER food_charge");
  await ensureColumn("invoices", "subtotal", "DECIMAL(12,2) DEFAULT 0 AFTER extra_charge");
  // gst/discount exist in CREATE TABLE but had no ensureColumn, so tables created
  // before them (using tax_amount/discount_amount) never gained the columns and
  // the INSERT failed with "Unknown column 'discount'".
  await ensureColumn("invoices", "gst", "DECIMAL(12,2) DEFAULT 0 AFTER subtotal");
  await ensureColumn("invoices", "discount", "DECIMAL(12,2) DEFAULT 0 AFTER gst");
  await ensureColumn("invoices", "final_total", "DECIMAL(12,2) DEFAULT 0 AFTER discount");
  await ensureColumn("invoices", "payment_status", "VARCHAR(50) DEFAULT 'Pending' AFTER payment_mode");
  // `status` was declared in the CREATE TABLE but never given an ensureColumn(),
  // so any invoices table created before that column was added never gained it.
  // The bootstrap below positions the later "AFTER status" columns correctly, so
  // it has to run before them.
  await ensureColumn("invoices", "status", "VARCHAR(50) DEFAULT 'Pending' AFTER payment_mode");
  await ensureColumn("invoices", "notes", "TEXT NULL AFTER status");
  await ensureColumn("invoices", "items_json", "LONGTEXT NULL AFTER notes");
  await ensureColumn("invoices", "booking_id", "INT DEFAULT NULL AFTER notes");
  await ensureColumn("invoices", "customer_id", "INT DEFAULT NULL AFTER booking_id");
  await ensureColumn("invoices", "total_amount", "DECIMAL(12,2) DEFAULT 0 AFTER final_total");
  await ensureColumn("invoices", "company_name", "VARCHAR(255) DEFAULT NULL AFTER total_amount");
  await ensureColumn("invoices", "company_gstin", "VARCHAR(30) DEFAULT NULL AFTER company_name");
  await ensureColumn(
    "invoices",
    "updated_at",
    "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
  );
};

// ROOT CAUSE (v1 -> v4 schema drift): this query used to read from
//   guests g / other_booking ob / advance_payment a / room_tariff rt / companies c
// None of those tables exist any more — the project moved to the v4 schema
// (bookings / booking_guests / guest_profiles / payments / booking_rooms /
// room_categories), so every call failed with "Table 'X' doesn't exist". That
// error was invisible until now because it sat *behind* the missing `status`
// column: the SELECT that fetched this row died first with
// "Unknown column 'status' in 'invoices'", so the invoice was never written and
// bookingController's catch logged only that first message.
//
// The join below mirrors the `primaryGuestJoin` / `roomsJoin` / `paymentsJoin`
// fragments in bookingController.js, so the invoice is built from exactly the
// same source the booking screen shows. Every join is a LEFT JOIN so a booking
// with no linked guest, rooms or payments still yields one row.
const getBookingInvoiceBase = async (customerId) => {
  const rows = await runQuery(
    `
      SELECT
        b.id                              AS bookingId,
        b.booking_code                    AS bookingCode,
        COALESCE(pg.guest_name, brg.guest_name, 'Walk-in Guest') AS customerName,
        pg.mobile                         AS phone,
        b.check_in                        AS checkIn,
        b.check_out                       AS checkOut,
        b.status                          AS bookingStatus,
        'Walk-in'                         AS bookingType,
        COALESCE(py.paidAmount, 0)        AS paidAmount,
        COALESCE(b.discount_amount, 0)    AS advanceDiscount,
        rms.rooms                         AS roomNumbers,
        rdt.roomDetails                   AS roomDetails,
        COALESCE(b.total_amount, 0)       AS bookingTotal,
        COALESCE(b.subtotal, 0)           AS bookingSubtotal,
        COALESCE(b.advance_amount, 0)     AS bookingAdvance,
        COALESCE(b.balance_amount, 0)     AS bookingBalance
      FROM bookings b
      LEFT JOIN (
        SELECT bg.booking_id,
               SUBSTRING_INDEX(
                 GROUP_CONCAT(
                   TRIM(CONCAT(COALESCE(gp.first_name, ''), ' ', COALESCE(gp.last_name, '')))
                   ORDER BY bg.is_primary DESC, bg.id SEPARATOR '|'
                 ),
                 '|', 1
               ) AS guest_name,
               MIN(gp.phone) AS mobile
        FROM booking_guests bg
        LEFT JOIN guest_profiles gp ON gp.id = bg.guest_profile_id
        GROUP BY bg.booking_id
      ) pg ON pg.booking_id = b.id
      LEFT JOIN (
        SELECT booking_id, MIN(guest_name) AS guest_name
        FROM booking_rooms
        WHERE NULLIF(TRIM(guest_name), '') IS NOT NULL
        GROUP BY booking_id
      ) brg ON brg.booking_id = b.id
      LEFT JOIN (
        SELECT booking_id,
               SUM(CASE WHEN payment_type = 'refund' THEN 0 ELSE amount END) AS paidAmount
        FROM (
          SELECT MAX(id) AS last_id FROM payments
          WHERE status = 'completed' AND bill_id IS NOT NULL
          GROUP BY bill_id
          UNION ALL
          SELECT id FROM payments WHERE status = 'completed' AND bill_id IS NULL
        ) dedup
        JOIN payments ON payments.id = dedup.last_id
        GROUP BY booking_id
      ) py ON py.booking_id = b.id
      LEFT JOIN (
        SELECT br.booking_id,
               GROUP_CONCAT(DISTINCT r.room_number ORDER BY r.room_number SEPARATOR ', ') AS rooms
        FROM booking_rooms br
        JOIN rooms r ON r.id = br.room_id
        GROUP BY br.booking_id
      ) rms ON rms.booking_id = b.id
      LEFT JOIN (
        SELECT br.booking_id,
               GROUP_CONCAT(
                 DISTINCT CONCAT(
                   r.room_number, ' | ID ', COALESCE(CAST(r.id AS CHAR), '-'), ' | ', COALESCE(rc.name, 'Room')
                 )
                 ORDER BY r.room_number SEPARATOR ' || '
               ) AS roomDetails
        FROM booking_rooms br
        LEFT JOIN rooms r            ON r.id = br.room_id
        LEFT JOIN room_categories rc ON rc.id = br.category_id
        GROUP BY br.booking_id
      ) rdt ON rdt.booking_id = b.id
      WHERE b.id = ?
      LIMIT 1
    `,
    [customerId],
  );

  return rows[0] || null;
};

const getRoomItems = async (bookingId, nights = 1) => {
  // v4 uses booking_rooms (not room_tariff).
  const hasTable = await tableExists("booking_rooms");
  if (!hasTable) return [];

  // room_charge is the pre-tax base. booking_rooms.total CANNOT be used: it was
  // written by BookingFlow.rowTotal as price × nights × quantity × (1 + gst%),
  // so a ₹800/night room stored ₹840, and bundled rows held far more again.
  // Using it here would charge the room twice for tax — once stored, once more
  // by the `subtotal * GST_RATE` step below. room_charge falls back to
  // rate_per_night, so zero-rate legacy rows still price correctly.
  const rows = await runQuery(
    `
      SELECT
        CAST(r.room_number AS CHAR)                AS roomNumber,
        COALESCE(rc.name, 'Room Charge')           AS roomType,
        1                                           AS quantity,
        COALESCE(br.rate_per_night, 0)             AS price,
        COALESCE(br.nights, ?)                      AS nights,
        COALESCE(NULLIF(br.room_charge, 0), br.rate_per_night) AS perNightBase,
        -- Rows written before gst_percent landed read 0; the resort bills
        -- room rent at 5% GST, so read those back as 5 (getFullBooking's
        -- same convention).
        COALESCE(NULLIF(br.gst_percent, 0), 5) AS gstPercent
      FROM booking_rooms br
      JOIN rooms r ON r.id = br.room_id
      LEFT JOIN room_categories rc ON rc.id = br.category_id
      WHERE br.booking_id = ?
      ORDER BY r.room_number
    `,
    [nights, bookingId],
  );

  return rows.map((row) => {
    const nightsUsed = Number(row.nights || nights);
    // Pre-tax base × nights. Tax is applied in exactly one place: the
    // buildInvoicePayload `subtotal * GST_RATE` step.
    const total = roundMoney(Number(row.perNightBase || 0) * nightsUsed);
    return {
      category: "Hotel",
      name: `${row.roomType} - Room ${row.roomNumber}`,
      price: Number(row.perNightBase || 0),
      quantity: 1,
      nights: nightsUsed,
      total,
      gst: Number(row.gstPercent || 5),
    };
  });
};

// ROOT CAUSE (split folio schema): there are TWO folio tables in this database
// and they do not agree with each other:
//
//   hotel_folio_entries  entry_type = 'Room Charge' | 'Extra Charge' | ...
//                        (title case — the one the Guest Folio UI reads/writes,
//                         via /hotel/folio/:bookingId)
//   folio_entries        entry_type = 'room_charge' | 'extra_charge' | ...
//                        (snake case — the v4 table, always EMPTY)
//
// This function used to read folio_entries first and only fall back to
// hotel_folio_entries when folio_entries was absent. Because folio_entries
// *exists*, the fallback never fired, so every charge the user posted through
// the Guest Folio UI was invisible to the invoice — the reported "room charge
// is added but not included in the invoice total" bug.
//
// The fix reads whichever table actually HAS ROWS for this booking, and
// normalises both enum spellings to one canonical set before comparing.
const FOLIO_CHARGE_TYPES = new Set(["room_charge", "extra_charge", "adjustment"]);

const getFolioItems = async (bookingId) => {
  // One shared ledger read. readFolioRowsForBooking picks whichever of the two
  // folio tables actually holds this booking's rows, so a split ledger cannot
  // lose one side and an empty folio_entries table cannot shadow the ledger
  // the Guest Folio UI writes to. It resolves to the ROW ARRAY directly (or []
  // when there is no ledger) — it is NOT an object wrapper.
  const rows = (await readFolioRowsForBooking(bookingId)) || [];

  const chargeItems = [];
  let folioDiscount = 0;
  let folioPayments = 0;
  let folioRefunds = 0;
  let folioCharges = 0;

  rows.forEach((row) => {
    // Math.abs: amounts are stored as non-negative magnitudes, but legacy rows
    // may hold negatives. The sign is implied by the bucket, never by the row.
    const amount = Math.abs(roundMoney(row.amount || 0));
    const type = canonicalFolioType(row.entry_type);

    // Discounts reduce the payable amount, collected separately and subtracted
    // from the subtotal (rather than shown as a line item).
    if (type === "discount") {
      folioDiscount += amount;
      return;
    }

    // Payments and refunds used to be dropped entirely. They are now surfaced
    // so buildInvoicePayload can reconcile the final balance instead of silently
    // ignoring money that already moved.
    if (type === "payment") {
      folioPayments += amount;
      return;
    }
    if (type === "refund") {
      folioRefunds += amount;
      return;
    }

    if (FOLIO_CHARGE_TYPES.has(type)) {
      folioCharges += amount;
      chargeItems.push({
        category: "Hotel",
        name: row.description || row.category || row.entry_type || "Hotel Charge",
        price: amount,
        quantity: 1,
        total: amount,
      });
    }
  });

  return {
    chargeItems,
    discount: roundMoney(folioDiscount),
    payments: roundMoney(folioPayments),
    refunds: roundMoney(folioRefunds),
    charges: roundMoney(folioCharges),
  };
};

const getFoodItems = async (roomNumbers = []) => {
  if (!roomNumbers.length) return [];
  if (!(await tableExists("room_orders")) || !(await tableExists("room_order_items"))) return [];

  const hasStatus = await columnExists("room_orders", "status");
  const placeholders = roomNumbers.map(() => "?").join(", ");
  const statusFilter = hasStatus
    ? "AND LOWER(COALESCE(ro.status, 'pending')) IN ('served', 'paid', 'completed', 'billed')"
    : "";
  const rows = await runQuery(
    `
      SELECT
        ro.roomNumber,
        ${hasStatus ? "ro.status," : "'paid' AS status,"}
        roi.name,
        roi.price,
        roi.quantity
      FROM room_orders ro
      INNER JOIN room_order_items roi ON roi.order_id = ro.id
      WHERE ro.roomNumber IN (${placeholders})
      ${statusFilter}
      ORDER BY ro.id ASC, roi.id ASC
    `,
    roomNumbers,
  );

  return rows
    .filter((row) => Number(row.quantity || 0) > 0 && Number(row.price || 0) > 0)
    .map((row) => {
    const quantity = Number(row.quantity || 1);
    const price = Number(row.price || 0);
    return {
      category: "Food",
      name: `${row.name} - Room ${row.roomNumber}`,
      price,
      quantity,
      total: roundMoney(price * quantity),
    };
    });
};

const saveGeneratedInvoice = async (payload) => {
  await ensureSchema();

  const current = await getLatestInvoiceRow(payload.customerId);

  const invoiceNo = current?.invoice_no || buildInvoiceNo(payload.customerId);
  // payment_status must be a valid enum member; the free-text label goes to the
  // VARCHAR `status` column so the UI keeps showing "Pending".
  const statusLabel = current?.status || payload.status || "Pending";
  const paymentStatus = normalizePaymentStatus(
    current?.payment_status || payload.paymentStatus || statusLabel,
  );
  const paymentMode = current?.payment_mode || payload.paymentMode || "Pending";
  const notes = current?.notes || payload.notes || null;

  const values = [
    invoiceNo,
    payload.date,
    payload.customerName,
    payload.phone,
    payload.roomNumber,
    payload.checkIn || null,
    payload.checkOut || null,
    payload.roomCharge,
    payload.foodCharge,
    payload.extraCharge,
    payload.subtotal,
    payload.tax,
    payload.discount,
    payload.totalAmount,
    payload.totalAmount,
    payload.companyName || null,
    payload.companyGstin || null,
    paymentMode,
    normalizePaymentStatus(paymentStatus),
    statusLabel,
    notes,
    JSON.stringify(payload.items || []),
    payload.customerId,
    payload.customerId,
  ];

  if (current) {
    await runQuery(
      `
        UPDATE invoices SET
          invoice_no = ?,
          date = ?,
          customer_name = ?,
          phone = ?,
          room_no = ?,
          check_in = ?,
          check_out = ?,
          price_per_day = ?,
          food_charge = ?,
          extra_charge = ?,
          subtotal = ?,
          gst = ?,
          discount = ?,
          final_total = ?,
          total_amount = ?,
          company_name = ?,
          company_gstin = ?,
          payment_mode = ?,
          payment_status = ?,
          status = ?,
          notes = ?,
          items_json = ?,
          booking_id = ?,
          customer_id = ?
        WHERE id = ?
      `,
      [...values, current.id],
    );
    await removeDuplicateInvoices({
      keepId: current.id,
      bookingId: payload.customerId,
      invoiceNo,
    });
    return { id: current.id, invoiceNo, paymentStatus, paymentMode, notes };
  }

  const result = await runQuery(
    `
      INSERT INTO invoices
      (
        invoice_no, date, customer_name, phone, room_no, check_in, check_out,
        price_per_day, food_charge, extra_charge, subtotal, gst, discount,
        final_total, total_amount, company_name, company_gstin,
        payment_mode, payment_status, status,
        notes, items_json, booking_id, customer_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    values,
  );

  await removeDuplicateInvoices({
    keepId: result.insertId,
    bookingId: payload.customerId,
    invoiceNo,
  });

  return { id: result.insertId, invoiceNo, paymentStatus, paymentMode, notes };
};

const buildInvoicePayload = async (customerId) => {
  const booking = await getBookingInvoiceBase(customerId);
  if (!booking) {
    throw new Error("Customer not found");
  }

  const roomNumbers = String(booking.roomNumbers || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  // Calculate nights from check-in / check-out (same logic as bookingController.js)
  const nights = (() => {
    if (booking.checkIn && booking.checkOut) {
      const d1 = new Date(booking.checkIn);
      const d2 = new Date(booking.checkOut);
      const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      return diff > 0 ? diff : 1;
    }
    return 1;
  })();

  const roomItems = await getRoomItems(customerId, nights);
  const folioData = await getFolioItems(customerId);
  const foodItems = await getFoodItems(roomNumbers);

  const items = [...roomItems, ...folioData.chargeItems, ...foodItems];
  const subtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.total || 0), 0));
  // Room rent now comes from room_charge × nights (a pre-tax base), so tax is
  // applied exactly once here. The old room_rent = total path was GST-inclusive,
  // which is why the room was previously taxed twice.
  const tax = roundMoney(subtotal * GST_RATE);
  // All four buckets are non-negative magnitudes from getFolioItems; the sign is
  // implied by which bucket the money landed in.
  const folioDiscount   = roundMoney(Number(folioData.discount || 0));
  const folioPayments   = roundMoney(Number(folioData.payments || 0));
  const folioRefunds    = roundMoney(Number(folioData.refunds  || 0));

  // Payments recorded against the booking live in TWO places: the folio ledger
  // and the payments table (advance taken at booking time). They are not
  // additive — they describe overlapping views of money received — so take the
  // larger of the two. Omitting the advance made the invoice overstate what the
  // guest still owed.
  const advancePaid = await getAdvancePaid(customerId);
  const totalPayments = roundMoney(Math.max(folioPayments, advancePaid));
  const totalRefunds  = folioRefunds;

  // CANONICAL FOLIO MONEY CONTRACT — refunds SUBTRACT. A refund reverses money
  // the resort had already counted as received, so it reduces what the guest
  // still owes. The previous `+ folioRefunds` here was the sign bug being fixed.
  const totalCharges  = subtotal;
  const totalDiscount = folioDiscount;
  const grossDue  = roundMoney(totalCharges + tax - totalDiscount);
  const netAmount = roundMoney(grossDue - totalRefunds - totalPayments);
  // netAmount > 0  → guest still owes (PAYABLE)
  // netAmount < 0  → resort owes the guest (REFUNDABLE / credit)
  // netAmount == 0 → settled
  const totalAmount = netAmount;
  const roomCharge = roundMoney(
    [...roomItems, ...folioData.chargeItems]
      .filter((item) => item.category === "Hotel")
      .reduce((sum, item) => sum + Number(item.total || 0), 0),
  );
  const foodCharge = roundMoney(
    foodItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
  );

  const saved = await saveGeneratedInvoice({
    customerId,
    date: formatDateKey(new Date()),
    customerName: booking.customerName || "Walk-in Guest",
    phone: booking.phone || "",
    roomNumber: roomNumbers.join(", "),
    checkIn: formatDateKey(booking.checkIn),
    checkOut: formatDateKey(booking.checkOut),
    roomCharge,
    foodCharge,
    extraCharge: roundMoney(folioData.chargeItems.reduce((sum, item) => sum + Number(item.total || 0), 0)),
    subtotal,
    tax,
    // grossDue subtracts ONLY folioDiscount, so store exactly that here. Adding
    // advanceDiscount (which nothing subtracts from the total) made the stored
    // display value diverge from the computed net the moment that column was
    // used. Currently benign only because bookings.discount_amount is 0.00.
    discount: folioDiscount,
    totalAmount,
    companyName: booking.companyName || "",
    companyGstin: booking.companyGst || "",
    paymentMode: Number(booking.paidAmount || 0) > 0 ? "Mixed / Recorded" : "Pending",
    // totalAmount is already net of discounts, refunds and payments (see above),
    // so compare it against nothing: a positive net means money is still owed.
    paymentStatus: totalAmount > 0 ? "Pending" : "Paid",
    items,
    notes: `Auto-generated combined invoice for booking #${customerId}`,
  });

  // Payments already recorded against this booking come from BOTH the folio
  // ledger and the `payments` table (advance captured at booking time), so
  // take the larger of the two — they are not additive.
  const folioPaidTotal = roundMoney(Math.max(folioPayments, Number(booking.paidAmount || 0)));

  return {
    id: saved.id,
    customerId: Number(customerId),
    bookingId: Number(customerId),
    invoiceNo: saved.invoiceNo,
    customerName: booking.customerName || "Walk-in Guest",
    phone: booking.phone || "",
    roomNumber: roomNumbers.join(", "),
    roomNumbers: roomNumbers.join(", "),
    companyName: booking.companyName || "",
    companyGstin: booking.companyGst || "",
    items,
    subtotal,
    tax,
    // Same figure that grossDue subtracted, so totalCharges + tax − discount
    // − totalRefunds − totalPayments reconciles exactly to totalAmount.
    discount: folioDiscount,
    totalAmount,
    // Full transaction picture so the invoice can show each line's effect:
    //   totalCharges + tax − totalDiscount − totalRefunds − totalPayments = netAmount
    totalCharges,
    totalDiscount,
    totalRefunds,
    totalPayments,
    // netAmount === totalAmount. netAmount > 0 is payable, < 0 is refundable.
    netAmount,
    // Folio-prefixed aliases retained for existing callers.
    folioPayments,
    folioRefunds,
    folioDiscount,
    paidAmount: folioPaidTotal,
    balanceDue: totalAmount,
    date: formatDateKey(new Date()),
    checkIn: formatDateKey(booking.checkIn),
    checkOut: formatDateKey(booking.checkOut),
    paymentMode: saved.paymentMode,
    paymentStatus: saved.paymentStatus,
    roomCharge,
    foodCharge,
    bookingStatus: booking.bookingStatus || "Confirmed",
  };
};

const parseInvoiceRow = (row) => ({
  ...row,
  items: (() => {
    try {
      return JSON.parse(row.items_json || "[]");
    } catch {
      return [];
    }
  })(),
  // 🐛 FIX: this used to only spread the raw DB row (snake_case columns:
  // invoice_no, booking_id, room_no, check_in, check_out, customer_name,
  // etc.) without ever mapping them to the camelCase names every consumer
  // actually reads (invoiceNo, bookingId, roomNumber, checkIn, checkOut,
  // customerName...). A brand-new invoice (built via generateCustomerInvoice)
  // already returns camelCase fields directly, so it looked fine the first
  // time — but any time an EXISTING invoice was reused (getInvoiceByBookingId,
  // which is the normal path once an invoice already exists for a booking),
  // `invoice.invoiceNo` and `invoice.bookingId` came back undefined, which is
  // why "Invoice No." and "Folio No." on the printed/WhatsApp'd invoice
  // showed blank/N-A after the first send.
  invoiceNo: row.invoiceNo || row.invoice_no || "",
  bookingId: row.bookingId ?? row.booking_id ?? row.customer_id ?? null,
  customerName: row.customerName || row.customer_name || "",
  phone: row.phone || "",
  roomNumber: row.roomNumber || row.room_no || "",
  checkIn: row.checkIn || row.check_in || "",
  checkOut: row.checkOut || row.check_out || "",
  paymentMode: row.paymentMode || row.payment_mode || "",
  paymentStatus: row.paymentStatus || row.payment_status || row.status || "Pending",
  companyName: row.companyName || row.company_name || null,
  companyGstin: row.companyGstin || row.company_gstin || null,
  totalAmount: Number(row.totalAmount ?? row.total_amount ?? row.final_total ?? 0),
  subtotal: Number(row.subtotal || 0),
  tax: Number(row.gst || 0),
  discount: Number(row.discount || 0),
  paidAmount: Number(row.paidAmount || 0),
});

const createInvoice = (data, callback) => {
  ensureSchema()
    .then(() =>
      runQuery(
        `
          INSERT INTO invoices
          (
            invoice_no, date, customer_name, phone, room_no, check_in, check_out,
            price_per_day, food_charge, extra_charge, subtotal, gst, discount,
            final_total, total_amount, payment_mode, payment_status, status,
            notes, items_json, booking_id, customer_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          data.invoiceNo,
          data.date,
          data.customerName,
          data.phone,
          data.roomNo,
          data.checkIn,
          data.checkOut,
          data.pricePerDay || 0,
          data.foodCharge || 0,
          data.extraCharge || 0,
          data.subtotal || 0,
          data.gst || data.tax || 0,
          data.discount || 0,
          data.finalTotal || data.totalAmount || 0,
          data.totalAmount || data.finalTotal || 0,
          data.paymentMode || null,
          normalizePaymentStatus(data.paymentStatus || data.status),
          data.status || data.paymentStatus || "Pending",
          data.notes || null,
          JSON.stringify(data.items || []),
          data.bookingId || null,
          data.customerId || data.bookingId || null,
        ],
      ),
    )
    .then((result) => callback(null, result))
    .catch((error) => callback(error));
};

const getAllInvoices = (callback) => {
  ensureSchema()
    .then(() => {
      const hasAdvanceTable = tableExists("advance_payment");
      if (!hasAdvanceTable) {
        return runQuery(`
          SELECT *
          FROM invoices
          ORDER BY updated_at DESC, id DESC
        `);
      }

      return runQuery(`
        SELECT
          i.*,
          COALESCE(SUM(a.amount), 0) AS paidAmount,
          COALESCE(SUM(a.discount_amount), 0) AS advanceDiscount
        FROM invoices i
        LEFT JOIN advance_payment a ON a.booking_id = i.booking_id
        GROUP BY i.id
        ORDER BY i.updated_at DESC, i.id DESC
      `);
    })
    .then((rows) => callback(null, dedupeInvoiceRows(rows).map(parseInvoiceRow)))
    .catch((error) => callback(error));
};

const getInvoiceByBookingId = (bookingId, callback) => {
  if (typeof callback === 'function') {
    ensureSchema()
      .then(() =>
        runQuery(
          `
            SELECT *
            FROM invoices
            WHERE booking_id = ? OR customer_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
          `,
          [bookingId, bookingId],
        ),
      )
      .then((rows) => callback(null, rows[0] ? parseInvoiceRow(rows[0]) : null))
      .catch((error) => callback(error));
    return;
  }

  // async/await mode — called as: await Invoice.getInvoiceByBookingId(bookingId)
  return (async () => {
    await ensureSchema();
    const rows = await runQuery(
      `
        SELECT *
        FROM invoices
        WHERE booking_id = ? OR customer_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [bookingId, bookingId],
    );
    return rows[0] ? parseInvoiceRow(rows[0]) : null;
  })();
};

const updateInvoice = (id, data, callback) => {
  ensureSchema()
    .then(() =>
      runQuery(
        `
          UPDATE invoices SET
            date = ?,
            customer_name = ?,
            phone = ?,
            room_no = ?,
            check_in = ?,
            check_out = ?,
            price_per_day = ?,
            food_charge = ?,
            extra_charge = ?,
            subtotal = ?,
            gst = ?,
            discount = ?,
            final_total = ?,
            total_amount = ?,
            payment_mode = ?,
            payment_status = ?,
            status = ?,
            notes = ?,
            items_json = ?
          WHERE id = ?
        `,
        [
          data.date,
          data.customerName,
          data.phone,
          data.roomNo,
          data.checkIn,
          data.checkOut,
          data.pricePerDay || 0,
          data.foodCharge || 0,
          data.extraCharge || 0,
          data.subtotal || 0,
          data.gst || data.tax || 0,
          data.discount || 0,
          data.finalTotal || data.totalAmount || 0,
          data.totalAmount || data.finalTotal || 0,
          data.paymentMode || null,
          normalizePaymentStatus(data.paymentStatus || data.status),
          data.status || data.paymentStatus || "Pending",
          data.notes || null,
          JSON.stringify(data.items || []),
          id,
        ],
      ),
    )
    .then((result) => callback(null, result))
    .catch((error) => callback(error));
};

const generateCustomerInvoice = async (customerId) => {
  await ensureSchema();
  return buildInvoicePayload(Number(customerId));
};

const updatePaymentStatus = async (id, paymentStatus, options = {}) => {
  await ensureSchema();
  const paymentMode = options.paymentMode || null;
  const notes = options.notes || null;
  await runQuery(
    `
      UPDATE invoices
      SET
        payment_status = ?,
        status = ?,
        payment_mode = COALESCE(?, payment_mode),
        notes = CASE
          WHEN ? IS NULL OR ? = '' THEN notes
          WHEN notes IS NULL OR notes = '' THEN ?
          ELSE CONCAT(notes, ' | ', ?)
        END
      WHERE id = ?
    `,
    [normalizePaymentStatus(paymentStatus), paymentStatus, paymentMode, notes, notes, notes, notes, id],
  );
};

module.exports = {
  ensureSchema,
  createInvoice,
  getAllInvoices,
  getInvoiceByBookingId,
  updateInvoice,
  generateCustomerInvoice,
  updatePaymentStatus,
};