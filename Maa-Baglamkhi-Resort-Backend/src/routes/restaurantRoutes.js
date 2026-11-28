const express = require("express");
const controller = require("../controller/restaurantController");
const upload = require("../utils/upload");
const restaurantWaController = require("../controller/restaurantWhatsappController");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");

// ─── Public-read section (POS staff + finance) ───────────────────────────────
// Waiters, kitchen staff, and reception need to view tables, menu, and orders.
const READ_ROLES = ["admin", "manager", "reception", "accounts", "waiter", "kitchen"];
router.use(authMiddleware, roleMiddleware(READ_ROLES));

// TABLES — read
router.get("/tables", controller.getTables);
router.get("/waiter-performance", controller.getWaiterPerformance);

// MENU — read
router.get("/menu", controller.getMenuItems);

// ITEM ACTIONS — read
router.get("/item-action-requests", controller.getItemActionRequests);

// ORDERS — read
router.get("/order", controller.getOrders);
router.get("/order/:tableNumber", controller.getOrder);
router.get("/order-items/:orderId", controller.getOrderItems);

// BILLS — read
router.get("/", controller.getBills);
router.get("/payment", controller.getBills);
router.get("/payment-bills", controller.getBills);
router.get("/room-items", controller.getOrders);
router.get("/bill", controller.getBills);
router.get("/bills", controller.getBills);

// ─── Write section (admin / manager / accounts only) ─────────────────────────
const WRITE_ROLES = ["admin", "manager", "accounts"];
router.use(authMiddleware, roleMiddleware(WRITE_ROLES));

// TABLES — write
router.post("/tables", controller.addTable);
router.put("/tables/:id", controller.updateTable);
router.delete("/tables/:id", controller.deleteTable);

// MENU — write
router.post("/menu", upload.single("image"), controller.addMenuItem);
router.put("/menu/:id", upload.single("image"), controller.updateMenuItem);
router.delete("/menu/:id", controller.deleteMenuItem);

// ITEM ACTIONS — write
router.post("/item-action-requests", controller.addItemActionRequest);
router.put("/item-action-requests/:id/review", controller.reviewItemActionRequest);

// ORDERS — write
router.post("/order/add", controller.addOrderItem);
router.put("/order/:orderId", controller.updateOrder);
router.delete("/order/:orderId", controller.deleteOrder);
router.put("/order/:tableNumber/pay", controller.payOrder);

// BILLS — write
router.post("/bill", controller.createBill);
router.post("/bill/:id/charge-to-room", controller.chargeBillToRoom);
router.post("/bill/charge-to-room", controller.chargeBillToRoom);
router.post("/bill/:id/pay", controller.payBill);
router.post("/bill/pay", controller.payBill);
router.post("/split-bills", controller.createSplitBill);
router.post("/split-bills/:id/charge-to-room", controller.chargeBillToRoom);
router.post("/split-bills/charge-to-room", controller.chargeBillToRoom);

// SPLIT BILLS — read-only for all POS roles (FIX-12)
router.use(authMiddleware, roleMiddleware(READ_ROLES));
router.get("/split-bills", controller.getSplitBills);

// WHATSAPP — admin/manager/accounts only (sends invoice to guest)
router.use(authMiddleware, roleMiddleware(WRITE_ROLES));
router.post("/invoice/send-whatsapp/:billId", restaurantWaController.sendRestaurantInvoiceWhatsApp);

module.exports = router;
