const db = require("../config/db");
const folioModel = require("../models/folioModel");
const { getRequestActor, isWaiterActor, namesMatch } = require("../utils/requestActor");

// Resolve a payment-mode label to a payment_methods.id. Creates the row if needed.
const resolvePaymentMethodId = async (paymentMode) => {
  const label = String(paymentMode || "").trim();
  if (!label) return null;
  try {
    const [rows] = await db.query("SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(?) LIMIT 1", [label]);
    if (rows && rows[0]) return rows[0].id;
    const code = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) || "other";
    const [result] = await db.query("INSERT INTO payment_methods (name, code, is_active) VALUES (?, ?, 1)", [label, code]);
    if (result?.insertId) return result.insertId;
  } catch { /* unique-name race: fall through */ }
  const [retry] = await db.query("SELECT id FROM payment_methods ORDER BY id ASC LIMIT 1");
  return retry?.[0]?.id || null;
};


const resolveAssignedWaiterName = (req, fallbackEntityType = "Table") => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor) && actor.name) {
    return actor.name;
  }

  const bodyWaiterName = String(req.body?.waiterName || req.body?.waiter || "").trim();
  if (bodyWaiterName) return bodyWaiterName;

  return String(fallbackEntityType || "Table").toLowerCase() === "room" ? "Room Service" : "Waiter";
};

const isHappyHourActive = (item) => {
  if (!item.happy_hour_price || !item.happy_hour_start || !item.happy_hour_end) return false;
  const now = new Date();
  const current = now.toTimeString().slice(0, 8);
  return current >= item.happy_hour_start && current <= item.happy_hour_end;
};

const withEffectivePrice = (item) => {
  const price = Number(item.price || 0);
  const happyHourPrice = Number(item.happy_hour_price || 0);
  const effectivePrice =
    happyHourPrice > 0 &&
    item.happy_hour_start &&
    item.happy_hour_end &&
    (() => {
      const now = new Date();
      const current = now.toTimeString().slice(0, 8);
      return current >= item.happy_hour_start && current <= item.happy_hour_end;
    })()
      ? happyHourPrice
      : price;

  return Object.assign({}, item, {
    effectivePrice,
    effective_price: effectivePrice,
  });
};

const normalizeTableRow = (tableRow) => ({
  id: tableRow.id,
  number: tableRow.table_number || tableRow.number,
  floorName: tableRow.floor_name || tableRow.floorName || "",
  sectionName: tableRow.section_name || tableRow.sectionName || "",
  seatCount: tableRow.seat_count || tableRow.seatCount || tableRow.guestCount || 4,
  statusColor: tableRow.status_color || tableRow.statusColor || "",
  status: tableRow.status || "available",
});

const tableExistsInLegacyTable = async (number) => {
  try {
    const [rows] = await db.query("SELECT id, number FROM tables WHERE number = ? LIMIT 1", [String(number)]);
    return rows[0] || null;
  } catch {
    return null;
  }
};

const getMergedTableRows = async () => {
  const seen = new Set();
  const merged = [];

  try {
    const [restaurantRows] = await db.query("SELECT * FROM restaurant_tables ORDER BY CAST(number AS UNSIGNED), number ASC");
    for (const row of restaurantRows) {
      const key = String(row.number || row.table_number || "").trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(normalizeTableRow(row));
      }
    }
  } catch {
    // ignore and fall back to legacy table list below
  }

  try {
    const [legacyRows] = await db.query("SELECT * FROM tables ORDER BY CAST(number AS UNSIGNED), number ASC");
    for (const row of legacyRows) {
      const key = String(row.number || "").trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(normalizeTableRow(row));
      }
    }
  } catch {
    // ignore when legacy table does not exist
  }

  return merged;
};

/* ================= TABLE ================= */
exports.addTable = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot add restaurant tables" });
  }

  const { number, floorName, sectionName, seatCount, statusColor } = req.body || {};

  if (!number) {
    return res.status(400).json({ message: "Table number required" });
  }

  try {
    const [existing] = await db.query(
      "SELECT id FROM restaurant_tables WHERE number = ? LIMIT 1",
      [String(number)]
    );

    const legacyExisting = await tableExistsInLegacyTable(number);

    if (existing.length > 0 || legacyExisting !== null) {
      return res.status(400).json({ message: "Table already exists" });
    }

    const [result] = await db.query(
      "INSERT INTO restaurant_tables (number, status, guestCount, floor_name, section_name, seat_count, status_color) VALUES (?, 'available', ?, ?, ?, ?, ?)",
      [
        String(number),
        Number(seatCount || 4),
        floorName || null,
        sectionName || null,
        Number(seatCount || 4),
        statusColor || null,
      ]
    );
    res.json({
      id: result.insertId,
      number: String(number),
    });

  } catch (err) {
    console.error("ADD TABLE ERROR:", err.sqlMessage || err.message);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "Table already exists",
      });
    }

    res.status(500).json({
      message: "Table insert failed",
      error: err.message,
    });
  }
};

exports.getTables = async (req, res) => {
  try {
    const rows = await getMergedTableRows();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load tables", error: err.message });
  }
};

exports.updateTable = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot update restaurant tables" });
  }

  const { id } = req.params;
  const { floorName, sectionName, seatCount, statusColor, status } = req.body || {};

  try {
    await db.query(
      "UPDATE restaurant_tables SET floor_name=?, section_name=?, seat_count=?, status_color=?, status=? WHERE id=?",
      [floorName || null, sectionName || null, Number(seatCount || 4), statusColor || null, status || "available", id]
    );
    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update table", error: err.message });
  }
};

exports.deleteTable = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot remove restaurant tables" });
  }

  const { id } = req.params;

  try {
    const [tableRows] = await db.query(
      "SELECT id, number FROM restaurant_tables WHERE id = ? LIMIT 1",
      [id]
    );
    const tableRow = tableRows?.[0];

    if (!tableRow) {
      return res.status(404).json({
        message: "Table not found",
      });
    }

    const tableNumber = String(tableRow.number || "").trim();

    const [activeTokens] = await db.query(
      "SELECT id FROM tokens WHERE table_number = ? AND status = 'active' LIMIT 1",
      [tableNumber],
    );
    if (activeTokens?.length) {
      return res.status(409).json({
        message: "Tables with active tokens cannot be removed.",
      });
    }

    const [pendingOrders] = await db.query(
      "SELECT id FROM orders WHERE table_number = ? AND status = 'pending' LIMIT 1",
      [tableNumber],
    );
    if (pendingOrders?.length) {
      return res.status(409).json({
        message: "Tables with pending orders cannot be removed.",
      });
    }

    const [pendingBills] = await db.query(
      "SELECT id FROM bills WHERE table_number = ? AND COALESCE(payment_status, 'unpaid') <> 'paid' LIMIT 1",
      [tableNumber],
    );
    if (pendingBills?.length) {
      return res.status(409).json({
        message: "Tables with pending bills cannot be removed.",
      });
    }

    await db.query(
      "DELETE FROM restaurant_tables WHERE id = ?",
      [id]
    );

    res.json({ message: "Table deleted successfully" });

  } catch (err) {
    console.error("DELETE TABLE ERROR:", err.sqlMessage || err.message);

    res.status(500).json({
      message: "Failed to delete table",
      error: err.message,
    });
  }
};

/* ================= MENU ================= */

exports.addMenuItem = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot create menu items" });
  }

  try {
    const name = req.body.name;
    const price = Number(req.body.price);
    const category = req.body.category || "Others";
    const tax = Number(req.body.tax || 5);
    const description = req.body.description || null;
    const foodType = req.body.foodType || "Veg";
    const status = req.body.status || "Available";

    if (!name || !price) return res.status(400).json({ message: "Name and price required" });

    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    const [menuCatTables] = await db.query("SHOW TABLES LIKE 'menu_categories'");
    if (!Array.isArray(menuCatTables) || !menuCatTables.length) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS menu_categories (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          description TEXT DEFAULT NULL,
          sort_order INT DEFAULT 0,
          is_active TINYINT(1) DEFAULT 1
        )
      `);
      await db.query(
        "INSERT IGNORE INTO menu_categories (id, name, sort_order) VALUES (1, 'Others', 0)"
      );
    }

    const [result] = await db.query(
      "INSERT INTO menu_items (name, price, category_id, image_url, description, food_type, availability_status, tax) VALUES (?,?,?,?,?,?,?,?)",
      [name, price, 1, imageUrl, description, foodType, status, tax]
    );
    res.json({ id: result.insertId, name, price, category, imageUrl, message: "Menu item added" });
  } catch (err) {
    console.error("ADD MENU ITEM ERROR:", err.sqlMessage || err.message);
    res.status(500).json({ message: "Failed to add menu item", error: err.sqlMessage || err.message });
  }
};

exports.getMenuItems = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM menu_items ORDER BY category_id, name");

    res.json(rows.map(withEffectivePrice));
  } catch (err) {
    res.status(500).json({ message: "Failed to load menu", error: err.message });
  }
};

exports.updateMenuItem = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot update menu items" });
  }

  const {
    name,
    price,
    tax,
    happyHourPrice,
    happyHourStart,
    happyHourEnd,
    description,
    foodType,
    status,
    existingImageUrl,
    imageUrl: bodyImageUrl,
  } = req.body;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : bodyImageUrl || existingImageUrl || null;

  if (!name || !price) {
    return res.status(400).json({ message: "Name and price required" });
  }

  try {
    await db.query(
      `UPDATE menu_items
       SET name=?, price=?, image_url=?, description=?, food_type=?, availability_status=?, tax=?, happy_hour_price=?, happy_hour_start=?, happy_hour_end=?
       WHERE id=?`,
      [
        name,
        price,
        imageUrl || null,
        description || null,
        foodType || "Veg",
        status || "Available",
        Number(tax || 5),
        happyHourPrice != null && happyHourPrice !== "" ? Number(happyHourPrice) : null,
        happyHourStart || null,
        happyHourEnd || null,
        req.params.id,
      ],
    );
    res.json({ message: "Menu item updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update menu item", error: err.message });
  }
};

exports.deleteMenuItem = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot delete menu items" });
  }

  try {
    await db.query("DELETE FROM menu_items WHERE id=?", [req.params.id]);
    res.json({ message: "Menu item deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete menu item", error: err.message });
  }
};

/* ================= ORDER ================= */

exports.addOrderItem = async (req, res) => {
  const actor = getRequestActor(req);
  const { tableNumber, item, itemId, qty, price, name } = req.body || {};
  const resolvedItem = item || {};
  const itemName = String(name || resolvedItem.name || "").trim();
  const itemQty = Number((resolvedItem.quantity || qty || 1));
  const itemPrice = Number((resolvedItem.price || price || 0));
  if (!tableNumber || !itemName) return res.status(400).json({ message: "tableNumber and item required" });
  const waiterName = resolveAssignedWaiterName(req);

  try {
    let created = false;
    const [orderRows] = await db.query("SELECT id, waiter_name FROM orders WHERE table_number=? AND status='pending' ORDER BY id DESC LIMIT 1", [tableNumber]);
    let order = orderRows[0];

    if (isWaiterActor(actor) && order?.waiter_name && !namesMatch(order.waiter_name, actor.name)) {
      return res.status(403).json({ message: "This table is already running under another waiter" });
    }

    if (!order) {
      const [result] = await db.query(
        "INSERT INTO orders (table_number, waiter_name, status) VALUES (?, ?, 'pending')",
        [tableNumber, waiterName || null],
      );
      order = { id: result.insertId };
      created = true;
    } else if (!order.waiter_name && waiterName) {
      await db.query("UPDATE orders SET waiter_name = ? WHERE id = ?", [waiterName, order.id]);
    }

    const menuItemId = resolvedItem.menuItemId || resolvedItem.menuId || resolvedItem.id || null;
    const taxPercent = Number(resolvedItem.tax ?? resolvedItem.taxPercent ?? resolvedItem.tax_percent ?? 0) || 0;
    const taxAmount = Number((itemPrice * itemQty * taxPercent / 100).toFixed(2));
    const lineTotal = Number((itemPrice * itemQty).toFixed(2));

    await db.query(
      "INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price, tax_percent, tax_amount, total, notes) VALUES (?,?,?,?,?,?,?,?,?)",
      [order.id, menuItemId, itemName, itemQty, itemPrice, taxPercent, taxAmount, lineTotal, resolvedItem.notes || null]
    );

    const [totals] = await db.query(
      "SELECT COALESCE(SUM(COALESCE(unit_price,0)*COALESCE(quantity,1)),0) AS subtotal, "
      + "COALESCE(SUM(COALESCE(tax_amount,0)),0) AS tax FROM order_items WHERE order_id = ?",
      [order.id]
    );
    const totalsRow = totals[0] || { subtotal: 0, tax: 0 };
    await db.query(
      "UPDATE orders SET subtotal = ?, tax_amount = ?, total_amount = ? WHERE id = ?",
      [totalsRow.subtotal, totalsRow.tax, Number(totalsRow.subtotal) + Number(totalsRow.tax), order.id]
    );

    res.json({
      orderId: order.id,
      message: created ? "Order created and item added" : "Item added",
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to add order item", error: err.message });
  }
};

exports.getOrders = async (req, res) => {
  const actor = getRequestActor(req);
  try {
    const conditions = [];
    const params = [];

    if (isWaiterActor(actor) && actor.name) {
      conditions.push("LOWER(COALESCE(o.waiter_name, '')) = LOWER(?)");
      params.push(actor.name);
    }

    const [rows] = await db.query(
      `
        SELECT
          o.id,
          o.table_number,
          o.waiter_name AS waiterName,
          o.status,
          o.created_at,
          COUNT(oi.id) AS itemCount,
          COALESCE(SUM(COALESCE(oi.unit_price, 0) * COALESCE(oi.quantity, 0)), 0) AS totalAmount
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        GROUP BY o.id, o.table_number, o.waiter_name, o.status, o.created_at
        ORDER BY o.id DESC
      `,
      params,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load orders", error: err.message });
  }
};

exports.getOrder = async (req, res) => {
  const actor = getRequestActor(req);
  const { tableNumber } = req.params;
  try {
    const params = [tableNumber];
    let sql = "SELECT * FROM orders WHERE table_number=? AND status='pending'";
    if (isWaiterActor(actor) && actor.name) {
      sql += " AND LOWER(COALESCE(waiter_name, '')) = LOWER(?)";
      params.push(actor.name);
    }
    sql += " ORDER BY id DESC LIMIT 1";
    const [rows] = await db.query(sql, params);
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ message: "Failed to load order", error: err.message });
  }
};

exports.getOrderItems = async (req, res) => {
  const { orderId } = req.params;
  try {
    const [rows] = await db.query("SELECT * FROM order_items WHERE order_id=?", [orderId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load order items", error: err.message });
  }
};

exports.updateOrder = async (req, res) => {
  const actor = getRequestActor(req);
  const { orderId } = req.params;
  const { status, tableNumber } = req.body || {};

  try {
    const [existing] = await db.query("SELECT id, waiter_name FROM orders WHERE id = ? LIMIT 1", [orderId]);
    if (!existing.length) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (isWaiterActor(actor) && existing[0]?.waiter_name && !namesMatch(existing[0].waiter_name, actor.name)) {
      return res.status(403).json({ message: "You can update only your own order" });
    }

    const fields = [];
    const values = [];

    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }

    if (tableNumber !== undefined) {
      fields.push("table_number = ?");
      values.push(tableNumber);
    }

    if (!fields.length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    values.push(orderId);
    await db.query(`UPDATE orders SET ${fields.join(", ")} WHERE id = ?`, values);
    res.json({ message: "Order updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update order", error: err.message });
  }
};

exports.deleteOrder = async (req, res) => {
  const actor = getRequestActor(req);
  const { orderId } = req.params;
  try {
    const [existing] = await db.query("SELECT id, waiter_name FROM orders WHERE id = ? LIMIT 1", [orderId]);
    if (!existing.length) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (isWaiterActor(actor) && existing[0]?.waiter_name && !namesMatch(existing[0].waiter_name, actor.name)) {
      return res.status(403).json({ message: "You can delete only your own order" });
    }

    const result = await db.query("DELETE FROM orders WHERE id = ?", [orderId]);
    res.json({ message: "Order deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete order", error: err.message });
  }
};

exports.payOrder = async (req, res) => {
  const actor = getRequestActor(req);
  const { tableNumber } = req.params;
  try {
    const params = [tableNumber];
    // orders.status enum is pending/confirmed/preparing/ready/served/completed/cancelled
    // ('paid' was inserted by older code and truncated on write).
    let sql = "UPDATE orders SET status='completed' WHERE table_number=? AND status='pending'";
    if (isWaiterActor(actor) && actor.name) {
      sql += " AND LOWER(COALESCE(waiter_name, '')) = LOWER(?)";
      params.push(actor.name);
    }
    const [result] = await db.query(sql, params);
    if (!result.affectedRows) {
      return res.json({ message: "Order already settled" });
    }
    res.json({ message: "Order marked paid" });
  } catch (err) {
    res.status(500).json({ message: "Failed to pay order", error: err.message });
  }
};

/* ================= BILLS ================= */

const mapInvoiceStatusToPaymentStatus = (status) => {
  const s = String(status || "").toLowerCase().trim();
  if (["paid", "post to room", "posted to room", "settled"].includes(s)) return "paid";
  if (["unpaid", "saved", "draft"].includes(s)) return "unpaid";
  if (["partial", "partially paid"].includes(s)) return "partial";
  if (["refunded", "refund"].includes(s)) return "refunded";
  if (["cancelled", "canceled", "cancelled"].includes(s)) return "cancelled";
  return "unpaid";
};

// bills.payment_method is an enum; an unknown value throws "Data truncated"
// and surfaces as a raw 500. Map to "other" instead of rejecting, matching the
// column default's tolerance.
const normalizePaymentMethod = (value) => {
  const allowed = new Set(["cash", "card", "upi", "wallet", "net_banking", "credit", "other"]);
  const aliases = {
    upi: "upi",
    "net banking": "net_banking",
    netbanking: "net_banking",
    netbank: "net_banking",
    "online banking": "net_banking",
    online: "net_banking",
    "card payment": "card",
    "credit card": "card",
    "debit card": "card",
    emi: "card",
    swish: "other",
  };
  const s = String(value || "").toLowerCase().trim();
  if (!s) return null;
  return allowed.has(aliases[s] || s) ? (aliases[s] || s) : "other";
};

const createRestaurantBill = async (data) => {
  const conn = await db.getConnection();
  try {
    const reusableBill = await findReusableOpenBill(conn, data);
    if (reusableBill?.id) {
      await conn.query(
        `
          UPDATE bills
          SET token_id=?,
              waiter_name=?,
              customer_name=?,
              phone=?,
              subtotal=?,
              service_charge=?,
              tax_amount=?,
              total=?,
              discount_amount=?,
              payment_method=?,
              payment_status=?,
              split_no=?,
              split_count=?
          WHERE id=?
        `,
        [
          data.tokenId ? Number(data.tokenId) : null,
          buildResolvedWaiterName(data),
          data.customerName || null,
          data.phone || null,
          Number(data.subtotal || 0),
          Number(data.serviceCharge || 0),
          Number(data.gst || 0),
          Number(data.total || 0),
          Number(data.discountAmount || 0),
          data.paymentMethod ? normalizePaymentMethod(data.paymentMethod) : null,
          mapInvoiceStatusToPaymentStatus(data.paymentStatus || data.invoiceStatus || "unpaid"),
          data.splitNo || null,
          data.splitCount || null,
          reusableBill.id,
        ],
      );

      try {
        await syncLegacyRestaurantBill(conn, reusableBill.id);
      } catch (syncErr) {
        console.error("[restaurantController] Legacy bill sync failed (non-blocking):", syncErr.message);
      }

      return { insertId: reusableBill.id, bill: null };
    }

    // Release token_id from any settled bill that would block the INSERT
    if (data.tokenId) {
      await conn.query(
        `UPDATE bills SET token_id = NULL WHERE token_id = ? AND LOWER(COALESCE(payment_status, 'unpaid')) IN ('paid', 'posted to room')`,
        [Number(data.tokenId)],
      );
    }

    const sql = `
      INSERT INTO bills
      (table_number, token_id, entity_type, waiter_name, customer_name, phone, subtotal, service_charge, tax_amount, total, discount_amount, payment_method, payment_status, split_no, split_count)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    const [result] = await conn.query(sql, [
      data.table || data.tableNumber || "Room Charge",
      data.tokenId ? Number(data.tokenId) : null,
      data.entityType || "Table",
      buildResolvedWaiterName(data),
      data.customerName || null,
      data.phone || null,
      Number(data.subtotal || 0),
      Number(data.serviceCharge || 0),
      Number(data.gst || 0),
      Number(data.total || 0),
      Number(data.discountAmount || 0),
      data.paymentMethod ? normalizePaymentMethod(data.paymentMethod) : null,
      mapInvoiceStatusToPaymentStatus(data.invoiceStatus || "unpaid"),
      data.splitNo || null,
      data.splitCount || null,
    ]);

    try {
      await syncLegacyRestaurantBill(conn, result.insertId);
    } catch (syncErr) {
      console.error("[restaurantController] Legacy bill sync failed (non-blocking):", syncErr.message);
    }

    return { insertId: result.insertId, bill: null };
  } finally {
    conn.release();
  }
};

const buildResolvedWaiterName = (data) =>
  String(data.waiterName || "").trim() ||
  (String(data.entityType || "Table").toLowerCase() === "room" ? "Room Service" : "Waiter");

const findReusableOpenBill = async (conn, data) => {
  const normalizedStatus = String(data.invoiceStatus || "Saved").toLowerCase();
  const canReuseOpenBill = normalizedStatus !== "paid";
  if (!canReuseOpenBill) return null;

  if (data.tokenId) {
    const [rows] = await conn.query(
      `
        SELECT id
        FROM bills
        WHERE token_id=?
          AND entity_type=?
          AND LOWER(COALESCE(payment_status, 'unpaid')) NOT IN ('paid')
        ORDER BY id DESC
        LIMIT 1
      `,
      [Number(data.tokenId), data.entityType || "Table"],
    );

    return rows[0] || null;
  }

  const [rows] = await conn.query(
    `
      SELECT id
      FROM bills
      WHERE table_number=?
        AND entity_type=?
        AND LOWER(COALESCE(payment_status, 'unpaid')) NOT IN ('paid')
      ORDER BY id DESC
      LIMIT 1
    `,
    [data.table, data.entityType || "Table"],
  );

  return rows[0] || null;
};

const findReusableLegacyBillRow = async (conn, billRow) => {
  // Legacy restaurant_bills table no longer exists in v4
  return null;
};

const scoreLegacyBillCandidate = (billRow, legacyRow) => {
  const billTokenId = Number(billRow?.tokenId || 0);
  const legacyTokenId = Number(legacyRow?.tokenId || 0);
  const sameEntityType = String(legacyRow?.entityType || "").toLowerCase() === String(billRow?.entityType || "").toLowerCase();
  const sameTable = String(legacyRow?.tableNumber || "").toLowerCase() === String(billRow?.tableNumber || "").toLowerCase();
  let score = 0;

  if (billTokenId && legacyTokenId === billTokenId && sameEntityType) score += 100;
  if (sameTable && sameEntityType) score += 40;
  if (Number(legacyRow?.total || 0) === Number(billRow?.total || 0)) score += 10;
  if (Number(legacyRow?.subtotal || 0) === Number(billRow?.subtotal || 0)) score += 6;
  if (String(legacyRow?.customerName || "").toLowerCase() && String(legacyRow?.customerName || "").toLowerCase() === String(billRow?.customerName || "").toLowerCase()) score += 4;
  if (String(legacyRow?.phone || "").toLowerCase() && String(legacyRow?.phone || "").toLowerCase() === String(billRow?.phone || "").toLowerCase()) score += 4;
  if (String(legacyRow?.paymentMethod || "").toLowerCase() && String(legacyRow?.paymentMethod || "").toLowerCase() === String(billRow?.paymentMethod || "").toLowerCase()) score += 2;
  if (String(legacyRow?.invoiceStatus || "").toLowerCase() && String(legacyRow?.invoiceStatus || "").toLowerCase() === String(billRow?.invoiceStatus || "").toLowerCase()) score += 2;

  return score;
};

const pickBestLegacyBillCandidate = (billRow, legacyRows) =>
  [...legacyRows].sort((leftRow, rightRow) => {
    const scoreDiff = scoreLegacyBillCandidate(billRow, rightRow) - scoreLegacyBillCandidate(billRow, leftRow);
    if (scoreDiff !== 0) return scoreDiff;

    const billTime = new Date(billRow?.created_at || 0).getTime();
    const leftDiff = Math.abs(new Date(leftRow?.created_at || 0).getTime() - billTime);
    const rightDiff = Math.abs(new Date(rightRow?.created_at || 0).getTime() - billTime);
    if (leftDiff !== rightDiff) return leftDiff - rightDiff;

    return Number(rightRow?.id || 0) - Number(leftRow?.id || 0);
  })[0] || null;

const syncLegacyRestaurantBill = async () => {
  // V4 no-op: restaurant_bills table removed
};

const processBillPayment = async (data) => {
  const conn = await db.getConnection();
  const paymentsTableName = process.env.PAYMENTS_TABLE_NAME || "payments";

  try {
    await conn.beginTransaction();

    let billId = Number(data.billId || 0) || null;
    let billRow = null;

    if (!billId) {
      const lookupTokenId = Number(data.tokenId || 0) || null;
      const lookupEntityType = data.entityType || "Table";

      if (lookupTokenId) {
        const [matchedBills] = await conn.query(
          `
            SELECT id
            FROM bills
            WHERE token_id=?
              AND entity_type=?
              AND payment_status IN ('unpaid', 'partial')
            ORDER BY id DESC
            LIMIT 1
          `,
          [lookupTokenId, lookupEntityType],
        );
        if (matchedBills?.[0]?.id) {
          billId = Number(matchedBills[0].id);
        }
      }

      if (!billId) {
        const [matchedBills] = await conn.query(
          `
            SELECT id
            FROM bills
            WHERE table_number=?
              AND entity_type=?
              AND payment_status IN ('unpaid', 'partial')
            ORDER BY id DESC
            LIMIT 1
          `,
          [data.table || data.tableNumber, lookupEntityType],
        );
        if (matchedBills?.[0]?.id) {
          billId = Number(matchedBills[0].id);
        }
      }
    }

    if (billId) {
      const [existingBills] = await conn.query("SELECT * FROM bills WHERE id=? LIMIT 1 FOR UPDATE", [billId]);
      billRow = existingBills[0];

      if (!billRow) {
        const error = new Error("Bill not found");
        error.statusCode = 404;
        throw error;
      }

      const currentStatus = String(billRow.payment_status || "").toLowerCase();
      if (currentStatus === "paid" || currentStatus === "posted to room") {
        const error = new Error("Bill already paid");
        error.statusCode = 409;
        throw error;
      }

      // The status column can lag behind completed payment rows (a bill 53
      // row was deleted after its payments were recorded, so a re-payment
      // against a recreated or re-fetched bill would duplicate). Count the
      // completed payments on this bill and block when one already exists.
      const [completedPayments] = await conn.query(
        `SELECT COUNT(*) AS n FROM ${paymentsTableName} WHERE bill_id = ? AND status = 'completed'`,
        [billId],
      );
      if (Number(completedPayments?.[0]?.n || 0) > 0) {
        const error = new Error("Bill already paid");
        error.statusCode = 409;
        throw error;
      }

      await conn.query(
        `
          UPDATE bills
          SET customer_name=?,
              phone=?,
              subtotal=?,
              service_charge=?,
              tax_amount=?,
              total=?,
              discount_amount=?,
              payment_method=?
          WHERE id=?
        `,
        [
          data.customerName || billRow.customer_name || null,
          data.phone || billRow.phone || null,
          Number(data.subtotal ?? billRow.subtotal ?? 0),
          Number(data.serviceCharge ?? billRow.service_charge ?? 0),
          Number(data.gst ?? billRow.tax_amount ?? 0),
          Number(data.total ?? billRow.total ?? 0),
          Number(data.discountAmount ?? billRow.discount_amount ?? 0),
          normalizePaymentMethod(data.paymentMethod || billRow.payment_method || null),
          billId,
        ],
      );

      await syncLegacyRestaurantBill(conn, billId);

      const [updatedBills] = await conn.query("SELECT * FROM bills WHERE id=? LIMIT 1", [billId]);
      billRow = updatedBills[0];
    } else {
      billId = await createRestaurantBill({
        ...data,
        paymentMethod: data.paymentMethod,
        invoiceStatus: "Paid",
      }).then(r => r.insertId);

      const [createdBills] = await conn.query("SELECT * FROM bills WHERE id=? LIMIT 1", [billId]);
      billRow = createdBills[0];
    }

    const [paymentTables] = await conn.query("SHOW TABLES LIKE ?", [paymentsTableName]);
    if (!Array.isArray(paymentTables) || !paymentTables.length) {
      const error = new Error("Payments module is temporarily unavailable until the payments table is repaired.");
      error.statusCode = 503;
      throw error;
    }

    const [paymentResult] = await conn.query(
      `
        INSERT INTO ${paymentsTableName} (bill_id, amount, payment_method_id, payment_type, status, received_by, created_at)
        VALUES (?, ?, ?, 'payment', 'completed', ?, NOW())
      `,
      [
        Number(billId),
        Number(billRow.total || data.total || 0),
        await resolvePaymentMethodId(data.paymentMethod || billRow.payment_method || "Cash"),
        data.user?.id || billRow.created_by || null,
      ],
    );

    const transactionDate = new Date().toISOString().slice(0, 10);
    const entityLabel =
      String(billRow.entity_type || data.entityType || "Table").toLowerCase() === "room" ? "Room" : "Table";
    const entityRef = billRow.table_number || data.table || "--";
    const description = `Restaurant bill payment - ${entityLabel} ${entityRef} - Bill #${billId}`;

    const [accountResult] = await conn.query(
      `
        INSERT INTO accounts_transactions (date, type, description, amount, payment_mode)
        VALUES (?, 'Income', ?, ?, ?)
      `,
      [transactionDate, description, Number(billRow.total || data.total || 0), data.paymentMethod || "Cash"],
    );

    await conn.query(
      `
        UPDATE bills
        SET payment_status='paid',
            payment_method=?,
            paid_amount=COALESCE(paid_amount,0)+?,
            paid_at=NOW()
        WHERE id=?
      `,
      [normalizePaymentMethod(data.paymentMethod || billRow.payment_method || null), Number(billRow.total || data.total || 0), billId],
    );

    if (billRow.table_number) {
      await conn.query(
        "UPDATE tokens SET status='completed' WHERE table_number=? AND status='active'",
        [billRow.table_number],
      );

      await conn.query(
        "UPDATE orders SET status='completed' WHERE table_number=? AND status='pending'",
        [billRow.table_number],
      );
    }

    await syncLegacyRestaurantBill(conn, billId);

    await conn.commit();

    return {
      billId,
      paymentId: paymentResult.insertId,
      accountTransactionId: accountResult.insertId,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const chargeBillToRoom = async (data) => {
  const traceId = `cbr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const log = (msg, extra) =>
    console.log(`[chargeBillToRoom ${traceId}] ${msg}`, extra !== undefined ? JSON.stringify(extra) : "");

  log("START", {
    billId: data?.billId,
    roomNumber: data?.roomNumber,
    bookingId: data?.bookingId,
    total: data?.total,
    splitCount: data?.splitCount,
    splitsLen: Array.isArray(data?.splits) ? data.splits.length : 0,
    table: data?.table,
    tableNumber: data?.tableNumber,
  });

  // Ensure hotel_folio_entries table exists (schema is also bootstrapped in app.js,
  // but we double-check here in case the server was started without that path).
  const [folioTables] = await db.query("SHOW TABLES LIKE 'hotel_folio_entries'");
  if (!Array.isArray(folioTables) || !folioTables.length) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS hotel_folio_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        booking_id BIGINT UNSIGNED NOT NULL,
        entry_date DATE NOT NULL,
        entry_type ENUM('Room Charge','Extra Charge','Adjustment','Payment','Tax') NOT NULL DEFAULT 'Room Charge',
        category VARCHAR(80) NULL,
        description VARCHAR(255) NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }
  log("folio schema ready");

  const conn = await db.getConnection();
  log("connection acquired");

  try {
    await conn.beginTransaction();
    log("transaction started");

    let billId = Number(data.billId || 0) || null;
    let billRow = null;

    if (billId) {
      log("looking up existing bill", { billId });
      const [existingBills] = await conn.query("SELECT * FROM bills WHERE id = ? LIMIT 1 FOR UPDATE", [billId]);
      billRow = existingBills?.[0] || null;
      log("existing bill lookup done", { found: !!billRow, invoiceStatus: billRow?.invoiceStatus });
    }

    if (!billRow) {
      log("creating new bill record");
      billId = await createRestaurantBill({
        table: data.table || data.tableNumber,
        tokenId: data.tokenId || null,
        entityType: data.entityType || "Table",
        waiterName: data.waiterName || null,
        customerName: data.customerName || "",
        phone: data.phone || "",
        subtotal: Number(data.subtotal || 0),
        serviceCharge: Number(data.serviceCharge || 0),
        gst: Number(data.gst || 0),
        total: Number(data.total || 0),
        discountAmount: Number(data.discountAmount || data.discount || 0),
        paymentMethod: data.paymentMethod || null,
        invoiceStatus: "Posted To Room",
        splitNo: data.splitNo || null,
        splitCount: data.splitCount || null,
      }).then(r => r.insertId);

      const [createdBills] = await conn.query("SELECT * FROM bills WHERE id = ? LIMIT 1", [billId]);
      billRow = createdBills?.[0] || null;
      log("new bill created", { billId, found: !!billRow });
    }

    if (!billRow) {
      const error = new Error("Bill not found after create");
      error.statusCode = 404;
      throw error;
    }

    const currentStatus = String(billRow.payment_status || "").toLowerCase();
    if (currentStatus === "paid") {
      const error = new Error("Bill already settled");
      error.statusCode = 409;
      throw error;
    }

    // Same lagging-status hazard as the direct-pay path: a completed payment
    // row on this bill means it is settled even when payment_status was not
    // updated (deleted/recreated bills). Block re-charging.
    const [completedPayments] = await conn.query(
      `SELECT COUNT(*) AS n FROM ${paymentsTableName} WHERE bill_id = ? AND status = 'completed'`,
      [billId],
    );
    if (Number(completedPayments?.[0]?.n || 0) > 0) {
      const error = new Error("Bill already settled");
      error.statusCode = 409;
      throw error;
    }

    const roomNumber = String(data.roomNumber || data.room || "").trim();
    const targetBookingId = Number(data.bookingId || billRow.room_booking_id || 0) || null;

    let bookingRow = null;
    if (targetBookingId) {
      try {
        const [guestRows] = await conn.query(
          "SELECT id, booking_code, guest_name, booking_status FROM guests WHERE id = ? LIMIT 1",
          [targetBookingId],
        );
        bookingRow = guestRows?.[0] || null;
      } catch {
        bookingRow = null;
      }
    }

    if (!bookingRow && roomNumber) {
      try {
        const [tariffRows] = await conn.query(
          `
            SELECT g.id AS bookingId, g.booking_code, g.guest_name, g.booking_status
            FROM guests g
            INNER JOIN room_tariff rt ON rt.booking_id = g.id
            WHERE CAST(rt.room_number AS CHAR) = CAST(? AS CHAR)
              AND LOWER(COALESCE(g.booking_status, 'confirmed')) NOT IN ('checked out', 'cancelled')
            ORDER BY
              CASE
                WHEN LOWER(COALESCE(g.booking_status, '')) LIKE '%checked in%' THEN 0
                WHEN LOWER(COALESCE(g.booking_status, '')) LIKE '%occupied%' THEN 1
                WHEN LOWER(COALESCE(g.booking_status, '')) LIKE '%in house%' THEN 2
                ELSE 3
              END,
              g.id DESC
            LIMIT 1
          `,
          [roomNumber],
        );
        bookingRow = tariffRows?.[0] || null;
      } catch {
        bookingRow = null;
      }
    }

    // Fresh v4 DBs hold bookings/booking_rooms, not guests/room_tariff.
    if (!bookingRow) {
      try {
        const [modernRows] = await conn.query(
          `
            SELECT b.id AS bookingId, b.booking_code, b.status AS booking_status
            FROM bookings b
            INNER JOIN booking_rooms br ON br.booking_id = b.id
            WHERE CAST(br.room_number AS CHAR) = CAST(? AS CHAR)
              AND b.status IN ('checked_in', 'confirmed', 'reserved')
              ${targetBookingId ? "AND b.id = ?" : ""}
            ORDER BY b.id DESC
            LIMIT 1
          `,
          targetBookingId ? [roomNumber, targetBookingId] : [roomNumber],
        );
        bookingRow = modernRows?.[0] || null;
        if (bookingRow && !bookingRow.guest_name) bookingRow.guest_name = "";
        if (bookingRow && !bookingRow.booking_code) bookingRow.booking_code = "";
      } catch {
        bookingRow = null;
      }
    }

    if (!bookingRow) {
      const error = new Error("No active booking found for this room");
      error.statusCode = 404;
      throw error;
    }

    const resolvedBookingId = Number(bookingRow.bookingId || bookingRow.id);
    const bookingCode = bookingRow.booking_code || "";
    const guestName = bookingRow.guest_name || "";

    const folioEntryId = await folioModel.createFolioEntry({
      bookingId: resolvedBookingId,
      description: `Restaurant - ${billRow.table_number || "Table"} (Bill #${billId})`,
      amount: Number(billRow.total || data.total || 0),
      entryType: "Extra Charge",
      category: "Restaurant",
      createdBy: "Restaurant",
    });

    const [paymentResult] = await conn.query(
      `
        INSERT INTO ${paymentsTableName} (bill_id, amount, payment_method_id, payment_type, status, received_by, created_at)
        VALUES (?, ?, ?, 'payment', 'completed', ?, NOW())
      `,
      [
        Number(billId),
        Number(billRow.total || data.total || 0),
        await resolvePaymentMethodId(normalizePaymentMethod(data.paymentMethod || billRow.payment_method || "Cash")),
        data.user?.id || billRow.created_by || null,
      ],
    );

    const [accountResult] = await conn.query(
      `
        INSERT INTO accounts_transactions (date, type, department, description, amount, payment_mode, source_module)
        VALUES (?, 'Income', 'Restaurant', ?, ?, ?, ?)
      `,
      [
        new Date().toISOString().slice(0, 10),
        `Restaurant bill posted to room ${roomNumber} - Bill #${billId}`,
        Number(billRow.total || data.total || 0),
        data.paymentMethod || "Credit",
        "restaurant",
      ],
    );

    await conn.query(
      `
        UPDATE bills
        SET payment_status='paid',
            payment_method=?,
            paid_at=NOW(),
            room_booking_id=?,
            room_booking_code=?,
            folio_entry_id=?
        WHERE id=?
      `,
      [
        normalizePaymentMethod(data.paymentMethod || billRow.payment_method || "Credit"),
        resolvedBookingId,
        bookingCode,
        folioEntryId,
        billId,
      ],
    );

    await syncLegacyRestaurantBill(conn, billId);

    if (billRow.table_number) {
      await conn.query(
        "UPDATE tokens SET status='completed' WHERE table_number=? AND status='active'",
        [billRow.table_number],
      );

      await conn.query(
        "UPDATE orders SET status='completed' WHERE table_number=? AND status='pending'",
        [billRow.table_number],
      );
    }

    await conn.commit();

    log("charge complete", {
      billId,
      bookingId: resolvedBookingId,
      folioEntryId,
      paymentId: paymentResult.insertId,
      accountTransactionId: accountResult.insertId,
    });

    return {
      billId,
      bookingId: resolvedBookingId,
      bookingCode,
      guestName,
      roomNumber,
      folioEntryId,
      paymentId: paymentResult.insertId,
      accountTransactionId: accountResult.insertId,
      postedAt: new Date().toISOString(),
    };
  } catch (error) {
    await conn.rollback();
    log("charge ERROR", { message: error?.message, sqlMessage: error?.sqlMessage });
    throw error;
  } finally {
    conn.release();
  }
};

exports.createBill = async (req, res) => {
  try {
    const actor = getRequestActor(req);
    const table = req.body.table || req.body.tableNumber;
    if (!table) {
      return res.status(400).json({ message: "table or tableNumber is required" });
    }

    const result = await createRestaurantBill({
      table,
      tokenId: req.body.tokenId || null,
      entityType: req.body.entityType || "Table",
      waiterName: isWaiterActor(actor) ? actor.name || req.body.waiterName || null : req.body.waiterName || null,
      customerName: req.body.customerName || "",
      phone: req.body.phone || "",
      subtotal: Number(req.body.subtotal || 0),
      gst: Number(req.body.gst || 0),
      total: Number(req.body.total || 0),
      discountAmount: Number(req.body.discountAmount || req.body.discount || 0),
      serviceCharge: Number(req.body.serviceCharge || 0),
      paymentMethod: req.body.paymentMethod || null,
      invoiceStatus: req.body.invoiceStatus || (req.body.paymentMethod ? "Paid" : "Generated"),
      splitNo: req.body.splitNo || null,
      splitCount: req.body.splitCount || null,
    });

    res.json({
      id: result.insertId || null,
      message: "Bill created",
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to create bill", error: err.message });
  }
};

// Bills have no invoice/billed date column, so created_at is the only field a report window can match.
// A bare "from" must span midnight, otherwise 2026-10-01 excludes everything dated earlier that day.
const buildBillDateFilter = (query = {}) => {
  const from = String(query.from || "").slice(0, 10);
  const to = String(query.to || "").slice(0, 10);
  const conditions = [];
  const params = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push("b.created_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push("b.created_at < ?");
    params.push(`${to} 00:00:00`);
  }
  return [conditions.length ? "WHERE " + conditions.join(" AND ") : "", params];
};

exports.getBills = async (req, res) => {
  try {
    const [conditions, params] = buildBillDateFilter(req.query);
    const [rows] = await db.query(
      `
        SELECT
          b.id,
          b.table_number,
          b.token_id AS tokenId,
          b.entity_type,
          b.waiter_name,
          b.customer_name,
          b.phone,
          b.subtotal,
          b.service_charge,
          b.tax_amount AS gst,
          b.total,
          b.discount_amount,
          b.payment_method,
          b.payment_status AS invoiceStatus,
          b.split_no,
          b.split_count,
          b.paid_at,
          b.created_at
        FROM bills b
        LEFT JOIN tokens t ON t.id = b.token_id
        ${conditions}
        ORDER BY b.created_at DESC
        LIMIT 200
      `,
      params
    );
    const actor = getRequestActor(req);
    let resultRows = rows;
    if (isWaiterActor(actor) && actor.name) {
      resultRows = rows.filter((row) => namesMatch(row.waiter_name, actor.name));
    }
    res.json(resultRows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load bills", error: err.message });
  }
};

exports.getBillById = async (req, res) => {
  try {
    const [bill] = await db.query(
      `
        SELECT
          b.id,
          b.table_number,
          b.token_id AS tokenId,
          t.token_code AS tokenCode,
          b.entity_type,
          b.waiter_name,
          b.customer_name,
          b.phone,
          b.subtotal,
          b.service_charge,
          b.tax_amount AS gst,
          b.total,
          b.discount_amount,
          b.payment_method,
          b.payment_status AS invoiceStatus,
          b.split_no,
          b.split_count,
          b.paid_at,
          b.created_at
        FROM bills b
        LEFT JOIN tokens t ON t.id = b.token_id
        WHERE b.id = ?
        LIMIT 1
      `,
      [req.params.id],
    );
    res.json(bill || {});
  } catch (err) {
    res.status(500).json({ message: "Failed to load bill", error: err.message });
  }
};

exports.payBill = async (req, res) => {
  try {
    const actor = getRequestActor(req);
    const billId = req.body?.billId || req.params?.id || null;
    const tokenId = Number(req.body?.tokenId || 0) || null;
    const tableNumber = String(req.body?.tableNumber || req.body?.table || "").trim();
    if (!billId && !tokenId && !tableNumber) {
      return res.status(400).json({ message: "billId is required" });
    }

    const result = await processBillPayment({
      ...req.body,
      billId: req.body?.billId || req.params?.id || null,
    });

    // Auto-print restaurant bill receipt after payment
    setImmediate(async () => {
      try {
        const { RestaurantPrintService } = require("../services/RestaurantPrintService");
        const { InvoicePrintService } = require("../services/InvoicePrintService");

        const [billForPrint] = await db.query("SELECT * FROM bills WHERE id = ? LIMIT 1", [result.billId]);
        const [tokenItemsRows] = await db.query(
          "SELECT item_name, qty, rate FROM token_items WHERE token_id = (SELECT token_id FROM bills WHERE id = ?)",
          [result.billId],
        );

        const billItems = tokenItemsRows.length > 0
          ? tokenItemsRows.map((r) => ({ name: r.item_name, qty: Number(r.qty || 1), rate: Number(r.rate || 0) }))
          : (req.body.items || []);

        const printPayload = {
          ...result,
          invoiceNo: String(result.billId || ""),
          items: billItems,
          subtotal: Number(billForPrint?.subtotal || req.body.subtotal || 0),
          gst: Number(billForPrint?.gst || req.body.gst || 0),
          serviceCharge: Number(billForPrint?.serviceCharge || req.body.serviceCharge || 0),
          discount: Number(billForPrint?.discountAmount || billForPrint?.discount || req.body.discountAmount || 0),
          discountAmount: Number(billForPrint?.discountAmount || billForPrint?.discount || req.body.discountAmount || 0),
          customerName: req.body.customerName || req.body.customer_name || billForPrint?.customerName || "Walk-in Customer",
          phone: req.body.phone || req.body.customer_phone || billForPrint?.phone || "",
          tableNumber: req.body.tableNumber || req.body.table || billForPrint?.tableNumber || "",
          roomNumber: req.body.roomNumber || req.body.room || "",
          paymentMethod: req.body.paymentMethod || req.body.payment_method || billForPrint?.paymentMethod || "Cash",
          printedBy: actor.name || actor.email || "System",
          waiter: billForPrint?.waiter_name || req.body.waiterName || "",
        };

        // Print thermal POS receipt (itemized with SGST/CGST)
        await RestaurantPrintService.immediatePrintRestaurantBill(printPayload);

        // Also print A4 copy
        await InvoicePrintService.immediatePrintInvoice("restaurant_bill_a4", {
          ...result,
          ...printPayload,
          customerName: printPayload.customerName,
          tableNumber: printPayload.tableNumber,
          roomNumber: printPayload.roomNumber,
          paymentMode: printPayload.paymentMethod,
          printedBy: printPayload.printedBy,
        });
      } catch (err) {
        console.error("[auto-print] restaurant bill print failed:", err.message);
      }
    });

    res.json({
      message: "Bill payment successful",
      ...result,
    });
  } catch (error) {
    res.status(Number(error.statusCode || 500)).json({
      message: error.message || "Bill payment failed",
    });
  }
};

exports.chargeBillToRoom = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot charge bill to room" });
  }

  const billId = req.body?.billId || req.params?.id || null;
  const roomNumber = String(req.body?.roomNumber || "").trim();
  const bookingId = Number(req.body?.bookingId || 0) || null;

  if (!billId && !roomNumber) {
    return res.status(400).json({ message: "billId or roomNumber is required" });
  }

  if (billId && !roomNumber && !bookingId) {
    return res.status(400).json({ message: "roomNumber or bookingId is required to charge bill to room" });
  }

  try {
    const result = await chargeBillToRoom({
      ...req.body,
      billId,
    });

    res.json({
      message: "Bill posted to room successfully",
      ...result,
    });
  } catch (error) {
    console.error("[chargeBillToRoom] ERROR:", error?.message, error?.sqlMessage);
    res.status(Number(error.statusCode || 500)).json({
      message: error.message || "Unable to post bill to room",
    });
  }
};

/* ================= ITEM ACTION / SPLIT / METRICS ================= */

exports.addItemActionRequest = async (req, res) => {
  const actor = getRequestActor(req);
  const { tokenItemId, tableNumber, actionType, reason, requestedBy } = req.body || {};
  if (!tokenItemId || !tableNumber || !actionType || !reason) {
    return res.status(400).json({ message: "Missing action request fields" });
  }

  try {
    const [result] = await db.query(
      `
        INSERT INTO restaurant_item_action_requests
        (token_item_id, table_number, action_type, reason, requested_by, status)
        VALUES (?, ?, ?, ?, ?, 'Pending')
      `,
      [
        tokenItemId,
        tableNumber,
        actionType,
        reason,
        isWaiterActor(actor) ? actor.name || requestedBy : requestedBy,
      ],
    );
    res.json({ message: "Item action request created", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: "Failed to create action request", error: err.message });
  }
};

exports.getItemActionRequests = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT *
        FROM restaurant_item_action_requests
        ORDER BY created_at DESC, id DESC
      `
    );
    const actor = getRequestActor(req);
    let resultRows = rows;
    if (isWaiterActor(actor) && actor.name) {
      resultRows = rows.filter((row) => namesMatch(row.requested_by, actor.name));
    }
    res.json(resultRows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load item action requests", error: err.message });
  }
};

exports.reviewItemActionRequest = async (req, res) => {
  const actor = getRequestActor(req);
  if (isWaiterActor(actor)) {
    return res.status(403).json({ message: "Waiter cannot review action requests" });
  }

  const { id } = req.params;
  const { status, managerNote, approvedBy } = req.body || {};
  if (!status) {
    return res.status(400).json({ message: "Status is required" });
  }

  try {
    await db.query(
      `
        UPDATE restaurant_item_action_requests
        SET status=?, manager_note=?, approved_by=?
        WHERE id=?
      `,
      [status, managerNote || null, approvedBy || null, id],
    );
    res.json({ message: "Item action request updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update action request", error: err.message });
  }
};

exports.createSplitBill = async (req, res) => {
  const traceId = `csb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[createSplitBill ${traceId}] request body keys:`, Object.keys(req.body || {}));
  console.log(`[createSplitBill ${traceId}] tableNumber:`, req.body?.tableNumber, "splitLabel:", req.body?.splitLabel, "splitNo:", req.body?.splitNo, "splitCount:", req.body?.splitCount);

  const {
    tableNumber,
    entityType,
    splitLabel,
    splitNo,
    splitCount,
    subtotal,
    gst,
    total,
    paymentMethod,
    items,
    billId,
  } = req.body || {};

  if (!tableNumber || !splitLabel || !splitNo || !splitCount) {
    return res.status(400).json({ message: "Missing split bill fields" });
  }

  console.log(`[createSplitBill ${traceId}] inserting split bill`);
  const startTime = Date.now();

  try {
    const [result] = await db.query(
      `
        INSERT INTO restaurant_split_bills
        (bill_id, table_number, entity_type, split_label, split_no, split_count, subtotal, gst, total, payment_method, items_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        billId || null,
        tableNumber,
        entityType || "Table",
        splitLabel,
        splitNo,
        splitCount,
        Number(subtotal || 0),
        Number(gst || 0),
        Number(total || 0),
        paymentMethod || null,
        JSON.stringify(items || []),
      ],
    );
    const elapsed = Date.now() - startTime;
    console.log(`[createSplitBill ${traceId}] success after ${elapsed}ms, insertId:`, result?.insertId);
    res.json({ message: "Split bill saved", id: result.insertId });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[createSplitBill ${traceId}] ERROR after ${elapsed}ms:`, err.message);
    res.status(500).json({ message: "Failed to create split bill", error: err.message });
  }
};

exports.getWaiterPerformance = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT
          COALESCE(NULLIF(TRIM(waiter_name), ''), 'Waiter') AS waiterName,
          COUNT(*) AS billsHandled,
          COALESCE(SUM(total), 0) AS salesTotal,
          COALESCE(AVG(total), 0) AS avgBillValue
        FROM bills
        GROUP BY COALESCE(NULLIF(TRIM(waiter_name), ''), 'Waiter')
        ORDER BY salesTotal DESC, billsHandled DESC
      `
    );
    const actor = getRequestActor(req);
    let resultRows = rows;
    if (isWaiterActor(actor) && actor.name) {
      resultRows = rows.filter((row) => namesMatch(row.waiterName, actor.name));
    }
    res.json(resultRows);
  } catch {
    res.json([]);
  }
};
