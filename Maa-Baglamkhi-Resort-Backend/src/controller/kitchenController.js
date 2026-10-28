const db = require("../config/db");
const { getRequestActor, isWaiterActor } = require("../utils/requestActor");
const { ensureSchema } = require("../models/kitchen");
const { _createNotification } = require("../controller/notificationController");
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
  items:       parseItems(row.items),
  table:       String(row.table_number || row.table || ""),
  entityType:  row.entity_type || row.entityType || "Table",
  prepTimeMinutes: row.prep_time_minutes || row.prepTimeMinutes || 20,
  expectedReadyAt: row.expected_ready_at || row.expectedReadyAt || null,
  readyMessage:    row.ready_message    || row.readyMessage    || "",
});

const normalizePrepTime = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(120, Math.max(5, Math.round(parsed)));
};

const KITCHEN_STATUSES = ["Pending", "Preparing", "Ready", "Cancelled", "Served"];

// Shared with chefController: returns the canonical status or null; sends 400 when the value is not a known kitchen status.
exports.resolveKitchenStatus = (res, status) => {
  const canonical = KITCHEN_STATUSES.find((s) => s.toLowerCase() === String(status || "").toLowerCase());
  if (!canonical) {
    res.status(400).json({
      message: `Invalid kitchen status '${status}'. Allowed: ${KITCHEN_STATUSES.join(", ")}`,
    });
    return null;
  }
  return canonical;
};

const inferEntityType = (orderLike = {}) => {
  if (String(orderLike.entity_type || orderLike.entityType || "").toLowerCase() === "room") {
    return "Room";
  }

  return String(orderLike.waiter_name || orderLike.waiter || "")
    .toLowerCase()
    .includes("room")
    ? "Room"
    : "Table";
};

exports.createOrder = async (req, res) => {
  const actor = getRequestActor(req);
  const { table, waiter, items, prepTimeMinutes, entityType, kotNo } = req.body;
  if (!String(table || "").trim()) {
    return res.status(400).json({ message: "Table reference is required" });
  }
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: "At least one kitchen item is required" });
  }
  const itemsJson   = JSON.stringify(Array.isArray(items) ? items : []);
  const prepMinutes = normalizePrepTime(prepTimeMinutes);
  const expectedAt  = formatMySqlDateTime(new Date(Date.now() + prepMinutes * 60000));
  const kot = kotNo || `KOT-${Date.now()}`;

  try {
    const createdWaiter = isWaiterActor(actor) ? actor.name || waiter || "Waiter" : waiter || "Waiter";
    const [result] = await db.query(
      `INSERT INTO kitchen_orders
        (waiter_name, table_number, items, status, token_status, kot_no, entity_type, prep_time_minutes, expected_ready_at)
        VALUES (?, ?, ?, 'Pending', 'Active', ?, ?, ?, ?)`,
      [createdWaiter, String(table || ""), itemsJson, kot, entityType || "Table", prepMinutes, expectedAt]
    );
    // Fire-and-forget: auto-print KOT to kitchen thermal printer
    try {
      const { KitchenPrintService } = require("../services/KitchenPrintService");
      console.log(`[KOT] Auto-print triggered for order #${result.insertId} (KOT ${kot}) → table ${table}`);
      KitchenPrintService.autoPrintKOT({
        kotNo: kot,
        orderId: result.insertId,
        tableNumber: String(table || ""),
        entityType: entityType || "Table",
        waiterName: createdWaiter,
        items: Array.isArray(items) ? items : [],
        date: new Date(),
        printedBy: createdWaiter,
      })
        .then((res) => {
          if (res?.success) {
            console.log(`[KOT] ✓ Queued for printing — KOT ${kot}`);
          } else {
            console.error(`[KOT] ✗ Queue failed:`, res?.error || "unknown");
          }
        })
        .catch((err) => console.error(`[KOT] ✗ Auto-print failed:`, err.message));
    } catch (e) { console.error("[KOT] ✗ Import error:", e.message); }

    global.io?.emit("kitchen-order-created", {
      id: result.insertId,
      table: String(table || ""),
      waiter: createdWaiter,
      entityType: entityType || "Table",
      prepTimeMinutes: prepMinutes,
      expectedReadyAt: expectedAt,
    });
    // Persist a DB notification for kitchen role so chef dashboard can surface it
    try {
      await _createNotification({
        user_role: "kitchen",
        type: "new_order",
        title: `New Order: ${entityType || "Table"} ${table || "--"}`,
        message: `KOT ${kot} — ${items.length} items from ${createdWaiter}`,
        data: { orderId: result.insertId, kotNo: kot, table, waiter: createdWaiter, entityType },
      });
    } catch (e) { console.error("kitchen notification failed:", e); }
    res.json({
      id: result.insertId,
      message: "Kitchen order created",
      kotNo: kot,
      order: {
        id: result.insertId,
        table: String(table || ""),
        waiter: createdWaiter,
        entityType: entityType || "Table",
        prepTimeMinutes: prepMinutes,
        expectedReadyAt: expectedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create kitchen order", error: err.message });
  }
};

// ── GET ORDERS ──────────────────────────────────────────────────────────────
exports.getOrders = async (req, res) => {
  const actor = getRequestActor(req);
  try {
    try {
      // await syncRestaurantOrdersToKitchen();
    } catch (syncErr) {
      console.error("kitchen sync error (non-fatal):", syncErr.message);
    }
    const params = [];
    let sql = "SELECT * FROM kitchen_orders WHERE COALESCE(token_status, 'Active') != 'Closed'";
    if (isWaiterActor(actor) && actor.name) {
      sql += " AND LOWER(COALESCE(waiter_name, '')) = LOWER(?)";
      params.push(actor.name);
    }
    sql += " ORDER BY created_at DESC";
    const [rows] = await db.query(sql, params);
    res.json(rows.map(normalizeOrder));
  } catch (err) {
    console.error("getOrders error:", err);
    res.status(500).json({ message: "Failed to get kitchen orders", error: err.message });
  }
};

// ── UPDATE ORDER STATUS ─────────────────────────────────────────────────────
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
    res.json({ message: "Order status updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update order", error: err.message });
  }
};

// ── SAVE ORDER ──────────────────────────────────────────────────────────────
exports.saveOrder = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot save kitchen orders" });
  }

  const { id } = req.params;
  try {
    const [rows] = await db.query("SELECT * FROM kitchen_orders WHERE id = ? LIMIT 1", [id]);
    const order = rows[0];
    if (!order) {
      return res.status(404).json({ message: "Kitchen order not found" });
    }

    const items = parseItems(order.items);
    const amount = items.reduce((sum, item) => {
      const quantity = Number(item.qty ?? item.quantity ?? 0);
      const price = Number(item.price || 0);
      return sum + quantity * price;
    }, 0);
    const entityType = inferEntityType(order);
    const reference = String(order.table_number || "--");
    const accountDate = new Date().toISOString().slice(0, 10);
    const description = `Kitchen order saved - ${entityType} ${reference} - Order #${order.id}`;

    const accountResult = await db.query(
      `
        INSERT INTO accounts_transactions (date, type, description, amount, payment_mode)
        VALUES (?, 'Income', ?, ?, ?)
      `,
      [accountDate, description, amount, "Kitchen"],
    );

    await db.query(
      "UPDATE kitchen_orders SET status = 'Saved', token_status = 'Closed' WHERE id = ?",
      [id],
    );

    res.json({
      message: "Order saved",
      accountEntry: {
        id: accountResult.insertId,
        amount,
        description,
        paymentMode: "Kitchen",
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to save kitchen order", error: err.message });
  }
};

// ── CANCEL ORDER ────────────────────────────────────────────────────────────
exports.cancelOrder = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot cancel kitchen orders" });
  }

  const { id } = req.params;
  try {
    const result = await db.query("UPDATE kitchen_orders SET status = 'Cancelled' WHERE id = ?", [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: "Kitchen order not found" });
    }
    res.json({ message: "Order cancelled" });
  } catch (err) {
    res.status(500).json({ message: "Failed to cancel kitchen order", error: err.message });
  }
};

// ── REMOVE ORDER (DELETE) — FIX: was missing ───────────────────────────────
exports.removeOrder = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot remove kitchen orders" });
  }

  const { id } = req.params;
  try {
    const [result] = await db.query("DELETE FROM kitchen_orders WHERE id = ?", [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: "Kitchen order not found" });
    }
    res.json({ message: "Order permanently removed" });
  } catch (err) {
    res.status(500).json({ message: "Failed to remove order", error: err.message });
  }
};
