import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FiUser,
  FiCreditCard,
  FiPercent,
  FiUsers,
  FiShoppingBag,
  FiHome,
} from "react-icons/fi";
import { FaTimes, FaWhatsapp } from "react-icons/fa";
import API from "../../api";
import { restaurantService } from "../../services/restaurantService";
import { getCurrentActor } from "../../utils/currentActor";
import {
  expandBookings,
  getRoomBookingForDate,
  getRoomBookingReference,
  mergeBookingsWithRooms,
  normalizeRooms,
  todayISO,
} from "../Dashboard/stayoverUtils";
import FolioView from "../Hotel/FolioView";
import WhatsAppInvoiceModal from "./WhatsAppInvoiceModal";

/* ===========================================================================
   NOTE: This file is unchanged from the original EXCEPT for the handlePrint
   function below, which now auto-closes the print popup window and returns
   focus to the main window. See the comment inside handlePrint for details.

   ALSO UPDATED: The printed receipt (buildReceiptHtml) now includes the
   resort's GSTIN and FSSAI registration number, taken from the client's
   reference invoice.

   ALSO UPDATED: Added the resort's slogan "आपका विश्वास ही हमारी पूंजी है"
   below the address/phone in the printed receipt header.
   =========================================================================== */

// ─── Resort statutory / registration details (from client reference invoice) ──
const RESORT_NAME = "MAA BAGLAMUKHI RESORT";
const RESORT_ADDRESS_LINE1 = "Maa Baglamukhi mandir road  Near iocl petrol pump Nalkheda, District: Agar Malwa 465445";
const RESORT_PHONE = "9522238777, 9522239777";
const RESORT_GSTIN = "23AVDPR2928J1ZG";
const RESORT_FSSAI_NO = "11420995000031";
const RESORT_SLOGAN = "आपका विश्वास ही हमारी पूंजी है";

// ─── FeatureModal (same as BookingFlow) ───────────────────────────────────────
const FeatureModal = ({ title, subtitle, size = "max-w-6xl", onClose, children }) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center bg-slate-950/70 px-3 py-4 backdrop-blur-sm sm:px-6"
      onClick={onClose}
    >
      <div
        className={`relative max-h-[92vh] w-full ${size} overflow-y-auto rounded-2xl bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)] sm:rounded-[28px]`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-4 py-3.5 backdrop-blur sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-900 sm:text-lg">{title}</h3>
            {subtitle && <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 sm:h-10 sm:w-10"
          >
            <FaTimes />
          </button>
        </div>
        <div className="p-3 sm:p-5">{children}</div>
      </div>
    </div>
  );
};

const ACTIVE_INVOICE_KEY = "restaurant-active-invoice";
const SAVED_INVOICE_KEY = "restaurant-saved-invoice";
const PAYMENT_CARD_PAGE_SIZE = 7;
const normalizeInvoiceStatus = (value) => String(value || "").trim().toLowerCase();
const isPaidInvoice = (value) => normalizeInvoiceStatus(value) === "paid";
const isPostedToRoomInvoice = (value) => normalizeInvoiceStatus(value) === "posted to room";
const isSettledInvoice = (value) => isPaidInvoice(value) || isPostedToRoomInvoice(value);
const getReusableBill = (bill) => (bill && !isSettledInvoice(bill.invoiceStatus) ? bill : null);
const formatVisitId = (tokenCode, tokenId) => tokenCode || (tokenId ? `VIS-${String(tokenId).padStart(6, "0")}` : "--");
const isIgnorablePostPaymentError = (error) => {
  const status = Number(error?.response?.status || 0);
  const message = String(error?.response?.data?.message || error?.message || "").toLowerCase();

  return (
    status === 404 &&
    (message.includes("no pending order found") ||
      message.includes("bill already paid") ||
      message.includes("not found"))
  );
};
const isActiveInHouseBookingStatus = (value) => {
  const normalized = normalizeInvoiceStatus(value);
  return (
    normalized.includes("checked in") ||
    normalized.includes("occupied") ||
    normalized.includes("in house")
  );
};

const formatCurrency = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
const formatDate = (value) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatReceiptDateOnly = (value) => {
  if (!value) return "--/--/----";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--/--/----";
  return parsed.toLocaleDateString("en-GB");
};

const formatReceiptTimeOnly = (value) => {
  if (!value) return "--:--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatReceiptAmount = (value) => {
  const num = Number(value);
  if (!value && value !== 0) return "--";
  if (Number.isNaN(num)) return "--";
  return num.toFixed(2);
};

const escapeReceiptHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildReceiptInvoiceNo = (invoice) => {
  const billId = Number(invoice?.billId || 0);
  if (Number.isFinite(billId) && billId > 0) return String(billId);
  const tokenId = Number(invoice?.tokenId || 0);
  if (Number.isFinite(tokenId) && tokenId > 0) return `TMP-${String(tokenId)}`;
  return "----";
};

const buildReceiptHtml = ({
  invoice,
  entityType,
  customerName,
  phone,
  paymentMethod,
  cardDetails,
  personCount,
  discountAmount,
  serviceCharge,
  perPersonAmount,
  computedTotal,
  printLabel = "INVOICE",
  explicitInvoiceNo = null,
  explicitTableNo = null,
  explicitKotNo = null,
}) => {
  const printedAt = invoice?.paidAt || invoice?.printedAt || invoice?.date || new Date().toISOString();
  // Fallback: derive subtotal/gst from items if invoice doesn't have them
  const computedSubtotal = (() => {
    if (Number(invoice?.subtotal || 0) > 0) return Number(invoice.subtotal);
    if (Array.isArray(invoice?.items) && invoice.items.length) {
      return invoice.items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.rate || 0), 0);
    }
    return 0;
  })();
  const gst = Number(invoice?.gst || 0) > 0 ? Number(invoice.gst) : computedSubtotal * 0.05;
  const sgstAmount = Number((gst / 2).toFixed(2));
  const cgstAmount = Number((gst / 2).toFixed(2));
  // Recompute grandTotal from components if computedTotal is 0 but we have items
  const localTotal = Math.max(0, computedSubtotal + gst + Number(serviceCharge || 0) - Number(discountAmount || 0));
  const grandTotal = Number(computedTotal || 0) > 0 ? Number(computedTotal) : localTotal;
  const netTotal = Math.round(grandTotal);
  const roundUp = Number((netTotal - grandTotal).toFixed(2));
  const userName = localStorage.getItem("name") || localStorage.getItem("username") || "POS User";
  const entityLabel = String(entityType || invoice?.entityType || "Table").toLowerCase() === "room" ? "Room No" : "Table No";
  const kotNos = explicitKotNo
    ? String(explicitKotNo)
    : invoice?.tokenId
      ? String(invoice.tokenId)
      : invoice?.tokenCode
        ? String(invoice.tokenCode)
        : formatVisitId(invoice?.tokenCode, invoice?.tokenId);

  // Determine paid and balance amounts
  const isPaid = isPaidInvoice(invoice?.invoiceStatus);
  const isPosted = isPostedToRoomInvoice(invoice?.invoiceStatus);
  const totalAmount = Math.max(0, grandTotal);
  const paidAmount = isPaid || isPosted ? totalAmount : 0;
  const remainingBalance = Math.max(0, totalAmount - paidAmount);

  // Invoice No - ensure it ALWAYS shows. Fallback chain: explicit -> billId -> tokenId -> TBD
  const billIdNum = Number(invoice?.billId || explicitInvoiceNo || 0);
  const invoiceNoDisplay = explicitInvoiceNo
    ? String(explicitInvoiceNo)
    : billIdNum > 0
      ? String(billIdNum)
      : invoice?.tokenId
        ? `TMP-${String(invoice.tokenId).padStart(4, "0")}`
        : invoice?.table
          ? `DRAFT-${String(invoice.table).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`
          : "TBD";

  // Table No - ensure it ALWAYS shows
  const tableDisplay =
    explicitTableNo ||
    invoice?.table ||
    invoice?.tableNumber ||
    invoice?.postedRoomNumber ||
    invoice?.sourceTableNumber ||
    invoice?.roomNumber ||
    "--";

  const itemRows = (Array.isArray(invoice?.items) ? invoice.items : [])
    .map((item) => {
      const qty = Number(item?.qty || 0);
      const rate = Number(item?.rate || 0);
      const lineTotal = qty * rate;
      // Whole quantities print as plain integers ("1", not "1.00") —
      // "1.00" was wrapping onto two lines in the narrow qty column, which
      // looked like the quantity was printed twice. Fractional qty keeps 2dp.
      const qtyDisplay = Number.isInteger(qty) ? String(qty) : formatReceiptAmount(qty);
      return `
        <tr>
          <td class="item-name">${escapeReceiptHtml(item?.name || "Menu Item")}</td>
          <td class="qty-col">${qtyDisplay}</td>
          <td class="rate-col">${formatReceiptAmount(rate)}</td>
          <td class="amount-col">${formatReceiptAmount(lineTotal)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Restaurant Invoice</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 0 !important;
          }
          *, *::before, *::after {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;

    font-family: "Arial Black", Arial, Helvetica, sans-serif !important;
    font-size: 14px !important;
    font-weight: 900 !important;

    -webkit-text-fill-color: #000 !important;
    -webkit-font-smoothing: none !important;
    text-rendering: geometricPrecision !important;
}
          body {
    width: 72mm;
    max-width: 72mm;
    margin: 0 auto !important;
    padding: 0 10px !important;

    font-size: 14px !important;
    line-height: 1.45;

    color: #000 !important;
    font-weight: 900 !important;

    -webkit-text-fill-color: #000 !important;
}
          .center { text-align: center !important; }
          .right { text-align: right !important; }
          .left { text-align: left !important; }
          .separator {
            border: 0;
            border-top: 1px dashed #000000 !important;
            margin: 6px 0;
            height: 0;
            background: transparent;
          }
          .double-separator {
            border: 0;
            border-top: 3px double #000000 !important;
            margin: 6px 0;
            height: 0;
            background: transparent;
          }
          .brand {
            padding-top: 0 !important;
            text-align: center;
            color: #020202 !important;
          }
         .brand h1{
    font-size:22px !important;
    font-weight:900 !important;
    color:#000 !important;
    letter-spacing:1px;
}
         .brand .sub{
    font-size:13px !important;
    font-weight:900 !important;
    color:#000 !important;
}
         .brand .slogan{
    font-size:12.5px !important;
    font-weight:900 !important;
    font-style: italic;
    color:#000 !important;
    margin-top: 2px;
}
          .muted {
            color: #090707 !important;
            font-size: 11px;
            font-weight: 700;
          }
         .title{
    font-size:18px !important;
    font-weight:900 !important;
    color:#000 !important;
}
         .invoice-no-banner{
    font-size:16px !important;
    font-weight:900 !important;
    color:#000 !important;
}
          .table-no-banner{
    font-size:15px !important;
    font-weight:900 !important;
    color:#000 !important;
}
          .meta-row,
          .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 6px;
            margin: 2px 0;
            font-size: 12px;
            color: #000000 !important;
            font-weight: 700;
            align-items: flex-start;
            width: 100%;
          }
          .meta-row > span,
          .summary-row > span {
            word-wrap: break-word;
            overflow-wrap: break-word;
            color: #000000 !important;
            font-weight: 700;
            display: block;
          }
          .meta-row > span:first-child,
          .summary-row > span:first-child {
            flex: 1 1 50%;
            text-align: left;
            color: #000000 !important;
            font-weight: 700;
          }
          .meta-row > span:last-child,
          .summary-row > span:last-child {
            flex: 0 0 46%;
            text-align: right;
            color: #000000 !important;
            font-weight: 800;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            color: #000000 !important;
          }
          th, td {
            padding: 4px 3px;
            vertical-align: top;
            color: #000000 !important;
            word-wrap: break-word;
            overflow-wrap: break-word;
            font-size: 12px;
            line-height: 1.4;
            font-weight: 700;
            white-space: normal;
          }
          th {
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px dashed #000000 !important;
            color: #000000 !important;
            background: transparent !important;
            text-align: left;
            padding-bottom: 3px;
          }
          .item-name {
            width: 26%;
            padding-right: 6px;
            text-align: left !important;
            color: #000000 !important;
            font-weight: 700;
          }
          .qty-col {
            width: 20%;
            text-align: center !important;
            color: #000000 !important;
            font-weight: 700;
            white-space: nowrap;
          }
          .rate-col {
            width: 27%;
            text-align: right !important;
            color: #000000 !important;
            font-weight: 700;
          }
          .amount-col {
            width: 27%;
            text-align: right !important;
            color: #000000 !important;
            font-weight: 800;
          }
          .totals {
            margin-top: 4px;
          }
          .grand {
            font-weight: 900 !important;
            font-size: 14px;
            color: #000000 !important;
          }
          .grand > span {
            font-weight: 900 !important;
            color: #000000 !important;
          }
          .net {
            font-weight: 900 !important;
            font-size: 17px;
            color: #000000 !important;
          }
          .net > span {
            font-weight: 900 !important;
            color: #000000 !important;
          }
          .footer {
            margin-top: 10px;
            text-align: center;
          }
          .footer-note {
            font-size: 11px;
            color: #000000 !important;
            font-weight: 700;
            line-height: 1.5;
          }
          .legal-row {
            font-size: 11px;
            font-weight: 800;
            color: #000000 !important;
            text-align: center;
            margin: 2px 0;
            letter-spacing: 0.02em;
          }
        </style>
      </head>
      <body>
        <div id="receiptRoot">
        <div class="brand">
          <h1>${escapeReceiptHtml(RESORT_NAME)}</h1>
          <div class="sub">Restaurant &amp; POS Billing</div>
          <div class="sub">${escapeReceiptHtml(RESORT_ADDRESS_LINE1)}</div>
          <div class="sub">Ph: ${escapeReceiptHtml(RESORT_PHONE)}</div>
          <div class="slogan">${escapeReceiptHtml(RESORT_SLOGAN)}</div>
        </div>

        <div class="double-separator"></div>
        <div class="title">${escapeReceiptHtml(printLabel)}</div>
        <div class="double-separator"></div>

        <div class="invoice-no-banner">INVOICE NO: ${escapeReceiptHtml(invoiceNoDisplay)}</div>
        <div class="table-no-banner">${escapeReceiptHtml(entityLabel)}: ${escapeReceiptHtml(tableDisplay)}</div>

        <div class="separator"></div>

        <div class="meta-row">
          <span>Date</span>
          <span>${escapeReceiptHtml(formatReceiptDateOnly(printedAt))} ${escapeReceiptHtml(formatReceiptTimeOnly(printedAt))}</span>
        </div>
        <div class="meta-row">
          <span>Captain</span>
          <span>${escapeReceiptHtml(invoice?.waiterName || "Reception")}</span>
        </div>
        <div class="meta-row">
          <span>KOT No</span>
          <span>${escapeReceiptHtml(kotNos || "--")}</span>
        </div>
        <div class="meta-row">
          <span>Customer</span>
          <span>${escapeReceiptHtml(customerName || invoice?.customerName || "Walk-in")}</span>
        </div>
        <div class="meta-row">
          <span>Phone</span>
          <span>${escapeReceiptHtml(phone || invoice?.phone || "--")}</span>
        </div>

        <div class="separator"></div>

        <table>
          <thead>
            <tr>
              <th class="item-name">Item Name</th>
              <th class="qty-col">Qty</th>
              <th class="rate-col">Rate</th>
              <th class="amount-col">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || `<tr><td colspan="4" class="center">No items found</td></tr>`}
          </tbody>
        </table>

        <div class="separator"></div>

        <div class="totals">
          <div class="summary-row">
            <span>Food / Restaurant Charges</span>
            <span>${formatReceiptAmount(computedSubtotal || invoice?.subtotal)}</span>
          </div>
          ${
            gst > 0
              ? `<div class="summary-row">
                  <span>SGST @ 2.5%</span>
                  <span>${formatReceiptAmount(sgstAmount)}</span>
                </div>
                <div class="summary-row">
                  <span>CGST @ 2.5%</span>
                  <span>${formatReceiptAmount(cgstAmount)}</span>
                </div>`
              : ""
          }
          ${
            Number(serviceCharge || 0) > 0
              ? `<div class="summary-row">
                  <span>Ser.Charges on Food @5.00%</span>
                  <span>${formatReceiptAmount(serviceCharge)}</span>
                </div>`
              : ""
          }
          ${
            Number(discountAmount || 0) > 0
              ? `<div class="summary-row"><span>Discount</span><span>- ${formatReceiptAmount(discountAmount)}</span></div>`
              : ""
          }
          <div class="summary-row grand">
            <span>Total Amount</span>
            <span>${formatReceiptAmount(totalAmount)}</span>
          </div>
          <div class="summary-row">
            <span>Round Up</span>
            <span>${formatReceiptAmount(roundUp)}</span>
          </div>
          <div class="double-separator"></div>
          <div class="summary-row net">
            <span>NET TOTAL</span>
            <span>Rs. ${formatReceiptAmount(netTotal)}</span>
          </div>
          <div class="summary-row">
            <span>Paid Amount</span>
            <span>Rs. ${formatReceiptAmount(paidAmount)}</span>
          </div>
          ${
            remainingBalance > 0
              ? `<div class="summary-row">
                  <span style="color:#cc0000;">Remaining Balance</span>
                  <span style="color:#cc0000;">Rs. ${formatReceiptAmount(remainingBalance)}</span>
                </div>`
              : ""
          }
        </div>

        <div class="separator"></div>

        <div class="meta-row">
          <span>User</span>
          <span>${escapeReceiptHtml(userName)}</span>
        </div>
        <div class="meta-row">
          <span>Payment</span>
          <span>${escapeReceiptHtml(paymentMethod || "Cash")}</span>
        </div>
        <div class="meta-row">
          <span>Guests</span>
          <span>${escapeReceiptHtml(personCount)}</span>
        </div>
        <div class="meta-row">
          <span>Per Person</span>
          <span>Rs. ${formatReceiptAmount(perPersonAmount)}</span>
        </div>
        ${
          paymentMethod === "Card"
            ? `
              <div class="meta-row">
                <span>Card</span>
                <span>${escapeReceiptHtml(cardDetails?.cardType || "--")}</span>
              </div>
              <div class="meta-row">
                <span>Last 4</span>
                <span>${escapeReceiptHtml(cardDetails?.cardLast4 || "--")}</span>
              </div>
              <div class="meta-row">
                <span>Txn Ref</span>
                <span>${escapeReceiptHtml(cardDetails?.transactionRef || "--")}</span>
              </div>
              <div class="meta-row">
                <span>Holder</span>
                <span>${escapeReceiptHtml(cardDetails?.cardHolderName || "--")}</span>
              </div>
            `
            : ""
        }

        <div class="separator"></div>
        <div class="legal-row">GSTN ${escapeReceiptHtml(RESORT_GSTIN)}</div>
        <div class="legal-row">FSSAI NO. ${escapeReceiptHtml(RESORT_FSSAI_NO)}</div>

        <div class="separator"></div>
        <div class="footer">
          <div class="footer-note">Thank you. Visit again.</div>
          <div class="footer-note">Powered by Maa Baglamukhi Resort POS</div>
        </div>
        </div>
        <script>
          (function () {
            // Permanent fix for the "extra blank page after receipt" issue:
            // measure the ACTUAL rendered height of the receipt content and
            // set the printed @page height to exactly that (plus a tiny
            // safety buffer), instead of relying on the browser/printer
            // driver to guess where the content ends. This works for any
            // receipt length (short or long) with no manual adjustment.
            function applyExactPageHeight() {
              try {
                var root = document.getElementById("receiptRoot");
                if (!root) return;

                var heightPx = root.getBoundingClientRect().height;
                // Exact content height + a small buffer, so the final line
                // ("Powered by...") never wraps onto a second page — the
                // browser's print rasterization is a hair taller than the
                // on-screen measurement.
                var heightMm = heightPx * (25.4 / 96) + 8;

                var style = document.createElement("style");
                style.id = "dynamic-receipt-page-size";

                style.textContent =
                  "@page { size: 80mm " + heightMm.toFixed(2) + "mm; margin: 0; }" +
                  "html { margin: 0 !important; padding: 0 !important; }" +
                  "body { margin: 0 !important; }";

                document.head.appendChild(style);
              } catch (err) {
                console.error("Receipt page sizing failed:", err);
              }
            }

            if (document.readyState === "complete") {
              applyExactPageHeight();
            } else {
              window.addEventListener("load", applyExactPageHeight);
            }
          })();
        </script>
      </body>
    </html>
  `;
};

const readStoredInvoice = () => {
  const sources = [ACTIVE_INVOICE_KEY, SAVED_INVOICE_KEY];
  for (const key of sources) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.table && Array.isArray(parsed?.items) && !isSettledInvoice(parsed?.invoiceStatus)) {
        return parsed;
      }
    } catch {}
  }
  return null;
};

const clearPersistedInvoice = () => {
  localStorage.removeItem(ACTIVE_INVOICE_KEY);
  localStorage.removeItem(SAVED_INVOICE_KEY);
};

const persistInvoice = (invoice) => {
  if (!invoice) return;
  if (isSettledInvoice(invoice.invoiceStatus)) {
    clearPersistedInvoice();
    return;
  }
  localStorage.setItem(ACTIVE_INVOICE_KEY, JSON.stringify(invoice));
  localStorage.setItem(SAVED_INVOICE_KEY, JSON.stringify(invoice));
};

const sanitizeGeneratedInvoice = (invoice, billResponse) => ({
  ...invoice,
  billId: billResponse?.id || billResponse?.bill?.id || invoice?.billId || null,
  invoiceStatus: billResponse?.bill?.invoiceStatus || "Generated",
  paymentMethod: billResponse?.bill?.paymentMethod || invoice?.paymentMethod || null,
});

const sanitizeCustomerName = (value) =>
  String(value || "")
    .replace(/[^A-Za-z\s]/g, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 60);

const sanitizePhoneNumber = (value) => String(value || "").replace(/\D/g, "").slice(0, 10);

const getCustomerFieldErrors = ({ customerName, phone }) => {
  const trimmedName = String(customerName || "").trim();
  const normalizedPhone = sanitizePhoneNumber(phone);
  const errors = {};

  if (!trimmedName) {
    errors.customerName = "Customer name required.";
  } else if (!/^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(trimmedName)) {
    errors.customerName = "Name me sirf letters aur spaces allow hain.";
  }

  if (!normalizedPhone) {
    errors.phone = "Phone number required.";
  } else if (!/^\d{10}$/.test(normalizedPhone)) {
    errors.phone = "Phone number exactly 10 digits hona chahiye.";
  }

  return errors;
};

const createInvoiceKey = (invoice) => {
  if (!invoice) return "invoice:unknown";
  if (invoice.billId) return `bill:${invoice.billId}`;
  return `${String(invoice.entityType || "Table").toLowerCase()}:${invoice.table || "unknown"}`;
};

const createSessionKey = (entityType, table, tokenId) =>
  tokenId
    ? `${String(entityType || "Table").toLowerCase()}:token:${Number(tokenId)}`
    : `${String(entityType || "Table").toLowerCase()}:table:${String(table || "unknown").trim()}`;

const createBoardCardKey = (invoice) =>
  createSessionKey(invoice?.entityType, invoice?.table, invoice?.tokenId);

const toBillInvoice = (bill) => ({
  table: bill.tableNumber,
  tokenId: bill.tokenId || null,
  tokenCode: bill.tokenCode || null,
  waiterName: bill.waiter_name || "Waiter",
  items: [],
  subtotal: Number(bill.subtotal || 0),
  gst: Number(bill.gst || 0),
  serviceCharge: Number(bill.serviceCharge || 0),
  total: Number(bill.total || 0),
  discountAmount: Number(bill.discountAmount || 0),
  date: bill.created_at || new Date().toISOString(),
  entityType: bill.entityType || "Table",
  billId: bill.id,
  invoiceStatus: bill.invoiceStatus || "Generated",
  customerName: bill.customerName || "",
  phone: bill.phone || "",
  paymentMethod: bill.paymentMethod || "Cash",
  personCount: Math.max(1, Number(bill.split_count || 1)),
  splitCount: Math.max(1, Number(bill.split_count || 1)),
  postedToRoom: Boolean(bill.postedToRoom),
  postedRoomNumber: bill.postedRoomNumber || "",
  roomBookingId: bill.roomBookingId || null,
  roomBookingCode: bill.roomBookingCode || "",
  folioEntryId: bill.folioEntryId || null,
  sourceTableNumber: bill.sourceTableNumber || "",
  postedAt: bill.postedAt || null,
});

const mapTokenItemsToInvoiceItems = (items) =>
  (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id,
    name: item.item_name || item.name || "Menu Item",
    qty: Number(item.qty || item.quantity || 0),
    rate: Number(item.rate || item.price || 0),
  }));

const getCustomerDisplay = (invoice) => ({
  name: String(invoice?.customerName || "").trim() || "Walk-in Customer",
  phone: String(invoice?.phone || "").trim() || "--",
});

const buildChargeableRooms = (roomRows, bookingRows) => {
  const normalizedRooms = normalizeRooms(roomRows);
  const mergedBookings = mergeBookingsWithRooms(expandBookings(bookingRows), normalizedRooms);
  const today = todayISO();

  return normalizedRooms
    .map((room) => {
      const roomNumber = String(room.roomNo || room.roomNumber || "").trim();
      const activeBooking =
        getRoomBookingForDate(roomNumber, today, mergedBookings, false) ||
        getRoomBookingReference(roomNumber, today, mergedBookings);

      return {
        roomNumber,
        room,
        activeBooking,
        roomStatus: String(room.status || room.hotelStatus || "").toLowerCase(),
      };
    })
    .filter(({ roomNumber, activeBooking, roomStatus }) =>
      Boolean(roomNumber) && Boolean(activeBooking) && roomStatus === "occupied" && isActiveInHouseBookingStatus(activeBooking?.bookingStatus),
    )
    .map(({ roomNumber, room, activeBooking }) => ({
      roomNumber,
      bookingId: activeBooking?.bookingId || null,
      bookingCode: activeBooking?.bookingCode || "",
      guestName: activeBooking?.guestName || room.guest || "",
      mobile: activeBooking?.mobile || "",
      roomType: room.categoryName || room.roomType || "Room",
    }))
    .sort((left, right) => left.roomNumber.localeCompare(right.roomNumber, undefined, { numeric: true }));
};

const loadPaymentBoard = async () => {
  const [tables, bills, roomRows, bookingRows] = await Promise.all([
    restaurantService.getTables().catch(() => []),
    API.get("/restaurant/bills").then((response) => response.data).catch(() => []),
    API.get("/housekeeping").then((response) => response.data).catch(() => []),
    API.get("/hotel/all-bookings").then((response) => response.data).catch(() => []),
  ]);
  const normalizedBills = Array.isArray(bills) ? [...bills] : [];
  normalizedBills.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

  const latestBillByTable = new Map();
  normalizedBills.forEach((bill) => {
    const key = createBoardCardKey({
      entityType: bill.entityType || "Table",
      table: bill.tableNumber,
      tokenId: bill.tokenId || null,
    });
    if (!latestBillByTable.has(key)) {
      latestBillByTable.set(key, bill);
    }
  });

  const liveInvoices = await Promise.all(
    (Array.isArray(tables) ? tables : []).map(async (table) => {
      try {
        const tableName = String(table.number || table.name || "").trim();
        if (!tableName) return null;

        const tokenRes = await API.get(`/token/table/${tableName}`);
        const tokenId = tokenRes.data?.id || null;
        if (!tokenId) return null;

        const itemsRes = await API.get(`/token/items/${tokenId}`);
        const tokenItems = Array.isArray(itemsRes.data) ? itemsRes.data : [];
        if (!tokenItems.length) return null;

        const subtotal = tokenItems.reduce(
          (sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0),
          0,
        );
        const gst = subtotal * 0.05;

        const relatedBill = getReusableBill(
          latestBillByTable.get(
          createBoardCardKey({
            entityType: "Table",
            table: tableName,
          }),
          ),
        );

        return {
          table: tableName,
          tokenId,
          tokenCode: tokenRes.data?.token_code || tokenRes.data?.tokenCode || null,
          waiterName: tokenRes.data?.waiter || "Waiter",
          items: tokenItems.map((item) => ({
            id: item.id,
            name: item.item_name,
            qty: Number(item.qty || 0),
            rate: Number(item.rate || 0),
          })),
          subtotal,
          gst,
          total: subtotal + gst,
          discountAmount: Number(relatedBill?.discountAmount || 0),
          date: new Date().toISOString(),
          entityType: "Table",
          billId: relatedBill?.id || null,
          invoiceStatus: relatedBill?.invoiceStatus || null,
          customerName: relatedBill?.customerName || "",
          phone: relatedBill?.phone || "",
          paymentMethod: relatedBill?.paymentMethod || "Cash",
          personCount: Math.max(1, Number(relatedBill?.split_count || 1)),
          splitCount: Math.max(1, Number(relatedBill?.split_count || 1)),
        };
      } catch {
        return null;
      }
    }),
  );

  const normalizedRooms = normalizeRooms(roomRows);
  const mergedBookings = mergeBookingsWithRooms(expandBookings(bookingRows), normalizedRooms);
  const roomToday = todayISO();

  const liveRoomInvoices = await Promise.all(
    normalizedRooms.map(async (room) => {
      try {
        const roomRef = String(room.roomNo || room.roomNumber || "").trim();
        if (!roomRef) return null;

        const activeBooking =
          getRoomBookingForDate(roomRef, roomToday, mergedBookings, false) ||
          getRoomBookingReference(roomRef, roomToday, mergedBookings);
        const roomStatus = String(room.status || room.hotelStatus || "").toLowerCase();
        if (!activeBooking || roomStatus !== "occupied") return null;

        const tokenRes = await API.get(`/token/table/${roomRef}`);
        const tokenId = tokenRes.data?.id || null;
        if (!tokenId) return null;

        const itemsRes = await API.get(`/token/items/${tokenId}`);
        const tokenItems = Array.isArray(itemsRes.data) ? itemsRes.data : [];
        if (!tokenItems.length) return null;

        const subtotal = tokenItems.reduce(
          (sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0),
          0,
        );
        const gst = subtotal * 0.05;

        const relatedBill = getReusableBill(
          latestBillByTable.get(
          createBoardCardKey({
            entityType: "Room",
            table: roomRef,
          }),
          ),
        );

        return {
          table: roomRef,
          tokenId,
          tokenCode: tokenRes.data?.token_code || tokenRes.data?.tokenCode || null,
          waiterName: "Room Service",
          items: tokenItems.map((item) => ({
            id: item.id,
            name: item.item_name,
            qty: Number(item.qty || 0),
            rate: Number(item.rate || 0),
          })),
          subtotal,
          gst,
          total: subtotal + gst,
          discountAmount: Number(relatedBill?.discountAmount || 0),
          date: new Date().toISOString(),
          entityType: "Room",
          billId: relatedBill?.id || null,
          invoiceStatus: relatedBill?.invoiceStatus || null,
          customerName: relatedBill?.customerName || room.guest || activeBooking?.guestName || "",
          phone: relatedBill?.phone || activeBooking?.mobile || "",
          paymentMethod: relatedBill?.paymentMethod || "Cash",
          personCount: Math.max(1, Number(relatedBill?.split_count || 1)),
          splitCount: Math.max(1, Number(relatedBill?.split_count || 1)),
          bookingId: activeBooking?.bookingId || null,
          bookingCode: activeBooking?.bookingCode || "",
        };
      } catch {
        return null;
      }
    }),
  );

  const boardMap = new Map();
  liveInvoices.filter(Boolean).forEach((invoice) => {
    boardMap.set(createBoardCardKey(invoice), { ...invoice, sourceType: "live" });
  });
  liveRoomInvoices.filter(Boolean).forEach((invoice) => {
    boardMap.set(createBoardCardKey(invoice), { ...invoice, sourceType: "live" });
  });

  normalizedBills.forEach((bill) => {
    const invoice = { ...toBillInvoice(bill), sourceType: "bill" };
    const cardKey = createBoardCardKey(invoice);
    const existing = boardMap.get(cardKey);
    // If bill is settled (Paid / Posted To Room), replace the live invoice
    // so it disappears from the Payment board and moves to the Bills section.
    if (!existing || isSettledInvoice(invoice.invoiceStatus)) {
      boardMap.set(cardKey, invoice);
    }
  });

  return Array.from(boardMap.values())
    .filter((row) => !isSettledInvoice(row.invoiceStatus))
    .sort((a, b) => {
    const aTime = new Date(a.date || 0).getTime();
    const bTime = new Date(b.date || 0).getTime();
    return bTime - aTime;
  });
};

const Payment = ({
  invoice: externalInvoice = null,
  onClose = null,
  onSuccess = null,
  asModal = false,
  showCardList = !asModal,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const actor = getCurrentActor();
  const routeInvoice = location.state || null;
  const shellRef = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [selectedItemIndex] = useState(0);
  const [invoice, setInvoice] = useState(() => externalInvoice || routeInvoice || readStoredInvoice());
  const [invoiceCards, setInvoiceCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [invoiceCardPage, setInvoiceCardPage] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [serviceCharge, setServiceCharge] = useState(0);
  const [cardDetails, setCardDetails] = useState({
    cardHolderName: "",
    cardLast4: "",
    cardType: "Credit Card",
    transactionRef: "",
  });
  const [splitCount, setSplitCount] = useState(1);
  const [generatedBill, setGeneratedBill] = useState(null);
  const [isAutoSavingBill, setIsAutoSavingBill] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [chargeableRooms, setChargeableRooms] = useState([]);
  const [roomChargeQuery, setRoomChargeQuery] = useState("");
  const [selectedRoomNumber, setSelectedRoomNumber] = useState("");

  useEffect(() => {
    const nextInvoice = externalInvoice || routeInvoice || readStoredInvoice();
    setInvoice(nextInvoice || null);
  }, [externalInvoice, routeInvoice]);

  useEffect(() => {
    if (asModal || !showCardList) return undefined;

    let active = true;
    const refreshCards = async () => {
      try {
        setLoadingCards(true);
        const rows = await loadPaymentBoard();
        if (!active) return;
        setInvoiceCards(rows);
        setInvoice((current) => {
          if (current) {
            const matched = rows.find((row) => createBoardCardKey(row) === createBoardCardKey(current));
            if (matched) {
              // Preserve local amounts if they exist and server returned zero/empty.
              // This prevents a board refresh from wiping correct qty-based totals.
              const serverHasAmounts = Number(matched.subtotal || 0) > 0 || Array.isArray(matched.items) && matched.items.length > 0;
              if (!serverHasAmounts && (Number(current.subtotal || 0) > 0 || (Array.isArray(current.items) && current.items.length > 0))) {
                return { ...matched, items: current.items, subtotal: current.subtotal, gst: current.gst, total: current.total };
              }
            }
            return matched || current;
          }
          return rows[0] || readStoredInvoice() || null;
        });
      } catch {
        if (active) setInvoiceCards([]);
      } finally {
        if (active) setLoadingCards(false);
      }
    };

    refreshCards();
    window.addEventListener("tokenUpdated", refreshCards);
    return () => {
      active = false;
      window.removeEventListener("tokenUpdated", refreshCards);
    };
  }, [asModal, showCardList]);

  useEffect(() => {
    if (!invoice) return;
    setCustomerName(invoice.customerName || "");
    setPhone(invoice.phone || "");
    setPaymentMethod(invoice.paymentMethod || "Cash");
    setDiscountAmount(Number(invoice.discountAmount || 0));
    setServiceCharge(Number(invoice.serviceCharge || 0));
    setSplitCount(Math.max(1, Number(invoice.splitCount || invoice.personCount || 1)));
    setCardDetails({
      cardHolderName: invoice.cardDetails?.cardHolderName || "",
      cardLast4: invoice.cardDetails?.cardLast4 || "",
      cardType: invoice.cardDetails?.cardType || "Credit Card",
      transactionRef: invoice.cardDetails?.transactionRef || "",
    });
    setGeneratedBill(
      invoice.billId
        ? {
            id: invoice.billId,
            invoiceStatus: invoice.invoiceStatus || "Generated",
          }
        : null,
    );
    persistInvoice(invoice);
    setFieldErrors(getCustomerFieldErrors({
      customerName: invoice.customerName || "",
      phone: invoice.phone || "",
    }));
    setSelectedRoomNumber(invoice.selectedRoomNumber || invoice.postedRoomNumber || "");
  }, [invoice]);

  useEffect(() => {
    let active = true;

    const loadChargeableRooms = async () => {
      try {
        const [roomsResponse, bookingsResponse] = await Promise.all([
          API.get("/housekeeping"),
          API.get("/hotel/all-bookings"),
        ]);
        if (!active) return;
        setChargeableRooms(buildChargeableRooms(roomsResponse.data, bookingsResponse.data));
      } catch {
        if (active) setChargeableRooms([]);
      }
    };

    loadChargeableRooms();
    return () => {
      active = false;
    };
  }, []);

  const totalInvoiceCardPages = Math.max(
    1,
    Math.ceil(invoiceCards.length / PAYMENT_CARD_PAGE_SIZE),
  );
  const paginatedInvoiceCards = invoiceCards.slice(
    (invoiceCardPage - 1) * PAYMENT_CARD_PAGE_SIZE,
    invoiceCardPage * PAYMENT_CARD_PAGE_SIZE,
  );

  useEffect(() => {
    setInvoiceCardPage(1);
  }, [invoiceCards]);

  useEffect(() => {
    if (invoiceCardPage > totalInvoiceCardPages) {
      setInvoiceCardPage(totalInvoiceCardPages);
    }
  }, [invoiceCardPage, totalInvoiceCardPages]);

  useEffect(() => {
    if (!invoice?.tokenId || Array.isArray(invoice?.items) && invoice.items.length) return undefined;

    let active = true;
    const hydrateInvoiceItems = async () => {
      try {
        const response = await API.get(`/token/items/${invoice.tokenId}`);
        if (!active) return;
        const nextItems = mapTokenItemsToInvoiceItems(response.data);
        if (!nextItems.length) return;

        setInvoice((current) => {
          if (!current || Number(current.tokenId || 0) !== Number(invoice.tokenId || 0)) {
            return current;
          }
          const nextInvoice = { ...current, items: nextItems };
          persistInvoice(nextInvoice);
          return nextInvoice;
        });

        if (!asModal) {
          setInvoiceCards((current) =>
            current.map((card) =>
              createBoardCardKey(card) === createBoardCardKey(invoice)
                ? { ...card, items: nextItems }
                : card,
            ),
          );
        }
      } catch {
        // Keep the screen usable even if token items can no longer be read.
      }
    };

    hydrateInvoiceItems();
    return () => {
      active = false;
    };
  }, [asModal, invoice]);

  useEffect(() => {
    if (!invoice || invoice.billId || !invoice.tokenId || isAutoSavingBill) return;

    let active = true;
    const autoSaveInvoiceBill = async () => {
      try {
        setIsAutoSavingBill(true);
        const response = await restaurantService.createBill({
          billId: null,
          table: invoice.table,
          tokenId: invoice.tokenId,
          waiterName: invoice.waiterName || null,
          customerName: invoice.customerName || "",
          phone: invoice.phone || "",
          subtotal: Number(invoice.subtotal || 0),
          gst: Number(invoice.gst || 0),
          serviceCharge: Number(invoice.serviceCharge || 0),
          total: Number(invoice.total || 0),
          discountAmount: Number(invoice.discountAmount || 0),
          splitCount: Number(invoice.splitCount || invoice.personCount || 1),
          paymentMethod: null,
          entityType: invoice.entityType || "Table",
          invoiceStatus: "Generated",
        });
        if (!active) return;
        const nextInvoice = sanitizeGeneratedInvoice(invoice, response);
        setGeneratedBill({
          id: nextInvoice.billId,
          invoiceStatus: nextInvoice.invoiceStatus || "Generated",
        });
        setInvoice((current) => (current ? { ...current, ...nextInvoice } : current));
        window.dispatchEvent(new Event("tokenUpdated"));
      } catch {
        // Keep the screen usable even if autosave fails; pay flow can still create a paid bill.
      } finally {
        if (active) setIsAutoSavingBill(false);
      }
    };

    autoSaveInvoiceBill();
    return () => {
      active = false;
    };
  }, [invoice, isAutoSavingBill]);

  const entityType = invoice?.entityType || invoice?.type || "Table";

  const selectedItem = useMemo(() => {
    if (!invoice?.items?.length) return null;
    return invoice.items[selectedItemIndex] || invoice.items[0];
  }, [invoice, selectedItemIndex]);

  const splitPreview = useMemo(() => {
    const count = Math.max(1, Number(splitCount || 1));
    const evenSubtotal = Number(invoice?.subtotal || 0) / count;
    const evenTax = Number(invoice?.gst || 0) / count;
    const evenServiceCharge = Number(serviceCharge || 0) / count;
    const evenTotal = Math.max(0, Number(invoice?.subtotal || 0) + Number(invoice?.gst || 0) + Number(serviceCharge || 0) - Number(discountAmount || 0)) / count;

    return Array.from({ length: count }, (_, index) => ({
      splitLabel: `Split ${index + 1}`,
      splitNo: index + 1,
      splitCount: count,
      subtotal: evenSubtotal,
      gst: evenTax,
      serviceCharge: evenServiceCharge,
      total: evenTotal,
    }));
  }, [discountAmount, invoice, serviceCharge, splitCount]);

  const computedTotal = useMemo(
    () => Math.max(0, Number(invoice?.subtotal || 0) + Number(invoice?.gst || 0) + Number(serviceCharge || 0) - Number(discountAmount || 0)),
    [discountAmount, invoice, serviceCharge],
  );

  const personCount = useMemo(
    () => Math.max(1, Number(splitCount || invoice?.splitCount || invoice?.personCount || 1)),
    [invoice, splitCount],
  );

  const perPersonAmount = useMemo(
    () => computedTotal / personCount,
    [computedTotal, personCount],
  );

  const isCurrentBillPaid = isPaidInvoice(
    generatedBill?.invoiceStatus || invoice?.invoiceStatus,
  );
  const isCurrentBillPostedToRoom = isPostedToRoomInvoice(
    generatedBill?.invoiceStatus || invoice?.invoiceStatus,
  );
  const selectedChargeRoom = useMemo(
    () => chargeableRooms.find((room) => String(room.roomNumber) === String(selectedRoomNumber)),
    [chargeableRooms, selectedRoomNumber],
  );
  const filteredChargeableRooms = useMemo(() => {
    const query = String(roomChargeQuery || "").trim().toLowerCase();
    if (!query) return chargeableRooms;
    return chargeableRooms.filter((room) => {
      const haystack = [
        room.roomNumber,
        room.guestName,
        room.mobile,
        room.bookingCode,
        room.roomType,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [chargeableRooms, roomChargeQuery]);
  const isRoomChargeMode = paymentMethod === "Charge To Room";
  const isRoomEntity = String(entityType || "").toLowerCase() === "room";
  // Split bills should go to folio if: (1) Charge To Room mode with room selected, OR (2) Room entity type with active booking
  const shouldPostSplitToFolio = isRoomChargeMode || isRoomEntity;
  const waiterDiscountLocked = actor.isWaiter;
  const canChargeToRoom = chargeableRooms.length > 0;

  const saveInvoiceState = (patch = {}) => {
    setInvoice((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      persistInvoice(next);
      return next;
    });
    if (!asModal) {
      setInvoiceCards((current) =>
        current.map((card) =>
          invoice && createBoardCardKey(card) === createBoardCardKey(invoice) ? { ...card, ...patch } : card,
        ),
      );
    }
  };

  const handleCustomerNameChange = (value) => {
    const sanitizedValue = sanitizeCustomerName(value);
    setCustomerName(sanitizedValue);
    setFieldErrors(getCustomerFieldErrors({ customerName: sanitizedValue, phone }));
    saveInvoiceState({ customerName: sanitizedValue });
  };

  const handlePhoneChange = (value) => {
    const sanitizedValue = sanitizePhoneNumber(value);
    setPhone(sanitizedValue);
    setFieldErrors(getCustomerFieldErrors({ customerName, phone: sanitizedValue }));
    saveInvoiceState({ phone: sanitizedValue });
  };

const mergeDuplicateItems = (items) => {
  if (!Array.isArray(items) || items.length <= 1) return items || [];
  const mergedMap = new Map();
  items.forEach((item) => {
    const key = `${String(item.name || "").trim().toLowerCase()}|${Number(item.rate || 0)}`;
    const existing = mergedMap.get(key);
    if (existing) {
      existing.qty = Number(existing.qty || 0) + Number(item.qty || 0);
    } else {
      mergedMap.set(key, {
        id: item.id,
        name: item.name || "Menu Item",
        qty: Number(item.qty || 0),
        rate: Number(item.rate || 0),
      });
    }
  });
  return Array.from(mergedMap.values());
};

const recalculateInvoiceTotals = (items) => {
  const merged = mergeDuplicateItems(items);
  const subtotal = merged.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0), 0);
  const gst = subtotal * 0.05;
  return { items: merged, subtotal, gst, total: subtotal + gst };
};

  const handleItemQtyChange = async (itemIndex, newQty) => {
    if (!invoice || !invoice.items) return;
    const qty = Math.max(1, Math.floor(newQty));
    const currentItem = invoice.items[itemIndex];
    if (!currentItem) return;

    if (qty === 0) return; // don't allow zero, use delete instead

    const updatedItems = invoice.items.map((item, idx) =>
      idx === itemIndex ? { ...item, qty } : item,
    );

    const { items: mergedItems, subtotal, gst, total } = recalculateInvoiceTotals(updatedItems);

    // Optimistically update UI
    const nextInvoice = { ...invoice, items: mergedItems, subtotal, gst, total };
    setInvoice(nextInvoice);
    saveInvoiceState({ items: mergedItems, subtotal, gst, total });

    // Persist to backend if token item has an id
    if (currentItem.id && invoice.tokenId) {
      try {
        await restaurantService.updateTokenItem(currentItem.id, { qty, rate: Number(currentItem.rate || 0) });
        // Don't dispatch tokenUpdated — it triggers a full board reload that
        // overwrites local state. saveInvoiceState already keeps invoiceCards in sync.
      } catch (err) {
        console.warn("Failed to update item quantity on server:", err);
        // Revert on failure
        const reverted = recalculateInvoiceTotals(invoice.items);
        setInvoice((current) => (current ? { ...current, ...reverted } : current));
        saveInvoiceState(reverted);
      }
    }
  };

  const handleItemDelete = async (itemIndex) => {
    if (!invoice || !invoice.items) return;
    const currentItem = invoice.items[itemIndex];
    if (!currentItem) return;

    const remaining = invoice.items.filter((_, idx) => idx !== itemIndex);
    if (!remaining.length) return; // don't delete last item via this

    const { items: mergedItems, subtotal, gst, total } = recalculateInvoiceTotals(remaining);

    const nextInvoice = { ...invoice, items: mergedItems, subtotal, gst, total };
    setInvoice(nextInvoice);
    saveInvoiceState({ items: mergedItems, subtotal, gst, total });

    if (currentItem.id && invoice.tokenId) {
      try {
        await restaurantService.deleteTokenItem(currentItem.id);
        // Don't dispatch tokenUpdated — it triggers a full board reload.
        // saveInvoiceState already keeps invoiceCards in sync.
      } catch (err) {
        console.warn("Failed to delete item on server:", err);
        const reverted = recalculateInvoiceTotals(invoice.items);
        setInvoice((current) => (current ? { ...current, ...reverted } : current));
        saveInvoiceState(reverted);
      }
    }
  };

  // Apply merge on any items load so duplicates are combined immediately
  useEffect(() => {
    if (!invoice?.items?.length) return;
    const merged = mergeDuplicateItems(invoice.items);
    if (merged.length !== invoice.items.length) {
      const { items: finalItems, subtotal, gst, total } = recalculateInvoiceTotals(merged);
      setInvoice((current) => (current ? { ...current, items: finalItems, subtotal, gst, total } : current));
      saveInvoiceState({ items: finalItems, subtotal, gst, total });
    }
  }, [invoice?.tokenId, invoice?.items?.length]);

  const handleDiscountChange = (value) => {
    if (waiterDiscountLocked) return;
    const normalized = Math.max(0, Number(value || 0));
    setDiscountAmount(normalized);
    const newTotal = round2(Math.max(0, Number(invoice?.subtotal || 0) + Number(invoice?.gst || 0) + Number(serviceCharge || 0) - normalized));
    saveInvoiceState({
      discountAmount: normalized,
      total: newTotal,
      serviceCharge: Number(serviceCharge || 0),
      personCount,
      splitCount: personCount,
    });
  };

  const round2 = (value) => Number((Number(value || 0)).toFixed(2));

  const handleToggleServiceCharge = () => {
    const isOn = Number(serviceCharge || 0) > 0;
    if (isOn) {
      // Toggle OFF — clear service charge
      setServiceCharge(0);
      saveInvoiceState({ serviceCharge: 0 });
    } else {
      // Toggle ON — add 5% service charge on food bill
      const subtotal = Number(invoice?.subtotal || 0);
      const charge = round2(subtotal * 0.05);
      setServiceCharge(charge);
      saveInvoiceState({ serviceCharge: charge });
    }
  };

  const handleServiceChargeChange = (value) => {
    const charge = round2(Number(value || 0));
    setServiceCharge(charge);
    saveInvoiceState({ serviceCharge: charge });
  };

  const handleSplitCountChange = (value) => {
    const normalized = Math.max(1, Number(value || 1));
    setSplitCount(normalized);
    saveInvoiceState({ personCount: normalized, splitCount: normalized });
  };

  const handlePaymentMethodChange = (value) => {
    setPaymentMethod(value);
    saveInvoiceState({ paymentMethod: value });
  };

  const handleRoomSelection = (roomNumber) => {
    setSelectedRoomNumber(roomNumber);
    const selectedRoom = chargeableRooms.find((room) => String(room.roomNumber) === String(roomNumber));
    const sanitizedName = sanitizeCustomerName(selectedRoom?.guestName || "");
    const sanitizedPhone = sanitizePhoneNumber(selectedRoom?.mobile || "");
    saveInvoiceState({
      selectedRoomNumber: roomNumber || "",
      customerName: sanitizedName,
      phone: sanitizedPhone,
      roomBookingId: selectedRoom?.bookingId || null,
      roomBookingCode: selectedRoom?.bookingCode || "",
    });
    if (!selectedRoom) return;

    setCustomerName(sanitizedName);
    setPhone(sanitizedPhone);
    setFieldErrors(
      getCustomerFieldErrors({
        customerName: sanitizedName,
        phone: sanitizedPhone,
      }),
    );
  };

  const updateCardDetails = (patch) => {
    setCardDetails((current) => {
      const next = { ...current, ...patch };
      saveInvoiceState({ cardDetails: next });
      return next;
    });
  };

  const handleClose = () => {
    if (typeof onClose === "function") {
      onClose();
      return;
    }
    navigate("/restaurant");
  };

  const buildBillPayload = () => ({
    billId: generatedBill?.id || invoice?.billId || null,
    table: invoice?.table,
    tokenId: invoice?.tokenId || null,
    waiterName: invoice?.waiterName || null,
    customerName: customerName || invoice?.customerName || "",
    phone: phone || invoice?.phone || "",
    cardDetails: paymentMethod === "Card" ? cardDetails : null,
    subtotal: Number(invoice?.subtotal || 0),
    gst: Number(invoice?.gst || 0),
    serviceCharge: Number(serviceCharge || 0),
    total: computedTotal,
    discountAmount: Number(discountAmount || 0),
    splitCount: personCount,
    paymentMethod,
    entityType,
  });

  const buildRoomChargePayload = () => ({
    ...buildBillPayload(),
    roomNumber: selectedChargeRoom?.roomNumber || "",
    bookingId: selectedChargeRoom?.bookingId || null,
    bookingCode: selectedChargeRoom?.bookingCode || "",
    sourceTableNumber: invoice?.table || "",
    createdBy: localStorage.getItem("name") || localStorage.getItem("username") || "Restaurant POS",
  });

  const validatePaymentDetails = () => {
    const nextFieldErrors = getCustomerFieldErrors({ customerName, phone });
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      return false;
    }

    if (isRoomChargeMode) {
      if (!selectedChargeRoom) {
        alert("Charge karne ke liye occupied in-house room select kijiye.");
        return false;
      }

      return true;
    }

    if (paymentMethod !== "Card") return true;

    if (!String(cardDetails.cardHolderName || "").trim()) {
      alert("Card holder name required.");
      return false;
    }

    if (!/^\d{4}$/.test(String(cardDetails.cardLast4 || "").trim())) {
      alert("Card last 4 digits required.");
      return false;
    }

    if (!String(cardDetails.transactionRef || "").trim()) {
      alert("Card transaction reference required.");
      return false;
    }

    return true;
  };

  const handlePrint = async (overrideInvoice = null) => {
    const rawInvoice = overrideInvoice || invoice;
    if (!rawInvoice) return;

    // Hydrate items from the server if the invoice was created without them
    // (e.g. bill created from token but items not yet attached).
    let invoiceToPrint = { ...rawInvoice };
    const tokenId = rawInvoice.tokenId || invoice?.tokenId || null;
    if (tokenId && (!Array.isArray(invoiceToPrint.items) || !invoiceToPrint.items.length)) {
      try {
        const itemsRes = await API.get(`/token/items/${tokenId}`);
        const tokenItems = Array.isArray(itemsRes.data) ? itemsRes.data : [];
        if (tokenItems.length) {
          invoiceToPrint = {
            ...invoiceToPrint,
            items: tokenItems.map((item) => ({
              id: item.id,
              name: item.item_name || item.name || "Menu Item",
              qty: Number(item.qty || item.quantity || 0),
              rate: Number(item.rate || item.price || 0),
            })),
          };
        }
      } catch {
        // Proceed without items if the API call fails
      }
    }

    // Determine print label: if a bill already exists, show "INVOICE" (original),
    // otherwise show "COPY" to indicate it's not the final printed version.
    const hasBill = Number(invoiceToPrint?.billId || 0) > 0;
    const printLabel = hasBill ? "INVOICE" : "INVOICE COPY";

    // Robust resolution: merge state + override + parent invoice to ensure
    // table no and KOT no ALWAYS have a value on the printed receipt.
    const pickFirst = (...values) => {
      for (const v of values) {
        if (v !== null && v !== undefined && String(v).trim() !== "") return v;
      }
      return null;
    };

    const resolvedTableNo = String(
      pickFirst(
        invoiceToPrint?.table,
        invoiceToPrint?.tableNumber,
        invoiceToPrint?.postedRoomNumber,
        invoiceToPrint?.sourceTableNumber,
        invoiceToPrint?.roomNumber,
        invoice?.table,
        invoice?.tableNumber,
        invoice?.postedRoomNumber,
        invoice?.sourceTableNumber,
        invoice?.roomNumber,
        invoiceCards.find((c) => createBoardCardKey(c) === createBoardCardKey(invoiceToPrint))?.table,
        selectedChargeRoom?.roomNumber,
        invoiceToPrint?.tableNumber,
      ) || "1"
    );

    const resolvedKotNo = String(
      pickFirst(
        invoiceToPrint?.tokenId,
        invoiceToPrint?.tokenCode,
        invoice?.tokenId,
        invoice?.tokenCode,
        invoiceToPrint?.kotNo,
        invoice?.kotNo,
      ) || (invoiceToPrint?.billId ? `B-${invoiceToPrint.billId}` : "1")
    );

    const explicitInvoiceNo = generatedBill?.id
      ? String(generatedBill.id)
      : invoiceToPrint?.billId
        ? String(invoiceToPrint.billId)
        : invoiceToPrint?.tokenId
          ? `TMP-${String(invoiceToPrint.tokenId)}`
          : null;

    const printHTML = buildReceiptHtml({
      invoice: {
        ...invoiceToPrint,
        table: resolvedTableNo,
        tokenId: resolvedKotNo !== "1" ? resolvedKotNo : invoiceToPrint.tokenId,
      },
      entityType,
      customerName,
      phone,
      paymentMethod,
      cardDetails,
      personCount,
      discountAmount,
      serviceCharge,
      perPersonAmount,
      computedTotal,
      printLabel,
      explicitInvoiceNo,
      explicitTableNo: resolvedTableNo,
      explicitKotNo: resolvedKotNo,
    });

    const win = window.open("", "", "width=440,height=800,menubar=no,toolbar=no,location=no,status=no");
    if (!win) return;

    win.document.open();
    win.document.write(printHTML);
    win.document.close();

    const returnFocusAndClose = () => {
      try {
        if (win && !win.closed) win.close();
      } catch {}
      window.focus();
    };

    win.onafterprint = returnFocusAndClose;

    const fallbackTimer = window.setTimeout(() => {
      returnFocusAndClose();
    }, 8000);

    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {}
      window.clearTimeout(fallbackTimer);
    }, 300);
  };

  const handlePayment = async () => {
    if (!invoice) return;
    if (!validatePaymentDetails()) return;

    try {
      setSubmitting(true);

      if (isRoomChargeMode) {
        const roomChargeResponse = await restaurantService.chargeBillToRoom(buildRoomChargePayload());
        const postedBill = {
          id: roomChargeResponse.billId || generatedBill?.id || invoice.billId || null,
          invoiceStatus: "Posted To Room",
        };

        setGeneratedBill(postedBill);
        saveInvoiceState({
          customerName,
          phone,
          paymentMethod: "Charge To Room",
          discountAmount,
          personCount,
          splitCount: personCount,
          billId: postedBill.id,
          invoiceStatus: "Posted To Room",
          total: computedTotal,
          postedToRoom: true,
          postedRoomNumber: roomChargeResponse.roomNumber || selectedChargeRoom?.roomNumber || "",
          roomBookingId: roomChargeResponse.bookingId || selectedChargeRoom?.bookingId || null,
          roomBookingCode: roomChargeResponse.bookingCode || selectedChargeRoom?.bookingCode || "",
          folioEntryId: roomChargeResponse.folioEntryId || null,
          sourceTableNumber: invoice?.table || "",
          postedAt: new Date().toISOString(),
        });

        window.dispatchEvent(new Event("tokenUpdated"));

        // Release the lock when bill is posted to room
        API.post(`/waiter/release-lock`, {
          tableNumber: invoice.table,
          tokenId: invoice.tokenId || null,
        }).catch(console.warn);

        if (typeof onSuccess === "function") {
          onSuccess({
            type: "posted_to_room",
            billId: postedBill.id,
            roomNumber: roomChargeResponse.roomNumber || selectedChargeRoom?.roomNumber || "",
          });
        }

        alert(`Bill Room ${roomChargeResponse.roomNumber || selectedChargeRoom?.roomNumber || ""} folio me post ho gaya.`);
        handleClose();
        return;
      }

      const paymentResponse = await restaurantService.payBill(buildBillPayload());
      const paidBill = {
        id: paymentResponse.billId || generatedBill?.id || invoice.billId || null,
        invoiceStatus: "Paid",
      };
      setGeneratedBill(paidBill);
      saveInvoiceState({
        customerName,
        phone,
        paymentMethod,
        discountAmount,
        personCount,
        splitCount: personCount,
        cardDetails: paymentMethod === "Card" ? cardDetails : null,
        billId: paidBill.id,
        invoiceStatus: "Paid",
        total: computedTotal,
      });

      if (typeof restaurantService.createConsumptionSale === "function") {
        await restaurantService.createConsumptionSale({
          referenceNo: `BILL-${paymentResponse.billId || invoice.tokenId || invoice.table}-${invoice.date || Date.now()}`,
          referenceType: "restaurant-bill",
          sourceBillId: paymentResponse.billId || null,
          entityType,
          entityRef: invoice.table,
          table: invoice.table,
          outlet: invoice.outlet || "Main Kitchen",
          branch: invoice.branch || "Main Branch",
          subtotal: Number(invoice.subtotal || 0),
          tax: Number(invoice.gst || 0),
          total: computedTotal,
          createdBy: "system",
          items: (invoice.items || []).map((item) => ({
            menuItemId: item.menuItemId || item.menu_item_id || null,
            name: item.name,
            category: item.category || "Other",
            quantity: Number(item.qty || 0),
            price: Number(item.rate || 0),
          })),
        });
      }

      const cleanupResults = await Promise.allSettled([
        API.put(`/restaurant/order/${invoice.table}/pay`),
        API.put(`/token/close/${invoice.table}`),
        API.post(`/waiter/release-lock`, {
          tableNumber: invoice.table,
          tokenId: invoice.tokenId || null,
        }),
      ]);

      cleanupResults.forEach((result) => {
        if (result.status !== "rejected") return;
        if (isIgnorablePostPaymentError(result.reason)) return;
        console.warn("Post-payment cleanup failed", result.reason);
      });

      window.dispatchEvent(new Event("tokenUpdated"));
      if (typeof onSuccess === "function") onSuccess({ type: "paid", billId: paidBill.id });

      setPaymentResult({
        show: true,
        success: true,
        message: "Payment Successful!",
        billId: paidBill.id,
        total: computedTotal,
        method: paymentMethod,
      });

      handlePrint({
        ...invoice,
        customerName,
        phone,
        paymentMethod,
        discountAmount,
        billId: paidBill.id,
        invoiceStatus: "Paid",
        total: computedTotal,
        printedAt: new Date().toISOString(),
        paidAt: new Date().toISOString(),
      });

      if (asModal) {
        handleClose();
      }
    } catch (error) {
      setPaymentResult({
        show: true,
        success: false,
        message: error.response?.data?.message || "Payment could not be saved.",
        billId: null,
        total: 0,
        method: "",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateBill = async () => {
    return undefined;
  };

  // Result popup state
  const [folioResult, setFolioResult] = useState({ show: false, success: false, message: "", roomNumber: "" });
  const [showFolioPopup, setShowFolioPopup] = useState(false);
  const [folioBookingId, setFolioBookingId] = useState(null);
  const [folioBookingCode, setFolioBookingCode] = useState(null);

  // WhatsApp invoice modal state (only for table booking / restaurant POS invoices)
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);

  // Payment result popup state
  const [paymentResult, setPaymentResult] = useState({ show: false, success: false, message: "", billId: null, total: 0, method: "" });

  useEffect(() => {
    if (!folioResult.show && !showFolioPopup) return undefined;

    const findScrollableParent = (node) => {
      let current = node?.parentElement || null;

      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const canScroll = /(auto|scroll)/.test(style.overflowY);

        if (canScroll && current.scrollHeight > current.clientHeight) {
          return current;
        }

        current = current.parentElement;
      }

      return null;
    };

    const scrollParent = findScrollableParent(shellRef.current);
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalScrollParentOverflow = scrollParent?.style.overflowY || "";
    const originalScrollParentOverscroll = scrollParent?.style.overscrollBehavior || "";

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (scrollParent) {
      scrollParent.style.overflowY = "hidden";
      scrollParent.style.overscrollBehavior = "contain";
    }

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;

      if (scrollParent) {
        scrollParent.style.overflowY = originalScrollParentOverflow;
        scrollParent.style.overscrollBehavior = originalScrollParentOverscroll;
      }
    };
  }, [folioResult.show, showFolioPopup]);

  const handleCreateSplitBill = async () => {
    if (!invoice) return;

    try {
      setSubmitting(true);

      if (shouldPostSplitToFolio) {
        // Determine which room to charge
        let targetRoom = null;

        if (isRoomChargeMode && selectedChargeRoom) {
          // Table with "Charge To Room" mode - use selected room
          targetRoom = selectedChargeRoom;
        } else if (isRoomEntity && invoice.table) {
          // Room entity type - use invoice's room and booking info directly
          targetRoom = {
            roomNumber: invoice.table,
            bookingId: invoice.bookingId || null,
            bookingCode: invoice.bookingCode || "",
          };
        }

        if (!targetRoom?.roomNumber) {
          setFolioResult({
            show: true,
            success: false,
            message: "Room number nahi mila. Room charge ke liye room select kijiye.",
            roomNumber: "",
          });
          setSubmitting(false);
          return;
        }

        // Save split bills AND post each split to room folio
        const roomChargePromises = splitPreview.map((split) =>
          Promise.all([
            restaurantService.createSplitBill({
              billId: generatedBill?.id || invoice.billId || null,
              tableNumber: invoice.table,
              entityType,
              splitLabel: split.splitLabel,
              splitNo: split.splitNo,
              splitCount: split.splitCount,
              subtotal: split.subtotal,
              gst: split.gst,
              total: split.total,
              paymentMethod: "Charge To Room",
              items: invoice.items || [],
            }),
            restaurantService.chargeSplitBillToRoom({
              roomNumber: targetRoom.roomNumber,
              bookingId: targetRoom.bookingId || invoice.bookingId || null,
              splits: [split],
              tableNumber: invoice.table,
              billId: generatedBill?.id || invoice.billId || null,
              splitCount: split.splitCount,
              entityType,
            }),
          ]),
        );

        await Promise.all(roomChargePromises);
        // Dispatch event to refresh folio view
        window.dispatchEvent(new Event("folioUpdated"));
        window.dispatchEvent(new Event("tokenUpdated"));

        // Show success popup
        setFolioResult({
          show: true,
          success: true,
          message: `Split bills Room ${targetRoom.roomNumber} ke folio me add ho gaye! Total ${splitPreview.length} split(s) posted.`,
          roomNumber: targetRoom.roomNumber,
        });
      } else {
        await Promise.all(
          splitPreview.map((split) =>
            restaurantService.createSplitBill({
              billId: generatedBill?.id || invoice.billId || null,
              tableNumber: invoice.table,
              entityType,
              splitLabel: split.splitLabel,
              splitNo: split.splitNo,
              splitCount: split.splitCount,
              subtotal: split.subtotal,
              gst: split.gst,
              total: split.total,
              paymentMethod,
              items: invoice.items || [],
            }),
          ),
        );
        // Show success popup
        setFolioResult({
          show: true,
          success: true,
          message: `Split bill saved successfully! Total ${splitPreview.length} split(s) created.`,
          roomNumber: "",
        });
      }
    } catch (error) {
      console.error("Split bill error:", error);
      const errorMsg = error.response?.data?.message || error.message || "Unknown error";
      // Show error popup
      setFolioResult({
        show: true,
        success: false,
        message: `Error: ${errorMsg}`,
        roomNumber: "",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (asModal && !invoice) {
    return (
      <div className={asModal ? "p-4" : "min-h-screen bg-gradient-to-br from-blue-50/40 via-white to-white p-6"}>
        <div className="rounded-2xl border border-blue-100 bg-white p-6 text-center text-lg font-semibold text-slate-500 shadow-[0_20px_50px_-20px_rgba(30,64,175,0.2)] sm:rounded-[24px] sm:text-[21px]">
          No Invoice Data
        </div>
      </div>
    );
  }

  const shellClassName = asModal ? "w-full" : "w-full max-w-full overflow-x-hidden";

  const invoiceHeading = invoice
    ? `${entityType} ${invoice.table} · Visit ID ${formatVisitId(invoice.tokenCode, invoice.tokenId)} · Total ${formatCurrency(invoice.total)}`
    : "Select a payment card to continue.";
  const hasCustomerValidationErrors = Boolean(fieldErrors.customerName || fieldErrors.phone);
  const activeStationLabel = invoice
    ? `${String(entityType || "Table").toLowerCase() === "room" ? "Room" : "Table"} ${invoice.table}`
    : "Payment Desk";

  // ─── Result Popup Modal ────────────────────────────────────────────────────────
  const FolioResultPopup = () => {
    if (!folioResult.show) return null;

    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-4 backdrop-blur-sm"
        onClick={() => setFolioResult({ ...folioResult, show: false })}
      >
        <div
          className={`max-h-[90vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border ${
            folioResult.success
              ? "border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white"
              : "border-rose-200/70 bg-gradient-to-br from-rose-50 to-white"
          } shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[28px]`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`px-4 py-4 sm:px-6 sm:py-5 ${folioResult.success ? "bg-emerald-600" : "bg-rose-600"} text-white`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                <span className="text-2xl sm:text-3xl">{folioResult.success ? "✅" : "❌"}</span>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider opacity-80 sm:text-sm">
                    {folioResult.success ? "Success" : "Failed"}
                  </p>
                  <h2 className="mt-1 text-xl font-black sm:text-2xl">
                    {folioResult.success ? "Post to Folio" : "Error"}
                  </h2>
                </div>
              </div>
              <button
                onClick={() => setFolioResult({ ...folioResult, show: false })}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold text-white transition hover:bg-white/30 sm:h-10 sm:w-10 sm:text-xl"
              >
                ×
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-4 p-4 sm:p-6">
            <p className="text-[15px] font-medium text-slate-700 sm:text-base">
              {folioResult.message}
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setFolioResult({ ...folioResult, show: false })}
                className={`flex-1 rounded-full py-3 text-[15px] font-bold transition ${
                  folioResult.success
                    ? "border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    : "bg-rose-600 text-white hover:bg-rose-700"
                }`}
              >
                OK
              </button>
              {folioResult.success && (
                <button
                  onClick={() => {
                    setFolioResult({ ...folioResult, show: false });
                    // Open folio popup
                    if (folioResult.roomNumber && invoice?.bookingId) {
                      setFolioBookingId(invoice.bookingId);
                      setFolioBookingCode(invoice.bookingCode || "");
                      setShowFolioPopup(true);
                    }
                  }}
                  className="flex-1 rounded-full border border-slate-200 bg-white py-3 text-[15px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:text-base"
                >
                  View Folio
                </button>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  // ─── Payment Result Popup Modal ──────────────────────────────────────────────
  const PaymentResultPopup = () => {
    if (!paymentResult.show) return null;

    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-4 backdrop-blur-sm"
        onClick={() => setPaymentResult({ ...paymentResult, show: false })}
      >
        <div
          className={`max-h-[90vh] w-full max-w-sm overscroll-contain rounded-2xl border shadow-[0_30px_90px_rgba(15,23,42,0.35)] sm:rounded-[28px] ${
            paymentResult.success
              ? "border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-white"
              : "border-rose-200/70 bg-gradient-to-br from-rose-50 via-white to-white"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Animated icon */}
          <div className="flex justify-center pt-8 pb-4 sm:pt-10 sm:pb-5">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-full shadow-lg sm:h-24 sm:w-24 ${
                paymentResult.success
                  ? "bg-gradient-to-br from-emerald-500 to-green-500"
                  : "bg-gradient-to-br from-rose-500 to-red-500"
              }`}
            >
              <span className="text-4xl sm:text-5xl">
                {paymentResult.success ? "✓" : "✕"}
              </span>
            </div>
          </div>

          {/* Title and message */}
          <div className="px-5 pb-4 text-center sm:px-8 sm:pb-5">
            <h2
              className={`text-xl font-black sm:text-2xl ${
                paymentResult.success ? "text-emerald-900" : "text-rose-900"
              }`}
            >
              {paymentResult.success ? "Payment Successful" : "Payment Failed"}
            </h2>
            <p
              className={`mt-2 text-[15px] font-medium sm:text-base ${
                paymentResult.success ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {paymentResult.message}
            </p>
          </div>

          {/* Bill details card */}
          {paymentResult.success && (
            <div className="mx-5 mb-4 rounded-2xl border border-emerald-100 bg-white/80 p-4 shadow-sm sm:mx-8 sm:mb-5 sm:p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 sm:text-[11px]">Bill No</p>
                  <p className="mt-1 text-base font-black text-emerald-900 sm:text-lg">#{paymentResult.billId || "--"}</p>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 sm:text-[11px]">Total Paid</p>
                  <p className="mt-1 text-base font-black text-emerald-900 sm:text-lg">Rs. {Number(paymentResult.total || 0).toLocaleString("en-IN")}</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-gradient-to-br from-blue-50 to-sky-100/50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 sm:text-[11px]">Payment Method</p>
                <p className="mt-1 text-sm font-black text-blue-900 sm:text-base">{paymentResult.method || "Cash"}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="px-5 pb-6 sm:px-8 sm:pb-7">
            <button
              onClick={() => setPaymentResult({ ...paymentResult, show: false })}
              className="mb-3 w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-[15px] font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 sm:py-4 sm:text-[17px]"
            >
              Close
            </button>
            {paymentResult.success && (
              <button
                onClick={() => setPaymentResult({ ...paymentResult, show: false })}
                className={`w-full rounded-2xl py-3.5 text-[15px] font-bold shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl sm:py-4 sm:text-[17px] ${
                  paymentResult.success
                    ? "bg-gradient-to-r from-emerald-600 to-green-500 text-white shadow-[0_12px_28px_-10px_rgba(16,185,129,0.5)] hover:shadow-[0_16px_34px_-10px_rgba(16,185,129,0.6)]"
                    : "bg-gradient-to-r from-rose-600 to-red-500 text-white shadow-[0_12px_28px_-10px_rgba(244,63,94,0.5)] hover:shadow-[0_16px_34px_-10px_rgba(244,63,94,0.6)]"
                }`}
              >
                {paymentResult.success ? "Continue" : "OK"}
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  // ─── Premium design tokens (styling-only helpers) ─────────────────────────
  const glassCard =
    "rounded-2xl border border-blue-100/80 bg-white shadow-[0_20px_50px_-20px_rgba(30,64,175,0.22)] sm:rounded-[26px]";
  const inputCls = (hasError) =>
    `h-[50px] w-full rounded-xl border sm:h-[56px] ${
      hasError ? "border-rose-300 bg-rose-50/60 focus:ring-rose-300" : "border-blue-100 bg-white focus:ring-blue-400"
    } px-3.5 text-[15px] text-slate-800 placeholder:text-[14px] placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] transition focus:outline-none focus:ring-2 focus:border-blue-300 sm:px-4 sm:text-[17px] sm:placeholder:text-[16px]`;
  const iconBadge = (from, to, color) =>
    `flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${from} ${to} ${color} shadow-sm sm:h-11 sm:w-11`;
  const secondaryBtnCls =
    "h-[50px] w-full rounded-xl border-2 border-blue-200 bg-white px-6 text-[15px] font-bold text-blue-700 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-blue-50 sm:h-[54px] sm:w-auto sm:text-[17px]";
  const dangerBtnCls =
    "h-[50px] w-full rounded-xl border border-rose-200 bg-rose-50 px-6 text-[15px] font-bold text-rose-600 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-rose-100 sm:h-[54px] sm:w-auto sm:text-[17px]";

  return (
    <div ref={shellRef} className={shellClassName}>
      {/* Result Popups */}
      <FolioResultPopup />
      <PaymentResultPopup />

      {/* Folio Popup */}
      {showFolioPopup && (
        <FeatureModal title="Guest Folio" onClose={() => setShowFolioPopup(false)}>
          <FolioView
            bookingId={folioBookingId}
            bookingCode={folioBookingCode}
            isModal={true}
            onClose={() => setShowFolioPopup(false)}
          />
        </FeatureModal>
      )}
      <div className={asModal ? "w-full max-w-[460px]" : "w-full max-w-full space-y-4 sm:space-y-6"}>

        {/* ---------- Page header ---------- */}
        {!asModal ? (
          <div className="relative overflow-hidden rounded-2xl border border-blue-100/80 bg-gradient-to-br from-white via-blue-50/40 to-white p-4 shadow-[0_25px_60px_-25px_rgba(30,64,175,0.28)] sm:rounded-[28px] sm:p-7">
            <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-blue-100/50 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-sky-100/60 blur-3xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-blue-600 sm:text-[18px]">Restaurant Payment</p>
                <h1 className="mt-1 text-[22px] font-bold text-slate-900 sm:text-[32px]">Bill Review &amp; Payment</h1>
                <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-500 sm:text-[17px]">{invoiceHeading}</p>
              </div>
              <span
                className={`inline-flex w-fit items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-bold shadow-sm backdrop-blur sm:gap-2.5 sm:px-5 sm:py-2.5 sm:text-[16px] ${
                  isCurrentBillPaid
                    ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                    : isCurrentBillPostedToRoom
                      ? "border-sky-200 bg-sky-50/90 text-sky-700"
                      : "border-amber-200 bg-amber-50/90 text-amber-700"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isCurrentBillPaid ? "bg-emerald-500" : isCurrentBillPostedToRoom ? "bg-sky-500" : "bg-amber-500"
                  } animate-pulse`}
                />
                {isCurrentBillPaid ? "Paid" : isCurrentBillPostedToRoom ? "Posted To Room" : "Payment Pending"}
              </span>
            </div>
          </div>
        ) : null}

        {/* ---------- Open Payment Cards — moved to the top ---------- */}
        {!asModal && showCardList ? (
          <div className={`${glassCard} p-3.5 sm:p-6`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-5">
              <div className="flex items-center gap-2.5 sm:gap-3.5">
                <span className={iconBadge("from-violet-100", "to-violet-50", "text-violet-600")}>
                  <FiShoppingBag size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-blue-400 sm:text-[16px]">Review Queue</p>
                  <h3 className="text-[17px] font-bold text-slate-900 sm:text-[23px]">Open restaurant payment cards</h3>
                </div>
              </div>
              <div className="rounded-full bg-gradient-to-r from-blue-50 to-sky-50 px-3.5 py-1.5 text-[13px] font-bold text-blue-700 shadow-sm sm:px-4 sm:py-2 sm:text-[16px]">
                {invoiceCards.length} Cards
              </div>
            </div>

            {loadingCards ? (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/40 px-4 py-10 text-center text-base font-semibold text-slate-500 sm:text-[20px]">
                Payment cards loading...
              </div>
            ) : invoiceCards.length ? (
              <div className="overflow-hidden rounded-2xl border border-blue-100 shadow-[0_10px_30px_-15px_rgba(30,64,175,0.2)]">
                {/* Mobile / tablet card layout (below lg) */}
                <div className="flex flex-col gap-3 bg-white p-3 lg:hidden">
                  {paginatedInvoiceCards.map((card) => {
                    const active =
                      invoice &&
                      createBoardCardKey(card) === createBoardCardKey(invoice);
                    const normalizedStatus = normalizeInvoiceStatus(card.invoiceStatus);
                    const isPaid = normalizedStatus === "paid";
                    const isPostedToRoom = normalizedStatus === "posted to room";
                    const status = isPaid ? "Paid" : isPostedToRoom ? "Posted To Room" : "Pending";
                    const customer = getCustomerDisplay(card);

                    return (
                      <div
                        key={createBoardCardKey(card)}
                        className={`rounded-2xl border p-4 shadow-sm transition-colors ${
                          active ? "border-blue-300 bg-blue-50/70" : "border-blue-100 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900">
                              {String(card.entityType || "Table").toLowerCase() === "room" ? "Room" : "Table"} {card.table}
                            </div>
                            <div className="mt-0.5 text-[13px] text-slate-500">{formatVisitId(card.tokenCode, card.tokenId)}</div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-bold ${
                              isPaid
                                ? "bg-gradient-to-r from-emerald-50 to-emerald-100/70 text-emerald-700"
                                : isPostedToRoom
                                  ? "bg-gradient-to-r from-sky-50 to-sky-100/70 text-sky-700"
                                  : "bg-gradient-to-r from-amber-50 to-amber-100/70 text-amber-700"
                            }`}
                          >
                            {status}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                          <div>
                            <div className="font-semibold text-slate-900">{customer.name}</div>
                            <div className="text-slate-500">{customer.phone}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-slate-500">{formatDate(card.date)}</div>
                            <div className="font-bold text-emerald-600">{formatCurrency(card.total)}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setInvoice(card)}
                          className={`mt-3 w-full rounded-xl px-4 py-2.5 text-[14px] font-bold shadow-sm transition ${
                            active
                              ? "bg-gradient-to-r from-blue-900 via-blue-700 to-sky-500 text-white"
                              : "border-2 border-blue-100 bg-white text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          {active ? "Selected" : "Open"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table layout (lg and up) */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full bg-white text-left text-[17px]">
                    <thead className="bg-gradient-to-r from-blue-50 to-sky-50/60 text-[16px] font-bold uppercase tracking-[0.08em] text-blue-500">
                      <tr>
                        <th className="px-5 py-4">Table</th>
                        <th className="px-5 py-4">Customer</th>
                        <th className="px-5 py-4">Visit ID</th>
                        <th className="px-5 py-4">Date</th>
                        <th className="px-5 py-4">Total</th>
                        <th className="px-5 py-4">Status</th>
                        <th className="px-5 py-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedInvoiceCards.map((card) => {
                        const active =
                          invoice &&
                          createBoardCardKey(card) === createBoardCardKey(invoice);
                        const normalizedStatus = normalizeInvoiceStatus(card.invoiceStatus);
                        const isPaid = normalizedStatus === "paid";
                        const isPostedToRoom = normalizedStatus === "posted to room";
                        const status = isPaid ? "Paid" : isPostedToRoom ? "Posted To Room" : "Pending";
                        const customer = getCustomerDisplay(card);

                        return (
                          <tr
                            key={createBoardCardKey(card)}
                            className={`border-t border-blue-50 transition-colors ${active ? "bg-blue-50/70" : "bg-white hover:bg-blue-50/40"}`}
                          >
                            <td className="px-5 py-4 font-bold text-slate-900">
                              {String(card.entityType || "Table").toLowerCase() === "room" ? "Room" : "Table"} {card.table}
                            </td>
                            <td className="px-5 py-4">
                              <div className="font-semibold text-slate-900">{customer.name}</div>
                              <div className="mt-0.5 text-[15px] text-slate-500">{customer.phone}</div>
                            </td>
                            <td className="px-5 py-4 text-slate-600">{formatVisitId(card.tokenCode, card.tokenId)}</td>
                            <td className="px-5 py-4 text-slate-600">{formatDate(card.date)}</td>
                            <td className="px-5 py-4 font-bold text-emerald-600">{formatCurrency(card.total)}</td>
                            <td className="px-5 py-4">
                              <span
                                className={`rounded-full px-4 py-1.5 text-[15px] font-bold ${
                                  isPaid
                                    ? "bg-gradient-to-r from-emerald-50 to-emerald-100/70 text-emerald-700"
                                    : isPostedToRoom
                                      ? "bg-gradient-to-r from-sky-50 to-sky-100/70 text-sky-700"
                                      : "bg-gradient-to-r from-amber-50 to-amber-100/70 text-amber-700"
                                }`}
                              >
                                {status}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-center">
                              <button
                                type="button"
                                onClick={() => setInvoice(card)}
                                className={`rounded-xl px-4 py-2 text-[16px] font-bold shadow-sm transition ${
                                  active
                                    ? "bg-gradient-to-r from-blue-900 via-blue-700 to-sky-500 text-white"
                                    : "border-2 border-blue-100 bg-white text-blue-700 hover:bg-blue-50"
                                }`}
                              >
                                {active ? "Selected" : "Open"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {invoiceCards.length > PAYMENT_CARD_PAGE_SIZE ? (
                  <div className="flex flex-col gap-3 border-t border-blue-100 bg-blue-50/30 px-4 py-4 sm:px-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-center text-[14px] text-slate-500 sm:text-left sm:text-[16px]">
                      Showing{" "}
                      <span className="font-semibold text-slate-900">
                        {(invoiceCardPage - 1) * PAYMENT_CARD_PAGE_SIZE + 1}
                      </span>{" "}
                      to{" "}
                      <span className="font-semibold text-slate-900">
                        {Math.min(invoiceCardPage * PAYMENT_CARD_PAGE_SIZE, invoiceCards.length)}
                      </span>{" "}
                      of <span className="font-semibold text-slate-900">{invoiceCards.length}</span> payments
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                      <button
                        type="button"
                        onClick={() => setInvoiceCardPage((current) => Math.max(1, current - 1))}
                        disabled={invoiceCardPage === 1}
                        className="rounded-xl border-2 border-blue-100 bg-white px-3 py-2 text-[13px] font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-[15px]"
                      >
                        Previous
                      </button>

                      {Array.from({ length: totalInvoiceCardPages }, (_, index) => index + 1).map((pageNumber) => (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setInvoiceCardPage(pageNumber)}
                          className={`rounded-xl px-3 py-2 text-[13px] font-semibold transition sm:px-4 sm:text-[15px] ${
                            pageNumber === invoiceCardPage
                              ? "bg-gradient-to-r from-blue-900 via-blue-700 to-sky-500 text-white"
                              : "border-2 border-blue-100 bg-white text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          {pageNumber}
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => setInvoiceCardPage((current) => Math.min(totalInvoiceCardPages, current + 1))}
                        disabled={invoiceCardPage === totalInvoiceCardPages}
                        className="rounded-xl border-2 border-blue-100 bg-white px-3 py-2 text-[13px] font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-[15px]"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/30 px-4 py-10 text-center text-base font-semibold text-slate-500 sm:text-[20px]">
                No payment card found yet. Create an invoice and the card will appear here.
              </div>
            )}
          </div>
        ) : null}

        {/* ---------- Invoice detail / payment form ---------- */}
        <div className={asModal ? "" : "w-full max-w-full"}>
          <div className={`w-full ${asModal ? "max-w-[460px]" : ""}`}>
            {!invoice ? (
              <div className={`${glassCard} p-5 text-center text-base font-semibold text-slate-500 sm:p-8 sm:text-[21px]`}>
                Select a payment card. The full payment form for the selected invoice will open here.
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-6">

                {/* Active table + Selected row card + Customer — shown together in one row */}
                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3 items-stretch">

                  {/* Bill summary card */}
                  <div className={`${glassCard} p-4 sm:p-5 md:p-6 md:col-span-2 lg:col-span-1`}>
                    <div className="flex h-full flex-col gap-3.5 sm:gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-400 sm:text-[13px] md:text-[15px]">
                            Active {String(entityType || "Table").toLowerCase()}
                          </p>
                          <div className="mt-1.5 text-lg font-bold text-slate-900 sm:mt-2 sm:text-xl md:text-2xl">
                            {String(entityType || "Table").toLowerCase() === "room" ? "Room" : "Table"} {invoice.table}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-gradient-to-r from-blue-50 to-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-blue-600 shadow-sm sm:px-3 sm:py-1.5 sm:text-[12px] md:text-[14px]">
                          {activeStationLabel}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[11px] md:text-[13px]">
                            Subtotal
                          </div>
                          <div className="mt-0.5 truncate text-[13px] font-bold text-slate-900 sm:mt-1 sm:text-[15px] md:text-[17px]">
                            {formatCurrency(invoice.subtotal)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[11px] md:text-[13px]">
                            SGST (2.5%)
                          </div>
                          <div className="mt-0.5 truncate text-[13px] font-bold text-slate-900 sm:mt-1 sm:text-[15px] md:text-[17px]">
                            {formatCurrency(Number(invoice?.gst || 0) / 2)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[11px] md:text-[13px]">
                            CGST (2.5%)
                          </div>
                          <div className="mt-0.5 truncate text-[13px] font-bold text-slate-900 sm:mt-1 sm:text-[15px] md:text-[17px]">
                            {formatCurrency(Number(invoice?.gst || 0) / 2)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em] text-slate-400 sm:text-[11px] md:text-[13px]">
                            Service (2%)
                          </div>
                          <div className="mt-0.5 truncate text-[13px] font-bold text-slate-900 sm:mt-1 sm:text-[15px] md:text-[17px]">
                            {formatCurrency(serviceCharge)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-auto border-t border-blue-50 pt-3.5 sm:pt-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 sm:text-[13px] md:text-[15px]">
                          Grand Total
                        </div>
                        <div className="mt-1 bg-gradient-to-r from-blue-900 via-blue-700 to-sky-500 bg-clip-text text-[26px] font-bold leading-none text-transparent sm:text-[30px] md:text-[34px]">
                          {formatCurrency(computedTotal)}
                        </div>
                        <div className="mt-3 rounded-xl bg-gradient-to-br from-blue-50 to-sky-50/60 px-3 py-2.5 text-[12.5px] text-slate-600 shadow-inner sm:px-4 sm:py-3 sm:text-[14px] md:text-[16px]">
                          <div className="flex items-center justify-between gap-2 sm:block">
                            <span>
                              {personCount} Person{personCount > 1 ? "s" : ""}
                            </span>
                            <span className="font-semibold text-slate-800 sm:mt-0.5 sm:block">
                              Per Person {formatCurrency(perPersonAmount)}
                            </span>
                          </div>
                          {invoice.tokenId ? (
                            <div className="mt-1.5 truncate text-[10.5px] text-slate-500 sm:text-[12px] md:text-[14px]">
                              Visit ID: {formatVisitId(invoice.tokenCode, invoice.tokenId)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Selected row card */}
                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-emerald-100", "to-emerald-50", "text-emerald-600")}>
                        <FiShoppingBag size={17} />
                      </span>
                      <h3 className="text-[17px] font-bold text-slate-900 sm:text-[23px]">Selected row card</h3>
                    </div>

                    {selectedItem ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl bg-gradient-to-br from-blue-50/70 to-sky-50/40 px-3.5 py-3.5 shadow-inner sm:px-4 sm:py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-[15px] font-semibold text-slate-900 sm:text-[18px]">{selectedItem.name}</div>
                            <div className="text-right">
                              <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-slate-400 sm:text-[16px]">Amount</div>
                              <div className="mt-0.5 text-[15px] font-bold text-slate-900 sm:text-[18px]">
                                {formatCurrency(Number(selectedItem.qty || 0) * Number(selectedItem.rate || 0))}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm sm:px-3.5 sm:py-3">
                              <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-slate-400 sm:text-[16px]">Qty</div>
                              <div className="mt-0.5 text-[15px] font-bold text-slate-900 sm:text-[17px]">{selectedItem.qty}</div>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-2.5 shadow-sm sm:px-3.5 sm:py-3">
                              <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-slate-400 sm:text-[16px]">Rate</div>
                              <div className="mt-0.5 text-[15px] font-bold text-slate-900 sm:text-[17px]">{formatCurrency(selectedItem.rate)}</div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-blue-100 bg-white px-3.5 py-3.5 text-[14px] font-medium text-slate-900 sm:px-4 sm:py-4 sm:text-[17px]">
                          <div className="flex justify-between py-1.5"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
                          <div className="flex justify-between py-1.5"><span>SGST (2.5%)</span><span>{formatCurrency(Number(invoice?.gst || 0) / 2)}</span></div>
                          <div className="flex justify-between py-1.5"><span>CGST (2.5%)</span><span>{formatCurrency(Number(invoice?.gst || 0) / 2)}</span></div>
                          <div className="flex items-center justify-between py-1.5 gap-2">
                            <span>Ser.Charges on Food @5.00%</span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={serviceCharge}
                                onChange={(e) => handleServiceChargeChange(e.target.value)}
                                className="w-20 rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-0.5 text-right text-[13px] font-bold text-slate-900 outline-none focus:border-blue-400 sm:w-24 sm:text-[15px]"
                              />
                              <button
                                type="button"
                                role="switch"
                                aria-checked={Number(serviceCharge || 0) > 0}
                                onClick={handleToggleServiceCharge}
                                title={Number(serviceCharge || 0) > 0 ? "Click to remove 5% service charge" : "Click to add 5% service charge on food bill"}
                                className={`whitespace-nowrap rounded-lg border px-2 py-0.5 text-[11px] font-bold transition active:scale-95 sm:px-2.5 sm:text-[12px] ${
                                  Number(serviceCharge || 0) > 0
                                    ? "border-emerald-500 bg-emerald-500 text-white shadow-sm hover:bg-emerald-600"
                                    : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                }`}
                              >
                                {Number(serviceCharge || 0) > 0 ? "ON · 5%" : "OFF · +5%"}
                              </button>
                            </div>
                          </div>
                          <div className="flex justify-between py-1.5"><span>Discount</span><span>{formatCurrency(discountAmount)}</span></div>
                          <div className="flex justify-between py-1.5"><span>Per Person</span><span>{formatCurrency(perPersonAmount)}</span></div>
                          <div className="mt-1 flex justify-between border-t border-blue-100 pt-2.5 text-[16px] font-bold sm:text-[19px]">
                            <span>Total</span><span className="text-blue-700">{formatCurrency(computedTotal)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl bg-blue-50/40 px-4 py-6 text-center text-[16px] text-slate-500 sm:text-[20px]">
                        Koi row select nahi hai
                      </div>
                    )}
                  </div>

                  {/* Customer card */}
                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-violet-100", "to-violet-50", "text-violet-600")}>
                        <FiUser size={17} />
                      </span>
                      <div className="text-[15px] font-bold uppercase tracking-[0.08em] text-slate-500 sm:text-[18px]">Customer</div>
                    </div>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(event) => handleCustomerNameChange(event.target.value)}
                      placeholder="Customer name"
                      className={`mt-4 ${inputCls(Boolean(fieldErrors.customerName))}`}
                    />
                    {fieldErrors.customerName ? (
                      <div className="mt-1.5 text-[13px] font-semibold text-rose-600 sm:text-[15px]">{fieldErrors.customerName}</div>
                    ) : null}
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => handlePhoneChange(event.target.value)}
                      placeholder="Phone number"
                      inputMode="numeric"
                      maxLength="10"
                      className={`mt-3 ${inputCls(Boolean(fieldErrors.phone))}`}
                    />
                    {fieldErrors.phone ? (
                      <div className="mt-1.5 text-[13px] font-semibold text-rose-600 sm:text-[15px]">{fieldErrors.phone}</div>
                    ) : null}
                  </div>
                </div>

                {/* ─── Order Items with Edit Controls ─────────────────────── */}
                {invoice.items?.length ? (
                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-emerald-100", "to-emerald-50", "text-emerald-600")}>
                        <FiShoppingBag size={17} />
                      </span>
                      <h3 className="text-[17px] font-bold text-slate-900 sm:text-[23px]">Order Items</h3>
                      <span className="ml-auto rounded-full bg-blue-50 px-2.5 py-0.5 text-[12px] font-bold text-blue-600">
                        {invoice.items.length} {invoice.items.length === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-left text-[14px]">
                        <thead>
                          <tr className="border-b border-blue-50 text-[12px] font-bold uppercase tracking-[0.06em] text-slate-400">
                            <th className="pb-2.5 pr-4">Item</th>
                            <th className="pb-2.5 pr-4 text-center">Qty</th>
                            <th className="pb-2.5 pr-4 text-right">Rate</th>
                            <th className="pb-2.5 pr-4 text-right">Amount</th>
                            <th className="pb-2.5 text-center w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoice.items.map((item, idx) => {
                            const lineTotal = Number(item.qty || 0) * Number(item.rate || 0);
                            return (
                              <tr key={`${item.id || item.name}-${idx}`} className="border-b border-blue-50/60 last:border-0">
                                <td className="py-3 pr-4 font-semibold text-slate-900">{item.name}</td>
                                <td className="py-3 pr-4">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleItemQtyChange(idx, Number(item.qty || 1) - 1)}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-100 bg-white text-blue-700 text-sm font-bold transition hover:bg-blue-50 active:scale-95"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      min="1"
                                      value={item.qty}
                                      onChange={(e) => handleItemQtyChange(idx, Number(e.target.value))}
                                      className="h-8 w-12 rounded-lg border border-blue-100 bg-white text-center text-[14px] font-bold text-slate-900 shadow-sm transition focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleItemQtyChange(idx, Number(item.qty || 0) + 1)}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-100 bg-white text-blue-700 text-sm font-bold transition hover:bg-blue-50 active:scale-95"
                                    >
                                      +
                                    </button>
                                  </div>
                                </td>
                                <td className="py-3 pr-4 text-right text-slate-600">{formatCurrency(item.rate)}</td>
                                <td className="py-3 pr-4 text-right font-bold text-slate-900">{formatCurrency(lineTotal)}</td>
                                <td className="py-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleItemDelete(idx)}
                                    title="Remove item"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95"
                                  >
                                    <FaTimes size={13} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {/* Payment method + Discount + Split bill — one row, 3 columns */}
                <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3 items-stretch">
                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-blue-100", "to-blue-50", "text-blue-600")}>
                        <FiCreditCard size={17} />
                      </span>
                      <div className="text-[15px] font-bold uppercase tracking-[0.08em] text-slate-500 sm:text-[18px]">Payment Method</div>
                    </div>
                    <select
                      value={paymentMethod}
                      onChange={(event) => handlePaymentMethodChange(event.target.value)}
                      className={`mt-4 ${inputCls(false)}`}
                    >
                      <option value="Cash">Cash</option>
                      <option value="Card">Card</option>
                      <option value="UPI">UPI</option>
                      {canChargeToRoom ? (
                        <option value="Charge To Room">Charge To Room</option>
                      ) : null}
                    </select>

                    {paymentMethod === "Card" ? (
                      <div className="mt-3 grid gap-3">
                        <input
                          type="text"
                          value={cardDetails.cardHolderName}
                          onChange={(event) => updateCardDetails({ cardHolderName: event.target.value })}
                          placeholder="Card holder name"
                          className={inputCls(false)}
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <select
                            value={cardDetails.cardType}
                            onChange={(event) => updateCardDetails({ cardType: event.target.value })}
                            className={inputCls(false)}
                          >
                            <option value="Credit Card">Credit Card</option>
                            <option value="Debit Card">Debit Card</option>
                            <option value="RuPay Card">RuPay Card</option>
                          </select>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength="4"
                            value={cardDetails.cardLast4}
                            onChange={(event) => updateCardDetails({ cardLast4: event.target.value.replace(/\D/g, "").slice(0, 4) })}
                            placeholder="Last 4 digits"
                            className={inputCls(false)}
                          />
                        </div>
                        <input
                          type="text"
                          value={cardDetails.transactionRef}
                          onChange={(event) => updateCardDetails({ transactionRef: event.target.value })}
                          placeholder="Transaction / approval ref"
                          className={inputCls(false)}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-amber-100", "to-amber-50", "text-amber-600")}>
                        <FiPercent size={17} />
                      </span>
                      <div className="text-[15px] font-bold uppercase tracking-[0.08em] text-slate-500 sm:text-[18px]">Discount</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountAmount}
                      onChange={(event) => handleDiscountChange(event.target.value)}
                      disabled={waiterDiscountLocked}
                      placeholder="Enter discount amount"
                      className={`mt-4 ${inputCls(false)} disabled:opacity-60`}
                    />
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-emerald-50 to-emerald-100/50 px-3.5 py-2.5 text-[14px] font-semibold text-emerald-700 shadow-inner sm:px-4 sm:py-3 sm:text-[17px]">
                      <span>-{formatCurrency(discountAmount)}</span>
                      <span>{formatCurrency(computedTotal)}</span>
                    </div>
                    {waiterDiscountLocked ? (
                      <div className="mt-2.5 text-[13px] font-semibold text-slate-500 sm:text-[16px]">
                        Waiter role par manual discount lock kiya gaya hai.
                      </div>
                    ) : null}
                  </div>

                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-blue-100", "to-sky-50", "text-blue-600")}>
                        <FiUsers size={17} />
                      </span>
                      <div className="text-[15px] font-bold uppercase tracking-[0.08em] text-slate-500 sm:text-[18px]">Split Bill (Persons)</div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={splitCount}
                        onChange={(event) => handleSplitCountChange(event.target.value)}
                        className={`sm:w-24 ${inputCls(false)}`}
                      />
                      <button
                        onClick={handleCreateSplitBill}
                        disabled={submitting || (isRoomChargeMode && !selectedChargeRoom)}
                        className="h-[50px] w-full flex-1 rounded-xl bg-gradient-to-r from-blue-900 via-blue-700 to-sky-500 px-4 text-[15px] font-bold text-white shadow-[0_10px_26px_-10px_rgba(30,64,175,0.55)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:h-[56px] sm:text-[17px]"
                      >
                        {shouldPostSplitToFolio ? "Post To Folio" : "Save Split Bill"}
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {splitPreview.map((split) => (
                        <div key={split.splitNo} className="flex items-center justify-between rounded-xl bg-blue-50/50 px-3.5 py-2 text-[14px] text-slate-700 sm:px-4 sm:py-2.5 sm:text-[16px]">
                          <span>Person {split.splitNo}</span>
                          <span className="font-bold text-slate-900">{formatCurrency(split.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isRoomChargeMode ? (
                  <div className={`${glassCard} p-4 sm:p-6`}>
                    <div className="flex items-center gap-3">
                      <span className={iconBadge("from-sky-100", "to-sky-50", "text-sky-600")}>
                        <FiHome size={17} />
                      </span>
                      <div className="text-[15px] font-bold uppercase tracking-[0.08em] text-slate-500 sm:text-[18px]">Charge To Room</div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <input
                        type="text"
                        value={roomChargeQuery}
                        onChange={(event) => setRoomChargeQuery(event.target.value)}
                        placeholder="Search room / guest / booking"
                        className={inputCls(false)}
                      />
                      <select
                        value={selectedRoomNumber}
                        onChange={(event) => handleRoomSelection(event.target.value)}
                        className={inputCls(false)}
                      >
                        <option value="">Select occupied room</option>
                        {filteredChargeableRooms.map((room) => (
                          <option key={`${room.roomNumber}-${room.bookingId || "active"}`} value={room.roomNumber}>
                            {`Room ${room.roomNumber} | ${room.guestName || "Guest"} | ${room.bookingCode || "No Code"}`}
                          </option>
                        ))}
                      </select>
                      {selectedChargeRoom ? (
                        <div className="rounded-xl bg-gradient-to-r from-sky-50 to-blue-50/60 px-3.5 py-2.5 text-[14px] font-semibold text-sky-900 shadow-inner sm:px-4 sm:py-3 sm:text-[16px]">
                          Room {selectedChargeRoom.roomNumber} | {selectedChargeRoom.guestName || "Guest"} | Booking {selectedChargeRoom.bookingCode || "--"}
                        </div>
                      ) : (
                        <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[14px] font-semibold text-amber-800 sm:px-4 sm:py-3 sm:text-[16px]">
                          Sirf occupied aur checked-in rooms ko yahan room-charge ke liye allow kiya gaya hai.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {generatedBill?.id ? (
                  <div
                    className={`rounded-2xl px-4 py-3.5 text-[14px] font-semibold shadow-sm sm:px-5 sm:py-4 sm:text-[17px] ${
                      isCurrentBillPaid
                        ? "border border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100/40 text-emerald-800"
                        : isCurrentBillPostedToRoom
                          ? "border border-sky-200 bg-gradient-to-r from-sky-50 to-sky-100/40 text-sky-800"
                          : "border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-100/40 text-amber-800"
                    }`}
                  >
                    Bill #{generatedBill.id} {isCurrentBillPaid ? "payment already done" : isCurrentBillPostedToRoom ? "room folio me posted hai" : "pending"}.
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                  <button
                    type="button"
                    onClick={handlePayment}
                    disabled={submitting || hasCustomerValidationErrors || isCurrentBillPaid || isCurrentBillPostedToRoom}
                    className="h-[50px] w-full rounded-xl bg-gradient-to-r from-emerald-600 to-green-500 px-6 text-[15px] font-bold text-white shadow-[0_12px_28px_-10px_rgba(16,185,129,0.55)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-10px_rgba(16,185,129,0.65)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:h-[54px] sm:w-auto sm:min-w-[190px] sm:text-[17px]"
                  >
                    {submitting
                      ? "Processing..."
                      : isCurrentBillPaid
                        ? "Payment Already Done"
                        : isCurrentBillPostedToRoom
                          ? "Already Posted To Room"
                          : isRoomChargeMode
                            ? "Post To Room Folio"
                            : generatedBill?.id
                              ? "Pay Now"
                              : "Pay Now & Save Bill"}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className={`sm:min-w-[160px] ${secondaryBtnCls}`}
                  >
                    Print Bill
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className={`sm:min-w-[190px] ${dangerBtnCls}`}
                  >
                    Cancel Transaction
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWhatsAppModal(true)}
                    disabled={!generatedBill?.id}
                    className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-500 px-5 text-[15px] font-bold text-white shadow-[0_10px_26px_-10px_rgba(16,185,129,0.45)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:h-[54px] sm:w-auto sm:min-w-[190px] sm:text-[17px]"
                  >
                    <FaWhatsapp size={18} />
                    Send WhatsApp Invoice
                  </button>
                </div>

                {/* WhatsApp invoice modal */}
                {showWhatsAppModal ? (
                  <WhatsAppInvoiceModal
                    invoice={invoice}
                    generatedBill={generatedBill}
                    onClose={() => setShowWhatsAppModal(false)}
                    onSuccess={(result) => {
                      console.log("[WhatsApp] Invoice sent:", result);
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Payment;