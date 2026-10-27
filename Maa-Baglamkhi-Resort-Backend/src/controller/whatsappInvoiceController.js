/**
 * WhatsApp Invoice Controller
 *
 * Endpoints:
 *   POST /api/hotel/invoice/send-whatsapp/:bookingId
 *     Generates invoice PDF → sends it to customer AND admin via WhatsApp
 *
 * The admin's WhatsApp number is read from the `app_settings` table at
 * runtime (admin editable from the UI). The customer's number is read from
 * the booking's `mobile` field, which can also be edited by an admin.
 */

const Invoice = require("../models/InvoiceModel");
const WhatsAppService = require("../services/whatsappService");
const InvoicePdfService = require("../services/invoicePdfService");
const UserModel = require("../models/UsersModel");
const db = require("../config/db");

/**
 * Resolve the public base URL for serving invoice PDFs.
 */
const getPublicBaseUrl = () => {
  const env =
    process.env.PUBLIC_BASE_URL ||
    process.env.PUBLIC_URL ||
    process.env.CLIENT_URL ||
    "";

  if (env) {
    return env.replace(/\/+$/, "");
  }

  const port = process.env.PORT || 5002;
  return `http://localhost:${port}`;
};

const round2 = (value) => Number((Number(value || 0)).toFixed(2));

/**
 * POST /api/hotel/invoice/send-whatsapp/:bookingId
 *
 * Body (optional overrides):
 *   {
 *     "customerNumber": "9876543210",
 *     "customerMessage": "Your custom message",
 *     "adminNumber": "9876543210",
 *     "adminMessage": "Your custom admin message",
 *     "sendConfirmation": true,       // <-- sends booking confirmation instead of invoice PDF
 *     "deviceToken": "...",
 *     // When provided, these fields override the DB-generated invoice so the
 *     // PDF and WhatsApp message use the SAME data the frontend is showing.
 *     "invoiceData": {
 *       "invoiceNo": "...",
 *       "totalAmount": 5000,
 *       "subtotal": 4761.90,
 *       "tax": 238.10,
 *       "discount": 0,
 *       "paymentStatus": "Pending",
 *       "paymentMode": "Cash",
 *       "customerName": "Guest Name",
 *       "phone": "...",
 *       "items": [{name, price, quantity, total}, ...]
 *     }
 *   }
 */
exports.sendInvoiceWhatsApp = async (req, res) => {
  try {
    const bookingId =
      Number(req.params.bookingId) || Number(req.body?.bookingId);
    if (!bookingId) {
      return res.status(400).json({ error: "Valid booking ID is required" });
    }

    const sendConfirmation = req.body?.sendConfirmation === true;

    if (sendConfirmation) {
      // ─── Booking Confirmation Mode (text message, no PDF) ───
      const bookingRow = await new Promise((resolve, reject) => {
        db.query(
          "SELECT * FROM bookings WHERE id = ?",
          [bookingId],
          (err, rows) => (err ? reject(err) : resolve(rows?.[0] || null)),
        );
      });

      if (!bookingRow) {
        return res.status(404).json({ error: "Booking not found" });
      }

      // Fetch advance payment info
      let advanceAmount = 0;
      try {
        const advanceRows = await new Promise((resolve, reject) => {
          db.query(
            "SELECT amount FROM advance_payment WHERE booking_id = ? LIMIT 1",
            [bookingId],
            (err, rows) => (err ? reject(err) : resolve(rows)),
          );
        });
        if (advanceRows.length) {
          advanceAmount = Number(advanceRows[0].amount || 0);
        }
      } catch {
        // advance_payment table may not exist; continue
      }

      // Map DB columns to the booking object shape expected by buildBookingDetailsBlock
      const booking = {
        ...bookingRow,
        roomCategory: bookingRow.room_category || bookingRow.roomType || "",
        noOfRooms: bookingRow.no_of_rooms || 1,
        guestCapacity: bookingRow.guest_capacity || "",
        advanceAmount,
        paidAmount: advanceAmount,
        totalAmount: Number(bookingRow.total_amount || bookingRow.total || 0),
        confirmedBy: "",
      };

      // Override with frontend-provided data if available
      if (req.body?.invoiceData && typeof req.body.invoiceData === "object") {
        const fd = req.body.invoiceData;
        if (fd.customerName) booking.guestName = fd.customerName;
        if (fd.totalAmount !== undefined) booking.totalAmount = Number(fd.totalAmount);
        if (fd.roomCategory) booking.roomCategory = fd.roomCategory;
        if (fd.paymentStatus) booking.paymentStatus = fd.paymentStatus;
        if (fd.paymentMode) booking.paymentMode = fd.paymentMode;
        if (fd.advancePaid !== undefined) booking.advanceAmount = Number(fd.advancePaid);
        if (fd.balanceLeft !== undefined) booking.balanceLeft = Number(fd.balanceLeft);
        if (fd.checkIn) booking.checkIn = fd.checkIn;
        if (fd.checkOut) booking.checkOut = fd.checkOut;
        if (fd.arrival) booking.arrival = fd.arrival;
        if (fd.departure) booking.departure = fd.departure;
        if (fd.numRooms !== undefined) booking.noOfRooms = Number(fd.numRooms);
        if (fd.bookingType) booking.bookingType = fd.bookingType;
        if (fd.confirmedBy) booking.confirmedBy = fd.confirmedBy;
      }

      // Resolve customer number
      let customerNumber = req.body?.customerNumber || booking.phone || booking.mobileNumber || "";

      // Build booking confirmation message
      const guestName = booking.guestName || "Valued Guest";
      const bookingNo = booking.bookingNo || booking.booking_code || `#${bookingId}`;
      const checkIn = booking.checkIn ? formatDateShort(booking.checkIn) : "";
      const checkOut = booking.checkOut ? formatDateShort(booking.checkOut) : "";
      const roomType = booking.roomCategory || booking.roomType || "";
      const total = Number(booking.totalAmount || 0);
      const advance = Number(booking.advanceAmount || booking.paidAmount || 0);
      const balance = Math.max(Number(booking.balanceLeft !== undefined ? booking.balanceLeft : total - advance), 0);
      const numRooms = Number(booking.noOfRooms || 1);
      const arrival = booking.arrival || "12:00";
      const departure = booking.departure || "11:00";
      const stayNights = (() => {
        if (!booking.checkIn || !booking.checkOut) return 1;
        const a = new Date(booking.checkIn);
        const b = new Date(booking.checkOut);
        const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff : 1;
      })();

      const formattedAdvance = advance > 0 ? `₹ ${advance.toFixed(0)}` : "₹ 0";
      const formattedBalance = balance > 0 ? `₹ ${balance.toFixed(0)}` : "₹ 0";
      const formattedTotal = total > 0 ? `₹ ${total.toFixed(0)}` : "—";
      const confirmedByName = booking.confirmedBy || "";
      const rawBookingType = booking.bookingType || "";
      const bookingTypeMap = { "walk-in": "Walk-in", via: "Via", online: "Online" };
      const bookingTypeStr = bookingTypeMap[rawBookingType.trim().toLowerCase()] || rawBookingType || "Walk-in";

      const message =
        `🏨 *MAA BAGLAMUKHI RESORT*\n` +
        `📍 Nalkheda\n\n` +
        `✅ *BOOKING CONFIRMED*\n\n` +
        `Dear *${guestName}*,\n` +
        `Thank you for choosing Maa Baglamukhi Resort. Your booking has been confirmed.\n\n` +
        `📋 *Booking Details:*\n` +
        `• Booking No: *${bookingNo}*\n` +
        `• Guest Name: ${guestName}\n` +
        `• Mobile: ${customerNumber || "—"}\n` +
        `• Booking Confirmed By: *${confirmedByName}*\n\n` +
        `🏠 *Room Details:*\n` +
        `• Room Type: *${roomType || "—"}*\n` +
        `• Number of Rooms: ${numRooms}\n` +
        `• Booking Type: ${bookingTypeStr}\n\n` +
        `📅 *Stay Details:*\n` +
        `• Check-In Date: *${checkIn || "—"}*\n` +
        `• Check-In Time: ${arrival}\n` +
        `• Check-Out Date: *${checkOut || "—"}*\n` +
        `• Check-Out Time: ${departure}\n` +
        `• Total Nights: ${stayNights}\n\n` +
        `💰 *Payment Summary:*\n` +
        `• Total Amount: *${formattedTotal}*\n` +
        `• Advance Paid: *${formattedAdvance}*\n` +
        `• Balance Due: *${formattedBalance}*\n` +
        `• Payment Mode: ${booking.paymentMode || "—"}\n\n` +
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
        `Guest: ${guestName}\n` +
        `Phone: ${customerNumber}\n` +
        `Room: ${roomType || "—"}\n` +
        `Rooms: ${numRooms}\n` +
        `Confirmed By: ${confirmedByName}\n` +
        `Check-in: ${checkIn || "—"} at ${arrival}\n` +
        `Check-out: ${checkOut || "—"} at ${departure}\n` +
        `Total: ${formattedTotal}\n` +
        `Advance: ${formattedAdvance}\n` +
        `Balance: ${formattedBalance}\n` +
        `Mode: ${booking.paymentMode || "—"}`;

      // Resolve admin number
      let adminNumber = req.body?.adminNumber || "";
      if (!adminNumber) {
        try {
          const adminRow = await new Promise((resolve, reject) => {
            UserModel.findAdminWithPhone((err, row) => (err ? reject(err) : resolve(row)));
          });
          adminNumber = adminRow?.phone || "";
        } catch { /* ignore */ }
      }
      if (!adminNumber && process.env.ADMIN_WHATSAPP_NUMBER) {
        adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
      }

      const result = await WhatsAppService.sendBookingConfirmation(
        { ...booking, guestName, bookingNo },
        {
          customerNumber,
          adminNumber,
          customerMessage: req.body?.customerMessage || message,
          adminMessage: adminMessage,
        },
      );

      const customerWaOk = result?.customer?.whatsapp?.ok || result?.customer?.whatsapp?.skipped;
      const customerSmsOk = result?.customer?.sms?.ok || result?.customer?.sms?.skipped;
      const adminWaOk = !result?.admin?.whatsapp || result.admin.whatsapp.ok || result.admin.whatsapp.skipped;
      const adminSmsOk = !result?.admin?.sms || result.admin.sms.ok || result.admin.sms.skipped;
      const allOk = customerWaOk && customerSmsOk && adminWaOk && adminSmsOk;

      return res.status(allOk ? 200 : 207).json({
        message: allOk
          ? "Booking confirmation sent to customer and admin via WhatsApp + SMS"
          : "Booking confirmation sent with some failures",
        bookingId,
        bookingNo,
        customer: { number: customerNumber, whatsapp: result?.customer?.whatsapp, sms: result?.customer?.sms },
        admin: { number: adminNumber || "", whatsapp: result?.admin?.whatsapp, sms: result?.admin?.sms },
      });
    }

    // ─── Default: Invoice PDF Mode (existing behavior) ───
    let invoice;
    try {
      const existing = await Invoice.getInvoiceByBookingId(bookingId);
      if (existing) {
        invoice = existing;
      }
    } catch { /* not found, will generate below */ }

    if (!invoice) {
      invoice = await Invoice.generateCustomerInvoice(bookingId);
    }
    if (!invoice) {
      return res.status(404).json({ error: "Booking or invoice not found" });
    }

    // If the frontend sent computed invoiceData, use it to override the
    // DB-generated values so the PDF and WhatsApp message match what the
    // user sees on screen.
    if (req.body?.invoiceData && typeof req.body.invoiceData === "object") {
      const fd = req.body.invoiceData;
      if (fd.invoiceNo) invoice.invoiceNo = fd.invoiceNo;
      if (fd.totalAmount !== undefined) invoice.totalAmount = Number(fd.totalAmount);
      if (fd.subtotal !== undefined) invoice.subtotal = Number(fd.subtotal);
      if (fd.tax !== undefined) invoice.tax = Number(fd.tax);
      if (fd.discount !== undefined) invoice.discount = Number(fd.discount);
      if (fd.paymentStatus) invoice.paymentStatus = fd.paymentStatus;
      if (fd.paymentMode) invoice.paymentMode = fd.paymentMode;
      if (fd.customerName) invoice.customerName = fd.customerName;
      if (fd.phone) invoice.phone = fd.phone;
      if (fd.roomNumber) invoice.roomNumber = fd.roomNumber;
      if (fd.checkIn) invoice.checkIn = fd.checkIn;
      if (fd.checkOut) invoice.checkOut = fd.checkOut;
      if (fd.address) invoice.address = fd.address;
      if (fd.items && Array.isArray(fd.items)) invoice.items = fd.items;
      if (fd.roomCharge !== undefined) invoice.roomCharge = Number(fd.roomCharge);
      if (fd.foodCharge !== undefined) invoice.foodCharge = Number(fd.foodCharge);
      if (fd.extraCharge !== undefined) invoice.extraCharge = Number(fd.extraCharge);
      console.log("[send-whatsapp] Applied frontend invoiceData overrides:", {
        invoiceNo: invoice.invoiceNo,
        totalAmount: invoice.totalAmount,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        itemsCount: invoice.items?.length || 0,
      });
    }

    // 1b. Fetch advance payment info to calculate remaining amount correctly
    let advanceAmount = 0;
    let advanceDiscount = 0;
    try {
      const advanceRows = await new Promise((resolve, reject) => {
        db.query("SELECT amount, discount_amount FROM advance_payment WHERE booking_id = ? LIMIT 1", [bookingId], (err, rows) => (err ? reject(err) : resolve(rows)));
      });
      if (advanceRows.length) {
        advanceAmount = Number(advanceRows[0].amount || 0);
        advanceDiscount = Number(advanceRows[0].discount_amount || 0);
      }
    } catch {
      // advance_payment table may not exist; continue without advance info
    }

    // 1c. Fetch folio totals for accurate remaining calculation, and the
    // "Extra Charge" total specifically (this is what the Booking Details
    // page's "Folio Charges" figure and the WhatsApp message below show).
    let folioPayments = 0;
    let folioDiscounts = 0;
    let folioChargesTotal = 0;
    try {
      const FolioModel = require("../models/folioModel");
      const folioTotals = await FolioModel.getFolioTotals(bookingId);
      folioPayments = Number(folioTotals.payments || 0);
      folioDiscounts = Number(folioTotals.discounts || 0);
      const extraRows = await new Promise((resolve, reject) => {
        db.query(
          "SELECT COALESCE(SUM(amount), 0) AS total FROM hotel_folio_entries WHERE booking_id = ? AND entry_type = 'Extra Charge'",
          [bookingId],
          (err, rows) => (err ? reject(err) : resolve(rows)),
        );
      });
      folioChargesTotal = Number(extraRows?.[0]?.total || 0);
    } catch {
      // folio table may not exist; continue
    }

    // 🐛 FIX: `invoice.bookingId` was never set, so the WhatsApp message
    // template's "New invoice generated for booking {invoiceNo}." printed a
    // bare "booking #." whenever `invoice.invoiceNo` was also empty (the
    // `#${invoice.bookingId || ...}` fallback had nothing to fall back to).
    // 🐛 FIX: `invoice.bookingId` / `invoice.invoiceNo` could come back empty
    // when an existing invoice row was reused (the underlying mapping bug is
    // fixed in InvoiceModel.parseInvoiceRow, but these fallbacks make sure
    // "Invoice No." and "Folio No." on the PDF/WhatsApp message are never
    // blank even in edge cases).
    invoice.bookingId = invoice.bookingId || bookingId;
    invoice.invoiceNo =
      invoice.invoiceNo ||
      `HOTINV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(bookingId).padStart(4, "0")}`;
    // Also attach the folio charges total so the WhatsApp message text can
    // include it alongside advance paid / balance due (previously the text
    // message only showed Total/Tax/Status, none of which reflected the
    // advance payment or folio charges shown on the Booking Details page).
    invoice.folioCharges = folioChargesTotal;

    // Remaining = total amount - (advance paid + folio payments + advance discount + folio discount)
    const totalPaid = advanceAmount + folioPayments + advanceDiscount + folioDiscounts;
    const remainingAmount = round2(Number(invoice.totalAmount || 0) - totalPaid);
    const isPaid = remainingAmount <= 0;
    const paymentStatus = isPaid ? "Paid" : "Pending";
    const paymentMethod = invoice.paymentMode || "Cash";

    // 🐛 FIX: `totalPaid` / `remainingAmount` were being calculated above but
    // never attached to `invoice` before it was handed to the PDF service.
    // That's why the generated PDF's "Payment Detail" block always printed
    // the FULL total as "paid" and hardcoded "Balance" to 0.00 — a booking
    // with only a partial advance (e.g. ₹500 of ₹2,000 paid) looked fully
    // settled on the invoice even though ₹1,500 was still due.
    invoice.paidAmount = round2(totalPaid);
    invoice.remainingAmount = remainingAmount;
    invoice.paymentStatus = paymentStatus;

    // 2. Generate the PDF — best-effort only. WhatsApp delivery is
    // text-only (the message body carries the full invoice breakdown), so
    // a PDF failure or a missing/changed ngrok PUBLIC_BASE_URL must never
    // block the message from being sent.
    let pdfResult;
    try {
      pdfResult = await InvoicePdfService.generateInvoicePdf(invoice);
    } catch (pdfErr) {
      console.error("Invoice PDF generation failed (message still sends):", pdfErr.message);
    }

    // 3. Public file URL (informational — not used for WhatsApp delivery).
    const publicBase = getPublicBaseUrl();
    const fileUrl = pdfResult ? `${publicBase}/uploads/invoices/${pdfResult.fileName}` : null;
    // 3a. Resolve admin number: request body → DB lookup (prefer admin WITH phone) → env fallback → empty
    let adminNumber = req.body?.adminNumber || "";
    console.log("[send-whatsapp] adminNumber from request body:", adminNumber || "(empty)");
    if (!adminNumber) {
      try {
        const adminRow = await new Promise((resolve, reject) => {
          UserModel.findAdminWithPhone((err, row) => (err ? reject(err) : resolve(row)));
        });
        adminNumber = adminRow?.phone || "";
        console.log("[send-whatsapp] adminNumber from DB:", adminNumber || "(empty — no admin has phone set)", "adminId:", adminRow?.id || "null");
      } catch (err) {
        console.error("[send-whatsapp] DB lookup for admin phone failed:", err.message);
      }
    } else {
      console.log("[send-whatsapp] Using admin number from request body:", adminNumber);
    }

    // Last-resort fallback: env-defined ADMIN_WHATSAPP_NUMBER so the admin
    // still receives the invoice even if no one has filled Profile yet.
    if (!adminNumber && process.env.ADMIN_WHATSAPP_NUMBER) {
      adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
      console.log("[send-whatsapp] using ADMIN_WHATSAPP_NUMBER from env:", adminNumber);
    }
    console.log("[send-whatsapp] Final adminNumber passed to service:", adminNumber || "(empty)");

    // 4. Use the high-level helper to send to customer + admin (WhatsApp + SMS).
    // Text-only by design: no PDF attachment, no ngrok dependency — the
    // message body carries the full invoice breakdown. (The `attachment`
    // slot is accepted for signature compatibility but intentionally unused.)
    const { customer, admin } = await WhatsAppService.sendInvoiceNotifications(
      invoice,
      null,
      {
        customerNumber: req.body?.customerNumber,
        adminNumber,
        customerMessage: req.body?.customerMessage,
        adminMessage: req.body?.adminMessage,
      },
    );

    // New shape: {customer:{whatsapp, sms}, admin:{whatsapp, sms}}
    const customerWaOk = customer?.whatsapp?.ok || customer?.whatsapp?.skipped;
    const customerSmsOk = customer?.sms?.ok || customer?.sms?.skipped;
    const adminWaOk = !admin?.whatsapp || admin.whatsapp.ok || admin.whatsapp.skipped;
    const adminSmsOk = !admin?.sms || admin.sms.ok || admin.sms.skipped;

    const allOk =
      customerWaOk && customerSmsOk && adminWaOk && adminSmsOk;

    const statusCode = allOk ? 200 : 207;

    res.status(statusCode).json({
      message: allOk
        ? "Invoice sent to customer and admin via WhatsApp + SMS"
        : "Invoice sent with some failures (check individual channel results)",
      bookingId,
      invoiceNo: invoice.invoiceNo,
      customer: {
        number: WhatsAppService.normalizePhoneNumber(invoice.phone),
        whatsapp: customer?.whatsapp,
        sms: customer?.sms,
      },
      admin: {
        number: adminNumber || "",
        whatsapp: admin?.whatsapp,
        sms: admin?.sms,
      },
      fileUrl,
    });
  } catch (error) {
    console.error("sendInvoiceWhatsApp error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to send WhatsApp invoice" });
  }
};
