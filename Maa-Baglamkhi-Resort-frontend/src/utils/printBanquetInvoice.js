/**
 * printBanquetInvoice.js — Prints a Banquet invoice as a standalone A4
 * document via a hidden off-screen iframe (same proven strategy as
 * printKOT.js — window.print() on the main app page gave blank previews,
 * so only the iframe's document ever reaches the print dialog).
 *
 * The invoice HTML is built here (not captured from the modal's React
 * DOM) so the printout is a clean, print-styled A4 page with the resort
 * header, independent of whatever modal/scroll state it was opened from.
 */
import { formatINR } from "../pages/banquetUtils";
import API from "../api";

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const loadBrandInfo = async () => {
  try {
    const res = await API.get("/settings");
    const s = res?.data?.settings ?? res?.data ?? {};
    return {
      name: s.businessName || "Maa Baglamkhi Resort",
      contact: s.businessContact || "",
    };
  } catch {
    return { name: "Maa Baglamkhi Resort", contact: "" };
  }
};

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
  const gstPercent = booking.gstPercent ?? booking.gst_percent ?? 5;
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
  };
};

const buildInvoiceHtml = ({ booking, brand, totals }) => {
  const invoiceNo = booking.invoiceNo || `BNQ-${String(booking.id ?? "").padStart(6, "0")}`;
  const dateStr = booking.billedAt || booking.date || new Date().toLocaleDateString("en-IN");
  const paymentMode = booking.paymentMode || booking.payment_mode || "Pending";
  const paymentStatus = booking.paymentStatus || booking.payment_status || "Pending";
  const paymentReference =
    booking.paymentReferenceNo || booking.payment_reference_no || booking.paymentReferenceId || "";
  const contactBlock = brand.contact
    ? `<div style="font-size:11px;color:#475569;">${escapeHtml(brand.contact)}</div>`
    : "";
  const refBlock = paymentReference ? escapeHtml(paymentReference) : "—";

  const moneyRows = [
    { label: "Hall Charges", value: totals.hallCharge, sub: `${totals.hours} hrs` },
    { label: "Food Charges", value: totals.foodCharge },
    { label: "Custom Menu Charges", value: totals.customMenuCharge },
    { label: "Lighting", value: totals.lightingCharge },
    { label: "Event Support", value: totals.eventSupportCharge },
    { label: "Decoration", value: totals.decoration },
  ]
    .filter((r) => r.value > 0)
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.label)}${r.sub ? ` <span style="color:#64748b;font-size:11px;">(${escapeHtml(r.sub)})</span>` : ""}</td>
        <td class="amt">${formatINR(r.value)}</td>
      </tr>`
    )
    .join("");

  const discountRow =
    totals.discount > 0
      ? `<tr>
        <td>Discount</td>
        <td class="amt">- ${formatINR(totals.discount)}</td>
      </tr>`
      : "";

  const itemRows = `
    ${moneyRows}
    ${discountRow}
    <tr>
      <td>Subtotal</td>
      <td class="amt">${formatINR(totals.subTotal)}</td>
    </tr>
    <tr>
      <td>Taxable Amount</td>
      <td class="amt">${formatINR(totals.taxableAmount)}</td>
    </tr>
    <tr>
      <td>GST (${totals.gstPercent}%)</td>
      <td class="amt">${formatINR(totals.gst)}</td>
    </tr>
    <tr class="total">
      <td>Grand Total</td>
      <td class="amt">${formatINR(totals.grandTotal)}</td>
    </tr>
    <tr>
      <td>Advance Paid</td>
      <td class="amt pos">${formatINR(totals.advance)}</td>
    </tr>
    <tr>
      <td>Refunded</td>
      <td class="amt neg">${formatINR(totals.refundAmount)}</td>
    </tr>
    <tr>
      <td>Net Received</td>
      <td class="amt pos">${formatINR(totals.netReceived)}</td>
    </tr>
    <tr class="balance">
      <td>Balance</td>
      <td class="amt bal">${formatINR(totals.balance)}</td>
    </tr>`;

  return `<div class="page">
    <div class="head">
      <div class="brand">
        <div class="brand-name">${escapeHtml(brand.name)}</div>
        ${contactBlock}
      </div>
      <div class="doc">
        <div class="doc-title">BANQUET INVOICE</div>
        <div class="doc-meta">Invoice No: <span class="v">${escapeHtml(invoiceNo)}</span></div>
        <div class="doc-meta">Date: <span class="v">${escapeHtml(dateStr)}</span></div>
      </div>
    </div>

    <table class="parties">
      <tr>
        <td>
          <div class="p-label">Billed To</div>
          <div class="p-val">${escapeHtml(booking.customerName || "—")}</div>
          <div class="p-sub">${escapeHtml(booking.phone || "")}</div>
          ${booking.eventType ? `<div class="p-sub">Event: ${escapeHtml(booking.eventType)}</div>` : ""}
        </td>
        <td>
          <div class="p-label">Event Details</div>
          <div class="p-val">${escapeHtml(booking.hallName || "—")}</div>
          <div class="p-sub">${escapeHtml(booking.date || "")} &nbsp; ${escapeHtml(
            `${booking.startTime || ""} – ${booking.endTime || ""}`
          )}</div>
        </td>
      </tr>
    </table>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="amt">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="payrow">
      <div>Payment: <span class="v">${escapeHtml(paymentMode)}</span></div>
      <div>Status: <span class="v">${escapeHtml(paymentStatus)}</span></div>
      <div>Ref: <span class="v">${refBlock}</span></div>
    </div>

    <div class="footer">
      <div>Thank you for your booking!</div>
      <div class="printed">Printed from Maa Baglamkhi Resort POS &mdash; ${new Date().toLocaleString("en-IN")}</div>
    </div>
  </div>`;
};

/**
 * Print a banquet invoice for the given booking via a hidden off-screen
 * iframe. Safe to call repeatedly (reuses one iframe per page).
 */
export const printBanquetInvoice = async (booking, { halls = [], menuPackages = [], lightingOptions = [] } = {}) => {
  const brand = await loadBrandInfo();
  const totals = computeInvoiceTotals(booking, halls, menuPackages, lightingOptions);
  const inner = buildInvoiceHtml({ booking, brand, totals });

  const invoiceNo = booking.invoiceNo || `BNQ-${String(booking.id ?? "").padStart(6, "0")}`;
  const invoiceCss = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #0f172a; }
    .page { width: 190mm; margin: 0 auto; padding: 10mm; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      border-bottom: 3px solid #1e40af; padding-bottom: 10px; }
    .brand-name { font-size: 17px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
    .doc { text-align: right; }
    .doc-title { font-size: 14px; font-weight: 800; letter-spacing: 0.14em; color: #1e40af; }
    .doc-meta { font-size: 11px; color: #475569; margin-top: 3px; }
    .doc-meta .v, .payrow .v { font-weight: 700; color: #0f172a; }
    .parties { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .parties td { width: 50%; vertical-align: top; padding-right: 16px; }
    .p-label { font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b; }
    .p-val { font-size: 13px; font-weight: 700; margin-top: 2px; }
    .p-sub { font-size: 11px; color: #475569; margin-top: 2px; }
    .items { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11.5px; }
    .items th { background: #eff6ff; color: #1e3a8a; text-align: left; padding: 7px 10px; font-size: 10.5px;
      letter-spacing: 0.08em; text-transform: uppercase; border-bottom: 2px solid #1e40af; }
    .items td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
    .items .amt, .items th.amt { text-align: right; white-space: nowrap; }
    .items .total td { font-weight: 800; font-size: 13px; border-top: 2px solid #1e40af; }
    .items .pos { color: #059669; font-weight: 700; }
    .items .neg { color: #d97706; font-weight: 700; }
    .items .balance td { background: #f8fafc; font-weight: 800; }
    .items .balance .bal { color: #dc2626; }
    .payrow { margin-top: 14px; font-size: 11px; color: #475569; display: flex; gap: 24px; flex-wrap: wrap; }
    .footer { margin-top: 44px; text-align: center; }
    .footer div:first-child { font-size: 14px; font-weight: 700; color: #1e40af; }
    .printed { font-size: 9px; color: #94a3b8; margin-top: 10px; }
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Invoice ${escapeHtml(invoiceNo)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: A4; margin: 0; }
      html, body { background: #fff; }
      ${invoiceCss}
    </style>
  </head>
  <body>${inner}</body>
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
