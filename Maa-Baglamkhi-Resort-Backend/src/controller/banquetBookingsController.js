/**
 * Booking CRUD and dashboard for the banquet module.
 */

const db = require("../config/db");
const {
  
  toNumber,
  getHallRateColumn,
  getBookingById,
  hasTimeOverlap,
  parseBanquetMeta,
  stripBanquetMeta,
  buildBanquetNotes,
  validateBookingPayload,
} = require("../utils/banquetHelpers");

const { getBanquetPricingConfig } = require("./banquetPricingController");

// ---------------------------------------------------------------------------
// Booking-specific helpers
// ---------------------------------------------------------------------------

const normalizePaymentStatus = ({ grandTotal, advance, refundAmount, explicitStatus }) => {
  const normalizedExplicit = String(explicitStatus || "").trim();
  const netReceived = Math.max(0, toNumber(advance) - toNumber(refundAmount));
  const total = Math.max(0, toNumber(grandTotal));

  if (normalizedExplicit.toLowerCase() === "refunded") return "Refunded";
  if (total > 0 && netReceived >= total) return "Paid";
  if (netReceived <= 0 && toNumber(refundAmount) > 0) return "Refunded";
  if (netReceived > 0) return "Partial";
  return normalizedExplicit || "Pending";
};

const buildFinancialSnapshot = (payload = {}, existingBooking = null) => {
  const hallCharge =
    payload.hallCharge ?? payload.hall_charge ?? existingBooking?.hall_charge ?? 0;
  const mealCharge =
    payload.mealCharge ?? payload.meal_charge ?? existingBooking?.meal_charge ?? 0;
  const customMenuCharge =
    payload.customMenuCharge ??
    payload.custom_menu_charge ??
    existingBooking?.custom_menu_charge ??
    0;
  const lightingCharge =
    payload.lightingCharge ??
    payload.lighting_charge ??
    existingBooking?.lighting_charge ??
    0;
  const eventSupportFee =
    payload.eventSupportFee ??
    payload.event_support_fee ??
    existingBooking?.event_support_fee ??
    0;
  const decorationFee =
    payload.decorationFee ?? payload.decoration_fee ?? existingBooking?.decoration_fee ?? 0;
  const discount = payload.discount ?? existingBooking?.discount ?? 0;
  const gstPercent = payload.gstPercent ?? payload.gst_percent ?? existingBooking?.gst_percent ?? 5;
  const subtotalAmount =
    payload.subtotalAmount ?? payload.subtotal_amount ?? existingBooking?.subtotal_amount ?? 0;
  const gstAmount = payload.gstAmount ?? payload.gst_amount ?? existingBooking?.gst_amount ?? 0;
  const grandTotal =
    payload.grandTotal ??
    payload.grand_total ??
    payload.totalAmount ??
    payload.total_amount ??
    existingBooking?.grand_total ??
    existingBooking?.total_amount ??
    0;
  const advance = payload.advance ?? existingBooking?.advance ?? existingBooking?.advance_paid ?? 0;
  const refundAmount =
    payload.refundAmount ?? payload.refund_amount ?? existingBooking?.refund_amount ?? 0;
  const netReceived = Math.max(0, toNumber(advance) - toNumber(refundAmount));
  const balanceDue = Math.max(0, toNumber(grandTotal) - netReceived);
  const paymentMode =
    payload.paymentMode ?? payload.payment_mode ?? existingBooking?.payment_mode ?? null;
  const paymentReferenceNo =
    payload.paymentReferenceNo ??
    payload.payment_reference_no ??
    existingBooking?.payment_reference_no ??
    null;
  const paymentStatus = normalizePaymentStatus({
    grandTotal,
    advance,
    refundAmount,
    explicitStatus: payload.paymentStatus ?? payload.payment_status ?? existingBooking?.payment_status,
  });

  return {
    hallCharge: toNumber(hallCharge),
    mealCharge: toNumber(mealCharge),
    customMenuCharge: toNumber(customMenuCharge),
    lightingCharge: toNumber(lightingCharge),
    eventSupportFee: toNumber(eventSupportFee),
    decorationFee: toNumber(decorationFee),
    discount: toNumber(discount),
    gstPercent: toNumber(gstPercent || 5),
    subtotalAmount: toNumber(subtotalAmount),
    gstAmount: toNumber(gstAmount),
    grandTotal: toNumber(grandTotal),
    advance: toNumber(advance),
    refundAmount: toNumber(refundAmount),
    netReceived,
    balanceDue,
    paymentMode,
    paymentStatus,
    paymentReferenceNo,
  };
};

const checkBookingOverlap = async ({ hallId, date, startTime, endTime, excludeId = null }) => {
  // status is an enum of inquiry|confirmed|in_progress|completed|cancelled
  const [conflicts] = await db.query(
    `
    SELECT id, start_time, end_time
    FROM banquet_bookings
    WHERE hall_id = ?
      AND event_date = ?
      AND status IN ('confirmed', 'in_progress', 'completed')
      ${excludeId ? "AND id <> ?" : ""}
    `,
    excludeId ? [hallId, date, excludeId] : [hallId, date]
  );

  return conflicts.some((row) => hasTimeOverlap(startTime, endTime, row.start_time, row.end_time));
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// GET /banquet
const getBanquetDashboard = async (req, res) => {
  try {
    const hallRateColumn = await getHallRateColumn();
    const pricingConfig = await getBanquetPricingConfig();
    const [halls] = await db.query(`
      SELECT
        id,
        name,
        COALESCE(NULLIF(capacity_max, 0), capacity_min, 200) AS capacity,
        ${hallRateColumn} AS ratePerHour,
        is_ac,
        image_url AS image,
        status
      FROM banquet_halls
      ORDER BY id DESC
    `);

    const [bookings] = await db.query(`
      SELECT
        b.id,
        b.hall_id,
        h.name AS hallName,
        b.customer_name,
        b.phone,
        b.email AS guest_email,
        b.event_title,
        b.event_type,
        b.guest_count AS guests,
        b.menu_package AS menu_package_id,
        b.meal_section,
        b.custom_menu_items,
        b.lighting_system,
        b.custom_menu_charge,
        b.lighting_charge,
        b.event_support_fee,
        b.hall_charge,
        b.meal_charge,
        b.decoration_fee,
        b.event_date AS date,
        b.start_time,
        b.end_time,
        b.discount,
        b.gst_percent,
        b.subtotal AS subtotal_amount,
        b.gst_amount,
        b.total AS grand_total,
        b.invoice_no,
        b.status,
        b.advance,
        b.balance AS balance_due,
        b.notes,
        b.payment_mode,
        b.payment_status,
        b.payment_reference_no,
        b.billed_at,
        b.created_by,
        b.created_at,
        b.updated_at,
        ${hallRateColumn} AS hallRatePerHour
      FROM banquet_bookings b
      JOIN banquet_halls h ON b.hall_id = h.id
      ORDER BY b.id DESC
      LIMIT 500
    `);

    const formattedBookings = bookings.map((b) => {
      const notesMeta = parseBanquetMeta(b.notes || "");
      const refundAmount = Math.max(
        toNumber(b.refund_amount),
        toNumber(notesMeta.refundAmount)
      );
      const advance = toNumber(b.advance);
      const balanceDue = Math.max(
        0,
        toNumber(b.grand_total) - Math.max(0, advance - refundAmount)
      );
      return {
        id: b.id,
        hallId: b.hall_id,
        hallName: b.hallName,
        customerName: b.customer_name,
        phone: b.phone,
        guestEmail: b.guest_email,
        eventTitle: b.event_title,
        eventType: b.event_type,
        guests: b.guests,
        menuPackageId: b.menu_package_id,
        mealSection: b.meal_section,
        customMenuItems: b.custom_menu_items,
        lightingSystem: b.lighting_system,
        customMenuCharge: Number(b.custom_menu_charge || 0),
        lightingCharge: Number(b.lighting_charge || 0),
        eventSupportFee: Number(b.event_support_fee || 0),
        hallCharge: Number(b.hall_charge || 0),
        mealCharge: Number(b.meal_charge || 0),
        hallRatePerHour: Number(b.hallRatePerHour || 0),
        decorationFee: Number(b.decoration_fee || 0),
        date: b.date,
        startTime: b.start_time,
        endTime: b.end_time,
        discount: Number(b.discount || 0),
        gstPercent: Number(b.gst_percent || 5),
        subtotalAmount: Number(b.subtotal_amount || 0),
        gstAmount: Number(b.gst_amount || 0),
        grandTotal: Number(b.grand_total || 0),
        invoiceNo: b.invoice_no,
        status: b.status,
        advance,
        refundAmount,
        netReceived: Math.max(0, advance - refundAmount),
        balanceDue,
        paymentMode: b.payment_mode,
        paymentStatus: b.payment_status,
        paymentReferenceNo: b.payment_reference_no,
        billedAt: b.billed_at,
        notes: stripBanquetMeta(b.notes || ""),
        pricingConfig,
      };
    });

    res.status(200).json({
      halls,
      bookings: formattedBookings,
      pricingConfig,
    });
  } catch (error) {
    console.error("getBanquetDashboard error:", error);
    res.status(500).json({ message: "Failed to load banquet data" });
  }
};

// ---------------------------------------------------------------------------
// Booking CRUD
// ---------------------------------------------------------------------------

// POST /banquet
const createBanquetBooking = async (req, res) => {
  try {
    const {
      hallId,
      customerName,
      phone,
      guestEmail,
      eventTitle,
      eventType,
      guests,
      menuPackageId,
      mealSection,
      customMenuItems,
      lightingSystem,
      customMenuCharge,
      lightingCharge,
      eventSupportFee,
      hallCharge,
      mealCharge,
      decorationFee,
      notes,
      date,
      startTime,
      endTime,
      discount,
      gstPercent,
      advance,
      subtotalAmount,
      gstAmount,
      grandTotal,
      refundAmount,
      paymentMode,
      paymentStatus,
      paymentReferenceNo,
    } = req.body;

    if (
      !validateBookingPayload({
        hallId,
        customerName,
        eventType,
        guests,
        date,
        startTime,
        endTime,
      })
    ) {
      return res.status(400).json({
        message: "Required fields missing",
      });
    }

    const [hallRows] = await db.query("SELECT id FROM banquet_halls WHERE id = ? LIMIT 1", [hallId]);
    if (!hallRows.length) {
      return res.status(400).json({ message: "Invalid hallId" });
    }

    const overlapping = await checkBookingOverlap({
      hallId,
      date,
      startTime,
      endTime,
    });

    if (overlapping) {
      return res.status(409).json({
        message: "Selected hall is already booked for the chosen time slot",
      });
    }

    const financials = buildFinancialSnapshot({
      customMenuCharge,
      lightingCharge,
      eventSupportFee,
      hallCharge,
      mealCharge,
      decorationFee,
      discount,
      gstPercent,
      subtotalAmount,
      gstAmount,
      grandTotal,
      advance,
      refundAmount,
      paymentMode,
      paymentStatus,
      paymentReferenceNo,
    });

    const [result] = await db.query(
      `
      INSERT INTO banquet_bookings (
        hall_id,
        customer_name,
        phone,
        email,
        event_title,
        event_type,
        guest_count,
        menu_package,
        meal_section,
        custom_menu_items,
        lighting_system,
        custom_menu_charge,
        lighting_charge,
        event_support_fee,
        hall_charge,
        meal_charge,
        decoration_fee,
        event_date,
        start_time,
        end_time,
        discount,
        gst_percent,
        subtotal,
        gst_amount,
        total,
        advance,
        balance,
        notes,
        status,
        payment_mode,
        payment_status,
        payment_reference_no,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        hallId,
        customerName,
        phone || "",
        guestEmail || null,
        eventTitle || "",
        eventType || null,
        Number(guests),
        menuPackageId || null,
        mealSection || null,
        customMenuItems || null,
        lightingSystem || null,
        financials.customMenuCharge,
        financials.lightingCharge,
        financials.eventSupportFee,
        financials.hallCharge,
        financials.mealCharge,
        financials.decorationFee,
        date,
        startTime,
        endTime,
        financials.discount,
        financials.gstPercent,
        financials.subtotalAmount,
        financials.gstAmount,
        financials.grandTotal,
        financials.advance,
        financials.balanceDue,
        notes || null,
        "confirmed",
        financials.paymentMode,
        financials.paymentStatus,
        financials.paymentReferenceNo,
        req.user?.id || null,
      ]
    );

    res.status(201).json({
      message: "Banquet booking created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.error("createBanquetBooking error:", error);
    res.status(500).json({ message: "Failed to create booking", error: error.message });
  }
};

// PUT /banquet/:id
const updateBanquetBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      hallId,
      customerName,
      phone,
      guestEmail,
      eventTitle,
      eventType,
      guests,
      menuPackageId,
      mealSection,
      customMenuItems,
      lightingSystem,
      customMenuCharge,
      lightingCharge,
      eventSupportFee,
      hallCharge,
      mealCharge,
      decorationFee,
      notes,
      date,
      startTime,
      endTime,
      discount,
      gstPercent,
      advance,
      subtotalAmount,
      gstAmount,
      grandTotal,
      refundAmount,
      paymentMode,
      paymentStatus,
      paymentReferenceNo,
      invoiceNo,
      status,
    } = req.body;

    // status is the inquiry|confirmed|in_progress|completed|cancelled set (stored
    // lowercase; cancelled bookings flow through /cancel, refunds through /refund).
    const STATUS_MAP = {
      inquiry: "inquiry",
      confirmed: "confirmed",
      in_progress: "in_progress",
      "in progress": "in_progress",
      inprogress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
      canceled: "cancelled",
    };
    const statusVal =
      status !== undefined && status !== null && String(status).trim() !== ""
        ? STATUS_MAP[String(status).trim().toLowerCase()]
        : undefined;
    if (status !== undefined && status !== null && String(status).trim() !== "" && !statusVal) {
      return res.status(400).json({
        message: `Invalid status. Allowed: ${Object.keys(STATUS_MAP).filter((k) => STATUS_MAP[k] === k).join(", ")}`,
      });
    }

    if (
      !validateBookingPayload({
        hallId,
        customerName,
        eventType,
        guests,
        date,
        startTime,
        endTime,
      })
    ) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    const existingBooking = await getBookingById(id);
    if (!existingBooking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const [hallRows] = await db.query("SELECT id FROM banquet_halls WHERE id = ? LIMIT 1", [hallId]);
    if (!hallRows.length) {
      return res.status(400).json({ message: "Invalid hallId" });
    }

    const overlapping = await checkBookingOverlap({
      hallId,
      date,
      startTime,
      endTime,
      excludeId: id,
    });

    if (overlapping) {
      return res.status(409).json({
        message: "Selected hall is already booked for the chosen time slot",
      });
    }

    const financials = buildFinancialSnapshot(
      {
        customMenuCharge,
        lightingCharge,
        eventSupportFee,
        hallCharge,
        mealCharge,
        decorationFee,
        discount,
        gstPercent,
        subtotalAmount,
        gstAmount,
        grandTotal,
        advance,
        refundAmount,
        paymentMode,
        paymentStatus,
        paymentReferenceNo,
      },
      existingBooking
    );

    const statusClause = statusVal ? ", status = ?" : "";
    const [result] = await db.query(
      `
      UPDATE banquet_bookings
      SET hall_id = ?,
          customer_name = ?,
          phone = ?,
          email = ?,
          event_title = ?,
          event_type = ?,
          guest_count = ?,
          menu_package = ?,
          meal_section = ?,
          custom_menu_items = ?,
          lighting_system = ?,
          custom_menu_charge = ?,
          lighting_charge = ?,
          event_support_fee = ?,
          hall_charge = ?,
          meal_charge = ?,
          decoration_fee = ?,
          event_date = ?,
          start_time = ?,
          end_time = ?,
          discount = ?,
          gst_percent = ?,
          subtotal = ?,
          gst_amount = ?,
          total = ?,
          advance = ?,
          balance = ?,
          notes = ?,
          payment_mode = ?,
          payment_status = ?,
          payment_reference_no = ?,
          invoice_no = ?${statusClause}
      WHERE id = ?
      `,
      [
        hallId,
        customerName,
        phone || "",
        guestEmail || null,
        eventTitle || "",
        eventType || null,
        Number(guests),
        menuPackageId || null,
        mealSection || null,
        customMenuItems || null,
        lightingSystem || null,
        financials.customMenuCharge,
        financials.lightingCharge,
        financials.eventSupportFee,
        financials.hallCharge,
        financials.mealCharge,
        financials.decorationFee,
        date,
        startTime,
        endTime,
        financials.discount,
        financials.gstPercent,
        financials.subtotalAmount,
        financials.gstAmount,
        financials.grandTotal,
        financials.advance,
        financials.balanceDue,
        notes ?? existingBooking.notes ?? null,
        financials.paymentMode,
        financials.paymentStatus,
        financials.paymentReferenceNo,
        invoiceNo || existingBooking.invoice_no || null,
        ...(statusVal ? [statusVal] : []),
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({
      message: "Booking updated successfully",
      status: statusVal || existingBooking.status,
    });
  } catch (error) {
    console.error("updateBanquetBooking error:", error);
    res.status(500).json({ message: "Failed to update booking", error: error.message });
  }
};

// PUT /banquet/:id/cancel
const cancelBanquetBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      `UPDATE banquet_bookings SET status = 'cancelled' WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ message: "Booking cancelled successfully", status: "Cancelled" });
  } catch (error) {
    console.error("cancelBanquetBooking error:", error);
    res.status(500).json({ message: "Failed to cancel booking" });
  }
};

// PUT /banquet/:id/refund
const refundBanquetBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const requestedRefund = Number(req.body?.refundAmount || 0);

    if (!requestedRefund || requestedRefund <= 0) {
      return res.status(400).json({ message: "Valid refundAmount is required" });
    }

    const booking = await getBookingById(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const existingRefund = Math.max(
      toNumber(booking.refund_amount),
      toNumber(parseBanquetMeta(booking.notes || "").refundAmount)
    );
    const advancePaid = toNumber(booking.advance);
    const remainingRefund = Math.max(0, advancePaid - existingRefund);

    if (requestedRefund > remainingRefund) {
      return res.status(400).json({
        message: "Refund amount cannot exceed received advance",
      });
    }

    const totalRefund = existingRefund + requestedRefund;
    const notesMeta = parseBanquetMeta(booking.notes || "");
    notesMeta.refundAmount = totalRefund;

    // 'Refunded' is not in the status enum (inquiry|confirmed|in_progress|
    // completed|cancelled), so a full refund stays put and is signalled via
    // payment_status + refund_amount instead of overwriting the event state.
    const grandTotal = Math.max(toNumber(booking.grand_total), toNumber(booking.total), toNumber(booking.total_amount));
    const netReceived = Math.max(0, advancePaid - totalRefund);
    const balanceDue = Math.max(0, grandTotal - netReceived);
    const fullyRefunded = advancePaid > 0 && totalRefund >= advancePaid;
    const nextEnumStatus = booking.status || "cancelled";
    const nextPaymentStatus = normalizePaymentStatus({
      grandTotal,
      advance: advancePaid,
      refundAmount: totalRefund,
      explicitStatus: fullyRefunded ? "Refunded" : null,
    });

    await db.query(
      `
      UPDATE banquet_bookings
      SET status = ?,
          advance = ?,
          balance = ?,
          refund_amount = ?,
          net_received = ?,
          payment_status = ?,
          notes = ?
      WHERE id = ?
      `,
      [nextEnumStatus, netReceived, balanceDue, totalRefund, netReceived, nextPaymentStatus, buildBanquetNotes(null, notesMeta), id]
    );

    res.status(200).json({
      message: "Refund recorded successfully",
      refundAmount: totalRefund,
      status: fullyRefunded ? "Refunded" : nextEnumStatus,
      paymentStatus: nextPaymentStatus,
      netReceived,
      balanceDue,
    });
  } catch (error) {
    console.error("refundBanquetBooking error:", error);
    res.status(500).json({ message: "Failed to record refund" });
  }
};

// DELETE /banquet/:id
const deleteBanquetBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await getBookingById(id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // status is an enum of inquiry|confirmed|in_progress|completed|cancelled,
    // so a refunded booking is recognised by payment_status / refund_amount.
    const status = String(booking.status || "").toLowerCase();
    const paymentStatus = String(booking.payment_status || "").toLowerCase();
    const fullyRefunded =
      toNumber(booking.refund_amount) > 0 &&
      toNumber(booking.refund_amount) >= toNumber(booking.advance);

    if (!["cancelled", "refunded"].includes(status) && paymentStatus !== "refunded" && !fullyRefunded) {
      return res.status(400).json({
        message: "Only cancelled or refunded bookings can be deleted",
      });
    }

    await db.query("DELETE FROM banquet_bookings WHERE id = ?", [id]);

    res.status(200).json({ message: "Booking deleted successfully" });
  } catch (error) {
    console.error("deleteBanquetBooking error:", error);
    res.status(500).json({ message: "Failed to delete booking" });
  }
};

// PUT /banquet/:id/complete
const completeBanquetBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      `UPDATE banquet_bookings SET status = 'completed' WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ message: "Booking marked as completed" });
  } catch (error) {
    console.error("completeBanquetBooking error:", error);
    res.status(500).json({ message: "Failed to update booking status" });
  }
};

// PUT /banquet/:id/bill
const generateBanquetBill = async (req, res) => {
  try {
    const { id } = req.params;
    const { invoiceNo } = req.body;

    if (!invoiceNo) {
      return res.status(400).json({ message: "invoiceNo is required" });
    }

    const booking = await getBookingById(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const grandTotal = Math.max(toNumber(booking.grand_total), toNumber(booking.total), toNumber(booking.total_amount));
    const refundAmount = Math.max(toNumber(booking.refund_amount), toNumber(parseBanquetMeta(booking.notes || "").refundAmount));
    const paymentStatus = normalizePaymentStatus({
      grandTotal,
      advance: booking.advance || 0,
      refundAmount,
      explicitStatus: booking.payment_status,
    });
    const netReceived = Math.max(0, toNumber(booking.advance) - refundAmount);
    const balanceDue = Math.max(0, grandTotal - netReceived);

    const [result] = await db.query(
      `
      UPDATE banquet_bookings
      SET invoice_no = ?, status = 'completed', billed_at = NOW(),
          payment_status = ?, grand_total = ?, refund_amount = ?,
          net_received = ?, balance_due = ?, balance = ?
      WHERE id = ?
      `,
      [invoiceNo, paymentStatus, grandTotal, refundAmount, netReceived, balanceDue, balanceDue, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({ message: "Bill generated successfully" });
  } catch (error) {
    console.error("generateBanquetBill error:", error);
    res.status(500).json({ message: "Failed to generate bill" });
  }
};

module.exports = {
  getBanquetDashboard,
  createBanquetBooking,
  updateBanquetBooking,
  cancelBanquetBooking,
  refundBanquetBooking,
  deleteBanquetBooking,
  completeBanquetBooking,
  generateBanquetBill,
};
