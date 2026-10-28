const express = require("express");
const router = express.Router();
const controller = require("../controller/roomServiceController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

// Room list, room-service menu, order placement and bill writing. Nothing in
// the frontend calls this mount today, so the list stays wide on purpose: the
// mount is closed to unauthenticated requests, not narrowed by role.
const OPERATORS = ["admin", "manager", "reception", "accounts", "housekeeping", "waiter", "kitchen", "staff"];

router.use(authMiddleware);
router.use(roleMiddleware(OPERATORS));

// ROOMS
router.post("/rooms", controller.addRoom);
router.get("/rooms", controller.getRooms);

// ROOM MENU
router.post("/menu", controller.addMenuItem);
router.get("/menu", controller.getMenuItems);
router.delete("/menu/:id", controller.deleteMenuItem);

// ROOM ORDER
router.post("/order/add", controller.addOrderItem);
router.get("/order/:roomNumber", controller.getOrder);
router.put("/order/:roomNumber/pay", controller.payOrder);

router.get("/order-items/:orderId", controller.getOrderItems);
router.post("/bill", controller.createBill);
router.get("/bill/:roomNumber", controller.generateBillForRoom);
router.put("/order/:orderId/status", controller.updateStatus);

module.exports = router;
