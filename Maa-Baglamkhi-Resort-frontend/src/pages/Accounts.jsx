import React, { useEffect, useMemo, useRef, useState } from "react";
import { localDate } from "../utils/localDate";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaChartLine,
  FaCheckCircle,
  FaFileInvoiceDollar,
  FaMoneyBillWave,
  FaPlus,
  FaReceipt,
  FaThLarge,
  FaExclamationCircle,
  FaTrashAlt,
  FaWallet,
  FaBuilding,
  FaCalendarAlt,
  FaFilter,
  FaSearch,
  FaTimes,
  FaArrowUp,
  FaArrowDown,
  FaArrowRight,
  FaHistory,
  FaLayerGroup,
  FaUndoAlt,
  FaChevronDown,
  FaChevronRight,
  FaPrint,
} from "react-icons/fa";

import PaymentSettingsManager from "../components/Accounts/PaymentSettingsManager";
import InvoiceForm from "../components/Accounts/forms/InvoiceForm";
import TransactionForm from "../components/Accounts/forms/TransactionForm";
import CustomerHistoryModal from "../components/Accounts/CustomerHistoryModal";
import API from "../api";

const formatINR = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);

const toNumber = (value) => Number(value || 0);
const TRANSACTION_PAGE_SIZE = 10;
const BILLING_PAGE_SIZE = 10;
const ACCOUNTS_MODULE_PAGE_SIZE = 10;

const SummaryRow = ({ label, value, tone }) => (
  <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 shadow-xs">
    <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
      {label}
    </span>
    <span className={`text-lg font-black ${tone || "text-slate-900"}`}>{value}</span>
  </div>
);

const getInvoiceRoomValue = (invoice) =>
  String(invoice.room_no || invoice.roomNo || invoice.roomNumber || "").trim();

const getHotelBookingRoomValue = (booking) =>
  String(booking.rooms || booking.room_no || booking.roomNo || "").trim();

const normalizePaymentMode = (value) => {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();

  if (!text) return "Unknown";
  if (lower.includes("cash")) return "Cash";
  if (lower.includes("upi")) return "UPI";
  if (lower.includes("card")) return "Card";
  if (lower.includes("bank")) return "Bank Transfer";
  if (lower.includes("cheque")) return "Cheque";
  if (lower.includes("pending")) return "Pending";
  return text;
};

const normalizeReconciliationStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getInvoicePaymentMode = (invoice) =>
  normalizePaymentMode(
    invoice.paymentMode ||
      invoice.payment_mode ||
      invoice.paymentMethod ||
      invoice.payment_method ||
      "",
  );

const getHotelBookingPaymentMode = (booking) =>
  normalizePaymentMode(booking.paymentMode || booking.payment_mode || "");

const getHotelBookingPaymentStatus = (booking) => {
  const remaining = toNumber(booking.remainingAmount || booking.balanceAmount);
  const paid = toNumber(booking.netPaid || booking.paidAmount);

  if (remaining <= 0 && paid > 0) return "Paid";
  if (paid > 0) return "Partial";
  return "Pending";
};

const getHotelBookingReference = (booking) =>
  String(booking.bookingCode || booking.booking_code || booking.bookingId || booking.id || "").trim();

const getRestaurantBillTableValue = (bill) =>
  String(bill.tableNumber || bill.table_number || bill.table || bill.locationLabel || "").trim();

const getRestaurantBillPaymentMode = (bill) =>
  normalizePaymentMode(
    bill.paymentMethod || bill.payment_method || bill.paymentMode || bill.payment_mode || "",
  );

const getRestaurantBillStatus = (bill) =>
  String(bill.invoiceStatus || bill.invoice_status || bill.status || "Generated").trim();

const getBanquetHallValue = (booking) =>
  String(booking.hallName || booking.hall_name || booking.hall || "").trim();

const getBanquetPaymentMode = (booking) =>
  normalizePaymentMode(
    booking.paymentMode || booking.payment_mode || booking.paymentMethod || booking.payment_method || "",
  );

const getBanquetPaymentStatus = (booking) =>
  String(booking.paymentStatus || booking.payment_status || booking.status || "Pending").trim();

const getBanquetReference = (booking) =>
  String(booking.invoiceNo || booking.invoice_no || "").trim();

const splitInvoiceAmounts = (invoice) => {
  const roomBase = toNumber(invoice.price_per_day) + toNumber(invoice.extra_charge);
  const restaurantBase = toNumber(invoice.food_charge);
  const finalTotal = toNumber(
    invoice.totalAmount ?? invoice.total_amount ?? invoice.final_total ?? invoice.subtotal,
  );
  const baseTotal = roomBase + restaurantBase;

  if (baseTotal <= 0) {
    return {
      roomAmount: 0,
      restaurantAmount: 0,
      finalAmount: finalTotal,
    };
  }

  if (restaurantBase <= 0) {
    return {
      roomAmount: finalTotal || roomBase,
      restaurantAmount: 0,
      finalAmount: finalTotal || roomBase,
    };
  }

  if (roomBase <= 0) {
    return {
      roomAmount: 0,
      restaurantAmount: finalTotal || restaurantBase,
      finalAmount: finalTotal || restaurantBase,
    };
  }

  return {
    roomAmount: Number((((finalTotal || baseTotal) * roomBase) / baseTotal).toFixed(2)),
    restaurantAmount: Number((((finalTotal || baseTotal) * restaurantBase) / baseTotal).toFixed(2)),
    finalAmount: finalTotal || baseTotal,
  };
};

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-800 outline-none transition-all duration-200 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 placeholder:text-slate-400";

const moduleColumns = {
  bankLedger: [
    { key: "entry_date", label: "Date" },
    { key: "bank_name", label: "Bank" },
    { key: "payment_mode", label: "Payment Mode" },
    { key: "reconciliation_status", label: "Status" },
    { key: "match_status", label: "Match" },
    { key: "credit", label: "Credit" },
    { key: "debit", label: "Debit" },
  ],
  pettyCash: [
    { key: "entry_date", label: "Date" },
    { key: "entry_type", label: "Type" },
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount" },
  ],
  gstReturns: [
    { key: "filing_period", label: "Period" },
    { key: "return_type", label: "Return" },
    { key: "status", label: "Status" },
    { key: "net_payable", label: "Net Payable" },
  ],
  vendorPayments: [
    { key: "vendor_name", label: "Vendor" },
    { key: "payment_date", label: "Date" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount" },
  ],
  purchaseOrders: [
    { key: "po_number", label: "PO No" },
    { key: "vendor_name", label: "Vendor" },
    { key: "status", label: "Status" },
    { key: "total_amount", label: "Amount" },
  ],
  payroll: [
    { key: "staff_name", label: "Staff" },
    { key: "payroll_month", label: "Month" },
    { key: "status", label: "Status" },
    { key: "net_salary", label: "Net Salary" },
  ],
  profitCenters: [
    { key: "center_name", label: "Center" },
    { key: "entry_date", label: "Date" },
    { key: "income_amount", label: "Income" },
    { key: "expense_amount", label: "Expense" },
  ],
};

const renderModuleValue = (value, key) => {
  if (key.includes("amount") || key === "credit" || key === "debit" || key === "net_payable" || key === "net_salary") {
    return formatINR(value);
  }
  return value || "-";
};

const formatInputDate = (value) => {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // Handle "02 Aug 2026" format from payment_history
  const months = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const match = text.match(/^(\d{2})\s+(\w{3})\s+(\d{4})$/);
  if (match) {
    const [, day, mon, year] = match;
    const month = months[mon];
    if (month) return `${year}-${month}-${day}`;
  }
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : text;
};

const AccountsModuleCard = ({
  title,
  subtitle,
  fields,
  onSubmit,
  onUpdate,
  onDelete,
  rows,
  columns,
  submitLabel,
  editLabel,
  toFormState,
  filterNote,
  onClearFilter,
}) => {
  const initialState = fields.reduce((acc, field) => {
    acc[field.name] = field.defaultValue ?? "";
    return acc;
  }, {});
  const [form, setForm] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil((rows || []).length / ACCOUNTS_MODULE_PAGE_SIZE));
  const paginatedRows = (rows || []).slice(
    (page - 1) * ACCOUNTS_MODULE_PAGE_SIZE,
    page * ACCOUNTS_MODULE_PAGE_SIZE,
  );

  useEffect(() => {
    if (!editingId) {
      setForm(initialState);
    }
  }, [editingId]);

  useEffect(() => {
    setPage(1);
  }, [rows, filterNote]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validateForm = () => {
    const nextErrors = {};
    fields.forEach((field) => {
      const value = form[field.name];
      const isEmpty = value === "" || value === null || value === undefined;
      if (field.required && isEmpty) {
        nextErrors[field.name] = `${field.label} is required.`;
        return;
      }
      if (field.type === "number" && !isEmpty) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          nextErrors[field.name] = `${field.label} must be a number.`;
        } else if (field.name === "amount" && num <= 0) {
          nextErrors[field.name] = "Amount must be greater than zero.";
        }
      }
    });
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;
    setSaving(true);
    const success = editingId ? await onUpdate(editingId, form) : await onSubmit(form);
    if (success) {
      setForm(initialState);
      setFieldErrors({});
      setEditingId(null);
    }
    setSaving(false);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm(toFormState(row));
  };

  const handleDeleteClick = async (row) => {
    const confirmed = window.confirm(`Delete this ${title.toLowerCase()} record?`);
    if (!confirmed) return;

    await onDelete(row.id);

    if (editingId === row.id) {
      setEditingId(null);
      setForm(initialState);
    }
  };

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6 md:p-7 shadow-sm transition-all duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">{title}</div>
          <div className="mt-1 text-sm sm:text-base font-medium text-slate-500">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          {editingId ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-700">
              Editing Record #{editingId}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600">
              {(rows || []).length} Recorded Entries
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 sm:p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3">
          {editingId ? "Update Entry Form" : "New Entry Form"}
        </div>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:gap-4 md:grid-cols-2">
          {fields.map((field) => {
            const isWideField =
              field.type === "textarea" || field.name === "description" || field.name === "notes";

            return (
              <label key={field.name} className={isWideField ? "block md:col-span-2" : "block"}>
                <span className="mb-1.5 block text-xs sm:text-[13px] font-bold text-slate-700">
                  {field.label} {field.required && <span className="text-rose-500">*</span>}
                </span>
                {field.type === "select" ? (
                  <select
                    name={field.name}
                    value={form[field.name]}
                    onChange={handleChange}
                    className={fieldClass}
                    aria-invalid={Boolean(fieldErrors[field.name])}
                  >
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    name={field.name}
                    value={form[field.name]}
                    onChange={handleChange}
                    rows={2}
                    className={fieldClass}
                    aria-invalid={Boolean(fieldErrors[field.name])}
                  />
                ) : (
                  <input
                    type={field.type || "text"}
                    name={field.name}
                    value={form[field.name]}
                    onChange={handleChange}
                    className={fieldClass}
                    aria-invalid={Boolean(fieldErrors[field.name])}
                  />
                )}
                {fieldErrors[field.name] && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600">{fieldErrors[field.name]}</p>
                )}
              </label>
            );
          })}
          <div className="md:col-span-2 flex flex-wrap gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-900 to-indigo-700 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-950/20 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
            >
              {saving ? "Saving..." : editingId ? editLabel || "Update Entry" : submitLabel}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(initialState);
                }}
                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 transition-all duration-200"
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </div>

      {filterNote ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          <span>{filterNote}</span>
          {onClearFilter ? (
            <button
              type="button"
              onClick={onClearFilter}
              className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100 transition-colors"
            >
              Show All
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200/80 shadow-xs">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-white text-xs uppercase tracking-wider font-semibold">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3.5">{column.label}</th>
              ))}
              <th className="px-4 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedRows.map((row) => (
              <tr key={row.id} className="transition-colors duration-150 hover:bg-blue-50/50">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3.5 text-slate-800 font-medium whitespace-nowrap">
                    {renderModuleValue(row[column.key], column.key)}
                  </td>
                ))}
                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => handleEdit(row)}
                      className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 transition-all duration-150"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(row)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-all duration-150"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows?.length ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-sm font-medium text-slate-400">
                  No records yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {(rows || []).length > ACCOUNTS_MODULE_PAGE_SIZE ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs sm:text-sm font-medium text-slate-500">
            Showing{" "}
            <span className="font-semibold text-slate-900">
              {(page - 1) * ACCOUNTS_MODULE_PAGE_SIZE + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-slate-900">
              {Math.min(page * ACCOUNTS_MODULE_PAGE_SIZE, (rows || []).length)}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-slate-900">{(rows || []).length}</span>{" "}
            records
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, index) => {
              const pageNumber = index + 1;
              const isActive = pageNumber === page;

              return (
                <button
                  key={`${title}-page-${pageNumber}`}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  className={`h-8 min-w-[32px] rounded-lg border px-2 text-xs font-bold transition-all ${
                    isActive
                      ? "border-blue-900 bg-blue-900 text-white shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {pageNumber}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const Accounts = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeAccountsModule, setActiveAccountsModule] = useState("petty-cash");
  const [activeViewSection, setActiveViewSection] = useState("ledger");
  const [records, setRecords] = useState([]);
  const [customerInvoices, setCustomerInvoices] = useState([]);
  const [hotelBookings, setHotelBookings] = useState([]);
  const [restaurantBills, setRestaurantBills] = useState([]);
  const [banquetBookings, setBanquetBookings] = useState([]);
  const [totals, setTotals] = useState({
    income: 0,
    expense: 0,
    net: 0,
    gstPayable: 0,
  });
  const [extendedSummary, setExtendedSummary] = useState({
    pendingBankReconciliation: 0,
    pettyCashBalance: 0,
    gstPendingPayable: 0,
    vendorOutstanding: 0,
    openPurchaseOrders: 0,
    payrollTotal: 0,
    profitCenters: [],
  });
  const [bankLedger, setBankLedger] = useState([]);
  const [reconciliationSummary, setReconciliationSummary] = useState({
    totalBankIn: 0,
    totalBankOut: 0,
    matchedAmount: 0,
    unmatchedAmount: 0,
    partialAmount: 0,
    reconciledAmount: 0,
    totalItems: 0,
    unmatchedItems: 0,
    partialItems: 0,
    matchedItems: 0,
  });
  const [reconciliationItems, setReconciliationItems] = useState([]);
  const [pettyCashEntries, setPettyCashEntries] = useState([]);
  const [gstReturns, setGstReturns] = useState([]);
  const [vendorPayments, setVendorPayments] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [profitCenters, setProfitCenters] = useState([]);
  const [paymentSettings, setPaymentSettings] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);

  const [showIncome, setShowIncome] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showCustomerHistory, setShowCustomerHistory] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [selectedBillingSource, setSelectedBillingSource] = useState("all");
  const [selectedInvoiceRoom, setSelectedInvoiceRoom] = useState("all");
  const [selectedRestaurantTable, setSelectedRestaurantTable] = useState("all");
  const [selectedBanquetHall, setSelectedBanquetHall] = useState("all");
  const [selectedPaymentMode, setSelectedPaymentMode] = useState("all");
  const [nameSearch, setNameSearch] = useState("");
  const [transactionPage, setTransactionPage] = useState(1);
  const [billingPage, setBillingPage] = useState(1);
  const [bankLedgerStatusFilter, setBankLedgerStatusFilter] = useState("all");
  const [selectedReconciliationSource, setSelectedReconciliationSource] = useState("all");
  const [selectedReconciliationMatch, setSelectedReconciliationMatch] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState({});

  const [toast, setToast] = useState(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);
  const [summaryError, setSummaryError] = useState(false);

  const refreshTimerRef = useRef(null);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const accountsModuleSectionRef = useRef(null);
  const toastTimerRef = useRef(null);
  const isAccountsModulesPage = new URLSearchParams(location.search).get("view") === "modules";

  const failMessage = (err, fallback) => err.response?.data?.message || fallback;

  const showToast = (message, tone = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const isAbortedRequest = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.message === "canceled" ||
    error?.message === "Request aborted" ||
    error?.name === "CanceledError";

  const fetchRecords = async () => {
    try {
      const res = await API.get("/accounts/transactions");
      setRecords(res.data || []);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading accounts records", err);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await API.get("/accounts/summary");
      setTotals({
        income: Number(res.data?.income) || 0,
        expense: Number(res.data?.expense) || 0,
        net: Number(res.data?.net) || 0,
        gstPayable: Number(res.data?.gstPayable) || 0,
      });
      setSummaryError(false);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading accounts summary", err);
      setSummaryError(true);
      showToast("Failed to refresh account totals. Retrying in 2s…", "error");
      setTimeout(() => fetchSummary(), 2000);
    }
  };

  const fetchInvoices = async () => {
    try {
      const res = await API.get("/invoices/all");
      setCustomerInvoices(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading invoices", err);
      setCustomerInvoices([]);
    }
  };

  const fetchHotelBookings = async () => {
    try {
      const res = await API.get("/accounts/hotel-billing");
      setHotelBookings(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading hotel billing records", err);
      setHotelBookings([]);
    }
  };

  const fetchRestaurantBills = async () => {
    try {
      const res = await API.get("/accounts/restaurant-billing");
      setRestaurantBills(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading restaurant bills", err);
      setRestaurantBills([]);
    }
  };

  const fetchBanquetBookings = async () => {
    try {
      const res = await API.get("/banquet");
      setBanquetBookings(Array.isArray(res.data?.bookings) ? res.data.bookings : []);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading banquet bookings", err);
      setBanquetBookings([]);
    }
  };

  const fetchReconciliationData = async () => {
    try {
      const params = {
        paymentMode: selectedPaymentMode,
        sourceType: selectedReconciliationSource,
        matchStatus: selectedReconciliationMatch,
      };

      const [summaryRes, itemsRes] = await Promise.all([
        API.get("/accounts/reconciliation/summary", { params }),
        API.get("/accounts/reconciliation/items", { params }),
      ]);

      setReconciliationSummary(summaryRes.data || {});
      setReconciliationItems(Array.isArray(itemsRes.data) ? itemsRes.data : []);
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading reconciliation data", err);
      setReconciliationSummary({
        totalBankIn: 0,
        totalBankOut: 0,
        matchedAmount: 0,
        unmatchedAmount: 0,
        partialAmount: 0,
        reconciledAmount: 0,
        totalItems: 0,
        unmatchedItems: 0,
        partialItems: 0,
        matchedItems: 0,
      });
      setReconciliationItems([]);
    }
  };

  const loadExpandedAccounts = async () => {
    try {
      const results = await Promise.allSettled([
        API.get("/accounts/extended-summary"),
        API.get("/accounts/bank-ledger"),
        API.get("/accounts/petty-cash"),
        API.get("/accounts/gst-returns"),
        API.get("/accounts/vendor-payments"),
        API.get("/accounts/purchase-orders"),
        API.get("/accounts/payroll"),
        API.get("/accounts/profit-centers"),
        API.get("/accounts/payment-settings"),
        API.get("/accounts/payment-history"),
      ]);

      const [extR, bankR, pettyR, gstR, vendorR, poR, payrollR, profitR, payR, paymentHistoryR] = results;

      setExtendedSummary(extR.status === "fulfilled" ? (extR.value.data || {}) : {});
      setBankLedger(bankR.status === "fulfilled" ? (bankR.value.data || []) : []);
      setPettyCashEntries(pettyR.status === "fulfilled" ? (pettyR.value.data || []) : []);
      setGstReturns(gstR.status === "fulfilled" ? (gstR.value.data || []) : []);
      setVendorPayments(vendorR.status === "fulfilled" ? (vendorR.value.data || []) : []);
      setPurchaseOrders(poR.status === "fulfilled" ? (poR.value.data || []) : []);
      setPayrollRecords(payrollR.status === "fulfilled" ? (payrollR.value.data || []) : []);
      setProfitCenters(profitR.status === "fulfilled" ? (profitR.value.data || []) : []);
      setPaymentSettings(payR.status === "fulfilled" ? (payR.value.data || []) : []);
      setPaymentHistory(paymentHistoryR.status === "fulfilled" ? (paymentHistoryR.value.data || []) : []);

      const failed = results
        .map((r, i) => (r.status === "rejected" ? i : -1))
        .filter((i) => i >= 0);
      if (failed.length) {
        console.error("Some expanded accounts endpoints failed:", failed);
      }
    } catch (err) {
      if (isAbortedRequest(err)) return;
      console.error("Error loading expanded accounts data", err);
    }
  };

  const refreshSummary = async () => {
    await fetchSummary();
  };

  const refreshAccountsData = async () => {
    if (refreshInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;

    try {
      do {
        pendingRefreshRef.current = false;

        const results = await Promise.allSettled([
          fetchRecords(),
          fetchSummary(),
          loadExpandedAccounts(),
          fetchInvoices(),
          fetchHotelBookings(),
          fetchRestaurantBills(),
          fetchBanquetBookings(),
          fetchReconciliationData(),
        ]);

        const failed = results
          .map((r, i) => (r.status === "rejected" ? i : -1))
          .filter((i) => i >= 0);
        if (failed.length) {
          console.error("Some refresh endpoints failed (indices):", failed);
        }
      } while (pendingRefreshRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    let active = true;

    const runRefresh = async () => {
      if (!active) return;
      await refreshAccountsData();
    };

    runRefresh();

    const handleAccountsUpdated = () => {
      runRefresh();
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        runRefresh();
      }
    };

    refreshTimerRef.current = window.setInterval(() => {
      runRefresh();
    }, 30000);

    window.addEventListener("accountsUpdated", handleAccountsUpdated);
    window.addEventListener("focus", handleAccountsUpdated);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    return () => {
      active = false;
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
      }
      window.removeEventListener("accountsUpdated", handleAccountsUpdated);
      window.removeEventListener("focus", handleAccountsUpdated);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
  }, []);

  useEffect(() => {
    fetchReconciliationData();
  }, [selectedPaymentMode, selectedReconciliationSource, selectedReconciliationMatch]);

  const createModuleEntry = async (endpoint, payload) => {
    try {
      await API.post(endpoint, payload);
      await refreshAccountsData();
      showToast("Entry saved");
      return true;
    } catch (error) {
      console.error(`Error saving ${endpoint}`, error);
      showToast(failMessage(error, "Entry could not be saved."), "error");
      return false;
    }
  };

  const updateModuleEntry = async (endpoint, id, payload) => {
    try {
      await API.put(`${endpoint}/${id}`, payload);
      await refreshAccountsData();
      showToast("Entry updated");
      return true;
    } catch (error) {
      console.error(`Error updating ${endpoint}`, error);
      showToast(failMessage(error, "Entry update failed."), "error");
      return false;
    }
  };

  const deleteModuleEntry = async (endpoint, id) => {
    try {
      await API.delete(`${endpoint}/${id}`);
      await refreshAccountsData();
      showToast("Entry deleted");
      return true;
    } catch (error) {
      console.error(`Error deleting ${endpoint}`, error);
      showToast(failMessage(error, "Entry delete failed."), "error");
      return false;
    }
  };

  const handleAddIncome = async (data) => {
    try {
      await API.post("/accounts/income", data);
      await Promise.all([refreshAccountsData(), refreshSummary()]);
      setShowIncome(false);
      showToast("Income added");
    } catch (err) {
      showToast(failMessage(err, "Error adding income"), "error");
    }
  };

  const handleAddExpense = async (data) => {
    try {
      await API.post("/accounts/expense", data);
      await Promise.all([refreshAccountsData(), refreshSummary()]);
      setShowExpense(false);
      showToast("Expense added");
    } catch (err) {
      showToast(failMessage(err, "Error adding expense"), "error");
    }
  };

  const handleEditClick = (record) => {
    const dateForForm = formatInputDate(record.date);
    setEditingRecord({ ...record, date: dateForForm });
    setShowEdit(true);
  };

  const handleUpdateTransaction = async (data) => {
    setUpdateLoading(true);
    try {
      await API.put(`/accounts/transactions/${editingRecord.id}`, data);

      // Optimistically update the records state so the UI reflects
      // the change (e.g. new payment mode) immediately.
      setRecords((prev) =>
        prev.map((record) =>
          String(record.id) === String(editingRecord.id)
            ? { ...record, ...data }
            : record,
        ),
      );

      // If the payment mode was changed and the current filter no longer
      // matches the updated record, reset the filter to "all" so the
      // edited record remains visible instead of disappearing behind
      // "No transaction records match the selected payment mode."
      const newPaymentMode = normalizePaymentMode(data.paymentMode);
      if (
        selectedPaymentMode !== "all" &&
        newPaymentMode !== "Unknown" &&
        newPaymentMode !== selectedPaymentMode
      ) {
        setSelectedPaymentMode("all");
      }

      // Sync with server to ensure consistency
      await Promise.all([refreshAccountsData(), refreshSummary()]);
      setShowEdit(false);
      setEditingRecord(null);
      showToast("Transaction updated successfully");
    } catch (err) {
      // Revert optimistic changes by re-fetching from server
      await Promise.all([refreshAccountsData(), refreshSummary()]);
      const message = err.response?.data?.message || "Error updating transaction";
      showToast(message, "error");
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleDeleteTransaction = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this transaction? This action cannot be undone.",
    );
    if (!confirmed) return;

    setDeleteLoadingId(id);
    try {
      await API.delete(`/accounts/transactions/${id}`);
      setSelectedPaymentMode("all");
      await Promise.all([refreshAccountsData(), refreshSummary()]);
      showToast("Transaction deleted successfully");
    } catch (err) {
      const message = err.response?.data?.message || "Error deleting transaction";
      showToast(message, "error");
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const handlePrintGroup = async (group) => {
    const customer = getGroupCustomer(group);
    const now = new Date().toLocaleString("en-IN");

    // Build a combined timeline from ledger records
    const ledgerItems = (group.records || [])
      .filter((r) => r.id && !String(r.id).startsWith("hotel-payment-"))
      .map((r) => {
        const isIncome = r.type === "Income";
        return {
          id: r.id,
          date: r.date || "",
          sortDate: r.sortDate || r.date || "",
          description: r.description || "-",
          narration: r.narration || "",
          mode: r.paymentMode || "-",
          type: r.type,
          amount: Number(r.amount || 0),
          debit: isIncome ? 0 : Number(r.amount || 0),
          credit: isIncome ? Number(r.amount || 0) : 0,
          source: r.sourceModule || "accounts",
        };
      });

    // Fetch payment history — filter by customer mobile/name if available
    let paymentItems = [];
    let hotelBillingItems = [];
    let restaurantBillingItems = [];

    try {
      const [paymentRes, hotelRes, restaurantRes] = await Promise.all([
        API.get("/accounts/payment-history"),
        API.get("/accounts/hotel-billing"),
        API.get("/accounts/restaurant-billing"),
      ]);

      const allPayments = Array.isArray(paymentRes.data) ? paymentRes.data : [];
      const allHotelBills = Array.isArray(hotelRes.data) ? hotelRes.data : [];
      const allRestaurantBills = Array.isArray(restaurantRes.data) ? restaurantRes.data : [];

      // Collect all customer identifiers from this group's records
      const groupMobiles = new Set();
      const groupNames = new Set();
      const groupBookings = new Set();

      (group.records || []).forEach((r) => {
        if (r.customerMobile) groupMobiles.add(String(r.customerMobile).trim().toLowerCase());
        if (r.customerName) groupNames.add(String(r.customerName).trim().toLowerCase());

        // Extract booking id from description like "Booking #15"
        const bookingMatch = (r.description || "").match(/Booking\s*#(\d+)/i);
        if (bookingMatch) groupBookings.add(bookingMatch[1]);
      });

      paymentItems = allPayments
        .filter((p) => {
          if (groupBookings.size > 0 && p.booking_id && groupBookings.has(String(p.booking_id))) return true;
          if (groupMobiles.size > 0 && p.mobile && groupMobiles.has(String(p.mobile).trim().toLowerCase())) return true;
          if (groupNames.size > 0 && p.guest_name && groupNames.has(String(p.guest_name).trim().toLowerCase())) return true;
          return false;
        })
        .map((p) => {
          const createdAt = new Date(p.created_at);
          return {
            id: `ph-${p.id}`,
            date: createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
            sortDate: p.created_at || "",
            description: `Payment #${p.id} — ${p.guest_name || "Guest"}${p.booking_id ? ` (Booking #${p.booking_id})` : ""}`,
            narration: "",
            mode: p.payment_mode || "Cash",
            type: "Income",
            amount: Number(p.amount || 0),
            debit: 0,
            credit: Number(p.amount || 0),
            source: "payment_history",
            discount: Number(p.discount_amount || 0),
            status: p.status || "Completed",
          };
        });

      // Filter hotel billing by customer name or booking reference
      hotelBillingItems = allHotelBills
        .filter((bill) => {
          const billRef = String(bill.invoice_no || bill.invoiceNo || bill.booking_id || "").toLowerCase();
          const billCustomer = String(bill.customer_name || bill.customerName || "").toLowerCase();
          const billMobile = String(bill.mobile || "").toLowerCase();
          if (groupBookings.size > 0 && billRef && groupBookings.has(billRef.replace(/\D/g, ""))) return true;
          if (groupMobiles.size > 0 && billMobile && groupMobiles.has(billMobile)) return true;
          if (groupNames.size > 0 && billCustomer && groupNames.has(billCustomer)) return true;
          // Match by description containing booking number
          if (groupBookings.size > 0) {
            for (const bk of groupBookings) {
              if (billRef.includes(bk) || bill.description?.toLowerCase().includes(`booking #${bk}`)) return true;
            }
          }
          return false;
        })
        .map((bill) => ({
          id: `hotel-${bill.id}`,
          date: bill.date || bill.created_at || "",
          sortDate: bill.date || bill.created_at || "",
          description: `Hotel Invoice ${bill.invoice_no || bill.invoiceNo || `#${bill.id}`}${bill.customer_name ? ` — ${bill.customer_name}` : ""}`,
          mode: bill.payment_mode || bill.paymentMode || "-",
          type: bill.payment_status === "Paid" ? "Income" : bill.payment_status === "Cancelled" ? "Expense" : "Income",
          amount: Number(bill.total_amount || bill.totalAmount || bill.final_total || bill.total || 0),
          debit: bill.payment_status === "Cancelled" ? Number(bill.total_amount || bill.totalAmount || bill.final_total || bill.total || 0) : 0,
          credit: bill.payment_status !== "Cancelled" ? Number(bill.total_amount || bill.totalAmount || bill.final_total || bill.total || 0) : 0,
          source: "hotel-billing",
          status: bill.payment_status || bill.status || "Pending",
        }));

      // Filter restaurant bills by customer name or table/booking reference
      restaurantBillingItems = allRestaurantBills
        .filter((bill) => {
          const billCustomer = String(bill.customerName || bill.customer_name || "").toLowerCase();
          const billMobile = String(bill.mobile || "").toLowerCase();
          const billRef = String(bill.reference || bill.id || "").toLowerCase();
          if (groupMobiles.size > 0 && billMobile && groupMobiles.has(billMobile)) return true;
          if (groupNames.size > 0 && billCustomer && groupNames.has(billCustomer)) return true;
          // Match by description containing booking number or customer name
          if (groupNames.size > 0) {
            for (const nm of groupNames) {
              if ((bill.description || "").toLowerCase().includes(nm) || billCustomer.includes(nm)) return true;
            }
          }
          return false;
        })
        .map((bill) => ({
          id: `rest-${bill.id}`,
          date: bill.created_at || bill.date || "",
          sortDate: bill.created_at || bill.date || "",
          description: `Restaurant Bill ${bill.reference || `#${bill.id}`}${bill.customerName && bill.customerName !== "Walk-in" ? ` — ${bill.customerName}` : ""}`,
          mode: bill.payment_mode || bill.paymentMode || "-",
          type: "Income",
          amount: Number(bill.total || 0),
          debit: 0,
          credit: Number(bill.total || 0),
          source: "restaurant-billing",
          status: bill.paymentStatus || bill.status || "Pending",
        }));
    } catch (err) {
      console.error("Failed to load billing data for print:", err);
    }

    // Combine all items and sort by date descending (newest first)
    const allItems = [...ledgerItems, ...paymentItems, ...hotelBillingItems, ...restaurantBillingItems].sort((a, b) => {
      const da = new Date(a.sortDate || 0);
      const db = new Date(b.sortDate || 0);
      return db - da;
    });

    // Calculate totals including all sources
    const totalCredit = allItems.reduce((s, i) => s + i.credit, 0);
    const totalDebit = allItems.reduce((s, i) => s + i.debit, 0);
    const totalDiscount = paymentItems.reduce((s, i) => s + i.discount, 0);
    const netBalance = totalCredit - totalDebit;

    const hotelTotal = hotelBillingItems.reduce((s, i) => s + i.amount, 0);
    const restaurantTotal = restaurantBillingItems.reduce((s, i) => s + i.amount, 0);

    // Build table rows
    const rows = allItems
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.description)}</td>
          <td>${escapeHtml(item.narration)}</td>
          <td>${escapeHtml(item.mode)}</td>
          <td style="text-align:right">${item.type === "Income" ? formatINR(item.amount) : "-"}</td>
          <td style="text-align:right">${item.type === "Expense" ? formatINR(item.amount) : "-"}</td>
          <td style="text-align:right">${item.discount > 0 ? `-${formatINR(item.discount)}` : "-"}</td>
          <td>${escapeHtml(item.status || "-")}</td>
          <td style="font-size:10px;color:#6b7280;">${escapeHtml(item.source)}</td>
        </tr>
      `,
      )
      .join("");

    const emptyMsg = allItems.length === 0 ? `<tr><td colspan="9" style="text-align:center;padding:24px;color:#9ca3af;">No transactions found</td></tr>` : "";

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Customer Statement - ${escapeHtml(customer || group.name)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 24px;
            color: #111827;
            font-size: 13px;
            max-width: 100%;
            overflow-x: hidden;
          }
          .header {
            text-align: center;
            padding-bottom: 14px;
            border-bottom: 3px solid #0f172a;
            margin-bottom: 16px;
          }
          .header h1 {
            font-size: 22px;
            font-weight: 800;
            color: #0f172a;
            margin: 0;
          }
          .header .subtitle {
            font-size: 13px;
            color: #475569;
            margin-top: 3px;
          }
          .header .meta {
            font-size: 11px;
            color: #94a3b8;
            margin-top: 4px;
          }

          .top-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 14px;
          }
          .info-box {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 16px;
            background: #f8fafc;
          }
          .info-box .label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #64748b;
            font-weight: 700;
            margin-bottom: 2px;
          }
          .info-box .value {
            font-size: 15px;
            font-weight: 700;
            color: #0f172a;
          }
          .info-box .sub {
            font-size: 11px;
            color: #64748b;
            margin-top: 1px;
          }

          .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 20px;
          }
          .summary-card {
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 12px 14px;
            text-align: center;
          }
          .summary-card .label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #6b7280;
            font-weight: 700;
          }
          .summary-card .value {
            font-size: 16px;
            font-weight: 800;
            margin-top: 4px;
          }
          .value-income { color: #059669; }
          .value-expense { color: #dc2626; }
          .value-discount { color: #d97706; }
          .value-net { color: #111827; }
          .value-green { color: #059669; }
          .val-dark { color: #0f172a; }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
          }
          th {
            background: #0f172a;
            color: #fff;
            text-align: left;
            padding: 10px 12px;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 700;
          }
          td {
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
            vertical-align: top;
            font-size: 12px;
            line-height: 1.4;
          }
          tr:nth-child(even) { background: #f9fafb; }
          .section-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #475569;
            margin-top: 18px;
            margin-bottom: 6px;
            padding: 6px 10px;
            background: #f1f5f9;
            border-radius: 6px;
          }

          .footer {
            margin-top: 24px;
            text-align: center;
            font-size: 11px;
            color: #9ca3af;
            border-top: 1px solid #e5e7eb;
            padding-top: 12px;
          }
          .no-print { margin-top: 20px; text-align: center; }
          .no-print button {
            padding: 10px 28px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            margin: 0 4px;
          }
          .btn-print {
            background: #0f172a;
            color: #fff;
            border: none;
          }
          .btn-close {
            background: #fff;
            color: #374151;
            border: 1px solid #d1d5db;
          }
          .text-right { text-align: right; }
          .text-green { color: #059669; font-weight: 600; }
          .text-red { color: #dc2626; font-weight: 600; }
          .text-muted { color: #94a3b8; font-size: 11px; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Customer Statement</h1>
          <div class="subtitle">${escapeHtml(customer || group.name)}</div>
          <div class="meta">Generated ${now} · ${allItems.length} transaction${allItems.length !== 1 ? "s" : ""}</div>
        </div>

        <div class="top-row">
          <div class="info-box">
            <div class="label">Customer / Party</div>
            <div class="value">${escapeHtml(customer || group.name)}</div>
            <div class="sub">${escapeHtml(group.name)}</div>
          </div>
          <div class="info-box">
            <div class="label">Net Balance</div>
            <div class="value" style="color:${netBalance >= 0 ? '#059669' : '#dc2626'};">
              ${formatINR(Math.abs(netBalance))} ${netBalance >= 0 ? '(Cr)' : '(Dr)'}
            </div>
            <div class="sub">${totalCredit > 0 ? 'Total In: ' + formatINR(totalCredit) : ''}${totalCredit > 0 && totalDebit > 0 ? ' · ' : ''}${totalDebit > 0 ? 'Total Out: ' + formatINR(totalDebit) : ''}</div>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Payments In</div>
            <div class="value value-green">${formatINR(totalCredit)}</div>
          </div>
          <div class="summary-card">
            <div class="label">Hotel Bills</div>
            <div class="value val-dark">${hotelBillingItems.length > 0 ? formatINR(hotelTotal) : '-'}</div>
          </div>
          <div class="summary-card">
            <div class="label">Restaurant Bills</div>
            <div class="value val-dark">${restaurantBillingItems.length > 0 ? formatINR(restaurantTotal) : '-'}</div>
          </div>
          <div class="summary-card">
            <div class="label">Net Balance</div>
            <div class="value value-net">${formatINR(Math.abs(netBalance))}</div>
          </div>
        </div>

        ${paymentItems.length > 0 ? `
        <div class="section-title">Payment History (${paymentItems.length})</div>
        <table>
          <thead>
            <tr>
              <th style="width:12%">Date</th>
              <th style="width:34%">Description</th>
              <th style="width:12%">Mode</th>
              <th style="text-align:right">Amount</th>
              <th style="text-align:right">Discount</th>
              <th style="text-align:center">Status</th>
            </tr>
          </thead>
          <tbody>
            ${paymentItems.map(p => {
              const badge = p.status === 'Completed' ? 'badge-ok' : p.status === 'Cancelled' ? 'badge-cancel' : 'badge-pending';
              return `
              <tr>
                <td>${escapeHtml(p.date)}</td>
                <td>${escapeHtml(p.description)}</td>
                <td>${escapeHtml(p.mode)}</td>
                <td class="text-right text-green">+${formatINR(p.amount)}</td>
                <td class="text-right" style="color:#d97706;">${p.discount > 0 ? formatINR(p.discount) : '-'}</td>
                <td class="text-center"><span class="badge ${badge}">${escapeHtml(p.status)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ` : ''}

        ${ledgerItems.length > 0 ? `
        <div class="section-title">Ledger Transactions (${ledgerItems.length})</div>
        <table>
          <thead>
            <tr>
              <th style="width:12%">Date</th>
              <th style="width:38%">Description</th>
              <th style="width:10%">Type</th>
              <th style="text-align:right">Amount</th>
              <th style="text-align:center">Status</th>
            </tr>
          </thead>
          <tbody>
            ${ledgerItems.map(item => `
              <tr>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.description)}</td>
                <td>${item.type}</td>
                <td class="text-right ${item.type === 'Income' ? 'text-green' : 'text-red'}">${formatINR(item.amount)}</td>
                <td class="text-center">${escapeHtml(item.status || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}

        ${hotelBillingItems.length > 0 ? `
        <div class="section-title">Hotel Bills (${hotelBillingItems.length})</div>
        <table>
          <thead>
            <tr>
              <th style="width:12%">Date</th>
              <th style="width:38%">Description</th>
              <th style="width:12%">Type</th>
              <th style="text-align:right">Amount</th>
              <th style="text-align:center">Status</th>
            </tr>
          </thead>
          <tbody>
            ${hotelBillingItems.map(item => `
              <tr>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.description)}</td>
                <td>${item.type}</td>
                <td class="text-right ${item.type === 'Income' ? 'text-green' : 'text-red'}">${formatINR(item.amount)}</td>
                <td class="text-center">${escapeHtml(item.status || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}

        ${restaurantBillingItems.length > 0 ? `
        <div class="section-title">Restaurant Bills (${restaurantBillingItems.length})</div>
        <table>
          <thead>
            <tr>
              <th style="width:12%">Date</th>
              <th style="width:38%">Description</th>
              <th style="width:12%">Type</th>
              <th style="text-align:right">Amount</th>
              <th style="text-align:center">Status</th>
            </tr>
          </thead>
          <tbody>
            ${restaurantBillingItems.map(item => `
              <tr>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.description)}</td>
                <td>${item.type}</td>
                <td class="text-right ${item.type === 'Income' ? 'text-green' : 'text-red'}">${formatINR(item.amount)}</td>
                <td class="text-center">${escapeHtml(item.status || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}

        <div class="footer">
          Maa Baglamkhi Resort — Customer Statement &middot; Printed ${now}
        </div>

        <div class="no-print">
          <button class="btn-print" onclick="window.print()">Print Statement</button>
          <button class="btn-close" onclick="window.close()">Close</button>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=1000,height=800");
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      showToast("Please allow popups to print", "error");
    }
  };

  const escapeHtml = (text) => {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  };

  const handleGenerateInvoice = async (invoice) => {
    try {
      await API.post("/invoices/create", invoice);
      await refreshAccountsData();
      setShowInvoice(false);
      showToast("Invoice generated");
    } catch (err) {
      showToast(failMessage(err, "Error generating invoice"), "error");
    }
  };

  const handleCreateBankLedger = (form) =>
    createModuleEntry("/accounts/bank-ledger", form);

  const handleCreatePettyCash = (form) =>
    createModuleEntry("/accounts/petty-cash", form);

  const handleCreateGstReturn = (form) =>
    createModuleEntry("/accounts/gst-returns", {
      ...form,
      netPayable: Number(form.gstCollected || 0) - Number(form.gstPaid || 0),
      filedOn: form.status === "Filed" ? form.filedOn || localDate() : null,
    });

  const handleCreateVendorPayment = (form) =>
    createModuleEntry("/accounts/vendor-payments", form);

  const handleCreatePurchaseOrder = (form) =>
    createModuleEntry("/accounts/purchase-orders", form);

  const handleCreatePayrollRecord = (form) =>
    createModuleEntry("/accounts/payroll", {
      ...form,
      netSalary:
        Number(form.baseSalary || 0) +
        Number(form.allowance || 0) -
        Number(form.deduction || 0),
    });

  const handleCreateProfitCenter = (form) =>
    createModuleEntry("/accounts/profit-centers", form);


  const savePaymentSetting = async (method, id, form) => {
    // Plain JSON instead of FormData: the multer/busboy backend 500s on
    // Transfer-Encoding: chunked multipart bodies. A picked QR file is sent as
    // base64 so the whole body stays scalar text.
    const base = {
      paymentMode: form.paymentMode || "UPI",
      department: form.department || "Hotel",
      providerName: form.providerName || "",
      upiId: form.upiId || "",
      accountHolderName: form.accountHolderName || "",
      bankName: form.bankName || "",
      qrImageUrl: form.qrImageUrl || "",
      isActive: form.isActive ? "1" : "0",
      notes: form.notes || "",
    };
    try {
      let payload = base;
      if (form.qrImageFile) {
        const buf = Buffer.from(await form.qrImageFile.arrayBuffer());
        payload = { ...base, qrImageBase64: `data:${form.qrImageFile.type || "image/png"};base64,${buf.toString("base64")}` };
      }
      if (method === "post") {
        await API.post("/accounts/payment-settings", payload);
      } else {
        await API.put(`/accounts/payment-settings/${id}`, payload);
      }
      await refreshAccountsData();
      return true;
    } catch (error) {
      console.error("Error saving payment setting", error);
      showToast(failMessage(error, "Payment setting save failed."), "error");
      return false;
    }
  };

  const handleCreatePaymentSetting = (form) => savePaymentSetting("post", null, form);

  const handleUpdatePaymentSetting = (id, form) => savePaymentSetting("put", id, form);

  const handleDeletePaymentSetting = async (id) => {
    try {
      await API.delete(`/accounts/payment-settings/${id}`);
      await refreshAccountsData();
      return true;
    } catch (error) {
      console.error("Error deleting payment setting", error);
      showToast(failMessage(error, "Payment setting delete failed."), "error");
      return false;
    }
  };

  const handleLinkBankLedger = async (payload) => {
    try {
      await API.post("/accounts/reconciliation/match", payload);
      await refreshAccountsData();
      return true;
    } catch (error) {
      console.error("Error linking bank ledger", error);
      showToast(failMessage(error, "Bank ledger link failed."), "error");
      return false;
    }
  };

  const handleUnlinkBankLedger = async (payload) => {
    try {
      await API.post("/accounts/reconciliation/unmatch", payload);
      await refreshAccountsData();
      return true;
    } catch (error) {
      console.error("Error unlinking bank ledger", error);
      showToast(failMessage(error, "Bank ledger unlink failed."), "error");
      return false;
    }
  };

  const accountsModuleConfigs = [
    {
      key: "petty-cash",
      title: "Petty Cash",
      subtitle: "Track and manage daily cash movements and approvals with ease.",
      fields: [
        { name: "entryDate", label: "Entry Date", type: "date", required: true },
        {
          name: "entryType",
          label: "Entry Type",
          type: "select",
          required: true,
          defaultValue: "Out",
          options: ["In", "Out"],
        },
        { name: "category", label: "Category", required: true },
        { name: "description", label: "Description", required: true },
        { name: "amount", label: "Amount", type: "number", required: true },
        { name: "approvedBy", label: "Approved By" },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      onSubmit: handleCreatePettyCash,
      onUpdate: (id, form) => updateModuleEntry("/accounts/petty-cash", id, form),
      onDelete: (id) => deleteModuleEntry("/accounts/petty-cash", id),
      rows: pettyCashEntries,
      columns: moduleColumns.pettyCash,
      submitLabel: "Add Petty Cash",
      editLabel: "Update Petty Cash",
      toFormState: (row) => ({
        entryDate: formatInputDate(row.entry_date),
        entryType: row.entry_type || "Out",
        category: row.category || "",
        description: row.description || "",
        amount: row.amount || 0,
        approvedBy: row.approved_by || "",
        notes: row.notes || "",
      }),
    },
    {
      key: "gst-returns",
      title: "GST Return Tracker",
      subtitle: "Return filing, collected GST aur payable amount ko sync me rakhein.",
      fields: [
        { name: "filingPeriod", label: "Filing Period", placeholder: "Mar-2026", required: true },
        {
          name: "returnType",
          label: "Return Type",
          type: "select",
          required: true,
          defaultValue: "GSTR-3B",
          options: ["GSTR-1", "GSTR-3B", "GSTR-9"],
        },
        { name: "taxableAmount", label: "Taxable Amount", type: "number", required: true },
        { name: "gstCollected", label: "GST Collected", type: "number", required: true },
        { name: "gstPaid", label: "GST Paid/Input", type: "number", required: true },
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          defaultValue: "Draft",
          options: ["Draft", "Ready", "Filed"],
        },
        { name: "filedOn", label: "Filed On", type: "date" },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      onSubmit: handleCreateGstReturn,
      onUpdate: (id, form) =>
        updateModuleEntry("/accounts/gst-returns", id, {
          ...form,
          netPayable: Number(form.gstCollected || 0) - Number(form.gstPaid || 0),
          filedOn: form.status === "Filed" ? form.filedOn || localDate() : null,
        }),
      onDelete: (id) => deleteModuleEntry("/accounts/gst-returns", id),
      rows: gstReturns,
      columns: moduleColumns.gstReturns,
      submitLabel: "Save GST Record",
      editLabel: "Update GST Record",
      toFormState: (row) => ({
        filingPeriod: row.filing_period || "",
        returnType: row.return_type || "GSTR-3B",
        taxableAmount: row.taxable_amount || 0,
        gstCollected: row.gst_collected || 0,
        gstPaid: row.gst_paid || 0,
        status: row.status || "Draft",
        filedOn: formatInputDate(row.filed_on),
        notes: row.notes || "",
      }),
    },
    {
      key: "vendor-payments",
      title: "Vendor Payments",
      subtitle: "Supplier invoices, scheduled payouts aur payment mode tracking.",
      fields: [
        { name: "vendorName", label: "Vendor Name", required: true },
        { name: "invoiceRef", label: "Invoice Ref" },
        { name: "paymentDate", label: "Payment Date", type: "date", required: true },
        { name: "amount", label: "Amount", type: "number", required: true },
        {
          name: "paymentMode",
          label: "Payment Mode",
          type: "select",
          required: true,
          defaultValue: "Bank Transfer",
          options: ["Bank Transfer", "Cash", "UPI", "Cheque"],
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          defaultValue: "Scheduled",
          options: ["Scheduled", "Partially Paid", "Paid"],
        },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      onSubmit: handleCreateVendorPayment,
      onUpdate: (id, form) => updateModuleEntry("/accounts/vendor-payments", id, form),
      onDelete: (id) => deleteModuleEntry("/accounts/vendor-payments", id),
      rows: vendorPayments,
      columns: moduleColumns.vendorPayments,
      submitLabel: "Add Vendor Payment",
      editLabel: "Update Vendor Payment",
      toFormState: (row) => ({
        vendorName: row.vendor_name || "",
        invoiceRef: row.invoice_ref || "",
        paymentDate: formatInputDate(row.payment_date),
        amount: row.amount || 0,
        paymentMode: row.payment_mode || "Bank Transfer",
        status: row.status || "Scheduled",
        notes: row.notes || "",
      }),
    },
    {
      key: "purchase-orders",
      title: "Purchase Orders",
      subtitle: "Procurement approvals aur open PO pipeline ko manage karein.",
      fields: [
        { name: "poNumber", label: "PO Number", required: true },
        { name: "vendorName", label: "Vendor Name", required: true },
        { name: "orderDate", label: "Order Date", type: "date", required: true },
        { name: "expectedDate", label: "Expected Date", type: "date" },
        { name: "totalAmount", label: "Total Amount", type: "number", required: true },
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          defaultValue: "Draft",
          options: ["Draft", "Approved", "Ordered", "Closed", "Cancelled"],
        },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      onSubmit: handleCreatePurchaseOrder,
      onUpdate: (id, form) => updateModuleEntry("/accounts/purchase-orders", id, form),
      onDelete: (id) => deleteModuleEntry("/accounts/purchase-orders", id),
      rows: purchaseOrders,
      columns: moduleColumns.purchaseOrders,
      submitLabel: "Create PO",
      editLabel: "Update PO",
      toFormState: (row) => ({
        poNumber: row.po_number || "",
        vendorName: row.vendor_name || "",
        orderDate: formatInputDate(row.order_date),
        expectedDate: formatInputDate(row.expected_date),
        totalAmount: row.total_amount || 0,
        status: row.status || "Draft",
        notes: row.notes || "",
      }),
    },
    {
      key: "payroll",
      title: "Payroll Tracker",
      subtitle: "Attendance-linked salary sheet ka ready register maintain karein.",
      fields: [
        { name: "staffName", label: "Staff Name", required: true },
        { name: "payrollMonth", label: "Payroll Month", placeholder: "Mar-2026", required: true },
        { name: "attendanceDays", label: "Attendance Days", type: "number", required: true },
        { name: "baseSalary", label: "Base Salary", type: "number", required: true },
        { name: "allowance", label: "Allowance", type: "number", defaultValue: 0 },
        { name: "deduction", label: "Deduction", type: "number", defaultValue: 0 },
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          defaultValue: "Draft",
          options: ["Draft", "Processed", "Paid"],
        },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      onSubmit: handleCreatePayrollRecord,
      onUpdate: (id, form) =>
        updateModuleEntry("/accounts/payroll", id, {
          ...form,
          netSalary:
            Number(form.baseSalary || 0) +
            Number(form.allowance || 0) -
            Number(form.deduction || 0),
        }),
      onDelete: (id) => deleteModuleEntry("/accounts/payroll", id),
      rows: payrollRecords,
      columns: moduleColumns.payroll,
      submitLabel: "Add Payroll",
      editLabel: "Update Payroll",
      toFormState: (row) => ({
        staffName: row.staff_name || "",
        payrollMonth: row.payroll_month || "",
        attendanceDays: row.attendance_days || 0,
        baseSalary: row.base_salary || 0,
        allowance: row.allowance || 0,
        deduction: row.deduction || 0,
        status: row.status || "Draft",
        notes: row.notes || "",
      }),
    },
    {
      key: "profit-centers",
      title: "Profit Center Split",
      subtitle: "Hotel, restaurant aur banquet wise income-expense breakdown.",
      fields: [
        {
          name: "centerName",
          label: "Center Name",
          type: "select",
          required: true,
          defaultValue: "Hotel",
          options: ["Hotel", "Restaurant", "Banquet", "Spa", "Other"],
        },
        { name: "entryDate", label: "Entry Date", type: "date", required: true },
        { name: "incomeAmount", label: "Income Amount", type: "number", defaultValue: 0 },
        { name: "expenseAmount", label: "Expense Amount", type: "number", defaultValue: 0 },
        { name: "notes", label: "Notes", type: "textarea" },
      ],
      onSubmit: handleCreateProfitCenter,
      onUpdate: (id, form) => updateModuleEntry("/accounts/profit-centers", id, form),
      onDelete: (id) => deleteModuleEntry("/accounts/profit-centers", id),
      rows: profitCenters,
      columns: moduleColumns.profitCenters,
      submitLabel: "Add Profit Entry",
      editLabel: "Update Profit Entry",
      toFormState: (row) => ({
        centerName: row.center_name || "Hotel",
        entryDate: formatInputDate(row.entry_date),
        incomeAmount: row.income_amount || 0,
        expenseAmount: row.expense_amount || 0,
        notes: row.notes || "",
      }),
    },
    {
      key: "payment-settings",
      title: "UPI & Scanner Setup",
      subtitle: "Client payment scanners, UPI IDs, and bank-linked payment setups.",
      submitLabel: "UPI & Scanner",
    },
  ];
  const activeModule =
    accountsModuleConfigs.find((module) => module.key === activeAccountsModule) ||
    accountsModuleConfigs[0];
  const paymentModeOptions = ["all", "Cash", "UPI", "Card", "Bank Transfer", "Cheque"];
  const billingSourceOptions = [
    { value: "all", label: "All Sources" },
    { value: "hotel", label: "Hotel" },
    { value: "restaurant", label: "Restaurant" },
    { value: "banquet", label: "Banquet" },
  ];
  const filteredRecords =
    selectedPaymentMode === "all"
      ? records
      : records.filter((record) => normalizePaymentMode(record.paymentMode) === selectedPaymentMode);
  const roomFilterOptions = Array.from(
    new Set(
      [
        ...customerInvoices.map((invoice) => getInvoiceRoomValue(invoice)),
        ...hotelBookings.map((booking) => getHotelBookingRoomValue(booking)),
      ].filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const restaurantTableOptions = Array.from(
    new Set(restaurantBills.map((bill) => getRestaurantBillTableValue(bill)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const banquetHallOptions = Array.from(
    new Set(banquetBookings.map((booking) => getBanquetHallValue(booking)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const roomFilteredInvoices =
    selectedInvoiceRoom === "all"
      ? customerInvoices
      : customerInvoices.filter((invoice) => getInvoiceRoomValue(invoice) === selectedInvoiceRoom);
  const invoiceBookingIds = new Set(
    customerInvoices
      .map((invoice) => String(invoice.booking_id || invoice.customer_id || ""))
      .filter(Boolean),
  );
  const invoiceFallbackBookings = hotelBookings.filter(
    (booking) => !invoiceBookingIds.has(String(booking.bookingId || booking.id || "")),
  );
  const roomFilteredHotelBookings =
    selectedInvoiceRoom === "all"
      ? invoiceFallbackBookings
      : invoiceFallbackBookings.filter(
          (booking) => getHotelBookingRoomValue(booking) === selectedInvoiceRoom,
        );
  const hotelInvoices =
    selectedPaymentMode === "all"
      ? roomFilteredInvoices
      : roomFilteredInvoices.filter(
          (invoice) => getInvoicePaymentMode(invoice) === selectedPaymentMode,
        );
  const filteredHotelBookings =
    selectedPaymentMode === "all"
      ? roomFilteredHotelBookings
      : roomFilteredHotelBookings.filter(
          (booking) => getHotelBookingPaymentMode(booking) === selectedPaymentMode,
        );
  const tableFilteredRestaurantBills =
    selectedRestaurantTable === "all"
      ? restaurantBills
      : restaurantBills.filter(
          (bill) => getRestaurantBillTableValue(bill) === selectedRestaurantTable,
        );
  const filteredRestaurantBills =
    selectedPaymentMode === "all"
      ? tableFilteredRestaurantBills
      : tableFilteredRestaurantBills.filter(
          (bill) => getRestaurantBillPaymentMode(bill) === selectedPaymentMode,
        );
  const hallFilteredBanquetBookings =
    selectedBanquetHall === "all"
      ? banquetBookings
      : banquetBookings.filter(
          (booking) => getBanquetHallValue(booking) === selectedBanquetHall,
        );
  const filteredBanquetBookings =
    selectedPaymentMode === "all"
      ? hallFilteredBanquetBookings
      : hallFilteredBanquetBookings.filter(
          (booking) => getBanquetPaymentMode(booking) === selectedPaymentMode,
        );
  const showHotelSource = selectedBillingSource === "all" || selectedBillingSource === "hotel";
  const showRestaurantSource =
    selectedBillingSource === "all" || selectedBillingSource === "restaurant";
  const showBanquetSource =
    selectedBillingSource === "all" || selectedBillingSource === "banquet";
  const visibleHotelInvoices = showHotelSource ? hotelInvoices : [];
  const visibleHotelBookings = showHotelSource ? filteredHotelBookings : [];
  const visibleRestaurantBills = showRestaurantSource ? filteredRestaurantBills : [];
  const visibleBanquetBookings = showBanquetSource ? filteredBanquetBookings : [];
  const filteredHotelTotals = hotelInvoices.reduce(
    (acc, invoice) => {
      const split = splitInvoiceAmounts(invoice);
      acc.roomAmount += split.roomAmount;
      acc.restaurantAmount += split.restaurantAmount;
      acc.finalAmount += split.finalAmount;
      return acc;
    },
    { roomAmount: 0, restaurantAmount: 0, finalAmount: 0 },
  );
  filteredHotelBookings.forEach((booking) => {
    const total = toNumber(
      booking.totalAmount || booking.total_amount || booking.netPaid || booking.paidAmount,
    );
    filteredHotelTotals.roomAmount += total;
    filteredHotelTotals.finalAmount += total;
  });
  const filteredRestaurantBillTotals = filteredRestaurantBills.reduce(
    (acc, bill) => {
      const total = toNumber(bill.total);
      acc.restaurantAmount += total;
      acc.finalAmount += total;
      return acc;
    },
    { roomAmount: 0, restaurantAmount: 0, finalAmount: 0 },
  );
  const filteredBanquetTotals = filteredBanquetBookings.reduce(
    (acc, booking) => {
      const total = toNumber(
        booking.grandTotal || booking.grand_total || booking.totalAmount || booking.total_amount,
      );
      acc.banquetAmount += total;
      acc.finalAmount += total;
      return acc;
    },
    { banquetAmount: 0, finalAmount: 0 },
  );
  const filteredBillingTotals = {
    roomAmount: showHotelSource ? filteredHotelTotals.roomAmount : 0,
    restaurantAmount:
      (showHotelSource ? filteredHotelTotals.restaurantAmount : 0) +
      (showRestaurantSource ? filteredRestaurantBillTotals.restaurantAmount : 0),
    banquetAmount: showBanquetSource ? filteredBanquetTotals.banquetAmount : 0,
    finalAmount:
      (showHotelSource ? filteredHotelTotals.finalAmount : 0) +
      (showRestaurantSource ? filteredRestaurantBillTotals.finalAmount : 0) +
      (showBanquetSource ? filteredBanquetTotals.finalAmount : 0),
  };
  const combinedBillingRecords = [
    ...visibleHotelInvoices.map((invoice) => ({
      id: `hotel-${invoice.id}`,
      source: "Hotel",
      billType: "Hotel Invoice",
      reference: invoice.invoice_no || invoice.invoiceNo || "--",
      customerName: invoice.customer_name || invoice.customerName || "--",
      locationLabel: getInvoiceRoomValue(invoice) ? `Room ${getInvoiceRoomValue(invoice)}` : "--",
      date: invoice.date || "--",
      total: toNumber(invoice.totalAmount ?? invoice.total_amount ?? invoice.final_total),
      paidAmount: toNumber(invoice.paidAmount || invoice.paid_amount || invoice.amount_paid || 0),
      remainingAmount: toNumber(invoice.remainingAmount || invoice.balanceAmount || invoice.remaining_amount || 0),
      paymentMode: getInvoicePaymentMode(invoice),
      paymentStatus: invoice.paymentStatus || invoice.payment_status || invoice.status || "Pending",
      actionId: invoice.booking_id || invoice.customer_id,
      actionKind: "invoice",
      raw: invoice,
    })),
    ...visibleHotelBookings.map((booking) => ({
      id: `hotel-booking-${booking.bookingId || booking.id}`,
      source: "Hotel",
      billType: "Hotel Booking",
      reference: getHotelBookingReference(booking) || "--",
      customerName: booking.guest_name || booking.customerName || "--",
      locationLabel: getHotelBookingRoomValue(booking) ? `Room ${getHotelBookingRoomValue(booking)}` : "--",
      date: booking.check_out || booking.checkOut || booking.check_in || booking.checkIn || "--",
      total: toNumber(
        booking.totalAmount || booking.total_amount || booking.netPaid || booking.paidAmount,
      ),
      paymentMode: getHotelBookingPaymentMode(booking),
      paymentStatus: getHotelBookingPaymentStatus(booking),
      remainingAmount: toNumber(booking.remainingAmount || booking.balanceAmount || 0),
      actionId: booking.bookingId || booking.id,
      actionKind: "hotel-booking",
      raw: booking,
    })),
    ...visibleRestaurantBills.map((bill) => ({
      id: `restaurant-${bill.id}`,
      source: "Restaurant",
      billType: "Restaurant Bill",
      reference: bill.reference || `RBILL-${bill.id}`,
      customerName: bill.customerName || bill.customer_name || "Walk-in",
      locationLabel: bill.locationLabel || (getRestaurantBillTableValue(bill)
        ? `Table ${getRestaurantBillTableValue(bill)}`
        : "--"),
      date: bill.created_at || bill.date || "--",
      total: toNumber(bill.total),
      paidAmount: toNumber(bill.paidAmount || bill.paid_amount || bill.amount_paid || 0),
      remainingAmount: toNumber(bill.remainingAmount || bill.balanceAmount || bill.remaining_amount || 0),
      paymentMode: getRestaurantBillPaymentMode(bill),
      paymentStatus: bill.paymentStatus || getRestaurantBillStatus(bill),
      actionId: bill.actionId || bill.id,
      actionKind: "restaurant-bill",
      raw: bill,
    })),
    ...visibleBanquetBookings.map((booking) => ({
      id: `banquet-${booking.id}`,
      source: "Banquet",
      billType: "Banquet Invoice",
      reference: getBanquetReference(booking) || `BNQ-${booking.id}`,
      customerName: booking.customerName || booking.customer_name || "--",
      locationLabel: getBanquetHallValue(booking) || "--",
      date: booking.date || "--",
      total: toNumber(
        booking.grandTotal || booking.grand_total || booking.totalAmount || booking.total_amount,
      ),
      paidAmount: toNumber(booking.paidAmount || booking.paid_amount || booking.amount_paid || 0),
      remainingAmount: toNumber(booking.remainingAmount || booking.balanceAmount || 0),
      paymentMode: getBanquetPaymentMode(booking),
      paymentStatus: getBanquetPaymentStatus(booking),
      actionId: booking.id,
      actionKind: "banquet",
      raw: booking,
    })),
  ].sort((left, right) => String(right.date).localeCompare(String(left.date)));

  // The top search bar is labelled "Search by party, guest or narration…",
  // so it also narrows the Customer Billing rows — not just the ledger below.
  // Matches bill/invoice numbers, guest or party names, amounts (plain number
  // and formatted ₹), dates, room/table/hall labels, payment mode and status.
  const billingSearchTerm = String(nameSearch || "").trim().toLowerCase();
  const searchFilteredBillingRecords = billingSearchTerm
    ? combinedBillingRecords.filter((row) => {
        const total = toNumber(row.total);
        const paid = toNumber(row.paidAmount);
        const remaining = toNumber(row.remainingAmount);
        const searchable = [
          row.reference,
          row.customerName,
          row.billType,
          row.source,
          row.locationLabel,
          row.narration,
          row.date,
          row.paymentMode,
          row.paymentStatus,
          total ? `${total} ${formatINR(total)}` : "",
          paid ? `${paid} ${formatINR(paid)}` : "",
          remaining ? `${remaining} ${formatINR(remaining)}` : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchable.includes(billingSearchTerm);
      })
    : combinedBillingRecords;

  const billingTotalPages = Math.max(1, Math.ceil(searchFilteredBillingRecords.length / BILLING_PAGE_SIZE));
  const paginatedBillingRecords = searchFilteredBillingRecords.slice(
    (billingPage - 1) * BILLING_PAGE_SIZE,
    billingPage * BILLING_PAGE_SIZE,
  );
  const paymentModeSummary = {
    recordsCount: filteredRecords.length,
    recordsAmount: filteredRecords.reduce((sum, record) => sum + toNumber(record.amount), 0),
    invoiceCount: searchFilteredBillingRecords.length,
    invoiceAmount: searchFilteredBillingRecords.reduce((sum, row) => sum + toNumber(row.total), 0),
  };
  paymentModeSummary.combinedCount =
    paymentModeSummary.recordsCount + paymentModeSummary.invoiceCount;
  paymentModeSummary.combinedAmount =
    paymentModeSummary.recordsAmount + paymentModeSummary.invoiceAmount;

  // Today's payment overview — derived from accounts_transactions (records)
  // records[].date format: "DD MMM YYYY" (e.g. "15 Jul 2026")
  const MONTHS_INDEX = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const parseRecordDate = (text) => {
    if (!text) return null;
    const match = String(text).match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = MONTHS_INDEX[match[2]];
    const year = Number(match[3]);
    if (month == null || Number.isNaN(day) || Number.isNaN(year)) return null;
    return new Date(year, month, day);
  };
  const isSameDay = (a, b) =>
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const today = new Date();
  const todayRecords = (records || []).filter((record) =>
    isSameDay(parseRecordDate(record.date), today),
  );
  const todayStats = {
    count: todayRecords.length,
    total: todayRecords.reduce((sum, record) => sum + toNumber(record.amount), 0),
    income: todayRecords
      .filter((record) => record.type === "Income")
      .reduce((sum, record) => sum + toNumber(record.amount), 0),
    expense: todayRecords
      .filter((record) => record.type === "Expense")
      .reduce((sum, record) => sum + toNumber(record.amount), 0),
  };

  // Extract booking id from a transaction row (description like "Hotel payment received - Booking #123 - Guest Name")
  const extractBookingId = (record) => {
    if (!record) return null;
    const text = String(record.description || "");
    const match = text.match(/Booking\s*#\s*(\d+)/i);
    if (match) return match[1];
    if (record.id && String(record.id).startsWith("hotel-payment-")) {
      return String(record.id).replace("hotel-payment-", "");
    }
    return null;
  };

  const extractPartyName = (record) => {
    if (!record) return null;
    const text = String(record.description || "").trim();
    if (!text) return null;

    // Skip if the entire description is just a reference number like "Booking #15" or "Bill #24"
    const soleRef = text.match(/^(Booking\s*#\d+|Bill\s*#\d+)$/i);
    if (soleRef) return null;

    // Pattern 1: "Hotel payment received - Booking #5 - Rahul Sharma"
    // Pattern 2: "Booking cancellation refund - Booking #5 - Rahul Sharma"
    const dashMatch = text.match(/-\s*([^-]+)\s*$/);
    if (dashMatch) {
      const candidate = dashMatch[1].trim();
      // Skip if it's just a number or a reference number (e.g. "Booking #5", "Bill #24")
      if (!candidate || /^[\d\s]+$/.test(candidate) || candidate.length <= 1) return null;
      if (/^(Booking\s*#\d+|Bill\s*#\d+)$/i.test(candidate)) return null;
      return candidate;
    }

    // Pattern 3: "Staff salary paid - Rahul" or "Vendor payment - Mahesh Electronics"
    const altMatch = text.match(/-\s*(.+)$/);
    if (altMatch) {
      const candidate = altMatch[1].trim();
      if (!candidate || /^[\d\s]+$/.test(candidate) || candidate.length <= 1) return null;
      if (/^(Booking\s*#\d+|Bill\s*#\d+)$/i.test(candidate)) return null;
      return candidate;
    }

    return null;
  };

  const extractReferenceNumber = (record) => {
    if (!record) return null;
    const text = String(record.description || "").trim();
    if (!text) return null;

    // Extract "Booking #5", "Bill #24", etc.
    const refMatch = text.match(/(Booking\s*#\d+|Bill\s*#\d+)/i);
    if (refMatch) {
      return refMatch[1].replace(/\s+/g, ' ').trim();
    }

    return null;
  };

  const getGroupKey = (record) => {
    const refNumber = extractReferenceNumber(record);
    const name = extractPartyName(record);

    if (refNumber) {
      return { key: refNumber, label: name ? `${refNumber} - ${name}` : refNumber };
    }

    if (name) {
      return { key: name, label: name };
    }

    // Fall back to the customer party captured in the Add Income / Add Expense
    // form (the "Customer / Party Name" + "Mobile Number" fields), so a record
    // like description "Flower purchase" + customer "kapil" groups under
    // kapil instead of the catch-all "Other". Keyed by name when present so
    // name-only and name+mobile rows for the same party stay in one group.
    const customerName = String(record.customerName || "").trim();
    const customerMobile = String(record.customerMobile || "").trim();
    const customerKey = customerName || customerMobile;
    if (customerKey) {
      const customerLabel =
        customerName && customerMobile
          ? `${customerName} (${customerMobile})`
          : customerKey;
      return { key: customerKey, label: customerLabel };
    }

    return { key: '__ungrouped', label: 'Other' };
  };

  const getGroupCustomer = (group) => {
    if (!group?.records?.length) return null;
    for (const r of group.records) {
      if (r.customerMobile || r.customerName) {
        return r.customerMobile || r.customerName;
      }
    }
    return null;
  };

  const getGroupCustomerNarration = (group) => {
    if (!group?.records?.length) return null;
    for (const r of group.records) {
      if (r.narration) return r.narration;
    }
    return null;
  };

  // Distinct notes across a group's records — used to keep every note visible
  // on the collapsed group summary row instead of only the first one.
  const getGroupNarrations = (group) => {
    if (!group?.records?.length) return [];
    const notes = new Set();
    group.records.forEach((r) => {
      const note = String(r.narration || "").trim();
      if (note) notes.add(note);
    });
    return [...notes];
  };

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const groupedTransactions = useMemo(() => {
    const map = new Map();
    (records || []).forEach((record) => {
      const { key, label } = getGroupKey(record);
      if (!map.has(key)) {
        map.set(key, {
          name: label,
          key,
          records: [],
          income: 0,
          expense: 0,
        });
      }
      const group = map.get(key);
      group.records.push(record);
      const amount = toNumber(record.amount);
      if (record.type === 'Income') {
        group.income += amount;
      } else {
        group.expense += amount;
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === '__ungrouped') return 1;
      if (b.key === '__ungrouped') return -1;
      return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' });
    });
  }, [records]);

  const expandAllGroups = () => {
    const allKeys = groupedTransactions.map((g) => g.key);
    const next = {};
    allKeys.forEach((k) => { next[k] = true; });
    setExpandedGroups(next);
  };

  const collapseAllGroups = () => {
    setExpandedGroups({});
  };

  const allExpanded = groupedTransactions.length > 0 && groupedTransactions.every((g) => expandedGroups[g.key]);


  const filteredGroupedTransactions = useMemo(() => {
    if (selectedPaymentMode === "all") return groupedTransactions;
    return groupedTransactions
      .map((group) => {
        const filteredRecords = group.records.filter((record) =>
          normalizePaymentMode(record.paymentMode) === selectedPaymentMode,
        );
        if (filteredRecords.length === 0) return null;
        const income = filteredRecords
          .filter((r) => r.type === "Income")
          .reduce((sum, r) => sum + toNumber(r.amount), 0);
        const expense = filteredRecords
          .filter((r) => r.type === "Expense")
          .reduce((sum, r) => sum + toNumber(r.amount), 0);
        return { ...group, records: filteredRecords, income, expense };
      })
      .filter(Boolean);
  }, [groupedTransactions, selectedPaymentMode]);

  const searchTerm = String(nameSearch || "").trim().toLowerCase();

  // A record matches the search when any of its fields contain the term
  // (case-insensitive): party/customer name, mobile number, the amount,
  // transaction number, date, type, payment mode, department, source module,
  // description and narration/notes. Amounts are included as plain numbers
  // (and with a "₹" prefix variant) so typing "500" finds a ₹500 entry.
  const recordMatchesSearch = (record) => {
    if (!searchTerm) return true;
    const { key, label } = getGroupKey(record);
    const amount = toNumber(record.amount);
    const amountText = amount ? `${amount} ${formatINR(amount)}` : "";
    const searchable = [
      key,
      label,
      record.customerMobile,
      record.customerName,
      record.narration,
      record.description,
      record.transaction_no,
      record.transactionNo,
      record.department,
      record.paymentMode,
      record.sourceModule,
      record.type,
      record.date,
      amountText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(searchTerm);
  };

  // When a search is active, narrow each group to ONLY its matching records
  // (and drop groups left with none), recomputing the group totals. Without
  // this the "Other" group — which bundles many unrelated records under one
  // shared key — would show or hide as a whole block based on just its first
  // record, so most searches returned nothing.
  const searchFilteredGroupedTransactions = useMemo(() => {
    if (!searchTerm) return filteredGroupedTransactions;
    return filteredGroupedTransactions
      .map((group) => {
        const records_ = group.records.filter(recordMatchesSearch);
        if (records_.length === 0) return null;
        const income = records_
          .filter((r) => r.type === "Income")
          .reduce((sum, r) => sum + toNumber(r.amount), 0);
        const expense = records_
          .filter((r) => r.type === "Expense")
          .reduce((sum, r) => sum + toNumber(r.amount), 0);
        return { ...group, records: records_, income, expense };
      })
      .filter(Boolean);
  }, [filteredGroupedTransactions, searchTerm]);

  React.useEffect(() => {
    setTransactionPage(1);
  }, [searchTerm, selectedPaymentMode]);

  const transactionTotalPages = Math.max(1, Math.ceil(searchFilteredGroupedTransactions.length / TRANSACTION_PAGE_SIZE));
  const paginatedTransactionRecords = searchFilteredGroupedTransactions.slice(
    (transactionPage - 1) * TRANSACTION_PAGE_SIZE,
    transactionPage * TRANSACTION_PAGE_SIZE,
  );

  const selectedBookingId = selectedRecord ? extractBookingId(selectedRecord) : null;
  const bookingPaymentGroups = selectedBookingId
    ? [
        {
          bookingId: selectedBookingId,
          transactions: (records || []).filter(
            (record) => extractBookingId(record) === selectedBookingId,
          ),
          invoices: (customerInvoices || []).filter(
            (invoice) => String(invoice.booking_id || invoice.bookingId || "") === selectedBookingId,
          ),
          hotelBookings: (hotelBookings || []).filter(
            (booking) => String(booking.bookingId || booking.id || "") === selectedBookingId,
          ),
          restaurantBills: (restaurantBills || []).filter(
            (bill) => String(bill.bookingId || bill.booking_id || bill.id || "") === selectedBookingId,
          ),
          banquetBookings: (banquetBookings || []).filter(
            (booking) => String(booking.bookingId || booking.booking_id || booking.id || "") === selectedBookingId,
          ),
        },
      ]
    : [];

  useEffect(() => {
    setTransactionPage(1);
  }, [selectedPaymentMode]);

  useEffect(() => {
    setBillingPage(1);
  }, [
    selectedBillingSource,
    selectedInvoiceRoom,
    selectedRestaurantTable,
    selectedBanquetHall,
    selectedPaymentMode,
    nameSearch,
  ]);

  useEffect(() => {
    if (transactionPage > transactionTotalPages) {
      setTransactionPage(transactionTotalPages);
    }
  }, [transactionPage, transactionTotalPages]);

  useEffect(() => {
    if (billingPage > billingTotalPages) {
      setBillingPage(billingTotalPages);
    }
  }, [billingPage, billingTotalPages]);

  useEffect(() => {
    if (!isAccountsModulesPage) return;

    setActiveAccountsModule("petty-cash");
    setShowIncome(false);
    setShowExpense(false);
    setShowInvoice(false);
    setShowView(false);
  }, [isAccountsModulesPage]);

  const openBankReconciliationModule = () => {
    navigate("/accounts/bank-reconciliation");
  };

  const openCustomerInvoicesPage = () => {
    navigate("/accounts/customer-invoices");
  };

  const openAccountsTabsPage = () => {
    navigate("/accounts?view=modules");
  };

  // Total Income / Total Expense / Net Position — computed directly from
  // the transaction records instead of trusting totals.income / totals.expense
  // / totals.net from the backend summary. The backend summary was adding
  // GST Payable (₹5) on top of both Total Income and Net Position (e.g.
  // showing ₹5,605 / ₹3,605 instead of the correct ₹5,500 / ₹3,500). Deriving
  // these straight from `records` guarantees GST never leaks into them and
  // keeps them perfectly in sync with the Daily Income Breakdown table.
  const computedTotals = useMemo(() => {
    const income = (records || []).reduce(
      (sum, record) => (record.type === "Income" ? sum + toNumber(record.amount) : sum),
      0,
    );
    const expense = (records || []).reduce(
      (sum, record) => (record.type === "Expense" ? sum + toNumber(record.amount) : sum),
      0,
    );
    return { income, expense, net: income - expense };
  }, [records]);

  // Daily carry-forward breakdown — computed once here so both the
  // "Remaining Income" summary card and the breakdown table below use
  // the exact same numbers (this is the single source of truth now).
  const dailyBreakdown = useMemo(() => {
    const parseDailyDate = (text) => {
      if (!text) return null;
      const match = String(text).match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
      if (!match) return null;
      const day = Number(match[1]);
      const month = MONTHS_INDEX[match[2]];
      const year = Number(match[3]);
      if (month == null || Number.isNaN(day) || Number.isNaN(year)) return null;
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };

    const dailyMap = {};
    (records || []).forEach((record) => {
      const dateKey = parseDailyDate(record.date);
      if (!dateKey) return;
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = { date: dateKey, income: 0, expense: 0 };
      }
      // Use the raw stored amount exactly as-is — no GST or any other
      // charge should ever be added on top of it here. If amount is 500,
      // it must stay 500.
      const amount = toNumber(record.amount);
      if (record.type === "Income") {
        dailyMap[dateKey].income += amount;
      } else if (record.type === "Expense") {
        dailyMap[dateKey].expense += amount;
      }
    });

    const sortedDays = Object.values(dailyMap).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );

    let carryForward = 0;
    const rows = sortedDays.map((day) => {
      const totalIncome = day.income + carryForward;
      const remaining = totalIncome - day.expense;
      const row = {
        date: day.date,
        newIncome: day.income,
        carriedForward: carryForward,
        totalIncome,
        expense: day.expense,
        remaining,
      };
      // Only a positive remaining balance carries forward to the next day.
      carryForward = remaining > 0 ? remaining : 0;
      return row;
    });

    const remainingIncome = rows.length > 0 ? rows[rows.length - 1].remaining : 0;

    return { rows, remainingIncome };
  }, [records]);

  const formatDayDate = (iso) => {
    if (!iso) return "--";
    const [y, m, d] = iso.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  };

  const accountsModulesSection = (
    <section ref={accountsModuleSectionRef} className="space-y-6">
      <div className="rounded-[30px] border border-blue-100/70 bg-white p-6 shadow-[0_25px_60px_-15px_rgba(30,64,175,0.15)] sm:p-7">
        <div className="text-[15px] font-semibold uppercase tracking-[0.18em] text-sky-600">
          Accounts Tabs
        </div>
        <h3 className="mt-2 text-[22px] font-black text-slate-900">
          Open any finance module from one click
        </h3>
        <p className="mt-3 max-w-3xl text-[17px] leading-7 text-slate-500">
          Click any tab to open the related
          form and its latest saved records.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {accountsModuleConfigs.map((module) => {
            const isActive = module.key === activeModule?.key;
            return (
              <button
                key={module.key}
                type="button"
                onClick={() => setActiveAccountsModule(module.key)}
                className={`rounded-full px-5 py-3 text-[16px] font-bold transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-blue-800 to-sky-500 text-white shadow-lg shadow-blue-900/25 -translate-y-0.5"
                    : "border border-blue-100 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700 hover:-translate-y-0.5"
                }`}
              >
                {module.submitLabel}
              </button>
            );
          })}
        </div>
      </div>

      {activeModule.key === "payment-settings" ? (
        <PaymentSettingsManager
          rows={paymentSettings}
          onSubmit={handleCreatePaymentSetting}
          onUpdate={handleUpdatePaymentSetting}
          onDelete={handleDeletePaymentSetting}
        />
      ) : (
        <AccountsModuleCard
          key={activeModule.key}
          title={activeModule.title}
          subtitle={activeModule.subtitle}
          fields={activeModule.fields}
          onSubmit={activeModule.onSubmit}
          onUpdate={activeModule.onUpdate}
          onDelete={activeModule.onDelete}
          rows={activeModule.rows}
          columns={activeModule.columns}
          submitLabel={activeModule.submitLabel}
          editLabel={activeModule.editLabel}
          toFormState={activeModule.toFormState}
          filterNote={activeModule.filterNote}
          onClearFilter={activeModule.onClearFilter}
        />
      )}
    </section>
  );

  if (isAccountsModulesPage) {
    return (
      <div className="relative min-h-screen overflow-x-hidden bg-[#F5F8FF] p-3 sm:p-4 md:p-6 xl:p-8">
        {toast && (
          <div className={`fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold shadow-2xl transition-all duration-300 ${
            toast.tone === "error"
              ? "bg-rose-600 text-white"
              : "bg-emerald-600 text-white"
          }`}>
            <span className="inline-flex items-center gap-2">
              {toast.tone === "error" ? <FaExclamationCircle /> : <FaCheckCircle />}
              {toast.message}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[-8%] top-[-6%] h-72 w-72 rounded-full bg-blue-500/10 blur-3xl sm:h-96 sm:w-96" />
          <div className="absolute right-[-10%] top-[8%] h-72 w-72 rounded-full bg-sky-400/10 blur-3xl sm:h-[28rem] sm:w-[28rem]" />
        </div>

        <div className="w-full space-y-5 sm:space-y-6 xl:space-y-7">
          <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-blue-950 via-blue-800 to-sky-500 px-4 py-5 text-white shadow-[0_30px_70px_-20px_rgba(2,32,71,0.45)] sm:rounded-[24px] sm:px-6 sm:py-7 md:rounded-[28px] md:px-8 md:py-9 xl:rounded-[32px] xl:py-10">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -left-10 -top-24 h-72 w-72 rounded-full bg-sky-400/30 blur-3xl" />
              <div className="absolute -right-16 top-1/3 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute bottom-[-6rem] left-1/3 h-64 w-64 rounded-full bg-blue-400/20 blur-3xl" />
              <svg className="absolute right-0 top-0 h-full w-1/2 opacity-20" viewBox="0 0 400 400" fill="none">
                <path d="M0 200 C 100 100, 300 300, 400 100" stroke="white" strokeWidth="1.5" />
                <path d="M0 280 C 120 180, 280 380, 400 200" stroke="white" strokeWidth="1" />
              </svg>
            </div>
            <div className="relative space-y-3 sm:space-y-4">
              <button
                type="button"
                onClick={() => navigate("/accounts")}
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[14px] font-bold text-white backdrop-blur-md transition-all duration-200 hover:border-sky-200 hover:bg-white/20 sm:text-[15px]"
              >
                <FaArrowLeft className="text-sky-200" />
                Back to Accounts Workspace
              </button>
              <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-sky-200 sm:text-[15px] sm:tracking-[0.26em]">
                Finance Center
              </p>
              <h1 className="text-3xl font-black leading-tight sm:text-4xl xl:text-5xl">
                Accounts tabs workspace
              </h1>
              <p className="max-w-3xl text-[15px] leading-6 text-blue-50/85 sm:text-lg sm:leading-8 xl:text-xl">
                Manage petty cash, GST, vendor payments, payroll, and scanner settings from dedicated screens—all in one place.
              </p>
            </div>
          </section>

          {accountsModulesSection}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#F5F8FF] p-3 sm:p-4 md:p-6 xl:p-8">
      {toast && (
        <div className={`fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold shadow-2xl transition-all duration-300 ${
          toast.tone === "error"
            ? "bg-rose-600 text-white"
            : "bg-emerald-600 text-white"
        }`}>
          <span className="inline-flex items-center gap-2">
            {toast.tone === "error" ? <FaExclamationCircle /> : <FaCheckCircle />}
            {toast.message}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-8%] top-[-6%] h-72 w-72 rounded-full bg-blue-500/10 blur-3xl sm:h-96 sm:w-96" />
        <div className="absolute right-[-10%] top-[8%] h-72 w-72 rounded-full bg-sky-400/10 blur-3xl sm:h-[28rem] sm:w-[28rem]" />
      </div>

      <div className="w-full space-y-5 sm:space-y-6 xl:space-y-7">
        {/* ========================================================
            HERO EXECUTIVE COMMAND HEADER
           ======================================================== */}
        <section className="relative overflow-hidden rounded-[24px] md:rounded-[32px] bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 p-6 sm:p-8 md:p-10 text-white shadow-xl shadow-blue-950/15">
          {/* Decorative ambient radial glows */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-16 -top-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute -right-20 top-1/4 h-80 w-80 rounded-full bg-sky-400/15 blur-3xl" />
            <div className="absolute bottom-[-6rem] left-1/3 h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl" />
          </div>

          <div className="relative space-y-6">
            {/* Top Eyebrow & Status */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[12px] font-extrabold uppercase tracking-[0.22em] text-sky-300">
                  Accounts & Financial Intelligence
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 py-1 text-xs font-semibold text-slate-200 backdrop-blur-md">
                <span>Auto-sync active</span>
              </span>
            </div>

            {/* Main Title & Description */}
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black leading-tight tracking-tight text-white">
                Accounts workspace in dashboard style
              </h1>
              <p className="mt-2.5 max-w-3xl text-sm sm:text-base md:text-lg leading-relaxed text-blue-100/80">
                Manage income, expenses, invoices, and transaction records from one attractive and responsive finance dashboard.
              </p>
            </div>

            {/* Action Buttons Hub */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {/* Primary Financial Actions */}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-600 px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-emerald-950/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                onClick={() => setShowIncome(true)}
              >
                <FaPlus className="text-xs" />
                Add Income
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-rose-500 hover:bg-rose-600 px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-rose-950/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                onClick={() => setShowExpense(true)}
              >
                <FaMoneyBillWave className="text-xs" />
                Add Expense
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-sky-500 hover:bg-sky-600 px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-sky-950/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                onClick={() => setShowInvoice(true)}
              >
                <FaReceipt className="text-xs" />
                Invoice
              </button>

              {/* Navigation Workspaces */}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-white hover:bg-slate-100 px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 shadow-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                onClick={openAccountsTabsPage}
              >
                <FaThLarge className="text-blue-600 text-xs" />
                Accounts Tab
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 hover:bg-white/20 px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-white backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                onClick={openBankReconciliationModule}
              >
                <FaChartLine className="text-sky-300 text-xs" />
                Bank Reconciliation
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 hover:bg-white/20 px-4 sm:px-5 py-2.5 text-xs sm:text-sm font-bold text-white backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                onClick={openCustomerInvoicesPage}
              >
                <FaFileInvoiceDollar className="text-white/80 text-xs" />
                Customer Invoices
              </button>
            </div>

            {/* Live Filter Bar */}
            <div className="mt-4 pt-4 border-t border-white/15 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-center">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <FaSearch className="text-xs" />
                </span>
                <input
                  value={nameSearch}
                  onChange={(event) => setNameSearch(event.target.value)}
                  placeholder="Search name, number, amount, note or bill no..."
                  className="w-full rounded-full border border-white/20 bg-white/10 pl-9 pr-8 py-2.5 text-xs sm:text-sm text-white placeholder-slate-400 outline-none backdrop-blur-md focus:border-sky-400 focus:bg-white/15 transition-all"
                />
                {nameSearch && (
                  <button
                    type="button"
                    onClick={() => setNameSearch("")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <FaTimes className="text-xs" />
                  </button>
                )}
              </div>

              <div className="relative">
                <select
                  value={selectedPaymentMode}
                  onChange={(event) => setSelectedPaymentMode(event.target.value)}
                  className="w-full rounded-full border border-white/20 bg-slate-900 text-white pl-4 pr-9 py-2.5 text-xs sm:text-sm font-medium outline-none backdrop-blur-md focus:border-sky-400 transition-all cursor-pointer"
                >
                  {paymentModeOptions.map((mode) => (
                    <option key={mode} value={mode} className="bg-slate-900 text-white">
                      {mode === "all" ? "All Payment Modes" : `Filter: ${mode}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-1 flex flex-col items-stretch sm:items-end gap-2 text-xs text-slate-300">
                <div className="flex items-center justify-between gap-3 w-full">
                  <span className="text-slate-400 font-semibold uppercase tracking-wider">Active Mode</span>
                  <span className="rounded-full bg-sky-500/20 border border-sky-400/30 px-3 py-1 font-bold text-sky-200">
                    {selectedPaymentMode === "all" ? "All Modes" : selectedPaymentMode}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!String(nameSearch || "").trim()}
                  onClick={() => setShowCustomerHistory(true)}
                  title={String(nameSearch || "").trim() ? "Open complete history for the current search" : "Type a name or number in the search box to open a customer's complete history"}
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-sky-950/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:from-slate-500 disabled:to-slate-600 disabled:shadow-none disabled:hover:translate-y-0"
                >
                  <FaHistory className="text-xs" />
                  Complete History
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================
            PRIMARY FINANCIAL HEALTH KPIS (4 Authoritative Cards)
           ======================================================== */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          {[
            {
              label: "Total Income",
              value: formatINR(computedTotals.income),
              icon: FaMoneyBillWave,
              tone: "text-emerald-600",
              bg: "bg-emerald-50 border-emerald-100",
              iconColor: "text-emerald-600",
              subnote: "All verified inflows & collections",
            },
            {
              label: "Total Expense",
              value: formatINR(computedTotals.expense),
              icon: FaReceipt,
              tone: "text-rose-600",
              bg: "bg-rose-50 border-rose-100",
              iconColor: "text-rose-600",
              subnote: "All operational outflows & payouts",
            },
            {
              label: "Net Profit",
              value: formatINR(computedTotals.net),
              icon: FaWallet,
              tone: computedTotals.net >= 0 ? "text-blue-700" : "text-rose-600",
              bg: "bg-blue-50 border-blue-100",
              iconColor: "text-blue-700",
              subnote: `Carry-forward balance: ${formatINR(dailyBreakdown.remainingIncome)}`,
            },
            {
              label: "GST Payable",
              value: formatINR(totals.gstPayable),
              icon: FaReceipt,
              tone: "text-amber-600",
              bg: "bg-amber-50 border-amber-100",
              iconColor: "text-amber-600",
              subnote: "Net GST tax liability",
            },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                      {kpi.label}
                    </div>
                    <div className={`mt-2 text-2xl sm:text-3xl font-black tracking-tight ${kpi.tone}`}>
                      {kpi.value}
                    </div>
                  </div>
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${kpi.bg}`}>
                    <Icon className={`text-lg ${kpi.iconColor}`} />
                  </div>
                </div>
                <div className="mt-2.5 text-xs text-slate-500 font-medium">{kpi.subnote}</div>
              </div>
            );
          })}
        </section>

        {/* ========================================================
            OPERATIONAL PULSE & SUMMARY STATS
           ======================================================== */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          {[
            {
              label: "Selected Payment Mode",
              value: selectedPaymentMode === "all" ? "All Modes" : selectedPaymentMode,
              note: "Live filter applied across transaction and invoice sections.",
              tone: "text-slate-800",
            },
            {
              label: "Payment Entries",
              value: String(paymentModeSummary.recordsCount),
              note: `${formatINR(paymentModeSummary.recordsAmount)} recorded in accounts and hotel payment logs.`,
              tone: "text-emerald-700",
            },
            {
              label: "Billing Records",
              value: String(paymentModeSummary.invoiceCount),
              note: `${formatINR(paymentModeSummary.invoiceAmount)} linked to hotel, restaurant, and banquet billing.`,
              tone: "text-blue-700",
            },
            {
              label: "Combined Payment Amount",
              value: formatINR(paymentModeSummary.combinedAmount),
              note: `${paymentModeSummary.combinedCount} payment rows for the current mode.`,
              tone: "text-indigo-700",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {item.label}
              </div>
              <div className={`mt-1 text-xl sm:text-2xl font-black ${item.tone}`}>
                {item.value}
              </div>
              <div className="mt-1 text-xs text-slate-500 leading-snug">
                {item.note}
              </div>
            </div>
          ))}
        </section>

        {/* Today's Activity Pulse Bar */}
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="font-bold text-slate-800">Today's Pulse:</span>
            <span className="text-slate-500">
              {todayStats.count ? `${todayStats.count} transaction${todayStats.count === 1 ? "" : "s"} logged today` : "No transactions logged yet today"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">Total:</span>
              <span className="font-bold text-slate-900">{formatINR(todayStats.total)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-500 font-bold">In:</span>
              <span className="font-bold text-emerald-600">+{formatINR(todayStats.income)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-rose-500 font-bold">Out:</span>
              <span className="font-bold text-rose-600">-{formatINR(todayStats.expense)}</span>
            </div>
          </div>
        </div>

        {/* ========================================================
            DEDICATED TABLE SELECTOR (Focus on 1 active table at a time)
           ======================================================== */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {[
              { id: "ledger", label: "Accounts Ledger", count: searchFilteredGroupedTransactions.length },
              { id: "daily", label: "Daily Income Breakdown", count: dailyBreakdown.rows.length },
              { id: "billing", label: "Customer Billing", count: searchFilteredBillingRecords.length },
              { id: "centers", label: "Profit Centers", count: (extendedSummary.profitCenters || []).length },
              { id: "payments", label: "Payment History", count: paymentHistory.length },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveViewSection(tab.id)}
                className={`rounded-full px-4 py-2 text-xs sm:text-sm font-bold transition-all duration-150 flex items-center gap-2 ${
                  activeViewSection === tab.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                      activeViewSection === tab.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setActiveViewSection((prev) => (prev === "all" ? "ledger" : "all"))}
            className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors px-2 py-1"
          >
            {activeViewSection === "all" ? "← Focus on Single Table" : "View All Stacked ↓"}
          </button>
        </div>

        {/* Daily Carry-Forward Breakdown */}
        {(activeViewSection === "all" || activeViewSection === "daily") && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-xs">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Cash Flow Continuity
                </div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                  Daily Income Breakdown
                </h3>
                <div className="text-xs sm:text-sm font-medium text-slate-500">
                  Remaining balance is automatically carried forward day-over-day
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {dailyBreakdown.rows.length} day{dailyBreakdown.rows.length !== 1 ? "s" : ""} tracked
              </div>
            </div>

            {dailyBreakdown.rows.length === 0 ? (
              <div className="py-12 text-center text-sm font-medium text-slate-400">
                No transaction records available for daily breakdown.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                <table className="min-w-full text-left text-xs sm:text-sm">
                  <thead className="bg-slate-900 text-slate-200 uppercase tracking-wider text-[11px] font-bold">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">New Income</th>
                      <th className="px-4 py-3 text-right">Carried Fwd</th>
                      <th className="px-4 py-3 text-right">Total Income</th>
                      <th className="px-4 py-3 text-right">Expense</th>
                      <th className="px-4 py-3 text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dailyBreakdown.rows.map((row, idx) => {
                      const remainingPositive = row.remaining > 0;
                      const isLoss = row.remaining < 0;
                      const remainingColor = isLoss
                        ? "text-rose-600"
                        : remainingPositive
                          ? "text-emerald-600"
                          : "text-slate-400";
                      const carriedColor = row.carriedForward > 0 ? "text-amber-600" : "text-slate-400";

                      return (
                        <tr
                          key={row.date}
                          className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                            idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                          }`}
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-800">
                            {formatDayDate(row.date)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-600">
                            {formatINR(row.newIncome)}
                          </td>
                          <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${carriedColor}`}>
                            {row.carriedForward > 0 ? `+${formatINR(row.carriedForward)}` : "--"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-900">
                            {formatINR(row.totalIncome)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-500">
                            {formatINR(row.expense)}
                          </td>
                          <td className={`whitespace-nowrap px-4 py-3 text-right font-black ${remainingColor}`}>
                            {isLoss ? "-" : ""}{formatINR(Math.abs(row.remaining))}
                            {remainingPositive && (
                              <span className="ml-1 text-[10px] font-semibold text-emerald-500">&#8599;</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Accounts Ledger */}
        {(activeViewSection === "all" || activeViewSection === "ledger") && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-xs">
            {/* Ledger Header & Search */}
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Transactions & Reconciliation
                </div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                  Accounts Ledger
                </h3>
                <div className="text-xs sm:text-sm font-medium text-slate-500">
                  All income and expense transactions grouped by name
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full sm:w-72">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <input
                    value={nameSearch}
                    onChange={(event) => setNameSearch(event.target.value)}
                    placeholder="Search by name, number, amount or note..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-8 py-2 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                  {nameSearch && (
                    <button
                      type="button"
                      onClick={() => setNameSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {paginatedTransactionRecords.length} group{paginatedTransactionRecords.length !== 1 ? "s" : ""} shown
                </div>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-slate-200 uppercase tracking-wider text-[11px] font-bold">
                  <tr>
                    <th className="px-4 py-3 font-bold">Name / Description</th>
                    <th className="px-4 py-3 font-bold">Narration</th>
                    <th className="px-4 py-3 font-bold">Customer / Mobile</th>
                    <th className="px-4 py-3 font-bold">Type</th>
                    <th className="px-4 py-3 font-bold text-right">Income</th>
                    <th className="px-4 py-3 font-bold text-right">Expense</th>
                    <th className="px-4 py-3 font-bold text-right">Net</th>
                    <th className="px-4 py-3 font-bold text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedTransactionRecords.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <div className="text-sm font-medium text-slate-400">
                          No manual income/expense entries match this search.
                        </div>
                        {searchTerm && (
                          <div className="mt-2 text-xs text-slate-500">
                            <span className="font-semibold text-slate-700">"{nameSearch}"</span> may
                            belong to a booking/invoice instead of the ledger.
                            <button
                              type="button"
                              onClick={() => setActiveViewSection("billing")}
                              className="ml-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              Check Customer Billing ({searchFilteredBillingRecords.length})
                              <FaArrowRight className="text-[10px]" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    paginatedTransactionRecords.map((group) => {
                      const isOpen = expandedGroups[group.key];
                      return (
                        <React.Fragment key={group.key}>
                          <tr className="bg-slate-50/70 border-t border-slate-200">
                            <td colSpan={8} className="px-4 py-2.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(group.key)}
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 transition-colors"
                                    aria-label={isOpen ? "Collapse group" : "Expand group"}
                                  >
                                    {isOpen ? "−" : "+"}
                                  </button>
                                  <span className="text-sm font-black text-slate-900">
                                    {group.name}
                                  </span>
                                  <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                    {group.records.length} record{group.records.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs font-semibold">
                                  {group.income > 0 && (
                                    <span className="text-emerald-600 font-bold">+{formatINR(group.income)}</span>
                                  )}
                                  {group.expense > 0 && (
                                    <span className="text-rose-500 font-bold">-{formatINR(group.expense)}</span>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>

                          {/* Group Summary Row */}
                          <tr className="transition-colors hover:bg-slate-50/50">
                            <td className="px-4 py-3 pl-12 text-xs text-slate-400 font-medium">Summary Group</td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {(() => {
                                const notes = getGroupNarrations(group);
                                if (notes.length === 0) return null;
                                const shown =
                                  notes.length > 2
                                    ? `${notes.slice(0, 2).join(" • ")} (+${notes.length - 2} more)`
                                    : notes.join(" • ");
                                return (
                                  <span title={notes.join("\n")} className="cursor-help">
                                    {shown}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600">
                              {getGroupCustomer(group) || "--"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {group.income > 0 && (
                                  <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200/60">
                                    Income
                                  </span>
                                )}
                                {group.expense > 0 && (
                                  <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200/60">
                                    Expense
                                  </span>
                                )}
                                {group.income === 0 && group.expense === 0 && (
                                  <span className="text-xs text-slate-400">None</span>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-600">
                              {group.income > 0 ? formatINR(group.income) : "--"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-500">
                              {group.expense > 0 ? formatINR(group.expense) : "--"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-black text-slate-900">
                              {formatINR(group.income - group.expense)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-wrap justify-center gap-1.5">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                                  onClick={() => handlePrintGroup(group)}
                                  title="Print this group"
                                >
                                  <FaPrint className="text-[10px]" />
                                  Print
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
                                  onClick={() => toggleGroup(group.key)}
                                >
                                  {isOpen ? "Hide Items" : "View Items"}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Child Rows */}
                          {isOpen ? (
                            group.records.map((r) => (
                              <tr key={r.id} className="border-t border-slate-100 bg-slate-50/30 transition-colors hover:bg-blue-50/30">
                                <td className="pl-12 pr-4 py-2.5 font-medium text-slate-700">
                                  <span className="mr-2 text-slate-300">↳</span>
                                  {r.description}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-slate-500">
                                  {r.narration ? (
                                    <span title={r.narration} className="block break-words">{r.narration}</span>
                                  ) : (
                                    "--"
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-slate-500">
                                  {r.customerMobile || r.customerName || "--"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                    r.type === "Income"
                                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                                      : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60"
                                  }`}>
                                    {r.type}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-emerald-600">
                                  {r.type === "Income" ? formatINR(r.amount) : "--"}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-rose-500">
                                  {r.type === "Expense" ? formatINR(r.amount) : "--"}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-right font-black text-slate-900">
                                  {formatINR(r.type === "Income" ? r.amount : -r.amount)}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      type="button"
                                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 shadow-2xs transition-colors"
                                      onClick={() => {
                                        setSelectedRecord(r);
                                        setShowView(true);
                                      }}
                                    >
                                      View
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 shadow-2xs transition-colors"
                                      onClick={() => handleEditClick(r)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-100 shadow-2xs transition-colors"
                                      onClick={() => handleDeleteTransaction(r.id)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : null}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="space-y-3 md:hidden">
              {paginatedTransactionRecords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-400">
                  No transaction records match the selected payment mode.
                </div>
              ) : (
                paginatedTransactionRecords.map((group) => {
                  const isOpen = expandedGroups[group.key];
                  return (
                    <div key={group.key} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.key)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-xs font-bold text-slate-700"
                          >
                            {isOpen ? "−" : "+"}
                          </button>
                          <div>
                            <div className="text-sm font-bold text-slate-900">{group.name}</div>
                            <div className="text-[11px] text-slate-400">
                              {group.records.length} record{group.records.length !== 1 ? "s" : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePrintGroup(group)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700"
                            title="Print"
                          >
                            <FaPrint className="text-[10px]" />
                          </button>
                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-900">
                              {formatINR(group.income - group.expense)}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                              {group.income > 0 && <span className="text-emerald-600">+{formatINR(group.income)}</span>}
                              {group.expense > 0 && <span className="text-rose-500">-{formatINR(group.expense)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          {group.records.map((r) => (
                            <div key={r.id} className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  r.type === "Income"
                                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60"
                                }`}>
                                  {r.type}
                                </span>
                                <span className="text-xs font-black text-slate-900">{formatINR(r.amount)}</span>
                              </div>
                              <div className="mt-2 space-y-1 text-xs text-slate-600">
                                <div><span className="font-semibold text-slate-400">Desc:</span> {r.description}</div>
                                {r.narration && <div><span className="font-semibold text-slate-400">Note:</span> {r.narration}</div>}
                                {(r.customerMobile || r.customerName) && (
                                  <div><span className="font-semibold text-slate-400">Customer:</span> {r.customerMobile || r.customerName}</div>
                                )}
                                <div className="flex items-center justify-between text-[11px] text-slate-400">
                                  <span>{r.date}</span>
                                  <span>{r.paymentMode}</span>
                                </div>
                              </div>
                              <div className="mt-2.5 flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="flex-1 rounded-md border border-slate-200 bg-white py-1 text-center text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
                                  onClick={() => {
                                    setSelectedRecord(r);
                                    setShowView(true);
                                  }}
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="flex-1 rounded-md border border-blue-200 bg-blue-50 py-1 text-center text-xs font-bold text-blue-700 hover:bg-blue-100 shadow-2xs"
                                  onClick={() => handleEditClick(r)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="flex-1 rounded-md border border-rose-200 bg-rose-50 py-1 text-center text-xs font-bold text-rose-600 hover:bg-rose-100 shadow-2xs"
                                  onClick={() => handleDeleteTransaction(r.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Controls */}
            {searchFilteredGroupedTransactions.length > TRANSACTION_PAGE_SIZE && (
              <div className="mt-5 flex flex-col items-center gap-3 border-t border-slate-100 pt-4 md:flex-row md:justify-between">
                <div className="text-xs font-medium text-slate-500">
                  Showing <span className="font-bold text-slate-900">{(transactionPage - 1) * TRANSACTION_PAGE_SIZE + 1}</span> to{" "}
                  <span className="font-bold text-slate-900">{Math.min(transactionPage * TRANSACTION_PAGE_SIZE, searchFilteredGroupedTransactions.length)}</span> of{" "}
                  <span className="font-bold text-slate-900">{searchFilteredGroupedTransactions.length}</span> groups
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTransactionPage((current) => Math.max(1, current - 1))}
                    disabled={transactionPage === 1}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs transition-colors"
                  >
                    Previous
                  </button>

                  {Array.from({ length: transactionTotalPages }, (_, index) => {
                    const page = index + 1;
                    const isActive = page === transactionPage;
                    return (
                      <button
                        key={`transaction-page-${page}`}
                        type="button"
                        onClick={() => setTransactionPage(page)}
                        className={`h-7 min-w-[28px] rounded-lg px-2 text-xs font-bold transition-colors ${
                          isActive
                            ? "bg-slate-900 text-white shadow-xs"
                            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-2xs"
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setTransactionPage((current) => Math.min(transactionTotalPages, current + 1))}
                    disabled={transactionPage === transactionTotalPages}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Full Accounts Flow & Profit Centers */}
        {(activeViewSection === "all" || activeViewSection === "centers") && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-xs">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Full Accounts Flow
                </div>
                <h3 className="mt-1 text-lg sm:text-2xl font-black text-slate-900">
                  Extended accounts controls
                </h3>
                <p className="mt-2 text-xs sm:text-sm leading-relaxed text-slate-500">
                  Along with the existing transaction and invoice workflow, bank, petty cash, GST, vendor, purchase, payroll, and profit-center entries are also managed within this module.
                </p>
              </div>

              <div className="w-full lg:w-96 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 sm:p-5">
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Profit Center Net
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {(extendedSummary.profitCenters || []).length} Centers
                  </span>
                </div>
                <div className="mt-3 space-y-2 text-xs sm:text-sm">
                  {(extendedSummary.profitCenters || []).length ? (
                    extendedSummary.profitCenters.map((center) => (
                      <div key={center.centerName} className="flex items-center justify-between gap-3 py-1 border-b border-slate-100 last:border-b-0">
                        <span className="font-semibold text-slate-700">{center.centerName}</span>
                        <span className={`font-black ${center.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {formatINR(center.net)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-2 text-center text-xs font-medium text-slate-400">
                      No profit center breakdown yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Customer Billing Section */}
        {(activeViewSection === "all" || activeViewSection === "billing") && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-xs">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Revenue Channels
                </div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                  Customer Billing
                </h3>
                <p className="text-xs sm:text-sm font-medium text-slate-500">
                  Hotel bookings, invoices, restaurant bills and banquet records — with payment status.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                {combinedBillingRecords.length} record{combinedBillingRecords.length !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-slate-200 uppercase tracking-wider text-[11px] font-bold">
                  <tr>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Remaining</th>
                    <th className="px-4 py-3">Payment Mode</th>
                    <th className="px-4 py-3 text-center">Payment Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedBillingRecords.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-sm font-medium text-slate-400">
                        No billing records found.
                      </td>
                    </tr>
                  ) : (
                    paginatedBillingRecords.map((row, idx) => {
                      const payStatus = String(row.paymentStatus || "Pending");
                      const payCls =
                        payStatus === "Paid"
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                          : payStatus === "Partial"
                            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60"
                            : payStatus === "Generated"
                              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60"
                              : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60";
                      return (
                        <tr
                          key={row.id}
                          className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                            idx % 2 === 1 ? "bg-slate-50/40" : "bg-white"
                          }`}
                        >
                          <td className="px-4 py-3 font-bold text-slate-800">{row.source}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.reference}</td>
                          <td className="px-4 py-3 font-medium text-slate-700">{row.customerName}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{row.locationLabel}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{row.date}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-black text-slate-900">{formatINR(row.total)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-600">{formatINR(row.paidAmount)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-500">{formatINR(row.remainingAmount)}</td>
                          <td className="px-4 py-3 text-xs font-semibold text-slate-600">{row.paymentMode}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${payCls}`}>
                              {payStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="space-y-3 md:hidden">
              {paginatedBillingRecords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-400">
                  No billing records found.
                </div>
              ) : (
                paginatedBillingRecords.map((row) => {
                  const payStatus = String(row.paymentStatus || "Pending");
                  const payCls =
                    payStatus === "Paid"
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                      : payStatus === "Partial"
                        ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60"
                        : payStatus === "Generated"
                          ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60";
                  return (
                    <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
                      <div className="flex items-start justify-between gap-2.5">
                        <div>
                          <div className="text-sm font-bold text-slate-900">{row.billType}</div>
                          <div className="text-[11px] text-slate-400">{row.source} · {row.reference}</div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${payCls}`}>
                          {payStatus}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Customer</div>
                          <div className="font-medium text-slate-700 truncate">{row.customerName}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Location</div>
                          <div className="font-medium text-slate-700 truncate">{row.locationLabel}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</div>
                          <div className="font-black text-slate-900">{formatINR(row.total)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid</div>
                          <div className="font-semibold text-emerald-600">{formatINR(row.paidAmount)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Remaining</div>
                          <div className="font-semibold text-rose-500">{formatINR(row.remainingAmount)}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mode</div>
                          <div className="font-medium text-slate-700">{row.paymentMode}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Billing Pagination */}
            {combinedBillingRecords.length > BILLING_PAGE_SIZE && (
              <div className="mt-5 flex flex-col items-center gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-between">
                <div className="text-xs font-medium text-slate-500">
                  Showing <span className="font-bold text-slate-900">{(billingPage - 1) * BILLING_PAGE_SIZE + 1}</span> to{" "}
                  <span className="font-bold text-slate-900">{Math.min(billingPage * BILLING_PAGE_SIZE, combinedBillingRecords.length)}</span> of{" "}
                  <span className="font-bold text-slate-900">{combinedBillingRecords.length}</span> records
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBillingPage((current) => Math.max(1, current - 1))}
                    disabled={billingPage === 1}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs transition-colors"
                  >
                    Previous
                  </button>
                  {Array.from({ length: billingTotalPages }, (_, index) => {
                    const pageNumber = index + 1;
                    const isActive = pageNumber === billingPage;
                    return (
                      <button
                        key={`accounts-billing-page-${pageNumber}`}
                        type="button"
                        onClick={() => setBillingPage(pageNumber)}
                        className={`h-7 min-w-[28px] rounded-lg px-2 text-xs font-bold transition-colors ${
                          isActive
                            ? "bg-slate-900 text-white shadow-xs"
                            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-2xs"
                        }`}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setBillingPage((current) => Math.min(billingTotalPages, current + 1))}
                    disabled={billingPage >= billingTotalPages}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-2xs transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Payment History */}
        {(activeViewSection === "all" || activeViewSection === "payments") && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-xs">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Complete Payment Log
                </div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">
                  Payment History
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Every payment recorded in the system — verify any transaction by date, time, mode, and customer.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-3 py-1.5 text-xs font-bold text-sky-700">
                  Total: {formatINR(paymentHistory.reduce((sum, p) => sum + Number(p.amount || 0), 0))}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {paymentHistory.length} payment{paymentHistory.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200/80 md:block">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-900 text-slate-200 uppercase tracking-wider text-[11px] font-bold">
                  <tr>
                    <th className="px-4 py-3">Payment ID</th>
                    <th className="px-4 py-3">Booking ID</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Mobile</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Discount</th>
                    <th className="px-4 py-3">Payment Mode</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paymentHistory.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-sm font-medium text-slate-400">
                        No payment history found.
                      </td>
                    </tr>
                  ) : (
                    paymentHistory.map((payment) => {
                      const createdAt = new Date(payment.created_at);
                      const dateStr = createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                      const timeStr = createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                      const isCancelled = payment.status === "Cancelled";

                      return (
                        <tr key={payment.id} className={`transition-colors duration-150 ${isCancelled ? "bg-rose-50/40" : "hover:bg-blue-50/50"}`}>
                          <td className="px-4 py-3 font-bold text-slate-700">{payment.reference}</td>
                          <td className="px-4 py-3 text-slate-600">Booking #{payment.booking_id}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{payment.guest_name || "-"}</td>
                          <td className="px-4 py-3 text-slate-600">{payment.mobile || "-"}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">{formatINR(payment.amount)}</td>
                          <td className="px-4 py-3 text-right text-amber-600">{Number(payment.discount_amount) > 0 ? `-${formatINR(payment.discount_amount)}` : "-"}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                              {payment.payment_mode || "Cash"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                              isCancelled
                                ? "border border-rose-200 bg-rose-50 text-rose-600"
                                : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}>
                              {payment.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dateStr}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{timeStr}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="space-y-3 p-2.5 md:hidden">
              {paymentHistory.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  No payment history found.
                </div>
              ) : (
                paymentHistory.map((payment) => {
                  const createdAt = new Date(payment.created_at);
                  const dateStr = createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                  const timeStr = createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                  const isCancelled = payment.status === "Cancelled";

                  return (
                    <div key={payment.id} className={`rounded-2xl border p-4 ${isCancelled ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-sm font-black text-slate-900">{payment.reference}</span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          isCancelled
                            ? "border border-rose-200 bg-rose-50 text-rose-600"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}>
                          {payment.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13px]">
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Booking</span>
                        <span className="font-medium text-slate-700">Booking #{payment.booking_id}</span>
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Customer</span>
                        <span className="font-medium text-slate-700">{payment.guest_name || "-"}</span>
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Mobile</span>
                        <span className="font-medium text-slate-700">{payment.mobile || "-"}</span>
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Amount</span>
                        <span className="font-bold text-slate-900">{formatINR(payment.amount)}</span>
                        {Number(payment.discount_amount) > 0 && (
                          <>
                            <span className="font-semibold uppercase tracking-wide text-slate-400">Discount</span>
                            <span className="font-medium text-amber-600">-{formatINR(payment.discount_amount)}</span>
                          </>
                        )}
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Mode</span>
                        <span className="font-medium text-slate-700">{payment.payment_mode || "Cash"}</span>
                        <span className="font-semibold uppercase tracking-wide text-slate-400">Date</span>
                        <span className="font-medium text-slate-700">{dateStr} {timeStr}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        {showIncome && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs">
            <div className="accounts-form-modal relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
              <TransactionForm type="Income" onSubmit={handleAddIncome} onCancel={() => setShowIncome(false)} />
            </div>
          </div>
        )}

        {showExpense && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs">
            <div className="accounts-form-modal relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
              <TransactionForm type="Expense" onSubmit={handleAddExpense} onCancel={() => setShowExpense(false)} />
            </div>
          </div>
        )}

        {showInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-0 backdrop-blur-sm">
            <div className="h-[100dvh] w-[100vw] max-w-none overflow-auto rounded-[18px] bg-white shadow-[0_30px_90px_rgba(2,32,71,0.3)]">
              <InvoiceForm onSuccess={handleGenerateInvoice} onCancel={() => setShowInvoice(false)} />
            </div>
          </div>
        )}

        {showCustomerHistory && (
          <CustomerHistoryModal
            query={nameSearch}
            records={records}
            customerInvoices={customerInvoices}
            hotelBookings={hotelBookings}
            restaurantBills={restaurantBills}
            banquetBookings={banquetBookings}
            paymentHistory={paymentHistory}
            onClose={() => setShowCustomerHistory(false)}
          />
        )}

        {showView && selectedRecord && (
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm">
            <div className="w-full max-w-3xl overflow-hidden rounded-[24px] bg-white shadow-[0_30px_90px_rgba(2,32,71,0.3)] sm:rounded-[30px]">
              <div className="flex flex-col gap-3 border-b border-blue-50 bg-gradient-to-r from-blue-50 to-sky-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
                <div>
                  <h3 className="text-lg font-black text-slate-900 sm:text-xl">
                    {selectedBookingId
                      ? `Payments for Booking #${selectedBookingId}`
                      : "Record Details"}
                  </h3>
                  <p className="mt-1 text-[14px] text-slate-500 sm:text-[15px]">
                    {selectedBookingId
                      ? `All transactions, invoices, and payments linked to this booking.`
                      : "No booking id found on this record."}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowView(false);
                    setSelectedRecord(null);
                  }}
                  className="self-start rounded-full border border-blue-100 bg-white px-4 py-2 text-[14px] font-bold text-slate-700 transition-all duration-200 hover:bg-blue-50 sm:self-auto sm:text-[15px]"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-6 py-6 space-y-5">
                {selectedBookingId && bookingPaymentGroups.map((group) => (
                  <div key={group.bookingId} className="space-y-4">
                    <SummaryRow
                      label="Transaction Total"
                      value={formatINR(
                        group.transactions.reduce((sum, record) => sum + toNumber(record.amount), 0),
                      )}
                      tone="text-sky-700"
                    />
                    <SummaryRow
                      label="Invoice Total"
                      value={formatINR(
                        group.invoices.reduce((sum, invoice) => sum + toNumber(invoice.totalAmount || invoice.total_amount || invoice.final_total || 0), 0),
                      )}
                      tone="text-blue-700"
                    />
                    <SummaryRow
                      label="Booking Total"
                      value={formatINR(
                        group.hotelBookings.reduce((sum, booking) => sum + toNumber(booking.totalAmount || booking.total_amount || 0), 0),
                      )}
                      tone="text-blue-700"
                    />
                    <SummaryRow
                      label="Restaurant Bills"
                      value={formatINR(
                        group.restaurantBills.reduce((sum, bill) => sum + toNumber(bill.total || 0), 0),
                      )}
                      tone="text-amber-700"
                    />
                    <SummaryRow
                      label="Banquet Bookings"
                      value={formatINR(
                        group.banquetBookings.reduce((sum, booking) => sum + toNumber(booking.grand_total || booking.total || 0), 0),
                      )}
                      tone="text-purple-700"
                    />
                    {group.transactions.length > 0 && (
                      <div>
                        <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Account Transactions
                        </div>

                        {/* Desktop table (≥768px) */}
                        <div className="hidden md:block overflow-x-auto rounded-xl border border-blue-100/70">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-gradient-to-r from-blue-950 via-blue-800 to-sky-600 text-xs uppercase text-white">
                              <tr>
                                <th className="px-3 py-2">Date</th>
                                <th className="px-3 py-2">Type</th>
                                <th className="px-3 py-2">Description</th>
                                <th className="px-3 py-2">Amount</th>
                                <th className="px-3 py-2">Mode</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.transactions.map((record) => (
                                <tr key={record.id} className="border-t border-blue-50">
                                  <td className="px-3 py-2">{record.date}</td>
                                  <td className="px-3 py-2">{record.type}</td>
                                  <td className="px-3 py-2">{record.description}</td>
                                  <td className="px-3 py-2 font-semibold">{formatINR(record.amount)}</td>
                                  <td className="px-3 py-2">{record.paymentMode}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile cards (<768px) */}
                        <div className="space-y-2.5 md:hidden">
                          {group.transactions.map((record) => (
                            <div key={record.id} className="rounded-[18px] border border-blue-100/70 bg-white p-3.5 shadow-[0_8px_20px_-8px_rgba(30,64,175,0.12)]">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[12px] font-bold ${record.type === "Income" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-600"}`}>
                                  {record.type}
                                </span>
                                <span className="text-[14px] font-bold text-slate-900">{formatINR(record.amount)}</span>
                              </div>
                              <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                                <span className="font-semibold uppercase tracking-wide text-slate-400">Date</span>
                                <span className="font-medium text-slate-700">{record.date}</span>
                                <span className="font-semibold uppercase tracking-wide text-slate-400">Description</span>
                                <span className="font-medium text-slate-700">{record.description}</span>
                                <span className="font-semibold uppercase tracking-wide text-slate-400">Mode</span>
                                <span className="font-medium text-slate-700">{record.paymentMode}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {group.invoices.length > 0 && (
                      <div>
                        <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Linked Invoices
                        </div>

                        {/* Desktop table (≥768px) */}
                        <div className="hidden md:block overflow-x-auto rounded-xl border border-blue-100/70">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-gradient-to-r from-blue-950 via-blue-800 to-sky-600 text-xs uppercase text-white">
                              <tr>
                                <th className="px-3 py-2">Invoice</th>
                                <th className="px-3 py-2">Guest</th>
                                <th className="px-3 py-2">Room</th>
                                <th className="px-3 py-2">Total</th>
                                <th className="px-3 py-2">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.invoices.map((invoice) => (
                                <tr key={invoice.id} className="border-t border-blue-50">
                                  <td className="px-3 py-2">{invoice.invoice_no || `#${invoice.id}`}</td>
                                  <td className="px-3 py-2">{invoice.customer_name || invoice.guest_name || "-"}</td>
                                  <td className="px-3 py-2">{invoice.room_no || "-"}</td>
                                  <td className="px-3 py-2 font-semibold">{formatINR(invoice.totalAmount || invoice.total_amount || invoice.final_total || 0)}</td>
                                  <td className="px-3 py-2">
                                    {invoice.payment_status || invoice.status || "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile cards (<768px) */}
                        <div className="space-y-2.5 md:hidden">
                          {group.invoices.map((invoice) => (
                            <div key={invoice.id} className="rounded-[18px] border border-blue-100/70 bg-white p-3.5 shadow-[0_8px_20px_-8px_rgba(30,64,175,0.12)]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[14px] font-bold text-slate-900">{invoice.invoice_no || `#${invoice.id}`}</span>
                                <span className="text-[14px] font-bold text-blue-900">{formatINR(invoice.totalAmount || invoice.total_amount || invoice.final_total || 0)}</span>
                              </div>
                              <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                                <span className="font-semibold uppercase tracking-wide text-slate-400">Guest</span>
                                <span className="font-medium text-slate-700">{invoice.customer_name || invoice.guest_name || "-"}</span>
                                <span className="font-semibold uppercase tracking-wide text-slate-400">Room</span>
                                <span className="font-medium text-slate-700">{invoice.room_no || "-"}</span>
                                <span className="font-semibold uppercase tracking-wide text-slate-400">Status</span>
                                <span className="font-medium text-slate-700">{invoice.payment_status || invoice.status || "-"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {group.transactions.length === 0 && group.invoices.length === 0 && (
                      <div className="rounded-xl border border-dashed border-blue-100 bg-blue-50/50 px-4 py-6 text-center text-sm text-slate-500">
                        No transactions or invoices found for Booking #{group.bookingId}.
                      </div>
                    )}
                  </div>
                ))}
                {!selectedBookingId && (
                  <div className="rounded-xl border border-dashed border-blue-100 bg-blue-50/50 px-4 py-6 text-center text-sm text-slate-500">
                    Could not extract a booking id from this record. Showing raw details only.
                    <div className="mt-3 space-y-1 text-left">
                      <p><strong>Date:</strong> {selectedRecord.date}</p>
                      <p><strong>Type:</strong> {selectedRecord.type}</p>
                      <p><strong>Description:</strong> {selectedRecord.description}</p>
                      <p><strong>Customer:</strong> {selectedRecord.customerMobile || selectedRecord.customerName || "-"}</p>
                      <p><strong>Amount:</strong> {formatINR(selectedRecord.amount)}</p>
                      <p><strong>Payment Mode:</strong> {selectedRecord.paymentMode}</p>
                      <p><strong>Source Module:</strong> {selectedRecord.sourceModule || "-"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showEdit && editingRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs">
            <div className="accounts-form-modal relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
              <TransactionForm
                type={editingRecord.type}
                initialData={{
                  date: formatInputDate(editingRecord.date),
                  description: editingRecord.description || "",
                  narration: editingRecord.narration || "",
                  customerName: editingRecord.customerName || "",
                  customerMobile: editingRecord.customerMobile || "",
                  amount: editingRecord.amount || "",
                  paymentMode: editingRecord.paymentMode || "UPI",
                  department: editingRecord.department || (editingRecord.type === "Income" ? "Room" : "Other"),
                }}
                onSubmit={handleUpdateTransaction}
                onCancel={() => {
                  setShowEdit(false);
                  setEditingRecord(null);
                }}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Accounts;