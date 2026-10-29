const crypto = require("crypto");
const db = require("../config/db");

const roomInventoryModel = require("../models/hotelRoomInventoryModel");
const BookingSourcesModel = require("../models/BookingSourcesModel");
const ResortProfilesModel = require("../models/ResortProfilesModel");
const BookingsModel = require("../models/BookingsModel");
const PaymentsModel = require("../models/PaymentsModel");
const BillsModel = require("../models/BillsModel");
const RatePlansModel = require("../models/RatePlansModel");
const UsersModel = require("../models/UsersModel");

// WhatsApp helpers — wrapped in try/catch so failures never break the booking flow.
let WhatsAppService;
let InvoicePdfService;
try {
  WhatsAppService = require("../services/whatsappService");
} catch (e) {
  WhatsAppService = null;
}
try {
  InvoicePdfService = require("../services/invoicePdfService");
} catch (e) {
  InvoicePdfService = null;
}

const fireWhatsAppInvoice = async (bookingId) => {
  if (!WhatsAppService || !InvoicePdfService) return;
  try {
    const InvoiceModel = require("../models/InvoiceModel");
    const invoice = await InvoiceModel.generateCustomerInvoice(Number(bookingId));
    if (!invoice) return;
    const pdf = await InvoicePdfService.generateInvoicePdf(invoice);
    const publicBase =
      (process.env.PUBLIC_BASE_URL || process.env.CLIENT_URL || `http://localhost:${process.env.PORT || 5002}`).replace(/\/+$/, "");
    const fileUrl = `${publicBase}/uploads/invoices/${pdf.fileName}`;
    const filePath = pdf.filePath;
    const guestName = invoice.customerName || "Valued Guest";
    const message = `Dear ${guestName},\n\nThank you for staying at Maa Baglamukhi Resort.\n\nYour invoice ${invoice.invoiceNo || ""} is attached.\nTotal: ₹${invoice.totalAmount?.toFixed(2) || "0.00"}\n\nRegards,\nMaa Baglamukhi Resort`;
    const customer = WhatsAppService.normalizePhoneNumber(invoice.phone);
    if (customer) {
      await WhatsAppService.sendWhatsAppMessage({
        number: customer,
        message,
        fileUrl,
        filePath,
        fileName: pdf.fileName,
      });
    }
    // Resolve admin phone from register table (not from env/ADMIN_WHATSAPP_NUMBER)
    let adminNumber = "";
    try {
      const [adminRows] = await db.query(
        "SELECT id, name, email, phone FROM register WHERE LOWER(role) = 'admin' AND phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id ASC LIMIT 1"
      );
      adminNumber = adminRows?.[0]?.phone || "";
    } catch (e) {
      // ignore — admin will be skipped
    }
    if (adminNumber) {
      const adminMsg = `Invoice sent to ${guestName} for booking ${invoice.invoiceNo || bookingId}. Total: ₹${invoice.totalAmount?.toFixed(2) || "0.00"}`;
      await WhatsAppService.sendWhatsAppMessage({
        number: adminNumber,
        message: adminMsg,
        fileUrl,
        filePath,
        fileName: pdf.fileName,
      });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("[WhatsApp] auto-send failed for booking", bookingId, err.message);
    }
  }
};

const query = async (sql, params = []) => {
  const [results] = await db.query(sql, params);
  return results;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────
// mysql2 hands DATE/DATETIME columns back as JS Date objects, so
// String(date).slice(0, 10) yields "Sun Mar 01" rather than "2026-03-01".
// Anything that compares or formats a date column has to go through this.
const toDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

// ─── v4 join fragments ────────────────────────────────────────────────────────
// The legacy `guests`/`other_booking`/`room_tariff`/`pax`/`companies` tables were
// replaced by the v4 schema. Guest identity now lives in `guest_profiles`
// (linked through `booking_guests`) and/or on `booking_rooms.guest_name`; room
// lines and pax live on `booking_rooms`; payments live in `payments`. These
// fragments all start from an aliased `bookings b` and always LEFT JOIN so a
// booking with no linked guest / rooms still returns a row.
const primaryGuestJoin = `
  LEFT JOIN (
    SELECT bg.booking_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(
               TRIM(CONCAT(COALESCE(gp.first_name, ''), ' ', COALESCE(gp.last_name, '')))
               ORDER BY bg.is_primary DESC, bg.id SEPARATOR '|'
             ),
             '|', 1
           ) AS guest_name,
           MIN(gp.phone)         AS mobile,
           MIN(gp.email)         AS guest_email,
           MIN(gp.address_line1) AS address,
           MIN(gp.country)       AS country,
           MIN(gp.state)         AS state,
           MIN(gp.city)          AS city,
           MIN(gp.pincode)       AS pincode
    FROM booking_guests bg
    LEFT JOIN guest_profiles gp ON gp.id = bg.guest_profile_id
    GROUP BY bg.booking_id
  ) pg ON pg.booking_id = b.id`;

const roomGuestJoin = `
  LEFT JOIN (
    SELECT booking_id, MIN(guest_name) AS guest_name
    FROM booking_rooms
    WHERE NULLIF(TRIM(guest_name), '') IS NOT NULL
    GROUP BY booking_id
  ) brg ON brg.booking_id = b.id`;

const roomsJoin = `
  LEFT JOIN (
    SELECT br.booking_id,
           GROUP_CONCAT(DISTINCT r.room_number ORDER BY r.room_number SEPARATOR ', ') AS rooms
    FROM booking_rooms br
    JOIN rooms r ON r.id = br.room_id
    GROUP BY br.booking_id
  ) rms ON rms.booking_id = b.id`;

const roomDetailsJoin = `
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
  ) rdt ON rdt.booking_id = b.id`;

const paymentsJoin = `
  LEFT JOIN (
    SELECT booking_id,
           SUM(CASE WHEN payment_type = 'refund' THEN 0 ELSE amount END) AS paidAmount,
           SUM(CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END) AS refundAmount,
           SUBSTRING_INDEX(GROUP_CONCAT(payment_method_id ORDER BY id DESC), ',', 1) AS lastMethodId
    FROM (
      SELECT MAX(id) AS last_id FROM payments
      WHERE status = 'completed' AND bill_id IS NOT NULL
      GROUP BY bill_id
      UNION ALL
      SELECT id FROM payments WHERE status = 'completed' AND bill_id IS NULL
    ) dedup
    JOIN payments ON payments.id = dedup.last_id
    GROUP BY booking_id
  ) pay ON pay.booking_id = b.id
  LEFT JOIN payment_methods pm ON pm.id = pay.lastMethodId`;


const guestIdJoin = `
  LEFT JOIN (
    -- One row per booking: the earliest ID entry captured for it. Uses
    -- MIN()/SUBSTRING_INDEX(GROUP_CONCAT(...)) rather than a bare LIMIT 1,
    -- which in a derived table would return a single row for the WHOLE
    -- result set instead of one row per booking.
    SELECT
      gi.booking_id,
      SUBSTRING_INDEX(GROUP_CONCAT(gi.id_type ORDER BY gi.id ASC), ',', 1)   AS id_proof_type,
      SUBSTRING_INDEX(GROUP_CONCAT(gi.id_number ORDER BY gi.id ASC), ',', 1) AS id_proof_number
    FROM guest_identifications gi
    WHERE gi.booking_id IS NOT NULL
    GROUP BY gi.booking_id
  ) gid ON gid.booking_id = b.id`;

const bookingRoomsTotalJoin = `
  LEFT JOIN (
    -- Stored booking_rooms.total is PRE-tax; every screen and the invoice
    -- bill GST-inclusive, so the join adds each row's own rate back
    -- (legacy rows read 0 → 5%, matching the getFullBooking reader).
    SELECT booking_id,
           SUM(total * (1 + COALESCE(NULLIF(gst_percent, 0), 5) / 100)) AS totalAmount
    FROM booking_rooms
    GROUP BY booking_id
  ) bt ON bt.booking_id = b.id`;

// Keep the bookings row's money rollups in sync with its room lines.
// booking_rooms stays pre-tax (the no-double-tax invariant); this persists
// the inclusive totals so balance_amount / total_amount stop reading 0.
const recomputeBookingTotals = async (bookingId) => {
  const rows = await query(
    `SELECT
       COALESCE(SUM(total), 0) AS preTax,
       COALESCE(SUM(total * (1 + COALESCE(NULLIF(gst_percent, 0), 5) / 100)), 0) AS inclTax
     FROM booking_rooms
     WHERE booking_id = ?`,
    [bookingId],
  );
  const preTax = Number(rows[0]?.preTax || 0);
  const inclTax = Number(rows[0]?.inclTax || 0);
  // MySQL evaluates SET left to right, so the later columns see the new
  // subtotal/total_amount within this same statement.
  await query(
    `UPDATE bookings
       SET subtotal = ?,
           total_amount = ?,
           tax_amount = GREATEST(total_amount - subtotal, 0),
           balance_amount = GREATEST(total_amount - advance_amount, 0)
     WHERE id = ?`,
    [preTax, inclTax, bookingId],
  );
};

const resolveGuestName = `COALESCE(NULLIF(brg.guest_name, ''), NULLIF(pg.guest_name, ''), '')`;

// v4 stores statuses as snake_case enums ('checked_in', 'checked_out'); legacy
// code compared against display strings. Normalise either form to a token.
const normalizeStatus = (status) =>
  String(status || "")
    .toLowerCase()
    .replace(/[_\s]+/g, "");

const isCheckedIn = (status) => normalizeStatus(status) === "checkedin";
const isCheckedOut = (status) => normalizeStatus(status) === "checkedout";

const getBookingSummaryById = async (id) => {
  const rows = await query(
    `
      SELECT
        b.id AS bookingId,
        b.booking_code AS bookingCode,
        b.booking_code,
        ${resolveGuestName} AS guest_name,
        pg.mobile,
        pg.guest_email,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
        b.status AS booking_status,
        b.cancellation_reason AS cancel_reason,
        NULL AS company_name,
        rms.rooms
      FROM bookings b
      ${primaryGuestJoin}
      ${roomGuestJoin}
      ${roomsJoin}
      WHERE b.id = ?
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
};

const getBookingWizardDataById = async (id) => {
  const [sourceRows, guestRows, specialRequestRows, roomRows, paymentRows] = await Promise.all([
      query(
        `
          SELECT b.id AS bookingId,
                 b.booking_code AS bookingCode,
                 b.status AS booking_status,
                 DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
                 DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
                 b.special_requests,
                 b.cancellation_reason,
                 bs.name AS source_name,
                 bs.type AS source_type,
                 ${resolveGuestName} AS guest_name,
                 pg.mobile,
                 pg.guest_email,
                 pg.address,
                 pg.country,
                 pg.state,
                 pg.city,
                 pg.pincode
          FROM bookings b
          LEFT JOIN booking_sources bs ON bs.id = b.source_id
          ${primaryGuestJoin}
          ${roomGuestJoin}
          WHERE b.id = ?
          LIMIT 1
        `,
        [id],
      ),
      query(
        `
          SELECT TRIM(CONCAT(COALESCE(gp.first_name, ''), ' ', COALESCE(gp.last_name, ''))) AS guestName,
                 gp.phone AS mobile,
                 gp.email AS guest_email,
                 gp.address_line1 AS address,
                 gp.country, gp.state, gp.city, gp.pincode
          FROM booking_guests bg
          LEFT JOIN guest_profiles gp ON gp.id = bg.guest_profile_id
          WHERE bg.booking_id = ?
          ORDER BY bg.is_primary DESC, bg.id ASC
          LIMIT 1
        `,
        [id],
      ),
      query(
        "SELECT * FROM special_requests WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
        [id],
      ),
      query(
        `
          SELECT
            br.room_id,
            br.category_id AS roomTypeId,
            br.rate_per_night AS tariff,
            br.nights,
            br.room_charge,
            br.extra_charges,
            br.discount,
            br.total AS roomTotal,
            COALESCE(NULLIF(br.gst_percent, 0), 5) AS gstPercent,
            br.guest_name AS booking_room_guest,
            br.adults,
            br.children,
            br.notes,
            br.created_at,
            r.id AS roomId,
            r.room_number,
            rc.name AS roomTypeName,
            rc.unit_label AS unitLabel
          FROM booking_rooms br
          LEFT JOIN rooms r            ON r.id = br.room_id
          LEFT JOIN room_categories rc ON rc.id = br.category_id
          WHERE br.booking_id = ?
          ORDER BY br.id DESC
        `,
        [id],
      ),
      query(
        `
          SELECT p.*, pm.name AS payment_mode
          FROM payments p
          LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
          WHERE p.booking_id = ?
          ORDER BY p.id DESC
          LIMIT 1
        `,
        [id],
      ),
    ]);

  const booking = sourceRows[0] || null;
  const source = sourceRows[0] || null;
  const guestProfile = guestRows[0] || null;
  const specialRequest = specialRequestRows[0] || null;

  const guestName =
    (source && String(source.guest_name || "").trim()) ||
    (guestProfile && String(guestProfile.guestName || "").trim()) ||
    "";

  const advance = paymentRows[0] || null;

  const paxByRoom = {};
  roomRows.forEach((row) => {
    const key = String(row.room_number || "").trim();
    if (!key || paxByRoom[key]) return;
    paxByRoom[key] = {
      adults: Number(row.adults || 0),
      children: Number(row.children || 0),
      mealPlan: "EP",
    };
  });

  const roomTypeMap = {};
  const selectedRooms = {};
  const paxRooms = [];
  const roomTariff = roomRows.map((row) => {
    const roomNumber = String(row.room_number || "").trim();
    const roomTypeId = row.roomTypeId ? String(row.roomTypeId) : "unassigned";
    const roomTypeName = row.roomTypeName || `Room Type ${roomTypeId}`;

    roomTypeMap[roomTypeId] = roomTypeName;
    selectedRooms[roomTypeId] = [...(selectedRooms[roomTypeId] || []), roomNumber];

    paxRooms.push({
      name: roomNumber,
      roomTypeId,
      roomTypeName,
    });

    return {
      roomNo: roomNumber,
      roomType: roomTypeName,
      roomTypeId,
      quantity: 1,
      price: Number(row.tariff || 0),
      gst: row.gstPercent,
      unitLabel: row.unitLabel || "PER NIGHT",
    };
  });

  const totalAmount = roomTariff.reduce((sum, row) => {
    const base = Number(row.price || 0) * Number(row.quantity || 0);
    return sum + base + (base * Number(row.gst || 0)) / 100;
  }, 0);

  const paidAmount = Number(advance?.amount || 0);
  const discountAmount = 0;

  return {
    bookingId: source?.bookingId || Number(id),
    bookingCode: source?.bookingCode || "",
    guest: booking
      ? {
          agentBooking: false,
          bookingPoint: "",
          mobile: (guestProfile && guestProfile.mobile) || (source && source.mobile) || "",
          guestName,
          guestEmail: (guestProfile && guestProfile.guest_email) || (source && source.guest_email) || "",
          checkIn: booking.check_in || "",
          checkOut: booking.check_out || "",
          arrival: "12:00",
          departure: "10:00",
          bookingStatus: (source && source.booking_status) || "Pending",
        }
      : {
          agentBooking: false,
          bookingPoint: "",
          mobile: (guestProfile && guestProfile.mobile) || "",
          guestName,
          guestEmail: (guestProfile && guestProfile.guest_email) || "",
          checkIn: "",
          checkOut: "",
          arrival: "12:00",
          departure: "10:00",
          bookingStatus: "Pending",
        },
    otherBooking: {
      bookingType: "",
      bookingSource: (source && source.source_name) || "",
      bookingSourceType: (source && source.source_type) || "",
      bookingReference: "",
      address: (guestProfile && guestProfile.address) || (source && source.address) || "",
      country: (guestProfile && guestProfile.country) || (source && source.country) || "",
      state: (guestProfile && guestProfile.state) || (source && source.state) || "",
      city: (guestProfile && guestProfile.city) || (source && source.city) || "",
      pincode: (guestProfile && guestProfile.pincode) || (source && source.pincode) || "",
    },
    reference: {
      guestType: "",
      guestNotes: specialRequest ? specialRequest.description || "" : "",
      internalNotes: "",
    },
    company: {
      companyName: "Direct Booking",
      gst: "",
    },
    roomSelection: {
      selectedRooms,
      roomTypeMap,
    },
    pax: {
      rooms: paxRooms,
      paxData: paxByRoom,
    },
    roomTariff: {
      rows: roomTariff,
      totalAmount,
    },
    advance: {
      paidAmount,
      discountAmount,
      paymentMode: advance?.payment_mode || "Cash",
      notes: advance?.reference_no || "",
      totalAmount,
      remainingAmount: Math.max(totalAmount - paidAmount - discountAmount, 0),
    },
  };
};

const updateRoomsForBooking = async (booking, nextStatus) => {
  const roomNumbers = String(booking?.rooms || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const roomNumber of roomNumbers) {
    if (nextStatus === "Checked In") {
      await roomInventoryModel.updateRoomOperationalState({
        roomNumber,
        guestName: booking.guest_name || null,
        status: "Occupied",
        checkIn: booking.check_in || null,
        checkOut: booking.check_out || null,
      });

      await query(
        "UPDATE housekeeping SET status = ? WHERE CAST(roomNo AS CHAR) = CAST(? AS CHAR)",
        ["Occupied Dirty", roomNumber],
      );
      continue;
    }

    await roomInventoryModel.updateRoomOperationalState({
      roomNumber,
      guestName: null,
      status: "Cleaning",
      checkIn: null,
      checkOut: null,
    });

    await query(
      "UPDATE housekeeping SET status = ? WHERE CAST(roomNo AS CHAR) = CAST(? AS CHAR)",
      ["Vacant Dirty", roomNumber],
    );
  }
};

// ─── ID proof helpers ─────────────────────────────────────────────────────────
// guest_identifications.id_type is ENUM('aadhaar','passport','driving_license',
// 'voter_id','other'), but the New Booking form presents human labels
// (BookingFlow.jsx ID_PROOF_TYPE_OPTIONS: "Aadhar Card", "Voter ID", ...).
// On this non-strict server MySQL silently coerces an unrecognised enum value
// to '' rather than erroring, which is exactly why the ID Proof used to come
// back blank. Map the label onto its enum member, storing the original label
// separately so the UI can keep showing what the user picked.
const mapIdProofLabelToEnum = (label) => {
  const key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (!key) return "other";
  if (["aadhar", "aadharcard", "aadharnumber", "adhaar", "adharcard", "uid", "uidai"].includes(key))
    return "aadhaar";
  if (["passport", "passportnumber"].includes(key)) return "passport";
  if (["drivinglicense", "drivinglicence", "dl", "dlno", "dlc"].includes(key))
    return "driving_license";
  if (["voterid", "voter", "voteridcard", "electioncard", "epic"].includes(key)) return "voter_id";
  if (["pan", "pancard", "pannumber"].includes(key)) return "other";
  return "other";
};

exports.createGuest = async (req, res) => {
  const bookedBy =
    (req.user && (req.user.name || req.user.email)) ||
    (req.body && (req.body.bookedBy || req.body.booked_by)) ||
    "";

  const body = req.body || {};
  if (!body.guestName && !body.guest_name && !body.phone) {
    return res.status(400).json({ message: "guestName, guest_name or phone is required" });
  }
  if (!body.checkIn && !body.check_in) {
    return res.status(400).json({ message: "checkIn is required" });
  }

  try {
    const body = req.body || {};
    const statusMap = {
      cancelled: "cancelled",
      "checked in": "checked_in",
      checked_in: "checked_in",
      "checked out": "checked_out",
      checked_out: "checked_out",
      confirmed: "confirmed",
      inquiry: "inquiry",
      reserved: "reserved",
    };
    const status =
      statusMap[String(body.bookingStatus || "").trim().toLowerCase()] || "confirmed";

    const bookingCode = `BK-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;

    const [bookingResult] = await db.query(
      `INSERT INTO bookings
         (booking_code, status, check_in, check_out, adults, children, total_rooms, total_guests, special_requests, created_by)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
      [
        bookingCode,
        status,
        body.checkIn || null,
        body.checkOut || null,
        Number(body.adults || body.pax || 1),
        Number(body.adults || body.pax || 1),
        body.specialRequests || body.special_requests || null,
        req.user?.id || null,
      ],
    );

    const bookingId = bookingResult.insertId;

    // Guest identity lives in guest_profiles in v4; phone is required.
    const fullName = String(body.guestName || body.guest_name || "").trim();
    const [firstName, ...restName] = fullName.split(/\s+/);
    const lastName = restName.join(" ") || null;
    const mobile = String(body.mobile || body.phone || "").trim();

    if (firstName || mobile) {
      const [guestResult] = await db.query(
        `INSERT INTO guest_profiles (first_name, last_name, email, phone)
         VALUES (?, ?, ?, ?)`,
        [firstName || "Guest", lastName, body.guestEmail || body.email || null, mobile || null],
      );
      await db.query(
        `INSERT INTO booking_guests (booking_id, guest_profile_id, is_primary, first_name, last_name)
         VALUES (?, ?, 1, ?, ?)`,
        [bookingId, guestResult.insertId, firstName || "Guest", lastName],
      );

      // ID proof / ID number. The frontend sends these as `idProofType` and
      // `idProofNumber` (BookingFlow.jsx) and displays them back from
      // `id_proof_type` / `id_proof_number` on /hotel/full-booking/:id.
      // Nothing in this controller used to read them, so the values were
      // dropped on the floor at insert time and the Guest Information panel
      // always rendered "-" no matter what the user typed.
      //
      // The UI offers human-readable labels ("Aadhar Card", "Voter ID"), but
      // guest_identifications.id_type is an ENUM of
      // ('aadhaar','passport','driving_license','voter_id','other'). MySQL
      // silently coerces an unknown enum value to '' on this non-strict
      // server, which is how the ID proof used to come back blank — so the
      // label is mapped to its enum member here and the original label is
      // what the frontend already shows.
      const idProofLabel = String(
        body.idProofType || body.id_proof_type || body.idProof || "",
      ).trim();
      const idProofNumber = String(
        body.idProofNumber || body.id_proof_number || body.idNumber || "",
      ).trim();

      if (idProofNumber || idProofLabel) {
        const idType = mapIdProofLabelToEnum(idProofLabel);
        await db.query(
          `INSERT INTO guest_identifications
             (booking_id, guest_profile_id, id_type, id_number)
           VALUES (?, ?, ?, ?)`,
          [
            bookingId,
            guestResult.insertId,
            idType,
            idProofNumber || null,
          ],
        );
      }
    }

    // v4: also persist the room the user selected so booking_rooms, and
    // therefore the invoice, has the room line. Without this the invoice
    // shows an empty room_no and no line items — the room is booked but
    // the booking_rooms row is never written by createGuest.
    if (body.roomNumber) {
      // `query` unwraps mysql2's [rows, fields] tuple; a bare `await db.query`
      // would leave roomRows holding the OkPacket/tuple instead of the rows.
      const roomRows = await query(
        `SELECT r.id AS room_id, r.category_id
         FROM rooms r
         WHERE CAST(r.room_number AS CHAR) = CAST(? AS CHAR)
         LIMIT 1`,
        [String(body.roomNumber).trim()],
      );
      if (roomRows[0]) {
        const tariff = Number(body.tariff || body.price || body.roomCharge || 0);
        const nights = (() => {
          const ci = new Date(body.checkIn);
          const co = new Date(body.checkOut);
          return Math.max(1, Math.round((co - ci) / (1000 * 60 * 60 * 24)));
        })();
        const total = tariff * nights;
        await query(
          `INSERT INTO booking_rooms
             (booking_id, room_id, category_id, rate_per_night, nights, room_charge, total, guest_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingId,
            roomRows[0].room_id,
            roomRows[0].category_id,
            tariff,
            nights,
            total,
            total,
            fullName || null,
          ],
        );
      }
    }

    await recomputeBookingTotals(bookingId);

    const result = { insertId: bookingId, bookingCode };

    // Auto-send booking confirmation WhatsApp to customer + admin
    if (bookingId) {
      setImmediate(async () => {
        try {
          const InvoiceModel = require("../models/InvoiceModel");
          const invoice = await InvoiceModel.generateCustomerInvoice(bookingId);
          if (!invoice) return;

          const guestName = invoice.customerName || "Valued Guest";
          const bookingNo = invoice.bookingCode || `#${bookingId}`;
          const fmtDate = (d) => {
            if (!d) return "—";
            const s = String(d);
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
            const dt = new Date(s);
            if (isNaN(dt)) return s;
            return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
          };
          const checkIn = fmtDate(invoice.checkIn);
          const checkOut = fmtDate(invoice.checkOut);
          const bookingDate = fmtDate(new Date());

          // Pull room type names from the v4 booking_rooms / room_categories —
          // the invoice model doesn't carry roomCategory / roomType, so we join directly.
          const roomTypeRows = await new Promise((resolve, reject) => {
            db.query(
              `
                SELECT DISTINCT rc.name AS roomTypeName
                FROM booking_rooms br
                LEFT JOIN room_categories rc ON rc.id = br.category_id
                WHERE br.booking_id = ?
                  AND rc.name IS NOT NULL
              `,
              [bookingId],
              (err, rows) => (err ? reject(err) : resolve(rows)),
            );
          });
          const roomTypeList = roomTypeRows.map((r) => r.roomTypeName);
          const roomType =
            roomTypeList.length > 0
              ? roomTypeList.join(", ")
              : "—";
          const roomNumbers = String(invoice.roomNumber || "").trim();
          const total = Number(invoice.totalAmount || 0);

          // Compute total same way the frontend does (getFullBooking):
          // tariff * qty * nights + GST per night * nights
          let swTotal = total;
          let advanceAmount = 0;
          try {
            const guestRow = await new Promise((resolve, reject) => {
              db.query(
                "SELECT check_in, check_out FROM bookings WHERE id = ? LIMIT 1",
                [bookingId],
                (err, rows) => (err ? reject(err) : resolve(rows)),
              );
            });
            const nights =
              guestRow[0]?.check_in && guestRow[0]?.check_out
                ? Math.max(
                    Math.round(
                      (new Date(guestRow[0].check_out) - new Date(guestRow[0].check_in)) /
                        (1000 * 60 * 60 * 24),
                    ),
                    1,
                  )
                : 1;
            const tariffRows = await new Promise((resolve, reject) => {
              db.query(
                // Legacy rows stored before the column defaulted the rate to 0;
                // room rent bills at 5%, so a NULL/0 reads back as 5.
                "SELECT rate_per_night AS tariff, COALESCE(NULLIF(gst_percent, 0), 5) AS gst, 1 AS quantity FROM booking_rooms WHERE booking_id = ?",
                [bookingId],
                (err, rows) => (err ? reject(err) : resolve(rows)),
              );
            });
            if (tariffRows.length) {
              swTotal = tariffRows.reduce((sum, r) => {
                const base = Number(r.tariff || 0) * Number(r.quantity || 1);
                const gstAmt = (base * Number(r.gst || 0)) / 100;
                return sum + (base + gstAmt) * nights;
              }, 0);
            }
          } catch { /* keep invoice total as fallback */ }

          try {
            const advanceRows = await new Promise((resolve, reject) => {
              db.query(
                "SELECT amount FROM payments WHERE booking_id = ? AND status = 'completed' AND payment_type <> 'refund' LIMIT 1",
                [bookingId],
                (err, rows) => (err ? reject(err) : resolve(rows)),
              );
            });
            if (advanceRows.length) advanceAmount = Number(advanceRows[0].amount || 0);
          } catch { /* ignore */ }

          // Fallback: if invoice total is 0/missing, use advance amount as minimum
          const effectiveTotal = swTotal > 0 ? swTotal : Math.max(total, advanceAmount || 0);
          const balance = Math.max(effectiveTotal - advanceAmount, 0);
          const formattedAdvance = advanceAmount > 0 ? `₹ ${advanceAmount.toFixed(0)}` : "₹ 0";
          const formattedBalance = balance > 0 ? `₹ ${balance.toFixed(0)}` : "₹ 0";
          const formattedTotal = effectiveTotal > 0 ? `₹ ${effectiveTotal.toFixed(0)}` : "—";
          const priceDisplay = effectiveTotal > 0 ? `₹ ${effectiveTotal.toFixed(0)} Par Day` : "—";
          const confirmedByName = bookedBy || "";
          const rawBookingType = req.body?.bookingType || invoice.bookingType || "";
          const bookingTypeMap = { "walk-in": "Walk-in", via: "Via", online: "Online" };
          const bookingTypeStr = bookingTypeMap[rawBookingType.trim().toLowerCase()] || rawBookingType || "Walk-in";

          const customerMessage =
            `🏨 *MAA BAGLAMUKHI RESORT*\n` +
            `📍 Nalkheda\n\n` +
            `✅ *BOOKING CONFIRMED*\n\n` +
            `Dear *${guestName}*,\n` +
            `Thank you for choosing Maa Baglamukhi Resort. Your booking has been confirmed.\n\n` +
            `📋 *Booking Details:*\n` +
            `• Booking No: *${bookingNo}*\n` +
            `• Booking Date: *${bookingDate}*\n` +
            `• Guest Name: ${guestName}\n` +
            `• Mobile: ${invoice.phone || "—"}\n` +
            `• Booking Confirmed By: *${confirmedByName}*\n\n` +
            `🏠 *Room Details:*\n` +
            `• Room Type: *${roomType}*\n` +
            `• Booking Type: ${bookingTypeStr || "Walk-in"}\n\n` +
            `📅 *Stay Details:*\n` +
            `• Check-In Date: *${checkIn}*\n` +
            `• Check-In Time: ${invoice.arrival || "12:00"}\n` +
            `• Check-Out Date: *${checkOut}*\n` +
            `• Check-Out Time: ${invoice.departure || "11:00"}\n\n` +
            `💰 *Payment Summary:*\n` +
            `• Total Amount: *${formattedTotal}*\n` +
            `• Advance Paid: *${formattedAdvance}*\n` +
            `• Balance Due: *${formattedBalance}*\n\n` +
            `📌 *Important Notes:*\n` +
            `• Your room number will be assigned at check-in.\n` +
            `• Please carry a valid ID proof at the time of check-in.\n` +
            `• Balance (if any) to be paid at check-in.\n\n` +
            `For any queries, please contact us.\n\n` +
            `Warm regards,\n` +
            `*Maa Baglamukhi Resort*\n` +
            `📞 Nalkheda`;

          const adminMessage =
            `✅ *New Booking Confirmed*\n\n` +
            `Booking No: ${bookingNo}\n` +
            `Booking Date: ${bookingDate}\n` +
            `Guest: ${guestName}\n` +
            `Phone: ${invoice.phone || "—"}\n` +
            `Room: ${roomType}\n` +
            `Rooms: ${invoice.noOfRooms || 1}\n` +
            `Confirmed By: ${confirmedByName}\n` +
            `Check-in: ${checkIn} at ${invoice.arrival || "12:00"}\n` +
            `Check-out: ${checkOut} at ${invoice.departure || "12:00"}\n` +
            `Total: ${formattedTotal}\n` +
            `Advance: ${formattedAdvance}\n` +
            `Balance: ${formattedBalance}`;

          const customerNumber = invoice.phone || invoice.mobileNumber || "";
          let adminNumber = "";
          try {
            // `register` is the money ledger, not a user table — the old query
            // "FROM register WHERE role='admin'" always errored and was
            // silently ignored. The real admin phone lives in users/roles.
            const adminRows = await new Promise((resolve, reject) => {
              db.query(
                `SELECT u.phone
                 FROM users u
                 LEFT JOIN roles r ON r.id = u.role_id
                 WHERE LOWER(IFNULL(r.name, '')) = 'admin'
                   AND u.phone IS NOT NULL AND TRIM(u.phone) <> ''
                 ORDER BY u.id ASC LIMIT 1`,
                (err, rows) => (err ? reject(err) : resolve(rows)),
              );
            });
            adminNumber = adminRows?.[0]?.phone || "";
          } catch { /* ignore */ }
          if (!adminNumber) {
            adminNumber = process.env.ADMIN_WHATSAPP_NUMBER || "";
          }

          // Text-only confirmation (no PDF/invoice attachment), per the
          // resort's requirement: just the booking confirmation message.
          const customerResult = customerNumber
            ? await WhatsAppService.sendWhatsAppMessage({ number: customerNumber, message: customerMessage })
            : { ok: false, skipped: true, reason: "No customer phone number" };
          const adminResult = adminNumber
            ? await WhatsAppService.sendWhatsAppMessage({ number: adminNumber, message: adminMessage })
            : { ok: false, skipped: true, reason: "Admin number not configured" };
          console.log(
            `[auto-confirm] booking ${bookingId} — customer ${customerResult.ok ? "sent" : customerResult.skipped ? "skipped (" + (customerResult.reason || "no number") + ")" : "FAILED (" + (customerResult.error || customerResult.statusCode || "gateway") + ")"}` +
            `, admin ${adminResult.ok ? "sent" : adminResult.skipped ? "skipped (" + (adminResult.reason || "not configured") + ")" : "FAILED (" + (adminResult.error || adminResult.statusCode || "gateway") + ")"}`,
          );
        } catch (autoErr) {
          console.error("[auto-confirm] failed for booking", bookingId, autoErr.message || autoErr);
        }
      });
    }

    res.json({
      message: "Guest Created",
      bookingId,
      bookingCode: result.bookingCode,
    });
  } catch (err) {
    console.error("[createGuest] DB error:", err);
    res.status(500).json({
      message: "Guest creation failed",
      error: err.message,
      code: err.code,
      sqlState: err.sqlState,
      errno: err.errno,
    });
  }
};

exports.updateOtherBooking = async (req, res) => {
  const data = {
    guest_id: req.params.id,
    booking_id: req.params.id,
    ...req.body,
  };

  try {
    // v4: booking source / type map onto booking_sources, and the address onto
    // the primary guest profile. There is no other_booking table any more.
    const sourceName = String(data.booking_source || data.booking_type || "").trim();
    if (sourceName) {
      const existingSource = await query(
        "SELECT id FROM booking_sources WHERE name = ? LIMIT 1",
        [sourceName],
      );
      let sourceId = existingSource[0]?.id;
      if (!sourceId) {
        const [inserted] = await db.query(
          "INSERT INTO booking_sources (name, type, is_active) VALUES (?, 'other', 1)",
          [sourceName],
        );
        sourceId = inserted.insertId;
      }
      if (sourceId) {
        await query("UPDATE bookings SET source_id = ? WHERE id = ?", [sourceId, data.booking_id]);
      }
    }

    if (data.address || data.city || data.state || data.pincode || data.country) {
      await query(
        `
          UPDATE guest_profiles gp
          JOIN booking_guests bg ON bg.guest_profile_id = gp.id
          SET gp.address_line1 = COALESCE(?, gp.address_line1),
              gp.city          = COALESCE(?, gp.city),
              gp.state         = COALESCE(?, gp.state),
              gp.pincode       = COALESCE(?, gp.pincode),
              gp.country       = COALESCE(?, gp.country)
          WHERE bg.booking_id = ?
            AND bg.is_primary = 1
        `,
        [
          data.address || null,
          data.city || null,
          data.state || null,
          data.pincode || null,
          data.country || null,
          data.booking_id,
        ],
      );
    }

    res.json({ message: "Other Booking Saved" });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Other booking save failed:", err);
    }
    res.status(500).json({ message: "Other booking failed" });
  }
};

exports.updateReference = async (req, res) => {
  const data = { booking_id: req.params.id, ...req.body };

  try {
    // v4: reference free-text is stored as a special_requests note.
    const noteText =
      [data.guest_notes, data.internal_notes].filter(Boolean).join("\n") || null;
    const existing = await query(
      "SELECT id FROM special_requests WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
      [data.booking_id],
    );

    if (existing.length) {
      await query("UPDATE special_requests SET description = ? WHERE id = ?", [
        noteText,
        existing[0].id,
      ]);
    } else if (noteText) {
      await query(
        "INSERT INTO special_requests (booking_id, request_type, description, status) VALUES (?, 'other', ?, 'pending')",
        [data.booking_id, noteText],
      );
    }

    res.json({ message: "Reference Saved" });
  } catch (err) {
    res.status(500).json({ message: "Reference save failed" });
  }
};

exports.updateCompany = async (req, res) => {
  const data = { booking_id: req.params.id, ...req.body };

  if (!data.companyName && !data.company_name) {
    return res.status(400).json({
      message: "Company name is required",
    });
  }

  try {
    // v4 dropped the `companies` table. Preserve the value by registering the
    // company as a booking source and keeping the address on the guest profile.
    const companyName = data.companyName || data.company_name || "Direct Booking";

    const existingSource = await query(
      "SELECT id FROM booking_sources WHERE name = ? LIMIT 1",
      [companyName],
    );
    let sourceId = existingSource[0]?.id;
    if (!sourceId) {
      const [inserted] = await db.query(
        "INSERT INTO booking_sources (name, type, is_active) VALUES (?, 'corporate', 1)",
        [companyName],
      );
      sourceId = inserted.insertId;
    }

    if (sourceId) {
      await query("UPDATE bookings SET source_id = ? WHERE id = ?", [sourceId, data.booking_id]);
    }

    if (data.address || data.city || data.state || data.pincode || data.country) {
      await query(
        `
          UPDATE guest_profiles gp
          JOIN booking_guests bg ON bg.guest_profile_id = gp.id
          SET gp.address_line1 = COALESCE(?, gp.address_line1),
              gp.city          = COALESCE(?, gp.city),
              gp.state         = COALESCE(?, gp.state),
              gp.pincode       = COALESCE(?, gp.pincode),
              gp.country       = COALESCE(?, gp.country)
          WHERE bg.booking_id = ?
            AND bg.is_primary = 1
        `,
        [
          data.address || null,
          data.city || null,
          data.state || null,
          data.pincode || null,
          data.country || null,
          data.booking_id,
        ],
      );
    }

    res.json({
      message: "Company Added",
      id: sourceId || null,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Company save failed:", err);
    }

    res.status(500).json({
      message: "Company save failed",
      error: err.message,
    });
  }
};

exports.updatePax = async (req, res) => {
  const data = { booking_id: req.params.id, ...req.body };
  const bookingId = Number(req.params.id);
  const roomNumber = String(data.room_number || data.roomNumber || "").trim();

  try {
    // v4: pax counts live on booking_rooms (adults / children).
    if (!roomNumber) {
      return res.status(400).json({ message: "Room number required" });
    }

    const roomRows = await query(
      "SELECT id FROM rooms WHERE CAST(room_number AS CHAR) = CAST(? AS CHAR) LIMIT 1",
      [roomNumber],
    );
    const roomId = roomRows[0]?.id;
    if (!roomId) {
      return res.status(404).json({ message: `Room ${roomNumber} not found in inventory` });
    }

    // `guestCapacity` is the form field ("Adults + Children"). When the caller
    // only supplies that (as the New Booking flow does), split it across the
    // booking's rooms so a 4-person booking over 2 rooms records 2 adults each
    // instead of silently defaulting every line to 1.
    const roomCountRow = await query(
      "SELECT COUNT(*) AS n FROM booking_rooms WHERE booking_id = ?",
      [bookingId],
    );
    const roomCount = Number(roomCountRow[0]?.n || 0) || 1;

    const hasExplicitCounts =
      data.adults !== undefined && data.adults !== null && data.adults !== "";
    const capacity = Number(data.guestCapacity);
    const adults = hasExplicitCounts
      ? Number(data.adults) || 1
      : Number.isFinite(capacity) && capacity > 0
        ? Math.max(1, Math.floor(capacity / roomCount))
        : 1;
    const children = Number(data.children || 0);

    const updated = await query(
      `UPDATE booking_rooms SET adults = ?, children = ?
       WHERE booking_id = ? AND room_id = ?`,
      [adults, children, bookingId, roomId],
    );

    if (!updated.affectedRows) {
      return res.status(404).json({ message: "No room line found for this booking" });
    }

    res.json({ message: "Pax Added" });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("updatePax failed:", err);
    }
    res.status(500).json({ message: "Pax save failed" });
  }
};

exports.updateTariff = async (req, res) => {
  const data = { booking_id: req.params.id, ...req.body };
  const bookingId = Number(req.params.id);
  const roomNumber = String(data.room_number || data.roomNumber || "").trim();

  if (!roomNumber) {
    return res.status(400).json({ message: "Room number required" });
  }

  try {
    // OVERLAP CHECK: prevent double-booking the same room for overlapping dates.
    const guestRows = await query(
      "SELECT check_in, check_out FROM bookings WHERE id = ? LIMIT 1",
      [bookingId],
    );

    if (guestRows.length && guestRows[0].check_in && guestRows[0].check_out) {
      const checkIn = toDateOnly(guestRows[0].check_in);
      const checkOut = toDateOnly(guestRows[0].check_out);

      if (checkIn && checkOut) {
        const roomInventoryModel = require("../models/hotelRoomInventoryModel");
        const overlap = await roomInventoryModel.validateRoomAvailability({
          roomNumbers: [roomNumber],
          checkIn,
          checkOut,
          excludeBookingId: bookingId,
        });

        if (!overlap.available && overlap.conflicts.length) {
          const conflict = overlap.conflicts[0];
          return res.status(409).json({
            message: `Room ${conflict.roomNumber} is already occupied from ${toDateOnly(conflict.check_in)} to ${toDateOnly(conflict.check_out)} by ${conflict.guest_name || "another guest"}. This room is not available for the selected dates.`,
            conflict: conflict,
          });
        }
      }
    }

    // v4: room lines live in booking_rooms. Resolve the room + its category,
    // then upsert the line for this booking/room.
    const roomRows = await query(
      "SELECT r.id AS room_id, r.category_id FROM rooms r WHERE CAST(r.room_number AS CHAR) = CAST(? AS CHAR) LIMIT 1",
      [roomNumber],
    );

    const resolvedRoom = roomRows[0] || null;
    if (!resolvedRoom) {
      return res.status(404).json({ message: `Room ${roomNumber} not found in inventory` });
    }

    const tariff = Number(data.tariff || data.price || 0);
    const total = Number(data.total || 0) || tariff;
    // The booking form's "Room & Tariff Details" section sends gstPercent per
    // row; it used to be dropped here, so a room saved at 5% GST read back
    // as 0 on edit. Persist it so the entered rate survives a save/reload.
    const gstPercent = Number(data.gstPercent ?? data.gst ?? 0);
    const existingRoomLine = await query(
      "SELECT id FROM booking_rooms WHERE booking_id = ? AND room_id = ? LIMIT 1",
      [bookingId, resolvedRoom.room_id],
    );

    if (existingRoomLine.length) {
      await query(
        `UPDATE booking_rooms
         SET rate_per_night = ?, total = ?, gst_percent = ?
         WHERE id = ?`,
        [tariff, total, gstPercent, existingRoomLine[0].id],
      );
    } else {
      await query(
        `INSERT INTO booking_rooms
           (booking_id, room_id, category_id, rate_per_night, nights, room_charge, total, guest_name, gst_percent)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          bookingId,
          resolvedRoom.room_id,
          resolvedRoom.category_id,
          tariff,
          tariff,
          total,
          data.guest_name || data.guestName || null,
          gstPercent,
        ],
      );
    }

    await recomputeBookingTotals(bookingId);

    res.json({ message: "Tariff Added" });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("updateTariff failed:", error);
    }
    res.status(500).json({ message: "Tariff save failed", error: error.message });
  }
};

exports.getAllBookings = async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        b.id AS bookingId,
        b.booking_code AS bookingCode,
        ${resolveGuestName} AS guest_name,
        pg.mobile,
        pg.guest_email,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
        b.status AS booking_status,
        NULL AS company_name,
        NULL AS bookingType,
        COALESCE(bt.totalAmount, 0) AS totalAmount,
        IFNULL(pay.paidAmount, 0) AS paidAmount,
        0 AS discountAmount,
        IFNULL(pay.refundAmount, 0) AS refundAmount,
        COALESCE(NULLIF(pm.name, ''), 'Pending') AS paymentMode,
        (IFNULL(pay.paidAmount, 0) - IFNULL(pay.refundAmount, 0)) AS netPaid,
        (
          COALESCE(bt.totalAmount, 0) -
          (IFNULL(pay.paidAmount, 0) - IFNULL(pay.refundAmount, 0))
        ) AS remainingAmount,
        COALESCE(NULLIF(rms.rooms, ''), '') AS rooms,
        COALESCE(NULLIF(rms.rooms, ''), '') AS roomDetails
      FROM bookings b
      ${primaryGuestJoin}
      ${roomGuestJoin}
      ${roomsJoin}
      ${paymentsJoin}
      ${bookingRoomsTotalJoin}
      WHERE LOWER(IFNULL(b.status, 'confirmed')) NOT IN ('checked_out', 'cancelled')
      ORDER BY b.id DESC
    `);

    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getBookingById = async (req, res) => {
  try {
    const result = await query(
      `
        SELECT
          b.id AS bookingId,
          b.booking_code AS bookingCode,
          b.booking_code,
          ${resolveGuestName} AS guest_name,
          pg.mobile,
          pg.guest_email,
          DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
          DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
          b.status AS booking_status,
          b.adults,
          b.children,
          b.infants,
          b.total_rooms,
          b.total_guests,
          b.subtotal,
          b.tax_amount,
          b.total_amount,
          b.advance_amount,
          b.balance_amount,
          b.currency,
          b.special_requests,
          b.cancellation_reason AS cancel_reason,
          b.created_at,
          rms.rooms
        FROM bookings b
        ${primaryGuestJoin}
        ${roomGuestJoin}
        ${roomsJoin}
        WHERE b.id = ?
        LIMIT 1
      `,
      [req.params.id],
    );
    res.json(result[0] || null);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getBookingWizard = async (req, res) => {
  try {
    const payload = await getBookingWizardDataById(req.params.id);
    res.json(payload);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Booking wizard fetch failed:", error);
    }
    res.status(500).json({ message: "Booking wizard fetch failed", error: error.message });
  }
};

exports.updateBooking = async (req, res) => {
  const { guest_name, mobile } = req.body;
  const id = req.params.id;

  try {
    // Guest name lives on booking_rooms in v4 — keep the room lines in sync.
    if (guest_name !== undefined) {
      await query("UPDATE booking_rooms SET guest_name = ? WHERE booking_id = ?", [
        guest_name || null,
        id,
      ]);
    }

    // Phone lives on guest_profiles; refresh the primary linked guest profile.
    if (mobile !== undefined) {
      await query(
        `
          UPDATE guest_profiles gp
          JOIN booking_guests bg ON bg.guest_profile_id = gp.id
          SET gp.phone = ?
          WHERE bg.booking_id = ?
            AND bg.is_primary = 1
        `,
        [String(mobile || "").trim() || null, id],
      );
    }

    res.json({ message: "Updated Successfully" });
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getFullBooking = async (req, res) => {
  const id = req.params.id;

  try {
    const summaryResult = await query(
      `
        SELECT
          b.id AS bookingId,
          b.booking_code AS bookingCode,
          b.booking_code,
          ${resolveGuestName} AS guest_name,
          pg.mobile,
          pg.guest_email,
          DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
          DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
          '12:00' AS arrival,
          '10:00' AS departure,
          b.status AS booking_status,
          bs.type AS bookingType,
          bs.name AS bookingSource,
          NULL AS bookingReference,
          pg.address,
          sr.description AS guest_notes,
          NULL AS internal_notes,
          NULL AS company_name,
          NULL AS company_gst,
          IFNULL(pay.paidAmount, 0) AS paidAmount,
          0 AS discountAmount,
          IFNULL(pay.refundAmount, 0) AS refundAmount,
          COALESCE(NULLIF(pm.name, ''), 'Pending') AS paymentMode,
          NULL AS paymentRemarks,
          COALESCE(bt.totalAmount, 0) AS totalAmount,
          (
            COALESCE(bt.totalAmount, 0) -
            (IFNULL(pay.paidAmount, 0) - IFNULL(pay.refundAmount, 0))
          ) AS remainingAmount,
          brp.adults,
          brp.children,
          gid.id_proof_type,
          gid.id_proof_number
        FROM bookings b
        LEFT JOIN booking_sources bs ON bs.id = b.source_id
        LEFT JOIN special_requests sr ON sr.booking_id = b.id
        ${primaryGuestJoin}
        ${roomGuestJoin}
        ${guestIdJoin}
        ${paymentsJoin}
        ${bookingRoomsTotalJoin}
        LEFT JOIN (
          SELECT booking_id,
                 IFNULL(SUM(adults), 0) AS adults,
                 IFNULL(SUM(children), 0) AS children
          FROM booking_rooms
          GROUP BY booking_id
        ) brp ON brp.booking_id = b.id
        WHERE b.id = ?
        LIMIT 1
      `,
      [id],
    );

    const roomsResult = await query(
      `
        SELECT
          COALESCE(r.room_number, br.guest_name, CONCAT('Room #', br.id)) AS room_number,
          IFNULL(r.id, br.room_id) AS roomId,
          rc.name AS roomType,
          br.rate_per_night AS tariff,
          -- Rows written before the gst_percent column landed are 0; the
          -- resort bills room rent at 5% GST, so read those back as 5.
          COALESCE(NULLIF(br.gst_percent, 0), 5) AS gst,
          br.total,
          1 AS quantity,
          br.adults,
          br.children,
          'EP' AS meal_plan,
          br.guest_name,
          br.notes
        FROM booking_rooms br
        LEFT JOIN rooms r            ON r.id = br.room_id
        LEFT JOIN room_categories rc ON rc.id = br.category_id
        WHERE br.booking_id = ?
        ORDER BY r.room_number ASC, br.id ASC
      `,
      [id],
    );

    // Aggregate guestCapacity (sum of adults + children across all room lines)
    const summary = summaryResult[0] || {};
    const paxSum = {
      adults: Number(summary.adults || 0),
      children: Number(summary.children || 0),
    };
    const guestCapacity = `${paxSum.adults + paxSum.children} (${paxSum.adults} Adults + ${paxSum.children} Children)`;

    const nights =
      summary.check_in && summary.check_out
        ? Math.max(
            Math.round(
              (new Date(summary.check_out) - new Date(summary.check_in)) / (1000 * 60 * 60 * 24),
            ),
            1,
          )
        : 1;

    // Recompute total per-row AND overall total using per-night tariff * nights * qty + GST
    const enrichedRooms = (roomsResult || []).map((row) => {
      const tariff = Number(row.tariff || 0);
      const qty = Number(row.quantity || 1);
      const gst = Number(row.gst || 0);
      const perNightBase = tariff * qty;
      const perNightGst = (perNightBase * gst) / 100;
      const rowTotal = perNightBase * nights + perNightGst * nights;
      return {
        ...row,
        nights,
        rowTotal,
      };
    });

    const storedTotal = Number(summary.totalAmount || 0);
    const recalculatedTotal = enrichedRooms.reduce(
      (sum, r) => sum + Number(r.rowTotal || 0),
      0,
    );

    res.json({
      ...summary,
      guestCapacity,
      nights,
      rooms: enrichedRooms,
      // If we have enriched rows, prefer the recalculated multi-night total
      totalAmount: recalculatedTotal > 0 ? recalculatedTotal : storedTotal,
    });
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.updateFullBooking = async (req, res) => {
  const id = req.params.id;
  const {
    guest_name,
    guest_email,
    mobile,
    company_name,
    rooms,
    paidAmount,
    discountAmount,
    paymentMode,
    paymentRemarks,
    checkIn,
    checkOut,
    arrival,
    departure,
    bookingType,
    bookingSource,
    bookingReference,
    address,
    guestNotes,
    internalNotes,
    idProofType,
    idProofNumber,
  } = req.body;

  const roomList = Array.isArray(rooms)
    ? rooms
    : String(rooms || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  try {
    // OVERLAP CHECK for edit mode: validate rooms against new date range
    const roomNumbers = roomList
      .map((room) => String(room.room_number || room.roomNumber || "").trim())
      .filter(Boolean);

    let effectiveCheckIn = checkIn;
    let effectiveCheckOut = checkOut;
    if (!effectiveCheckIn || !effectiveCheckOut) {
      const currentGuestRows = await query(
        "SELECT check_in, check_out FROM bookings WHERE id = ? LIMIT 1",
        [id],
      );
      if (currentGuestRows.length) {
        effectiveCheckIn = effectiveCheckIn || currentGuestRows[0].check_in;
        effectiveCheckOut = effectiveCheckOut || currentGuestRows[0].check_out;
      }
    }

    if (roomNumbers.length && effectiveCheckIn && effectiveCheckOut) {
      // toDateOnly normalises both incoming strings and Date objects from MySQL.
      const overlapCheckIn = toDateOnly(effectiveCheckIn);
      const overlapCheckOut = toDateOnly(effectiveCheckOut);

      if (overlapCheckIn && overlapCheckOut) {
        const roomInventoryModel = require("../models/hotelRoomInventoryModel");
        const overlap = await roomInventoryModel.validateRoomAvailability({
          roomNumbers,
          checkIn: overlapCheckIn,
          checkOut: overlapCheckOut,
          excludeBookingId: Number(id),
        });

        if (!overlap.available && overlap.conflicts.length) {
          const conflict = overlap.conflicts[0];
          return res.status(409).json({
            message: `Room ${conflict.roomNumber} is already occupied from ${toDateOnly(conflict.check_in)} to ${toDateOnly(conflict.check_out)}. This room is not available for the selected dates.`,
            conflict: conflict,
          });
        }
      }
    }

    // Guest name is denormalised onto booking_rooms in v4; dates live on bookings.
    if (guest_name !== undefined) {
      await query("UPDATE booking_rooms SET guest_name = ? WHERE booking_id = ?", [
        guest_name || null,
        id,
      ]);
    }

    await query(
      `
        UPDATE bookings
        SET check_in = COALESCE(?, check_in),
            check_out = COALESCE(?, check_out),
            cancellation_reason = COALESCE(?, cancellation_reason)
        WHERE id = ?
      `,
      [checkIn ?? null, checkOut ?? null, null, id],
    );

    // Guest email / phone live on the primary linked guest profile.
    if (guest_email !== undefined || mobile !== undefined) {
      await query(
        `
          UPDATE guest_profiles gp
          JOIN booking_guests bg ON bg.guest_profile_id = gp.id
          SET gp.email = COALESCE(?, gp.email),
              gp.phone = COALESCE(?, gp.phone)
          WHERE bg.booking_id = ?
            AND bg.is_primary = 1
        `,
        [
          guest_email ?? null,
          mobile === undefined || mobile === null ? null : String(mobile).trim() || null,
          id,
        ],
      );
    }

    // Source type / name map onto booking_sources; keep the booking's source_id
    // pointing at an existing (or newly created) source row when provided.
    if (bookingSource || bookingType) {
      const sourceName = String(bookingSource || bookingType || "").trim();
      if (sourceName) {
        const existingSource = await query(
          "SELECT id FROM booking_sources WHERE name = ? LIMIT 1",
          [sourceName],
        );
        let sourceId = existingSource[0]?.id;
        if (!sourceId) {
          const [inserted] = await db.query(
            "INSERT INTO booking_sources (name, type, is_active) VALUES (?, 'other', 1)",
            [sourceName],
          );
          sourceId = inserted.insertId;
        }
        if (sourceId) {
          await query("UPDATE bookings SET source_id = ? WHERE id = ?", [sourceId, id]);
        }
      }
    }

    if (address !== undefined) {
      await query(
        `
          UPDATE guest_profiles gp
          JOIN booking_guests bg ON bg.guest_profile_id = gp.id
          SET gp.address_line1 = COALESCE(?, gp.address_line1)
          WHERE bg.booking_id = ?
            AND bg.is_primary = 1
        `,
        [address || null, id],
      );
    }

    // Payments are recorded in the v4 `payments` table.
    const paymentFieldsProvided =
      paidAmount !== undefined || discountAmount !== undefined || paymentMode !== undefined;

    if (paymentFieldsProvided && Number(paidAmount ?? 0) > 0) {
      const methodRows = await query(
        "SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(?) LIMIT 1",
        [paymentMode || "Cash"],
      );
      let methodId = methodRows[0]?.id;
      if (!methodId) {
        const fallback = await query("SELECT id FROM payment_methods ORDER BY id ASC LIMIT 1");
        methodId = fallback[0]?.id || null;
      }
      if (methodId) {
        await query(
          `INSERT INTO payments
             (booking_id, amount, payment_method_id, payment_type, reference_no, status)
           VALUES (?, ?, ?, 'payment', ?, 'completed')`,
          [
            id,
            Number(paidAmount ?? 0),
            methodId,
            paymentRemarks || null,
          ],
        );
      }
    }

    // Special requests absorb the legacy reference-notes free text.
    if (guestNotes || internalNotes) {
      const existingNote = await query(
        "SELECT id FROM special_requests WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
        [id],
      );
      const noteText = [guestNotes, internalNotes].filter(Boolean).join("\n") || null;
      if (existingNote.length) {
        await query("UPDATE special_requests SET description = ? WHERE id = ?", [
          noteText,
          existingNote[0].id,
        ]);
      } else {
        await query(
          "INSERT INTO special_requests (booking_id, request_type, description, status) VALUES (?, 'other', ?, 'pending')",
          [id, noteText],
        );
      }
    }

    if (roomList.length) {
      for (const room of roomList) {
        const roomNo = String(room.room_number || room.roomNumber || "").trim();
        const roomId = Number(room.roomId || room.id || 0);
        if (!roomNo && !roomId) continue;

        // Resolve the v4 room row so we can target the right booking_rooms line.
        let resolvedRoomId = roomId;
        if (!resolvedRoomId && roomNo) {
          const roomRows = await query(
            "SELECT id FROM rooms WHERE CAST(room_number AS CHAR) = CAST(? AS CHAR) LIMIT 1",
            [roomNo],
          );
          resolvedRoomId = roomRows[0]?.id || null;
        }

        const target = await query(
          `
            SELECT id FROM booking_rooms
            WHERE booking_id = ?
              AND (${resolvedRoomId ? "room_id = ?" : "CAST(guest_name AS CHAR) = ?"})
            ORDER BY id ASC
            LIMIT 1
          `,
          resolvedRoomId ? [id, resolvedRoomId] : [id, roomNo],
        );

        const tariff = Number(room.tariff ?? room.rate_per_night ?? 0);
        const gst = Number(room.gst ?? 0);
        const total = Number(room.total ?? 0);
        const adults = Number(room.adults ?? 1);
        const children = Number(room.children ?? 0);

        if (!target.length) continue;

        await query(
          `
            UPDATE booking_rooms
            SET rate_per_night = ?,
                room_charge = ?,
                total = ?,
                gst_percent = ?,
                adults = ?,
                children = ?,
                notes = COALESCE(?, notes)
            WHERE id = ?
          `,
          [tariff, tariff, total, gst, adults, children, room.mealPlan || null, target[0].id],
        );
      }
    }

    await recomputeBookingTotals(id);

    const updatedBooking = await getBookingSummaryById(id);
    const syncedRoomNumbers = roomList.length
      ? roomList
          .map((room) => String(room.room_number || room.roomNumber || "").trim())
          .filter(Boolean)
      : String(updatedBooking?.rooms || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

    const shouldSyncRoomState =
      Boolean(checkIn || checkOut) && updatedBooking && isCheckedIn(updatedBooking.booking_status);

    if (shouldSyncRoomState && syncedRoomNumbers.length) {
      await Promise.all(
        syncedRoomNumbers.map((roomNumber) =>
          roomInventoryModel.updateRoomOperationalState({
            roomNumber,
            guestName: updatedBooking.guest_name || null,
            status: "Occupied",
            checkIn: updatedBooking.check_in || null,
            checkOut: updatedBooking.check_out || null,
          }),
        ),
      );
    }

    // ID proof: upsert into guest_identifications.  Unlike guest_profiles
    // (which always has exactly one primary row per booking), there may be
    // zero, one, or several ID rows — so we REPLACE the oldest row rather
    // than INSERT blindly, which would create duplicates on every save.
    if (idProofType !== undefined || idProofNumber !== undefined) {
      const rawLabel = String(idProofType ?? "").trim();
      const idNumber = String(idProofNumber ?? "").trim();
      const idType = rawLabel ? mapIdProofLabelToEnum(rawLabel) : null;
      // `query` returns the rows array; `await db.query` would return
      // [rows, fields], which is how this used to silently mis-read.
      const existingIdRows = await query(
        "SELECT id FROM guest_identifications WHERE booking_id = ? ORDER BY id ASC LIMIT 1",
        [id],
      );
      const existingId = existingIdRows[0] || null;

      if (existingId) {
        await query(
          `UPDATE guest_identifications SET id_type = ?, id_number = ? WHERE id = ?`,
          [idType, idNumber || null, existingId.id],
        );
      } else if (rawLabel || idNumber) {
        const primaryGuestRows = await query(
          "SELECT guest_profile_id FROM booking_guests WHERE booking_id = ? AND is_primary = 1 LIMIT 1",
          [id],
        );
        await query(
          `INSERT INTO guest_identifications (booking_id, guest_profile_id, id_type, id_number)
           VALUES (?, ?, ?, ?)`,
          [id, primaryGuestRows[0]?.guest_profile_id || null, idType, idNumber || null],
        );
      }
    }

    res.json({ message: "Full Booking Updated" });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    res.status(500).json({ message: "Full booking update failed", error: error.message });
  }
};

exports.deleteBooking = async (req, res) => {
  const id = req.params.id;

  try {
    // v4: bookings cascades into booking_rooms / booking_guests / payments.
    await query("DELETE FROM bookings WHERE id = ?", [id]);

    res.json({ message: "Booking Deleted" });
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.refundBooking = async (req, res) => {
  const id = req.params.id;
  const amount = Number(req.body.amount || 0);

  try {
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Refund amount must be a positive number" });
    }

    const bookingRows = await query(
      "SELECT total_amount, advance_amount, balance_amount FROM bookings WHERE id = ? FOR UPDATE",
      [id],
    );
    const booking = bookingRows[0];
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const total = Number(booking.total_amount || 0);
    const advance = Number(booking.advance_amount || 0);
    if (amount > total) {
      return res.status(400).json({
        message: `Refund amount exceeds booking total of ${total}`,
      });
    }

    const methodRows = await query("SELECT id FROM payment_methods ORDER BY id ASC LIMIT 1");
    const methodId = methodRows[0]?.id || null;
    if (!methodId) {
      return res.status(500).json({ message: "No payment method configured" });
    }

    await query(
      `INSERT INTO payments
         (booking_id, amount, payment_method_id, payment_type, status)
       VALUES (?, ?, ?, 'refund', 'completed')`,
      [id, amount, methodId],
    );

    // Mirror updateAdvance's rollup in reverse so the booking's own totals move.
    const refund = Math.min(amount, advance);
    await query(
      `UPDATE bookings
       SET advance_amount = GREATEST(advance_amount - ?, 0),
           balance_amount = GREATEST(total_amount - (advance_amount - ?), 0)
       WHERE id = ?`,
      [refund, refund, id],
    );

    res.json({ message: "Refund Done" });
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.updateAdvance = async (req, res) => {
  const data = { booking_id: req.params.id, ...req.body };
  const amount = Number(data.amount || data.paidAmount || 0);

  try {
    // v4: record the advance as a payment row.
    const methodRows = await query(
      "SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(?) LIMIT 1",
      [data.paymentMode || data.payment_mode || "Cash"],
    );
    let methodId = methodRows[0]?.id;
    if (!methodId) {
      const fallback = await query("SELECT id FROM payment_methods ORDER BY id ASC LIMIT 1");
      methodId = fallback[0]?.id || null;
    }

    if (methodId && amount > 0) {
      await query(
        `INSERT INTO payments
           (booking_id, amount, payment_method_id, payment_type, reference_no, status, received_by)
         VALUES (?, ?, ?, 'advance', ?, 'completed', ?)`,
        [
          data.booking_id,
          amount,
          methodId,
          data.remarks || data.paymentRemarks || null,
          req.user?.id || null,
        ],
      );
    }

    // Keep the booking's own advance/balance rollups in sync.
    await query(
      `UPDATE bookings
       SET advance_amount = advance_amount + ?,
           balance_amount = GREATEST(total_amount - (advance_amount + ?), 0)
       WHERE id = ?`,
      [amount, amount, data.booking_id],
    );

    // Respond immediately — invoice PDF generation runs in background
    res.json({ message: "Payment Added + History Saved" });

    // Generate invoice PDF in background (no WhatsApp auto-send to avoid duplicates)
    setImmediate(async () => {
      try {
        const InvoiceModel = require("../models/InvoiceModel");
        const invoice = await InvoiceModel.generateCustomerInvoice(Number(req.params.id));
        if (!invoice) return;
        await InvoicePdfService.generateInvoicePdf(invoice);
      } catch (pdfErr) {
        console.error("[auto-pdf] invoice generation failed:", pdfErr.message);
      }
    });

    // Auto-print advance payment receipt
    setImmediate(async () => {
      try {
        const { InvoicePrintService } = require("../services/InvoicePrintService");
        const booking = await getBookingSummaryById(req.params.id);
        await InvoicePrintService.immediatePrintInvoice("advance_payment", {
          bookingId: req.params.id,
          invoiceNo: `ADV-${req.params.id}`,
          customerName: booking?.guest_name || "Guest",
          phone: booking?.mobile || "",
          roomNumber: booking?.rooms || "",
          totalAmount: Number(data.amount || data.paidAmount || 0),
          discount: Number(data.discountAmount || data.discount_amount || 0),
          subtotal: Number(data.amount || data.paidAmount || 0),
          tax: 0,
          paymentMode: data.paymentMode || "Cash",
          paymentStatus: "Paid",
          printedBy: "System (Advance)",
        });
      } catch (err) {
        console.error("[auto-print] advance receipt failed:", err.message);
      }
    });
  } catch (paymentError) {
    if (process.env.NODE_ENV !== "test") {
      console.error(paymentError);
    }
    res.status(500).json({
      message: "Payment history failed",
      error: paymentError.message,
    });
  }
};

exports.checkInBooking = async (req, res) => {
  try {
    const booking = await getBookingSummaryById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    await query("UPDATE bookings SET status = 'checked_in' WHERE id = ?", [req.params.id]);
    await updateRoomsForBooking(booking, "Checked In");

    res.json({ message: "Booking checked in successfully" });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    res.status(500).json({ message: "Check-in failed" });
  }
};

exports.checkOutBooking = async (req, res) => {
  try {
    const booking = await getBookingSummaryById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    await query("UPDATE bookings SET status = 'checked_out' WHERE id = ?", [req.params.id]);
    await updateRoomsForBooking(booking, "Checked Out");

    res.json({ message: "Booking checked out successfully" });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    res.status(500).json({ message: "Check-out failed" });
  }
};

exports.cancelBooking = async (req, res) => {
  try {
    const booking = await getBookingSummaryById(req.params.id);
    const cancelReason = String(req.body?.reason || "").trim();

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!cancelReason) {
      return res.status(400).json({ message: "Cancellation reason is required" });
    }

    if (isCheckedIn(booking.booking_status)) {
      return res.status(400).json({ message: "Checked-in booking cannot be cancelled from this flow" });
    }

    // Re-cancelling an already-cancelled booking must not refund again — the
    // advance is only ever returned once. Without this guard a double-click or
    // a retried request silently doubles the refund amount.
    if (String(booking.booking_status || "").toLowerCase() === "cancelled") {
      return res.status(200).json({
        message: "Booking is already cancelled",
        alreadyCancelled: true,
        refunded: false,
      });
    }

    await query(
      "UPDATE bookings SET status = 'cancelled', cancellation_reason = ? WHERE id = ?",
      [cancelReason, req.params.id],
    );

    // Refund only what has actually been received and not yet returned, so a
    // partial refund followed by a cancellation tops up rather than duplicates.
    const bookingAdvance = await new Promise((resolve) => {
      query(
        `SELECT
           SUM(CASE WHEN payment_type = 'refund' THEN 0 ELSE amount END) AS received,
           SUM(CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END) AS alreadyRefunded
         FROM (
           SELECT MAX(id) AS last_id FROM payments
           WHERE bill_id IS NOT NULL AND booking_id = ? AND status = 'completed'
           GROUP BY bill_id
           UNION ALL
           SELECT id FROM payments WHERE bill_id IS NULL AND booking_id = ? AND status = 'completed'
         ) dedup
         JOIN payments ON payments.id = dedup.last_id`,
        [req.params.id, req.params.id],
      )
        .then((rows) => resolve(rows[0] || null))
        .catch(() => resolve(null));
    });

    const advanceAmount = Math.max(
      0,
      Number(bookingAdvance?.received || 0) - Number(bookingAdvance?.alreadyRefunded || 0),
    );
    if (advanceAmount > 0) {
      const methodRows = await query("SELECT id FROM payment_methods ORDER BY id ASC LIMIT 1");
      const methodId = methodRows[0]?.id || null;
      if (methodId) {
        await query(
          `INSERT INTO payments
             (booking_id, amount, payment_method_id, payment_type, status)
           VALUES (?, ?, ?, 'refund', 'completed')`,
          [req.params.id, advanceAmount, methodId],
        );
      }
    }

    const roomNumbers = String(booking?.rooms || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    await Promise.all(
      roomNumbers.map(async (roomNumber) => {
        await roomInventoryModel.updateRoomOperationalState({
          roomNumber,
          guestName: null,
          status: "Available",
          checkIn: null,
          checkOut: null,
        });

        await query(
          "UPDATE housekeeping SET status = ? WHERE CAST(roomNo AS CHAR) = CAST(? AS CHAR)",
          ["Vacant Clean", roomNumber],
        );
      }),
    );

    // Send cancellation notification to customer + admin
    if (WhatsAppService) {
      setImmediate(async () => {
        try {
          const customerNumber = booking.mobile || booking.guest_phone || "";
          let adminNumber = "";
          try {
            const adminRows = await new Promise((resolve, reject) => {
              db.query(
                "SELECT id, name, email, phone FROM register WHERE LOWER(role) = 'admin' AND phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id ASC LIMIT 1",
                (err, rows) => (err ? reject(err) : resolve(rows)),
              );
            });
            adminNumber = adminRows?.[0]?.phone || "";
          } catch { /* ignore */ }

          const result = await WhatsAppService.sendBookingCancellation(
            {
              bookingId: booking.bookingId,
              bookingCode: booking.booking_code,
              guestName: booking.guest_name,
              phone: booking.mobile || booking.phone,
              cancelReason,
              refundAmount: advanceAmount,
              advanceAmount,
            },
            {
              customerNumber,
              adminNumber,
            },
          );
          console.log(`[cancel] booking ${req.params.id} cancellation sent`, result);
        } catch (cancelErr) {
          console.error("[cancel] notification failed for booking", req.params.id, cancelErr.message || cancelErr);
        }
      });
    }

    res.json({ message: "Booking cancelled successfully" });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    res.status(500).json({ message: "Booking cancellation failed" });
  }
};

exports.getBookingHistory = async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        b.id AS bookingId,
        b.booking_code AS bookingCode,
        ${resolveGuestName} AS guest_name,
        pg.mobile,
        pg.guest_email,
        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
        b.status AS booking_status,
        NULL AS company_name,
        COALESCE(bt.totalAmount, 0) AS totalAmount,
        IFNULL(pay.paidAmount, 0) AS paidAmount,
        0 AS discountAmount,
        IFNULL(pay.refundAmount, 0) AS refundAmount,
        COALESCE(NULLIF(pm.name, ''), 'Pending') AS paymentMode,
        (IFNULL(pay.paidAmount, 0) - IFNULL(pay.refundAmount, 0)) AS netPaid,
        (
          COALESCE(bt.totalAmount, 0) -
          (IFNULL(pay.paidAmount, 0) - IFNULL(pay.refundAmount, 0))
        ) AS remainingAmount,
        rms.rooms,
        rdt.roomDetails
      FROM bookings b
      ${primaryGuestJoin}
      ${roomGuestJoin}
      ${roomsJoin}
      ${roomDetailsJoin}
      ${paymentsJoin}
      ${bookingRoomsTotalJoin}
      WHERE LOWER(IFNULL(b.status, '')) = 'checked_out'
      ORDER BY b.id DESC
    `);

    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getPaymentHistory = async (req, res) => {
  const bookingId = req.params.id;

  try {
    const result = await query(
      `
        SELECT
          p.id,
          p.amount,
          0 AS discount_amount,
          COALESCE(NULLIF(pm.name, ''), 'Cash') AS payment_mode,
          p.created_at,
          ${resolveGuestName} AS guest_name,
          rms.rooms
        FROM payments p
        LEFT JOIN bookings b ON b.id = p.booking_id
        ${primaryGuestJoin}
        ${roomGuestJoin}
        ${roomsJoin}
        LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
        WHERE p.booking_id = ?
        ORDER BY p.id DESC
      `,
      [bookingId],
    );

    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
};
