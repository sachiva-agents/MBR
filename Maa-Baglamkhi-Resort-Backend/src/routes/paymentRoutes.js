const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const controller = require("../controller/paymentController");

// Payment creation and listing — front-desk and finance roles only.
router.use(authMiddleware, roleMiddleware(["admin", "manager", "accounts", "reception"]));

router.post("/", controller.createPayment);
router.get("/", controller.getPayments);

module.exports = router;