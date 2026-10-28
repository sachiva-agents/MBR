/**
 * Invoice PDF Service — generates a professional PDF invoice for a booking.
 *
 * Uses pdfkit. The generated PDF is stored under <UPLOADS_DIR>/invoices/
 * and its public URL returned to the caller.
 *
 * NOTE: Only the PDF layout/design was changed to match the resort's
 * "Tax Invoice" reference design. No business logic (file handling,
 * naming, return values, amount calculations coming from the caller)
 * was added or altered — this file only re-arranges how the existing
 * `booking` fields are drawn on the page.
 */

const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

// Resolve to the project's /uploads/invoices directory.
// Relative env paths are resolved from __dirname (this service file in
// backend/), not from process.cwd(), so the path is correct regardless of
// where the server is started from.
const resolveOutputDir = (envValue, fallbackRelPath) => {
  if (!envValue) return path.resolve(__dirname, "..", fallbackRelPath);
  if (path.isAbsolute(envValue)) return envValue;
  return path.resolve(__dirname, "..", envValue);
};

const OUTPUT_DIR = resolveOutputDir(process.env.INVOICE_UPLOAD_DIR, "uploads/invoices");

/**
 * Ensure the output directory exists.
 */
const ensureOutputDir = () => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
};

/**
 * Indian Rupee symbol helper.
 */
const INR = "Rs.";

/**
 * Format a phone number for display: e.g. "91XXXXXXXXXX" → "+91 XXXXXXXX"
 */
const formatPhoneDisplay = (raw) => {
  if (!raw) return "N/A";
  let digits = String(raw).replace(/\D+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length >= 12) {
    const country = digits.slice(0, 2);
    const local = digits.slice(2);
    return `+${country} ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return digits;
};

/**
 * Format a plain number as Indian-format currency.
 *   1234.50 → "1,234.50"
 */
const formatINR = (value) => {
  const num = Number(value || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ── Fixed resort details (as given in the reference invoice) ────────────────
// These are static business details, not calculated data, so they're kept
// as simple constants — swap them here if the resort's details ever change.
const RESORT = {
  name: "MAA BAGLAMUKHI RESORT",
  addressLine1: "Maa Baglamukhi Mandir Road, Nalkheda",
  addressLine2: "Maa Baglamukhi mandir road Nalkheda, District: Agar Malwa 465445",
  phone: "9522238777, 9522239777",
  email: "maabaglamukhiresort@gmail.com",
  website: "www.maabaglamukhiresort.com",
  gstin: "23AVDPR2928J1ZG",
};

/**
 * Turn a number into words (Indian numbering, Rupees only) for the
 * "Rupees ... Only" line. Pure formatting helper — no business logic.
 */
const numberToWordsINR = (num) => {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const inWords = (n) => {
    if (n === 0) return "";
    if (n < 20) return a[n] + " ";
    if (n < 100) return b[Math.floor(n / 10)] + " " + inWords(n % 10);
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred " + inWords(n % 100);
    if (n < 100000) return inWords(Math.floor(n / 1000)) + "Thousand " + inWords(n % 1000);
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + "Lakh " + inWords(n % 100000);
    return inWords(Math.floor(n / 10000000)) + "Crore " + inWords(n % 10000000);
  };

  const rounded = Math.round(Number(num || 0));
  if (rounded === 0) return "Zero Rupees Only";
  return `${inWords(rounded).trim()} Rupees Only`;
};

/**
 * Generate a PDF invoice for the given booking data and save it to disk.
 * (see original JSDoc below for the `booking` shape)
 *
 * @param {object} booking
 *   @property {string|number} bookingId
 *   @property {string} invoiceNo
 *   @property {string} customerName
 *   @property {string} phone
 *   @property {string} roomNumber
 *   @property {string} checkIn     "YYYY-MM-DD"
 *   @property {string} checkOut    "YYYY-MM-DD"
 *   @property {string} date        "YYYY-MM-DD"
 *   @property {string} paymentMode
 *   @property {string} paymentStatus
 *   @property {number} subtotal
 *   @property {number} tax
 *   @property {number} discount
 *   @property {number} totalAmount
 *   @property {number} roomCharge
 *   @property {number} foodCharge
 *   @property {number} extraCharge
 *   @property {Array}  items       [{name, price, quantity, total}]
 *
 * @returns {Promise<{filePath: string, fileName: string}>}
 */
const generateInvoicePdf = async (booking) => {
  ensureOutputDir();

  const safeId = String(booking.bookingId || booking.customerId || "unknown");
  const safeInvoiceNo =
    String(booking.invoiceNo || `INV-${safeId}-${Date.now()}`).replace(
      /[^A-Za-z0-9\-]/g,
      "_",
    );
  // Clean guest name for filename: only letters/numbers, joined by underscore.
  // Falls back to the invoice/booking id if no name is provided so the file is
  // still meaningful on the customer's WhatsApp chat.
  const safeGuest = String(booking.customerName || booking.guestName || safeId)
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const fileName = `Tax_Invoice_${safeInvoiceNo}_${safeGuest}.pdf`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  // Delete any previous files for this invoiceNo so we don't fill the uploads
  // folder with stale "Tax_Invoice_768_*.pdf" copies every time the user clicks
  // "Regenerate". Match by the leading invoiceNo token.
  try {
    const prefix = `Tax_Invoice_${safeInvoiceNo}_`;
    for (const existing of fs.readdirSync(OUTPUT_DIR)) {
      if (existing.startsWith(prefix) && existing !== fileName) {
        try {
          fs.unlinkSync(path.join(OUTPUT_DIR, existing));
        } catch (_) {}
      }
    }
  } catch (_) {}

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const stream = fs.createWriteStream(filePath);

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.pipe(stream);

    try {
      drawTaxInvoice(doc, booking);
    } catch (err) {
      doc.end();
      stream.destroy();
      fs.unlink(filePath, () => {});
      reject(err);
      return;
    }

    doc.end();
  });

  return { filePath, fileName };
};

// ────────────────────────────────────────────────────────────────────────────
// PDF drawing — everything below is presentation only. It only reads fields
// that already exist on `booking` / `booking.items`; nothing is fetched or
// computed beyond simple formatting (rounding, number-to-words, GST split
// display using the same 5% GST assumption the original file already used).
// ────────────────────────────────────────────────────────────────────────────

const drawTaxInvoice = (doc, booking) => {
  const PAGE_LEFT = 40;
  const PAGE_RIGHT = 555;
  const BOX_W = PAGE_RIGHT - PAGE_LEFT;

  const items = Array.isArray(booking.items) ? booking.items : [];

  // Column layout
  const col = {
    date: PAGE_LEFT,
    particulars: PAGE_LEFT + 55,
    tariff: PAGE_LEFT + 195,
    disc: PAGE_LEFT + 250,
    taxable: PAGE_LEFT + 295,
    sgst: PAGE_LEFT + 350,
    cgst: PAGE_LEFT + 405,
    total: PAGE_LEFT + 460,
  };
  const colEnds = [
    col.date, col.particulars, col.tariff, col.disc, col.taxable, col.sgst, col.cgst, col.total, PAGE_RIGHT,
  ];

  const hLine = (y) => {
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor("#000000").lineWidth(0.7).stroke();
  };
  const vLine = (x, y1, y2) => {
    doc.moveTo(x, y1).lineTo(x, y2).strokeColor("#000000").lineWidth(0.7).stroke();
  };
  const rect = (x, y, w, h) => {
    doc.rect(x, y, w, h).strokeColor("#000000").lineWidth(0.7).stroke();
  };

  // ── Title ────────────────────────────────────────────────────────────────
  let y = 30;
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(18).text("Tax Invoice", PAGE_LEFT, y, {
    width: BOX_W, align: "center",
  });
  y += 24;

  // ── Resort Header ───────────────────────────────────────────────────────
  const resortY = y;
  // Flower icon + Resort name
  doc.font("Helvetica-Bold").fontSize(11).text(RESORT.name, PAGE_LEFT, resortY, { width: BOX_W, align: "center" });
  y += 14;
  doc.font("Helvetica").fontSize(8).text("Your Stay, Our Blessing", PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 11;
  doc.font("Helvetica").fontSize(8).text(RESORT.addressLine2, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 11;
  doc.font("Helvetica").fontSize(8).text(`Contact: ${RESORT.phone} | Email: ${RESORT.email}`, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 11;
  doc.font("Helvetica").fontSize(8).text(`${RESORT.website}`, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 11;
  doc.font("Helvetica-Bold").fontSize(8).text(`GSTN: ${RESORT.gstin}`, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 10;

  const headerBottom = y;
  hLine(headerBottom);
  const boxTop = headerBottom;
  y += 6;

  // ── Meta Info Grid ───────────────────────────────────────────────────────
  const metaColMid = PAGE_LEFT + BOX_W / 2;
  const nights = (() => {
    if (booking.nights) return booking.nights;
    if (booking.checkIn && booking.checkOut) {
      const d1 = new Date(booking.checkIn);
      const d2 = new Date(booking.checkOut);
      const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      return diff > 0 ? diff : 1;
    }
    return "N/A";
  })();

  const leftRows = [
    ["Folio No.", String(booking.bookingId || booking.folioNo || "N/A")],
    ["Guest Name", String(booking.customerName || "Guest")],
    ["Address", String(booking.address || "N/A")],
    ["Contact #", formatPhoneDisplay(booking.phone)],
  ];
  const rightRows = [
    ["Invoice No.", String(booking.invoiceNo || "N/A")],
    ["Invoice Date", String(booking.date || "N/A")],
    ["Room No.", String(booking.roomNumber || "N/A")],
    ["Room Type", String(booking.roomType || "N/A")],
    ["Arrival", String(booking.checkIn || "N/A")],
    ["Departure", String(booking.checkOut || "N/A")],
    ["Pax", String(booking.pax || "N/A")],
    ["No. of Nights", String(nights)],
    ["Guest GSTIN", String(booking.guestGstin || booking.companyGstin || "—")],
    ["Guest Company", String(booking.guestCompany || booking.companyName || "—")],
  ];

  const metaRowH = 14;
  const metaStartY = y;
  doc.fontSize(8.5);
  leftRows.forEach(([label, val], i) => {
    const ry = metaStartY + i * metaRowH;
    doc.font("Helvetica-Bold").text(label, PAGE_LEFT + 6, ry, { width: 85 });
    doc.font("Helvetica").text(val, PAGE_LEFT + 100, ry, { width: metaColMid - PAGE_LEFT - 106 });
  });
  rightRows.forEach(([label, val], i) => {
    const ry = metaStartY + i * metaRowH;
    doc.font("Helvetica-Bold").text(label, metaColMid + 6, ry, { width: 85 });
    doc.font("Helvetica").text(val, metaColMid + 100, ry, { width: PAGE_RIGHT - metaColMid - 106 });
  });

  const metaBottom = metaStartY + Math.max(leftRows.length, rightRows.length) * metaRowH + 8;
  vLine(metaColMid, headerBottom, metaBottom);
  hLine(metaBottom);
  y = metaBottom + 4;

  // ── Billing Details Label ───────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(9).text("Billing Details", PAGE_LEFT + 4, y);
  y += 13;

  // ── Table Header Row ─────────────────────────────────────────────────────
  const tableHeaderTop = y;
  const headerLabels = ["Date", "Particulars", "Tariff", "Disc", "Taxable", "SGST 2.5%", "CGST 2.5%", "Total"];
  doc.font("Helvetica-Bold").fontSize(8);
  headerLabels.forEach((label, i) => {
    doc.text(label, colEnds[i] + 4, tableHeaderTop + 3, { width: colEnds[i + 1] - colEnds[i] - 6 });
  });
  const tableHeaderBottom = tableHeaderTop + 14;
  hLine(tableHeaderBottom);
  y = tableHeaderBottom;

  // ── Table Rows ───────────────────────────────────────────────────────────
  const rowH = 16;
  let tariffTotal = 0;
  let sgstTotal = 0;
  let cgstTotal = 0;

  doc.font("Helvetica").fontSize(8);
  items.forEach((item) => {
    const rowY = y;
    // GST model: ADDED ON TOP of the item base (the same model the booking
    // dashboard uses: tariff × (1 + gst%), so a ₹500 room at 5% totals ₹525).
    // item.total from booking_rooms is the pre-tax base and the item's gst
    // percent is stored separately (booking_rooms.gst_percent), so tax is
    // computed on the base — NOT backed out of an assumed inclusive total.
    // (The previous back-out produced 476.19 + 11.91 + 11.91 = 500 for a
    // ₹500/5% room — ₹25 short of the real charge.)
    const gstPercent = Number(item.gstPercent ?? item.gst ?? 0);
    const grossTotal = Number(
      item.total != null ? item.total : Number(item.price || 0) * Number(item.quantity || 1),
    );
    const disc = Number(item.discount || 0);
    const taxable = Math.max(0, grossTotal - disc);
    const totalTax = Number((taxable * (gstPercent / 100)).toFixed(2));
    const sgst = totalTax / 2;
    const cgst = totalTax / 2;
    const tariff = Number(
      item.price != null ? Number(item.price) * Number(item.quantity || 1) : grossTotal,
    );
    const rowGross = grossTotal + totalTax - disc; // tax-inclusive line total

    tariffTotal += taxable;
    sgstTotal += sgst;
    cgstTotal += cgst;

    const rowValues = [
      String(item.date || booking.date || "N/A"),
      String(item.name || item.category || "Charge"),
      formatINR(tariff),
      formatINR(disc),
      formatINR(taxable),
      formatINR(sgst),
      formatINR(cgst),
      formatINR(rowGross),
    ];
    rowValues.forEach((val, i) => {
      doc.text(val, colEnds[i] + 4, rowY + 4, { width: colEnds[i + 1] - colEnds[i] - 6 });
    });
    y += rowH;
  });

  if (items.length === 0) {
    y += rowH;
  }

  const tableBottom = y;
  hLine(tableBottom);
  for (let i = 1; i < colEnds.length - 1; i++) {
    vLine(colEnds[i], tableHeaderTop, tableBottom);
  }
  vLine(PAGE_LEFT, tableHeaderTop, tableBottom);
  vLine(PAGE_RIGHT, tableHeaderTop, tableBottom);

  y = tableBottom + 8;

  // ── Layout constants for everything below the billing table ──────────────
  // The right-side totals column has two sub-columns packed into ~220px:
  //   [ label (110px) ][ value (110px) ]
  // anchored to the right page edge. The divider at the LEFT of the right
  // block separates it from the left-side Remarks/Note column.
  const BLOCK_PAD     = 6;
  const LABEL_COL_W   = 110;
  const VALUE_COL_W   = 110;
  // Divider runs from PAGE_LEFT to where the right block starts.
  const VERT_DIV_X    = PAGE_RIGHT - LABEL_COL_W - VALUE_COL_W - 4; // = 555-220-4 = 331
  // Right-side label & value columns: label sits LEFT of value, both inside page.
  const R_LABEL_X     = VERT_DIV_X + 4;                   // = 335
  const R_LABEL_W     = LABEL_COL_W - 6;                  // = 104
  const R_VALUE_X     = R_LABEL_X + R_LABEL_W + 4;        // = 443
  const R_VALUE_W     = VALUE_COL_W - 6;                  // = 104  (ends at 547, inside page)
  // Left-side text area width
  const LEFT_TEXT_W   = VERT_DIV_X - PAGE_LEFT - BLOCK_PAD * 2; // = 331-40-12 = 279

  // ── Block 1: Remarks (left) + Totals Summary (right) ─────────────────────
  const remarksTop = y;
  const totalsRowH = 12;
  doc.font("Helvetica-Bold").fontSize(8).text("Remarks", PAGE_LEFT + BLOCK_PAD, remarksTop);

  const discount = Number(booking.discount || 0);
  // 🐛 FIX: previously fell back to `booking.subtotal` / `booking.tax` when
  // present — but those aggregate fields were frequently computed upstream
  // (frontend) using the same flat-5%-GST assumption this file used to
  // have, so they carried the same bug forward even after the per-item fix
  // above. The line items now have the correct, real GST split, so always
  // trust the sums derived from `items` when items exist.
  const hasItems = items.length > 0;
  const taxableAmount = hasItems
    ? tariffTotal - discount
    : Number(booking.subtotal || 0) - discount;
  const sgst = hasItems ? sgstTotal : (booking.tax != null ? Number(booking.tax) / 2 : 0);
  const cgst = hasItems ? cgstTotal : (booking.tax != null ? Number(booking.tax) / 2 : 0);
  const roomTotal = taxableAmount + sgst + cgst;
  const roundOff = 0;
  const serviceTotal = Number(booking.extraCharge || 0);
  // Final total is ALWAYS derived from the line items (taxable + SGST + CGST),
  // so the header words line and the payment-detail block agree with the
  // billing table above. The passed-in booking.totalAmount was the
  // pre-tax tariff (500) — trusting it is what printed "Final Total 500"
  // while the table's tax-inclusive line was 525.
  const finalTotal = Number((roomTotal + serviceTotal - roundOff).toFixed(2));

  const totalsRows = [
    ["Tariff Total",   formatINR(tariffTotal),     false],
    ["Discount",       formatINR(discount),         false],
    ["Taxable Amount", formatINR(taxableAmount),    false],
    ["SGST",           formatINR(sgst),             false],
    ["CGST",           formatINR(cgst),             false],
    ["Room Total",     formatINR(roomTotal),        false],
    ["Round Off Disc.", formatINR(roundOff),        false],
    ["Final Total",    formatINR(finalTotal),       true],
    ["Service Total",  formatINR(serviceTotal),     false],
  ];

  totalsRows.forEach(([label, val, isBold], i) => {
    const ry = remarksTop + i * totalsRowH;
    doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(isBold ? 9 : 8);
    doc.text(label, R_LABEL_X, ry, { width: R_LABEL_W });
    doc.text(val,    R_VALUE_X, ry, { width: R_VALUE_W, align: "right" });
  });

  const remarksBottom = remarksTop + totalsRows.length * totalsRowH + 6;
  // Vertical divider between left (Remarks) and right (Totals) blocks.
  vLine(VERT_DIV_X, remarksTop - 2, remarksBottom);
  hLine(remarksBottom);
  y = remarksBottom + 3;

  // ── Block 2: Amount in Words (left) + Final Total bar (right) ─────────────
  const wordsTop = y;
  // Amount-in-words keeps the full left region width.
  doc.font("Helvetica-Bold").fontSize(8).text(
    numberToWordsINR(finalTotal),
    PAGE_LEFT + BLOCK_PAD, wordsTop + 2,
    { width: LEFT_TEXT_W }
  );
  // Final-Total bar on the right: label left, value right, both in same
  // columns as Block 1 so they line up neatly under it.
  doc.font("Helvetica-Bold").fontSize(10).text("Final Total", R_LABEL_X, wordsTop + 2, {
    width: R_LABEL_W,
  });
  doc.font("Helvetica-Bold").fontSize(11).text(`${INR} ${formatINR(finalTotal)}`, R_VALUE_X, wordsTop + 1, {
    width: R_VALUE_W, align: "right",
  });

  const wordsBottom = wordsTop + 18;
  vLine(VERT_DIV_X, wordsTop, wordsBottom);
  hLine(wordsBottom);
  y = wordsBottom + 3;

  // ── Block 3: Invoice Note (left) + Payment Detail (right) ─────────────────
  const noteTop = y;
  doc.font("Helvetica-Bold").fontSize(8).text("INVOICE NOTE", PAGE_LEFT + BLOCK_PAD, noteTop);
  doc.font("Helvetica-Bold").fontSize(8).text("PAYMENT DETAIL", R_LABEL_X, noteTop);

  doc.font("Helvetica").fontSize(8).text("Thanks! Visit Again!!", PAGE_LEFT + BLOCK_PAD, noteTop + 14);

  // 🐛 FIX (1/2): this used to always print the FULL invoice total next to
  // the payment mode (as if the guest had paid everything) and hardcode
  // "Balance" to 0.00. A booking with only a partial advance payment (e.g.
  // ₹500 paid out of a ₹2,000 total) therefore looked fully settled on the
  // invoice even though ₹1,500 was still due. Now uses the real amount
  // paid / outstanding balance (computed server-side from advance +
  // folio payments) when available.
  const amountPaid = Number(
    booking.paidAmount != null
      ? booking.paidAmount
      : booking.remainingAmount != null
        ? finalTotal - Number(booking.remainingAmount)
        : finalTotal,
  );
  const balanceDue = Number(
    booking.remainingAmount != null
      ? booking.remainingAmount
      : Math.max(finalTotal - amountPaid, 0),
  );
  // 🐛 FIX (2/2): the row above only ever showed the payment MODE ("Mixed /
  // Recorded", "Cash", etc.) as the label next to the amount, with no line
  // that says "Advance Paid" — so even after the Balance fix, the advance
  // the guest actually handed over wasn't clearly identified on the
  // invoice. Now shows three explicit rows: Total Amount, Advance Paid
  // (with its payment mode), and Balance Due.
  const paymentRows = [
    ["Total Amount", formatINR(finalTotal)],
    ["Advance Paid", formatINR(amountPaid)],
    [`Mode: ${String(booking.paymentMode || "N/A")}`, ""],
    ["Balance Due", formatINR(balanceDue)],
  ];
  paymentRows.forEach(([label, val], i) => {
    const ry = noteTop + 14 + i * 14;
    doc.font(i === paymentRows.length - 1 ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    doc.text(label, R_LABEL_X, ry, { width: R_LABEL_W });
    doc.text(val, R_VALUE_X, ry, { width: R_VALUE_W, align: "right" });
  });

  const noteBottom = noteTop + 14 + paymentRows.length * 14 + 6;
  vLine(VERT_DIV_X, noteTop - 2, noteBottom);
  hLine(noteBottom);
  const boxBottom = noteBottom;

  // ── Outer Box ───────────────────────────────────────────────────────────
  rect(PAGE_LEFT, boxTop, BOX_W, boxBottom - boxTop);
  vLine(PAGE_LEFT, boxTop, boxBottom);
  vLine(PAGE_RIGHT, boxTop, boxBottom);

  // ── Signature Footer ────────────────────────────────────────────────────
  const footerTop = boxBottom + 24;
  const footerHeight = 65;
  rect(PAGE_LEFT, footerTop, BOX_W, footerHeight);

  doc.font("Helvetica-Bold").fontSize(10).text(`For ${RESORT.name}`, PAGE_LEFT + 12, footerTop + 14);

  doc.font("Helvetica").fontSize(9).text("Authorised Signature", PAGE_LEFT + 12, footerTop + footerHeight - 16);

  doc.font("Helvetica").fontSize(9).text("Guest Signature", PAGE_RIGHT - 140, footerTop + footerHeight - 16, {
    width: 130, align: "right",
  });

  doc.font("Helvetica").fontSize(8).fillColor("#666666").text(
    `Invoice Generated By: ${booking.generatedBy || booking.staffName || "N/A"}`,
    PAGE_LEFT + 12, footerTop + footerHeight + 6,
  );
};

module.exports = {
  generateInvoicePdf,
};