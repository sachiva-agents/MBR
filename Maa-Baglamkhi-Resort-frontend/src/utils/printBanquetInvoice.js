/**
 * printBanquetInvoice.js — Prints a Banquet invoice as a standalone A4
 * document, laid out EXACTLY like the hotel "Tax Invoice" design in
 * BookingFlow.jsx (handlePrintInvoiceDirect): framed box, centered title,
 * resort block, guest/event meta-grid, Billing Details table with
 * SGST/CGST columns, Remarks + Totals, amount-in-words, Invoice Note +
 * Payment Detail, and the signature block.
 *
 * Printing is done through a hidden off-screen iframe (same proven
 * strategy as printKOT.js — window.print() / window.open() on the main
 * app page gave blank previews and popup-blocker issues), so only this
 * invoice's document ever reaches the print dialog.
 */

// ── Resort constants (identical to the hotel invoice renders) ─────────
const RESORT_NAME_INVOICE = "MAA BAGLAMUKHI RESORT";
const RESORT_ADDRESS_LINE_1 = "Maa Baglamukhi Mandir Raod, Nalkheda";
const RESORT_ADDRESS_LINE_2 = "Agar Malwa, 465445";
const RESORT_PHONE_INVOICE = "9522238777, 9522239777";
const RESORT_EMAIL_INVOICE = "maabaglamukhiresort@gmail.com";
const RESORT_GSTIN_INVOICE = "23AVDPR2928J1ZG";
const RESORT_WEBSITE = "www.maabaglamukhiresort.com";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// ── Same helpers the hotel invoice uses ───────────────────────────────
const fmtMoney = (v) =>
  Number(v || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDate = (value) => {
  if (!value) return "-";
  // Parse YYYY-MM-DD as LOCAL midnight so timezone offsets don't shift the day
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const toWords = (amount) => {
  if (!amount || amount <= 0) return "Rupees Zero Only";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty",
    "Sixty", "Seventy", "Eighty", "Ninety",
  ];
  const words = (n) => {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + " " + words(n % 10);
    if (n < 1000)
      return ones[Math.floor(n / 100)] + " Hundred " + words(n % 100);
    if (n < 1e5)
      return words(Math.floor(n / 1000)) + " Thousand " + words(n % 1000);
    if (n < 1e7) return words(Math.floor(n / 1e5)) + " Lakh " + words(n % 1e5);
    return words(Math.floor(n / 1e7)) + " Crore " + words(n % 1e7);
  };
  const rounded = Math.round(amount * 100) / 100;
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);
  let result = "Rupees " + words(whole).trim();
  if (paise > 0) result += " and " + words(paise).trim() + " Paise";
  return result + " Only";
};

// ── Totals: computed the same way BanquetBill.jsx displays them ──────
const computeInvoiceTotals = (booking, halls, menuPackages, lightingOptions) => {
  const hall = halls.find((h) => String(h.id) === String(booking.hallId));
  const menuPackage = menuPackages.find((p) => p.id === booking.menuPackageId);
  const lighting = lightingOptions.find((item) => item.id === booking.lightingSystem);

  const startTime = booking.startTime || "18:00";
  const endTime = booking.endTime || "22:00";
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const hours = Math.max(1, Math.ceil((eh * 60 + em - (sh * 60 + sm)) / 60));

  const hallCharge =
    Number(booking.hallCharge || booking.hall_charge) ||
    (hall ? Number(hall.ratePerHour || 0) * hours : 0);
  const foodCharge =
    Number(booking.mealCharge || booking.meal_charge) ||
    Number(booking.guests || 0) * Number(menuPackage?.perGuest || 0);
  const customMenuCharge = Number(booking.customMenuCharge || booking.custom_menu_charge || 0);
  const lightingCharge =
    Number(booking.lightingCharge || booking.lighting_charge) ||
    Number(lighting?.price || 0);
  const eventSupportCharge = Number(booking.eventSupportFee || booking.event_support_fee || 0);
  const decoration = Number(booking.decorationFee || booking.decoration_fee || 0);
  const discount = Number(booking.discount || 0);

  const subTotal =
    Number(booking.subtotalAmount || booking.subtotal_amount) ||
    hallCharge + foodCharge + customMenuCharge + lightingCharge + eventSupportCharge + decoration;
  const taxableAmount = Math.max(0, subTotal - discount);
  const gstPercent = Number(booking.gstPercent ?? booking.gst_percent ?? 5) || 0;
  const gst =
    Number(booking.gstAmount || booking.gst_amount) ||
    Math.round(taxableAmount * (gstPercent / 100));
  const grandTotal =
    Number(
      booking.grandTotal ||
        booking.grand_total ||
        booking.totalAmount ||
        booking.total_amount
    ) ||
    taxableAmount + gst;
  const advance = Number(booking.advance || 0);
  const refundAmount = Number(booking.refundAmount || booking.refund_amount || 0);
  const netReceived =
    Number(booking.netReceived || booking.net_received) || Math.max(0, advance - refundAmount);
  const balance =
    Number(booking.balanceDue || booking.balance_due) ||
    Math.max(0, grandTotal - netReceived);

  return {
    hallCharge,
    foodCharge,
    customMenuCharge,
    lightingCharge,
    eventSupportCharge,
    decoration,
    discount,
    subTotal,
    taxableAmount,
    gstPercent,
    gst,
    grandTotal,
    advance,
    refundAmount,
    netReceived,
    balance,
    hours,
    hallName: hall?.name || booking.hallName || "",
    menuPackageName: menuPackage?.name || "",
    lightingName: lighting?.name || "",
  };
};

const buildInvoiceHtml = ({ booking, totals, invoiceNo, invoiceDate, eventDate }) => {
  const halfPct = Number((totals.gstPercent / 2).toFixed(2));
  const halfLabel = (pct) => String(pct).replace(/\.?0+$/, "");
  const sgstHalf = totals.gst / 2;
  const cgstHalf = totals.gst - sgstHalf;

  const particularsFor = (label, detail) =>
    `${label.toUpperCase()}${detail ? ` - ${detail.toUpperCase()}` : ""}`;

  const rows = [];
  const pushRow = (particulars, tariff) => {
    const gstOnRow = Number(((tariff * totals.gstPercent) / 100).toFixed(2));
    rows.push({
      date: eventDate,
      particulars,
      tariff,
      disc: 0,
      taxable: tariff,
      sgst: Number((gstOnRow / 2).toFixed(2)),
      cgst: Number((gstOnRow / 2).toFixed(2)),
      total: Number((tariff + gstOnRow).toFixed(2)),
    });
  };

  if (totals.hallCharge > 0)
    pushRow(
      particularsFor(
        `Hall Charges (${totals.hours} HRS)`,
        totals.hallName
      ),
      totals.hallCharge,
    );
  if (totals.foodCharge > 0)
    pushRow(
      particularsFor(
        "Food Charges",
        [totals.menuPackageName, `${booking.guests || 0} Guests`]
          .filter(Boolean)
          .join(" - "),
      ),
      totals.foodCharge,
    );
  if (totals.customMenuCharge > 0) pushRow("Custom Menu Charges", totals.customMenuCharge);
  if (totals.lightingCharge > 0)
    pushRow(particularsFor("Lighting", totals.lightingName), totals.lightingCharge);
  if (totals.eventSupportCharge > 0) pushRow("Event Support", totals.eventSupportCharge);
  if (totals.decoration > 0) pushRow("Decoration", totals.decoration);

  const customerName = (booking.customerName || booking.customer_name || "—").toUpperCase();
  const guestContact = booking.phone || booking.mobile || "-";
  const eventType = booking.eventType || booking.event_type || "";
  const paymentMode = booking.paymentMode || booking.payment_mode || "Cash";
  const paymentReference =
    booking.paymentReferenceNo || booking.payment_reference_no || booking.paymentReferenceId || "";
  const generatedBy = booking.generatedBy || booking.staff_name || "Front Desk";
  const amountInWordsClean = toWords(totals.grandTotal)
    .replace(/^Rupees\s+/i, "")
    .replace(/\s*Only$/i, "");

  const renderInvoiceRow = (item) => `
      <tr>
        <td class="td-date">${item.date}</td>
        <td class="td-particulars">${escapeHtml(item.particulars)}</td>
        <td class="text-right">${fmtMoney(item.tariff)}</td>
        <td class="text-right">${item.disc > 0 ? fmtMoney(item.disc) : "0.00"}</td>
        <td class="text-right">${fmtMoney(item.taxable)}</td>
        <td class="text-right">${fmtMoney(item.sgst)}</td>
        <td class="text-right">${fmtMoney(item.cgst)}</td>
        <td class="text-right td-total">${fmtMoney(item.total)}</td>
      </tr>`;

  return `
        <div class="invoice">

          <div class="title-row">
            <h1>Tax Invoice</h1>
          </div>

          <div class="resort-block">
            <div>
              <span class="leaf">❀</span><span class="name">${RESORT_NAME_INVOICE}</span>
            </div>
            <div class="sub">${RESORT_ADDRESS_LINE_1}</div>
            <div class="sub">District: ${RESORT_ADDRESS_LINE_2}</div>
            <div class="sub">Ph: ${RESORT_PHONE_INVOICE}</div>
            <div class="sub">${RESORT_EMAIL_INVOICE} | ${RESORT_WEBSITE}</div>
            <div class="gst">GSTN: ${RESORT_GSTIN_INVOICE}</div>
          </div>

          <div class="divider"></div>

          <div class="meta-grid">
            <div class="meta-cell">
              <div class="meta-row-line"><span class="lbl">Invoice No.</span><span class="val">${escapeHtml(invoiceNo)}</span></div>
              <div class="meta-row-line"><span class="lbl">Customer Name</span><span class="val">${escapeHtml(customerName)}</span></div>
              <div class="meta-row-line"><span class="lbl">Contact #</span><span class="val">${escapeHtml(guestContact)}</span></div>
              ${eventType ? `<div class="meta-row-line"><span class="lbl">Event Type</span><span class="val">${escapeHtml(eventType.toUpperCase())}</span></div>` : ""}
            </div>
            <div class="meta-cell">
              <div class="meta-row-line"><span class="lbl">Invoice Date</span><span class="val">${invoiceDate}</span></div>
              <div class="meta-row-line"><span class="lbl">Hall Name</span><span class="val">${escapeHtml((totals.hallName || "-").toUpperCase())}</span></div>
              <div class="meta-row-line"><span class="lbl">Event Date</span><span class="val">${eventDate}</span></div>
              <div class="meta-row-line"><span class="lbl">Event Time</span><span class="val">${escapeHtml(`${booking.startTime || "--"} - ${booking.endTime || "--"}`)}</span></div>
              <div class="meta-row-line"><span class="lbl">Guests</span><span class="val">${booking.guests || 0}</span></div>
            </div>
          </div>
          <div class="divider"></div>

          <div class="section-label">Billing Details</div>

          <table class="items">
            <thead>
              <tr>
                <th style="width:11%">Date</th>
                <th style="width:38%">Particulars</th>
                <th style="width:9%" class="text-right">Tariff</th>
                <th style="width:7%" class="text-right">Disc</th>
                <th style="width:9%" class="text-right">Taxable</th>
                <th style="width:9%" class="text-right">SGST ${halfLabel(halfPct)}%</th>
                <th style="width:9%" class="text-right">CGST ${halfLabel(halfPct)}%</th>
                <th style="width:8%" class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length > 0 ? rows.map(renderInvoiceRow).join("") : `<tr><td colspan="8" style="text-align:center;padding:10px">No charges recorded</td></tr>`}
            </tbody>
          </table>

          <div class="bottom-grid">
            <div class="remarks-cell">
              <div class="lbl">Remarks</div>
              <div style="font-size:10px;color:#64748b;min-height:120px">&nbsp;</div>
            </div>
            <div class="remarks-cell" style="border-right:0">
              <div class="totals-list">
                <div class="row"><span>Subtotal</span><span>${fmtMoney(totals.subTotal)}</span></div>
                <div class="row"><span>Discount</span><span>${fmtMoney(totals.discount)}</span></div>
                <div class="row"><span>Taxable Amount</span><span>${fmtMoney(totals.taxableAmount)}</span></div>
                <div class="row"><span>GST (SGST ${halfLabel(halfPct)}%)</span><span>${fmtMoney(sgstHalf)}</span></div>
                <div class="row"><span>GST (CGST ${halfLabel(halfPct)}%)</span><span>${fmtMoney(cgstHalf)}</span></div>
                <div class="row bold"><span>Grand Total</span><span>${fmtMoney(totals.grandTotal)}</span></div>
                <div class="row"><span>Advance Paid</span><span>${fmtMoney(totals.advance)}</span></div>
                <div class="row"><span>Refunded</span><span>${fmtMoney(totals.refundAmount)}</span></div>
                <div class="row"><span>Net Received</span><span>${fmtMoney(totals.netReceived)}</span></div>
                <div class="row bold"><span>Balance</span><span>${fmtMoney(totals.balance)}</span></div>
              </div>
            </div>
          </div>

          <div class="words-row">
            <div class="words-cell">Rupees ${amountInWordsClean} Only</div>
            <div class="final-cell"><span class="lbl">Final Total</span><span class="val">Rs. ${fmtMoney(totals.grandTotal)}</span></div>
          </div>

          <div class="footer-row">
            <div class="note-cell">
              <div class="section-header">INVOICE NOTE</div>
              <div class="note-content">Thanks Pl Visit Again!!!</div>
            </div>
            <div class="payment-detail">
              <div class="section-header">PAYMENT DETAIL</div>
              <div class="payment-content">
                <div class="row">
                  <span>${escapeHtml(paymentMode.toUpperCase())}${paymentReference ? ` - ${escapeHtml(paymentReference)}` : ""}</span>
                  <span>${fmtMoney(totals.netReceived)}</span>
                </div>
                <div class="divider"></div>
                <div class="row bold">
                  <span>Balance</span>
                  <span>${fmtMoney(totals.balance)}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="invoice-bottom"></div>

          <div class="signature-area">
            <div class="sig-row">
              <div class="for">
                For ${RESORT_NAME_INVOICE}
              </div>
              <div class="sig-line-block authorized">
                <div class="line">Authorized Signature</div>
              </div>
              <div class="sig-line-block guest">
                <div class="line">Customer Signature</div>
              </div>
            </div>
            <div class="generated-by">
              <span class="lbl">Invoice Generated By:</span> ${escapeHtml(generatedBy)}
            </div>
          </div>
        </div>`;
};

const INVOICE_CSS = `
          @page { size: A4; margin: 6mm; }
          html, body {
            background: #ffffff !important;
            color: #000000;
            margin: 0; padding: 0;
          }
          * { box-sizing: border-box; }
          body {
            font-family: "Helvetica", Arial, sans-serif;
            color: #000000;
            background: #ffffff !important;
            padding: 0;
            font-size: 10px;
            line-height: 1.35;
          }
          .invoice { border: 1.5px solid #000000; padding: 0; width: 100%; }
          .title-row { text-align: center; padding: 6px 0 4px 0; }
          .title-row h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.02em; }
          .resort-block { text-align: center; padding: 2px 0 6px 0; }
          .resort-block .leaf {
            display: inline-flex; align-items: center; justify-content: center;
            width: 18px; height: 18px; background: #16a34a; color: #fff;
            border-radius: 50%; font-size: 11px; margin-right: 4px; vertical-align: middle;
          }
          .resort-block .name {
            display: inline-block; vertical-align: middle;
            font-size: 13px; font-weight: 800; letter-spacing: 0.03em;
          }
          .resort-block .sub { font-size: 10px; margin-top: 2px; line-height: 1.45; }
          .resort-block .gst { font-weight: 800; font-size: 10px; margin-top: 2px; }
          .divider { border-top: 1.5px solid #000000; margin: 0; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
          .meta-cell { padding: 6px 10px; }
          .meta-cell + .meta-cell { border-left: 1px solid #000000; }
          .meta-row-line { font-size: 10px; line-height: 1.6; }
          .meta-row-line .lbl { display: inline-block; min-width: 110px; font-weight: 700; }
          .meta-row-line .val { font-weight: 500; }
          .section-label { padding: 4px 10px; font-weight: 800; font-size: 10px; }
          table.items { width: 100%; border-collapse: collapse; font-size: 9.5px; }
          table.items thead th {
            background: #ffffff; color: #000;
            border-top: 1px solid #000000; border-bottom: 1px solid #000000;
            padding: 4px 5px; font-weight: 700; font-size: 9px; text-align: left;
            border-left: 1px solid #000000; border-right: 1px solid #000000;
          }
          table.items tbody td {
            padding: 4px 5px; border-bottom: 1px solid #000000;
            vertical-align: middle; font-size: 9.5px;
            border-left: 1px solid #000000; border-right: 1px solid #000000;
          }
          .td-date { white-space: nowrap; }
          .td-particulars { line-height: 1.3; }
          .td-total { font-weight: 800; }
          .text-right { text-align: right; }
          .bottom-grid {
            display: grid; grid-template-columns: 1.05fr 0.95fr;
            width: 100%; border-top: 1px solid #000000;
          }
          .remarks-cell { padding: 8px 10px; border-right: 1px solid #000000; min-height: 150px; }
          .remarks-cell .lbl { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; margin-bottom: 4px; }
          .totals-list { font-size: 10px; line-height: 1.6; }
          .totals-list .row { display: flex; justify-content: space-between; padding: 1px 4px; }
          .totals-list .row.bold { font-weight: 800; }
          .words-row {
            display: grid; grid-template-columns: 1.05fr 0.95fr;
            border-top: 1px solid #000000; width: 100%;
          }
          .words-cell {
            padding: 8px 10px; font-weight: 700; font-size: 11px;
            border-right: 1px solid #000000;
          }
          .final-cell {
            display: flex; justify-content: space-between; align-items: center;
            padding: 6px 10px; font-weight: 800; font-size: 12px;
          }
          .final-cell .lbl { font-size: 12px; }
          .final-cell .val { font-size: 14px; }
          .footer-row {
            display: grid; grid-template-columns: 1.05fr 0.95fr;
            border-top: 1px solid #000000; width: 100%; min-height: 58px;
          }
          .note-cell { border-right: 1px solid #000000; padding: 0; font-size: 10px; }
          .payment-detail { padding: 0; font-size: 10px; }
          .footer-row .section-header {
            height: 22px; box-sizing: border-box;
            display: flex; align-items: center; padding: 3px 10px;
            border-bottom: 1px solid #000000; font-size: 10px; font-weight: 800;
          }
          .note-content { padding: 7px 10px; font-size: 10px; font-weight: 600; }
          .payment-content { padding: 5px 10px; font-size: 9px; }
          .payment-detail .row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 1px 4px;
          }
          .payment-detail .row.bold { font-weight: 800; }
          .payment-detail .divider { border-top: 1px solid #000000; margin: 2px 0; }
          .invoice-bottom { border-top: 1.5px solid #000000; }
          .signature-area {
            position: relative; height: 160px; box-sizing: border-box;
            padding: 8px 10px; border-top: 1px solid #000000;
          }
          .sig-row { position: relative; width: 100%; height: 100%; margin: 0; }
          .sig-row .for {
            position: absolute; top: 0; left: 2px;
            font-size: 11px; font-weight: 800; white-space: nowrap;
          }
          .sig-row .sig-line-block.authorized {
            position: absolute; left: 2px; bottom: 35px; width: 180px; text-align: center;
          }
          .sig-row .sig-line-block.authorized .line {
            display: block; border-top: 1px solid #000000;
            padding-top: 4px; font-size: 9px; font-weight: 600;
          }
          .sig-row .sig-line-block.guest {
            position: absolute; right: 2px; top: 0; width: 180px; text-align: center;
          }
          .sig-row .sig-line-block.guest .line {
            display: block; margin-top: 55px; border-top: 1px solid #000000;
            padding-top: 4px; font-size: 9px; font-weight: 600;
          }
          .generated-by {
            position: absolute; left: 12px; bottom: 6px;
            text-align: left; font-size: 9px; font-weight: 700;
            margin: 0; padding: 0; white-space: nowrap;
          }
          .generated-by .lbl { font-weight: 600; }
`;

/**
 * Print a banquet invoice for the given booking in the hotel "Tax Invoice"
 * layout, via a hidden off-screen iframe (reused across calls).
 */
export const printBanquetInvoice = async (
  booking,
  { halls = [], menuPackages = [], lightingOptions = [] } = {},
) => {
  const totals = computeInvoiceTotals(booking, halls, menuPackages, lightingOptions);
  const invoiceNo =
    booking.invoiceNo || `BNQ-${String(booking.id ?? "").padStart(6, "0")}`;
  const invoiceDate = formatDate(booking.billedAt || booking.date || new Date());
  const eventDate = formatDate(booking.date || new Date());

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(invoiceNo)} - ${RESORT_NAME_INVOICE}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      ${INVOICE_CSS}
    </style>
  </head>
  <body>${buildInvoiceHtml({ booking, totals, invoiceNo, invoiceDate, eventDate })}</body>
</html>`;

  // Same off-screen iframe strategy as printKOT.js: a real, non-zero
  // sized iframe moved off-screen (zero-size or visibility:hidden iframes
  // never lay out in some browsers → blank print preview).
  const iframeId = "banquet-invoice-print-iframe";
  let iframe = document.getElementById(iframeId);
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = iframeId;
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = "800px";
    iframe.style.height = "1100px";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    document.body.appendChild(iframe);
  }

  let hasPrinted = false;
  let fallbackTimerId = null;

  const doPrint = () => {
    if (hasPrinted) return;
    hasPrinted = true;
    if (fallbackTimerId) clearTimeout(fallbackTimerId);
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      // ignore
    }
  };

  iframe.onload = () => setTimeout(doPrint, 150);
  fallbackTimerId = setTimeout(doPrint, 600);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
};

export default printBanquetInvoice;
