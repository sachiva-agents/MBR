/**
 * Restaurant Invoice PDF Service
 *
 * Generates a modern, attractive, single-page A4 PDF invoice for restaurant
 * (table / room service) bills and saves it under <UPLOADS_DIR>/invoices/.
 *
 * Design highlights:
 *  - Branded header band (gradient, logo mark, resort name)
 *  - Two-column meta strip: invoice no / date / visit / payment
 *  - Bill-to card on the left, Service card on the right
 *  - Styled items table with alternating row tints and a header gradient
 *  - Highlighted "Grand Total" pill with the resort's accent color
 *  - Refined footer with a centered thank-you band
 */

const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

// ─── Output directory ────────────────────────────────────────────────────────
// Relative env paths are resolved from __dirname (this file lives in
// backend/), so the path is correct regardless of process.cwd().
const OUTPUT_DIR = (() => {
  const raw = process.env.INVOICE_UPLOAD_DIR;
  if (!raw) return path.resolve(__dirname, "..", "uploads", "invoices");
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(__dirname, "..", raw);
})();

const ensureOutputDir = () => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
};

// ─── Theme palette ────────────────────────────────────────────────────────────
const THEME = {
  primary: "#0F4C81",        // deep resort blue
  primaryDark: "#0A3A66",
  accent: "#F59E0B",         // warm amber
  accentDark: "#B45309",
  ink: "#000000",            // print-sharp text
  inkSoft: "#000000",        // secondary text
  muted: "#000000",          // labels / captions
  line: "#000000",           // dividers
  band: "#F8FAFC",           // card background
  altRow: "#F1F5F9",         // alternating row
  pill: "#ECFDF5",           // paid badge
  pillInk: "#047857",
  white: "#FFFFFF",
};

// ─── Fixed resort details ──────────────────────────────────────────────────
const RESORT = {
  addressLine: "Maa Baglamukhi mandir road Nalkheda, District: Agar Malwa 465445",
  gstin: "23AVDPR2928J1ZG",
};

const INR = "₹";

const formatINR = (value) => {
  const num = Number(value || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const round2 = (value) => Number((Number(value || 0)).toFixed(2));

// ─── Layout helpers ───────────────────────────────────────────────────────────
const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const CONTENT = {
  x: PAGE.margin,
  y: PAGE.margin,
  w: PAGE.width - PAGE.margin * 2,
};

const gradientFill = (doc, x, y, w, h, colorTop, colorBottom) => {
  // PDFKit doesn't have a built-in gradient — emulate with stacked thin rects.
  const steps = Math.max(40, Math.round(h / 2));
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const r = Math.round(hexToRgb(colorTop)[0] * (1 - t) + hexToRgb(colorBottom)[0] * t);
    const g = Math.round(hexToRgb(colorTop)[1] * (1 - t) + hexToRgb(colorBottom)[1] * t);
    const b = Math.round(hexToRgb(colorTop)[2] * (1 - t) + hexToRgb(colorBottom)[2] * t);
    doc.save();
    doc.rect(x, y + (h * i) / steps, w, h / steps + 0.5).fillColor(`rgb(${r},${g},${b})`).fill();
    doc.restore();
  }
};

const hexToRgb = (hex) => {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return [0, 0, 0];
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
};

const drawRoundedRect = (doc, x, y, w, h, radius, fillColor, strokeColor) => {
  doc.save();
  if (fillColor) doc.fillColor(fillColor);
  if (strokeColor) doc.strokeColor(strokeColor).lineWidth(1);
  doc.roundedRect(x, y, w, h, radius);
  if (fillColor && strokeColor) doc.fillAndStroke();
  else if (fillColor) doc.fill();
  else if (strokeColor) doc.stroke();
  doc.restore();
};

// ─── PDF builder ─────────────────────────────────────────────────────────────
const generateRestaurantInvoicePdf = async (bill) => {
  ensureOutputDir();

  const billId = Number(bill.id || bill.billId || 0);
  const invoiceNo = billId > 0 ? `REST-${String(billId).padStart(4, "0")}` : `REST-TMP-${Date.now()}`;
  const safeInvoiceNo = invoiceNo.replace(/[^A-Za-z0-9\-]/g, "_");
  const fileName = `invoice_restaurant_${safeInvoiceNo}.pdf`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  // --- Normalise data -------------------------------------------------------
  const customerName = bill.customerName || bill.customer_name || "Walk-in Customer";
  const phone = bill.phone || bill.customerPhone || "N/A";
  const entityLabel =
    String(bill.entityType || "Table").toLowerCase() === "room" ? "Room" : "Table";
  const tableOrRoom = bill.tableNumber || bill.table || "N/A";
  const visitId = bill.tokenCode || (bill.tokenId ? `VIS-${String(bill.tokenId).padStart(6, "0")}` : "N/A");
  const rawDate = bill.created_at || bill.date;
  const dateObj = rawDate ? new Date(rawDate) : null;
  const date = dateObj && !Number.isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "N/A";
  const time = dateObj && !Number.isNaN(dateObj.getTime())
    ? dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
    : "N/A";
  const waiter = bill.waiter_name || bill.waiterName || "N/A";
  const paymentMethod = bill.paymentMethod || "Cash";
  const paymentStatus = bill.invoiceStatus || "Generated";
  const subtotal = round2(bill.subtotal || 0);
  const gst = round2(bill.gst || 0);
  const sgst = round2(gst / 2);
  const cgst = round2(gst / 2);
  const gstPercent = subtotal > 0 ? round2((gst / subtotal) * 100) : 2.5;
  const discount = round2(bill.discountAmount || bill.discount || 0);
  const serviceCharge = round2(bill.serviceCharge || 0);
  const grandTotal = round2(subtotal + gst + serviceCharge - discount);
  const items = Array.isArray(bill.items) ? bill.items : [];
  const isPaid = String(paymentStatus).toLowerCase() === "paid";
  const isPosted = String(paymentStatus).toLowerCase() === "posted to room";

  // --- Build PDF ------------------------------------------------------------
  const doc = new PDFDocument({ size: "A4", margin: PAGE.margin });
  const stream = fs.createWriteStream(filePath);

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.pipe(stream);

    // ── HEADER BAND ────────────────────────────────────────────────────────
    const headerH = 110;
    gradientFill(
      doc,
      0,
      0,
      PAGE.width,
      headerH,
      THEME.primary,
      THEME.primaryDark,
    );

    // Logo / mark circle on the left
    drawRoundedRect(doc, 36, 22, 66, 66, 16, THEME.white, null);
    doc.fillColor(THEME.primary)
      .font("Helvetica-Bold")
      .fontSize(28)
      .text("M", 36, 22, { width: 66, align: "center" });
    doc.fillColor(THEME.accent)
      .circle(99, 35, 5)
      .fill();

    // Brand text (right of logo)
    doc.fillColor(THEME.white)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("Maa Baglamukhi Resort", 116, 28, { width: PAGE.width - 280 });

    doc.font("Helvetica")
      .fontSize(10)
      .fillColor(THEME.white)
      .text("Restaurant & POS Billing", 116, 56, { width: PAGE.width - 280 });

    // Status pill (right side)
    const pillLabel = isPaid ? "PAID" : isPosted ? "POSTED TO ROOM" : "INVOICE";
    const pillColor = isPaid ? THEME.pillInk : isPosted ? "#1D4ED8" : THEME.accentDark;
    const pillBg = isPaid ? THEME.pill : isPosted ? "#DBEAFE" : "#FEF3C7";
    const pillW = 130;
    const pillX = PAGE.width - 36 - pillW;
    drawRoundedRect(doc, pillX, 32, pillW, 28, 14, pillBg, null);
    doc.fillColor(pillColor)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(pillLabel, pillX, 39, { width: pillW, align: "center" });

    // Invoice no + date row (white text on dark band)
    doc.font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(THEME.white)
      .text(`Invoice #${invoiceNo}`, 116, 80, { continued: true, width: 300 })
      .font("Helvetica")
      .fillColor(THEME.white)
      .text(`  ·  ${date}  ·  ${time}`, { width: 320 });

    // ── META STRIP (4 cells) ──────────────────────────────────────────────
    let cursorY = headerH + 14;

    const metaCells = [
      { label: "INVOICE NO.", value: invoiceNo },
      { label: "VISIT ID", value: String(visitId) },
      { label: "DATE", value: date },
      { label: "PAYMENT", value: paymentMethod },
    ];
    const metaCellW = (CONTENT.w - 12) / 4; // 3 gaps of 4
    metaCells.forEach((cell, i) => {
      const x = CONTENT.x + i * (metaCellW + 4);
      drawRoundedRect(doc, x, cursorY, metaCellW, 46, 8, THEME.band, THEME.line);
      doc.font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(THEME.muted)
        .text(cell.label, x + 10, cursorY + 8, { width: metaCellW - 20 });
      doc.font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(THEME.ink)
        .text(cell.value, x + 10, cursorY + 22, { width: metaCellW - 20, ellipsis: true });
    });

    cursorY += 46 + 14;

    // ── BILL TO + SERVICE DETAILS (two cards side-by-side) ─────────────────
    const halfW = (CONTENT.w - 12) / 2;
    const cardH = 96;

    // Bill to card
    drawRoundedRect(doc, CONTENT.x, cursorY, halfW, cardH, 10, THEME.band, THEME.line);
    doc.font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(THEME.muted)
      .text("BILL TO", CONTENT.x + 12, cursorY + 10, { characterSpacing: 1.2 });
    doc.font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(THEME.ink)
      .text(customerName, CONTENT.x + 12, cursorY + 24, { width: halfW - 24, ellipsis: true });
    doc.font("Helvetica")
      .fontSize(10)
      .fillColor(THEME.inkSoft)
      .text(`Phone: ${phone}`, CONTENT.x + 12, cursorY + 46);
    doc.font("Helvetica")
      .fontSize(10)
      .fillColor(THEME.inkSoft)
      .text(`Waiter: ${waiter}`, CONTENT.x + 12, cursorY + 62);
    doc.font("Helvetica")
      .fontSize(10)
      .fillColor(THEME.inkSoft)
      .text(`${entityLabel}: ${tableOrRoom}`, CONTENT.x + 12, cursorY + 78);

    // Service details card
    const card2X = CONTENT.x + halfW + 12;
    drawRoundedRect(doc, card2X, cursorY, halfW, cardH, 10, THEME.band, THEME.line);
    doc.font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(THEME.muted)
      .text("SERVICE DETAILS", card2X + 12, cursorY + 10, { characterSpacing: 1.2 });
    doc.font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(THEME.ink)
      .text(`${entityLabel} ${tableOrRoom}`, card2X + 12, cursorY + 24, { width: halfW - 24 });

    const detailRows = [
      ["Visit ID", String(visitId)],
      ["Time", time],
      ["Status", paymentStatus],
    ];
    detailRows.forEach(([label, value], idx) => {
      const rowY = cursorY + 44 + idx * 14;
      doc.font("Helvetica")
        .fontSize(9)
        .fillColor(THEME.muted)
        .text(label, card2X + 12, rowY, { width: 70 });
      doc.font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(THEME.ink)
        .text(value, card2X + 80, rowY, { width: halfW - 90, ellipsis: true });
    });

    cursorY += cardH + 18;

    // ── ITEMS TABLE ────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(THEME.muted)
      .text("ORDERED ITEMS", CONTENT.x, cursorY, { characterSpacing: 1.4 });

    cursorY += 14;

    const tableX = CONTENT.x;
    const tableW = CONTENT.w;
    const cols = {
      idx: { x: tableX + 8, w: 28, align: "left" },
      name: { x: tableX + 36, w: 250, align: "left" },
      qty: { x: tableX + 290, w: 50, align: "center" },
      rate: { x: tableX + 350, w: 90, align: "right" },
      amount: { x: tableX + 444, w: tableW - 452, align: "right" },
    };

    // Header bar
    drawRoundedRect(doc, tableX, cursorY, tableW, 26, 6, THEME.primary, null);
    doc.fillColor(THEME.white)
      .font("Helvetica-Bold")
      .fontSize(9);
    Object.entries(cols).forEach(([key, col]) => {
      const labels = { idx: "#", name: "ITEM", qty: "QTY", rate: "RATE", amount: "AMOUNT" };
      doc.text(labels[key], col.x, cursorY + 9, { width: col.w, align: col.align });
    });

    cursorY += 26;

    // Rows
    if (items.length === 0) {
      drawRoundedRect(doc, tableX, cursorY, tableW, 30, 4, THEME.altRow, null);
      doc.fillColor(THEME.muted)
        .font("Helvetica-Oblique")
        .fontSize(10)
        .text("No items recorded", tableX, cursorY + 10, { width: tableW, align: "center" });
      cursorY += 30;
    } else {
      items.forEach((item, idx) => {
        const qty = Number(item.qty || item.quantity || 0);
        const rate = Number(item.rate || item.price || 0);
        const amount = round2(qty * rate);
        const rowH = 24;
        if (idx % 2 === 0) {
          drawRoundedRect(doc, tableX, cursorY, tableW, rowH, 0, THEME.altRow, THEME.line);
        }
        const textY = cursorY + 7;
        doc.fillColor(THEME.ink)
          .font("Helvetica")
          .fontSize(10);
        doc.text(String(idx + 1), cols.idx.x, textY, { width: cols.idx.w, align: cols.idx.align });
        doc.font("Helvetica-Bold")
          .text(String(item.name || "Item"), cols.name.x, textY, {
            width: cols.name.w,
            align: cols.name.align,
            ellipsis: true,
          });
        doc.font("Helvetica-Bold")
          .fillColor(THEME.inkSoft)
          .text(String(qty), cols.qty.x, textY, { width: cols.qty.w, align: cols.qty.align });
        doc.text(`${INR} ${formatINR(rate)}`, cols.rate.x, textY, {
          width: cols.rate.w,
          align: cols.rate.align,
        });
        doc.font("Helvetica-Bold")
          .fillColor(THEME.ink)
          .text(`${INR} ${formatINR(amount)}`, cols.amount.x, textY, {
            width: cols.amount.w,
            align: cols.amount.align,
          });
        cursorY += rowH;
      });
    }

    // Bottom border under table
    cursorY += 4;
    doc.save().strokeColor(THEME.line).lineWidth(1)
      .moveTo(tableX, cursorY).lineTo(tableX + tableW, cursorY).stroke().restore();

    cursorY += 14;

    // ── TOTALS (left empty, right block) ───────────────────────────────────
    const totalsW = 240;
    const totalsX = tableX + tableW - totalsW;

    // Add a quick "Items count" stat on the left
    doc.font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(THEME.muted)
      .text("TOTAL ITEMS", CONTENT.x, cursorY + 6, { characterSpacing: 1.2 });
    doc.font("Helvetica-Bold")
      .fontSize(22)
      .fillColor(THEME.primary)
      .text(String(items.length), CONTENT.x, cursorY + 18);

    const totalsStartY = cursorY;

    const totalsRows = [
      { label: "Subtotal", value: subtotal, bold: false },
      { label: `SGST (${gstPercent / 2}%)`, value: sgst, bold: false },
      { label: `CGST (${gstPercent / 2}%)`, value: cgst, bold: false },
      { label: "Ser.Charges @5.00%", value: serviceCharge, bold: false, hidden: serviceCharge === 0 },
      { label: "Discount", value: -discount, bold: false, muted: discount > 0 },
    ];

    let tY = totalsStartY + 4;
    totalsRows.forEach((row) => {
      if (row.hidden) return;
      doc.font(row.bold ? "Helvetica-Bold" : "Helvetica-Bold")
        .fontSize(10)
        .fillColor(row.muted ? "#B91C1C" : THEME.inkSoft)
        .text(row.label, totalsX, tY, { width: 130 });
      doc.font("Helvetica-Bold")
        .fillColor(row.muted ? "#B91C1C" : THEME.ink)
        .text(`${INR} ${formatINR(Math.abs(row.value))}`, totalsX + 130, tY, {
          width: totalsW - 130,
          align: "right",
        });
      tY += 16;
    });

    // Divider above grand total
    tY += 2;
    doc.save().strokeColor(THEME.line).lineWidth(1.2)
      .moveTo(totalsX, tY).lineTo(totalsX + totalsW, tY).stroke().restore();
    tY += 6;

    // Grand Total pill
    const pillH = 30;
    gradientFill(doc, totalsX, tY, totalsW, pillH, THEME.primary, THEME.primaryDark);
    doc.fillColor(THEME.white)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("GRAND TOTAL", totalsX + 12, tY + 9, { width: 110 });
    doc.fillColor(THEME.accent)
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(`${INR} ${formatINR(grandTotal)}`, totalsX + 110, tY + 7, {
        width: totalsW - 120,
        align: "right",
      });

    cursorY = Math.max(cursorY + 30, tY + pillH);

    // ── FOOTER ─────────────────────────────────────────────────────────────
    // Thank-you band
    const footerY = PAGE.height - 72;
    doc.save().strokeColor(THEME.line).lineWidth(1)
      .moveTo(CONTENT.x, footerY - 12).lineTo(CONTENT.x + CONTENT.w, footerY - 12).stroke().restore();

    doc.font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(THEME.primary)
      .text("Thank you for dining with us!", CONTENT.x, footerY, { width: CONTENT.w, align: "center" });

    doc.font("Helvetica")
      .fontSize(8)
      .fillColor(THEME.muted)
      .text(
        `${RESORT.addressLine}  ·  GSTIN: ${RESORT.gstin}`,
        CONTENT.x,
        footerY + 16,
        { width: CONTENT.w, align: "center" },
      );

    doc.end();
  });

  return { filePath, fileName, invoiceNo };
};

module.exports = {
  generateRestaurantInvoicePdf,
};