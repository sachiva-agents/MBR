// routes/kitchenRoutes.js
// Kitchen order reads, status updates, cancellations and deletes.
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const kitchenController = require("../controller/kitchenController");

// Waiters create orders, kitchen staff update/cancel, admin/manager oversee.
router.use(authMiddleware, roleMiddleware(["admin", "manager", "kitchen", "chef", "waiter"]));

router.post("/order",           kitchenController.createOrder);
router.get("/",                 kitchenController.getOrders);
router.get("/orders",           kitchenController.getOrders);
router.put("/orders/:id",       kitchenController.updateOrderStatus);
router.put("/orders/:id/save",  kitchenController.saveOrder);
router.put("/orders/:id/cancel",kitchenController.cancelOrder);
router.delete("/orders/:id",    kitchenController.removeOrder);

module.exports = router;
