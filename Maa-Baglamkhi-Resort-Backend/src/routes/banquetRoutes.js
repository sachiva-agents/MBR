const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../utils/upload");

// Hall pricing, bookings, cancellations and refunds are all financial records,
// so the whole mount stays closed to unauthenticated requests.
router.use(authMiddleware);

const db = require("../config/db");

const {
  getBanquetPricingConfig,
  getBanquetDashboard,
  updateBanquetPricingConfig,
  createBanquetBooking,
  updateBanquetBooking,
  cancelBanquetBooking,
  refundBanquetBooking,
  deleteBanquetBooking,
  completeBanquetBooking,
  generateBanquetBill,
  addBanquetHall,
  updateBanquetHall,
  deleteBanquetHall,
} = require("../controller/banquetController");

const { sendBanquetInvoiceWhatsApp } = require("../controller/banquetWhatsappController");

// ─── Schema reconciliation ──────────────────────────────────────────────────
// banquetBookingsController is written against the v4 column set, but the
// banquet_bookings table in an older database still has the pre-v4 shape
// (subtotal/total/balance instead of subtotal_amount/grand_total/balance_due,
// and no payment_* / refund / billed_at columns at all). Nothing was loading
// the v4 models, so their DDL never ran and every bill/refund query failed
// with "Unknown column".
//
// This is idempotent and additive: it only ADDs columns that are missing, so it
// is safe to run on every start. Run it before the routes so no request can hit
// a half-migrated table.
const banquetMigrations = [
  ["banquet_bookings", "subtotal_amount", "DECIMAL(12,2) DEFAULT 0"],
  ["banquet_bookings", "grand_total", "DECIMAL(12,2) DEFAULT 0"],
  ["banquet_bookings", "balance_due", "DECIMAL(12,2) DEFAULT 0"],
  ["banquet_bookings", "net_received", "DECIMAL(12,2) DEFAULT 0"],
  ["banquet_bookings", "refund_amount", "DECIMAL(12,2) DEFAULT 0"],
  ["banquet_bookings", "payment_mode", "VARCHAR(50)"],
  ["banquet_bookings", "payment_status", "VARCHAR(50) DEFAULT 'Pending'"],
  ["banquet_bookings", "payment_reference_no", "VARCHAR(100)"],
  ["banquet_bookings", "notes", "TEXT"],
  ["banquet_bookings", "billed_at", "DATETIME DEFAULT NULL"],
];

const { addColumnIfMissing } = require("../utils/schemaMigrations");

let schemaReady = null;

const ensureBanquetSchema = async () => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    for (const [table, column, definition] of banquetMigrations) {
      try {
        // Portable across MariaDB and plain MySQL: information_schema
        // pre-check, then a plain ALTER only when the column is missing.
        // (The MariaDB-only "ADD COLUMN IF NOT EXISTS" syntax that was here
        // made MySQL reject the whole statement, so these columns were never
        // added on MySQL deployments.)
        await addColumnIfMissing(db, table, column, definition);
      } catch (err) {
        console.error(`banquet schema migration failed for ${table}.${column}:`, err.message);
      }
    }
  })();
  return schemaReady;
};

router.use(async (_req, _res, next) => {
  ensureBanquetSchema().then(next).catch(next);
});

router.get("/config", getBanquetPricingConfig);
router.put("/config", updateBanquetPricingConfig);
router.get("/", getBanquetDashboard);
router.get("/halls", async (req, res) => {
  try {
    // Match the camelCase shape that addBanquetHall/updateBanquetHall return,
    // so the frontend does not have to special-case list responses.
    const [rows] = await db.query(
      `SELECT id, name, description,
              capacity_min AS capacityMin, capacity_max AS capacityMax,
              rate_per_hour AS ratePerHour, rate_per_day AS ratePerDay,
              is_ac AS isAc, has_projector AS hasProjector,
              has_sound_system AS hasSoundSystem, has_stage AS hasStage,
              has_dance_floor AS hasDanceFloor, image_url AS imageUrl, status
       FROM banquet_halls ORDER BY id ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load halls", error: err.message });
  }
});
router.get("/bookings", async (req, res) => {
  try {
    // HAG-38: cap the unbounded list so it returns under the 6 s budget.
    // Callers can pass ?limit= (max 500, default 200) for a narrower window.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const [rows] = await db.query(
      `SELECT id, hall_id AS hallId, customer_name AS customerName, phone,
              email AS guestEmail, event_title AS eventTitle, event_type AS eventType,
              guest_count AS guests, menu_package AS menuPackageId, meal_section AS mealSection,
              custom_menu_items AS customMenuItems, lighting_system AS lightingSystem,
              custom_menu_charge AS customMenuCharge, lighting_charge AS lightingCharge,
              event_support_fee AS eventSupportFee, hall_charge AS hallCharge,
              meal_charge AS mealCharge, decoration_fee AS decorationFee,
              event_date AS date, start_time AS startTime, end_time AS endTime,
              discount, gst_percent AS gstPercent, subtotal AS subtotalAmount,
              gst_amount AS gstAmount, total AS grandTotal, advance, balance AS balanceDue,
              status, invoice_no AS invoiceNo, created_by AS createdBy, created_at AS createdAt
       FROM banquet_bookings ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load bookings", error: err.message });
  }
});
router.post("/", createBanquetBooking);
router.put("/:id", updateBanquetBooking);
router.put("/:id/cancel", cancelBanquetBooking);
router.put("/:id/refund", refundBanquetBooking);
router.delete("/:id", deleteBanquetBooking);
router.put("/:id/complete", completeBanquetBooking);
router.put("/:id/bill", generateBanquetBill);
router.post("/halls", upload.single("image"), addBanquetHall);
router.put("/halls/:id", upload.single("image"), updateBanquetHall);
router.delete("/halls/:id", deleteBanquetHall);

router.post("/invoice/send-whatsapp/:bookingId", sendBanquetInvoiceWhatsApp);

module.exports = router;
