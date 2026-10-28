const db = require("../config/db");
// The money contract is shared with the folio. Everything downstream of the
// bucket sums — net, refunds subtracting, the advance being included — is
// computed here so the generated invoice and the folio page cannot diverge.
const {
  GST_RATE,
  sumFolioEntries,
  readRoomRent,
  getAdvancePaid,
  computeNetAmount,
} = require("../utils/folioTotals");

// ─── Invoice helpers (v4 schema) ──────────────────────────────────────────────
//
// The authoritative `invoices` table is the v4 shape:
//   invoices(id, booking_id, customer_id, banquet_booking_id, invoice_no,
//            invoice_type, invoice_date, due_date, subtotal, service_charge,
//            tax_amount, discount_amount, round_off, total, paid_amount,
//            balance, payment_status, payment_mode, terms_accepted,
//            terms_accepted_at, sent_at, created_by, created_at, updated_at)
//
// Line items live in `invoice_lines` (the v4 replacement for the legacy
// `items_json` blob). Guest/booking display data comes from joins against
// `bookings`, `booking_guests`, `guest_profiles`, `booking_rooms` and `rooms`.

const PAYMENT_STATUSES = ["unpaid", "partial", "paid", "overdue", "refunded"];

const normalizePaymentStatus = (value) => {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return "unpaid";
  if (PAYMENT_STATUSES.includes(raw)) return raw;
  if (["pending", "not paid", "un-paid"].includes(raw)) return "unpaid";
  if (["partially paid", "part", "part paid"].includes(raw)) return "partial";
  if (["completed", "complete", "settled", "success"].includes(raw)) return "paid";
  if (["refund"].includes(raw)) return "refunded";
  if (["expired", "late"].includes(raw)) return "overdue";
  return "unpaid";
};

const toDateOnly = (value) => {
  if (!value) return null;
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
};

const today = () => new Date().toISOString().slice(0, 10);

const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const ensureInvoiceSchema = async () => {
  // The v4 `invoices` table is authoritative and already exists. Never create or
  // alter a legacy shape here — just make sure the v4 table is present and add
  // only genuinely missing v4 columns. No `AFTER <legacy_column>` clauses, which
  // is what previously blew up on the missing `final_total`.
  await db.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      booking_id BIGINT UNSIGNED DEFAULT NULL,
      customer_id INT DEFAULT NULL,
      banquet_booking_id BIGINT UNSIGNED DEFAULT NULL,
      invoice_no VARCHAR(80) NOT NULL,
      invoice_type ENUM('room','restaurant','banquet','combined','folio') DEFAULT 'room',
      invoice_date DATE NOT NULL,
      due_date DATE DEFAULT NULL,
      subtotal DECIMAL(12,2) DEFAULT 0,
      service_charge DECIMAL(12,2) DEFAULT 0,
      tax_amount DECIMAL(12,2) DEFAULT 0,
      discount_amount DECIMAL(12,2) DEFAULT 0,
      round_off DECIMAL(10,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      paid_amount DECIMAL(12,2) DEFAULT 0,
      balance DECIMAL(12,2) DEFAULT 0,
      payment_status ENUM('unpaid','partial','paid','overdue','refunded') DEFAULT 'unpaid',
      payment_mode VARCHAR(50) DEFAULT NULL,
      terms_accepted TINYINT(1) DEFAULT 0,
      terms_accepted_at DATETIME DEFAULT NULL,
      sent_at DATETIME DEFAULT NULL,
      created_by BIGINT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_invoice_no (invoice_no),
      KEY idx_booking (booking_id),
      KEY idx_status (payment_status)
    )
  `);

  const v4Columns = [
    ["booking_id", "BIGINT UNSIGNED DEFAULT NULL"],
    ["customer_id", "INT DEFAULT NULL"],
    ["banquet_booking_id", "BIGINT UNSIGNED DEFAULT NULL"],
    ["invoice_type", "ENUM('room','restaurant','banquet','combined','folio') DEFAULT 'room'"],
    ["due_date", "DATE DEFAULT NULL"],
    ["subtotal", "DECIMAL(12,2) DEFAULT 0"],
    ["service_charge", "DECIMAL(12,2) DEFAULT 0"],
    ["tax_amount", "DECIMAL(12,2) DEFAULT 0"],
    ["discount_amount", "DECIMAL(12,2) DEFAULT 0"],
    ["round_off", "DECIMAL(10,2) DEFAULT 0"],
    ["total", "DECIMAL(12,2) DEFAULT 0"],
    ["paid_amount", "DECIMAL(12,2) DEFAULT 0"],
    ["balance", "DECIMAL(12,2) DEFAULT 0"],
    ["payment_status", "ENUM('unpaid','partial','paid','overdue','refunded') DEFAULT 'unpaid'"],
    ["payment_mode", "VARCHAR(50) DEFAULT NULL"],
    ["created_by", "BIGINT UNSIGNED DEFAULT NULL"],
  ];

  for (const [column, definition] of v4Columns) {
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS COUNT FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = ?`,
      [column],
    );
    if (!(countRows[0]?.COUNT)) {
      await db.query(`ALTER TABLE invoices ADD COLUMN \`${column}\` ${definition}`);
    }
  }
};

// Shared SELECT: invoice row + joined guest/booking display data, sourced from
// the v4 tables. Sub-selects keep the join from multiplying one invoice into
// many room / guest rows.
const INVOICE_SELECT = `
  SELECT
    i.*,
    b.booking_code AS booking_code,
    b.check_in AS booking_check_in,
    b.check_out AS booking_check_out,
    b.status AS booking_status,
    b.total_amount AS booking_total_amount,
    COALESCE(
      (SELECT TRIM(CONCAT_WS(' ', bg.first_name, bg.last_name))
         FROM booking_guests bg
        WHERE bg.booking_id = i.booking_id
        ORDER BY bg.is_primary DESC, bg.id ASC LIMIT 1),
      (SELECT br.guest_name
         FROM booking_rooms br
        WHERE br.booking_id = i.booking_id
          AND br.guest_name IS NOT NULL AND br.guest_name <> ''
        ORDER BY br.id ASC LIMIT 1),
      b.booking_code,
      ''
    ) AS customer_name,
    (SELECT gp.phone
       FROM booking_guests bg
       JOIN guest_profiles gp ON gp.id = bg.guest_profile_id
      WHERE bg.booking_id = i.booking_id
      ORDER BY bg.is_primary DESC, bg.id ASC LIMIT 1) AS guest_phone,
    (SELECT GROUP_CONCAT(DISTINCT rm.room_number ORDER BY rm.room_number SEPARATOR ', ')
       FROM booking_rooms br
       JOIN rooms rm ON rm.id = br.room_id
      WHERE br.booking_id = i.booking_id) AS customer_room_no
  FROM invoices i
  LEFT JOIN bookings b ON b.id = i.booking_id
`;

const lineTypeCategory = (lineType) => {
  const type = String(lineType || "");
  if (["room_charge", "extra_charge", "service", "adjustment", "tax", "discount"].includes(type)) {
    return "Hotel";
  }
  if (["food", "beverage"].includes(type)) return "Food";
  return "Other";
};

const mapInvoiceLine = (line) => ({
  id: line.id,
  lineType: line.line_type,
  category: lineTypeCategory(line.line_type),
  name: line.description,
  description: line.description,
  referenceId: line.reference_id,
  referenceType: line.reference_type,
  price: Number(line.unit_price || 0),
  quantity: Number(line.quantity || 0),
  total: Number(line.amount || 0),
  gstPercent: Number(line.tax_percent || 0),
  taxAmount: Number(line.tax_amount || 0),
});

const lineTypeFromItem = (item) => {
  const raw = String(item.lineType || item.line_type || item.category || "").toLowerCase();
  if (/(room|hotel|stay|accommodation)/.test(raw)) return "room_charge";
  if (/(beverage|beverages|bar|drink)/.test(raw)) return "beverage";
  if (/(food|restaurant|dining|meal|kitchen)/.test(raw)) return "food";
  if (/(tax|gst)/.test(raw)) return "tax";
  if (/discount/.test(raw)) return "discount";
  if (/(payment|advance|receipt)/.test(raw)) return "payment";
  if (/service/.test(raw)) return "service";
  if (/extra/.test(raw)) return "extra_charge";
  if (/adjust/.test(raw)) return "adjustment";
  return "other";
};

const insertInvoiceLines = async (invoiceId, items) => {
  const list = Array.isArray(items) ? items : [];
  if (!invoiceId || !list.length) return;

  const values = list.map((item) => {
    const quantity = toNumber(item.quantity, 1) || 1;
    const unitPrice = toNumber(firstDefined(item.price, item.unitPrice, item.unit_price), 0);
    const amount = toNumber(
      firstDefined(item.total, item.amount),
      Number((quantity * unitPrice).toFixed(2)),
    );
    const taxPercent = toNumber(firstDefined(item.gstPercent, item.taxPercent, item.tax_percent), 0);
    const taxAmount = toNumber(
      firstDefined(item.taxAmount, item.tax_amount),
      Number(((amount * taxPercent) / 100).toFixed(2)),
    );
    return [
      invoiceId,
      lineTypeFromItem(item),
      String(firstDefined(item.name, item.description, item.title, "Item")).slice(0, 255),
      firstDefined(item.referenceId, item.reference_id) ?? null,
      firstDefined(item.referenceType, item.reference_type) ?? null,
      quantity,
      unitPrice,
      amount,
      taxPercent,
      taxAmount,
    ];
  });

  const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  await db.query(
    `INSERT INTO invoice_lines
       (invoice_id, line_type, description, reference_id, reference_type,
        quantity, unit_price, amount, tax_percent, tax_amount)
     VALUES ${placeholders}`,
    values.flat(),
  );
};

const loadInvoiceLineMap = async (invoiceIds) => {
  const ids = (invoiceIds || []).filter((id) => id !== undefined && id !== null);
  const map = new Map();
  if (!ids.length) return map;

  const [rows] = await db.query(
    `SELECT * FROM invoice_lines
      WHERE invoice_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY id ASC`,
    ids,
  );
  for (const line of rows) {
    if (!map.has(line.invoice_id)) map.set(line.invoice_id, []);
    map.get(line.invoice_id).push(mapInvoiceLine(line));
  }
  return map;
};

const parseInvoiceRow = (row) => {
  const items = Array.isArray(row._items) ? row._items : [];
  const { _items, ...rest } = row;

  return {
    ...rest,
    items,
    invoiceNo: row.invoice_no || "",
    invoiceType: row.invoice_type || "room",
    invoiceDate: row.invoice_date || "",
    dueDate: row.due_date || "",
    bookingId: row.booking_id ?? row.customer_id ?? null,
    bookingCode: row.booking_code || "",
    customerName: row.customer_name || "",
    phone: row.guest_phone || "",
    roomNumber: row.customer_room_no || "",
    checkIn: row.booking_check_in || "",
    checkOut: row.booking_check_out || "",
    bookingStatus: row.booking_status || "",
    paymentMode: row.payment_mode || "",
    paymentStatus: row.payment_status || row.status || "unpaid",
    companyName: null,
    companyGstin: null,
    totalAmount: Number(row.total || 0),
    subtotal: Number(row.subtotal || 0),
    serviceCharge: Number(row.service_charge || 0),
    tax: Number(row.tax_amount || 0),
    discount: Number(row.discount_amount || 0),
    roundOff: Number(row.round_off || 0),
    paidAmount: Number(row.paid_amount || 0),
    balance: Number(row.balance || 0),
  };
};

// ─── Endpoints ────────────────────────────────────────────────────────────────

exports.createInvoice = async (req, res) => {
  try {
    await ensureInvoiceSchema();
    const data = req.body || {};
    const invoiceNo = firstDefined(data.invoiceNo, data.invoice_no) || `INV-${Date.now()}`;
    const total = toNumber(firstDefined(data.total, data.totalAmount, data.finalTotal, data.final_total), 0);
    const paidAmount = toNumber(firstDefined(data.paidAmount, data.paid_amount), 0);
    const balance = firstDefined(data.balance) !== undefined
      ? toNumber(data.balance, 0)
      : Number((total - paidAmount).toFixed(2));
    const invoiceDate = toDateOnly(firstDefined(data.invoiceDate, data.invoice_date, data.date)) || today();

    const [result] = await db.query(
      `INSERT INTO invoices
        (invoice_no, booking_id, customer_id, banquet_booking_id, invoice_type,
         invoice_date, due_date, subtotal, service_charge, tax_amount,
         discount_amount, round_off, total, paid_amount, balance,
         payment_status, payment_mode, terms_accepted, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNo,
        firstDefined(data.bookingId, data.booking_id) ?? null,
        firstDefined(data.customerId, data.customer_id, data.bookingId, data.booking_id) ?? null,
        firstDefined(data.banquetBookingId, data.banquet_booking_id) ?? null,
        firstDefined(data.invoiceType, data.invoice_type) || "room",
        invoiceDate,
        toDateOnly(firstDefined(data.dueDate, data.due_date)),
        toNumber(data.subtotal, 0),
        toNumber(firstDefined(data.serviceCharge, data.service_charge), 0),
        toNumber(firstDefined(data.tax, data.taxAmount, data.tax_amount, data.gst), 0),
        toNumber(firstDefined(data.discount, data.discountAmount, data.discount_amount), 0),
        toNumber(firstDefined(data.roundOff, data.round_off), 0),
        total,
        paidAmount,
        balance,
        normalizePaymentStatus(firstDefined(data.paymentStatus, data.payment_status, data.status)),
        firstDefined(data.paymentMode, data.payment_mode) ?? null,
        firstDefined(data.termsAccepted, data.terms_accepted) ? 1 : 0,
        req.user?.id ?? null,
      ],
    );

    if (Array.isArray(data.items) && data.items.length) {
      await insertInvoiceLines(result.insertId, data.items);
    }

    res.status(201).json({
      message: "Invoice created successfully",
      id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to create invoice", details: err.message || err });
  }
};

exports.getAllInvoices = async (req, res) => {
  try {
    await ensureInvoiceSchema();
    const [rows] = await db.query(
      `${INVOICE_SELECT}
       ORDER BY i.updated_at DESC, i.id DESC`,
    );

    const lineMap = await loadInvoiceLineMap(rows.map((row) => row.id));

    const seen = new Set();
    const deduped = rows.filter((row) => {
      const key = `booking:${row.booking_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json(deduped.map((row) => parseInvoiceRow({ ...row, _items: lineMap.get(row.id) || [] })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch invoices", details: err.message || err });
  }
};

exports.getInvoiceByBookingId = async (req, res) => {
  try {
    await ensureInvoiceSchema();
    const bookingId = Number(req.params.bookingId);
    if (!bookingId) {
      return res.json({});
    }
    const [rows] = await db.query(
      `${INVOICE_SELECT}
       WHERE i.booking_id = ? OR i.customer_id = ?
       ORDER BY i.updated_at DESC, i.id DESC
       LIMIT 1`,
      [bookingId, bookingId],
    );
    if (!rows[0]) return res.json({});

    const lineMap = await loadInvoiceLineMap([rows[0].id]);
    res.json(parseInvoiceRow({ ...rows[0], _items: lineMap.get(rows[0].id) || [] }));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch invoice", details: err.message || err });
  }
};

exports.updateInvoice = async (req, res) => {
  try {
    await ensureInvoiceSchema();
    const id = Number(req.params.id);
    const data = req.body || {};

    const [existingRows] = await db.query(`SELECT * FROM invoices WHERE id = ? LIMIT 1`, [id]);
    const current = existingRows[0];
    if (!current) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const total = toNumber(
      firstDefined(data.total, data.totalAmount, data.finalTotal, data.final_total),
      Number(current.total || 0),
    );
    const paidAmount = toNumber(
      firstDefined(data.paidAmount, data.paid_amount),
      Number(current.paid_amount || 0),
    );
    const balance = firstDefined(data.balance) !== undefined
      ? toNumber(data.balance, 0)
      : Number((total - paidAmount).toFixed(2));

    await db.query(
      `UPDATE invoices SET
        invoice_no = ?, invoice_type = ?, invoice_date = ?, due_date = ?,
        subtotal = ?, service_charge = ?, tax_amount = ?, discount_amount = ?,
        round_off = ?, total = ?, paid_amount = ?, balance = ?,
        payment_status = ?, payment_mode = ?
       WHERE id = ?`,
      [
        firstDefined(data.invoiceNo, data.invoice_no, current.invoice_no),
        firstDefined(data.invoiceType, data.invoice_type, current.invoice_type) || "room",
        toDateOnly(firstDefined(data.invoiceDate, data.invoice_date, data.date)) ||
          toDateOnly(current.invoice_date) ||
          today(),
        toDateOnly(firstDefined(data.dueDate, data.due_date)) ?? toDateOnly(current.due_date),
        toNumber(data.subtotal, Number(current.subtotal || 0)),
        toNumber(firstDefined(data.serviceCharge, data.service_charge), Number(current.service_charge || 0)),
        toNumber(
          firstDefined(data.tax, data.taxAmount, data.tax_amount, data.gst),
          Number(current.tax_amount || 0),
        ),
        toNumber(
          firstDefined(data.discount, data.discountAmount, data.discount_amount),
          Number(current.discount_amount || 0),
        ),
        toNumber(firstDefined(data.roundOff, data.round_off), Number(current.round_off || 0)),
        total,
        paidAmount,
        balance,
        normalizePaymentStatus(
          firstDefined(data.paymentStatus, data.payment_status, data.status, current.payment_status),
        ),
        firstDefined(data.paymentMode, data.payment_mode) ?? current.payment_mode ?? null,
        id,
      ],
    );

    // Replace line items when the caller sends an `items` array.
    if (Array.isArray(data.items)) {
      await db.query(`DELETE FROM invoice_lines WHERE invoice_id = ?`, [id]);
      await insertInvoiceLines(id, data.items);
    }

    res.json({ message: "Invoice updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update invoice", details: err.message || err });
  }
};

exports.generateCustomerInvoice = async (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!customerId) {
      return res.status(400).json({ error: "customerId is required" });
    }

    await ensureInvoiceSchema();

    // Base booking + primary-guest info (v4: bookings / booking_guests /
    // guest_profiles / booking_rooms).
    const [bookingRows] = await db.query(
      `SELECT
        b.id AS bookingId,
        b.booking_code AS bookingCode,
        b.check_in AS checkIn,
        b.check_out AS checkOut,
        b.status AS bookingStatus,
        b.total_amount AS bookingTotal,
        b.advance_amount AS advanceAmount,
        b.balance_amount AS balanceAmount,
        COALESCE(
          (SELECT TRIM(CONCAT_WS(' ', bg.first_name, bg.last_name))
             FROM booking_guests bg
            WHERE bg.booking_id = b.id
            ORDER BY bg.is_primary DESC, bg.id ASC LIMIT 1),
          (SELECT br.guest_name
             FROM booking_rooms br
            WHERE br.booking_id = b.id
              AND br.guest_name IS NOT NULL AND br.guest_name <> ''
            ORDER BY br.id ASC LIMIT 1),
          b.booking_code,
          'Walk-in Guest'
        ) AS customerName,
        (SELECT gp.phone
           FROM booking_guests bg
           JOIN guest_profiles gp ON gp.id = bg.guest_profile_id
          WHERE bg.booking_id = b.id
          ORDER BY bg.is_primary DESC, bg.id ASC LIMIT 1) AS phone
      FROM bookings b
      WHERE b.id = ?
      LIMIT 1`,
      [customerId],
    );

    const booking = bookingRows[0];
    if (!booking) {
      // Nothing to invoice for this id — return an empty success envelope so
      // the read stays a 200 (matches getInvoiceByBookingId's `{}` contract).
      return res.json({});
    }

    const nights = (() => {
      if (booking.checkIn && booking.checkOut) {
        const d1 = new Date(booking.checkIn);
        const d2 = new Date(booking.checkOut);
        const diff = Math.round((d2 - d1) / 86400000);
        return diff > 0 ? diff : 1;
      }
      return 1;
    })();

    // Room items (v4: booking_rooms + rooms + room_categories)
    const [roomRows] = await db.query(
      `SELECT
         rm.room_number AS roomNumber,
         COALESCE(c.name, 'Room Charge') AS roomType,
         COALESCE(NULLIF(br.nights, 0), 1) AS nights,
         COALESCE(br.rate_per_night, 0) AS ratePerNight,
         COALESCE(br.room_charge, 0) AS roomCharge,
         COALESCE(br.extra_charges, 0) AS extraCharges,
         COALESCE(br.total, 0) AS total
       FROM booking_rooms br
       JOIN rooms rm ON rm.id = br.room_id
       LEFT JOIN room_categories c ON c.id = rm.category_id
       WHERE br.booking_id = ?
       ORDER BY rm.room_number`,
      [customerId],
    );

    const roomNumbers = roomRows.map((row) => String(row.roomNumber)).filter(Boolean);
    const roomItems = roomRows.map((row) => {
      const qty = Number(row.nights || 1);
      const price = Number(row.ratePerNight || 0);
      const rowTotal = Number(row.roomCharge || price * qty || 0);
      return {
        category: "Hotel",
        lineType: "room_charge",
        name: `${row.roomType} - Room ${row.roomNumber}`,
        price,
        quantity: qty,
        nights: qty,
        total: Number(rowTotal.toFixed(2)),
      };

    });

    // Folio items (v4: hotel_folio_entries)
    const [folioRows] = await db.query(
      `SELECT entry_type, category, description, amount
       FROM hotel_folio_entries
       WHERE booking_id = ?
       ORDER BY entry_date ASC, id ASC`,
      [customerId],
    );
    const folioChargeItems = [];
    let folioDiscount = 0;
    folioRows.forEach((row) => {
      const amount = Number(Number(row.amount || 0).toFixed(2));
      const entryType = String(row.entry_type || "");
      if (entryType.toLowerCase() === "discount") {
        folioDiscount += Math.abs(amount);
        return;
      }
      if (["Payment", "Refund"].includes(entryType)) return;
      if (["Room Charge", "Extra Charge", "Adjustment"].includes(entryType)) {
        folioChargeItems.push({
          category: "Hotel",
          lineType: entryType === "Extra Charge" ? "extra_charge" : "room_charge",
          name: row.description || row.category || entryType || "Hotel Charge",
          price: Math.abs(amount),
          quantity: 1,
          total: Math.abs(amount),
        });
      }
    });

    // Food items (v4: room_orders.roomNumber matching the booked room numbers)
    const foodItems = [];
    if (roomNumbers.length) {
      const placeholders = roomNumbers.map(() => "?").join(", ");
      const [foodRows] = await db.query(
        `SELECT ro.roomNumber, roi.name, roi.price, roi.quantity
         FROM room_orders ro
         INNER JOIN room_order_items roi ON roi.order_id = ro.id
         WHERE ro.roomNumber IN (${placeholders})
           AND LOWER(COALESCE(ro.status, 'pending')) IN ('served', 'paid', 'completed', 'billed')
         ORDER BY ro.id ASC, roi.id ASC`,
        roomNumbers,
      );
      foodRows.forEach((row) => {
        const qty = Number(row.quantity || 0);
        const price = Number(row.price || 0);
        if (qty > 0 && price > 0) {
          foodItems.push({
            category: "Food",
            lineType: "food",
            name: `${row.name} - Room ${row.roomNumber}`,
            price,
            quantity: qty,
            total: Number((price * qty).toFixed(2)),
          });
        }
      });
    }

    const items = [...roomItems, ...folioChargeItems, ...foodItems];
    const subtotal = Number(items.reduce((sum, item) => sum + Number(item.total || 0), 0).toFixed(2));
    const tax = Number((subtotal * GST_RATE).toFixed(2));
    const roomCharge = Number(
      roomItems.reduce((sum, item) => sum + Number(item.total || 0), 0).toFixed(2),
    );
    const foodCharge = Number(foodItems.reduce((sum, item) => sum + Number(item.total || 0), 0).toFixed(2));

    // Aggregate the four folio buckets with the ONE shared helper. The old code
    // only lifted discounts and dropped refunds and payments from the totals
    // entirely, which is why the invoice disagreed with the folio.
    const folioBuckets = sumFolioEntries(folioRows);
    // Room rent lives outside the folio ledger, and the advance lives in the
    // payments table — both must be added, exactly as the folio does.
    const roomRent = await readRoomRent(customerId);
    const advance = await getAdvancePaid(customerId);

    // folioPayments includes the folio-ledger payments PLUS the advance, because
    // they describe overlapping views of money received and must not be summed.
    const folioPayments = folioBuckets.payments + advance;

    // netAmount = charges + tax − discounts − refunds − payments.
    // Refunds SUBTRACT: reversing money the resort had counted lowers what the
    // guest still owes. The old code never subtracted refunds at all.
    const { netAmount } = computeNetAmount({
      charges: subtotal,
      discounts: folioBuckets.discounts,
      refunds: folioBuckets.refunds,
      payments: folioPayments,
      tax,
    });
    const discount = Number(folioBuckets.discounts.toFixed(2));
    // Total the invoice has billed the guest, before any money comes back in.
    const totalAmount = Number((subtotal + tax - folioBuckets.discounts).toFixed(2));

    // Amount already settled: folio payments and the advance are overlapping
    // views, so take the larger rather than summing them.
    const paymentsPaid = folioPayments;
    const paidAmount = paymentsPaid > 0 ? paymentsPaid : Number(booking.advanceAmount || 0);
    // balanceDue keeps its historical meaning (gross billed − received) so the
    // saved row's balance column stays interpretable; netAmount is the signed
    // figure the folio and invoice both reconcile on.
    const balanceDue = Number((totalAmount - paidAmount).toFixed(2));

    // Check for an existing invoice row for this booking
    const [existingRows] = await db.query(
      `SELECT * FROM invoices
        WHERE booking_id = ? OR customer_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [customerId, customerId],
    );
    const existing = existingRows[0];

    const buildInvoiceNo = () =>
      `HOTINV-${today().replace(/-/g, "")}-${String(customerId).padStart(4, "0")}`;
    const invoiceNo = existing?.invoice_no || buildInvoiceNo();
    const invoiceType =
      roomItems.length && foodItems.length ? "combined" : foodItems.length ? "restaurant" : "room";
    const paymentStatus = existing?.payment_status || normalizePaymentStatus(
      totalAmount > paidAmount ? "partial" : "paid",
    );
    const paymentMode = existing?.payment_mode || (paidAmount > 0 ? "Mixed / Recorded" : null);
    const invoiceDate = today();

    let invoiceId = existing?.id;
    if (existing) {
      await db.query(
        `UPDATE invoices SET
          invoice_no = ?, invoice_type = ?, invoice_date = ?,
          subtotal = ?, tax_amount = ?, discount_amount = ?,
          total = ?, paid_amount = ?, balance = ?,
          payment_mode = ?, payment_status = ?, booking_id = ?, customer_id = ?
         WHERE id = ?`,
        [
          invoiceNo,
          invoiceType,
          invoiceDate,
          subtotal,
          tax,
          discount,
          totalAmount,
          paidAmount,
          balanceDue,
          paymentMode,
          paymentStatus,
          customerId,
          customerId,
          existing.id,
        ],
      );
      await db.query(`DELETE FROM invoice_lines WHERE invoice_id = ?`, [existing.id]);
    } else {
      const [insertResult] = await db.query(
        `INSERT INTO invoices
          (invoice_no, invoice_type, invoice_date, subtotal, tax_amount,
           discount_amount, total, paid_amount, balance, payment_mode,
           payment_status, booking_id, customer_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceNo,
          invoiceType,
          invoiceDate,
          subtotal,
          tax,
          discount,
          totalAmount,
          paidAmount,
          balanceDue,
          paymentMode,
          paymentStatus,
          customerId,
          customerId,
          req.user?.id ?? null,
        ],
      );
      invoiceId = insertResult.insertId;
    }

    if (invoiceId && items.length) {
      await insertInvoiceLines(invoiceId, items);
    }

    res.json({
      id: invoiceId,
      customerId: Number(customerId),
      bookingId: Number(customerId),
      invoiceNo,
      customerName: booking.customerName || "Walk-in Guest",
      phone: booking.phone || "",
      roomNumber: roomNumbers.join(", "),
      roomNumbers: roomNumbers.join(", "),
      companyName: "",
      companyGstin: "",
      items,
      subtotal,
      tax,
      discount,
      totalAmount,
      paidAmount,
      balanceDue,
      // Signed net after refunds: charges + tax − discount − refunds − payments.
      // This is the same figure the folio page reports, so the two reconcile.
      netAmount,
      refunds: Number(folioBuckets.refunds.toFixed(2)),
      date: invoiceDate,
      checkIn: booking.checkIn || "",
      checkOut: booking.checkOut || "",
      paymentMode: paymentMode || "",
      paymentStatus,
      roomCharge,
      foodCharge,
      bookingStatus: booking.bookingStatus || "Confirmed",
    });
  } catch (error) {
    const status = String(error.message || "").includes("not found") ? 404 : 500;
    res.status(status).json({ error: error.message || "Failed to generate invoice" });
  }
};

exports.downloadCustomerInvoicePdf = async (req, res) => {
  try {
    const bookingId = Number(req.params.customerId);
    if (!bookingId) {
      return res.status(400).json({ error: "bookingId is required" });
    }

    const InvoiceModel = require("../models/InvoiceModel");
    const InvoicePdfService = require("../services/invoicePdfService");
    const invoice = await InvoiceModel.generateCustomerInvoice(bookingId);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const pdf = await InvoicePdfService.generateInvoicePdf(invoice);
    return res.download(pdf.filePath, pdf.fileName);
  } catch (err) {
    console.error("Invoice PDF download failed:", err);
    return res.status(500).json({
      error: "Failed to generate invoice PDF",
      details: err.message || String(err),
    });
  }
};

exports.updateInvoicePaymentStatus = async (req, res) => {
  const rawStatus = req.body.paymentStatus ?? req.body.payment_status ?? req.body.status;
  if (rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === "") {
    return res.status(400).json({ error: "paymentStatus is required" });
  }
  const paymentStatus = normalizePaymentStatus(rawStatus);

  try {
    const id = Number(req.params.id);
    await ensureInvoiceSchema();

    // Resolve the target invoice: prefer the invoice id, fall back to booking id.
    let [targetRows] = await db.query(`${INVOICE_SELECT} WHERE i.id = ? LIMIT 1`, [id]);
    if (!targetRows[0]) {
      [targetRows] = await db.query(
        `${INVOICE_SELECT}
         WHERE i.booking_id = ? OR i.customer_id = ?
         ORDER BY i.updated_at DESC, i.id DESC
         LIMIT 1`,
        [id, id],
      );
    }
    const invoiceRow = targetRows[0] || null;

    if (!invoiceRow) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    await db.query(
      `UPDATE invoices
        SET payment_status = ?, payment_mode = COALESCE(?, payment_mode)
       WHERE id = ?`,
      [paymentStatus, req.body.paymentMode || null, invoiceRow.id],
    );

    // Auto-send WhatsApp invoice if payment is now Paid.
    const shouldNotify = paymentStatus === "paid";

    if (shouldNotify && invoiceRow) {
      setImmediate(async () => {
        try {
          const { generateInvoicePdf } = require("../services/invoicePdfService");
          const WhatsApp = require("../services/whatsappService");
          const UserModel = require("../models/UsersModel");

          const lineMap = await loadInvoiceLineMap([invoiceRow.id]);
          const invoice = parseInvoiceRow({
            ...invoiceRow,
            _items: lineMap.get(invoiceRow.id) || [],
          });

          if (!invoice) return;

          let fileUrl = null;
          let fileName = null;
          let filePath = null;
          try {
            const pdf = await generateInvoicePdf(invoice);
            const publicBase =
              (process.env.PUBLIC_BASE_URL ||
                process.env.PUBLIC_URL ||
                process.env.CLIENT_URL ||
                `http://localhost:${process.env.PORT || 5002}`
              ).replace(/\/+$/, "");
            fileUrl = `${publicBase}/uploads/invoices/${pdf.fileName}`;
            fileName = pdf.fileName;
            filePath = pdf.filePath;
          } catch (pdfErr) {
            if (process.env.NODE_ENV !== "test") {
              console.warn(
                `[auto-whatsapp] PDF generation failed for invoice #${invoice.invoiceNo || invoice.id}:`,
                pdfErr.message || pdfErr,
              );
            }
          }

          let adminNumber = "";
          try {
            const adminRows = await UserModel.findAdminUser();
            adminNumber = adminRows?.[0]?.phone || "";
          } catch (e) {
            // ignore — service will note no admin number
          }

          const attachment = fileUrl ? { fileUrl, fileName, filePath } : undefined;

          await WhatsApp.sendInvoiceNotifications(
            {
              customerName: invoice.customerName || "Guest",
              phone: invoice.phone || "",
              totalAmount: Number(invoice.totalAmount || 0),
              invoiceNo: invoice.invoiceNo || `#${invoice.id}`,
              checkIn: invoice.checkIn || "",
              checkOut: invoice.checkOut || "",
              paymentStatus: String(invoice.paymentStatus || "").trim(),
            },
            attachment,
            { adminNumber },
          );

          if (process.env.NODE_ENV !== "test") {
            console.log(
              `[auto-whatsapp] invoice #${invoice.invoiceNo || invoice.id} (status: ${paymentStatus}) delivered`,
            );
          }
        } catch (autoErr) {
          console.error(
            "[auto-whatsapp] auto-send failed for invoice #",
            req.params.id,
            autoErr.message || autoErr,
          );
        }
      });
    }

    res.json({ message: "Payment status updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update payment status" });
  }
};
