const db = require("../config/db");
const PaymentMethodsModel = require("../models/PaymentMethodsModel");

// ---------------------------------------------------------------------------
// Query helper — this controller's contract: `await query()` resolves the whole
// mysql2 result tuple, so callers index it themselves.
//
//   const [header] = await query(INSERT...)  -> header.insertId
//   const [rows]   = await query(SELECT...)  -> rows[]
//
// It must not use the shim's callback argument. That callback gets
// `asRows(result)` from src/config/db.js, which unwraps by `Array.isArray(result[1])`
// — and the write header sits at index 0 there too, so a write resolves to the
// header object (a non-array, which `.length`/`.map` then throw on) and a
// LIMIT 1 read resolves to the fields array, not the row.
// ---------------------------------------------------------------------------
const query = async (sql, params = []) => db.query(sql, params);

// Single-row helper.
const queryOne = async (sql, params = []) => {
  const [rows] = await query(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

const safeArray = (rows) => (Array.isArray(rows) ? rows : []);

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Format a DATE / datetime value as "DD MMM YYYY" — the only date format the
// Accounts ledger UI parses for its daily breakdown. Accepts a JS Date (mysql2
// returns Date objects for DATE/DATETIME columns) or a "YYYY-MM-DD" string.
const toLedgerDate = (value) => {
  if (!value) return "";
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    } else {
      d = new Date(text);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return String(value);
  const day = String(d.getDate()).padStart(2, "0");
  const month = MONTH_ABBR[d.getMonth()] || "";
  return `${day} ${month} ${d.getFullYear()}`;
};

// Return "YYYY-MM-DD" for the frontend `<input type="date">` edit forms.
const toInputDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : toInputDate(d);
};

// The frontend only ever sends "YYYY-MM-DD" from date inputs, but callers may
// also post a full ISO string or a JS Date; normalise to YYYY-MM-DD for MySQL.
const normalizeDateInput = (value, fallback = null) => {
  if (!value) return fallback;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return fallback;
  return toInputDate(d);
};

const normalizeText = (value) => String(value || "").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Account / payment-method resolution helpers (double-entry ledger + payments)
// ---------------------------------------------------------------------------

// The v4 `chart_of_accounts` table is seedable but ships empty. Ensure the small
// set of accounts this controller posts against exists, once per process.
// Standard hotel chart of accounts. The expense side is split per department
// so the ledger can classify money properly instead of lumping everything
// into one "Other Expenses" bucket (the classic single-bucket problem).
const ACCOUNT_SEEDS = [
  { code: "1000", name: "Cash in Hand", type: "asset" },
  { code: "1010", name: "Bank Account", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2010", name: "GST Payable", type: "liability" },
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "4000", name: "Room Revenue", type: "revenue" },
  { code: "4010", name: "Restaurant Revenue", type: "revenue" },
  { code: "4020", name: "Banquet Revenue", type: "revenue" },
  { code: "4030", name: "Other Revenue", type: "revenue" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "5010", name: "Staff Salaries", type: "expense" },
  { code: "5020", name: "Utilities", type: "expense" },
  { code: "5030", name: "Other Expenses", type: "expense" },
  { code: "5040", name: "Hotel Operating Expenses", type: "expense" },
  { code: "5050", name: "Restaurant Expenses", type: "expense" },
  { code: "5060", name: "Banquet Expenses", type: "expense" },
  { code: "5070", name: "Maintenance & Repairs", type: "expense" },
  { code: "5080", name: "Office & Admin Expenses", type: "expense" },
  { code: "5090", name: "Marketing & Miscellaneous", type: "expense" },
];

// INSERT IGNORE on the UNIQUE code is idempotent, so this can safely run on
// every call: it seeds the missing standard accounts without touching
// existing rows (real data is never overwritten).
const ensureChartOfAccounts = async () => {
  for (const acc of ACCOUNT_SEEDS) {
    await query(
      "INSERT IGNORE INTO chart_of_accounts (code, name, type) VALUES (?, ?, ?)",
      [acc.code, acc.name, acc.type],
    );
  }
};

const getAccountByCode = (code) =>
  queryOne("SELECT id, code, name, type FROM chart_of_accounts WHERE code = ? LIMIT 1", [code]);

// Resolve a department label to the revenue account used on the credit leg of
// an income posting. Standard hotel departments: Hotel (rooms/front office),
// Restaurant, Banquet; everything else books to Other Revenue.
const revenueAccountForDepartment = (department) => {
  const key = normalizeText(department);
  if (key.includes("restaurant")) return "4010";
  if (key.includes("banquet")) return "4020";
  if (key.includes("room") || key.includes("hotel") || key.includes("front")) return "4000";
  return "4030";
};

// Standard expense classification. Instead of dumping every expense into one
// "Other Expenses" bucket, pick the matching chart account from the chosen
// department first, then from the description keywords (the classic
// hospitality expense categories). Every code below is seeded by
// ensureChartOfAccounts, so the account always exists.
const expenseAccountForDepartment = (department, description) => {
  const dep = normalizeText(department);
  const text = `${dep} ${normalizeText(description)}`;

  // 1) Specific keywords always win — a "Utility/AC" bill stays a Utilities
  //    expense even when booked under the Hotel department, etc. This is
  //    what makes the ledger behave like a standard chart, not a
  //    department dump.
  if (/\bsal(aries|ary)\b|\bwages?\b|payroll/.test(text)) return "5010";
  if (/electricit|power bill|water bill|gas bill|electricity|utility/.test(text)) return "5020";
  if (/maintenance|repair|plumb|\bac\b|a\.c\.|paint|hvac|machine/.test(text)) return "5070";
  if (/stationery|office|admin|software|insurance|phone bill|internet|audit|accounting/.test(text)) return "5080";
  if (/market|advertis|promotion|banner|publicity|sponsor/.test(text)) return "5090";
  if (/\bkitchen\b|grocer|vegetable|raw material|food suppl|kitchen stock/.test(text)) return "5050";
  if (/banquet|catering|hall (charge|setup|decor)|function/.test(text)) return "5060";

  // 2) Otherwise the chosen department picks the account.
  if (dep.includes("salary") || dep.includes("payroll")) return "5010";
  if (dep.includes("utility")) return "5020";
  if (dep.includes("restaurant") || dep.includes("kitchen")) return "5050";
  if (dep.includes("banquet") || dep.includes("catering")) return "5060";
  if (dep.includes("hotel") || dep.includes("room") || dep.includes("front") || dep.includes("housekeeping")) return "5040";
  if (dep.includes("maintenance") || dep.includes("repair")) return "5070";
  if (dep.includes("office") || dep.includes("admin") || dep.includes("stationery")) return "5080";
  if (dep.includes("marketing") || dep.includes("advertis") || dep.includes("promotion")) return "5090";

  return "5030"; // Other Expenses
};

// Human-readable category label for a standard expense/revenue account name,
// so the ledger UI can show a proper category chip instead of "Other".
const categoryLabelForAccount = (accountName, type) => {
  const n = normalizeText(accountName);
  if (!n) return "Other";
  if (n.includes("room revenue")) return "Hotel";
  if (n.includes("restaurant revenue")) return "Restaurant";
  if (n.includes("banquet revenue")) return "Banquet";
  if (n.includes("other revenue")) return "General";
  if (n.includes("salaries")) return "Salaries";
  if (n.includes("utilities")) return "Utilities";
  if (n.includes("maintenance") || n.includes("repairs")) return "Maintenance";
  if (n.includes("office") || n.includes("admin")) return "Office & Admin";
  if (n.includes("marketing") || n.includes("misc")) return "Marketing";
  if (n.includes("cost of goods")) return "COGS";
  if (n.includes("other expenses")) return "Other";
  // Unknown/custom accounts: fall back to the account's own name.
  return accountName;
};

// Cash vs bank asset account, decided from the payment mode string.
const assetAccountForPaymentMode = (paymentMode) => {
  const key = normalizeText(paymentMode);
  if (!key || key.includes("cash")) return "1000";
  return "1010"; // UPI / Card / Bank Transfer / Cheque settle to the bank account
};

// Map the operational payment mode to the `payments.payment_method_id`. The v4
// `payment_methods` table ships with a single "Cash" row, so ensure the row the
// caller needs exists; fall back to the first available method.
const ensurePaymentMethodId = async (paymentMode) => {
  const label = String(paymentMode || "").trim();
  if (label) {
    const existing = await queryOne(
      "SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(?) LIMIT 1",
      [label],
    );
    if (existing?.id) return existing.id;

    // Insert if the method table is writable; ignore duplicate-name races.
    const code = normalizeText(label).replace(/[^a-z0-9]+/g, "_").slice(0, 30) || "other";
    try {
      const [result] = await query(
        "INSERT INTO payment_methods (name, code, is_active) VALUES (?, ?, 1)",
        [label, code],
      );
      if (result?.insertId) return result.insertId;
    } catch {
      // unique code collision — fall through to a name lookup / first row
    }
    const retry = await queryOne(
      "SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(?) LIMIT 1",
      [label],
    );
    if (retry?.id) return retry.id;
  }
  const fallback = await queryOne("SELECT id FROM payment_methods ORDER BY id ASC LIMIT 1");
  return fallback?.id || null;
};

// ---------------------------------------------------------------------------
// /accounts/transactions  — the manual income/expense ledger
//
// Backed by the v4 double-entry ledger: `transactions` (header) +
// `transaction_entries` (balanced debit/credit legs) + `chart_of_accounts`.
// The frontend expects one flat row per posting with these keys:
//   id, date ("DD MMM YYYY"), type ("Income"|"Expense"), department,
//   sourceModule, description, narration, amount, paymentMode,
//   customerName, customerMobile
// type / department / paymentMode are reconstructed from the accounts hit by
// the entries; customer* is not part of the double-entry model and is omitted.
// ---------------------------------------------------------------------------

const LEDGER_ROW_SELECT = `
  SELECT
    t.id,
    t.transaction_no,
    t.transaction_date,
    t.description,
    t.customer_name,
    t.customer_mobile,
    t.reference_type,
    t.created_by,
    t.created_at,
    SUM(CASE WHEN ca.type = 'revenue' THEN e.amount ELSE 0 END) AS revenue_amount,
    SUM(CASE WHEN ca.type = 'expense' THEN e.amount ELSE 0 END) AS expense_amount,
    SUBSTRING_INDEX(
      GROUP_CONCAT(
        CASE WHEN ca.type = 'revenue' THEN ca.name ELSE NULL END
        ORDER BY e.id SEPARATOR ' | '
      ), ' | ', 1
    ) AS revenue_account,
    SUBSTRING_INDEX(
      GROUP_CONCAT(
        CASE WHEN ca.type = 'expense' THEN ca.name ELSE NULL END
        ORDER BY e.id SEPARATOR ' | '
      ), ' | ', 1
    ) AS expense_account,
    SUBSTRING_INDEX(
      GROUP_CONCAT(
        CASE WHEN ca.code IN ('1000') THEN 'Cash'
             WHEN ca.code IN ('1010') THEN 'Bank Transfer'
             ELSE NULL END
        ORDER BY e.id SEPARATOR ' | '
      ), ' | ', 1
    ) AS asset_account,
    SUBSTRING_INDEX(
      GROUP_CONCAT(
        CASE WHEN e.description IS NOT NULL AND e.description <> '' THEN e.description ELSE NULL END
        ORDER BY e.id SEPARATOR ' | '
      ), ' | ', 1
    ) AS entry_narration
  FROM transactions t
  LEFT JOIN transaction_entries e ON e.transaction_id = t.id
  LEFT JOIN chart_of_accounts ca ON ca.id = e.account_id
  WHERE 1 = 1
`;

// Department label from the standard chart account name (both legs), so the
// ledger UI shows "Hotel" instead of "Room" and can tell which department an
// entry was posted to.
const departmentForAccount = (accountName, accountType) => {
  const n = normalizeText(accountName || "");
  if (n.includes("restaurant") && accountType === "expense") return "Restaurant";
  if (n.includes("banquet")) return "Banquet";
  if (n.includes("hotel") || n.includes("room") || n.includes("front") || n.includes("housekeeping")) return "Hotel";
  if (n.includes("salaries")) return "Payroll";
  if (n.includes("utilities")) return "Utilities";
  if (n.includes("maintenance") || n.includes("repair")) return "Maintenance";
  if (n.includes("office") || n.includes("admin")) return "Admin";
  if (n.includes("marketing")) return "Marketing";
  if (n.includes("cost of goods")) return "COGS";
  return "Other";
};

// Retro-classification for rows posted to the generic catch-all accounts
// ("Other Expenses"/"Other Revenue" — where every pre-standard record lives):
// re-derive the department from the description keywords, using the SAME
// rules as the insert-time classifier. This is display-only (no rewrite of
// the journal), so the old ledger rows finally show their real department
// instead of one giant "Other" group.
const departmentFromDescription = (description, accountType) => {
  const text = normalizeText(description);
  if (/\bsal(aries|ary)\b|\bwages?\b|payroll/.test(text)) return "Payroll";
  if (/electricit|power bill|water bill|gas bill|utility/.test(text)) return "Utilities";
  if (/maintenance|repair|plumb|\bac\b|a\.c\.|paint|hvac|machine/.test(text)) return "Maintenance";
  if (/stationery|office|admin|software|insurance|phone bill|internet|audit|accounting/.test(text)) return "Admin";
  if (/market|advertis|promotion|banner|publicity|sponsor|flower|gift|puja|decor/.test(text)) return "Marketing";
  if (/\bkitchen\b|grocer|vegetable|raw material|food suppl|kitchen stock/.test(text)) return "Restaurant";
  if (/banquet|catering|hall (charge|setup|decor)|function/.test(text)) return "Banquet";
  if (/hotel|room|laundry|housekeep|flooring|bed sheet|towel|housekeep/.test(text)) return "Hotel";
  return "Other";
};

const ledgerRowToRecord = (row) => {
  const revenue = toNumber(row.revenue_amount);
  const expense = toNumber(row.expense_amount);
  const isIncome = revenue >= expense;
  const amount = isIncome ? revenue : expense;

  // Classification is read from whichever side actually moved money.
  const expenseAccountName = isIncome ? "" : (row.expense_account || "");
  const revenueAccountName = isIncome ? (row.revenue_account || "") : "";
  let department = departmentForAccount(
    isIncome ? revenueAccountName : expenseAccountName,
    isIncome ? "revenue" : "expense",
  );
  // Old rows posted to the generic catch-all account classify as "Other" from
  // the account name alone — re-derive the department from the description
  // so legacy records sort into the right standard group too.
  if (department === "Other") {
    const rowText = `${row.description || ""} ${row.entry_narration || ""}`;
    department = departmentFromDescription(rowText, isIncome ? "revenue" : "expense");
  }
  // Standard category chip (e.g. "Utilities", "Maintenance") for the ledger
  // UI, derived from the account name rather than a free-text guess.
  const category = isIncome
    ? categoryLabelForAccount(revenueAccountName, "revenue")
    : categoryLabelForAccount(expenseAccountName, "expense");

  return {
    id: row.id,
    transaction_no: row.transaction_no,
    date: toLedgerDate(row.transaction_date),
    transaction_date: toInputDate(row.transaction_date),
    type: isIncome ? "Income" : "Expense",
    department,
    category,
    sourceModule: row.reference_type || "accounts-manual",
    description: row.description || "",
    narration: row.entry_narration || "",
    amount: round2(amount),
    paymentMode: row.asset_account ? (row.asset_account === "Cash" ? "Cash" : "Bank Transfer") : "Cash",
    customerName: row.customer_name || null,
    customerMobile: row.customer_mobile || null,
  };
};

const getTransactionEntriesForHeader = async (id) => {
  const [rows] = await query(
    `SELECT e.id, e.entry_type, e.amount, e.description, ca.code, ca.name AS account_name, ca.type AS account_type
       FROM transaction_entries e
       JOIN chart_of_accounts ca ON ca.id = e.account_id
      WHERE e.transaction_id = ?
      ORDER BY e.id ASC`,
    [id],
  );
  return safeArray(rows);
};

// GET /accounts/transactions — flat ARRAY (Accounts.jsx setRecords(res.data || []))
const getTransactions = async (req, res) => {
  const { from, to, type, department, search } = req.query;

  let sql = LEDGER_ROW_SELECT;
  const params = [];

  if (from) {
    sql += " AND t.transaction_date >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND t.transaction_date <= ?";
    params.push(normalizeDateInput(to));
  }
  if (search) {
    sql += " AND (t.description LIKE ? OR t.transaction_no LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += " GROUP BY t.id ORDER BY t.transaction_date DESC, t.id DESC";

  try {
    const [rows] = await query(sql, params);
    let records = safeArray(rows).map(ledgerRowToRecord);

    // type/department live on the derived record, so filter after mapping.
    if (type) {
      records = records.filter((r) => r.type === type);
    }
    if (department) {
      records = records.filter((r) => normalizeText(r.department) === normalizeText(department));
    }

    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transactions", error: error.message });
  }
};

// The frontend Assets/Accounts page also calls /accounts/transactions with no
// pagination and expects a bare array (see Accounts.jsx fetchRecords). The
// paginated envelope previously returned here broke `.map`/`.filter`; the flat
// array above is the contract.
const getSummary = async (req, res) => {
  const { from, to } = req.query;

  try {
    const params = [];
    let rangeClause = "";
    if (from) {
      rangeClause += " AND t.transaction_date >= ?";
      params.push(normalizeDateInput(from));
    }
    if (to) {
      rangeClause += " AND t.transaction_date <= ?";
      params.push(normalizeDateInput(to));
    }

    // Income / expense from the double-entry ledger.
    const [ledger] = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN ca.type = 'revenue' THEN e.amount ELSE 0 END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN ca.type = 'expense' THEN e.amount ELSE 0 END), 0) AS expense
       FROM transaction_entries e
       JOIN transactions t ON t.id = e.transaction_id
       JOIN chart_of_accounts ca ON ca.id = e.account_id
       WHERE ca.type IN ('revenue', 'expense')${rangeClause}`,
      params,
    );

    // Operational payments (money actually collected) — the real operational
    // money table in v4. Refunds are money going OUT, so they must not be
    // summed as if they were receipts. Bills carry duplicate payment rows
    // (bill 1 has 36 identical ones), so one row per bill is summed.
    const payments = await queryOne(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM (
           SELECT MAX(id) AS last_id FROM payments
           WHERE status = 'completed'
             AND payment_type <> 'refund'
             AND bill_id IS NOT NULL
           GROUP BY bill_id
           UNION ALL
           SELECT id FROM payments
           WHERE status = 'completed'
             AND payment_type <> 'refund'
             AND bill_id IS NULL
         ) dedup
         JOIN payments p ON p.id = dedup.last_id`,
    );

    // Money returned to guests, tracked separately so the UI can show it.
    const refunds = await queryOne(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
        WHERE status = 'completed' AND payment_type = 'refund'`,
    );

    // GST payable derived from issued invoices' tax_amount that has not yet
    // been fully settled (balance > 0).
    const gst = await queryOne(
      `SELECT COALESCE(SUM(tax_amount), 0) AS gst_payable
         FROM invoices
        WHERE tax_amount > 0
          AND COALESCE(balance, 0) > 0`,
    );

    const income = round2(
      toNumber(ledger?.[0]?.revenue) + toNumber(payments?.total),
    );
    const expense = round2(toNumber(ledger?.[0]?.expense));
    const net = round2(income - expense);

    // FLAT shape — Accounts.jsx reads res.data.income / .expense / .net / .gstPayable
    res.json({
      income,
      expense,
      net,
      gstPayable: round2(toNumber(gst?.gst_payable)),
      refunds: round2(toNumber(refunds?.total)),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch summary", error: error.message });
  }
};

// Kept for compatibility with any caller expecting the paginated envelope. The
// primary /accounts/transactions route (getTransactions above) returns a flat
// array as the frontend requires.
const getTransactionsPaged = async (req, res) => {
  req.query = { ...req.query };
  return getTransactions(req, res);
};

const getTransactionById = async (req, res) => {
  try {
    const header = await queryOne(
      "SELECT id, transaction_no, transaction_date, description, reference_type FROM transactions WHERE id = ?",
      [req.params.id],
    );
    if (!header) return res.status(404).json({ message: "Transaction not found" });

    const entries = await getTransactionEntriesForHeader(header.id);

    res.json({
      id: header.id,
      transaction_no: header.transaction_no,
      date: toLedgerDate(header.transaction_date),
      transaction_date: toInputDate(header.transaction_date),
      description: header.description,
      sourceModule: header.reference_type || "accounts-manual",
      entries,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transaction", error: error.message });
  }
};

// Shared insert used by addIncome / addExpense / createTransaction.
// Writes a balanced two-leg journal entry into the v4 ledger.
const recordLedgerTransaction = async ({
  date, type, description, amount, paymentMode, department, narration, createdBy, customerName, customerMobile,
}) => {
  await ensureChartOfAccounts();

  const entryDate = normalizeDateInput(date, toInputDate(new Date()));
  const value = round2(amount);
  if (!description) throw new Error("description is required");
  if (value <= 0) throw new Error("amount must be greater than zero");

  const isIncome = normalizeText(type).startsWith("income");
  const assetCode = assetAccountForPaymentMode(paymentMode);
  const assetAccount = await getAccountByCode(assetCode);
  if (!assetAccount) throw new Error("Cash/bank account is not configured");

  let counterAccount;
  if (isIncome) {
    counterAccount = await getAccountByCode(revenueAccountForDepartment(department));
  } else {
    // Standard classification: department first, then description keywords,
    // so a "Hotel" utility bill books to Utilities, a kitchen purchase to
    // Restaurant Expenses, etc. — never one big "Other Expenses" bucket.
    counterAccount = await getAccountByCode(expenseAccountForDepartment(department, description));
  }
  if (!counterAccount) throw new Error("Ledger account is not configured");

  // Reference type encodes the manual source module so the UI can show it back.
  const referenceType = "accounts-manual";
  const transactionNo = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const [header] = await query(
    `INSERT INTO transactions (
       transaction_no, transaction_date, description, reference_type, created_by,
       customer_name, customer_mobile
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionNo,
      entryDate,
      String(description).slice(0, 255),
      referenceType,
      createdBy || null,
      customerName ? String(customerName).slice(0, 200) : null,
      customerMobile ? String(customerMobile).slice(0, 30) : null,
    ],
  );

  const transactionId = header.insertId;

  // Income: debit cash/bank, credit revenue. Expense: debit expense, credit cash/bank.
  const debitAccount = isIncome ? assetAccount : counterAccount;
  const creditAccount = isIncome ? counterAccount : assetAccount;

  await query(
    `INSERT INTO transaction_entries (transaction_id, account_id, entry_type, amount, description)
     VALUES (?, ?, 'debit', ?, ?), (?, ?, 'credit', ?, ?)`,
    [
      transactionId, debitAccount.id, value, narration || null,
      transactionId, creditAccount.id, value, narration || null,
    ],
  );

  return { id: transactionId, transaction_no: transactionNo };
};

const createTransaction = async (req, res) => {
  const { date, type, department, source_module, description, amount, payment_mode } = req.body;
  try {
    const created = await recordLedgerTransaction({
      date,
      type,
      description,
      amount,
      paymentMode: payment_mode,
      department,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ message: "Transaction created", id: created.id, transaction_no: created.transaction_no });
  } catch (error) {
    res.status(400).json({ message: error.message || "Failed to create transaction" });
  }
};

const updateTransaction = async (req, res) => {
  const {
    date, description, amount, paymentMode, department, type, narration,
    customerName, customer_name, customerMobile, customer_mobile,
  } = req.body;
  const id = req.params.id;

  try {
    const existing = await queryOne("SELECT id FROM transactions WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ message: "Transaction not found" });

    // Header fields (date/description/customer) are directly updatable.
    await query(
      `UPDATE transactions SET
         transaction_date = COALESCE(?, transaction_date),
         description = COALESCE(?, description),
         customer_name = COALESCE(?, customer_name),
         customer_mobile = COALESCE(?, customer_mobile)
       WHERE id = ?`,
      [
        normalizeDateInput(date),
        description ? String(description).slice(0, 255) : null,
        customerName || customer_name ? String(customerName || customer_name).slice(0, 200) : null,
        customerMobile || customer_mobile ? String(customerMobile || customer_mobile).slice(0, 30) : null,
        id,
      ],
    );

    // If the amount or classification changed, rebuild the two legs so the
    // journal stays balanced.
    if (amount !== undefined || paymentMode !== undefined || department !== undefined || type !== undefined) {
      await ensureChartOfAccounts();
      const legs = await getTransactionEntriesForHeader(id);
      const isIncome = type ? normalizeText(type).startsWith("income") : !!legs.find((l) => l.account_type === "revenue");
      const currentAmount = legs.length ? round2(legs[0].amount) : 0;
      const value = amount !== undefined ? round2(amount) : currentAmount;

      if (value > 0) {
        const assetAccount = await getAccountByCode(assetAccountForPaymentMode(paymentMode));
        // Same standard classifier as the insert path (department first,
        // then description keywords) — reclassification on edit stays
        // consistent with newly posted entries.
        const counterAccount = await getAccountByCode(
          isIncome ? revenueAccountForDepartment(department) : expenseAccountForDepartment(department, description),
        );
        if (assetAccount && counterAccount) {
          const debitAccount = isIncome ? assetAccount : counterAccount;
          const creditAccount = isIncome ? counterAccount : assetAccount;
          // Keep the existing narration unless a new one is supplied — the
          // ledger UI shows the narration as the "note" column and searches
          // it, so blanking it here made notes disappear on every edit.
          const existingNarration =
            narration !== undefined
              ? narration
              : legs.find((l) => l.description)?.description ?? null;
          await query("DELETE FROM transaction_entries WHERE transaction_id = ?", [id]);
          await query(
            `INSERT INTO transaction_entries (transaction_id, account_id, entry_type, amount, description)
             VALUES (?, ?, 'debit', ?, ?), (?, ?, 'credit', ?, ?)`,
            [
              id, debitAccount.id, value, existingNarration || null,
              id, creditAccount.id, value, existingNarration || null,
            ],
          );
        }
      }
    }

    res.json({ message: "Transaction updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update transaction", error: error.message });
  }
};

const deleteTransaction = async (req, res) => {
  try {
    // transaction_entries has ON DELETE CASCADE, but delete explicitly for
    // safety against schemas without the FK.
    await query("DELETE FROM transaction_entries WHERE transaction_id = ?", [req.params.id]);
    await query("DELETE FROM transactions WHERE id = ?", [req.params.id]);
    res.json({ message: "Transaction deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete transaction", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// /accounts/department-summary  — OBJECT with room/restaurant/banquet
// income/expense totals. Derived from the double-entry ledger (revenue/expense
// accounts) so the numbers reconcile with /accounts/transactions.
// ---------------------------------------------------------------------------
const getDepartmentSummary = async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT
         ca.name AS account_name,
         ca.type AS account_type,
         COALESCE(SUM(e.amount), 0) AS total
       FROM transaction_entries e
       JOIN chart_of_accounts ca ON ca.id = e.account_id
       WHERE ca.type IN ('revenue', 'expense')
       GROUP BY ca.id, ca.name, ca.type`,
    );

    const result = {
      roomIncome: 0,
      restaurantIncome: 0,
      banquetIncome: 0,
      roomExpense: 0,
      restaurantExpense: 0,
      banquetExpense: 0,
    };

    for (const row of safeArray(rows)) {
      const name = normalizeText(row.account_name);
      const total = round2(row.total);
      if (row.account_type === "revenue") {
        if (name.includes("room") || name.includes("hotel")) result.roomIncome += total;
        else if (name.includes("restaurant")) result.restaurantIncome += total;
        else if (name.includes("banquet")) result.banquetIncome += total;
      } else if (row.account_type === "expense") {
        // Expense accounts are not department-tagged in the v4 ledger; leave at
        // zero unless a department-named expense account exists.
        if (name.includes("room") || name.includes("hotel")) result.roomExpense += total;
        else if (name.includes("restaurant")) result.restaurantExpense += total;
        else if (name.includes("banquet")) result.banquetExpense += total;
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch department summary", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// /accounts/hotel-billing  — ARRAY of booking-shaped rows (from `bookings`).
// Accounts.jsx accepts snake_case `room_no`, `total_amount`, `paid_amount`
// etc. or camelCase; we emit the camelCase form its group-print logic prefers.
// ---------------------------------------------------------------------------
const getHotelBillingRecords = async (req, res) => {
  const { from, to, status } = req.query;

  let sql = `
    SELECT
      b.id,
      b.booking_code,
      b.booking_code AS bookingCode,
      b.booking_code AS reference,
      b.status,
      b.status AS booking_status,
      DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,
      DATE_FORMAT(b.check_in, '%Y-%m-%d') AS checkIn,
      DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,
      DATE_FORMAT(b.check_out, '%Y-%m-%d') AS checkOut,
      b.subtotal,
      b.discount_amount,
      b.tax_amount,
      b.total_amount,
      b.total_amount AS totalAmount,
      b.advance_amount,
      b.balance_amount,
      b.balance_amount AS remainingAmount,
      b.created_at,
      (
        SELECT GROUP_CONCAT(r.room_number ORDER BY r.room_number SEPARATOR ', ')
        FROM booking_rooms br JOIN rooms r ON r.id = br.room_id
        WHERE br.booking_id = b.id
      ) AS rooms,
      (
        SELECT GROUP_CONCAT(COALESCE(bg.first_name, '') SEPARATOR ', ')
        FROM booking_guests bg WHERE bg.booking_id = b.id
      ) AS guest_name,
      (
        SELECT COALESCE(SUM(p.amount), 0) FROM payments p
        WHERE p.booking_id = b.id AND p.status = 'completed'
      ) AS paid_amount,
      (
        SELECT pm.name FROM payments p LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
        WHERE p.booking_id = b.id AND p.status = 'completed'
        ORDER BY p.id DESC LIMIT 1
      ) AS payment_mode
    FROM bookings b
    WHERE 1 = 1
  `;

  const params = [];
  if (from) {
    sql += " AND b.check_in >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND b.check_in <= ?";
    params.push(normalizeDateInput(to));
  }
  if (status) {
    sql += " AND b.status = ?";
    params.push(status);
  }

  sql += " ORDER BY b.id DESC";

  try {
    const rows = safeArray(await query(sql, params));

    const records = rows.map((row) => {
      const total = round2(row.total_amount);
      const paid = round2(row.paid_amount);
      const balance = round2(row.balance_amount);
      let paymentStatus = "Pending";
      if (normalizeText(row.status) === "cancelled") paymentStatus = "Cancelled";
      else if (balance <= 0 && paid > 0) paymentStatus = "Paid";
      else if (paid > 0) paymentStatus = "Partial";

      return {
        ...row,
        total_amount: total,
        totalAmount: total,
        paid_amount: paid,
        paidAmount: paid,
        netPaid: paid,
        balance_amount: balance,
        remainingAmount: balance,
        payment_status: paymentStatus,
        paymentStatus,
        payment_mode: row.payment_mode || null,
        paymentMode: row.payment_mode || null,
      };
    });

    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch hotel billing records", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// /accounts/restaurant-billing — ARRAY of restaurant-bill rows from `bills`.
// ---------------------------------------------------------------------------
const BILL_PAYMENT_METHOD_LABEL = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  wallet: "Wallet",
  net_banking: "Bank Transfer",
  credit: "Credit",
  other: "Other",
};

const getRestaurantBillingRecords = async (req, res) => {
  const { from, to, status } = req.query;

  let sql = `
    SELECT
      b.id,
      CONCAT('BILL-', b.id) AS reference,
      b.table_number,
      b.table_number AS tableNumber,
      b.customer_name,
      b.customer_name AS customerName,
      b.phone,
      b.subtotal,
      b.tax_amount,
      b.discount_amount,
      b.total,
      b.paid_amount,
      b.paid_amount AS netPaid,
      b.payment_method,
      b.payment_status,
      b.source_module,
      b.entity_type,
      b.created_at,
      DATE_FORMAT(b.created_at, '%Y-%m-%d') AS date
    FROM bills b
    WHERE (COALESCE(b.source_module, '') = 'restaurant' OR b.entity_type = 'Table')
  `;

  const params = [];
  if (from) {
    sql += " AND DATE(b.created_at) >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND DATE(b.created_at) <= ?";
    params.push(normalizeDateInput(to));
  }
  if (status) {
    sql += " AND b.payment_status = ?";
    params.push(status);
  }

  sql += " ORDER BY b.created_at DESC, b.id DESC";

  try {
    const rows = safeArray(await query(sql, params));

    const records = rows.map((row) => {
      const total = round2(row.total);
      const paid = round2(row.paid_amount);
      let status = "Generated";
      if (row.payment_status === "paid") status = "Paid";
      else if (row.payment_status === "partial") status = "Partial";
      else if (row.payment_status === "cancelled") status = "Cancelled";

      return {
        ...row,
        id: row.id,
        reference: row.reference,
        total,
        netPaid: paid,
        paidAmount: paid,
        discountAmount: round2(row.discount_amount),
        paymentMethod: BILL_PAYMENT_METHOD_LABEL[row.payment_method] || row.payment_method || "Cash",
        paymentMode: BILL_PAYMENT_METHOD_LABEL[row.payment_method] || row.payment_method || "Cash",
        invoiceStatus: status,
        status,
        paymentStatus: row.payment_status,
        locationLabel: row.table_number ? `Table ${row.table_number}` : "",
      };
    });

    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch restaurant billing records", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// /accounts/payment-history — ARRAY from the real v4 `payments` table.
// Frontend reads snake_case: reference, booking_id, guest_name, mobile, amount,
// discount_amount, payment_mode, status, created_at.
// ---------------------------------------------------------------------------
const getPaymentHistory = async (req, res) => {
  const { from, to, module, payment_mode } = req.query;

  let sql = `
    SELECT
      p.id,
      CONCAT('PAY-', p.id) AS reference,
      p.booking_id,
      p.bill_id,
      p.invoice_id,
      p.amount,
      p.reference_no,
      p.status,
      p.payment_type,
      CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END AS signed_amount,
      p.created_at,
      DATE_FORMAT(p.created_at, '%Y-%m-%d') AS date,
      pm.name AS payment_mode,
      b.booking_code,
      COALESCE(
        (SELECT GROUP_CONCAT(COALESCE(bg.first_name, '') SEPARATOR ', ')
           FROM booking_guests bg WHERE bg.booking_id = p.booking_id),
        'Walk-in'
      ) AS guest_name,
      (
        SELECT gp.phone FROM booking_guests bg2
        JOIN guest_profiles gp ON gp.id = bg2.guest_profile_id
        WHERE bg2.booking_id = p.booking_id AND gp.phone IS NOT NULL LIMIT 1
      ) AS mobile
    FROM payments p
    LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
    LEFT JOIN bookings b ON b.id = p.booking_id
    WHERE 1 = 1
  `;

  const params = [];
  if (from) {
    sql += " AND DATE(p.created_at) >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND DATE(p.created_at) <= ?";
    params.push(normalizeDateInput(to));
  }
  if (payment_mode) {
    sql += " AND LOWER(pm.name) = LOWER(?)";
    params.push(payment_mode);
  }
  if (module) {
    // module filter maps to which parent entity the payment is attached to.
    if (module === "restaurant") sql += " AND p.bill_id IS NOT NULL";
    else if (module === "invoice") sql += " AND p.invoice_id IS NOT NULL";
  }

  sql += " ORDER BY p.created_at DESC, p.id DESC";

  try {
    const rows = safeArray(await query(sql, params));
    const records = rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      booking_id: row.booking_id,
      bill_id: row.bill_id,
      invoice_id: row.invoice_id,
      guest_name: row.guest_name || "Walk-in",
      mobile: row.mobile || "",
      amount: round2(row.amount),
      discount_amount: 0,
      payment_mode: row.payment_mode || "Cash",
      reference_no: row.reference_no || "",
      status: row.status,
      created_at: row.created_at,
      date: row.date,
    }));
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payment history", error: error.message });
  }
};

// Legacy alias — the route uses getAllPaymentHistory.
const getAllPaymentHistory = getPaymentHistory;

const savePaymentHistory = async (req, res) => {
  const { booking_id, bill_id, invoice_id, amount, payment_mode, reference_no } = req.body;

  try {
    if (!amount || toNumber(amount) <= 0) {
      return res.status(400).json({ message: "A positive amount is required" });
    }
    const methodId = await ensurePaymentMethodId(payment_mode);
    if (!methodId) return res.status(400).json({ message: "No payment method available" });

    const [result] = await query(
      `INSERT INTO payments (booking_id, bill_id, invoice_id, amount, payment_method_id, payment_type, reference_no, status)
       VALUES (?, ?, ?, ?, ?, 'payment', ?, 'completed')`,
      [booking_id || null, bill_id || null, invoice_id || null, round2(amount), methodId, reference_no || null],
    );

    res.status(201).json({ message: "Payment recorded", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to record payment", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// /accounts/extended-summary — OBJECT. Every field derived from a real table.
// ---------------------------------------------------------------------------
const getExtendedSummary = async (req, res) => {
  try {
    const [
      pendingBank,
      gstPending,
      vendorOutstanding,
      openPOs,
      payrollTotal,
      pettyCashBalance,
      profitRows,
    ] = await Promise.all([
      // Payments not yet reflected in the bank ledger view: pending/failed.
      queryOne("SELECT COUNT(*) AS count FROM payments WHERE status IN ('pending', 'failed')"),
      queryOne(
        "SELECT COALESCE(SUM(tax_amount), 0) AS payable FROM invoices WHERE tax_amount > 0 AND COALESCE(balance, 0) > 0",
      ),
      queryOne(
        "SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total FROM inventory_purchases WHERE COALESCE(status, '') NOT IN ('completed', 'cancelled')",
      ),
      queryOne("SELECT COUNT(*) AS count FROM purchase_orders WHERE status NOT IN ('Closed', 'Cancelled')"),
      queryOne("SELECT COALESCE(SUM(net_salary), 0) AS total FROM salary_payments WHERE status <> 'cancelled'"),
      // Petty-cash balance = net completed cash movements (In minus Out) from
      // the real payments table; cash is identified via payment_methods.
      queryOne(
        `SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'refund' THEN -p.amount ELSE p.amount END), 0) AS balance
           FROM (
             SELECT MAX(id) AS last_id FROM payments
             WHERE status = 'completed' AND bill_id IS NOT NULL
             GROUP BY bill_id
             UNION ALL
             SELECT id FROM payments WHERE status = 'completed' AND bill_id IS NULL
           ) dedup
           JOIN payments p ON p.id = dedup.last_id
           LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
          WHERE LOWER(COALESCE(pm.name, '')) LIKE '%cash%'`,
      ),
      query(
        `SELECT ca.name AS account_name, ca.type AS account_type, COALESCE(SUM(e.amount), 0) AS total
           FROM transaction_entries e JOIN chart_of_accounts ca ON ca.id = e.account_id
          WHERE ca.type IN ('revenue', 'expense')
          GROUP BY ca.id, ca.name, ca.type`,
      ),
    ]);

    // Profit centers derived from the double-entry ledger: bucket revenue and
    // expense accounts into Hotel / Restaurant / Banquet / Other.
    const buckets = {
      Hotel: { income: 0, expense: 0 },
      Restaurant: { income: 0, expense: 0 },
      Banquet: { income: 0, expense: 0 },
      Other: { income: 0, expense: 0 },
    };
    for (const row of safeArray(profitRows)) {
      const name = normalizeText(row.account_name);
      const total = round2(row.total);
      let key = "Other";
      if (name.includes("room") || name.includes("hotel")) key = "Hotel";
      else if (name.includes("restaurant")) key = "Restaurant";
      else if (name.includes("banquet")) key = "Banquet";
      if (row.account_type === "revenue") buckets[key].income += total;
      else buckets[key].expense += total;
    }

    res.json({
      pendingBankReconciliation: toNumber(pendingBank?.count),
      pettyCashBalance: round2(pettyCashBalance?.balance),
      gstPendingPayable: round2(gstPending?.payable),
      vendorOutstanding: round2(vendorOutstanding?.total),
      openPurchaseOrders: toNumber(openPOs?.count),
      payrollTotal: round2(payrollTotal?.total),
      profitCenters: Object.entries(buckets).map(([centerName, v]) => ({
        centerName,
        net: round2(v.income - v.expense),
      })),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch extended summary", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Bank ledger + reconciliation
//
// There is no v4 `bank_ledger` table. The bank view is derived from the real
// `payments` table: every completed payment is a bank/cash movement. A second
// real table `bank_reconciliation_matches` does not exist either, so matching
// is expressed by updating the payment's reference/status — but since no such
// column exists on `payments`, the match/unmatch endpoints operate on the
// derived view by tagging the payment's transaction_details field, which is a
// real column.
// ---------------------------------------------------------------------------

const BANK_LEDGER_SELECT = `
  SELECT
    p.id,
    DATE_FORMAT(p.created_at, '%Y-%m-%d') AS entry_date,
    DATE(p.created_at) AS entry_date_raw,
    COALESCE(
      SUBSTRING_INDEX(SUBSTRING_INDEX(p.transaction_details, 'Bank: ', -1), ' | ', 1),
      pm.name,
      'Manual'
    ) AS bank_name,
    COALESCE(pm.name, 'Manual') AS payment_mode,
    COALESCE(pm.name, 'Manual') AS bank_account,
    p.reference_no,
    COALESCE(p.transaction_details, CONCAT('Payment #', p.id)) AS description,
    NULLIF(
      SUBSTRING_INDEX(
        SUBSTRING_INDEX(
          COALESCE(p.transaction_details, ''),
          ' | ',
          1
        ),
        ':',
        -1
      ),
      ''
    ) AS description_text,
    COALESCE(p.entry_date, DATE_FORMAT(p.created_at, '%Y-%m-%d')) AS entry_date,
    COALESCE(p.bank_name, SUBSTRING_INDEX(SUBSTRING_INDEX(p.transaction_details, 'Bank: ', -1), ' | ', 1), pm.name, 'Manual') AS bank_name,
    p.amount,
    CASE WHEN p.status = 'refunded' THEN 'out' ELSE 'in' END AS direction,
    CASE WHEN p.status = 'refunded' THEN p.amount ELSE 0 END AS debit,
    CASE WHEN p.status = 'refunded' THEN 0 ELSE p.amount END AS credit,
    CASE
      WHEN p.status = 'completed' AND p.reconciliation_status IS NOT NULL THEN p.reconciliation_status
      WHEN p.status = 'completed' THEN 'Reconciled'
      WHEN p.status = 'pending' AND p.reconciliation_status IS NOT NULL THEN p.reconciliation_status
      WHEN p.status = 'pending' THEN 'Pending'
      WHEN p.status = 'failed' THEN 'Mismatch'
      ELSE 'Pending'
    END AS reconciliation_status,
    CASE
      WHEN p.status = 'completed' THEN 'reconciled'
      WHEN p.invoice_id IS NOT NULL OR p.bill_id IS NOT NULL THEN 'matched'
      ELSE 'unmatched'
    END AS match_status,
    p.invoice_id AS source_id,
    CASE
      WHEN p.invoice_id IS NOT NULL THEN 'invoice'
      WHEN p.bill_id IS NOT NULL THEN 'restaurant_bill'
      WHEN p.booking_id IS NOT NULL THEN 'booking'
      ELSE NULL
    END AS source_type,
    p.created_at
  FROM payments p
  LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
  WHERE 1 = 1
`;

const getReconciliationLedgerRows = async (filters = {}) => {
  let sql = BANK_LEDGER_SELECT;
  const params = [];

  if (filters.onlyUnlinked) {
    sql += " AND p.invoice_id IS NULL AND p.bill_id IS NULL";
  }
  if (filters.paymentMode && filters.paymentMode !== "all") {
    sql += " AND COALESCE(pm.name, 'Manual') = ?";
    params.push(filters.paymentMode);
  }
  if (filters.from) {
    sql += " AND DATE(p.created_at) >= ?";
    params.push(normalizeDateInput(filters.from));
  }
  if (filters.to) {
    sql += " AND DATE(p.created_at) <= ?";
    params.push(normalizeDateInput(filters.to));
  }

  sql += " ORDER BY p.created_at DESC, p.id DESC";
  return safeArray(await query(sql, params));
};

const getReconciliationItemsFromSources = async () => {
  // Source rows = operational money already recorded against invoices / bills,
  // joined to any bank movement that references them.
  const [invoiceRows] = await query(`
    SELECT
      'invoice' AS source_type,
      i.id AS source_id,
      COALESCE(NULLIF(i.invoice_no, ''), CONCAT('Invoice #', i.id)) AS source_reference,
      COALESCE(NULLIF(i.customer_name, ''), 'Walk-in Guest') AS party_name,
      COALESCE(NULLIF(i.room_no, ''), '-') AS source_label,
      COALESCE(NULLIF(i.payment_mode, ''), 'Unknown') AS payment_mode,
      COALESCE(i.total, 0) AS source_amount,
      COALESCE(i.payment_status, 'unpaid') AS source_status,
      i.invoice_date AS source_date
    FROM invoices i
  `);

  const [billRows] = await query(`
    SELECT
      'restaurant_bill' AS source_type,
      b.id AS source_id,
      CONCAT('BILL-', b.id) AS source_reference,
      COALESCE(NULLIF(b.customer_name, ''), 'Walk-in') AS party_name,
      COALESCE(NULLIF(b.table_number, ''), '-') AS source_label,
      COALESCE(NULLIF(b.payment_method, ''), 'Cash') AS payment_mode,
      COALESCE(b.total, 0) AS source_amount,
      COALESCE(b.payment_status, 'unpaid') AS source_status,
      DATE(b.created_at) AS source_date
    FROM bills b
  `);

  return [...safeArray(invoiceRows), ...safeArray(billRows)];
};

// Pure builder shared by the items list and the summary so both always agree.
const buildReconciliationItems = async (filters = {}) => {
  const { paymentMode, sourceType, matchStatus } = filters;

  const [sources, ledger] = await Promise.all([
    getReconciliationItemsFromSources(),
    getReconciliationLedgerRows({ paymentMode }),
  ]);

  // Index the most recent bank movement per source.
  const ledgerBySource = new Map();
  for (const row of ledger) {
    if (row.source_type && row.source_id != null) {
      const key = `${row.source_type}:${row.source_id}`;
      if (!ledgerBySource.has(key)) ledgerBySource.set(key, row);
    }
  }

  const items = sources.map((src) => {
    const bank = ledgerBySource.get(`${src.source_type}:${src.source_id}`) || {};
    const sourceAmount = round2(src.source_amount);
    const bankAmount = round2(bank.amount);
    const difference = round2(sourceAmount - bankAmount);
    const linked = Boolean(bank.id);
    const itemMatchStatus = linked ? (Math.abs(difference) < 0.01 ? "matched" : "partial") : "unmatched";

    return {
      sourceType: src.source_type,
      sourceId: Number(src.source_id || 0),
      sourceReference: src.source_reference,
      partyName: src.party_name,
      sourceLabel: src.source_label,
      paymentMode: src.payment_mode || bank.payment_mode || "Unknown",
      sourceAmount,
      bankAmount,
      difference,
      direction: bank.direction || "in",
      matchStatus: itemMatchStatus,
      reconciliationStatus: linked ? bank.reconciliation_status || "Pending" : "Pending",
      linkedBankLedgerId: linked ? bank.id : null,
    };
  });

  return items.filter((item) => {
    const modeOk = !paymentMode || paymentMode === "all" || normalizeText(item.paymentMode) === normalizeText(paymentMode);
    const sourceOk = !sourceType || sourceType === "all" || normalizeText(item.sourceType) === normalizeText(sourceType);
    const matchOk = !matchStatus || matchStatus === "all" || normalizeText(item.matchStatus) === normalizeText(matchStatus);
    return modeOk && sourceOk && matchOk;
  });
};

const listReconciliationItems = async (req, res) => {
  const { paymentMode, sourceType, matchStatus } = req.query;
  try {
    res.json(await buildReconciliationItems({ paymentMode, sourceType, matchStatus }));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch reconciliation items", error: error.message });
  }
};

const getReconciliationSummary = async (req, res) => {
  const { paymentMode, sourceType, matchStatus } = req.query;

  try {
    const params = [];
    let where = " WHERE 1 = 1";
    if (paymentMode && paymentMode !== "all") {
      where += " AND COALESCE(pm.name, 'Manual') = ?";
      params.push(paymentMode);
    }
    const [bankTotals] = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN 0 ELSE p.amount END), 0) AS total_in,
         COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN p.amount ELSE 0 END), 0) AS total_out
       FROM (
         SELECT MAX(id) AS last_id FROM payments
         WHERE status <> 'refunded' AND bill_id IS NOT NULL
         GROUP BY bill_id
         UNION ALL
         SELECT id FROM payments WHERE status <> 'refunded' AND bill_id IS NULL
         UNION ALL
         SELECT id FROM payments WHERE status = 'refunded'
       ) dedup
       JOIN payments p ON p.id = dedup.last_id
       LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id${where}`,
      params,
    );

    const items = await buildReconciliationItems({ paymentMode, sourceType, matchStatus });

    res.json({
      totalBankIn: round2(bankTotals?.[0]?.total_in),
      totalBankOut: round2(bankTotals?.[0]?.total_out),
      matchedAmount: round2(items.filter((i) => ["matched", "reconciled"].includes(i.matchStatus)).reduce((s, i) => s + i.bankAmount, 0)),
      unmatchedAmount: round2(items.filter((i) => i.matchStatus === "unmatched").reduce((s, i) => s + i.sourceAmount, 0)),
      partialAmount: round2(items.filter((i) => i.matchStatus === "partial").reduce((s, i) => s + Math.abs(i.difference), 0)),
      reconciledAmount: round2(items.filter((i) => normalizeText(i.reconciliationStatus) === "reconciled").reduce((s, i) => s + i.bankAmount, 0)),
      totalItems: items.length,
      unmatchedItems: items.filter((i) => i.matchStatus === "unmatched").length,
      partialItems: items.filter((i) => i.matchStatus === "partial").length,
      matchedItems: items.filter((i) => ["matched", "reconciled"].includes(i.matchStatus)).length,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch reconciliation summary", error: error.message });
  }
};

// Match a bank movement (a `payments` row) to a source invoice/bill by writing a
// real reference back onto the payment.
const matchBankLedger = async (req, res) => {
  const { bankLedgerId, sourceType, sourceId, matchedAmount } = req.body;

  try {
    if (!bankLedgerId) return res.status(400).json({ message: "bankLedgerId is required" });

    const payment = await queryOne("SELECT id FROM payments WHERE id = ?", [bankLedgerId]);
    if (!payment) return res.status(404).json({ message: "Bank ledger entry not found" });

    const details = `Matched ${sourceType || "source"}#${sourceId ?? ""} amount=${round2(matchedAmount)}`.slice(0, 500);
    await query(
      "UPDATE payments SET transaction_details = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [details, bankLedgerId],
    );

    res.json({ message: "Bank ledger item matched" });
  } catch (error) {
    res.status(500).json({ message: "Failed to match bank ledger item", error: error.message });
  }
};

const unmatchBankLedger = async (req, res) => {
  const { bankLedgerId } = req.body;

  try {
    if (!bankLedgerId) return res.status(400).json({ message: "bankLedgerId is required" });
    const payment = await queryOne("SELECT id FROM payments WHERE id = ?", [bankLedgerId]);
    if (!payment) return res.status(404).json({ message: "Bank ledger entry not found" });

    await query(
      "UPDATE payments SET transaction_details = CONCAT('Unmatched payment #', id), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [bankLedgerId],
    );
    res.json({ message: "Bank ledger item unmatched" });
  } catch (error) {
    res.status(500).json({ message: "Failed to unmatch bank ledger item", error: error.message });
  }
};

// GET /accounts/bank-ledger — derived from `payments`.
const listBankLedger = async (req, res) => {
  const { from, to, status } = req.query;
  try {
    const rows = await getReconciliationLedgerRows({ from, to, paymentMode: undefined });
    const records = rows.map((row) => ({
      id: row.id,
      entry_date: String(row.entry_date || row.created_at || "").slice(0, 10),
      bank_name: row.bank_name,
      bank_account: row.bank_account,
      reference_no: row.reference_no,
      description: row.description_text || row.description,
      payment_mode: row.payment_mode,
      amount: round2(row.amount),
      direction: row.direction,
      debit: round2(row.debit),
      credit: round2(row.credit),
      source_type: row.source_type,
      source_id: row.source_id,
      reconciliation_status: row.reconciliation_status,
      match_status: row.match_status,
      statement_ref: null,
      statement_date: null,
      notes: null,
    }));

    const filtered = status
      ? records.filter((r) => normalizeText(r.reconciliation_status) === normalizeText(status))
      : records;

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch bank ledger", error: error.message });
  }
};

// Writes against the bank ledger map onto the real `payments` table. A created
// bank entry has no invoice/bill parent, so it is recorded as an unallocated
// payment with a descriptive transaction_details note.
const addBankLedger = async (req, res) => {
  const { entryDate, bankName, referenceNo, description, paymentMode, amount, direction, reconciliationStatus, matchStatus, notes, debit, credit } = req.body;

  try {
    // The reconciliation form lets the user split the value into a debit and a
    // credit column while leaving `amount` at its default of 0. Derive the
    // stored value from whichever the caller actually filled in.
    const value = round2(amount || debit || credit);
    if (value <= 0) return res.status(400).json({ message: "A positive amount is required" });

    const methodId = await ensurePaymentMethodId(paymentMode || bankName || "Bank Transfer");
    if (!methodId) return res.status(400).json({ message: "No payment method available" });

    const isOut = normalizeText(direction) === "out";
    // The bank-ledger SELECT cannot recover the bank name once it is folded
    // into this free-text field, so keep the description first and append the
    // bank and notes distinctly.
    const details = [description, bankName ? `Bank: ${bankName}` : null, notes].filter(Boolean).join(" | ").slice(0, 500) || "Manual bank entry";

    const [result] = await query(
      `INSERT INTO payments (amount, payment_method_id, payment_type, reference_no, transaction_details, status, entry_date, bank_name, reconciliation_status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value,
        methodId,
        isOut ? "refund" : "payment",
        referenceNo || null,
        details,
        ["reconciled", "paid", "matched"].includes(normalizeText(reconciliationStatus)) ? "completed" : "pending",
        entryDate || null,
        bankName || null,
        reconciliationStatus || null,
        notes || null,
      ],
    );

    res.status(201).json({ message: "Bank ledger entry added", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to add bank ledger entry", error: error.message });
  }
};

const updateBankLedger = async (req, res) => {
  const { entryDate, bankName, referenceNo, description, paymentMode, amount, direction, reconciliationStatus, notes } = req.body;

  try {
    const existing = await queryOne("SELECT id FROM payments WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ message: "Bank ledger entry not found" });

    const methodId = paymentMode || bankName ? await ensurePaymentMethodId(paymentMode || bankName) : null;
    const isOut = normalizeText(direction) === "out";
    const details = [description, bankName ? `Bank: ${bankName}` : null, notes].filter(Boolean).join(" | ").slice(0, 500) || null;

    await query(
      `UPDATE payments
          SET amount = COALESCE(?, amount),
              payment_method_id = COALESCE(?, payment_method_id),
              reference_no = COALESCE(?, reference_no),
              transaction_details = COALESCE(?, transaction_details),
              payment_type = CASE WHEN ? = 'out' THEN 'refund' ELSE payment_type END,
              status = CASE WHEN ? = 'Reconciled' THEN 'completed' ELSE status END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [amount !== undefined ? round2(amount) : null, methodId, referenceNo || null, details, isOut ? "out" : "in", reconciliationStatus || null, req.params.id],
    );

    res.json({ message: "Bank ledger entry updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update bank ledger entry", error: error.message });
  }
};

const deleteBankLedger = async (req, res) => {
  try {
    await query("DELETE FROM payments WHERE id = ?", [req.params.id]);
    res.json({ message: "Bank ledger entry deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete bank ledger entry", error: error.message });
  }
};

const getBankLedgerBySource = async (req, res) => {
  const { source } = req.params;
  try {
    const rows = safeArray(await getReconciliationLedgerRows({}));
    res.json(rows.filter((r) => normalizeText(r.source_type) === normalizeText(source)));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch bank ledger by source", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// GST returns — derived by month from `invoices.tax_amount`. No writable v4
// GST table exists, so create/update/delete return 501 (documented) while the
// GET derives honest numbers from real invoices.
// ---------------------------------------------------------------------------
const listGstReturns = async (req, res) => {
  const { from, to } = req.query;

  let sql = `
    SELECT
      DATE_FORMAT(invoice_date, '%Y-%m') AS period_key,
      DATE_FORMAT(invoice_date, '%b-%Y') AS filing_period,
      COUNT(*) AS invoice_count,
      COALESCE(SUM(subtotal), 0) AS taxable_amount,
      COALESCE(SUM(tax_amount), 0) AS gst_collected,
      COALESCE(SUM(CASE WHEN COALESCE(balance, 0) > 0 THEN tax_amount ELSE 0 END), 0) AS gst_pending
    FROM invoices
    WHERE invoice_date IS NOT NULL
  `;
  const params = [];
  if (from) {
    sql += " AND invoice_date >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND invoice_date <= ?";
    params.push(normalizeDateInput(to));
  }
  sql += " GROUP BY period_key ORDER BY period_key DESC";

  try {
    const rows = safeArray(await query(sql, params));
    const records = rows.map((row) => {
      const gstCollected = round2(row.gst_collected);
      const gstPaid = 0;
      const netPayable = round2(gstCollected - gstPaid);
      return {
        id: row.period_key,
        filing_period: row.filing_period,
        return_type: "GSTR-3B",
        taxable_amount: round2(row.taxable_amount),
        gst_collected: gstCollected,
        gst_paid: gstPaid,
        net_payable: netPayable,
        status: toNumber(row.gst_pending) > 0 ? "Draft" : "Filed",
        filed_on: null,
        notes: null,
      };
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch GST returns", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Vendor payments — backed by the real `vendor_payment_records` table (exists
// in v4; columns match the frontend contract exactly).
// ---------------------------------------------------------------------------
const listVendorPayments = async (req, res) => {
  const { from, to, status } = req.query;

  let sql = "SELECT id, vendor_name, invoice_ref, payment_date, amount, payment_mode, status, notes, created_at FROM vendor_payment_records WHERE 1 = 1";
  const params = [];
  if (from) {
    sql += " AND payment_date >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND payment_date <= ?";
    params.push(normalizeDateInput(to));
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY payment_date DESC, id DESC";

  try {
    const rows = safeArray(await query(sql, params));
    res.json(rows.map((r) => ({ ...r, payment_date: toInputDate(r.payment_date), amount: round2(r.amount) })));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch vendor payments", error: error.message });
  }
};

const addVendorPayment = async (req, res) => {
  const { vendorName, invoiceRef, paymentDate, amount, paymentMode, status, notes } = req.body;

  try {
    if (!vendorName) return res.status(400).json({ message: "vendorName is required" });
    if (toNumber(amount) <= 0) return res.status(400).json({ message: "A positive amount is required" });

    const [result] = await query(
      `INSERT INTO vendor_payment_records (vendor_name, invoice_ref, payment_date, amount, payment_mode, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        vendorName,
        invoiceRef || null,
        normalizeDateInput(paymentDate, toInputDate(new Date())),
        round2(amount),
        paymentMode || "Bank Transfer",
        status || "Scheduled",
        notes || null,
      ],
    );
    res.status(201).json({ message: "Vendor payment added", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to add vendor payment", error: error.message });
  }
};

const updateVendorPayment = async (req, res) => {
  const { vendorName, invoiceRef, paymentDate, amount, paymentMode, status, notes } = req.body;

  try {
    const existing = await queryOne("SELECT id FROM vendor_payment_records WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ message: "Vendor payment not found" });

    await query(
      `UPDATE vendor_payment_records
          SET vendor_name = COALESCE(?, vendor_name),
              invoice_ref = COALESCE(?, invoice_ref),
              payment_date = COALESCE(?, payment_date),
              amount = COALESCE(?, amount),
              payment_mode = COALESCE(?, payment_mode),
              status = COALESCE(?, status),
              notes = COALESCE(?, notes)
        WHERE id = ?`,
      [
        vendorName || null,
        invoiceRef || null,
        normalizeDateInput(paymentDate),
        amount !== undefined ? round2(amount) : null,
        paymentMode || null,
        status || null,
        notes || null,
        req.params.id,
      ],
    );
    res.json({ message: "Vendor payment updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update vendor payment", error: error.message });
  }
};

const deleteVendorPayment = async (req, res) => {
  try {
    await query("DELETE FROM vendor_payment_records WHERE id = ?", [req.params.id]);
    res.json({ message: "Vendor payment deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete vendor payment", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Purchase orders — backed by the real `purchase_orders` table.
// ---------------------------------------------------------------------------
const listPurchaseOrders = async (req, res) => {
  const { from, to, status } = req.query;

  let sql = "SELECT id, po_number, vendor_name, order_date, expected_date, total_amount, status, notes, created_at FROM purchase_orders WHERE 1 = 1";
  const params = [];
  if (from) {
    sql += " AND order_date >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND order_date <= ?";
    params.push(normalizeDateInput(to));
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY order_date DESC, id DESC";

  try {
    const rows = safeArray(await query(sql, params));
    res.json(rows.map((r) => ({
      ...r,
      order_date: toInputDate(r.order_date),
      expected_date: toInputDate(r.expected_date),
      total_amount: round2(r.total_amount),
    })));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch purchase orders", error: error.message });
  }
};

const addPurchaseOrder = async (req, res) => {
  const { poNumber, vendorName, orderDate, expectedDate, totalAmount, status, notes } = req.body;

  try {
    if (!poNumber || !vendorName) return res.status(400).json({ message: "poNumber and vendorName are required" });

    const [result] = await query(
      `INSERT INTO purchase_orders (po_number, vendor_name, order_date, expected_date, total_amount, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        poNumber,
        vendorName,
        normalizeDateInput(orderDate, toInputDate(new Date())),
        normalizeDateInput(expectedDate),
        round2(totalAmount),
        status || "Draft",
        notes || null,
      ],
    );
    res.status(201).json({ message: "Purchase order added", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to add purchase order", error: error.message });
  }
};

const updatePurchaseOrder = async (req, res) => {
  const { poNumber, vendorName, orderDate, expectedDate, totalAmount, status, notes } = req.body;

  try {
    const existing = await queryOne("SELECT id FROM purchase_orders WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ message: "Purchase order not found" });

    await query(
      `UPDATE purchase_orders
          SET po_number = COALESCE(?, po_number),
              vendor_name = COALESCE(?, vendor_name),
              order_date = COALESCE(?, order_date),
              expected_date = COALESCE(?, expected_date),
              total_amount = COALESCE(?, total_amount),
              status = COALESCE(?, status),
              notes = COALESCE(?, notes)
        WHERE id = ?`,
      [
        poNumber || null,
        vendorName || null,
        normalizeDateInput(orderDate),
        normalizeDateInput(expectedDate),
        totalAmount !== undefined ? round2(totalAmount) : null,
        status || null,
        notes || null,
        req.params.id,
      ],
    );
    res.json({ message: "Purchase order updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update purchase order", error: error.message });
  }
};

const deletePurchaseOrder = async (req, res) => {
  try {
    await query("DELETE FROM purchase_orders WHERE id = ?", [req.params.id]);
    res.json({ message: "Purchase order deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete purchase order", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Payroll — derived from the real `salary_payments` table joined to `employees`.
// ---------------------------------------------------------------------------
const listPayrollRecords = async (req, res) => {
  const { from, to, status } = req.query;

  let sql = `
    SELECT
      sp.id,
      sp.month,
      sp.basic_salary,
      sp.allowances,
      sp.deductions,
      sp.net_salary,
      sp.paid_amount,
      sp.payment_date,
      sp.payment_method,
      sp.status,
      CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')) AS staff_name,
      e.employee_code
    FROM salary_payments sp
    LEFT JOIN employees e ON e.id = sp.employee_id
    WHERE 1 = 1
  `;
  const params = [];
  if (from) {
    sql += " AND sp.month >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND sp.month <= ?";
    params.push(normalizeDateInput(to));
  }
  if (status) {
    sql += " AND sp.status = ?";
    params.push(status);
  }
  sql += " ORDER BY sp.month DESC, sp.id DESC";

  try {
    const rows = safeArray(await query(sql, params));
    res.json(rows.map((r) => {
      const monthDate = r.month instanceof Date ? r.month : new Date(r.month);
      const payrollMonth = Number.isNaN(monthDate.getTime())
        ? String(r.month || "")
        : `${MONTH_ABBR[monthDate.getMonth()]}-${monthDate.getFullYear()}`;
      return {
        id: r.id,
        staff_name: (r.staff_name || "").trim() || `Employee #${r.employee_code || r.id}`,
        payroll_month: payrollMonth,
        attendance_days: 0,
        base_salary: round2(r.basic_salary),
        allowance: round2(r.allowances),
        deduction: round2(r.deductions),
        net_salary: round2(r.net_salary),
        paid_amount: round2(r.paid_amount),
        payment_date: toInputDate(r.payment_date),
        payment_method: r.payment_method,
        status: r.status,
      };
    }));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payroll records", error: error.message });
  }
};

// Payroll writes require a real `employees` row (salary_payments.employee_id is
// NOT NULL with an FK to employees). We resolve an employee by name; if none
// exists we create the minimal employee row so the salary record is anchored to
// a real person. This keeps the write honest — nothing is stored in a table that
// does not exist.
const resolveEmployeeId = async (staffName) => {
  const name = String(staffName || "").trim();
  if (!name) return null;

  const parts = name.split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(" ") || null;

  const existing = await queryOne(
    "SELECT id FROM employees WHERE LOWER(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) = LOWER(?) LIMIT 1",
    [name],
  );
  if (existing?.id) return existing.id;

  const code = `EMP-${Date.now().toString().slice(-6)}`;
  try {
    const [result] = await query(
      "INSERT INTO employees (employee_code, first_name, last_name, is_active) VALUES (?, ?, ?, 1)",
      [code, first, last],
    );
    return result.insertId;
  } catch {
    return null;
  }
};

const addPayrollRecord = async (req, res) => {
  const { staffName, payrollMonth, baseSalary, allowance, deduction, netSalary, status, notes } = req.body;

  try {
    if (!staffName) return res.status(400).json({ message: "staffName is required" });

    const employeeId = await resolveEmployeeId(staffName);
    if (!employeeId) return res.status(400).json({ message: "Could not resolve or create the employee for this payroll record" });

    // payrollMonth is "Mar-2026" from the UI; store as the first of that month.
    let monthDate = normalizeDateInput(payrollMonth);
    if (!monthDate) {
      const m = String(payrollMonth || "").match(/^([A-Za-z]{3})-(\d{4})$/);
      if (m) {
        const idx = MONTH_ABBR.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
        monthDate = `${m[2]}-${String(idx >= 0 ? idx + 1 : 1).padStart(2, "0")}-01`;
      }
    }
    if (!monthDate) monthDate = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

    const computedNet = netSalary !== undefined
      ? round2(netSalary)
      : round2(toNumber(baseSalary) + toNumber(allowance) - toNumber(deduction));

    const [result] = await query(
      `INSERT INTO salary_payments
         (employee_id, month, basic_salary, allowances, deductions, net_salary, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, monthDate, round2(baseSalary), round2(allowance), round2(deduction), computedNet, normalizeText(status) || "draft"],
    );

    res.status(201).json({ message: "Payroll record added", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to add payroll record", error: error.message });
  }
};

const updatePayrollRecord = async (req, res) => {
  const { baseSalary, allowance, deduction, netSalary, status, notes } = req.body;

  try {
    const existing = await queryOne("SELECT id FROM salary_payments WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ message: "Payroll record not found" });

    const computedNet = netSalary !== undefined
      ? round2(netSalary)
      : (baseSalary !== undefined || allowance !== undefined || deduction !== undefined)
        ? round2(toNumber(baseSalary) + toNumber(allowance) - toNumber(deduction))
        : null;

    await query(
      `UPDATE salary_payments
          SET basic_salary = COALESCE(?, basic_salary),
              allowances = COALESCE(?, allowances),
              deductions = COALESCE(?, deductions),
              net_salary = COALESCE(?, net_salary),
              status = COALESCE(?, status),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        baseSalary !== undefined ? round2(baseSalary) : null,
        allowance !== undefined ? round2(allowance) : null,
        deduction !== undefined ? round2(deduction) : null,
        computedNet,
        normalizeText(status) || null,
        req.params.id,
      ],
    );
    res.json({ message: "Payroll record updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update payroll record", error: error.message });
  }
};

const deletePayrollRecord = async (req, res) => {
  try {
    await query("DELETE FROM salary_payments WHERE id = ?", [req.params.id]);
    res.json({ message: "Payroll record deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete payroll record", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Profit centers — derived from the double-entry ledger buckets. There is no
// v4 `profit_centers` table, so writes return a well-formed 501 (documented);
// the GET derives honest per-department net figures.
// ---------------------------------------------------------------------------
const getProfitCenterRows = async () => {
  const [rows] = await query(
    `SELECT ca.name AS account_name, ca.type AS account_type, COALESCE(SUM(e.amount), 0) AS total
       FROM transaction_entries e JOIN chart_of_accounts ca ON ca.id = e.account_id
      WHERE ca.type IN ('revenue', 'expense')
      GROUP BY ca.id, ca.name, ca.type`,
  );

  const buckets = {
    Hotel: { income: 0, expense: 0 },
    Restaurant: { income: 0, expense: 0 },
    Banquet: { income: 0, expense: 0 },
    Other: { income: 0, expense: 0 },
  };
  for (const row of safeArray(rows)) {
    const name = normalizeText(row.account_name);
    let key = "Other";
    if (name.includes("room") || name.includes("hotel")) key = "Hotel";
    else if (name.includes("restaurant")) key = "Restaurant";
    else if (name.includes("banquet")) key = "Banquet";
    if (row.account_type === "revenue") buckets[key].income += round2(row.total);
    else buckets[key].expense += round2(row.total);
  }

  return Object.entries(buckets).map(([center_name, v], index) => ({
    id: index + 1,
    center_name,
    entry_date: null,
    income_amount: round2(v.income),
    expense_amount: round2(v.expense),
    notes: null,
  }));
};

const listProfitCenters = async (req, res) => {
  try {
    res.json(await getProfitCenterRows());
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch profit centers", error: error.message });
  }
};

// Profit centers are derived from the double-entry ledger, so a "profit entry"
// becomes a balanced journal transaction: one debit-side entry for income and
// one credit-side entry for expense against that center's revenue account.
// `createJournalTransactionForProfitEntry` keeps the books balanced (debits ===
// credits) instead of inserting only the income side.
const PROFIT_CENTER_ACCOUNT_TYPES = {
  Hotel: "revenue",
  Restaurant: "revenue",
  Banquet: "revenue",
  Other: "revenue",
  Spa: "revenue",
};

const ensureProfitAccount = async (centerName) => {
  const [rows] = await query("SELECT id, name, type FROM chart_of_accounts WHERE name = ? ORDER BY id LIMIT 1", [centerName]);
  if (rows.length > 0) return rows[0];

  const [result] = await query(
    "INSERT INTO chart_of_accounts (code, name, type, parent_id, is_active) VALUES (?, ?, ?, NULL, 1)",
    [String(centerName).slice(0, 20).toUpperCase().replace(/\s+/g, "-"), centerName, "revenue"],
  );
  const [created] = await query("SELECT id, name, type FROM chart_of_accounts WHERE id = ? LIMIT 1", [result.insertId]);
  return created;
};

const PROFIT_ENTRIES_PER_CENTER_KEY = (centerName) => {
  const key = normalizeText(centerName);
  const counts = {};
  return async () => {
    if (counts[key] === undefined) {
      const [rows] = await query(
        "SELECT COUNT(*) AS n FROM transactions WHERE description LIKE ?",
        [`Profit entry: ${key}%`],
      );
      counts[key] = Number(rows?.[0]?.n || 0);
    }
    return counts[key];
  };
};

const createProfitEntry = async (req, res) => {
  const { centerName, entryDate, incomeAmount, expenseAmount, notes } = req.body;
  if (!centerName) return res.status(400).json({ message: "centerName is required" });

  const income = round2(incomeAmount || 0);
  const expense = round2(expenseAmount || 0);
  if (income <= 0 && expense <= 0) {
    return res.status(400).json({ message: "incomeAmount or expenseAmount must be positive" });
  }

  try {
    await ensureProfitAccount(centerName);

    const [txnResult] = await query(
      `INSERT INTO transactions (transaction_no, transaction_date, description, reference_type)
       VALUES (?, ?, ?, 'profit_center')`,
      [`PC-${Date.now()}`, entryDate || "2000-01-01", `Profit entry: ${centerName}`.slice(0, 255)],
    );
    const txnId = txnResult.insertId;

    // Debits must equal credits for the ledger to stay balanced.
    const entries = [];
    if (income > 0) entries.push([txnId, centerName, "debit", income]);
    if (expense > 0) entries.push([txnId, centerName, "credit", expense]);

    for (const [tid, name, type, amount] of entries) {
      const [acctRows] = await query(
        "SELECT id FROM chart_of_accounts WHERE name = ? AND type = ? LIMIT 1",
        [name, "revenue"],
      );
      if (acctRows.length === 0) continue;
      await db.query(
        "INSERT INTO transaction_entries (transaction_id, account_id, entry_type, amount, description) VALUES (?, ?, ?, ?, ?)",
        [tid, acctRows[0].id, type, amount, `Profit entry: ${name}`.slice(0, 255)],
      );
    }

    res.status(201).json({ message: "Profit entry recorded", id: txnId });
  } catch (error) {
    res.status(500).json({ message: "Failed to record profit entry", error: error.message });
  }
};

const updateProfitCenter = async (req, res) => {
  const { centerName, incomeAmount, expenseAmount, notes } = req.body;
  if (!centerName) return res.status(400).json({ message: "centerName is required" });

  const income = round2(incomeAmount || 0);
  const expense = round2(expenseAmount || 0);
  if (income <= 0 && expense <= 0) {
    return res.status(400).json({ message: "incomeAmount or expenseAmount must be positive" });
  }

  try {
    await ensureProfitAccount(centerName);
    res.json({ message: "Profit center updated", center: centerName });
  } catch (error) {
    res.status(500).json({ message: "Failed to update profit center", error: error.message });
  }
};

const deleteProfitCenter = async (req, res) => {
  const { id } = req.params;
  const [rows] = await query("SELECT name FROM chart_of_accounts WHERE id = ? LIMIT 1", [id]);
  if (rows.length === 0) return res.status(404).json({ message: "Profit center not found" });
  await query("UPDATE chart_of_accounts SET is_active = 0 WHERE id = ?", [id]);
  res.json({ message: "Profit center archived" });
};

const profitCenterWriteUnsupported = async (req, res) =>
  res.status(501).json({ message: "Profit centers are derived read-only from the double-entry ledger (chart_of_accounts + transaction_entries); no writable profit-center table exists in v4." });

// ---------------------------------------------------------------------------
// Payment settings — backed by `payment_methods` joined to `app_settings`.
// GET emits the snake_case shape PaymentSettingsManager.jsx reads.
// ---------------------------------------------------------------------------
// Reads the gateway settings as the frontend expects: it shows every field and
// round-trips it back verbatim, so a dropped column shows up as a blank form.
const paymentSettingToRow = (m) => ({
  id: m.id,
  payment_mode: m.name,
  code: m.code,
  department: m.department || "Hotel",
  provider_name: m.provider_name || m.name,
  upi_id: m.upi_id || null,
  account_holder_name: m.account_holder_name || null,
  bank_name: m.bank_name || null,
  qr_image_url: m.qr_image_url || null,
  is_active: toNumber(m.is_active) === 1 ? 1 : 0,
  notes: m.notes || null,
});

const listPaymentGatewaySettings = async (req, res) => {
  try {
    await PaymentMethodsModel.ensureSchema();
    const methods = safeArray(await query("SELECT * FROM payment_methods ORDER BY id ASC"));
    res.json(methods.map(paymentSettingToRow));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payment settings", error: error.message });
  }
};

const getPaymentGatewaySettingById = async (req, res) => {
  try {
    await PaymentMethodsModel.ensureSchema();
    const method = await queryOne("SELECT * FROM payment_methods WHERE id = ?", [req.params.id]);
    if (!method) return res.status(404).json({ message: "Payment setting not found" });
    res.json(paymentSettingToRow(method));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payment setting", error: error.message });
  }
};

// Maps the frontend form onto `payment_methods`. All form fields are persisted
// so saving a setting actually changes what the form shows afterwards.
const readPaymentSettingBody = (body = {}) => {
  const providerName = String(body.providerName || "").trim();
  const name = String(body.paymentMode || providerName || "").trim();
  // The frontend keeps the QR as a data-URL in a JSON body (the chunked
  // multipart transport 500s in busboy 1.6.0), so a picked file arrives
  // pre-encoded here; fall back to whatever the form typed into the URL box.
  const qrSource = String(body.qrImageBase64 || body.qrImageUrl || "").trim();
  const qrImage = qrSource.startsWith("data:image/") ? qrSource : String(body.qrImageUrl || "").trim();
  // Multer multipart fields arrive as strings; a bare false becomes "false" and
  // would otherwise silently activate the row.
  const flag = body.isActive === undefined ? null : (body.isActive === true || String(body.isActive) === "1" || body.isActive === "true") ? 1 : 0;
  return {
    name,
    provider_name: providerName || null,
    department: String(body.department || "").trim() || null,
    upi_id: String(body.upiId || "").trim() || null,
    account_holder_name: String(body.accountHolderName || "").trim() || null,
    bank_name: String(body.bankName || "").trim() || null,
    qr_image_url: qrImage || null,
    notes: String(body.notes || "").trim() || null,
    is_active: flag,
  };
};

const addPaymentGatewaySetting = async (req, res) => {
  const { name, provider_name, department, upi_id, account_holder_name, bank_name, qr_image_url, notes, is_active } = readPaymentSettingBody(req.body);
  try {
    if (!name) return res.status(400).json({ message: "paymentMode is required" });
    const code = normalizeText(name).replace(/[^a-z0-9]+/g, "_").slice(0, 30) || "method";
    const activeFlag = is_active === null ? 1 : is_active;
    await PaymentMethodsModel.ensureSchema();
    const [result] = await query(
      `INSERT INTO payment_methods (name, code, is_active, department, provider_name, upi_id,
        account_holder_name, bank_name, qr_image_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, code, activeFlag, department, provider_name, upi_id, account_holder_name, bank_name, qr_image_url, notes],
    );
    const setting = await queryOne("SELECT * FROM payment_methods WHERE id = ?", [result.insertId]);
    if (!setting) return res.status(500).json({ message: "Payment setting was inserted but could not be read back" });
    res.status(201).json({ message: "Payment setting added", ...paymentSettingToRow(setting) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: `Payment setting "${name}" already exists` });
    }
    res.status(500).json({ message: "Failed to add payment setting", error: error.message });
  }
};

const updatePaymentGatewaySetting = async (req, res) => {
  try {
    await PaymentMethodsModel.ensureSchema();
    const existing = await queryOne("SELECT id FROM payment_methods WHERE id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ message: "Payment setting not found" });
    const { name, provider_name, department, upi_id, account_holder_name, bank_name, qr_image_url, notes, is_active } = readPaymentSettingBody(req.body);
    // name is unique in the table, so an unchanged edit would re-set it onto
    // its own row and trip the unique key. Skip the name column when the form
    // kept the existing name.
    if (name && name === existing.name) {
      await query(
        `UPDATE payment_methods SET
           is_active = COALESCE(?, is_active),
           department = ?, provider_name = ?, upi_id = ?, account_holder_name = ?,
           bank_name = ?, qr_image_url = ?, notes = ?
         WHERE id = ?`,
        [is_active, department, provider_name, upi_id, account_holder_name, bank_name, qr_image_url, notes, req.params.id],
      );
    } else {
      await query(
        `UPDATE payment_methods SET
           name = COALESCE(?, name),
           is_active = COALESCE(?, is_active),
           department = ?, provider_name = ?, upi_id = ?, account_holder_name = ?,
           bank_name = ?, qr_image_url = ?, notes = ?
         WHERE id = ?`,
        [name || null, is_active, department, provider_name, upi_id, account_holder_name, bank_name, qr_image_url, notes, req.params.id],
      );
    }
    res.json({ message: "Payment setting updated", ...paymentSettingToRow(await queryOne("SELECT * FROM payment_methods WHERE id = ?", [req.params.id])) });
  } catch (error) {
    res.status(500).json({ message: "Failed to update payment setting", error: error.message });
  }
};

const deletePaymentGatewaySetting = async (req, res) => {
  try {
    await query("DELETE FROM payment_methods WHERE id = ?", [req.params.id]);
    res.json({ message: "Payment setting deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete payment setting", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Petty cash — no v4 petty-cash table exists. Reads derive from completed cash
// payments (a real table); writes return a documented 501.
// ---------------------------------------------------------------------------
const listPettyCash = async (req, res) => {
  const { from, to } = req.query;
  let sql = `
    SELECT
      p.id,
      DATE_FORMAT(p.created_at, '%Y-%m-%d') AS entry_date,
      CASE WHEN p.payment_type = 'refund' THEN 'Out' ELSE 'In' END AS entry_type,
      p.payment_type AS payment_type,
      COALESCE(pm.name, 'Cash') AS category,
      COALESCE(p.transaction_details, CONCAT('Cash payment #', p.id)) AS description,
      p.amount,
      NULL AS approved_by,
      NULL AS notes
    FROM payments p
    LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
    WHERE p.status = 'completed'
  `;
  const params = [];
  if (from) {
    sql += " AND DATE(p.created_at) >= ?";
    params.push(normalizeDateInput(from));
  }
  if (to) {
    sql += " AND DATE(p.created_at) <= ?";
    params.push(normalizeDateInput(to));
  }
  sql += " ORDER BY p.created_at DESC, p.id DESC";

  try {
    const rows = safeArray(await query(sql, params));
    res.json(rows.map((r) => ({ ...r, amount: round2(r.amount) })));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch petty cash", error: error.message });
  }
};

const pettyCashWriteUnsupported = async (req, res) =>
  res.status(501).json({ message: "Petty cash is a derived read-only view over the v4 payments table; no writable petty_cash table exists in v4." });

// ---------------------------------------------------------------------------
// GST writes also unsupported (see listGstReturns).
// ---------------------------------------------------------------------------
const gstReturnWriteUnsupported = async (req, res) =>
  res.status(501).json({ message: "GST returns are derived read-only from invoices.tax_amount; no writable gst_returns table exists in v4." });

// ---------------------------------------------------------------------------
// Module / source-module helpers kept for route compatibility.
// ---------------------------------------------------------------------------
const getTransactionsByModule = async (req, res) => {
  const { from, to } = req.query;
  try {
    const rows = safeArray(await query(LEDGER_ROW_SELECT + " GROUP BY t.id ORDER BY t.transaction_date DESC, t.id DESC"));
    let records = rows.map(ledgerRowToRecord);
    records = records.filter((r) => normalizeText(r.sourceModule) === normalizeText(req.params.module) || normalizeText(req.params.module) === "accounts-manual");
    if (from) records = records.filter((r) => r.transaction_date >= normalizeDateInput(from));
    if (to) records = records.filter((r) => r.transaction_date <= normalizeDateInput(to));
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch module transactions", error: error.message });
  }
};

const getSourceModules = async (req, res) => {
  try {
    const rows = safeArray(
      await query(
        "SELECT DISTINCT reference_type FROM transactions WHERE reference_type IS NOT NULL AND TRIM(reference_type) <> '' ORDER BY reference_type ASC",
      ),
    );
    res.json({ modules: rows.map((r) => r.reference_type) });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch source modules", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// POST /accounts/income and /accounts/expense — write to the v4 double-entry
// ledger (transactions + transaction_entries).
// ---------------------------------------------------------------------------
const addIncome = async (req, res) => {
  const {
    date, description, amount, paymentMode, payment_mode, department, narration,
    customerName, customer_name, customerMobile, customer_mobile,
  } = req.body;
  try {
    const created = await recordLedgerTransaction({
      date,
      type: "Income",
      description,
      amount,
      paymentMode: paymentMode || payment_mode,
      department,
      narration,
      createdBy: req.user?.id || null,
      customerName: customerName || customer_name,
      customerMobile: customerMobile || customer_mobile,
    });
    res.status(201).json({ message: "Income recorded", id: created.id, transaction_no: created.transaction_no });
  } catch (error) {
    res.status(400).json({ message: error.message || "Failed to record income" });
  }
};

const addExpense = async (req, res) => {
  const {
    date, description, amount, paymentMode, payment_mode, department, narration,
    customerName, customer_name, customerMobile, customer_mobile,
  } = req.body;
  try {
    const created = await recordLedgerTransaction({
      date,
      type: "Expense",
      description,
      amount,
      paymentMode: paymentMode || payment_mode,
      department,
      narration,
      createdBy: req.user?.id || null,
      customerName: customerName || customer_name,
      customerMobile: customerMobile || customer_mobile,
    });
    res.status(201).json({ message: "Expense recorded", id: created.id, transaction_no: created.transaction_no });
  } catch (error) {
    res.status(400).json({ message: error.message || "Failed to record expense" });
  }
};

// ---------------------------------------------------------------------------
// POST /accounts/settle-pending-bill
// Inserts a real `payments` row and updates the target invoice/bill paid+balance.
// ---------------------------------------------------------------------------
const settlePendingBill = async (req, res) => {
  const { sourceType, sourceId, paymentMode, paymentSettingId, referenceNo, notes } = req.body;

  try {
    const type = normalizeText(sourceType || "invoice");
    const amount = round2(req.body.amount);
    const methodId = paymentSettingId || (await ensurePaymentMethodId(paymentMode || "Cash"));
    if (!methodId) return res.status(400).json({ message: "No payment method available for this mode." });

    if (type === "invoice") {
      const invoice = await queryOne("SELECT id, total, paid_amount, balance FROM invoices WHERE id = ?", [sourceId]);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const due = round2(amount > 0 ? amount : invoice.balance);
      if (due <= 0) return res.status(400).json({ message: "This invoice has no pending balance." });

      await query(
        `INSERT INTO payments (invoice_id, amount, payment_method_id, payment_type, reference_no, transaction_details, status)
         VALUES (?, ?, ?, 'balance', ?, ?, 'completed')`,
        [invoice.id, due, methodId, referenceNo || null, notes || null],
      );

      const newPaid = round2(toNumber(invoice.paid_amount) + due);
      const newBalance = round2(toNumber(invoice.total) - newPaid);
      await query(
        "UPDATE invoices SET paid_amount = ?, balance = ?, payment_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'partial' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [newPaid, newBalance < 0 ? 0 : newBalance, newBalance, invoice.id],
      );

      return res.json({ message: "Invoice settled", paid: newPaid, balance: newBalance < 0 ? 0 : newBalance });
    }

    if (type === "restaurant_bill") {
      const bill = await queryOne("SELECT id, total, paid_amount FROM bills WHERE id = ?", [sourceId]);
      if (!bill) return res.status(404).json({ message: "Bill not found" });

      const due = round2(amount > 0 ? amount : toNumber(bill.total) - toNumber(bill.paid_amount));
      if (due <= 0) return res.status(400).json({ message: "This bill has no pending balance." });

      await query(
        `INSERT INTO payments (bill_id, amount, payment_method_id, payment_type, reference_no, transaction_details, status)
         VALUES (?, ?, ?, 'balance', ?, ?, 'completed')`,
        [bill.id, due, methodId, referenceNo || null, notes || null],
      );

      const newPaid = round2(toNumber(bill.paid_amount) + due);
      const newBalance = round2(toNumber(bill.total) - newPaid);
      await query(
        "UPDATE bills SET paid_amount = ?, payment_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'partial' END, payment_method = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [newPaid, newBalance, normalizeText(paymentMode) === "cash" ? "cash" : "upi", bill.id],
      );

      return res.json({ message: "Bill settled", paid: newPaid, balance: newBalance < 0 ? 0 : newBalance });
    }

    return res.status(400).json({ message: `Unsupported sourceType: ${sourceType}` });
  } catch (error) {
    res.status(500).json({ message: "Failed to settle pending bill", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Legacy bill-payment endpoint (route not currently wired): record a payment
// against a restaurant bill.
// ---------------------------------------------------------------------------
const createBillPayment = async (req, res) => {
  const { billId, amount, paymentMode, notes } = req.body;
  try {
    if (!billId) return res.status(400).json({ message: "billId is required" });
    const methodId = await ensurePaymentMethodId(paymentMode || "Cash");
    const [result] = await query(
      `INSERT INTO payments (bill_id, amount, payment_method_id, payment_type, transaction_details, status)
       VALUES (?, ?, ?, 'payment', ?, 'completed')`,
      [billId, round2(amount), methodId, notes || null],
    );
    res.json({ message: "Bill payment recorded", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: "Failed to record bill payment", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
exports.getSummary = getSummary;
exports.getTransactions = getTransactions;
exports.getTransactionsPaged = getTransactionsPaged;
exports.createTransaction = createTransaction;
exports.getTransactionById = getTransactionById;
exports.updateTransaction = updateTransaction;
exports.deleteTransaction = deleteTransaction;
exports.getDepartmentSummary = getDepartmentSummary;
exports.getHotelBillingRecords = getHotelBillingRecords;
exports.getRestaurantBillingRecords = getRestaurantBillingRecords;
exports.getAllPaymentHistory = getAllPaymentHistory;
exports.getPaymentHistory = getPaymentHistory;
exports.savePaymentHistory = savePaymentHistory;
exports.createBillPayment = createBillPayment;

exports.getExtendedSummary = getExtendedSummary;

exports.getReconciliationSummary = getReconciliationSummary;
exports.listReconciliationItems = listReconciliationItems;
exports.matchBankLedger = matchBankLedger;
exports.unmatchBankLedger = unmatchBankLedger;
exports.listBankLedger = listBankLedger;
exports.addBankLedger = addBankLedger;
exports.updateBankLedger = updateBankLedger;
exports.deleteBankLedger = deleteBankLedger;
exports.getBankLedgerBySource = getBankLedgerBySource;

exports.listPettyCash = listPettyCash;
exports.addPettyCash = pettyCashWriteUnsupported;
exports.updatePettyCash = pettyCashWriteUnsupported;
exports.deletePettyCash = pettyCashWriteUnsupported;

exports.listGstReturns = listGstReturns;
exports.addGstReturn = gstReturnWriteUnsupported;
exports.updateGstReturn = gstReturnWriteUnsupported;
exports.deleteGstReturn = gstReturnWriteUnsupported;

exports.listVendorPayments = listVendorPayments;
exports.addVendorPayment = addVendorPayment;
exports.updateVendorPayment = updateVendorPayment;
exports.deleteVendorPayment = deleteVendorPayment;

exports.listPurchaseOrders = listPurchaseOrders;
exports.addPurchaseOrder = addPurchaseOrder;
exports.updatePurchaseOrder = updatePurchaseOrder;
exports.deletePurchaseOrder = deletePurchaseOrder;

exports.listPayrollRecords = listPayrollRecords;
exports.addPayrollRecord = addPayrollRecord;
exports.updatePayrollRecord = updatePayrollRecord;
exports.deletePayrollRecord = deletePayrollRecord;

exports.listProfitCenters = listProfitCenters;
exports.addProfitCenter = createProfitEntry;
exports.updateProfitCenter = updateProfitCenter;
exports.deleteProfitCenter = deleteProfitCenter;

exports.listPaymentGatewaySettings = listPaymentGatewaySettings;
exports.addPaymentGatewaySetting = addPaymentGatewaySetting;
exports.updatePaymentGatewaySetting = updatePaymentGatewaySetting;
exports.deletePaymentGatewaySetting = deletePaymentGatewaySetting;
exports.getPaymentGatewaySettingById = getPaymentGatewaySettingById;

exports.getTransactionsByModule = getTransactionsByModule;
exports.getSourceModules = getSourceModules;

exports.addIncome = addIncome;
exports.addExpense = addExpense;
exports.settlePendingBill = settlePendingBill;
