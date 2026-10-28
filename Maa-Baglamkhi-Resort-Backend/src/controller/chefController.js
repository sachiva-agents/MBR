const db = require("../config/db");
const { getRequestActor, isWaiterActor } = require("../utils/requestActor");
const { ensureSchema: ensureKitchenSchema } = require("../models/KotOrdersModel");
const { ensureSchema: ensureNotificationSchema } = require("../models/NotificationsModel");
const notificationController = require("../controller/notificationController");
const { resolveKitchenStatus } = require("../controller/kitchenController");
const { syncRestaurantOrdersToKitchen } = require("../utils/kitchenOrderSync");


const parseItems = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
};

const formatMySqlDateTime = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const normalizeOrder = (row) => ({
  ...row,
  items: parseItems(row.items),
  table: String(row.table_number || row.table || ""),
  entityType: row.entity_type || row.entityType || "Table",
  prepTimeMinutes: row.prep_time_minutes || row.prepTimeMinutes || 20,
  expectedReadyAt: row.expected_ready_at || row.expectedReadyAt || null,
  readyMessage: row.ready_message || row.readyMessage || "",
});

const normalizePrepTime = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(120, Math.max(5, Math.round(parsed)));
};


// ── KITCHEN ORDERS ──────────────────────────────────────────────────────────

exports.getKitchenOrders = async (req, res) => {
  try {
    // await syncRestaurantOrdersToKitchen();
    const [rows] = await db.query(
      `SELECT * FROM kitchen_orders WHERE COALESCE(token_status, 'Active') != 'Closed' ORDER BY created_at DESC`
    );
    res.json(rows.map(normalizeOrder));
  } catch (err) {
    console.error("getKitchenOrders error:", err);
    res.status(500).json({ message: "Failed to get kitchen orders", error: err.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot change kitchen status" });
  }

  const { id } = req.params;
  const { status, prepTimeMinutes, readyMessage } = req.body;

  try {
    const [existingRows] = await db.query("SELECT id FROM kitchen_orders WHERE id = ? LIMIT 1", [id]);
    if (!existingRows.length) {
      return res.status(404).json({ message: "Kitchen order not found" });
    }

    let canonicalStatus = status;
    if (status !== undefined) {
      const resolved = resolveKitchenStatus(res, status);
      if (!resolved) return;
      canonicalStatus = resolved;
    }

    const fields = [], vals = [];
    if (status !== undefined) { fields.push("status = ?"); vals.push(canonicalStatus); }
    if (readyMessage !== undefined) { fields.push("ready_message = ?"); vals.push(readyMessage); }
    if (prepTimeMinutes !== undefined) {
      const normalizedPrepTime = normalizePrepTime(prepTimeMinutes);
      fields.push("prep_time_minutes = ?");
      vals.push(normalizedPrepTime);
      const expectedAt = formatMySqlDateTime(new Date(Date.now() + normalizedPrepTime * 60000));
      fields.push("expected_ready_at = ?");
      vals.push(expectedAt);
    }
    if (canonicalStatus === "Ready") {
      fields.push("ready_at = NOW()");
    }
    if (!fields.length) return res.status(400).json({ message: "Nothing to update" });
    vals.push(id);
    await db.query(`UPDATE kitchen_orders SET ${fields.join(", ")} WHERE id = ?`, vals);

    const [updatedRows] = await db.query("SELECT * FROM kitchen_orders WHERE id = ? LIMIT 1", [id]);
    const updatedOrder = normalizeOrder(updatedRows[0] || {});

    global.io?.emit("kitchen-order-updated", {
      id: updatedOrder.id,
      table: updatedOrder.table,
      waiter: updatedOrder.waiter_name,
      entityType: updatedOrder.entityType,
      status: updatedOrder.status,
      readyMessage: updatedOrder.readyMessage,
      prepTimeMinutes: updatedOrder.prepTimeMinutes,
      expectedReadyAt: updatedOrder.expectedReadyAt,
    });
    if (canonicalStatus === "Ready") {
      global.io?.emit("kitchen-order-ready", {
        id: updatedOrder.id,
        table: updatedOrder.table,
        waiter: updatedOrder.waiter_name,
        entityType: updatedOrder.entityType,
        readyMessage: updatedOrder.readyMessage,
        referenceLabel: `${updatedOrder.entityType} ${updatedOrder.table || "--"}`,
      });
    }

    res.json({ message: "Order status updated", order: updatedOrder });
  } catch (err) {
    console.error("updateOrderStatus error:", err);
    res.status(500).json({ message: "Failed to update order", error: err.message });
  }
};

// ── NOTIFICATIONS (delegate to notificationController) ─────────────────────

exports.getNotifications = async (req, res) => {
  try {
    await ensureNotificationSchema();
    return notificationController.listNotifications(req, res);
  } catch (err) {
    console.error("getNotifications error:", err);
    res.status(500).json({ message: "Failed to fetch notifications", error: err.message });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    await ensureNotificationSchema();
    return notificationController.markAsRead(req, res);
  } catch (err) {
    console.error("markNotificationRead error:", err);
    res.status(500).json({ message: "Failed to mark as read", error: err.message });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    await ensureNotificationSchema();
    return notificationController.markAllAsRead(req, res);
  } catch (err) {
    console.error("markAllNotificationsRead error:", err);
    res.status(500).json({ message: "Failed to mark all as read", error: err.message });
  }
};

exports.createKitchenNotification = async (req, res) => {
  try {
    await ensureNotificationSchema();
    return notificationController.createNotification(req, res);
  } catch (err) {
    console.error("createKitchenNotification error:", err);
    res.status(500).json({ message: "Failed to create notification", error: err.message });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    await ensureNotificationSchema();
    return notificationController.deleteNotification(req, res);
  } catch (err) {
    console.error("deleteNotification error:", err);
    res.status(500).json({ message: "Failed to delete", error: err.message });
  }
};
