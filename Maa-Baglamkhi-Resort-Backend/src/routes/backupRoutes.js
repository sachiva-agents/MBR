/**
 * backupRoutes.js
 *
 * Admin Backup & Restore endpoints. Authenticated users may read settings;
 * only admin may write settings, run, list and restore.
 */

const express = require("express");
const router = express.Router();
const backupController = require("../controller/backupController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

router.get("/settings", authMiddleware, backupController.getSettings);

router.put("/settings", authMiddleware, roleMiddleware(["admin"]), backupController.updateSettings);

router.post("/run", authMiddleware, roleMiddleware(["admin"]), backupController.runNow);

router.get("/list", authMiddleware, roleMiddleware(["admin"]), backupController.list);

router.post("/restore", authMiddleware, roleMiddleware(["admin"]), backupController.restore);

module.exports = router;
