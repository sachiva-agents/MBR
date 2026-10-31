import React, { useState } from "react";
import { FaTimes, FaArrowDown, FaArrowUp, FaEdit } from "react-icons/fa";
import { localDate } from "../../../utils/localDate";
import "./TransactionForm.css";

const todayISO = () => localDate();

// Quick-suggestion chips for Description / Party Name. Anything the resort
// buys or pays FOR from outside (vendors, market, services) is an expense
// that should be recordable in one tap — flower, grocery, beverages, etc.
const DESCRIPTION_SUGGESTIONS = {
  Expense: [
    "Vendor payment",
    "Kitchen purchase",
    "Room maintenance",
    "Electricity bill",
    "Staff expense",
    "Laundry expense",
    "Flower purchase",
    "Grocery & vegetables",
    "Beverages / soft drinks",
    "Cleaning supplies",
    "Stationery",
    "Fuel / transport",
  ],
  Income: [
    "Room booking payment",
    "Restaurant payment",
    "Advance received",
    "Banquet booking",
    "Invoice collection",
    "Settlement received",
    "Flower sales",
  ],
};

// Standard hotel departments — match the backend chart-of-accounts
// classification so a department picked here books to the right ledger
// account instead of the catch-all "Other Expenses".
const DEPARTMENT_OPTIONS = [
  "Hotel",
  "Restaurant",
  "Banquet",
  "Payroll",
  "Utilities",
  "Maintenance",
  "Office & Admin",
  "Marketing",
  "Other",
];

const TransactionForm = ({ type, onSubmit, onCancel, initialData = {} }) => {
  const [form, setForm] = useState({
    date: initialData.date || todayISO(),
    description: initialData.description || "",
    narration: initialData.narration || "",
    customerName: initialData.customerName || "",
    customerMobile: initialData.customerMobile || "",
    amount: initialData.amount ?? "",
    paymentMode: initialData.paymentMode || "UPI",
    department:
      initialData.department || (type === "Income" ? "Hotel" : "Other"),
  });
  const [errors, setErrors] = useState({});

  const isEdit = Boolean(initialData.description || initialData.amount);
  const isIncome = type === "Income";
  const suggestions = DESCRIPTION_SUGGESTIONS[type] || [];

  const title = isEdit
    ? "Edit transaction record"
    : type === "Expense"
    ? "Add expense record"
    : "Add income record";

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const amountNumber = Number(form.amount);
    const nextErrors = {};

    if (!form.description.trim()) {
      nextErrors.description = "Description / party name is required.";
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      nextErrors.amount = "Enter an amount greater than zero.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});

    onSubmit({
      type,
      date: form.date,
      description: form.description.trim(),
      narration: form.narration.trim() || undefined,
      customerName: form.customerName.trim() || undefined,
      customerMobile: form.customerMobile.trim() || undefined,
      amount: amountNumber,
      paymentMode: form.paymentMode,
      department: form.department,
      sourceModule: "accounts-manual",
    });
  };

  return (
    <form className="flex flex-col bg-white" onSubmit={handleSubmit}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isEdit
                ? "bg-blue-50 text-blue-600 border border-blue-100"
                : isIncome
                ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                : "bg-rose-50 text-rose-600 border border-rose-100"
            }`}
          >
            {isEdit ? (
              <FaEdit className="text-sm" />
            ) : isIncome ? (
              <FaArrowDown className="text-sm" />
            ) : (
              <FaArrowUp className="text-sm" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                {title}
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                  isIncome
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60"
                }`}
              >
                {type}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Saved directly to accounts ledger with automatic balance reconciliation.
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Close dialog"
          >
            <FaTimes className="text-sm" />
          </button>
        )}
      </div>

      {/* Form Body */}
      <div className="space-y-4 px-5 py-4 sm:px-6 max-h-[calc(90vh-140px)] overflow-y-auto">
        {/* Row 1: Date & Type */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="date">
              Transaction Date <span className="text-rose-500">*</span>
            </label>
            <input
              id="date"
              name="date"
              type="date"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={form.date}
              onChange={handleChange}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
              Entry Type
            </label>
            <div className="flex h-[38px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs sm:text-sm font-semibold text-slate-700">
              <span
                className={`mr-2 h-2 w-2 rounded-full ${
                  isIncome ? "bg-emerald-500" : "bg-rose-500"
                }`}
              />
              {type} ({isIncome ? "Cash Inflow" : "Cash Outflow"})
            </div>
          </div>
        </div>

        {/* Row 2: Description & Quick Suggestion Chips */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600" htmlFor="description">
              Description / Party Name <span className="text-rose-500">*</span>
            </label>
            <span className="text-[11px] text-slate-400">Quick suggestions:</span>
          </div>

          {/* Compact Suggestion Chips */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  form.description === suggestion
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                }`}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    description: suggestion,
                  }))
                }
              >
                {suggestion}
              </button>
            ))}
          </div>

          <input
            id="description"
            name="description"
            type="text"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            value={form.description}
            onChange={handleChange}
            placeholder="e.g. Room booking payment, Laundry, Vendor supply"
            list={`transaction-description-${type.toLowerCase()}`}
            required
            aria-invalid={Boolean(errors.description)}
          />
          {errors.description && (
            <p className="mt-1 text-[11px] font-semibold text-rose-600">{errors.description}</p>
          )}
          <datalist id={`transaction-description-${type.toLowerCase()}`}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        {/* Row 3: Amount & Payment Mode */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="amount">
              Amount (₹) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">
                ₹
              </span>
              <input
                id="amount"
                name="amount"
                type="number"
                className="w-full rounded-xl border border-slate-200 bg-white pl-7 pr-3 py-2 text-xs sm:text-sm font-bold text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={form.amount}
                onChange={handleChange}
                placeholder="0"
                min="1"
                step="any"
                required
                aria-invalid={Boolean(errors.amount)}
              />
            </div>
            {errors.amount && (
              <p className="mt-1 text-[11px] font-semibold text-rose-600">{errors.amount}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="paymentMode">
              Payment Mode
            </label>
            <select
              id="paymentMode"
              name="paymentMode"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer"
              value={form.paymentMode}
              onChange={handleChange}
            >
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="UPI">UPI</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cheque">Cheque</option>
            </select>
          </div>
        </div>

        {/* Row 4: Customer Details (Optional) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="customerName">
              Customer / Party Name
            </label>
            <input
              id="customerName"
              name="customerName"
              type="text"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={form.customerName}
              onChange={handleChange}
              placeholder="e.g. Rahul Sharma"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="customerMobile">
              Mobile Number
            </label>
            <input
              id="customerMobile"
              name="customerMobile"
              type="tel"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={form.customerMobile}
              onChange={handleChange}
              placeholder="e.g. 9876543210"
            />
          </div>
        </div>

        {/* Row 5: Department */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="department">
            Department Center
          </label>
          <select
            id="department"
            name="department"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer"
            value={form.department}
            onChange={handleChange}
          >
            {DEPARTMENT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {/* Row 6: Narration */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1" htmlFor="narration">
            Narration / Reference Notes
          </label>
          <textarea
            id="narration"
            name="narration"
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-y"
            value={form.narration}
            onChange={handleChange}
            placeholder="Add invoice reference, remarks, or reconciliation notes..."
          />
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/70 px-5 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 shadow-2xs transition-colors"
        >
          Cancel
        </button>

        <button
          type="submit"
          className={`rounded-xl px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-xs transition-all ${
            isIncome
              ? "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
              : "bg-rose-600 hover:bg-rose-700 active:bg-rose-800"
          }`}
        >
          {isEdit ? "Update Entry" : isIncome ? "Save Income" : "Save Expense"}
        </button>
      </div>
    </form>
  );
};

export default TransactionForm;
