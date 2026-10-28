const RoomService = require("../models/RoomServiceModel");
const Kitchen = require("../models/KotOrdersModel");

const TAX_RATE = 0.1; // 10%

const parseMoney = (val) => {
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
};

const computeTotals = (items) => {
  const subtotal = items.reduce(
    (sum, it) => sum + parseMoney(it.price) * parseMoney(it.quantity),
    0
  );
  const tax = Number((subtotal * TAX_RATE).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  return { subtotal, tax, total };
};

/* ================= ROOMS ================= */

exports.addRoom = (req, res) => {
  const number = req.body.number;

  if (!number)
    return res.status(400).json({ message: "Room number required" });

  RoomService.addRoom({ number }, (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ message: "Room already exists" });
      }
      // Surface readable DB error
      return res
        .status(500)
        .json({ message: err.sqlMessage || err.message || "Database error" });
    }

    res.json({
      message: "Room added",
      id: result.insertId,
    });
  });
};

exports.getRooms = (req, res) => {
  RoomService.getRooms((err, data) => {
    if (err) return res.status(500).json(err);

    res.json(data);
  });
};

/* ================= MENU ================= */

exports.addMenuItem = (req, res) => {
  const { name, price, category } = req.body;

  if (!name || !price)
    return res.status(400).json({ message: "Name and price required" });

  RoomService.addMenuItem({ name, price, category }, (err, result) => {
    if (err) return res.status(500).json(err);

    res.json({
      message: "Room menu item added",
      id: result.insertId,
    });
  });
};

exports.getMenuItems = (req, res) => {
  RoomService.getMenuItems((err, data) => {
    if (err) return res.status(500).json(err);

    res.json(data);
  });
};

exports.getOrderItems = (req, res) => {
  const orderId = req.params.orderId;

  RoomService.getOrderItems(orderId, (err, data) => {
    if (err) return res.status(500).json(err);

    res.json(data);
  });
};

exports.deleteMenuItem = (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ message: "Menu item id required" });
  }

  RoomService.deleteMenuItem(id, (err, result) => {
    if (err) return res.status(500).json(err);

    if (!result || !result.affectedRows) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    res.json({ message: "Room menu item deleted", id: Number(id) });
  });
};

/* ================= ORDER ================= */

exports.addOrderItem = (req, res) => {
  const { roomNumber, items, item, name, price, quantity, qty } = req.body;

  if (!roomNumber)
    return res.status(400).json({ message: "roomNumber is required" });

  // Allow items/item to arrive as JSON string (common with form-data)
  const parseMaybeJson = (val) => {
    if (typeof val !== "string") return val;
    const attempts = [
      (v) => JSON.parse(v),
      // replace single quotes with double quotes
      (v) => JSON.parse(v.replace(/'/g, '"')),
      // quote bare keys  foo:  -> "foo":
      (v) =>
        JSON.parse(
          v
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        ),
    ];
    for (const fn of attempts) {
      try {
        return fn(val);
      } catch (_) {}
    }
    return val;
  };

  const itemsParsed = parseMaybeJson(items);
  const itemParsed = parseMaybeJson(item);

  // Normalize payload to an array of items
  const rawItems =
    (Array.isArray(itemsParsed) && itemsParsed.length ? itemsParsed : null) ||
    (itemParsed ? [itemParsed] : null) ||
    (name || price != null
      ? [{ name, price, quantity: quantity ?? qty }]
      : null);

  if (!rawItems || !rawItems.length) {
    return res
      .status(400)
      .json({ message: "item with name and price is required" });
  }

  // Normalize keys and coerce numbers
  const payloadItems = [];

  // Validate each item
  for (const it of rawItems) {
    if (!it) {
      return res
        .status(400)
        .json({ message: "item with name and price is required" });
    }

    const normalized = {
      name: it.name || it.item_name || it.itemName,
      price: it.price ?? it.amount ?? it.rate,
      quantity: it.quantity ?? it.qty,
    };

    if (!normalized.name || normalized.price == null) {
      return res
        .status(400)
        .json({ message: "item with name and price is required" });
    }

    normalized.price = Number(normalized.price);
    if (Number.isNaN(normalized.price))
      return res
        .status(400)
        .json({ message: "price must be a number" });

    if (normalized.quantity == null) normalized.quantity = 1;
    normalized.quantity = Number(normalized.quantity);
    if (Number.isNaN(normalized.quantity) || normalized.quantity <= 0)
      normalized.quantity = 1;

    payloadItems.push(normalized);
  }

  const addItemsToOrder = (orderId, itemsList) => {
    let done = 0;
    let hasError = false;

    itemsList.forEach((it) => {
      RoomService.addItemToOrder(orderId, it, (err) => {
        if (hasError) return;
        if (err) {
          hasError = true;
          return res.status(500).json(err);
        }
        done += 1;
        if (done === itemsList.length) {
          // Push to kitchen once items are persisted
          const kitchenOrder = {
            table_number: String(roomNumber),
            waiter_name: "Room Service",
            items: JSON.stringify(itemsList),
            status: "Pending",
          };

          Kitchen.createOrder
            ? Kitchen.createOrder(kitchenOrder, (kErr) => {
                if (kErr) {
                  // kitchen failure should not block room order creation
                  console.error("Kitchen createOrder failed:", kErr);
                }
                res.json({
                  message: "Items added to room order",
                  orderId,
                  kitchen: kErr ? "kitchen push failed" : "sent to kitchen",
                });
              })
            : res.json({
                message: "Items added to room order",
                orderId,
                kitchen: "kitchen push skipped (no KOT model)",
              });
        }
      });
    });
  };

  const orderTotal = payloadItems.reduce(
    (sum, it) => sum + Number(it.price) * Number(it.quantity || 1),
    0
  );

  // Mirror the order into room_service_orders so the waiter queue has
  // something to pick up — that table is otherwise never populated.
  try {
    RoomService.createDeliveryOrder(
      { room_number: String(roomNumber), waiter_name: "Room Service", total: orderTotal },
      () => {}
    );
  } catch (e) {
    console.error("Room service delivery row creation failed:", e.message);
  }

  RoomService.getPendingOrder(roomNumber, (err, order) => {
    if (err) return res.status(500).json(err);

    if (!order) {
      RoomService.createOrder(roomNumber, (err2, result) => {
        if (err2) return res.status(500).json(err2);
        addItemsToOrder(result.insertId, payloadItems);
      });
    } else {
      addItemsToOrder(order.id, payloadItems);
    }
  });
};

exports.getOrder = (req, res) => {
  const roomNumber = req.params.roomNumber;

  RoomService.getPendingOrder(roomNumber, (err, data) => {
    if (err) return res.status(500).json(err);

    res.json(data);
  });
};

exports.payOrder = (req, res) => {
  const roomNumber = req.params.roomNumber;

  RoomService.getPendingOrder(roomNumber, (err, order) => {
    if (err) return res.status(500).json(err);
    if (!order)
      return res.status(404).json({ message: "No pending room order found" });

    RoomService.markOrderPaid(order.id, (err2) => {
      if (err2) return res.status(500).json(err2);
      res.json({ message: "Room order marked as paid" });
    });
  });
};

/* ================= BILL ================= */

exports.createBill = (req, res) => {
  const body = req.body || {};
  if (!body.roomNumber && !body.room_number) {
    return res.status(400).json({ message: "roomNumber is required" });
  }
  RoomService.createBill(body, (err, result) => {
    if (err) return res.status(500).json(err);

    res.json({
      message: "Room bill created",
      id: result.insertId,
    });
  });
};

// GET bill data with totals for pending order of a room
exports.generateBillForRoom = (req, res) => {
  const roomNumber = req.params.roomNumber;
  if (!roomNumber)
    return res.status(400).json({ message: "roomNumber is required" });

  RoomService.getOrderWithItemsByRoom(roomNumber, (err, data) => {
    if (err) return res.status(500).json(err);
    if (!data) return res.status(404).json({ message: "No pending order" });

    const { order, items } = data;
    const totals = computeTotals(items);

    res.json({
      orderId: order.id,
      roomNumber: order.roomNumber,
      items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      status: order.status,
    });
  });
};

/* ================= ORDER STATUS ================= */
exports.updateStatus = (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const allowed = ["pending", "preparing", "served", "paid"];
  if (!allowed.includes(status)) {
    return res
      .status(400)
      .json({ message: `status must be one of ${allowed.join(", ")}` });
  }

  RoomService.updateOrderStatus(orderId, status, (err) => {
    if (err) return res.status(500).json(err);

    if (global.io) {
      global.io.emit("room-order-status", { orderId, status });
    }

    res.json({ message: "Status updated", orderId, status });
  });
};
