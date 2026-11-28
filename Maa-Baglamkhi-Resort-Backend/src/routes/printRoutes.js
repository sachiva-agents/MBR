const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const printController = require("../controller/printController");

// Print jobs expose invoice, bill and booking content.
router.use(authMiddleware, roleMiddleware(["admin", "manager", "reception", "accounts"]));

router.post("/queue", printController.queuePrint);
router.post("/reprint", printController.reprint);
router.get("/history", printController.getHistory);
router.get("/status", printController.getPrinterStatus);
router.get("/queue", printController.getQueueStatus);
router.delete("/queue/:jobId", printController.cancelQueueJob);
router.get("/types", printController.getPrintTypes);
router.post("/test", printController.testPrint);

module.exports = router;
