/**
 * PrintUtils — shared PDF generation and printer communication utilities.
 *
 * Provides:
 *   - PDF generation for A4 invoices (using pdfkit)
 *   - PDF generation for thermal receipt-like PDFs
 *   - PDF-to-printer dispatch using pdf-to-printer
 *   - Printer status checking
 *
 * NOTE: Only generateA4InvoicePdf's visual layout was redesigned to match
 * the resort's "Tax Invoice" reference design (same layout now used in
 * invoicePdfService.js). No business logic was added — totals/GST/etc. are
 * still derived from the same fields and the same 5% GST assumption this
 * file already used. Thermal PDF generation and printer dispatch below are
 * unchanged.
 *
 * FIX (print dispatch): printPdfToPrinter previously shelled out to
 * `npx pdf-to-printer ...` via child_process.exec. The "pdf-to-printer" npm
 * package is a library only — it ships no CLI/bin entry point — so npx could
 * never resolve an executable for it ("npm error could not determine
 * executable to run"), and every KOT/print job failed and retried until it
 * hit the retry limit. printPdfToPrinter now calls the library's own
 * print() function directly instead of shelling out.
 *
 * FIX (thermal page sizing): generateThermalPdf previously estimated the
 * page height using a rough "chars per line" guess based on the default
 * FONT_SIZE, and it wrapped lines only implicitly by letting pdfkit's
 * `.text()` auto-wrap. That estimate didn't match Courier-Bold's real glyph
 * width, so the computed page height was often taller than the actual
 * wrapped content — the printer then received a page with extra blank
 * space at the bottom. generateThermalPdf now manually wraps every line to
 * an exact CHARS_PER_LINE (based on Courier's real ~6pt-per-char width),
 * computes the page height directly from the number of wrapped lines, and
 * draws each line at a fixed y with lineBreak disabled — so the page is
 * sized to exactly the content, no more, no less.
 */

const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");
const PDFDocument = require("pdfkit");
const { print: ptpPrint } = require("pdf-to-printer");
const PrintConfig = require("../PrintConfig");

// FIX: execAsync was used below (in checkPrinterStatus) but was never
// defined anywhere in this file. Every call to it threw
// "execAsync is not defined", which was silently swallowed by try/catch
// blocks — so print jobs looked like they "ran" but never actually reached
// the printer correctly.
const execAsync = promisify(exec);

// Relative env paths are resolved from __dirname (this file lives in
// backend/), so the path is correct regardless of process.cwd().
const OUTPUT_DIR = (() => {
  const raw = process.env.INVOICE_UPLOAD_DIR;
  if (!raw) return path.resolve(__dirname, "..", "uploads", "invoices");
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(__dirname, "..", raw);
})();

const THERMAL_PDF_DIR = (() => {
  const raw = process.env.THERMAL_UPLOAD_DIR;
  if (!raw) return path.resolve(__dirname, "..", "uploads", "thermal");
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(__dirname, "..", raw);
})();

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(OUTPUT_DIR);
ensureDir(THERMAL_PDF_DIR);

const INR = "Rs.";
const formatINR = (value) => {
  const num = Number(value || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ─── Fixed resort details (as given in the reference invoice) ─────────────────
const RESORT = {
  name: "MAA BAGLAMUKHI RESORT",
  addressLine1: "Maa Baglamukhi Mandir Road, Nalkheda",
  addressLine2: "Maa Baglamukhi mandir road Nalkheda, District: Agar Malwa 465445",
  phone: "9522238777, 9522239777",
  email: "maabaglamukhiresort@gmail.com",
  website: "www.maabaglamukhiresort.com",
  gstin: "23AVDPR2928J1ZG",
};

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

// ─── Theme (kept for thermal / any other consumers of THEME) ─────────────────

const THEME = {
  primary: "#0F4C81",
  primaryDark: "#0A3A66",
  accent: "#F59E0B",
  ink: "#000000",
  inkSoft: "#000000",
  muted: "#000000",
  line: "#000000",
  band: "#F8FAFC",
  altRow: "#F1F5F9",
  white: "#FFFFFF",
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

const gradientFill = (doc, x, y, w, h, colorTop, colorBottom) => {
  const steps = Math.max(40, Math.round(h / 2));
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const [r1, g1, b1] = hexToRgb(colorTop);
    const [r2, g2, b2] = hexToRgb(colorBottom);
    const r = Math.round(r1 * (1 - t) + r2 * t);
    const g = Math.round(g1 * (1 - t) + g2 * t);
    const b = Math.round(b1 * (1 - t) + b2 * t);
    doc.save();
    doc.rect(x, y + (h * i) / steps, w, h / steps + 0.5).fillColor(`rgb(${r},${g},${b})`).fill();
    doc.restore();
  }
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

// ─── PDF Generation ───────────────────────────────────────────────────────────

/**
 * Draws the "Tax Invoice" layout (matches the resort's reference design)
 * onto an already-open pdfkit document. Presentation only — reads existing
 * fields from `invoiceData` / `invoiceData.items`.
 */
const drawTaxInvoice = (doc, invoiceData) => {
  const PAGE_LEFT = 40;
  const PAGE_RIGHT = 555;
  const BOX_W = PAGE_RIGHT - PAGE_LEFT;

  const items = Array.isArray(invoiceData.items) ? invoiceData.items : [];

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
    doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor("#000000").lineWidth(0.8).stroke();
  };
  const vLine = (x, y1, y2) => {
    doc.moveTo(x, y1).lineTo(x, y2).strokeColor("#000000").lineWidth(0.8).stroke();
  };
  const rect = (x, y, w, h) => {
    doc.rect(x, y, w, h).strokeColor("#000000").lineWidth(1).stroke();
  };

  let y = 36;
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(16).text("Tax Invoice", PAGE_LEFT, y, {
    width: BOX_W,
    align: "center",
  });

  const boxTop = y + 26;
  y = boxTop + 10;

  doc.font("Helvetica-Bold").fontSize(13).text(RESORT.name, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 16;
  doc.font("Helvetica").fontSize(9).text(RESORT.addressLine2, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 12;
  doc.text(`Ph: ${RESORT.phone}`, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 12;
  doc.text(`${RESORT.email}  |  ${RESORT.website}`, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 12;
  doc.font("Helvetica-Bold").text(`GSTIN: ${RESORT.gstin}`, PAGE_LEFT, y, { width: BOX_W, align: "center" });
  y += 16;

  const headerBottom = y;
  hLine(headerBottom);
  y += 8;

  const metaColMid = PAGE_LEFT + BOX_W / 2;
  const nights = (() => {
    if (invoiceData.nights) return invoiceData.nights;
    if (invoiceData.checkIn && invoiceData.checkOut) {
      const d1 = new Date(invoiceData.checkIn);
      const d2 = new Date(invoiceData.checkOut);
      const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      return diff > 0 ? diff : 1;
    }
    return "N/A";
  })();

  const leftRows = [
    ["Folio No.", String(invoiceData.bookingId || invoiceData.customerId || invoiceData.folioNo || "N/A")],
    ["Guest Name", String(invoiceData.customerName || "Guest")],
    ["Address", String(invoiceData.address || "N/A")],
    ["Contact #", String(invoiceData.phone || "N/A")],
  ];
  const rightRows = [
    ["Invoice No.", String(invoiceData.invoiceNo || "N/A")],
    ["Invoice Date", String(invoiceData.date || "N/A")],
    ["Room No.", String(invoiceData.roomNumber || "N/A")],
    ["Room Type", String(invoiceData.roomType || "N/A")],
    ["Arrival", String(invoiceData.checkIn || "N/A")],
    ["Departure", String(invoiceData.checkOut || "N/A")],
    ["Pax", String(invoiceData.pax || "N/A")],
    ["No. of Nights", String(nights)],
    ["Guest GSTIN", String(invoiceData.guestGstin || invoiceData.companyGstin || "—")],
    ["Guest Company", String(invoiceData.guestCompany || invoiceData.companyName || "—")],
  ];

  const metaRowH = 13;
  const metaStartY = y;
  doc.fontSize(8.5);
  leftRows.forEach(([label, val], i) => {
    const ry = metaStartY + i * metaRowH;
    doc.font("Helvetica-Bold").text(label, PAGE_LEFT + 6, ry, { width: 90 });
    doc.font("Helvetica").text(val, PAGE_LEFT + 100, ry, { width: metaColMid - PAGE_LEFT - 106 });
  });
  rightRows.forEach(([label, val], i) => {
    const ry = metaStartY + i * metaRowH;
    doc.font("Helvetica-Bold").text(label, metaColMid + 6, ry, { width: 90 });
    doc.font("Helvetica").text(val, metaColMid + 100, ry, { width: PAGE_RIGHT - metaColMid - 106 });
  });

  const metaBottom = metaStartY + Math.max(leftRows.length, rightRows.length) * metaRowH + 6;
  vLine(metaColMid, headerBottom, metaBottom);
  hLine(metaBottom);
  y = metaBottom + 4;

  doc.font("Helvetica-Bold").fontSize(9).text("Billing Details", PAGE_LEFT + 4, y);
  y += 13;

  const tableHeaderTop = y;
  const headerLabels = ["Date", "Particulars", "Tariff", "Disc", "Taxable", "SGST 2.5%", "CGST 2.5%", "Total"];
  doc.font("Helvetica-Bold").fontSize(7.8);
  headerLabels.forEach((label, i) => {
    doc.text(label, colEnds[i] + 3, tableHeaderTop + 3, { width: colEnds[i + 1] - colEnds[i] - 5 });
  });
  const tableHeaderBottom = tableHeaderTop + 14;
  hLine(tableHeaderBottom);
  y = tableHeaderBottom;

  const rowH = 15;
  let tariffTotal = 0;
  let sgstTotal = 0;
  let cgstTotal = 0;

  doc.font("Helvetica").fontSize(7.8);
  items.forEach((item) => {
    const rowY = y;
    const taxable = Number(item.total != null ? item.total : item.price || 0);
    const tariff = Number(item.price || taxable);
    const disc = Number(item.discount || 0);
    const sgst = taxable * 0.025;
    const cgst = taxable * 0.025;
    const rowTotal = taxable + sgst + cgst;

    tariffTotal += tariff;
    sgstTotal += sgst;
    cgstTotal += cgst;

    const rowValues = [
      String(item.date || invoiceData.date || "N/A"),
      String(item.name || item.category || "Charge"),
      formatINR(tariff),
      formatINR(disc),
      formatINR(taxable),
      formatINR(sgst),
      formatINR(cgst),
      formatINR(rowTotal),
    ];
    rowValues.forEach((val, i) => {
      doc.text(val, colEnds[i] + 3, rowY + 3, { width: colEnds[i + 1] - colEnds[i] - 5 });
    });
    y += rowH;
  });

  if (items.length === 0) {
    y += rowH;
  }

  const tableBottom = y;
  hLine(tableBottom);
  for (let i = 1; i < colEnds.length - 1; i += 1) {
    vLine(colEnds[i], tableHeaderTop, tableBottom);
  }
  vLine(PAGE_LEFT, tableHeaderTop, tableBottom);
  vLine(PAGE_RIGHT, tableHeaderTop, tableBottom);

  y = tableBottom + 6;

  const remarksTop = y;
  doc.font("Helvetica-Bold").fontSize(8).text("Remarks", PAGE_LEFT + 6, y);

  const subtotal = Number(invoiceData.subtotal != null ? invoiceData.subtotal : tariffTotal);
  const discount = Number(invoiceData.discount || 0);
  const taxableAmount = subtotal - discount;
  const sgst = invoiceData.tax != null ? Number(invoiceData.tax) / 2 : sgstTotal;
  const cgst = invoiceData.tax != null ? Number(invoiceData.tax) / 2 : cgstTotal;
  const roomTotal = taxableAmount + sgst + cgst;
  const roundOff = 0;
  const serviceTotal = Number(invoiceData.extraCharge || 0);
  const finalTotal = Number(
    invoiceData.totalAmount != null ? invoiceData.totalAmount : roomTotal + serviceTotal - roundOff,
  );

  const totalsRows = [
    ["Tariff Total", tariffTotal],
    ["Discount", discount],
    ["Taxable Amount", taxableAmount],
    ["SGST", sgst],
    ["CGST", cgst],
    ["Room Total", roomTotal],
    ["Round Off Disc.", roundOff],
    ["Final Total", finalTotal],
    ["Service Total", serviceTotal],
  ];

  const totalsLabelX = PAGE_LEFT + 300;
  const totalsValueX = PAGE_LEFT + 430;
  const totalsRowH = 12.5;
  doc.fontSize(8);
  totalsRows.forEach(([label, val], i) => {
    const ry = remarksTop + i * totalsRowH;
    const isFinal = label === "Final Total";
    doc.font(isFinal ? "Helvetica-Bold" : "Helvetica").text(label, totalsLabelX, ry, { width: 125 });
    doc.text(formatINR(val), totalsValueX, ry, { width: 85, align: "right" });
  });

  const remarksBottom = remarksTop + totalsRows.length * totalsRowH + 8;
  vLine(totalsLabelX - 6, remarksTop - 4, remarksBottom);
  hLine(remarksBottom);
  y = remarksBottom + 4;

  const wordsTop = y;
  doc.font("Helvetica-Bold").fontSize(8.5).text(numberToWordsINR(finalTotal), PAGE_LEFT + 6, wordsTop + 3, {
    width: 300,
  });
  doc.font("Helvetica-Bold").fontSize(10).text("Final Total", totalsLabelX, wordsTop + 3, { width: 90 });
  doc.text(`${INR} ${formatINR(finalTotal)}`, totalsValueX - 20, wordsTop + 3, { width: 105, align: "right" });

  const wordsBottom = wordsTop + 22;
  vLine(totalsLabelX - 6, wordsTop, wordsBottom);
  hLine(wordsBottom);
  y = wordsBottom + 4;

  const noteTop = y;
  doc.font("Helvetica-Bold").fontSize(8).text("INVOICE NOTE", PAGE_LEFT + 6, noteTop);
  doc.font("Helvetica-Bold").fontSize(8).text("PAYMENT DETAIL", totalsLabelX, noteTop, { width: 170, align: "right" });

  doc.font("Helvetica").fontSize(8).text("Thanks Pl Visit Again!!", PAGE_LEFT + 6, noteTop + 13);

  const paymentRows = [
    [String(invoiceData.paymentMode || "N/A"), Number(invoiceData.totalAmount != null ? invoiceData.totalAmount : finalTotal)],
    ["Balance", 0],
  ];
  paymentRows.forEach(([label, val], i) => {
    const ry = noteTop + 13 + i * 13;
    doc.font("Helvetica").text(label, totalsLabelX, ry, { width: 85 });
    doc.text(formatINR(val), totalsValueX, ry, { width: 85, align: "right" });
  });

  const noteBottom = noteTop + 13 + paymentRows.length * 13 + 6;
  vLine(totalsLabelX - 6, noteTop - 4, noteBottom);
  hLine(noteBottom);

  const boxBottom = noteBottom;

  rect(PAGE_LEFT, boxTop, BOX_W, boxBottom - boxTop);
  vLine(PAGE_LEFT, boxTop, boxBottom);
  vLine(PAGE_RIGHT, boxTop, boxBottom);

  const footerTop = boxBottom + 20;
  const footerHeight = 70;
  rect(PAGE_LEFT, footerTop, BOX_W, footerHeight);

  doc.font("Helvetica-Bold").fontSize(9).text(`For ${RESORT.name}`, PAGE_LEFT + 10, footerTop + 12);

  doc.font("Helvetica").fontSize(8.5);
  doc.text("Authorised Signature", PAGE_LEFT + 10, footerTop + footerHeight - 18);
  doc.text("Guest Signature", PAGE_RIGHT - 150, footerTop + footerHeight - 18, { width: 140, align: "right" });

  doc.font("Helvetica").fontSize(7.5).text(
    `Invoice Generated By: ${invoiceData.generatedBy || invoiceData.staffName || "N/A"}`,
    PAGE_LEFT + 10,
    footerTop + footerHeight + 6,
  );
};

/**
 * Generate a professional A4 invoice PDF using pdfkit.
 * Used by InvoicePrintService for all A4 documents.
 */
const generateA4InvoicePdf = (invoiceData) => {
  ensureDir(OUTPUT_DIR);

  const safeId = String(invoiceData.bookingId || invoiceData.customerId || invoiceData.id || "unknown");
  const safeInvoiceNo = String(invoiceData.invoiceNo || `INV-${safeId}-${Date.now()}`).replace(/[^A-Za-z0-9\-]/g, "_");
  const fileName = `invoice_${safeInvoiceNo}.pdf`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const stream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve({ filePath, fileName }));
    stream.on("error", reject);
    doc.pipe(stream);

    try {
      drawTaxInvoice(doc, invoiceData);
      doc.end();
    } catch (err) {
      doc.end();
      stream.destroy();
      fs.unlink(filePath, () => {});
      reject(err);
    }
  });
};

/**
 * Generate a thermal receipt PDF (mimics 80mm thermal paper).
 *
 * @param {Buffer|null} escPosBuffer - raw ESC/POS buffer (unused, kept for compat)
 * @param {object|null} printer - printer config object (unused, kept for compat)
 * @param {string} textContent - plain text content to render
 *
 * FIX (blank space bug): the old version guessed the page height from a
 * rough "chars per line" estimate and let pdfkit auto-wrap text inside
 * `.text()`. That estimate never matched Courier-Bold's real character
 * width, so the page pdfkit created was consistently taller than the text
 * actually rendered — the printer then had to fill the extra vertical
 * space with blank paper. This version:
 *   1. Manually wraps every line to an exact CHARS_PER_LINE, computed from
 *      Courier's real ~6pt-per-glyph width at FONT_SIZE.
 *   2. Sizes the PDF page height directly from the number of wrapped lines
 *      (wrappedLines.length * LINE_HEIGHT + margins) — no guessing.
 *   3. Draws each wrapped line at a fixed y position with lineBreak
 *      disabled, so pdfkit can't re-wrap (and therefore can't silently
 *      grow) the content underneath us.
 * Net effect: the PDF page is exactly as tall as the content, so the
 * printer prints only the content — no leftover blank paper.
 */
// ─── Thermal layout constants (module scope so they can be exported and
// reused by callers, e.g. ThermalPrintService, which needs the same
// CHARS_PER_LINE to correctly center text before it's handed to
// generateThermalPdf below) ────────────────────────────────────────────────

// 80mm thermal paper = 226.77 points
// Printer printable width ≈ 72.1mm = 204.38 points
const THERMAL_PAGE_WIDTH = 226.77;
const THERMAL_MARGIN = {
  top: 6,
  bottom: 6,
  left: 10,
  right: 10,
};
const THERMAL_CONTENT_WIDTH = THERMAL_PAGE_WIDTH - THERMAL_MARGIN.left - THERMAL_MARGIN.right;
const THERMAL_FONT_SIZE = 10;
const THERMAL_LINE_HEIGHT = 13;

// Courier is a fixed-width font — at 10pt each glyph is ~6pt wide. Using
// the real glyph width (instead of a generic ratio) is what keeps
// THERMAL_CHARS_PER_LINE accurate.
const THERMAL_CHAR_WIDTH = 6;

// FIX (hotel name printing off-center): buildKOTReceipt/buildPaymentReceipt
// in ThermalPrintService were centering text assuming a 48-character-wide
// line, but generateThermalPdf actually only fits ~34 characters per line
// on this printer's real content width. That mismatch meant centerText()
// added padding sized for a 48-char line, which is too much for the
// printer's real 34-char line, so the "centered" text landed shifted
// toward the right edge (and sometimes got wrapped/cut) instead of
// centered. Exporting THERMAL_CHARS_PER_LINE lets ThermalPrintService pad
// against the printer's actual line width instead of a guessed constant.
const THERMAL_CHARS_PER_LINE = Math.max(20, Math.floor(THERMAL_CONTENT_WIDTH / THERMAL_CHAR_WIDTH));

const generateThermalPdf = (escPosBuffer, printer, textContent = "", opts = {}) => {
  ensureDir(THERMAL_PDF_DIR);

  const fileName = `thermal_${Date.now()}.pdf`;
  const filePath = path.join(THERMAL_PDF_DIR, fileName);

  const PAGE_WIDTH = THERMAL_PAGE_WIDTH;
  const MARGIN = THERMAL_MARGIN;
  const CONTENT_WIDTH = THERMAL_CONTENT_WIDTH;
  const FONT_SIZE = THERMAL_FONT_SIZE;
  const LINE_HEIGHT = THERMAL_LINE_HEIGHT;

  const content = String(textContent || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const CHAR_WIDTH = THERMAL_CHAR_WIDTH;
  const CHARS_PER_LINE = THERMAL_CHARS_PER_LINE;

  // Wrap every line ourselves so we know the EXACT final line count before
  // we ever create the PDFDocument — pdfkit's own auto-wrap can't be
  // trusted to match this, since it wraps by measured glyph width, not by
  // our CHARS_PER_LINE estimate, and the two can disagree.
  const rawLines = content.split("\n");
  const wrappedLines = [];
  for (const line of rawLines) {
    if (!line) {
      wrappedLines.push("");
      continue;
    }
    let remaining = line;
    while (remaining.length > CHARS_PER_LINE) {
      wrappedLines.push(remaining.substring(0, CHARS_PER_LINE));
      remaining = remaining.substring(CHARS_PER_LINE);
    }
    wrappedLines.push(remaining);
  }

  // Calculate EXACT page height from content — no 9999pt page, no fixed
  // 297mm height, just margins + (line count * line height).
  const contentHeight = wrappedLines.length * LINE_HEIGHT;
  const pageHeight = Math.max(60, MARGIN.top + contentHeight + MARGIN.bottom + 4);

  console.log(`[Thermal PDF] lines=${wrappedLines.length}, height=${pageHeight}pt`);

  const doc = new PDFDocument({
    size: [PAGE_WIDTH, pageHeight],
    margins: MARGIN,
    autoFirstPage: true,
  });

  const stream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      resolve({
        filePath,
        fileName,
        pageWidth: PAGE_WIDTH,
        pageHeight,
        lines: wrappedLines.length,
      });
    });
    stream.on("error", reject);
    doc.pipe(stream);

    // Courier-Bold is the same fixed-width metric as Courier, so the
    // CHARS_PER_LINE / centering math above stays exact — the glyphs just
    // print heavier, which on thermal paper reads as "darker + bolder".
    doc.fillColor("#000000").font(opts.bold ? "Courier-Bold" : "Courier").fontSize(FONT_SIZE);

    let y = MARGIN.top;
    for (const line of wrappedLines) {
      doc.text(line, MARGIN.left, y, {
        width: CONTENT_WIDTH,
        height: LINE_HEIGHT,
        lineBreak: false,
      });
      y += LINE_HEIGHT;
    }

    doc.end();
  });
};

/**
 * Extract plain text from ESC/POS binary buffer.
 */
const extractTextFromEscPos = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return String(buffer || "");

  const lines = [];
  let currentLine = "";

  let i = 0;
  while (i < buffer.length) {
    const byte = buffer[i];

    // Newline
    if (byte === 0x0a || byte === 0x0d) {
      lines.push(currentLine);
      currentLine = "";
      i++;
      continue;
    }

    // Skip ESC/POS commands
    if (byte === 0x1b) {
      i++;
      const cmd = buffer[i];
      if (cmd === 0x40) { // @ - initialize (1 byte)
        i++;
      } else if (cmd === 0x21) { // ! - font selection (2 bytes)
        i += 2;
      } else if (cmd === 0x61) { // a - alignment (2 bytes)
        i += 2;
      } else if (cmd === 0x45) { // E - bold (2 bytes)
        i += 2;
      } else if (cmd === 0x2d) { // - - underline (2 bytes)
        i += 2;
      } else if (cmd === 0x4d) { // M - font (2 bytes)
        i += 2;
      } else if (cmd === 0x64) { // d - feed lines (3 bytes)
        i += 3;
      } else if (cmd === 0x70) { // p - pulse (4 bytes)
        i += 4;
      } else if (cmd === 0x33 || cmd === 0x32) { // line spacing
        i += 2;
      } else {
        // Unknown ESC sequence, skip 1-2 bytes
        i += 2;
      }
      continue;
    }

    // Skip GS commands
    if (byte === 0x1d) {
      i++;
      const cmd = buffer[i];

      if (cmd === 0x21) { // ! - print mode (2 bytes)
        i += 2;
      } else if (cmd === 0x56) { // V - cut (2 bytes)
        i += 2;
      } else if (cmd === 0x68) { // h - barcode height (3 bytes)
        i += 3;
      } else if (cmd === 0x77) { // w - barcode width (3 bytes)
        i += 3;
      } else if (cmd === 0x6b) { // k - barcode (variable)
        i++;
        const len = buffer[i] + 2;
        i += len;
      } else if (cmd === 0x28) { // ( - GS ( commands (QR, etc.)
        i++;
        const func = buffer[i];
        i++;
        const pl = buffer[i];
        const ph = buffer[i + 1];
        const totalLen = pl + ph * 256;
        i += totalLen + 2;
      } else {
        i += 2;
      }
      continue;
    }

    // Regular ASCII character
    if (byte >= 0x20 && byte < 0x7f) {
      currentLine += String.fromCharCode(byte);
    }
    i++;
  }

  if (currentLine) lines.push(currentLine);

  return lines.join("\n");
};

/**
 * Send a PDF file to the Windows printer using pdf-to-printer.
 *
 * FIX: previously shelled out to `npx pdf-to-printer ...`. The
 * "pdf-to-printer" package has no CLI/bin, so npx could never find an
 * executable to run and every print job failed with
 * "npm error could not determine executable to run". We now call the
 * library's print() function directly (no child_process involved).
 */
const printPdfToPrinter = async (filePath, printerName, paperSize = null) => {
  try {
    // FIX (blank space at print time): the generated PDF's page is already
    // sized exactly to the content (see generateThermalPdf). But by
    // default, the Windows print driver (via SumatraPDF, which
    // pdf-to-printer uses under the hood) will "fit"/scale our small page
    // onto whatever paper size is configured as default for the printer —
    // if that default is longer than our content (e.g. a fixed roll
    // length or A4), the driver stretches/pads our page to fill it, which
    // is what shows up as blank space above/below the printed content even
    // though the PDF file itself is correct. scale: "noscale" tells the
    // driver to print the PDF at its own exact size instead of
    // fitting/padding it onto the printer's configured default page.
    //
    // FIX (root cause of the blank-space issue on the kitchen printer):
    // its driver has 3 registered paper forms — two fixed-length sheets
    // (210mm, 297mm) and one continuous-roll form (3276mm). Setting the
    // 3276mm form as default via the GUI ("Printing Preferences") only
    // changes the *interactive* default — headless/silent print jobs sent
    // through SumatraPDF don't pick that up and fall back to the driver's
    // original fixed-length form, which is longer than our content, so the
    // driver pads the leftover length with blank paper.
    //
    // We can't hardcode that roll-form name here because this function
    // also prints A4 invoices to other printers that don't have it — so
    // paperSize is an optional 3rd argument: callers that know they're
    // printing to a roll-paper printer (e.g. ThermalPrintService) pass the
    // exact form name from getPrinters(), and everything else (A4
    // invoices) is unaffected and keeps using the printer's own default.
    const options = {
      printer: printerName,
      silent: true,
      scale: "noscale",
    };
    if (paperSize) {
      options.paperSize = paperSize;
    }

    await ptpPrint(filePath, options);

    return { success: true, output: `Sent to printer: ${printerName}` };
  } catch (err) {
    console.error("[Print] Failed to print:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Check printer status (online/offline).
 */
const checkPrinterStatus = async (printerName) => {
  try {
    // On Windows, check printer status via PowerShell
    const script = `
      $printer = Get-Printer -Name "${printerName.replace(/"/g, '\\"')}" -ErrorAction SilentlyContinue
      if ($printer) {
        Write-Host "STATUS: $($printer.PrinterStatus)"
        Write-Host "PORT: $($printer.PortName)"
      } else {
        Write-Host "STATUS: NOT_FOUND"
      }
    `;

    const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`, {
      shell: "cmd.exe",
      timeout: 10000,
    });

    const statusMatch = stdout.match(/STATUS: (\w+)/);
    const portMatch = stdout.match(/PORT: (.+)/);

    return {
      found: statusMatch !== null,
      status: statusMatch ? statusMatch[1] : "UNKNOWN",
      port: portMatch ? portMatch[1] : null,
      online: statusMatch && ["Ready", "Idle", "Printing"].includes(statusMatch[1]),
    };
  } catch (err) {
    return {
      found: false,
      status: "UNKNOWN",
      online: false,
      error: err.message,
    };
  }
};

module.exports = {
  generateA4InvoicePdf,
  generateThermalPdf,
  printPdfToPrinter,
  checkPrinterStatus,
  extractTextFromEscPos,
  ensureDir,
  formatINR,
  THEME,
  hexToRgb,
  gradientFill,
  drawRoundedRect,
  THERMAL_CHARS_PER_LINE,
};