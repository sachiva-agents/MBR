const db = require("../config/db");

const columnExists = async (tableName, columnName) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows?.[0]?.count || 0) > 0;
};

const tableExists = async (tableName) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.count || 0) > 0;
};

const getConnection = async () => {
  // db.getConnection() resolves to the connection itself, not a [connection, fields] tuple
  return await db.getConnection();
};

const queryWithConnection = async (connection, sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  return rows;
};

// Resolves a location by explicit id or name against inventory_locations, or
// null so the caller can skip the location-scoped bookkeeping.
const resolveStockLocation = async (connection, locationName, locationId) => {
  const explicit = Number(locationId);
  if (explicit > 0) return explicit;
  if (!locationName || !(await tableExists("inventory_locations"))) return null;
  const rows = await queryWithConnection(
    connection,
    "SELECT id FROM inventory_locations WHERE LOWER(name) = LOWER(?) ORDER BY id LIMIT 1",
    [String(locationName).trim()],
  );
  return rows?.[0]?.id || null;
};

const locationStock = async (connection, itemId, locationId) => {
  const rows = await queryWithConnection(
    connection,
    "SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_stock WHERE inventory_item_id = ? AND location_id = ?",
    [itemId, locationId],
  );
  return normalizeNumber(rows?.[0]?.total);
};

const beginTransaction = async (connection) => {
  await connection.beginTransaction();
};

const commitTransaction = async (connection) => {
  await connection.commit();
};

const rollbackTransaction = async (connection) => {
  await connection.rollback();
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;
  const dateOnly = stringValue.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
};

// Items live in one of two tables whose columns do not overlap: the legacy
// `inventory` table keeps stock/unit/price inline, `inventory_items` has
// unit_cost/selling_price but no stock column at all (stock is per location
// in inventory_stock). Each table is therefore read with its own projection.
const ITEM_TABLES = ["inventory", "inventory_items"];
const ITEM_SELECT = {
  inventory: `SELECT id, name, unit, price, stock, price AS unit_cost, price AS selling_price`,
  inventory_items: `SELECT id, name, unit_id, unit_cost, selling_price, 0 AS price`,
};

const normaliseItemRow = (row) => ({
  id: Number(row.id),
  name: row.name,
  stock: row.stock != null ? normalizeNumber(row.stock) : null,
  unit: row.unit ?? row.unit_id ?? null,
  price: normalizeNumber(row.price ?? row.selling_price ?? row.unit_cost),
  unit_cost: normalizeNumber(row.unit_cost),
  selling_price: normalizeNumber(row.selling_price),
});

const findInventoryItem = async (connection, itemId, itemName) => {
  for (const table of ITEM_TABLES) {
    if (!(await tableExists(table))) continue;

    if (itemId) {
      const byId = await queryWithConnection(connection, `${ITEM_SELECT[table]} FROM ${table} WHERE id = ? LIMIT 1`, [itemId]);
      if (byId.length) return normaliseItemRow(byId[0]);
    }

    if (itemName) {
      const byName = await queryWithConnection(
        connection,
        `${ITEM_SELECT[table]} FROM ${table} WHERE LOWER(name) = LOWER(?) ORDER BY id ASC LIMIT 1`,
        [itemName],
      );
      if (byName.length) return normaliseItemRow(byName[0]);
    }
  }

  return null;
};

const getInventoryStock = async (connection, itemId) => {
  const rows = await queryWithConnection(connection, "SELECT stock FROM inventory WHERE id = ? LIMIT 1", [itemId]);
  return Number(rows?.[0]?.stock || 0);
};

const getInventoryItemDetails = async (connection, itemId) => {
  const rows = await queryWithConnection(connection, `${ITEM_SELECT.inventory} FROM inventory WHERE id = ? LIMIT 1`, [itemId]);
  if (rows.length) return normaliseItemRow(rows[0]);

  const other = await queryWithConnection(connection, `${ITEM_SELECT.inventory_items} FROM inventory_items WHERE id = ? LIMIT 1`, [itemId]);
  if (!other.length) return null;
  // inventory_items has no stock column; derive it from the location rows.
  const stockRows = await queryWithConnection(
    connection,
    "SELECT COALESCE(SUM(quantity), 0) AS stock FROM inventory_stock WHERE inventory_item_id = ?",
    [itemId],
  );
  return { ...normaliseItemRow(other[0]), stock: normalizeNumber(stockRows?.[0]?.stock) };
};

const syncInventoryExpiryFromInwards = async (connection, itemId) => {
  if (!itemId) return null;
  const rows = await queryWithConnection(
    connection,
    `SELECT DATE_FORMAT(MIN(expiry_date), '%Y-%m-%d') AS nextExpiry
     FROM inventory_vendor_inwards
     WHERE item_id = ? AND expiry_date IS NOT NULL`,
    [itemId],
  );
  const nextExpiry = rows?.[0]?.nextExpiry || null;
  await queryWithConnection(connection, "UPDATE inventory SET expiry = ? WHERE id = ?", [nextExpiry, itemId]);
  return nextExpiry;
};

const ensureAccountsMirrorSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS vendor_payment_records (
      id INT NOT NULL AUTO_INCREMENT,
      vendor_name VARCHAR(255) NOT NULL,
      invoice_ref VARCHAR(120) DEFAULT NULL,
      payment_date DATE NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_mode VARCHAR(50) NOT NULL DEFAULT 'Bank Transfer',
      status VARCHAR(50) NOT NULL DEFAULT 'Scheduled',
      notes TEXT NULL,
      source_module VARCHAR(80) NULL,
      source_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_vendor_payment_date (payment_date),
      INDEX idx_vendor_payment_source (source_module, source_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT NOT NULL AUTO_INCREMENT,
      po_number VARCHAR(100) NOT NULL,
      vendor_name VARCHAR(255) NOT NULL,
      order_date DATE NOT NULL,
      expected_date DATE DEFAULT NULL,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      source_module VARCHAR(80) NULL,
      source_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_purchase_order_number (po_number),
      INDEX idx_purchase_order_date (order_date),
      INDEX idx_purchase_order_source (source_module, source_id)
    )
  `);

  if (await tableExists("vendor_payment_records")) {
    if (!(await columnExists("vendor_payment_records", "source_module"))) {
      await db.query("ALTER TABLE vendor_payment_records ADD COLUMN source_module VARCHAR(80) NULL AFTER notes");
    }
    if (!(await columnExists("vendor_payment_records", "source_id"))) {
      await db.query("ALTER TABLE vendor_payment_records ADD COLUMN source_id INT NULL AFTER source_module");
    }
  }

  if (await tableExists("purchase_orders")) {
    if (!(await columnExists("purchase_orders", "source_module"))) {
      await db.query("ALTER TABLE purchase_orders ADD COLUMN source_module VARCHAR(80) NULL AFTER notes");
    }
    if (!(await columnExists("purchase_orders", "source_id"))) {
      await db.query("ALTER TABLE purchase_orders ADD COLUMN source_id INT NULL AFTER source_module");
    }
  }
};

const syncAccountsVendorPayment = async (paymentId, data) => {
  await ensureAccountsMirrorSchema();
  const payload = {
    vendor_name: data.vendorName || data.vendor || "",
    invoice_ref: data.invoiceRef || null,
    payment_date: data.paymentDate || null,
    amount: normalizeNumber(data.amount),
    payment_mode: data.paymentMode || "Bank Transfer",
    status: data.status || "Scheduled",
    notes: data.notes || null,
    source_module: "inventory",
    source_id: paymentId,
  };
  const [existing] = await db.query(
    "SELECT id FROM vendor_payment_records WHERE source_module = 'inventory' AND source_id = ? LIMIT 1",
    [paymentId],
  );
  if (existing[0]?.id) {
    await db.query("UPDATE vendor_payment_records SET ? WHERE id = ?", [payload, existing[0].id]);
  } else {
    await db.query("INSERT INTO vendor_payment_records SET ?", [payload]);
  }
};

const deleteAccountsVendorPaymentMirror = async (paymentId) => {
  await ensureAccountsMirrorSchema();
  await db.query("DELETE FROM vendor_payment_records WHERE source_module = 'inventory' AND source_id = ?", [paymentId]);
};

const syncAccountsPurchaseOrder = async (poId, data, fallbackOrderDate = null) => {
  await ensureAccountsMirrorSchema();
  const totalAmount = normalizeNumber(data.totalAmount, normalizeNumber(data.quantity) * normalizeNumber(data.rate));
  const payload = {
    po_number: data.poNumber,
    vendor_name: data.vendorName || data.vendor || "",
    order_date: data.orderDate || fallbackOrderDate || new Date().toISOString().slice(0, 10),
    expected_date: data.expectedDate || null,
    total_amount: totalAmount,
    status: data.status || "Draft",
    notes: data.notes || [data.itemName, data.quantity ? `Qty: ${data.quantity}` : null, data.unit || null].filter(Boolean).join(" | ") || null,
    source_module: "inventory",
    source_id: poId,
  };
  const [existing] = await db.query(
    "SELECT id, order_date FROM purchase_orders WHERE source_module = 'inventory' AND source_id = ? LIMIT 1",
    [poId],
  );
  if (existing[0]?.id) {
    payload.order_date = data.orderDate || existing[0].order_date || payload.order_date;
    await db.query("UPDATE purchase_orders SET ? WHERE id = ?", [payload, existing[0].id]);
  } else {
    await db.query("INSERT INTO purchase_orders SET ?", [payload]);
  }
};

const deleteAccountsPurchaseOrderMirror = async (poId) => {
  await ensureAccountsMirrorSchema();
  await db.query("DELETE FROM purchase_orders WHERE source_module = 'inventory' AND source_id = ?", [poId]);
};

const writeLedgerEntry = async (connection, entry) => {
  await queryWithConnection(
    connection,
    `INSERT INTO inventory_stock_ledger
      (item_id, item_name, reference_type, reference_id, direction, quantity, unit, vendor_name, location_name, rate, amount, balance_after, remarks, entry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.itemId || null,
      entry.itemName || null,
      entry.referenceType,
      entry.referenceId || null,
      entry.direction || "IN",
      normalizeNumber(entry.quantity),
      entry.unit || null,
      entry.vendorName || null,
      entry.locationName || null,
      normalizeNumber(entry.rate),
      normalizeNumber(entry.amount),
      entry.balanceAfter == null ? null : normalizeNumber(entry.balanceAfter),
      entry.remarks || null,
      entry.entryDate || null,
    ],
  );
};

const ensureSchema = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(120) NULL,
        subcategory VARCHAR(120) NULL,
        stock DECIMAL(10,2) NOT NULL DEFAULT 0,
        unit VARCHAR(60) NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        reorder_point DECIMAL(10,2) NOT NULL DEFAULT 10,
        expiry DATE NULL,
        branch VARCHAR(120) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  } catch (error) {
    console.error("ensureSchema inventory table error:", error);
    throw error;
  }

  const inventoryColumns = [
    ["category", "VARCHAR(120) NULL"],
    ["subcategory", "VARCHAR(120) NULL"],
    ["stock", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
    ["unit", "VARCHAR(60) NULL"],
    ["price", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
    ["reorder_point", "DECIMAL(10,2) NOT NULL DEFAULT 10"],
    ["expiry", "DATE NULL"],
    ["branch", "VARCHAR(120) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"],
  ];

  for (const [columnName, definition] of inventoryColumns) {
    try {
      if (!(await columnExists("inventory", columnName))) {
        await db.query(`ALTER TABLE inventory ADD COLUMN ${columnName} ${definition}`);
      }
    } catch (error) {
      console.error(`ensureSchema inventory column ${columnName} error:`, error);
    }
  }

  for (const [columnName, definition] of inventoryColumns) {
    try {
      if (!(await columnExists("inventory", columnName))) {
        await db.query(`ALTER TABLE inventory ADD COLUMN ${columnName} ${definition}`);
      }
    } catch (error) {
      console.error(`ensureSchema inventory column ${columnName} error:`, error);
    }
  }

  const schemaChecks = [
    [`inventory_waste_log`, `CREATE TABLE IF NOT EXISTS inventory_waste_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      reason VARCHAR(255) NOT NULL,
      store VARCHAR(120) NULL,
      remarks TEXT NULL,
      waste_date DATE NULL,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`],
    [`inventory_purchase_orders`, `CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      po_number VARCHAR(120) NOT NULL,
      vendor VARCHAR(255) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      expected_date DATE NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'Draft',
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`],
    [`inventory_stock_audit`, `CREATE TABLE IF NOT EXISTS inventory_stock_audit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      system_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
      physical_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
      variance DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      remarks TEXT NULL,
      audit_date DATE NULL,
      audited_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`],
    [`inventory_transfers`, `CREATE TABLE IF NOT EXISTS inventory_transfers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      from_store VARCHAR(120) NOT NULL,
      to_store VARCHAR(120) NOT NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      approved_by VARCHAR(120) NULL,
      transfer_date DATE NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`],
  ];

  for (const [tableName, sql] of schemaChecks) {
    try {
      await db.query(sql);
    } catch (error) {
      console.error(`ensureSchema ${tableName} error:`, error);
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_vendor_inwards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      vendor VARCHAR(255) NOT NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      batch_no VARCHAR(120) NULL,
      expiry_date DATE NULL,
      inward_date DATE NULL,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vendor_payment_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_date DATE NULL,
      payment_mode VARCHAR(120) NULL,
      reference_no VARCHAR(120) NULL,
      notes TEXT NULL,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      po_number VARCHAR(120) NOT NULL,
      vendor VARCHAR(255) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      expected_date DATE NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_chef_issues (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      reason VARCHAR(255) NOT NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'Pending',
      issued_by VARCHAR(120) NULL,
      issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      returned_at TIMESTAMP NULL,
      remarks TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!(await columnExists("inventory_waste_log", "item_id"))) {
    await db.query("ALTER TABLE inventory_waste_log ADD COLUMN item_id INT NULL AFTER id");
  }

  if (!(await columnExists("inventory_transfers", "item_id"))) {
    await db.query("ALTER TABLE inventory_transfers ADD COLUMN item_id INT NULL AFTER id");
  }
  await ensureAccountsMirrorSchema();

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_vendor_inwards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      po_id INT NULL,
      po_number VARCHAR(120) NULL,
      vendor_name VARCHAR(255) NOT NULL,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      quantity_received DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      invoice_no VARCHAR(120) NULL,
      batch_no VARCHAR(120) NULL,
      expiry_date DATE NULL,
      received_date DATE NOT NULL,
      store VARCHAR(120) NULL,
      remarks TEXT NULL,
      stock_updated TINYINT(1) NOT NULL DEFAULT 0,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  if (!(await columnExists("inventory_vendor_inwards", "batch_no"))) {
    await db.query("ALTER TABLE inventory_vendor_inwards ADD COLUMN batch_no VARCHAR(120) NULL AFTER invoice_no");
  }
  if (!(await columnExists("inventory_vendor_inwards", "expiry_date"))) {
    await db.query("ALTER TABLE inventory_vendor_inwards ADD COLUMN expiry_date DATE NULL AFTER batch_no");
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_vendor_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_name VARCHAR(255) NOT NULL,
      invoice_ref VARCHAR(120) NULL,
      payment_date DATE NOT NULL,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_mode VARCHAR(80) NOT NULL DEFAULT 'Bank Transfer',
      status VARCHAR(60) NOT NULL DEFAULT 'Scheduled',
      notes TEXT NULL,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_stock_ledger (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NULL,
      reference_type VARCHAR(80) NOT NULL,
      reference_id INT NULL,
      direction VARCHAR(10) NOT NULL DEFAULT 'IN',
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      vendor_name VARCHAR(255) NULL,
      location_name VARCHAR(120) NULL,
      rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      balance_after DECIMAL(10,2) NULL,
      remarks TEXT NULL,
      entry_date DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_chef_issues (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NULL,
      item_name VARCHAR(255) NOT NULL,
      quantity_issued DECIMAL(10,2) NOT NULL DEFAULT 0,
      quantity_returned DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(60) NULL,
      chef_name VARCHAR(120) NULL,
      chef_id INT NULL,
      purpose VARCHAR(255) NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'issued',
      issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      returned_at DATETIME NULL,
      remarks TEXT NULL,
      created_by VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
};

// ─── Controller handlers ──────────────────────────────────────────────────────

exports.createItem = async (req, res) => {
  try {
    await ensureSchema();
    const data = { ...req.body, createdBy: req.user?.username || "system" };
    if (!data.name) {
      return res.status(400).json({ message: "Name is required" });
    }
    const connection = await getConnection();
    try {
      await beginTransaction(connection);

      const openingStock = normalizeNumber(data.stock);
      const rate = normalizeNumber(data.price);
      const result = await queryWithConnection(
        connection,
        `INSERT INTO inventory (name, category, subcategory, stock, unit, price, reorder_point, expiry, branch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.category,
          data.subcategory || null,
          openingStock,
          data.unit,
          rate,
          data.reorderPoint ?? 10,
          data.expiry || null,
          data.branch,
        ],
      );

      if (openingStock > 0) {
        await writeLedgerEntry(connection, {
          itemId: result.insertId,
          itemName: data.name,
          referenceType: "opening_balance",
          referenceId: result.insertId,
          direction: "IN",
          quantity: openingStock,
          unit: data.unit || null,
          locationName: data.branch || null,
          rate,
          amount: rate * openingStock,
          balanceAfter: openingStock,
          remarks: data.adjustmentReason || "Opening stock",
          entryDate: normalizeDateOnly(data.openingDate) || new Date().toISOString().slice(0, 10),
        });
      }

      await commitTransaction(connection);
      res.status(201).json({ message: "Item added successfully.", id: result.insertId });
    } catch (error) {
      await rollbackTransaction(connection);
      res.status(500).json({ message: "Failed to create inventory item.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.getItems = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, name, category, subcategory, stock, unit, price,
              reorder_point AS reorderPoint,
              DATE_FORMAT(expiry, '%Y-%m-%d') AS expiry,
              branch,
              CASE WHEN stock <= reorder_point THEN 1 ELSE 0 END AS isLowStock
       FROM inventory
       ORDER BY name`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch inventory.", error });
  }
};

exports.getItem = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, name, category, subcategory, stock, unit, price,
              reorder_point AS reorderPoint,
              DATE_FORMAT(expiry, '%Y-%m-%d') AS expiry,
              branch
       FROM inventory WHERE id = ?`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ message: "Item not found." });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch item.", error });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.username || "system" };

    const updatableKeys = [
      "name", "category", "subcategory", "stock", "unit",
      "price", "reorderPoint", "expiry", "branch",
    ];
    const present = updatableKeys.filter((k) => req.body[k] !== undefined);
    if (present.length === 0) {
      return res.status(400).json({ message: "Nothing to update." });
    }
    const has = (k) => req.body[k] !== undefined;

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);

      const existingRows = await queryWithConnection(
        connection,
        `SELECT id, name, stock, unit, price, branch, category, subcategory, reorder_point, expiry
         FROM inventory WHERE id = ? LIMIT 1`,
        [req.params.id],
      );
      const existing = existingRows[0];
      if (!existing) {
        const error = new Error("Item not found.");
        error.statusCode = 404;
        throw error;
      }

      // Partial update: only apply the fields actually sent in the body; any
      // field left out keeps its stored value instead of being zeroed.
      const nextName = has("name") ? data.name : existing.name;
      const nextCategory = has("category") ? data.category : existing.category;
      const nextSubcategory = has("subcategory") ? data.subcategory || null : existing.subcategory;
      const nextUnit = has("unit") ? data.unit : existing.unit;
      const nextPrice = has("price") ? normalizeNumber(data.price) : normalizeNumber(existing.price);
      const nextReorder = has("reorderPoint")
        ? data.reorderPoint ?? 10
        : normalizeNumber(existing.reorder_point, 10);
      const nextExpiry = has("expiry") ? data.expiry || null : existing.expiry;
      const nextBranch = has("branch") ? data.branch : existing.branch;
      const nextStock = has("stock") ? normalizeNumber(data.stock) : normalizeNumber(existing.stock);

      const previousStock = normalizeNumber(existing.stock);
      const stockChanged = has("stock") && nextStock !== previousStock;

      await queryWithConnection(
        connection,
        `UPDATE inventory SET name=?, category=?, subcategory=?, stock=?, unit=?, price=?, reorder_point=?, expiry=?, branch=? WHERE id=?`,
        [
          nextName,
          nextCategory,
          nextSubcategory,
          nextStock,
          nextUnit,
          nextPrice,
          nextReorder,
          nextExpiry,
          nextBranch,
          req.params.id,
        ],
      );

      if (stockChanged) {
        const nextItem = await getInventoryItemDetails(connection, req.params.id);
        await writeLedgerEntry(connection, {
          itemId: req.params.id,
          itemName: nextName,
          referenceType: nextStock > previousStock ? "stock_adjustment_in" : "stock_adjustment_out",
          referenceId: req.params.id,
          direction: nextStock > previousStock ? "IN" : "OUT",
          quantity: Math.abs(Number((nextStock - previousStock).toFixed(2))),
          unit: nextUnit,
          locationName: nextBranch,
          rate: nextPrice,
          amount: nextPrice * Math.abs(nextStock - previousStock),
          balanceAfter: Number(nextItem?.stock || nextStock),
          remarks: data.adjustmentReason || `Manual stock update from ${previousStock} to ${nextStock}`,
          entryDate: new Date().toISOString().slice(0, 10),
        });
      }

      await commitTransaction(connection);
      res.json({ message: "Item updated successfully." });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to update item.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    await ensureSchema();

    // The stock ledger is the audit trail, but it references items that may
    // not exist in the inventory table (item_id is nullable). Clearing the
    // matching ledger rows keeps the two tables from drifting apart.
    await db.query(
      "DELETE FROM inventory_stock_ledger WHERE item_id = ? OR item_name = (SELECT name FROM inventory WHERE id = ?)",
      [req.params.id, req.params.id]
    );
    await db.query("DELETE FROM inventory WHERE id = ?", [req.params.id]);
    res.json({ message: "Item deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete item.", error });
  }
};

exports.getLowStockAlerts = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, name, category, stock, unit, reorder_point AS reorderPoint, branch
       FROM inventory
       WHERE stock <= reorder_point
       ORDER BY stock ASC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch low stock alerts.", error });
  }
};

exports.getExpiringItems = async (req, res) => {
  try {
    await ensureSchema();
    const daysAhead = parseInt(req.query.days, 10) || 30;
    const [rows] = await db.query(
      `SELECT id, name, category, stock, unit, branch,
              DATE_FORMAT(expiry, '%Y-%m-%d') AS expiry,
              DATEDIFF(expiry, CURDATE()) AS daysToExpiry
       FROM inventory
       WHERE expiry IS NOT NULL AND expiry <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY expiry ASC`,
      [daysAhead],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expiring items.", error });
  }
};

exports.logWaste = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.username || "system" };
    if (!data.itemName || normalizeNumber(data.quantity) <= 0) {
      return res.status(400).json({ message: "itemName and quantity > 0 are required." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const quantity = normalizeNumber(data.quantity);
      const matchedItem = await findInventoryItem(connection, data.itemId, data.itemName);
      let balanceAfter = null;

      if (matchedItem && quantity > 0) {
        const currentStock = await getInventoryStock(connection, matchedItem.id);
        if (currentStock < quantity) {
          const error = new Error("Waste quantity current stock se zyada hai.");
          error.statusCode = 400;
          throw error;
        }
      }

      const result = await queryWithConnection(
        connection,
        `INSERT INTO inventory_waste_log (item_id, item_name, quantity, unit, reason, store, remarks, waste_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          matchedItem?.id || data.itemId || null,
          matchedItem?.name || data.itemName,
          quantity,
          data.unit || matchedItem?.unit || null,
          data.reason,
          data.store || null,
          data.remarks || null,
          data.date || null,
          data.createdBy || "system",
        ],
      );

      if (matchedItem && quantity > 0) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock - ? WHERE id = ?", [quantity, matchedItem.id]);
        const nextItem = await getInventoryItemDetails(connection, matchedItem.id);
        balanceAfter = Number(nextItem?.stock || 0);
        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "waste",
          referenceId: result.insertId,
          direction: "OUT",
          quantity,
          unit: data.unit || matchedItem.unit || null,
          locationName: data.store || nextItem?.branch || null,
          rate: nextItem?.price || 0,
          amount: (nextItem?.price || 0) * quantity,
          balanceAfter,
          remarks: data.reason || data.remarks || null,
          entryDate: data.date || null,
        });
      }

      await commitTransaction(connection);
      res.status(201).json({ message: "Waste entry logged.", id: result.insertId, stockUpdated: Boolean(matchedItem && quantity > 0), balanceAfter });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to log waste.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.getWasteLogs = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, item_id AS itemId, item_name AS itemName, quantity, unit, reason, store, remarks,
              DATE_FORMAT(waste_date, '%Y-%m-%d') AS date, created_by AS createdBy,
              created_at AS createdAt
       FROM inventory_waste_log
       ORDER BY waste_date DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch waste logs.", error });
  }
};

exports.updateWasteLog = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.itemName && !body.quantity && !body.reason) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const rows = await queryWithConnection(connection, "SELECT * FROM inventory_waste_log WHERE id = ? LIMIT 1", [req.params.id]);
      const existing = rows[0];
      if (!existing) {
        const error = new Error("Waste log not found.");
        error.statusCode = 404;
        throw error;
      }

      if (existing.item_id && Number(existing.quantity || 0) > 0) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock + ? WHERE id = ?", [
          normalizeNumber(existing.quantity),
          existing.item_id,
        ]);
      }

      const quantity = normalizeNumber(req.body.quantity);
      const matchedItem = await findInventoryItem(connection, req.body.itemId || existing.item_id, req.body.itemName || existing.item_name);

      if (matchedItem && quantity > 0) {
        const currentStock = await getInventoryStock(connection, matchedItem.id);
        if (currentStock < quantity) {
          const error = new Error("Waste quantity current stock se zyada hai.");
          error.statusCode = 400;
          throw error;
        }
      }

      await queryWithConnection(
        connection,
        `UPDATE inventory_waste_log SET item_id=?, item_name=?, quantity=?, unit=?, reason=?, store=?, remarks=?, waste_date=? WHERE id=?`,
        [
          matchedItem?.id || req.body.itemId || existing.item_id || null,
          matchedItem?.name || req.body.itemName || existing.item_name,
          quantity,
          req.body.unit || matchedItem?.unit || existing.unit || null,
          req.body.reason,
          req.body.store || existing.store || null,
          req.body.remarks || existing.remarks || null,
          req.body.date || existing.waste_date || null,
          req.params.id,
        ],
      );

      await queryWithConnection(connection, "DELETE FROM inventory_stock_ledger WHERE reference_type = 'waste' AND reference_id = ?", [req.params.id]);
      if (matchedItem && quantity > 0) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock - ? WHERE id = ?", [quantity, matchedItem.id]);
        const nextItem = await getInventoryItemDetails(connection, matchedItem.id);
        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "waste",
          referenceId: req.params.id,
          direction: "OUT",
          quantity,
          unit: req.body.unit || matchedItem?.unit || existing.unit || null,
          locationName: req.body.store || nextItem?.branch || null,
          rate: nextItem?.price || 0,
          amount: (nextItem?.price || 0) * quantity,
          balanceAfter: Number(nextItem?.stock || 0),
          remarks: req.body.reason || req.body.remarks || null,
          entryDate: req.body.date || existing.waste_date || null,
        });
      }

      await commitTransaction(connection);
      res.json({ message: "Waste log updated.", id: req.params.id });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to update waste log.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.deleteWasteLog = async (req, res) => {
  try {
    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const rows = await queryWithConnection(connection, "SELECT * FROM inventory_waste_log WHERE id = ? LIMIT 1", [req.params.id]);
      const existing = rows[0];
      if (!existing) {
        const error = new Error("Waste log not found.");
        error.statusCode = 404;
        throw error;
      }

      if (existing.item_id && Number(existing.quantity || 0) > 0) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock + ? WHERE id = ?", [
          normalizeNumber(existing.quantity),
          existing.item_id,
        ]);
      }

      await queryWithConnection(connection, "DELETE FROM inventory_waste_log WHERE id = ?", [req.params.id]);
      await queryWithConnection(connection, "DELETE FROM inventory_stock_ledger WHERE reference_type = 'waste' AND reference_id = ?", [req.params.id]);
      await commitTransaction(connection);
      res.json({ message: "Waste log deleted." });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to delete waste log.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.createPurchaseOrder = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.username || "system" };
    if (!data.poNumber || !data.vendor || !data.itemName || !data.quantity) {
      return res.status(400).json({ message: "poNumber, vendor, itemName and quantity are required." });
    }
    await ensureSchema();
    const [result] = await db.query(
      `INSERT INTO inventory_purchase_orders (po_number, vendor, item_name, quantity, unit, rate, expected_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.poNumber,
        data.vendor,
        data.itemName,
        data.quantity,
        data.unit || null,
        data.rate,
        data.expectedDate || null,
        data.status || "Draft",
        data.createdBy || "system",
      ],
    );
    await syncAccountsPurchaseOrder(result.insertId, data);
    res.status(201).json({ message: "Purchase order created.", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to create purchase order.", error });
  }
};

exports.getPurchaseOrders = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, po_number AS poNumber, vendor, item_name AS itemName,
              quantity, unit, rate,
              DATE_FORMAT(expected_date, '%Y-%m-%d') AS expectedDate,
              status, created_by AS createdBy,
              created_at AS createdAt
       FROM inventory_purchase_orders
       ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch purchase orders.", error });
  }
};

exports.updatePurchaseOrder = async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.poNumber && !data.vendor && !data.itemName) {
      return res.status(400).json({ message: "Nothing to update." });
    }
    await ensureSchema();

    // po_number / vendor / item_name are NOT NULL, so a partial update must
    // merge over the stored row instead of writing nulls into them.
    const [existingRows] = await db.query(
      "SELECT po_number, vendor, item_name, quantity, unit, rate, expected_date, status, DATE_FORMAT(created_at, '%Y-%m-%d') AS createdDate FROM inventory_purchase_orders WHERE id = ? LIMIT 1",
      [req.params.id],
    );
    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ message: "Purchase order not found." });
    }

    const merged = {
      poNumber: data.poNumber ?? existing.po_number,
      vendor: data.vendor ?? existing.vendor,
      itemName: data.itemName ?? existing.item_name,
      quantity: data.quantity ?? existing.quantity,
      unit: data.unit ?? existing.unit,
      rate: data.rate ?? existing.rate,
      expectedDate: data.expectedDate ?? existing.expected_date,
      status: data.status ?? existing.status,
    };

    await db.query(
      `UPDATE inventory_purchase_orders SET po_number=?, vendor=?, item_name=?, quantity=?, unit=?, rate=?, expected_date=?, status=? WHERE id=?`,
      [
        merged.poNumber,
        merged.vendor,
        merged.itemName,
        merged.quantity,
        merged.unit || null,
        merged.rate,
        merged.expectedDate || null,
        merged.status,
        req.params.id,
      ],
    );
    await syncAccountsPurchaseOrder(req.params.id, merged, existing.createdDate || null);
    res.json({ message: "Purchase order updated." });
  } catch (error) {
    res.status(500).json({ message: "Failed to update purchase order.", error });
  }
};

exports.getPurchaseOrderById = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, po_number AS poNumber, vendor, item_name AS itemName,
              quantity, unit, rate,
              DATE_FORMAT(expected_date, '%Y-%m-%d') AS expectedDate,
              status, created_by AS createdBy,
              created_at AS createdAt
       FROM inventory_purchase_orders WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: "Purchase order not found." });
    res.json(row);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch purchase order.", error });
  }
};

exports.deletePurchaseOrder = async (req, res) => {
  try {
    await ensureSchema();
    await db.query("DELETE FROM inventory_purchase_orders WHERE id = ?", [req.params.id]);
    await deleteAccountsPurchaseOrderMirror(req.params.id);
    res.json({ message: "Purchase order deleted." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete purchase order.", error });
  }
};

exports.createVendorInward = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.username || "system" };
    if (!data.itemName || normalizeNumber(data.quantityReceived) <= 0) {
      return res.status(400).json({ message: "itemName and quantityReceived > 0 are required." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);

      const quantityReceived = normalizeNumber(data.quantityReceived);
      const rate = normalizeNumber(data.rate);
      const amount = normalizeNumber(data.amount, quantityReceived > 0 && rate > 0 ? quantityReceived * rate : 0);
      const matchedItem = await findInventoryItem(connection, data.itemId, data.itemName);
      const stockUpdated = matchedItem && quantityReceived > 0 ? 1 : 0;

      const inwardResult = await queryWithConnection(
        connection,
        `INSERT INTO inventory_vendor_inwards
          (po_id, po_number, vendor_name, item_id, item_name, quantity_received, unit, rate, amount, invoice_no, batch_no, expiry_date, received_date, store, remarks, stock_updated, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.poId || null,
          data.poNumber || null,
          data.vendorName || data.vendor || "",
          matchedItem?.id || data.itemId || null,
          matchedItem?.name || data.itemName || "",
          quantityReceived,
          data.unit || matchedItem?.unit || null,
          rate,
          amount,
          data.invoiceNo || null,
          data.batchNo || null,
          data.expiryDate || null,
          data.receivedDate || null,
          data.store || null,
          data.remarks || null,
          stockUpdated,
          data.createdBy || "system",
        ],
      );

      let balanceAfter = null;
      if (stockUpdated) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock + ? WHERE id = ?", [quantityReceived, matchedItem.id]);
        await syncInventoryExpiryFromInwards(connection, matchedItem.id);
        balanceAfter = await getInventoryStock(connection, matchedItem.id);
      }

      await writeLedgerEntry(connection, {
        itemId: matchedItem?.id || data.itemId || null,
        itemName: matchedItem?.name || data.itemName,
        referenceType: "vendor_inward",
        referenceId: inwardResult.insertId,
        direction: "IN",
        quantity: quantityReceived,
        unit: data.unit || matchedItem?.unit || null,
        vendorName: data.vendorName || data.vendor || "",
        locationName: data.store || null,
        rate,
        amount,
        balanceAfter,
        remarks: data.remarks || data.invoiceNo || null,
        entryDate: data.receivedDate || null,
      });

      if (data.poId || data.poNumber) {
        await queryWithConnection(
          connection,
          `UPDATE inventory_purchase_orders SET status = 'GRN Received' WHERE ${data.poId ? "id = ?" : "po_number = ?"}`,
          [data.poId || data.poNumber],
        );
      }

      await commitTransaction(connection);
      res.status(201).json({
        message: "Vendor inward recorded.",
        id: inwardResult.insertId,
        stockUpdated: Boolean(stockUpdated),
      });
    } catch (error) {
      await rollbackTransaction(connection);
      res.status(500).json({ message: "Failed to record vendor inward.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.getVendorInwards = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id,
              po_id AS poId,
              po_number AS poNumber,
              vendor_name AS vendorName,
              item_id AS itemId,
              item_name AS itemName,
              quantity_received AS quantityReceived,
              unit,
              rate,
              amount,
              invoice_no AS invoiceNo,
              batch_no AS batchNo,
              DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate,
              DATE_FORMAT(received_date, '%Y-%m-%d') AS receivedDate,
              store,
              remarks,
              stock_updated AS stockUpdated,
              created_by AS createdBy,
              created_at AS createdAt
       FROM inventory_vendor_inwards
       ORDER BY received_date DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch vendor inwards.", error });
  }
};

exports.updateVendorInward = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.username || "system" };
    if (!data.itemName && !data.quantityReceived && !data.vendorName) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);

      const existingRows = await queryWithConnection(
        connection,
        "SELECT * FROM inventory_vendor_inwards WHERE id = ? LIMIT 1",
        [req.params.id],
      );
      const existing = existingRows[0];
      if (!existing) {
        const error = new Error("Vendor inward not found.");
        error.statusCode = 404;
        throw error;
      }

      if (Number(existing.stock_updated || 0) && existing.item_id) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock - ? WHERE id = ?", [
          normalizeNumber(existing.quantity_received),
          existing.item_id,
        ]);
      }

      const quantityReceived = normalizeNumber(data.quantityReceived);
      const rate = normalizeNumber(data.rate);
      const amount = normalizeNumber(data.amount, quantityReceived > 0 && rate > 0 ? quantityReceived * rate : 0);
      const matchedItem = await findInventoryItem(connection, data.itemId || existing.item_id, data.itemName || existing.item_name);
      const stockUpdated = matchedItem && quantityReceived > 0 ? 1 : 0;

      let balanceAfter = null;
      if (stockUpdated) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock + ? WHERE id = ?", [quantityReceived, matchedItem.id]);
        await syncInventoryExpiryFromInwards(connection, matchedItem.id);
        balanceAfter = await getInventoryStock(connection, matchedItem.id);
      }

      await queryWithConnection(
        connection,
        `UPDATE inventory_vendor_inwards SET po_id=?, po_number=?, vendor_name=?, item_id=?, item_name=?, quantity_received=?, unit=?, rate=?, amount=?, invoice_no=?, batch_no=?, expiry_date=?, received_date=?, store=?, remarks=?, stock_updated=?, created_by=? WHERE id=?`,
        [
          data.poId || existing.po_id || null,
          data.poNumber || existing.po_number || null,
          data.vendorName || data.vendor || existing.vendor_name,
          matchedItem?.id || data.itemId || existing.item_id || null,
          matchedItem?.name || data.itemName || existing.item_name,
          quantityReceived,
          data.unit || matchedItem?.unit || existing.unit || null,
          rate,
          amount,
          data.invoiceNo || existing.invoice_no || null,
          data.batchNo || existing.batch_no || null,
          data.expiryDate || existing.expiry_date || null,
          data.receivedDate || existing.received_date || null,
          data.store || existing.store || null,
          data.remarks || existing.remarks || null,
          stockUpdated,
          data.createdBy || existing.created_by || "system",
          req.params.id,
        ],
      );

      await queryWithConnection(connection, "DELETE FROM inventory_stock_ledger WHERE reference_type = 'vendor_inward' AND reference_id = ?", [req.params.id]);
      await writeLedgerEntry(connection, {
        itemId: matchedItem?.id || data.itemId || existing.item_id || null,
        itemName: matchedItem?.name || data.itemName || existing.item_name,
        referenceType: "vendor_inward",
        referenceId: req.params.id,
        direction: "IN",
        quantity: quantityReceived,
        unit: data.unit || matchedItem?.unit || existing.unit || null,
        vendorName: data.vendorName || data.vendor || existing.vendor_name,
        locationName: data.store || existing.store || null,
        rate,
        amount,
        balanceAfter,
        remarks: data.remarks || data.invoiceNo || existing.invoice_no || null,
        entryDate: data.receivedDate || existing.received_date || null,
      });

      if (existing.item_id) {
        await syncInventoryExpiryFromInwards(connection, existing.item_id);
      }
      if (matchedItem?.id && matchedItem.id !== existing.item_id) {
        await syncInventoryExpiryFromInwards(connection, matchedItem.id);
      }

      await commitTransaction(connection);
      res.json({ message: "Vendor inward updated.", stockUpdated: Boolean(stockUpdated) });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to update vendor inward.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.deleteVendorInward = async (req, res) => {
  try {
    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const rows = await queryWithConnection(connection, "SELECT * FROM inventory_vendor_inwards WHERE id = ? LIMIT 1", [req.params.id]);
      const existing = rows[0];
      if (!existing) {
        const error = new Error("Vendor inward not found.");
        error.statusCode = 404;
        throw error;
      }

      if (Number(existing.stock_updated || 0) && existing.item_id) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock - ? WHERE id = ?", [
          normalizeNumber(existing.quantity_received),
          existing.item_id,
        ]);
        await syncInventoryExpiryFromInwards(connection, existing.item_id);
      }

      await queryWithConnection(connection, "DELETE FROM inventory_vendor_inwards WHERE id = ?", [req.params.id]);
      await queryWithConnection(connection, "DELETE FROM inventory_stock_ledger WHERE reference_type = 'vendor_inward' AND reference_id = ?", [req.params.id]);
      await commitTransaction(connection);
      res.json({ message: "Vendor inward deleted." });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to delete vendor inward.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.createVendorPayment = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.username || "system" };
    if (!data.vendorName || !data.amount) {
      return res.status(400).json({ message: "vendorName and amount are required." });
    }

    await ensureSchema();
    const [result] = await db.query(
      `INSERT INTO inventory_vendor_payments (vendor_name, invoice_ref, payment_date, amount, payment_mode, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.vendorName || data.vendor || "",
        data.invoiceRef || null,
        data.paymentDate || null,
        normalizeNumber(data.amount),
        data.paymentMode || "Bank Transfer",
        data.status || "Scheduled",
        data.notes || null,
        data.createdBy || "system",
      ],
    );
    await syncAccountsVendorPayment(result.insertId, data);
    res.status(201).json({ message: "Vendor payment recorded.", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to create vendor payment.", error });
  }
};

exports.getVendorPayments = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id,
              vendor_name AS vendorName,
              invoice_ref AS invoiceRef,
              DATE_FORMAT(payment_date, '%Y-%m-%d') AS paymentDate,
              amount,
              payment_mode AS paymentMode,
              status,
              notes,
              created_by AS createdBy,
              created_at AS createdAt
       FROM inventory_vendor_payments
       ORDER BY payment_date DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch vendor payments.", error });
  }
};

exports.updateVendorPayment = async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.vendorName && !data.amount) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    await ensureSchema();
    await db.query(
      `UPDATE inventory_vendor_payments SET vendor_name=?, invoice_ref=?, payment_date=?, amount=?, payment_mode=?, status=?, notes=? WHERE id=?`,
      [
        data.vendorName || data.vendor || "",
        data.invoiceRef || null,
        data.paymentDate || null,
        normalizeNumber(data.amount),
        data.paymentMode || "Bank Transfer",
        data.status || "Scheduled",
        data.notes || null,
        req.params.id,
      ],
    );
    await syncAccountsVendorPayment(req.params.id, data);
    res.json({ message: "Vendor payment updated." });
  } catch (error) {
    res.status(500).json({ message: "Failed to update vendor payment.", error });
  }
};

exports.deleteVendorPayment = async (req, res) => {
  try {
    await ensureSchema();
    await db.query("DELETE FROM inventory_vendor_payments WHERE id = ?", [req.params.id]);
    await deleteAccountsVendorPaymentMirror(req.params.id);
    res.json({ message: "Vendor payment deleted." });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete vendor payment.", error });
  }
};

exports.getStockLedger = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT *
       FROM (
         SELECT
           l.id,
           l.item_id AS itemId,
           l.item_name AS itemName,
           l.reference_type AS referenceType,
           l.reference_id AS referenceId,
           l.direction,
           l.quantity,
           l.unit,
           l.vendor_name AS vendorName,
           l.location_name AS locationName,
           l.rate,
           l.amount,
           l.balance_after AS balanceAfter,
           l.remarks,
           DATE_FORMAT(l.entry_date, '%Y-%m-%d') AS entryDate,
           l.created_at AS createdAt
         FROM inventory_stock_ledger l
         -- Chef issue/return events are already unioned from
         -- inventory_chef_issues below; excluding them here stops the double
         -- count (each such event is written to both tables).
         WHERE l.reference_type NOT IN ('chef_issue', 'chef_return')
         UNION ALL
         SELECT
           ci.id,
           ci.item_id AS itemId,
           ci.item_name AS itemName,
           'chef_issue' AS referenceType,
           ci.id AS referenceId,
           'OUT' AS direction,
           ci.quantity_issued AS quantity,
           ci.unit,
           NULL AS vendorName,
           ci.chef_name AS locationName,
           0 AS rate,
           0 AS amount,
           NULL AS balanceAfter,
           ci.remarks,
           DATE_FORMAT(ci.issued_at, '%Y-%m-%d') AS entryDate,
           ci.issued_at AS createdAt
         FROM inventory_chef_issues ci
         WHERE ci.status IN ('issued', 'partially_returned', 'fully_returned')
         UNION ALL
         SELECT
           (ci.id + 1000000) AS id,
           ci.item_id AS itemId,
           ci.item_name AS itemName,
           'chef_return' AS referenceType,
           ci.id AS referenceId,
           'IN' AS direction,
           ci.quantity_returned AS quantity,
           ci.unit,
           NULL AS vendorName,
           ci.chef_name AS locationName,
           0 AS rate,
           0 AS amount,
           NULL AS balanceAfter,
           ci.remarks,
           DATE_FORMAT(ci.returned_at, '%Y-%m-%d') AS entryDate,
           ci.returned_at AS createdAt
         FROM inventory_chef_issues ci
         WHERE ci.quantity_returned > 0
       ) ledger
       ORDER BY entryDate DESC, createdAt DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stock ledger.", error });
  }
};

exports.getStockFlowReport = async (req, res) => {
  try {
    await ensureSchema();
    const dateFrom = normalizeDateOnly(req.query.dateFrom);
    const dateTo = normalizeDateOnly(req.query.dateTo);

    const [inventoryRows, vendorRows, ledgerRows] = await Promise.all([
      db.query(
        `SELECT id, name, category, stock, unit, price, reorder_point AS reorderPoint, branch FROM inventory ORDER BY name ASC`,
      ),
      db.query(
        `SELECT item_id AS itemId, item_name AS itemName, vendor_name AS vendorName,
                DATE_FORMAT(received_date, '%Y-%m-%d') AS receivedDate, created_at AS createdAt
         FROM inventory_vendor_inwards ORDER BY received_date DESC, created_at DESC`,
      ),
      db.query(
        `SELECT * FROM (
           SELECT l.item_id AS itemId, l.item_name AS itemName, l.reference_type AS referenceType, l.direction, l.quantity, l.unit, l.balance_after AS balanceAfter, DATE_FORMAT(l.entry_date, '%Y-%m-%d') AS entryDate, l.created_at AS createdAt FROM inventory_stock_ledger l WHERE l.reference_type NOT IN ('chef_issue', 'chef_return')
           UNION ALL
           SELECT ci.item_id AS itemId, ci.item_name AS itemName, 'chef_issue' AS referenceType, 'OUT' AS direction, ci.quantity_issued AS quantity, ci.unit, NULL AS balanceAfter, DATE_FORMAT(ci.issued_at, '%Y-%m-%d') AS entryDate, ci.issued_at AS createdAt FROM inventory_chef_issues ci WHERE ci.status IN ('issued', 'partially_returned', 'fully_returned')
           UNION ALL
           SELECT ci.item_id AS itemId, ci.item_name AS itemName, 'chef_return' AS referenceType, 'IN' AS direction, ci.quantity_returned AS quantity, ci.unit, NULL AS balanceAfter, DATE_FORMAT(ci.returned_at, '%Y-%m-%d') AS entryDate, ci.returned_at AS createdAt FROM inventory_chef_issues ci WHERE ci.quantity_returned > 0
         ) ledger ORDER BY entryDate ASC, createdAt ASC`,
      ),
    ]);

    const latestVendorByItem = new Map();
    (vendorRows || []).forEach((row) => {
      const itemKey = String(row.itemId || "").trim() || String(row.itemName || "").trim().toLowerCase();
      if (!itemKey || latestVendorByItem.has(itemKey)) return;
      latestVendorByItem.set(itemKey, row.vendorName || null);
    });

    const ledgerByItem = new Map();
    (ledgerRows || []).forEach((row) => {
      const itemKey = String(row.itemId || "").trim() || String(row.itemName || "").trim().toLowerCase();
      if (!itemKey) return;
      const current = ledgerByItem.get(itemKey) || [];
      current.push({
        referenceType: String(row.referenceType || "").toLowerCase(),
        direction: String(row.direction || "").toUpperCase(),
        quantity: normalizeNumber(row.quantity),
        entryDate: normalizeDateOnly(row.entryDate),
      });
      ledgerByItem.set(itemKey, current);
    });

    const rows = (inventoryRows || []).map((item) => {
      const itemKey = String(item.id || "").trim() || String(item.name || "").trim().toLowerCase();
      const itemLedger = ledgerByItem.get(itemKey) || [];
      const currentStock = normalizeNumber(item.stock);
      const unitRate = normalizeNumber(item.price);
      const signedTotal = itemLedger.reduce((sum, entry) => (
        sum + (entry.direction === "OUT" ? -entry.quantity : entry.quantity)
      ), 0);
      const baselineOpening = currentStock - signedTotal;

      let openingQty = baselineOpening;
      let receivedQty = 0;
      let usedQty = 0;

      itemLedger.forEach((entry) => {
        const entryDate = entry.entryDate;
        const isOpeningEntry = entry.referenceType === "opening_balance";
        const isBeforeStart = Boolean(dateFrom && entryDate && entryDate < dateFrom);
        const isOnOrBeforeStart = Boolean(dateFrom && entryDate && entryDate <= dateFrom);
        const isAfterEnd = Boolean(dateTo && entryDate && entryDate > dateTo);
        const isInPeriod = (!dateFrom || !entryDate || entryDate >= dateFrom) && (!dateTo || !entryDate || entryDate <= dateTo);

        if (!dateFrom) {
          if (isOpeningEntry) { openingQty += entry.quantity; return; }
        } else if (isOpeningEntry ? isOnOrBeforeStart : isBeforeStart) {
          openingQty += entry.direction === "OUT" ? -entry.quantity : entry.quantity;
          return;
        } else if (!isOpeningEntry && isBeforeStart) {
          openingQty += entry.direction === "OUT" ? -entry.quantity : entry.quantity;
          return;
        }

        if (isAfterEnd || !isInPeriod) return;

        if (isOpeningEntry) { receivedQty += entry.quantity; return; }

        if (entry.direction === "OUT") { usedQty += entry.quantity; }
        else { receivedQty += entry.quantity; }
      });

      const remainingQty = openingQty + receivedQty - usedQty;
      const vendorKey = String(item.id || "").trim() || String(item.name || "").trim().toLowerCase();

      return {
        itemId: item.id,
        item: item.name,
        category: item.category || "",
        vendor: latestVendorByItem.get(vendorKey) || null,
        openingQty: Number(openingQty.toFixed(2)),
        receivedQty: Number(receivedQty.toFixed(2)),
        usedQty: Number(usedQty.toFixed(2)),
        remainingQty: Number(remainingQty.toFixed(2)),
        unit: item.unit || "",
        unitRate,
        amount: Number((remainingQty * unitRate).toFixed(2)),
        reorderPoint: normalizeNumber(item.reorderPoint, 10),
        store: item.branch || "",
        alert: remainingQty <= normalizeNumber(item.reorderPoint, 10) ? "Low" : "OK",
      };
    });

    const summary = rows.reduce((accumulator, row) => ({
      opening: accumulator.opening + row.openingQty,
      received: accumulator.received + row.receivedQty,
      used: accumulator.used + row.usedQty,
      remaining: accumulator.remaining + row.remainingQty,
      amount: accumulator.amount + row.amount,
    }), { opening: 0, received: 0, used: 0, remaining: 0, amount: 0 });

    res.json({
      filters: { dateFrom, dateTo },
      summary: {
        opening: Number(summary.opening.toFixed(2)),
        received: Number(summary.received.toFixed(2)),
        used: Number(summary.used.toFixed(2)),
        remaining: Number(summary.remaining.toFixed(2)),
        amount: Number(summary.amount.toFixed(2)),
      },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stock flow report.", error });
  }
};

exports.getVendorInsights = async (req, res) => {
  try {
    await ensureSchema();
    // v4 migration: vendor receipts now live in `inventory_purchases` (with
    // `inventory_purchase_items` for the received quantity and `paid_amount` for
    // payments). The legacy `inventory_vendor_inwards` / `inventory_vendor_payments`
    // tables were retired by the migration, so the insights are derived from the
    // v4 tables while preserving the outward JSON shape the frontend expects.
    // `db.query` resolves to [rows, fields], so unwrap the tuple from each
    // promise before destructuring the row sets.
    const [[summaryRows], [vendorRows]] = await Promise.all([
      db.query(
        `SELECT
          (SELECT COUNT(*) FROM inventory_vendors) AS totalVendors,
          (SELECT COALESCE(SUM(ipi.quantity), 0)
             FROM inventory_purchase_items ipi
             INNER JOIN inventory_purchases ip ON ip.id = ipi.purchase_id
            WHERE COALESCE(ip.status, 'received') <> 'cancelled') AS totalReceivedQty,
          (SELECT COALESCE(SUM(ip.total_amount), 0)
             FROM inventory_purchases ip
            WHERE COALESCE(ip.status, 'received') <> 'cancelled') AS totalReceivedValue,
          (SELECT COALESCE(SUM(ip.paid_amount), 0)
             FROM inventory_purchases ip
            WHERE COALESCE(ip.status, 'received') <> 'cancelled') AS totalPaidAmount`,
      ),
      db.query(
        `SELECT base.vendorName,
                CASE WHEN COALESCE(v.is_active, 1) = 1 THEN 'Active' ELSE 'Inactive' END AS status,
                COALESCE(purchaseStats.receiptsCount, 0) AS receiptsCount,
                COALESCE(purchaseStats.totalQty, 0) AS totalQty,
                COALESCE(purchaseStats.totalValue, 0) AS totalValue,
                COALESCE(purchaseStats.totalPaid, 0) AS totalPaid,
                COALESCE(purchaseStats.paymentCount, 0) AS paymentCount,
                purchaseStats.lastReceivedDate AS lastReceivedDate
         FROM (
           SELECT name AS vendorName FROM inventory_vendors
           UNION
           SELECT v.name AS vendorName
             FROM inventory_purchases p
             INNER JOIN inventory_vendors v ON v.id = p.vendor_id
            WHERE v.name IS NOT NULL AND v.name <> ''
         ) base
         LEFT JOIN inventory_vendors v ON LOWER(v.name) = LOWER(base.vendorName)
         LEFT JOIN (
           SELECT vendor_name,
                  COUNT(*) AS receiptsCount,
                  COALESCE(SUM(total_qty), 0) AS totalQty,
                  COALESCE(SUM(total_amount), 0) AS totalValue,
                  SUM(CASE WHEN paid_amount > 0 THEN 1 ELSE 0 END) AS paymentCount,
                  COALESCE(SUM(paid_amount), 0) AS totalPaid,
                  MAX(received_date) AS lastReceivedDate
           FROM (
             SELECT v.name AS vendor_name,
                    DATE_FORMAT(p.purchase_date, '%Y-%m-%d') AS received_date,
                    COALESCE(p.total_amount, 0) AS total_amount,
                    COALESCE(p.paid_amount, 0) AS paid_amount,
                    COALESCE((
                      SELECT SUM(ipi.quantity)
                        FROM inventory_purchase_items ipi
                       WHERE ipi.purchase_id = p.id
                    ), 0) AS total_qty
               FROM inventory_purchases p
               INNER JOIN inventory_vendors v ON v.id = p.vendor_id
              WHERE COALESCE(p.status, 'received') <> 'cancelled'
           ) purchaseLines
           GROUP BY vendor_name
         ) purchaseStats ON LOWER(purchaseStats.vendor_name) = LOWER(base.vendorName)
         WHERE base.vendorName IS NOT NULL AND base.vendorName <> ''
         ORDER BY totalValue DESC, totalQty DESC, base.vendorName ASC`,
      ),
    ]);

    const summary = summaryRows?.[0] || {};
    const vendors = (vendorRows || []).map((row) => ({
      ...row,
      totalDue: Math.max(Number(row.totalValue || 0) - Number(row.totalPaid || 0), 0),
    }));

    res.json({
      summary: {
        totalVendors: Number(summary.totalVendors || 0),
        totalReceivedQty: Number(summary.totalReceivedQty || 0),
        totalReceivedValue: Number(summary.totalReceivedValue || 0),
        totalPaidAmount: Number(summary.totalPaidAmount || 0),
        totalOutstandingAmount: vendors.reduce((sum, row) => sum + Number(row.totalDue || 0), 0),
      },
      vendors,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch vendor insights.", error });
  }
};

exports.createChefIssue = async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user?.name || req.user?.email || "system" };
    if (!data.itemName || normalizeNumber(data.quantityIssued) <= 0) {
      return res.status(400).json({ message: "itemName and quantityIssued > 0 are required." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const quantityIssued = normalizeNumber(data.quantityIssued);
      const matchedItem = await findInventoryItem(connection, data.itemId, data.itemName);

      if (!matchedItem) {
        const error = new Error("Item not found in inventory.");
        error.statusCode = 404;
        throw error;
      }
      if (quantityIssued <= 0) {
        const error = new Error("Quantity issued must be greater than 0.");
        error.statusCode = 400;
        throw error;
      }

      const currentStock = await getInventoryStock(connection, matchedItem.id);
      if (currentStock < quantityIssued) {
        const error = new Error("Insufficient stock. Available: " + currentStock + " " + (matchedItem.unit || ""));
        error.statusCode = 400;
        throw error;
      }

      await queryWithConnection(connection, "UPDATE inventory SET stock = stock - ? WHERE id = ?", [quantityIssued, matchedItem.id]);

      const result = await queryWithConnection(
        connection,
        `INSERT INTO inventory_chef_issues (item_id, item_name, quantity_issued, unit, chef_name, chef_id, purpose, status, remarks, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
        [matchedItem.id, matchedItem.name, quantityIssued, data.unit || matchedItem.unit || null, data.chefName || null, data.chefId || null, data.purpose || null, data.remarks || null, data.createdBy || "system"],
      );

      const nextItem = await getInventoryItemDetails(connection, matchedItem.id);
      await writeLedgerEntry(connection, {
        itemId: matchedItem.id,
        itemName: matchedItem.name,
        referenceType: "chef_issue",
        referenceId: result.insertId,
        direction: "OUT",
        quantity: quantityIssued,
        unit: data.unit || matchedItem.unit || null,
        locationName: data.chefName || null,
        rate: nextItem?.price || 0,
        amount: (nextItem?.price || 0) * quantityIssued,
        balanceAfter: Number(nextItem?.stock || 0),
        remarks: data.purpose || data.remarks || null,
        entryDate: new Date().toISOString().slice(0, 10),
      });

      await commitTransaction(connection);
      res.status(201).json({
        message: "Item issued to chef.",
        record: {
          id: result.insertId,
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          quantityIssued,
          quantityReturned: 0,
          unit: data.unit || matchedItem.unit || null,
          chefName: data.chefName || null,
          chefId: data.chefId || null,
          purpose: data.purpose || null,
          status: "issued",
          remarks: data.remarks || null,
          createdBy: data.createdBy || "system",
          balanceAfter: Number(nextItem?.stock || 0),
        },
      });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || "Failed to issue item.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.returnChefIssue = async (req, res) => {
  try {
    const data = req.body || {};
    if (normalizeNumber(data.quantityReturned) <= 0) {
      return res.status(400).json({ message: "quantityReturned > 0 is required." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const quantityReturned = normalizeNumber(data.quantityReturned);

      const existingRows = await queryWithConnection(connection, "SELECT * FROM inventory_chef_issues WHERE id = ? LIMIT 1", [req.params.id]);
      const existing = existingRows[0];
      if (!existing) {
        const error = new Error("Chef issue record not found.");
        error.statusCode = 404;
        throw error;
      }
      if (existing.status === "fully_returned") {
        const error = new Error("This item has already been fully returned.");
        error.statusCode = 400;
        throw error;
      }
      if (quantityReturned <= 0) {
        const error = new Error("Quantity returned must be greater than 0.");
        error.statusCode = 400;
        throw error;
      }

      const alreadyReturned = normalizeNumber(existing.quantity_returned);
      const totalReturned = alreadyReturned + quantityReturned;
      const totalIssued = normalizeNumber(existing.quantity_issued);
      if (totalReturned > totalIssued) {
        const error = new Error("Cannot return more than issued. Issued: " + totalIssued + ", Already returned: " + alreadyReturned);
        error.statusCode = 400;
        throw error;
      }

      const matchedItem = await findInventoryItem(connection, existing.item_id, existing.item_name);
      const newStatus = totalReturned >= totalIssued ? "fully_returned" : "partially_returned";

      if (matchedItem && quantityReturned > 0) {
        await queryWithConnection(connection, "UPDATE inventory SET stock = stock + ? WHERE id = ?", [quantityReturned, matchedItem.id]);
      }

      await queryWithConnection(
        connection,
        `UPDATE inventory_chef_issues SET quantity_returned = ?, status = ?, returned_at = NOW(), remarks = ? WHERE id = ?`,
        [totalReturned, newStatus, data.remarks || existing.remarks || null, req.params.id],
      );

      let nextItem = null;
      if (matchedItem) {
        nextItem = await getInventoryItemDetails(connection, matchedItem.id);
        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "chef_return",
          referenceId: req.params.id,
          direction: "IN",
          quantity: quantityReturned,
          unit: existing.unit || matchedItem.unit || null,
          locationName: existing.chef_name || null,
          rate: nextItem?.price || 0,
          amount: (nextItem?.price || 0) * quantityReturned,
          balanceAfter: Number(nextItem?.stock || 0),
          remarks: data.remarks || existing.remarks || null,
          entryDate: new Date().toISOString().slice(0, 10),
        });
      }

      await commitTransaction(connection);
      res.json({
        message: "Return recorded.",
        record: {
          id: req.params.id,
          itemId: existing.item_id,
          itemName: existing.item_name,
          quantityIssued: totalIssued,
          quantityReturned: totalReturned,
          unit: existing.unit,
          chefName: existing.chef_name,
          chefId: existing.chef_id,
          purpose: existing.purpose,
          status: newStatus,
          issuedAt: existing.issued_at,
          returnedAt: new Date().toISOString(),
          remarks: data.remarks || existing.remarks || null,
          createdBy: existing.created_by,
          balanceAfter: nextItem ? Number(nextItem.stock || 0) : null,
        },
      });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: error.message || "Failed to record return.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.getChefIssues = async (req, res) => {
  try {
    await ensureSchema();
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.chefId) filters.chefId = req.query.chefId;
    if (req.query.chefName) filters.chefName = req.query.chefName;

    let sql = `
      SELECT id, item_id AS itemId, item_name AS itemName,
             quantity_issued AS quantityIssued, quantity_returned AS quantityReturned,
             unit, chef_name AS chefName, chef_id AS chefId,
             purpose, status,
             DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i') AS issuedAt,
             DATE_FORMAT(returned_at, '%Y-%m-%d %H:%i') AS returnedAt,
             remarks, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
      FROM inventory_chef_issues
    `;
    const params = [];

    if (filters.status) {
      sql += " WHERE status = ?";
      params.push(filters.status);
    } else if (filters.chefId) {
      sql += params.length ? " AND chef_id = ?" : " WHERE chef_id = ?";
      params.push(filters.chefId);
    } else if (filters.chefName) {
      sql += params.length ? " AND chef_name = ?" : " WHERE chef_name = ?";
      params.push(filters.chefName);
    }

    sql += " ORDER BY issued_at DESC, id DESC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch chef issues.", error });
  }
};

exports.getChefIssueById = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, item_id AS itemId, item_name AS itemName,
              quantity_issued AS quantityIssued, quantity_returned AS quantityReturned,
              unit, chef_name AS chefName, chef_id AS chefId,
              purpose, status,
              DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i') AS issuedAt,
              DATE_FORMAT(returned_at, '%Y-%m-%d %H:%i') AS returnedAt,
              remarks, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM inventory_chef_issues
       WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!rows || !rows.length) {
      return res.status(404).json({ message: "Chef issue record not found." });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch chef issue.", error });
  }
};

exports.submitAudit = async (req, res) => {
  try {
    await ensureSchema();
    const entries = req.body.entries || [];
    if (!entries.length) return res.status(400).json({ message: "No audit entries provided." });

    let completed = 0;
    const errors = [];

    for (const entry of entries) {
      const data = { ...entry, auditedBy: req.user?.username || "system" };
      try {
        await db.query(
          `INSERT INTO inventory_stock_audit (item_id, item_name, system_stock, physical_stock, variance, unit, remarks, audit_date, audited_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
          [data.itemId, data.itemName, data.systemStock, data.physicalStock, data.variance, data.unit, data.remarks || null, data.auditedBy || "system"],
        );
      } catch (err) {
        errors.push({ item: entry.itemName, error: err.message });
      }
      completed += 1;
    }

    if (errors.length) {
      return res.status(207).json({ message: "Partial audit saved.", errors });
    }
    res.json({ message: `Audit submitted for ${entries.length} items.` });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch audit report.", error });
  }
};

exports.getAuditReport = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, item_id AS itemId, item_name AS itemName,
              system_stock AS systemStock, physical_stock AS physicalStock,
              variance, unit, remarks,
              DATE_FORMAT(audit_date, '%Y-%m-%d') AS auditDate,
              audited_by AS auditedBy
       FROM inventory_stock_audit
       ORDER BY audit_date DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch audit report.", error });
  }
};

exports.recordTransfer = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.itemName || !body.fromStore || !body.toStore || normalizeNumber(body.quantity) <= 0) {
      return res.status(400).json({ message: "itemName, fromStore, toStore and quantity > 0 are required." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const quantity = normalizeNumber(req.body.quantity);
      const matchedItem = await findInventoryItem(connection, req.body.itemId, req.body.itemName);
      const currentItem = matchedItem || null;
      const result = await queryWithConnection(
        connection,
        `INSERT INTO inventory_transfers (item_name, from_store, to_store, quantity, unit, approved_by, transfer_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [matchedItem?.name || req.body.itemName, req.body.fromStore, req.body.toStore, quantity, req.body.unit || matchedItem?.unit || null, req.body.approvedBy || null, req.body.date || null, req.body.notes || null],
      );

      if (matchedItem && quantity > 0) {
        const rate = normalizeNumber(currentItem.price);
        const destination = await resolveStockLocation(connection, req.body.toStore, req.body.toStoreId);
        let balanceAfter = normalizeNumber(currentItem.stock);

        if (destination) {
          balanceAfter = normalizeNumber(await locationStock(connection, matchedItem.id, destination)) + quantity;
          await connection.query(
            `INSERT INTO inventory_stock (inventory_item_id, location_id, quantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [matchedItem.id, destination, quantity],
          );
        }

        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "transfer_out",
          referenceId: result.insertId,
          direction: "OUT",
          quantity,
          unit: req.body.unit || matchedItem.unit || null,
          locationName: req.body.fromStore || null,
          rate,
          amount: rate * quantity,
          balanceAfter: normalizeNumber(currentItem.stock),
          remarks: req.body.notes || null,
          entryDate: req.body.date || null,
        });
        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "transfer_in",
          referenceId: result.insertId,
          direction: "IN",
          quantity,
          unit: req.body.unit || matchedItem.unit || null,
          locationName: req.body.toStore || null,
          rate,
          amount: rate * quantity,
          balanceAfter,
          remarks: req.body.notes || null,
          entryDate: req.body.date || null,
        });
      }

      await commitTransaction(connection);
      res.status(201).json({ message: "Transfer recorded.", id: result.insertId });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to record transfer.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.getTransfers = async (req, res) => {
  try {
    await ensureSchema();
    const [rows] = await db.query(
      `SELECT id, item_id AS itemId, item_name AS itemName, from_store AS fromStore, to_store AS toStore,
              quantity, unit, approved_by AS approvedBy,
              DATE_FORMAT(transfer_date, '%Y-%m-%d') AS date, notes
       FROM inventory_transfers
       ORDER BY transfer_date DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transfers.", error });
  }
};

exports.updateTransfer = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.itemName && !body.fromStore && !body.toStore) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const rows = await queryWithConnection(connection, "SELECT * FROM inventory_transfers WHERE id = ? LIMIT 1", [req.params.id]);
      const existing = rows[0];
      if (!existing) {
        const error = new Error("Transfer record not found.");
        error.statusCode = 404;
        throw error;
      }
      const quantity = normalizeNumber(req.body.quantity);
      const matchedItem = await findInventoryItem(connection, req.body.itemId || existing.item_id, req.body.itemName || existing.item_name);

      await queryWithConnection(connection, "DELETE FROM inventory_stock_ledger WHERE reference_id = ? AND reference_type IN ('transfer_out','transfer_in')", [req.params.id]);
      await queryWithConnection(
        connection,
        `UPDATE inventory_transfers SET item_id=?, item_name=?, from_store=?, to_store=?, quantity=?, unit=?, approved_by=?, transfer_date=?, notes=? WHERE id=?`,
        [matchedItem?.id || req.body.itemId || existing.item_id || null, matchedItem?.name || req.body.itemName || existing.item_name, req.body.fromStore, req.body.toStore, quantity, req.body.unit || matchedItem?.unit || existing.unit || null, req.body.approvedBy || null, req.body.date || null, req.body.notes || null, req.params.id],
      );

      if (matchedItem && quantity > 0) {
        const currentItem = await getInventoryItemDetails(connection, matchedItem.id);
        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "transfer_out",
          referenceId: req.params.id,
          direction: "OUT",
          quantity,
          unit: req.body.unit || matchedItem.unit || null,
          locationName: req.body.fromStore || null,
          rate: currentItem?.price || 0,
          amount: (currentItem?.price || 0) * quantity,
          balanceAfter: Number(currentItem?.stock || 0),
          remarks: req.body.notes || null,
          entryDate: req.body.date || null,
        });
        await writeLedgerEntry(connection, {
          itemId: matchedItem.id,
          itemName: matchedItem.name,
          referenceType: "transfer_in",
          referenceId: req.params.id,
          direction: "IN",
          quantity,
          unit: req.body.unit || matchedItem.unit || null,
          locationName: req.body.toStore || null,
          rate: currentItem?.price || 0,
          amount: (currentItem?.price || 0) * quantity,
          balanceAfter: Number(currentItem?.stock || 0),
          remarks: req.body.notes || null,
          entryDate: req.body.date || null,
        });
      }
      await commitTransaction(connection);
      res.json({ message: "Transfer updated." });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to update transfer.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};

exports.deleteTransfer = async (req, res) => {
  try {
    await ensureSchema();
    const connection = await getConnection();
    try {
      await beginTransaction(connection);
      const rows = await queryWithConnection(connection, "SELECT id FROM inventory_transfers WHERE id = ? LIMIT 1", [req.params.id]);
      if (!rows[0]) {
        const error = new Error("Transfer record not found.");
        error.statusCode = 404;
        throw error;
      }
      await queryWithConnection(connection, "DELETE FROM inventory_transfers WHERE id = ?", [req.params.id]);
      await queryWithConnection(connection, "DELETE FROM inventory_stock_ledger WHERE reference_id = ? AND reference_type IN ('transfer_out','transfer_in')", [req.params.id]);
      await commitTransaction(connection);
      res.json({ message: "Transfer deleted." });
    } catch (error) {
      await rollbackTransaction(connection);
      const status = error.statusCode || 500;
      res.status(status).json({ message: "Failed to delete transfer.", error });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to prepare inventory schema.", error });
  }
};
