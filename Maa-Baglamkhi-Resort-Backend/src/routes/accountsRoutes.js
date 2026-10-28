const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");

// Nothing in this module is public: every route reads or writes the money
// tables (transactions, payments, petty cash, gst returns, vendor payments,
// purchase orders, payroll, profit centres, payment gateway settings).
router.use(authMiddleware);

const {
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  addIncome,
  addExpense,
  getSummary,
  getDepartmentSummary,
  getHotelBillingRecords,
  getRestaurantBillingRecords,
  getExtendedSummary,
  getReconciliationSummary,
  listReconciliationItems,
  matchBankLedger,
  unmatchBankLedger,
  listBankLedger,
  addBankLedger,
  updateBankLedger,
  deleteBankLedger,
  listPettyCash,
  addPettyCash,
  updatePettyCash,
  deletePettyCash,
  listGstReturns,
  addGstReturn,
  updateGstReturn,
  deleteGstReturn,
  listVendorPayments,
  addVendorPayment,
  updateVendorPayment,
  deleteVendorPayment,
  listPurchaseOrders,
  addPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  listPayrollRecords,
  addPayrollRecord,
  updatePayrollRecord,
  deletePayrollRecord,
  listProfitCenters,
  addProfitCenter,
  updateProfitCenter,
  deleteProfitCenter,
  listPaymentGatewaySettings,
  getPaymentGatewaySettingById,
  addPaymentGatewaySetting,
  updatePaymentGatewaySetting,
  deletePaymentGatewaySetting,
  settlePendingBill,
  getAllPaymentHistory,
} = require("../controller/accountsController");

const db = require("../config/db");
const { memoryStorage } = require("../utils/upload");

// ── Schema reconciliation for the bank-ledger form ─────────────────────────
// The UI lets an accountant pick an entry date, a bank name, a reconciliation
// status and notes, but the `payments` table (which backs the ledger) has no
// columns for any of them. The values were being silently dropped, so a row
// always came back with today's date, the payment method's name in the bank
// column, and "Pending" for the status.
//
// Only ADDs missing columns; safe and idempotent to run on every start.
const ACCOUNTS_MIGRATIONS = [
  ["payments", "entry_date", "DATE NULL"],
  ["payments", "bank_name", "VARCHAR(191) NULL"],
  ["payments", "reconciliation_status", "VARCHAR(50) NULL"],
  ["payments", "notes", "TEXT NULL"],
  // The Add Income/Expense form asks for a party name and mobile number, but
  // the v4 `transactions` header had nowhere to store them — the controller
  // hard-coded customerName/customerMobile to null, so searching the ledger
  // by customer name or phone could never match anything.
  ["transactions", "customer_name", "VARCHAR(200) NULL"],
  ["transactions", "customer_mobile", "VARCHAR(30) NULL"],
];

let accountsSchemaReady = null;
const ensureAccountsSchema = async () => {
  if (accountsSchemaReady) return accountsSchemaReady;
  accountsSchemaReady = (async () => {
    for (const [table, column, definition] of ACCOUNTS_MIGRATIONS) {
      try {
        const [rows] = await db.query(
          `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [table, column],
        );
        if (!rows?.[0]?.n) {
          await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        }
      } catch (err) {
        console.error(`accounts schema migration failed for ${table}.${column}:`, err.message);
      }
    }
  })();
  return accountsSchemaReady;
};

router.use(async (_req, _res, next) => {
  ensureAccountsSchema().then(next).catch(next);
});

// AccountsDashboard.jsx calls /accounts/dashboard for the same numbers it gets
// from /summary; keep both names live instead of 404ing the page.
router.get("/dashboard", getSummary);

// The payment-settings form posts multipart/form-data (it can attach a QR
// image), and the app only installs json + urlencoded. Without a multipart
// parser req.body stays empty and every save dies with "paymentMode is
// required".
router.use(memoryStorage.none());

router.get("/", getSummary);
router.get("/transactions", getTransactions);
router.get("/transactions/:id", getTransactionById);
router.put("/transactions/:id", updateTransaction);
router.delete("/transactions/:id", deleteTransaction);
router.get("/summary", getSummary);
router.get("/department-summary", getDepartmentSummary);
router.get("/hotel-billing", getHotelBillingRecords);
router.get("/restaurant-billing", getRestaurantBillingRecords);
router.post("/income", addIncome);
router.post("/expense", addExpense);

router.get("/extended-summary", getExtendedSummary);

// The payment-settings form posts multipart/form-data (it can attach a QR
// image), and the app only installs json + urlencoded. Without a multipart
// parser req.body stays empty and every save dies with "paymentMode is
// required".
router.use(memoryStorage.none());

router.get("/reconciliation/summary", getReconciliationSummary);
router.get("/reconciliation/items", listReconciliationItems);
router.post("/reconciliation/match", matchBankLedger);
router.post("/reconciliation/unmatch", unmatchBankLedger);
router.post("/settle-pending-bill", settlePendingBill);
router.get("/bank-ledger", listBankLedger);
router.post("/bank-ledger", addBankLedger);
router.put("/bank-ledger/:id", updateBankLedger);
router.delete("/bank-ledger/:id", deleteBankLedger);
router.get("/petty-cash", listPettyCash);
router.post("/petty-cash", addPettyCash);
router.put("/petty-cash/:id", updatePettyCash);
router.delete("/petty-cash/:id", deletePettyCash);
router.get("/gst-returns", listGstReturns);
router.post("/gst-returns", addGstReturn);
router.put("/gst-returns/:id", updateGstReturn);
router.delete("/gst-returns/:id", deleteGstReturn);
router.get("/vendor-payments", listVendorPayments);
router.post("/vendor-payments", addVendorPayment);
router.put("/vendor-payments/:id", updateVendorPayment);
router.delete("/vendor-payments/:id", deleteVendorPayment);
router.get("/purchase-orders", listPurchaseOrders);
router.post("/purchase-orders", addPurchaseOrder);
router.put("/purchase-orders/:id", updatePurchaseOrder);
router.delete("/purchase-orders/:id", deletePurchaseOrder);
router.get("/payroll", listPayrollRecords);
router.post("/payroll", addPayrollRecord);
router.put("/payroll/:id", updatePayrollRecord);
router.delete("/payroll/:id", deletePayrollRecord);
router.get("/profit-centers", listProfitCenters);
router.post("/profit-centers", addProfitCenter);
router.put("/profit-centers/:id", updateProfitCenter);
router.delete("/profit-centers/:id", deleteProfitCenter);
router.get("/payment-settings", listPaymentGatewaySettings);
router.get("/payment-settings/:id", getPaymentGatewaySettingById);
router.post("/payment-settings", addPaymentGatewaySetting);
router.put("/payment-settings/:id", updatePaymentGatewaySetting);
router.delete("/payment-settings/:id", deletePaymentGatewaySetting);
router.get("/payment-history", getAllPaymentHistory);

module.exports = router;
