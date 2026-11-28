const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const controller = require("../controller/reportController");

// Daywise payment totals and item consumption aggregates — financial data.
router.use(authMiddleware, roleMiddleware(["admin", "manager", "accounts"]));

router.get("/daywise", controller.daywise);
router.get("/items", controller.itemConsumption);

module.exports = router;
