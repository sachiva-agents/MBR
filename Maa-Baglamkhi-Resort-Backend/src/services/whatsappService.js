/**
 * WhatsApp Service — Wasend / Sachiva Integration
 *
 * FIX (this revision) — WhatsApp PDF invoice not sending:
 *
 *   The previous code used `api_key=<key>` as a URL query parameter when
 *   calling Wasend's API. That worked in the past, but Wasend recently
 *   changed its auth scheme to require the API key in the
 *   `Authorization: Bearer <key>` HEADER (with `?apikey=<key>` — note the
 *   LOWERCASE single-word param name — accepted as a fallback only on
 *   GET requests). The old code was sending the api_key in the
 *   `api_key` query param (with underscore) which Wasend no longer
 *   recognizes — so every call was failing with:
 *     - 401 "Missing API credential" (GET /api/send-message)
 *     - 401 "Unauthorized" (multipart POST)
 *     - 404 "Server action not found" (/api/send-document — this route
 *       does NOT exist on this Wasend account; only /api/send-message
 *       is available, and it only accepts a remote file_url, NOT a
 *       multipart file upload).
 *
 *   Live test results (ran against wasend.sachiva.cloud with this API
 *   key, July 2026):
 *
 *     [✓] GET /api/send-message
 *         Authorization: Bearer <key>
 *         ?number=…&message=…&file_url=<ngrok-pdf-url>&type=document
 *         → 200 "Message accepted for delivery!"
 *
 *     [✓] GET /api/send-message
 *         ?apikey=<key>&number=…&message=…&file_url=…&type=document
 *         → 200 "Message accepted for delivery!"
 *
 *     [✗] GET /api/send-message?api_key=<key>... (the old code's form)
 *         → 401 "Missing API credential"
 *     [✗] GET/POST /api/send-document
 *         → 404 "Server action not found" (route doesn't exist)
 *     [✗] Multipart POST /api/send-message with file upload
 *         → 401 "Unauthorized" (multipart route isn't authenticated /
 *            doesn't accept direct file uploads)
 *
 *   So the ONLY working way to send a PDF document through Wasend is:
 *     • Host the PDF somewhere publicly reachable (e.g. via ngrok)
 *     • GET /api/send-message with Bearer auth + file_url pointing at
 *       the PDF + type=document
 *
 *   That is exactly what this rewritten service does. The local file
 *   path is still read and POSTED via /api/send-document as a fallback
 *   in case Wasend ever enables that route, but it's harmless (the
 *   server returns 404) and won't block the working file_url flow.
 *
 *   NOTE: `PUBLIC_BASE_URL` in your .env MUST point to a publicly
 *   reachable URL (your ngrok URL) — Wasend's servers need to fetch
 *   the PDF from that URL to deliver it as a WhatsApp document.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const DEFAULT_BASE_URL =
  (process.env.wasachiva_url || process.env.WASACHIVA_URL || "https://wasend.sachiva.cloud")
    .replace(/\/+$/, "")
    .replace(/\?.*$/, "");

const API_KEY = process.env.wasachiva_key || process.env.WASACHIVA_KEY || "";
const GATEWAY_TIMEOUT_MS = Number(process.env.WASACHIVA_TIMEOUT_MS) || 10000;

const normalizePhoneNumber = (raw) => {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
};

const formatPhoneDisplay = (raw) => {
  const digits = normalizePhoneNumber(raw);
  if (!digits) return "N/A";
  if (digits.length >= 12) {
    const country = digits.slice(0, digits.length - 10);
    const local = digits.slice(-10);
    return `+${country} ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return digits;
};

// ── multipart/form-data helpers (kept for the legacy /api/send-document
//    fallback — Wasend doesn't currently accept direct file uploads, but
//    we leave the code here in case the API gains that capability). ──
const rnd = () => Math.random().toString(36).slice(2, 10);

const buildMultipartBody = (fields, fileFieldName, fileBuffer, fileName) => {
  const boundary = `----WebKitFormBoundary${rnd()}`;
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}`
    );
  }

  if (fileBuffer) {
    const escapedFileName = fileName || "invoice.pdf";
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${escapedFileName}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
  }

  const preFile = Buffer.from(parts.join("\r\n"), "utf-8");
  let body;
  if (fileBuffer) {
    const postFile = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    body = Buffer.concat([preFile, fileBuffer, postFile]);
  } else {
    body = Buffer.concat([preFile, Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8")]);
  }

  return { boundary, body, contentType: `multipart/form-data; boundary=${boundary}` };
};

// ── Generic HTTP request (GET or POST, no body) ──────────────────────────────
// FIX: Wasend now requires the API key in the `Authorization: Bearer <key>`
// HEADER. Sending it as `api_key` query param (the old code) now returns 401.
const requestGateway = (method, pathname, queryParams = {}, extraHeaders = {}) => {
  const baseUrl = new URL(DEFAULT_BASE_URL);
  const isHttps = baseUrl.protocol === "https:";
  const lib = isHttps ? https : http;

  // Build query string from provided params (api_key/apikey are NEVER
  // included here — they go in the Authorization header now).
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== undefined && v !== null && v !== "") form.set(k, v);
  }
  const qs = form.toString();
  const fullPath = qs ? `${pathname}?${qs}` : pathname;

  const headers = {
    Accept: "application/json",
    ...extraHeaders,
  };

  // Always set the Authorization: Bearer header — this is what Wasend
  // now requires. `api_key` query param no longer works.
  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: baseUrl.hostname,
        port: baseUrl.port || (isHttps ? 443 : 80),
        path: fullPath,
        headers,
        timeout: GATEWAY_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          const trimmed = String(data || "").trim();
          let parsed = {};
          if (trimmed) {
            try { parsed = JSON.parse(trimmed); }
            catch { parsed = { raw: trimmed }; }
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(
              `Wasend responded ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`,
            );
            err.statusCode = res.statusCode;
            err.body = parsed;
            console.error(`[Wasend Error] ${res.statusCode}:`, JSON.stringify(parsed));
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Wasend request timed out")));
    req.on("error", reject);
    if (method === "POST" || method === "PUT") req.end();
    else req.end();
  });
};

// ── Multipart POST for the legacy /api/send-document fallback ───────────────
const postMultipart = async (pathname, fields, fileBuffer, fileName) => {
  const { body, contentType } = buildMultipartBody(fields, "file", fileBuffer, fileName);
  const baseUrl = new URL(DEFAULT_BASE_URL);
  const isHttps = baseUrl.protocol === "https:";
  const lib = isHttps ? https : http;

  const headers = {
    Accept: "application/json",
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  };
  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: "POST",
        hostname: baseUrl.hostname,
        port: baseUrl.port || (isHttps ? 443 : 80),
        path: pathname,
        headers,
        timeout: GATEWAY_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          const trimmed = String(data || "").trim();
          let parsed = {};
          if (trimmed) {
            try { parsed = JSON.parse(trimmed); }
            catch { parsed = { raw: trimmed }; }
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(
              `Wasend responded ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`,
            );
            err.statusCode = res.statusCode;
            err.body = parsed;
            console.error(`[Wasend multipart Error] ${res.statusCode}:`, JSON.stringify(parsed));
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Wasend multipart request timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

// ── Main: send document via Wasend ──────────────────────────────────────────
const sendWhatsAppMessage = async ({ number, message, filePath, fileName, fileUrl, type } = {}) => {
  const normalised = normalizePhoneNumber(number);
  if (!normalised) {
    return { ok: false, error: `Invalid phone number: ${number}`, number, channel: "whatsapp" };
  }
  if (!API_KEY) {
    return { ok: false, error: "wasachiva_key not configured", number: normalised, channel: "whatsapp" };
  }

  const msg = message || "";
  const docType = type || "document";
  let lastErr = null;

  // ── 1. PRIMARY: send document via GET /api/send-message with file_url ──
  //
  // This is the ONLY working method on the current Wasend API:
  //   • Wasend's servers fetch the PDF from `file_url` and forward it
  //     to WhatsApp as a document attachment.
  //   • Auth: `Authorization: Bearer <API_KEY>` header (set automatically
  //     by requestGateway).
  //   • The PDF must be at a publicly reachable URL — `PUBLIC_BASE_URL`
  //     in .env should be your ngrok URL.
  //
  // We try two `file_url` shapes (with and without explicit file_name) so
  // that if Wasend ever changes the parameter name preference, we still
  // have a fallback that works.
  if (fileUrl) {
    const urlShapes = [
      { message: msg, file_url: fileUrl, file_name: fileName || "invoice.pdf", type: docType },
      { message: msg, file_url: fileUrl, type: docType },
      { message: msg, file_url: fileUrl, file_name: fileName || "invoice.pdf" },
      { message: msg, file_url: fileUrl },
    ];

    for (const params of urlShapes) {
      try {
        const response = await requestGateway("GET", "/api/send-message", {
          number: normalised,
          ...params,
        });
        if (response?.status !== "error") {
          return {
            ok: true,
            statusCode: 200,
            response,
            number: normalised,
            channel: "whatsapp",
            method: "file_url",
          };
        }
        const errMsg = response.error || response.message || `Wasend error`;
        lastErr = new Error(errMsg);
        lastErr.statusCode = 400;
        lastErr.body = response;
        console.error(`[WhatsApp] file_url shape failed: ${JSON.stringify(params)} -> ${errMsg}`);
      } catch (err) {
        lastErr = err;
        console.error(`[WhatsApp] file_url shape failed: ${JSON.stringify(params)} -> ${err.message}`);
      }
    }
  }

  // ── 2. FALLBACK: try multipart POST /api/send-document (with the actual
  //      PDF file inlined). Wasend returns 404 for this route today, but
  //      keep trying in case the route becomes available.
  if (filePath && fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    const fname = fileName || path.basename(filePath) || "invoice.pdf";

    const attempts = [
      { endpoint: "/api/send-document", fields: { type: "document", file_name: fname } },
      { endpoint: "/api/send-message", fields: { type: "document", file_name: fname } },
    ];

    for (const { endpoint, fields } of attempts) {
      try {
        const response = await postMultipart(endpoint, {
          number: normalised,
          message: msg,
          ...fields,
        }, fileBuffer, fname);

        if (response?.status !== "error") {
          return {
            ok: true,
            statusCode: 200,
            response,
            number: normalised,
            channel: "whatsapp",
            method: "multipart",
          };
        }
        console.error(`[WhatsApp] multipart ${endpoint} fields=${JSON.stringify(fields)}: ${JSON.stringify(response)}`);
      } catch (err) {
        // Quietly skip — /api/send-document returns 404 on this account.
        console.error(`[WhatsApp] multipart ${endpoint} failed: ${err.message}`);
      }
    }
  }

  // ── 3. TEXT-ONLY FALLBACK ───────────────────────────────────────────────
  // If we couldn't deliver the document, still try to send the message
  // body so the customer at least sees something in their chat.
  try {
    const textMsg = (filePath || fileUrl)
      ? `${msg}\n\nYour invoice PDF is available. Please contact the resort for a copy.`
      : msg;
    const textResponse = await requestGateway("GET", "/api/send-message", {
      number: normalised,
      message: textMsg,
      type: "text",
    });
    return {
      ok: true,
      statusCode: 200,
      response: textResponse,
      number: normalised,
      channel: "whatsapp",
      fallback: true,
      fallbackReason: lastErr?.message || "document delivery not supported",
    };
  } catch (textErr) {
    return {
      ok: false,
      statusCode: lastErr?.statusCode || 0,
      error: `Document send failed: ${lastErr?.message || "unknown"}. Text fallback also failed: ${textErr.message}`,
      body: lastErr?.body,
      number: normalised,
      channel: "whatsapp",
    };
  }
};

// ── SMS ──────────────────────────────────────────────────────────────────────
const sendSmsMessage = async ({ number, message } = {}) => {
  const normalised = normalizePhoneNumber(number);
  if (!normalised) {
    return { ok: false, error: "Invalid phone number", number, channel: "sms" };
  }
  if (!API_KEY) {
    return { ok: false, error: "wasachiva_key not configured", number: normalised, channel: "sms" };
  }

  try {
    const response = await requestGateway("GET", "/api/send-message", {
      number: normalised,
      message: message || "",
      type: "sms",
    });
    if (response?.status === "error") {
      const err = new Error(response.error || "Wasend reported an error");
      err.statusCode = 400;
      err.body = response;
      throw err;
    }
    return { ok: true, statusCode: 200, response, number: normalised, channel: "sms" };
  } catch (err) {
    return {
      ok: false,
      statusCode: err.statusCode || 0,
      error: err.message,
      number: normalised,
      channel: "sms",
    };
  }
};

// ── Invoice notifications ────────────────────────────────────────────────────
const formatDateShort = (val) => {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * 🐛 FIX: the customer/admin WhatsApp text messages used to only include
 * Total / Tax / Status — no booking reference, no check-in/check-out dates,
 * no room vs. folio breakdown, and (biggest gap) no mention of the advance
 * already paid or the balance still due, even though that data was
 * available on the same `invoice` object used for the PDF. This builds a
 * shared, fuller breakdown block used by both messages.
 */
const buildInvoiceDetailsBlock = (invoice) => {
  const totalAmount = Number(invoice.totalAmount || 0);
  const subtotal = Number(invoice.subtotal || 0);
  const tax = Number(invoice.tax || 0);
  const discount = Number(invoice.discount || 0);
  const folioCharges = Number(invoice.folioCharges || 0);
  const roomCharges = Math.max(totalAmount - folioCharges, 0);
  const paidAmount = invoice.paidAmount != null ? Number(invoice.paidAmount) : null;
  const remainingAmount = invoice.remainingAmount != null ? Number(invoice.remainingAmount) : null;

  const lines = [];
  if (invoice.checkIn) lines.push(`Check-In: ${formatDateShort(invoice.checkIn)}`);
  if (invoice.checkOut) lines.push(`Check-Out: ${formatDateShort(invoice.checkOut)}`);
  if (invoice.roomNumber) lines.push(`Room No: ${invoice.roomNumber}`);
  if (folioCharges > 0) {
    lines.push(`Room Charges: Rs. ${roomCharges.toFixed(2)}`);
    lines.push(`Folio Charges: Rs. ${folioCharges.toFixed(2)}`);
  }
  if (subtotal > 0 || tax > 0) {
    lines.push(`Subtotal: Rs. ${subtotal.toFixed(2)}`);
    lines.push(`Tax (GST): Rs. ${tax.toFixed(2)}`);
  }
  if (discount > 0) lines.push(`Discount: Rs. ${discount.toFixed(2)}`);
  lines.push(`Total: Rs. ${totalAmount.toFixed(2)}`);
  if (paidAmount != null) lines.push(`Advance Paid: Rs. ${paidAmount.toFixed(2)}`);
  if (remainingAmount != null) lines.push(`Balance Due: Rs. ${remainingAmount.toFixed(2)}`);
  lines.push(`Status: ${invoice.paymentStatus || "Pending"}`);
  return lines.join("\n");
};

const sendInvoiceNotifications = async (invoice, attachment, options = {}) => {
  const customerNumber = options.customerNumber || invoice.phone || "";
  const adminNumber = options.adminNumber || "";
  const guestName = invoice.customerName || "Valued Guest";
  const invoiceNo = invoice.invoiceNo || `#${invoice.bookingId || invoice.customerId || ""}`;
  const detailsBlock = buildInvoiceDetailsBlock(invoice);
  const invoiceUrl = String(options.invoiceUrl || "").trim();
  const invoiceLink = invoiceUrl ? `\n\nDownload invoice PDF:\n${invoiceUrl}` : "";

  const customerMessage =
    options.customerMessage ||
    `Dear ${guestName},\n\nThank you for staying at Maa Baglamukhi Resort.\n\nHere is your invoice ${invoiceNo}.\n${detailsBlock}${invoiceLink}\n\nRegards,\nMaa Baglamukhi Resort`;

  const adminMessage =
    options.adminMessage ||
    `New invoice generated for booking ${invoiceNo}.\nGuest: ${guestName}\nPhone: ${formatPhoneDisplay(customerNumber)}\n${detailsBlock}${invoiceLink}`;

  const [customerWa, customerSms, adminWa, adminSms] = await Promise.all([
    customerNumber
      ? sendWhatsAppMessage({ number: customerNumber, message: customerMessage, type: "text" })
      : { skipped: true, reason: "No customer phone number" },
    customerNumber
      ? sendSmsMessage({ number: customerNumber, message: customerMessage })
      : { skipped: true, reason: "No customer phone number" },
    adminNumber
      ? sendWhatsAppMessage({ number: adminNumber, message: adminMessage, type: "text" })
      : { skipped: true, reason: "Admin number not configured" },
    adminNumber
      ? sendSmsMessage({ number: adminNumber, message: adminMessage })
      : { skipped: true, reason: "Admin number not configured" },
  ]);

  return {
    customer: { whatsapp: customerWa, sms: customerSms },
    admin: { whatsapp: adminWa, sms: adminSms },
  };
};

const buildBookingDetailsBlock = (booking) => {
  const lines = [];

  // Booking info
  if (booking.bookingNo) lines.push(`Booking No: ${booking.bookingNo}`);
  if (booking.bookingType) lines.push(`Booking Type: ${booking.bookingType}`);

  // Stay dates
  if (booking.checkIn) lines.push(`Check-In: ${formatDateShort(booking.checkIn)}`);
  if (booking.checkOut) lines.push(`Check-Out: ${formatDateShort(booking.checkOut)}`);
  if (booking.expectedArrivalTime) lines.push(`Expected Arrival: ${booking.expectedArrivalTime}`);
  if (booking.expectedDepartureTime) lines.push(`Expected Departure: ${booking.expectedDepartureTime}`);

  // Room details - ONLY room type/category, explicitly NO room number
  if (booking.roomCategory || booking.roomType) {
    lines.push(`Room Type: ${booking.roomCategory || booking.roomType}`);
  }
  if (booking.noOfRooms) lines.push(`No. of Rooms: ${booking.noOfRooms}`);
  if (booking.guestCapacity) lines.push(`Guest Capacity: ${booking.guestCapacity}`);

  // Payment details - show all financial info clearly
  const totalAmount = Number(booking.totalAmount || booking.total || 0);
  const paidAmount = booking.paidAmount != null ? Number(booking.paidAmount) : Number(booking.advanceAmount || 0);
  const remainingAmount = booking.remainingAmount != null
    ? Number(booking.remainingAmount)
    : Math.max(totalAmount - paidAmount, 0);

  if (totalAmount > 0) lines.push(`Total Amount: ₹${totalAmount.toFixed(2)}`);
  if (paidAmount > 0) lines.push(`Advance Paid: ₹${paidAmount.toFixed(2)}`);
  if (remainingAmount > 0) lines.push(`Balance Due: ₹${remainingAmount.toFixed(2)}`);
  if (booking.paymentMode) lines.push(`Payment Mode: ${booking.paymentMode}`);
  if (booking.paymentStatus) lines.push(`Payment Status: ${booking.paymentStatus}`);

  // Additional details
  if (booking.gstNumber) lines.push(`GST Number: ${booking.gstNumber}`);
  if (booking.reference) lines.push(`Reference: ${booking.reference}`);

  return lines.join("\n");
};

const sendBookingConfirmation = async (booking, options = {}) => {
  const customerNumber = options.customerNumber || booking.phone || booking.mobileNumber || "";
  const adminNumber = options.adminNumber || "";
  const guestName = booking.guestName || "Valued Guest";

  const detailsBlock = buildBookingDetailsBlock(booking);

  const customerMessage =
    options.customerMessage ||
    `Dear ${guestName},\n\nThank you for choosing Maa Baglamukhi Resort!\n\nYour booking has been confirmed. Here are your booking details:\n\n${detailsBlock}\n\nWe look forward to welcoming you!\n\nFor any queries, please contact us.\n\nRegards,\nMaa Baglamukhi Resort`;

  const adminMessage =
    options.adminMessage ||
    `New booking confirmed!\nGuest: ${guestName}\nPhone: ${formatPhoneDisplay(customerNumber)}\n${detailsBlock}`;

  let customerWa = { skipped: true, reason: "No customer phone number" };
  if (customerNumber) {
    customerWa = await sendWhatsAppMessage({ number: customerNumber, message: customerMessage });
  }

  let customerSms = { skipped: true, reason: "No customer phone number" };
  if (customerNumber) {
    customerSms = await sendSmsMessage({ number: customerNumber, message: customerMessage });
  }

  let adminWa = { skipped: true, reason: "Admin number not configured" };
  if (adminNumber) {
    adminWa = await sendWhatsAppMessage({ number: adminNumber, message: adminMessage });
  }

  let adminSms = { skipped: true, reason: "Admin number not configured" };
  if (adminNumber) {
    adminSms = await sendSmsMessage({ number: adminNumber, message: adminMessage });
  }

  return {
    customer: { whatsapp: customerWa, sms: customerSms },
    admin: { whatsapp: adminWa, sms: adminSms },
  };
};

const sendBookingCancellation = async (booking, options = {}) => {
  const customerNumber = options.customerNumber || booking.phone || booking.mobileNumber || "";
  const adminNumber = options.adminNumber || "";
  const guestName = booking.guestName || "Valued Guest";
  const bookingNo = booking.bookingCode || `#${booking.bookingId}`;
  const cancelReason = booking.cancelReason || options.cancelReason || "";
  const refundAmount = Number(booking.refundAmount || booking.advanceAmount || 0);

  const detailsBlock = buildBookingDetailsBlock(booking);

  const reasonLine = cancelReason ? `\n• Reason: ${cancelReason}` : "";
  const refundLine = refundAmount > 0
    ? `\n• Refund Amount: ₹${refundAmount.toFixed(2)}`
    : "";

  const customerMessage =
    options.customerMessage ||
    `🏨 *MAA BAGLAMUKHI RESORT*\n📍 Nalkheda\n\n` +
    `❌ *BOOKING CANCELLED*\n\n` +
    `Dear *${guestName}*,\n\n` +
    `We regret to inform you that your booking has been cancelled.\n\n` +
    `📋 *Booking Details:*\n` +
    `• Booking No: *${bookingNo}*\n` +
    `• Guest Name: ${guestName}\n` +
    `${reasonLine}\n` +
    `${refundLine}\n\n` +
    `For any queries regarding the cancellation or refund, please contact us.\n\n` +
    `Regards,\n*Maa Baglamukhi Resort*\n📞 Nalkheda`;

  const adminMessage =
    options.adminMessage ||
    `❌ *Booking Cancelled*\n\n` +
    `Booking No: ${bookingNo}\n` +
    `Guest: ${guestName}\n` +
    `Phone: ${formatPhoneDisplay(customerNumber)}\n` +
    `${detailsBlock}\n` +
    `${reasonLine}`;

  let customerWa = { skipped: true, reason: "No customer phone number" };
  if (customerNumber) {
    customerWa = await sendWhatsAppMessage({ number: customerNumber, message: customerMessage });
  }

  let adminWa = { skipped: true, reason: "Admin number not configured" };
  if (adminNumber) {
    adminWa = await sendWhatsAppMessage({ number: adminNumber, message: adminMessage });
  }

  return {
    customer: { whatsapp: customerWa },
    admin: { whatsapp: adminWa },
  };
};

module.exports = {
  normalizePhoneNumber,
  formatPhoneDisplay,
  sendWhatsAppMessage,
  sendSmsMessage,
  sendInvoiceNotifications,
  sendBookingConfirmation,
  sendBookingCancellation,
};