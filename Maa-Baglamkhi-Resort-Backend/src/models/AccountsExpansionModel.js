const db = require("../config/db");

const runQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

const columnExists = async (tableName, columnName) => {
  const rows = await runQuery(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  return Array.isArray(rows) && rows.length > 0;
};

const ensureColumn = async (tableName, columnName, definition) => {
  if (!(await columnExists(tableName, columnName))) {
    await runQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const getInvoiceSchemaConfig = async () => {
  const [
    hasCustomerName,
    hasGuestName,
    hasTotalAmount,
    hasFinalTotal,
    hasSubtotal,
    hasPaymentMode,
    hasPaymentStatus,
    hasStatus,
    hasDate,
    hasCreatedAt,
    hasRoomNo,
  ] = await Promise.all([
    columnExists("invoices", "customer_name"),
    columnExists("invoices", "guest_name"),
    columnExists("invoices", "total_amount"),
    columnExists("invoices", "final_total"),
    columnExists("invoices", "subtotal"),
    columnExists("invoices", "payment_mode"),
    columnExists("invoices", "payment_status"),
    columnExists("invoices", "status"),
    columnExists("invoices", "date"),
    columnExists("invoices", "created_at"),
    columnExists("invoices", "room_no"),
  ]);

  const customerNameExpr = hasCustomerName && hasGuestName
    ? "COALESCE(NULLIF(i.customer_name, ''), NULLIF(i.guest_name, ''), 'Walk-in Guest')"
    : hasCustomerName
      ? "COALESCE(NULLIF(i.customer_name, ''), 'Walk-in Guest')"
      : hasGuestName
        ? "COALESCE(NULLIF(i.guest_name, ''), 'Walk-in Guest')"
        : "'Walk-in Guest'";

  const sourceAmountParts = [];
  if (hasTotalAmount) sourceAmountParts.push("NULLIF(i.total_amount, 0)");
  if (hasFinalTotal) sourceAmountParts.push("NULLIF(i.final_total, 0)");
  if (hasSubtotal) sourceAmountParts.push("NULLIF(i.subtotal, 0)");

  const sourceAmountExpr = sourceAmountParts.length
    ? `COALESCE(${sourceAmountParts.join(", ")}, 0)`
    : "0";

  const paymentModeExpr = hasPaymentMode
    ? "COALESCE(NULLIF(i.payment_mode, ''), 'Unknown')"
    : "'Unknown'";

  const sourceStatusExpr = hasPaymentStatus && hasStatus
    ? "COALESCE(NULLIF(i.payment_status, ''), NULLIF(i.status, ''), 'Pending')"
    : hasPaymentStatus
      ? "COALESCE(NULLIF(i.payment_status, ''), 'Pending')"
      : hasStatus
        ? "COALESCE(NULLIF(i.status, ''), 'Pending')"
        : "'Pending'";

  const paidFilterExpr = hasPaymentStatus && hasStatus
    ? "LOWER(COALESCE(i.payment_status, i.status, 'pending')) = 'paid'"
    : hasPaymentStatus
      ? "LOWER(COALESCE(i.payment_status, 'pending')) = 'paid'"
      : hasStatus
        ? "LOWER(COALESCE(i.status, 'pending')) = 'paid'"
        : "1 = 0";

  const sourceDateExpr = hasDate && hasCreatedAt
    ? "COALESCE(i.date, DATE(i.created_at))"
    : hasDate
      ? "i.date"
      : hasCreatedAt
        ? "DATE(i.created_at)"
        : "CURDATE()";

  const sourceLabelExpr = hasRoomNo
    ? "CONCAT('Room ', COALESCE(NULLIF(i.room_no, ''), '-'))"
    : "'Room -'";

  return {
    customerNameExpr,
    sourceAmountExpr,
    paymentModeExpr,
    sourceStatusExpr,
    paidFilterExpr,
    sourceDateExpr,
    sourceLabelExpr,
  };
};

const getLedgerAmount = (row = {}) =>
  Number(row.amount || 0) || Number(row.credit || 0) || Number(row.debit || 0) || 0;

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const getDerivedMatchStatus = (item = {}) => {
  const explicit = normalizeText(item.matchStatus);
  if (explicit && explicit !== "unmatched") {
    return explicit;
  }

  const sourceAmount = Number(item.sourceAmount || 0);
  const bankAmount = Number(item.bankAmount || 0);
  const difference = Math.abs(Number(item.difference || 0));

  if (!bankAmount) return "unmatched";
  if (difference < 0.01) {
    return normalizeText(item.reconciliationStatus) === "reconciled" ? "reconciled" : "matched";
  }
  if (bankAmount > 0 && sourceAmount > 0) return "partial";
  return "unmatched";
};

async function ensureSchema() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS account_bank_ledgers (
      id INT NOT NULL AUTO_INCREMENT,
      entry_date DATE NOT NULL,
      bank_name VARCHAR(255) NOT NULL,
      reference_no VARCHAR(120) DEFAULT NULL,
      description VARCHAR(255) NOT NULL,
      debit DECIMAL(12,2) NOT NULL DEFAULT 0,
      credit DECIMAL(12,2) NOT NULL DEFAULT 0,
      reconciliation_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_bank_ledger_date (entry_date),
      INDEX idx_bank_ledger_bank (bank_name)
    )
  `);

  await ensureColumn("account_bank_ledgers", "bank_account", "VARCHAR(255) NULL AFTER bank_name");
  await ensureColumn("account_bank_ledgers", "source_type", "VARCHAR(50) NULL AFTER bank_account");
  await ensureColumn("account_bank_ledgers", "source_id", "INT NULL AFTER source_type");
  await ensureColumn("account_bank_ledgers", "payment_mode", "VARCHAR(50) NULL AFTER source_id");
  await ensureColumn("account_bank_ledgers", "amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER payment_mode");
  await ensureColumn("account_bank_ledgers", "direction", "VARCHAR(10) NOT NULL DEFAULT 'in' AFTER amount");
  await ensureColumn("account_bank_ledgers", "match_status", "VARCHAR(30) NOT NULL DEFAULT 'unmatched' AFTER reconciliation_status");
  await ensureColumn("account_bank_ledgers", "matched_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER match_status");
  await ensureColumn("account_bank_ledgers", "statement_ref", "VARCHAR(120) NULL AFTER matched_amount");
  await ensureColumn("account_bank_ledgers", "statement_date", "DATE NULL AFTER statement_ref");
  await ensureColumn("account_bank_ledgers", "reconciled_at", "DATETIME NULL AFTER statement_date");

  await runQuery(`
    CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
      id INT NOT NULL AUTO_INCREMENT,
      bank_ledger_id INT NOT NULL,
      source_type VARCHAR(50) NOT NULL,
      source_id INT NOT NULL,
      source_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      matched_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      match_status VARCHAR(30) NOT NULL DEFAULT 'matched',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_reco_match_source (source_type, source_id),
      INDEX idx_reco_match_bank (bank_ledger_id)
    )
  `);

  await runQuery(`
    UPDATE account_bank_ledgers
    SET
      amount = CASE
        WHEN COALESCE(amount, 0) = 0 AND credit > 0 THEN credit
        WHEN COALESCE(amount, 0) = 0 AND debit > 0 THEN debit
        ELSE amount
      END,
      direction = CASE
        WHEN LOWER(COALESCE(direction, '')) IN ('in', 'out') THEN direction
        WHEN credit > 0 THEN 'in'
        WHEN debit > 0 THEN 'out'
        ELSE 'in'
      END,
      payment_mode = COALESCE(NULLIF(payment_mode, ''), 'Manual'),
      source_type = COALESCE(NULLIF(source_type, ''), NULL),
      match_status = CASE
        WHEN LOWER(COALESCE(reconciliation_status, '')) = 'reconciled' THEN 'reconciled'
        WHEN LOWER(COALESCE(match_status, '')) IN ('matched', 'partial', 'reconciled') THEN match_status
        ELSE 'unmatched'
      END,
      matched_amount = CASE
        WHEN matched_amount > 0 THEN matched_amount
        WHEN LOWER(COALESCE(reconciliation_status, '')) = 'reconciled' THEN
          CASE
            WHEN COALESCE(amount, 0) > 0 THEN amount
            WHEN credit > 0 THEN credit
            WHEN debit > 0 THEN debit
            ELSE 0
          END
        ELSE matched_amount
      END
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS petty_cash_entries (
      id INT NOT NULL AUTO_INCREMENT,
      entry_date DATE NOT NULL,
      entry_type VARCHAR(20) NOT NULL,
      category VARCHAR(120) NOT NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      approved_by VARCHAR(255) DEFAULT NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_petty_cash_date (entry_date),
      INDEX idx_petty_cash_type (entry_type)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS gst_return_records (
      id INT NOT NULL AUTO_INCREMENT,
      filing_period VARCHAR(20) NOT NULL,
      return_type VARCHAR(50) NOT NULL,
      taxable_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_collected DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
      net_payable DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'Draft',
      filed_on DATE DEFAULT NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_gst_period (filing_period),
      INDEX idx_gst_status (status)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS vendor_payment_records (
      id INT NOT NULL AUTO_INCREMENT,
      vendor_name VARCHAR(255) NOT NULL,
      invoice_ref VARCHAR(120) DEFAULT NULL,
      payment_date DATE NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_mode VARCHAR(50) NOT NULL DEFAULT 'Bank Transfer',
      status VARCHAR(50) NOT NULL DEFAULT 'Scheduled',
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_vendor_payment_date (payment_date),
      INDEX idx_vendor_payment_vendor (vendor_name)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT NOT NULL AUTO_INCREMENT,
      po_number VARCHAR(100) NOT NULL,
      vendor_name VARCHAR(255) NOT NULL,
      order_date DATE NOT NULL,
      expected_date DATE DEFAULT NULL,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_purchase_order_number (po_number),
      INDEX idx_purchase_order_date (order_date)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS payroll_records (
      id INT NOT NULL AUTO_INCREMENT,
      staff_name VARCHAR(255) NOT NULL,
      payroll_month VARCHAR(20) NOT NULL,
      attendance_days INT NOT NULL DEFAULT 0,
      base_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
      allowance DECIMAL(12,2) NOT NULL DEFAULT 0,
      deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
      net_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_payroll_month (payroll_month),
      INDEX idx_payroll_staff (staff_name)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS profit_center_entries (
      id INT NOT NULL AUTO_INCREMENT,
      center_name VARCHAR(100) NOT NULL,
      entry_date DATE NOT NULL,
      income_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      expense_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_profit_center_name (center_name),
      INDEX idx_profit_center_date (entry_date)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS payment_gateway_settings (
      id INT NOT NULL AUTO_INCREMENT,
      payment_mode VARCHAR(50) NOT NULL,
      department VARCHAR(50) NOT NULL DEFAULT 'Hotel',
      provider_name VARCHAR(100) DEFAULT NULL,
      upi_id VARCHAR(150) DEFAULT NULL,
      account_holder_name VARCHAR(150) DEFAULT NULL,
      bank_name VARCHAR(150) DEFAULT NULL,
      qr_image_url VARCHAR(255) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_payment_gateway_mode (payment_mode),
      INDEX idx_payment_gateway_department (department)
    )
  `);
}

// Whitelist for dynamic SQL table/column names. All internal callers use
// hardcoded values from the list below; this guard prevents any future
// caller from passing user-controlled strings into a query.
const SAFE_TABLES = new Set([
  "account_bank_ledgers",
  "petty_cash_entries",
  "gst_return_records",
  "vendor_payment_records",
  "purchase_orders",
  "payroll_records",
  "profit_center_entries",
  "payment_gateway_settings",
]);

const SAFE_COLUMNS_BY_TABLE = {
  account_bank_ledgers:  new Set(["entry_date", "created_at", "id"]),
  petty_cash_entries:    new Set(["entry_date", "created_at", "id"]),
  gst_return_records:    new Set(["created_at", "id"]),
  vendor_payment_records:new Set(["payment_date", "created_at", "id"]),
  purchase_orders:       new Set(["order_date", "created_at", "id"]),
  payroll_records:       new Set(["created_at", "id"]),
  profit_center_entries: new Set(["entry_date", "created_at", "id"]),
  payment_gateway_settings: new Set(["updated_at", "created_at", "id"]),
};

function assertSafeTable(name) {
  if (!SAFE_TABLES.has(name)) {
    const err = new Error(`table not allowed: ${name}`);
    err.statusCode = 400;
    throw err;
  }
}

function assertSafeColumn(table, col) {
  const allowed = SAFE_COLUMNS_BY_TABLE[table];
  if (!allowed || !allowed.has(col)) {
    const err = new Error(`order column not allowed for ${table}: ${col}`);
    err.statusCode = 400;
    throw err;
  }
}

const listRows = (tableName, orderColumn = "created_at") => {
  assertSafeTable(tableName);
  assertSafeColumn(tableName, orderColumn);
  return runQuery(`SELECT * FROM ${tableName} ORDER BY ${orderColumn} DESC, id DESC`);
};

const insertRow = (tableName, data) => {
  assertSafeTable(tableName);
  return runQuery(`INSERT INTO ${tableName} SET ?`, [data]);
};

const updateRow = (tableName, id, data) => {
  assertSafeTable(tableName);
  return runQuery(`UPDATE ${tableName} SET ? WHERE id = ?`, [data, id]);
};

const deleteRow = (tableName, id) => {
  assertSafeTable(tableName);
  return runQuery(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
};

const getPaymentGatewaySettingById = async (id) => {
  const rows = await runQuery(
    "SELECT * FROM payment_gateway_settings WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] || null;
};

const getBankLedgerBySource = async (sourceType, sourceId) => {
  const rows = await runQuery(
    `
      SELECT *
      FROM account_bank_ledgers
      WHERE source_type = ?
        AND source_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [sourceType, sourceId],
  );
  return rows[0] || null;
};

const getReconciliationSourceRows = async () => {
  const invoiceConfig = await getInvoiceSchemaConfig();
  const sourceRows = await runQuery(`
    SELECT
      'invoice' AS source_type,
      i.id AS source_id,
      COALESCE(NULLIF(i.invoice_no, ''), CONCAT('Invoice #', i.id)) AS source_reference,
      ${invoiceConfig.customerNameExpr} AS party_name,
      ${invoiceConfig.sourceAmountExpr} AS source_amount,
      ${invoiceConfig.paymentModeExpr} AS payment_mode,
      ${invoiceConfig.sourceStatusExpr} AS source_status,
      ${invoiceConfig.sourceDateExpr} AS source_date,
      ${invoiceConfig.sourceLabelExpr} AS source_label,
      'in' AS direction
    FROM invoices i
    WHERE ${invoiceConfig.paidFilterExpr}

    UNION ALL

    SELECT
      'restaurant_bill' AS source_type,
      rb.id AS source_id,
      COALESCE(
        CONCAT('REST-', NULLIF(rb.modern_bill_id, 0)),
        CONCAT('Restaurant Bill #', rb.id)
      ) AS source_reference,
      COALESCE(NULLIF(rb.customerName, ''), 'Restaurant Guest') AS party_name,
      COALESCE(rb.total, 0) AS source_amount,
      COALESCE(NULLIF(rb.paymentMethod, ''), 'Unknown') AS payment_mode,
      COALESCE(NULLIF(rb.invoiceStatus, ''), 'Pending') AS source_status,
      DATE(COALESCE(rb.paid_at, rb.created_at)) AS source_date,
      CONCAT('Table ', COALESCE(NULLIF(rb.tableNumber, ''), '-')) AS source_label,
      'in' AS direction
    FROM restaurant_bills rb
    WHERE LOWER(COALESCE(rb.invoiceStatus, 'pending')) = 'paid'

    UNION ALL

    SELECT
      'vendor_payment' AS source_type,
      vp.id AS source_id,
      COALESCE(NULLIF(vp.invoice_ref, ''), CONCAT('Vendor Payment #', vp.id)) AS source_reference,
      COALESCE(NULLIF(vp.vendor_name, ''), 'Vendor') AS party_name,
      COALESCE(vp.amount, 0) AS source_amount,
      COALESCE(NULLIF(vp.payment_mode, ''), 'Bank Transfer') AS payment_mode,
      COALESCE(NULLIF(vp.status, ''), 'Scheduled') AS source_status,
      vp.payment_date AS source_date,
      COALESCE(NULLIF(vp.vendor_name, ''), 'Vendor') AS source_label,
      'out' AS direction
    FROM vendor_payment_records vp
    WHERE LOWER(COALESCE(vp.status, 'scheduled')) IN ('paid', 'processed', 'completed')

    UNION ALL

    SELECT
      'banquet' AS source_type,
      bb.id AS source_id,
      COALESCE(NULLIF(bb.invoice_no, ''), CONCAT('Banquet #', bb.id)) AS source_reference,
      COALESCE(NULLIF(bb.customer_name, ''), 'Banquet Guest') AS party_name,
      COALESCE(bb.grand_total, 0) AS source_amount,
      COALESCE(NULLIF(bb.payment_mode, ''), 'Unknown') AS payment_mode,
      COALESCE(NULLIF(bb.payment_status, ''), 'Pending') AS source_status,
      bb.date AS source_date,
      COALESCE(NULLIF(h.name, ''), 'Banquet Hall') AS source_label,
      'in' AS direction
    FROM banquet_bookings bb
    LEFT JOIN banquet_halls h ON h.id = bb.hall_id
    WHERE COALESCE(bb.invoice_no, '') <> ''
      AND LOWER(COALESCE(bb.payment_status, 'pending')) = 'paid'
  `);

  return Array.isArray(sourceRows) ? sourceRows : [];
};

const getReconciliationLedgerMap = async () => {
  const ledgerRows = await runQuery(`
    SELECT
      source_type,
      source_id,
      MAX(id) AS linked_bank_ledger_id,
      COUNT(*) AS ledger_count,
      SUM(COALESCE(NULLIF(amount, 0), NULLIF(credit, 0), NULLIF(debit, 0), 0)) AS bank_amount,
      MAX(reconciliation_status) AS reconciliation_status,
      MAX(match_status) AS match_status,
      MAX(bank_name) AS bank_name,
      MAX(bank_account) AS bank_account,
      MAX(reference_no) AS reference_no,
      MAX(payment_mode) AS payment_mode,
      MAX(statement_ref) AS statement_ref,
      MAX(statement_date) AS statement_date,
      MAX(reconciled_at) AS reconciled_at
    FROM account_bank_ledgers
    WHERE source_type IS NOT NULL
      AND source_type <> ''
      AND source_id IS NOT NULL
    GROUP BY source_type, source_id
  `);

  return new Map(
    (Array.isArray(ledgerRows) ? ledgerRows : []).map((row) => [
      `${row.source_type}:${row.source_id}`,
      row,
    ]),
  );
};

async function listReconciliationItems(filters = {}) {
  const [sourceRows, ledgerMap] = await Promise.all([
    getReconciliationSourceRows(),
    getReconciliationLedgerMap(),
  ]);

  return sourceRows
    .map((row) => {
      const ledger = ledgerMap.get(`${row.source_type}:${row.source_id}`) || {};
      const sourceAmount = Number(row.source_amount || 0);
      const bankAmount = Number(ledger.bank_amount || 0);
      const difference = Number((sourceAmount - bankAmount).toFixed(2));
      const item = {
        sourceType: row.source_type,
        sourceId: Number(row.source_id || 0),
        sourceReference: row.source_reference,
        partyName: row.party_name,
        sourceAmount,
        bankAmount,
        difference,
        paymentMode: row.payment_mode || ledger.payment_mode || "Unknown",
        sourceStatus: row.source_status,
        reconciliationStatus: ledger.reconciliation_status || "Pending",
        matchStatus: ledger.match_status || "unmatched",
        sourceDate: row.source_date,
        sourceLabel: row.source_label,
        direction: row.direction,
        bankName: ledger.bank_name || null,
        bankAccount: ledger.bank_account || null,
        ledgerReferenceNo: ledger.reference_no || null,
        statementRef: ledger.statement_ref || null,
        statementDate: ledger.statement_date || null,
        reconciledAt: ledger.reconciled_at || null,
        ledgerCount: Number(ledger.ledger_count || 0),
        linkedBankLedgerId: Number(ledger.linked_bank_ledger_id || 0) || null,
      };

      item.matchStatus = getDerivedMatchStatus(item);
      return item;
    })
    .filter((item) => {
      const matchesPaymentMode =
        !filters.paymentMode ||
        filters.paymentMode === "all" ||
        normalizeText(item.paymentMode) === normalizeText(filters.paymentMode);
      const matchesSourceType =
        !filters.sourceType ||
        filters.sourceType === "all" ||
        normalizeText(item.sourceType) === normalizeText(filters.sourceType);
      const matchesMatchStatus =
        !filters.matchStatus ||
        filters.matchStatus === "all" ||
        normalizeText(item.matchStatus) === normalizeText(filters.matchStatus);

      return matchesPaymentMode && matchesSourceType && matchesMatchStatus;
    })
    .sort((left, right) => {
      const leftTime = new Date(left.sourceDate || 0).getTime();
      const rightTime = new Date(right.sourceDate || 0).getTime();
      return rightTime - leftTime || right.sourceId - left.sourceId;
    });
}

async function getReconciliationSummary(filters = {}) {
  const [items, ledgerRows] = await Promise.all([
    listReconciliationItems(filters),
    runQuery(`
      SELECT
        direction,
        SUM(COALESCE(NULLIF(amount, 0), NULLIF(credit, 0), NULLIF(debit, 0), 0)) AS total
      FROM account_bank_ledgers
      GROUP BY direction
    `),
  ]);

  const totalsByDirection = (Array.isArray(ledgerRows) ? ledgerRows : []).reduce((acc, row) => {
    acc[normalizeText(row.direction || "in")] = Number(row.total || 0);
    return acc;
  }, {});

  return {
    totalBankIn: totalsByDirection.in || 0,
    totalBankOut: totalsByDirection.out || 0,
    matchedAmount: items
      .filter((item) => ["matched", "reconciled"].includes(item.matchStatus))
      .reduce((sum, item) => sum + item.bankAmount, 0),
    unmatchedAmount: items
      .filter((item) => item.matchStatus === "unmatched")
      .reduce((sum, item) => sum + item.sourceAmount, 0),
    partialAmount: items
      .filter((item) => item.matchStatus === "partial")
      .reduce((sum, item) => sum + Math.abs(item.difference), 0),
    reconciledAmount: items
      .filter((item) => normalizeText(item.reconciliationStatus) === "reconciled")
      .reduce((sum, item) => sum + item.bankAmount, 0),
    totalItems: items.length,
    unmatchedItems: items.filter((item) => item.matchStatus === "unmatched").length,
    partialItems: items.filter((item) => item.matchStatus === "partial").length,
    matchedItems: items.filter((item) => ["matched", "reconciled"].includes(item.matchStatus)).length,
  };
}

const matchBankLedger = async ({ bankLedgerId, sourceType, sourceId, matchedAmount }) => {
  const rows = await runQuery(
    `
      SELECT id, amount, credit, debit, reconciliation_status
      FROM account_bank_ledgers
      WHERE id = ?
      LIMIT 1
    `,
    [bankLedgerId],
  );

  if (!rows.length) {
    return { affectedRows: 0 };
  }

  const ledger = rows[0];
  const amount = Number(matchedAmount || getLedgerAmount(ledger));
  const matchStatus =
    normalizeText(ledger.reconciliation_status) === "reconciled" ? "reconciled" : "matched";

  await runQuery(
    `
      UPDATE account_bank_ledgers
      SET
        source_type = ?,
        source_id = ?,
        matched_amount = ?,
        match_status = ?
      WHERE id = ?
    `,
    [sourceType, Number(sourceId || 0), amount, matchStatus, bankLedgerId],
  );

  await runQuery(
    `
      INSERT INTO bank_reconciliation_matches
      (bank_ledger_id, source_type, source_id, source_amount, matched_amount, match_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [bankLedgerId, sourceType, Number(sourceId || 0), amount, amount, matchStatus],
  );

  return { affectedRows: 1 };
};

const unmatchBankLedger = async ({ bankLedgerId }) =>
  runQuery(
    `
      UPDATE account_bank_ledgers
      SET
        source_type = NULL,
        source_id = NULL,
        match_status = 'unmatched',
        matched_amount = 0
      WHERE id = ?
    `,
    [bankLedgerId],
  );

async function getExtendedSummary() {
  const [
    bankPending,
    pettyCash,
    gst,
    vendors,
    purchaseOrders,
    payroll,
    profitCenters,
  ] = await Promise.all([
    runQuery("SELECT COUNT(*) AS count FROM account_bank_ledgers WHERE reconciliation_status <> 'Reconciled'"),
    runQuery("SELECT COALESCE(SUM(CASE WHEN entry_type = 'In' THEN amount ELSE -amount END), 0) AS balance FROM petty_cash_entries"),
    runQuery("SELECT COALESCE(SUM(net_payable), 0) AS payable FROM gst_return_records WHERE status <> 'Filed'"),
    runQuery("SELECT COALESCE(SUM(amount), 0) AS total FROM vendor_payment_records WHERE status <> 'Paid'"),
    runQuery("SELECT COUNT(*) AS count FROM purchase_orders WHERE status NOT IN ('Closed', 'Cancelled')"),
    runQuery("SELECT COALESCE(SUM(net_salary), 0) AS total FROM payroll_records"),
    runQuery("SELECT center_name, COALESCE(SUM(income_amount - expense_amount), 0) AS net FROM profit_center_entries GROUP BY center_name ORDER BY center_name"),
  ]);

  return {
    pendingBankReconciliation: Number(bankPending?.[0]?.count || 0),
    pettyCashBalance: Number(pettyCash?.[0]?.balance || 0),
    gstPendingPayable: Number(gst?.[0]?.payable || 0),
    vendorOutstanding: Number(vendors?.[0]?.total || 0),
    openPurchaseOrders: Number(purchaseOrders?.[0]?.count || 0),
    payrollTotal: Number(payroll?.[0]?.total || 0),
    profitCenters: profitCenters.map((row) => ({
      centerName: row.center_name,
      net: Number(row.net || 0),
    })),
  };
}

module.exports = {
  ensureSchema,
  getExtendedSummary,
  getReconciliationSummary,
  listReconciliationItems,
  matchBankLedger,
  unmatchBankLedger,
  listBankLedger: () => listRows("account_bank_ledgers", "entry_date"),
  addBankLedger: (data) => insertRow("account_bank_ledgers", data),
  updateBankLedger: (id, data) => updateRow("account_bank_ledgers", id, data),
  deleteBankLedger: (id) => deleteRow("account_bank_ledgers", id),
  listPettyCash: () => listRows("petty_cash_entries", "entry_date"),
  addPettyCash: (data) => insertRow("petty_cash_entries", data),
  updatePettyCash: (id, data) => updateRow("petty_cash_entries", id, data),
  deletePettyCash: (id) => deleteRow("petty_cash_entries", id),
  listGstReturns: () => listRows("gst_return_records", "created_at"),
  addGstReturn: (data) => insertRow("gst_return_records", data),
  updateGstReturn: (id, data) => updateRow("gst_return_records", id, data),
  deleteGstReturn: (id) => deleteRow("gst_return_records", id),
  listVendorPayments: () => listRows("vendor_payment_records", "payment_date"),
  addVendorPayment: (data) => insertRow("vendor_payment_records", data),
  updateVendorPayment: (id, data) => updateRow("vendor_payment_records", id, data),
  deleteVendorPayment: (id) => deleteRow("vendor_payment_records", id),
  listPurchaseOrders: () => listRows("purchase_orders", "order_date"),
  addPurchaseOrder: (data) => insertRow("purchase_orders", data),
  updatePurchaseOrder: (id, data) => updateRow("purchase_orders", id, data),
  deletePurchaseOrder: (id) => deleteRow("purchase_orders", id),
  listPayrollRecords: () => listRows("payroll_records", "created_at"),
  addPayrollRecord: (data) => insertRow("payroll_records", data),
  updatePayrollRecord: (id, data) => updateRow("payroll_records", id, data),
  deletePayrollRecord: (id) => deleteRow("payroll_records", id),
  listProfitCenters: () => listRows("profit_center_entries", "entry_date"),
  addProfitCenter: (data) => insertRow("profit_center_entries", data),
  updateProfitCenter: (id, data) => updateRow("profit_center_entries", id, data),
  deleteProfitCenter: (id) => deleteRow("profit_center_entries", id),
  listPaymentGatewaySettings: () => listRows("payment_gateway_settings", "updated_at"),
  getPaymentGatewaySettingById,
  getBankLedgerBySource,
  addPaymentGatewaySetting: (data) => insertRow("payment_gateway_settings", data),
  updatePaymentGatewaySetting: (id, data) => updateRow("payment_gateway_settings", id, data),
  deletePaymentGatewaySetting: (id) => deleteRow("payment_gateway_settings", id),
};
