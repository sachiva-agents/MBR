/**
 * settingsRoutes.js
 *
 * Admin-only settings endpoints. Any authenticated user can READ,
 * but only admin role can WRITE.
 */

const express = require("express");
const router = express.Router();
const settingsController = require("../controller/settingsController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Anyone with a valid token can read settings
router.get("/", authMiddleware, settingsController.getSettings);

// Only admin can update settings
router.put("/", authMiddleware, roleMiddleware(["admin"]), settingsController.updateSettings);

// HAG-23: side-effect-free WhatsApp gateway probe (exercises the HAG-13
// circuit breaker). Admin-only, like every other settings write.
router.post(
  "/test-connection",
  authMiddleware,
  roleMiddleware(["admin"]),
  settingsController.testConnection,
);

module.exports = router;