/**
 * Banquet WhatsApp Invoice Controller
 *
 * Endpoint:
 *   POST /api/banquet/invoice/send-whatsapp/:bookingId
 *
 * Flow: fetch booking -> generate banquet invoice PDF -> upload / serve publicly
 * -> resolve admin number -> send WhatsApp + SMS to customer AND admin.
 */

const WhatsAppService = require("../services/whatsappService");
const BanquetPdfService = require("../services/banquetInvoicePdfService");
const db = require("../config/db");

/**
 * Resolve the public base URL for serving PDFs.
 * Precedence (HAG-23): admin's in-app Settings value (live, no restart) →
 * PUBLIC_BASE_URL / PUBLIC_URL / CLIENT_URL env → localhost fallback.
 */
const getPublicBaseUrl = () => {
  const dbValue = require("../services/dynamicSettings").getPublicBaseUrl();
  if (dbValue) return dbValue.replace(/\/+$/, "");

  const env =
    process.env.PUBLIC_BASE_URL ||
    process.env.PUBLIC_URL ||
    process.env.CLIENT_URL ||
    "";

  if (env) return env.replace(/\/+$/, "");

  return `http://localhost:${process.env.PORT || 5002}`;
};

const formatINR = (value) => {
  const num = Number(value || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const round2 = (value) => Number((Number(value || 0)).toFixed(2));

const INR = "₹";

/**
 * Fetch a booking by ID from the DB using raw SQL.
 */
const getBookingRowById = async (id) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM banquet_bookings WHERE id = ? LIMIT 1",
      [id],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
};

const getHallName = async (hallId) => {
  try {
    const [hallColumns] = await db.query("SHOW COLUMNS FROM banquet_halls LIKE 'rate_per_hour'");
    const hallRateColumn = hallColumns.length > 0 ? "rate_per_hour" : "ratePerHour";

    const [rows] = await db.query(
      "SELECT name FROM banquet_halls WHERE id = ? LIMIT 1",
      [hallId],
    );
    if (rows[0]) return rows[0].name;
  } catch {
    // ignore
  }

  return "Banquet Hall";
};

/**
 * POST /api/banquet/invoice/send-whatsapp/:bookingId
 *
 * Body (optional overrides):
 *   {
 *     "customerNumber": "9876543210",
 *     "customerMessage": "Your custom message",
 *     "adminNumber": "9876543210",
 *     "adminMessage": "Your custom admin message"
 *   }
 */
exports.sendBanquetInvoiceWhatsApp = async (req, res) => {
  try {
    const bookingId = Number(req.params.bookingId);
    if (!bookingId || bookingId <= 0) {
      return res.status(400).json({ error: "Valid booking ID is required" });
    }

    // 1. Fetch booking
    const bookingRow = await getBookingRowById(bookingId);
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const hallName = await getHallName(bookingRow.hall_id || bookingRow.hallId);

    // 2. Build invoice payload for PDF + WhatsApp
    const hallCharge = round2(bookingRow.hall_charge || bookingRow.hallCharge || 0);
    const mealCharge = round2(bookingRow.meal_charge || bookingRow.mealCharge || 0);
    const customMenuCharge = round2(
      bookingRow.custom_menu_charge || bookingRow.customMenuCharge || 0,
    );
    const lightingCharge = round2(
      bookingRow.lighting_charge || bookingRow.lightingCharge || 0,
    );
    const eventSupportFee = round2(
      bookingRow.event_support_fee || bookingRow.eventSupportFee || 0,
    );
    const decorationFee = round2(
      bookingRow.decoration_fee || bookingRow.decorationFee || 0,
    );
    const discount = round2(bookingRow.discount || 0);
    const gstPercent = Number(bookingRow.gst_percent || bookingRow.gstPercent || 5);
    const subTotal = round2(
      bookingRow.subtotal_amount || bookingRow.subtotalAmount ||
      hallCharge + mealCharge + customMenuCharge + lightingCharge + eventSupportFee + decorationFee,
    );
    const taxableAmount = round2(Math.max(0, subTotal - discount));
    const gstAmount = round2(
      bookingRow.gst_amount || bookingRow.gstAmount ||
      Math.round((taxableAmount * gstPercent) / 100) / 100,
    );
    const grandTotal = round2(
      bookingRow.grand_total || bookingRow.grandTotal || taxableAmount + gstAmount,
    );
    const advance = round2(bookingRow.advance || 0);
    const refundAmount = round2(bookingRow.refund_amount || bookingRow.refundAmount || 0);
    const netReceived = round2(Math.max(0, advance - refundAmount));
    const balanceDue = round2(Math.max(0, grandTotal - netReceived));

    // Calculate hours from start/end time
    const startTime = bookingRow.start_time || bookingRow.startTime || "18:00";
    const endTime = bookingRow.end_time || bookingRow.endTime || "22:00";
    const [sh, sm] = String(startTime).split(":").map(Number);
    const [eh, em] = String(endTime).split(":").map(Number);
    const startMin = (sh || 0) * 60 + (sm || 0);
    const endMin = (eh || 0) * 60 + (em || 0);
    const hours = Math.max(1, Math.ceil(Math.max(0, endMin - startMin) / 60));

    const invoicePayload = {
      id: bookingRow.id,
      bookingId: bookingRow.id,
      invoiceNo: bookingRow.invoice_no || `BNQ-${String(bookingRow.id).padStart(6, "0")}`,
      customerName: bookingRow.customer_name || bookingRow.customerName || "Valued Guest",
      phone: bookingRow.phone || "",
      guestEmail: bookingRow.guest_email || bookingRow.guestEmail || "",
      eventTitle: bookingRow.event_title || bookingRow.eventTitle || "",
      eventType: bookingRow.event_type || bookingRow.eventType || "Banquet",
      guests: bookingRow.guests || 0,
      date: bookingRow.date || "",
      startTime,
      endTime,
      hallName,
      menuPackageId: bookingRow.menu_package_id || bookingRow.menuPackageId || "",
      mealSection: bookingRow.meal_section || bookingRow.mealSection || "",
      customMenuItems: bookingRow.custom_menu_items || bookingRow.customMenuItems || "",
      lightingSystem: bookingRow.lighting_system || bookingRow.lightingSystem || "",
      paymentMode: bookingRow.payment_mode || bookingRow.paymentMode || "Pending",
      paymentStatus: bookingRow.payment_status || bookingRow.paymentStatus || "Pending",
      paymentReferenceNo:
        bookingRow.payment_reference_no || bookingRow.paymentReferenceNo || "",
      hallCharge,
      mealCharge,
      customMenuCharge,
      lightingCharge,
      eventSupportFee,
      decorationFee,
      subtotalAmount: subTotal,
      discount,
      gstAmount,
      gstPercent,
      grandTotal,
      advance,
      refundAmount,
      netReceived,
      balanceDue,
      hours,
      totalAmount: grandTotal,
      paymentReferenceId:
        bookingRow.payment_reference_no || bookingRow.paymentReferenceId || "",
    };

    // 3. Generate the PDF
    let pdfResult;
    try {
      pdfResult = await BanquetPdfService.generateBanquetInvoicePdf(invoicePayload);
    } catch (pdfErr) {
      console.error("Banquet PDF generation failed:", pdfErr);
      return res.status(500).json({
        error: "Failed to generate banquet invoice PDF",
        details: pdfErr.message,
      });
    }

    // 4. Build the public file URL
    const publicBase = getPublicBaseUrl();
    const fileUrl = `${publicBase}/uploads/invoices/${pdfResult.fileName}`;

    // 5. Resolve admin number: request body -> DB lookup -> env fallback
    let adminNumber = req.body?.adminNumber || "";
    if (!adminNumber) {
      try {
        const [adminRow] = await db.query(
          "SELECT id, name, email, phone FROM register WHERE LOWER(role) = 'admin' AND phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id ASC LIMIT 1"
        );
        adminNumber = adminRow?.[0]?.phone || "";
      } catch {
        // continue without admin
      }
    }
    if (!adminNumber && process.env.ADMIN_WHATSAPP_NUMBER) {
      adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
    }

    // 6. Build messages
    const customerNumber = req.body?.customerNumber || bookingRow.phone || "";
    const guestName = invoicePayload.customerName;
    const eventLabel = bookingRow.event_title || bookingRow.event_type || "Banquet Event";
    const totalFormatted = formatINR(grandTotal);

    const defaultCustomerMessage =
      `Dear ${guestName},\n\n` +
      `Thank you for choosing Maa Baglamukhi Resort for your event.\n\n` +
      `Here is your banquet invoice #${invoicePayload.invoiceNo}.\n` +
      `Event: ${eventLabel}\n` +
      `Hall: ${hallName}\n` +
      `Date: ${invoicePayload.date || "N/A"}\n` +
      `Time: ${startTime} - ${endTime} (${hours} hr${hours !== 1 ? "s" : ""})\n` +
      `Guests: ${bookingRow.guests || 0}\n` +
      `Total Amount: ${INR} ${totalFormatted}\n` +
      `Payment Status: ${invoicePayload.paymentStatus || "Pending"}\n\n` +
      `Please find the invoice attached.\n\n` +
      `Regards,\nMaa Baglamukhi Resort`;

    const defaultAdminMessage =
      `New banquet invoice generated — #${invoicePayload.invoiceNo}.\n` +
      `Guest: ${guestName}\n` +
      `Phone: ${customerNumber || "N/A"}\n` +
      `Event: ${eventLabel}\n` +
      `Hall: ${hallName}\n` +
      `Date: ${invoicePayload.date || "N/A"}\n` +
      `Total: ${INR} ${totalFormatted}\n` +
      `Status: ${invoicePayload.paymentStatus || "Pending"}`;

    const customerMessage = req.body?.customerMessage || defaultCustomerMessage;
    const adminMessage = req.body?.adminMessage || defaultAdminMessage;

    // 7. Send via WhatsApp Service
    const invoiceForService = {
      customerName: guestName,
      phone: customerNumber,
      totalAmount: grandTotal,
      invoiceNo: invoicePayload.invoiceNo,
      paymentStatus: invoicePayload.paymentStatus || "Pending",
      paymentMethod: invoicePayload.paymentMode || "Pending",
    };

    const attachment = { fileUrl, fileName: pdfResult.fileName, filePath: pdfResult.filePath };

    let results = await WhatsAppService.sendInvoiceNotifications(
      invoiceForService,
      attachment,
      {
        customerNumber,
        adminNumber: adminNumber || undefined,
        customerMessage,
        adminMessage,
      },
    );

    // 8. Retry text-only if WhatsApp PDF delivery fails
    const whatsappFailed = (channel) =>
      channel?.whatsapp &&
      !channel.whatsapp.ok &&
      !channel.whatsapp.skipped;

    let sendMode = "pdf";
    if (whatsappFailed(results.customer) || whatsappFailed(results.admin)) {
      console.warn("[banquet-whatsapp] PDF send failed, retrying text-only");
      sendMode = "text-only";
      results = await WhatsAppService.sendInvoiceNotifications(
        invoiceForService,
        null,
        {
          customerNumber,
          adminNumber: adminNumber || undefined,
          customerMessage,
          adminMessage,
        },
      );
    }

    // 9. Determine overall status
    const customerWaOk =
      results?.customer?.whatsapp?.ok || results?.customer?.whatsapp?.skipped;
    const adminWaOk =
      !results?.admin?.whatsapp ||
      results?.admin?.whatsapp?.ok ||
      results?.admin?.whatsapp?.skipped;
    const allOk = customerWaOk && adminWaOk;

    const modeHint = sendMode === "text-only"
      ? " (text-only — PDF attachment could not be delivered)"
      : "";

    res.status(allOk ? 200 : 207).json({
      message: allOk
        ? `Banquet invoice sent to customer and admin via WhatsApp${modeHint}`
        : `Banquet invoice sent with some failures (check individual channel results)${modeHint}`,
      bookingId,
      invoiceNo: invoicePayload.invoiceNo,
      sendMode,
      fileUrl: sendMode === "pdf" ? fileUrl : null,
      customer: {
        number: customerNumber || "",
        ...results?.customer,
      },
      admin: {
        number: adminNumber || "",
        ...results?.admin,
      },
    });
  } catch (error) {
    console.error("sendBanquetInvoiceWhatsApp error:", error);
    res.status(500).json({
      error: error.message || "Failed to send banquet WhatsApp invoice",
    });
  }
};
