const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");

// Invoice create/read/update and payment status are financial records.
router.use(authMiddleware);

const {
  createInvoice,
  getAllInvoices,
  getInvoiceByBookingId,
  updateInvoice,
  generateCustomerInvoice,
  downloadCustomerInvoicePdf,
  updateInvoicePaymentStatus,
} = require("../controller/InvoiceController");

router.post("/create", createInvoice);
router.get("/all", getAllInvoices);
router.get("/by-booking/:bookingId", getInvoiceByBookingId);
router.put("/update/:id", updateInvoice);
router.patch("/payment-status/:id", updateInvoicePaymentStatus);
router.get("/:customerId/pdf", downloadCustomerInvoicePdf);
router.get("/:customerId", generateCustomerInvoice);

module.exports = router;
