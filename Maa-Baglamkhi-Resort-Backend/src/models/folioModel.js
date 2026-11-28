/**
 * folioModel.js
 * Guest folio / night audit model.
 * Manages hotel_folio_entries table.
 */

const db = require("../config/db");

const runQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

// ─── Schema bootstrap ──────────────────────────────────────────────────────
// The canonical DDL lives in folioController.ensureSchema (FK → bookings(id)).
// This file's DDL referenced guests(id), which is wrong — the folio is
// per-booking. Delegate to the controller so whichever caller runs first
// always gets the correct FK.
const folioController = require("../controller/folioController");
const ensureSchema = folioController.ensureSchema;

// ─── Get all folio entries for a booking ──────────────────────────────────
const getFolioByBooking = async (bookingId) => {
  await ensureSchema();
  return runQuery(
    `SELECT * FROM hotel_folio_entries
     WHERE booking_id = ?
     ORDER BY entry_date ASC, id ASC`,
    [bookingId],
  );
};

// ─── Add a folio entry ─────────────────────────────────────────────────────
const addFolioEntry = async ({
  booking_id,
  entry_date,
  entry_type = "Extra Charge",
  category = "Miscellaneous",
  description,
  amount,
  created_by = "Front Desk",
}) => {
  await ensureSchema();

  if (!booking_id || !description || amount === undefined) {
    throw new Error("booking_id, description, and amount are required");
  }

  const result = await runQuery(
    `INSERT INTO hotel_folio_entries
       (booking_id, entry_date, entry_type, category, description, amount, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      booking_id,
      entry_date || new Date().toISOString().slice(0, 10),
      entry_type,
      category,
      description,
      Number(amount),
      created_by,
    ],
  );

  return { id: result.insertId, booking_id, entry_type, amount };
};

// ─── Delete a folio entry ──────────────────────────────────────────────────
const deleteFolioEntry = async (entryId) => {
  await ensureSchema();
  await runQuery("DELETE FROM hotel_folio_entries WHERE id = ?", [entryId]);
};

// ─── Get folio balance totals for a booking ───────────────────────────────
const getFolioTotals = async (bookingId) => {
  await ensureSchema();
  const rows = await runQuery(
    `SELECT
       SUM(CASE WHEN entry_type IN ('Room Charge','Extra Charge','Adjustment')
                THEN amount ELSE 0 END)  AS totalCharges,
       SUM(CASE WHEN entry_type = 'Discount' THEN amount ELSE 0 END) AS totalDiscounts,
       SUM(CASE WHEN entry_type = 'Payment'  THEN amount ELSE 0 END) AS totalPayments,
       SUM(CASE WHEN entry_type = 'Refund'   THEN amount ELSE 0 END) AS totalRefunds
     FROM hotel_folio_entries
     WHERE booking_id = ?`,
    [bookingId],
  );
  const t = rows[0] || {};
  const charges   = Number(t.totalCharges   || 0);
  const discounts = Number(t.totalDiscounts || 0);
  const payments  = Number(t.totalPayments  || 0);
  const refunds   = Number(t.totalRefunds   || 0);
  return {
    charges,
    discounts,
    payments,
    refunds,
    netBalance: charges - discounts - payments - refunds,
  };
};

// ─── Create a folio entry (camelCase API used by the restaurant module) ───
const createFolioEntry = async ({
  bookingId,
  description,
  amount,
  entryType = "Extra Charge",
  category = "Restaurant",
  createdBy = "Restaurant",
  entryDate,
}) => {
  if (!bookingId || !description || amount === undefined) {
    throw new Error("bookingId, description, and amount are required");
  }
  const result = await runQuery(
    `INSERT INTO hotel_folio_entries
       (booking_id, entry_date, entry_type, category, description, amount, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      bookingId,
      entryDate || new Date().toISOString().slice(0, 10),
      entryType,
      category,
      description,
      Number(amount),
      createdBy,
    ],
  );
  return result.insertId;
};

module.exports = {
  ensureSchema,
  getFolioByBooking,
  addFolioEntry,
  createFolioEntry,
  deleteFolioEntry,
  getFolioTotals,
};
