const db = require("../config/db");
const PaymentsModel = require("../models/PaymentsModel");


exports.createPayment = async (req, res) => {
  const { table, total, method } = req.body || {};

  if (!table || total === undefined || total === null || !method) {
    return res.status(400).json({ message: "table, total, and method are required" });
  }

  // (HAG-18) `table` doubles as the payment reference. Numeric references are
  // booking ids and bind to payments.booking_id (an INT column); free-text
  // table references (e.g. a front-desk "T12") have no booking row, so route
  // them to the payments.reference_no VARCHAR column instead. Previously a
  // non-numeric `table` hit booking_id and 500'd with "Incorrect integer value".
  // Additive: a numeric `table` still lands in booking_id exactly as before.
  const trimmed = String(table).trim();
  const isNumericRef = /^\d+$/.test(trimmed);
  const bookingId = isNumericRef ? Number(trimmed) : null;
  const referenceNo = isNumericRef ? null : trimmed;

  try {
    await PaymentsModel.ensureSchema?.();

    const [result] = await db.query(
      `INSERT INTO payments (booking_id, amount, payment_method_id, payment_type, reference_no, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', NOW(), NOW())`,
      [bookingId, Number(total), Number(method), "payment", referenceNo]
    );

    res.json({
      message: "Payment successful",
      id: result.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Payment failed",
    });
  }
};

exports.getPayments = async (req, res) => {
  try {
    const rows = await PaymentsModel.findAll();
    res.json(rows);
  } catch (err) {
    res.status(500).json(err);
  }
};
