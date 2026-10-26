import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaCheckCircle, FaExclamationCircle } from "react-icons/fa";

import API from "../api";

const ACCOUNTS_MODULE_PAGE_SIZE = 10;

const formatINR = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);

const formatInputDate = (value) => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : text;
};

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-200";

const renderBankLedgerValue = (value, key) => {
  if (key === "credit" || key === "debit") {
    return formatINR(value);
  }
  return value || "-";
};

const ReconciliationDataModuleCard = ({
  title,
  subtitle,
  fields,
  rows,
  columns,
  submitLabel,
  editLabel,
  onSubmit,
  onUpdate,
  onDelete,
  toFormState,
}) => {
  const initialState = useMemo(
    () =>
      fields.reduce((acc, field) => {
        acc[field.name] = field.defaultValue ?? "";
        return acc;
      }, {}),
    [fields],
  );
  const [form, setForm] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [page, setPage] = useState(1);
  const [showFormModal, setShowFormModal] = useState(false);
  const totalPages = Math.max(1, Math.ceil((rows || []).length / ACCOUNTS_MODULE_PAGE_SIZE));
  const paginatedRows = (rows || []).slice(
    (page - 1) * ACCOUNTS_MODULE_PAGE_SIZE,
    page * ACCOUNTS_MODULE_PAGE_SIZE,
  );

  useEffect(() => {
    if (!editingId) {
      setForm(initialState);
    }
  }, [editingId, initialState]);

  useEffect(() => {
    setPage(1);
  }, [rows]);

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
      setShowFormModal(false);
    }
    setSaving(false);
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(initialState);
    setShowFormModal(true);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm(toFormState(row));
    setShowFormModal(true);
  };

  const handleDeleteClick = async (row) => {
    const confirmed = window.confirm(`Delete this ${title.toLowerCase()} record?`);
    if (!confirmed) return;

   const success = await onDelete(row.id);
    if (!success) return;
 
     if (editingId === row.id) {
       setEditingId(null);
       setForm(initialState);
     }
   };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingId(null);
    setForm(initialState);
    setFieldErrors({});
  };

  return (
    <div className="rounded-[24px] border border-white/60 bg-white/82 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-base font-bold uppercase tracking-[0.18em] text-cyan-700">
            Reconciliation Data
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">{title}</div>
          <div className="mt-2 text-lg font-medium leading-7 text-slate-500">{subtitle}</div>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-5 py-3 text-base font-bold text-cyan-700 transition hover:border-cyan-300 hover:bg-cyan-100"
        >
          Form Filling
        </button>
      </div>

      <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-base text-slate-600">
        Form popup me open hoga aur saved reconciliation data neeche table me show hota rahega.
      </div>

      {showFormModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-[28px] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-base font-bold uppercase tracking-[0.18em] text-cyan-700">
                  Reconciliation Data
                </div>
                <h3 className="mt-2 text-3xl font-black text-slate-900">
                  {editingId ? editLabel || "Update Entry" : "Form Filling"}
                </h3>
                <p className="mt-2 text-lg text-slate-500">{subtitle}</p>
              </div>

              <button
                type="button"
                onClick={closeFormModal}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
              {fields.map((field) => {
                const isWideField =
                  field.type === "textarea" || field.name === "description" || field.name === "notes";

                return (
                  <label key={field.name} className={isWideField ? "block md:col-span-2" : "block"}>
                    <span className="mb-2 block text-base font-bold uppercase tracking-[0.14em] text-slate-500">
                      {field.label}
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
                        rows={3}
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
                      <p className="mt-1 text-sm font-semibold text-rose-600">{fieldErrors[field.name]}</p>
                    )}
                  </label>
                );
              })}

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 px-5 py-3 text-lg font-bold text-white disabled:opacity-60 md:col-span-2"
              >
                {saving ? "Saving..." : editingId ? editLabel || "Update Entry" : submitLabel}
              </button>

              <button
                type="button"
                onClick={closeFormModal}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-lg font-bold text-slate-700 md:col-span-2"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto rounded-[18px] border border-slate-200">
        <table className="min-w-full text-left text-lg">
          <thead className="bg-slate-50 text-lg font-bold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-4">
                  {column.label}
                </th>
              ))}
              <th className="px-3 py-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row) => (
              <tr key={row.id} className="border-t border-slate-200">
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-4 text-lg font-semibold text-slate-700">
                    {renderBankLedgerValue(row[column.key], column.key)}
                  </td>
                ))}
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(row)}
                      className="rounded-full border border-cyan-200 bg-cyan-50 px-5 py-2.5 text-lg font-bold text-cyan-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(row)}
                      className="rounded-full border border-rose-200 bg-rose-50 px-5 py-2.5 text-lg font-bold text-rose-700"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!rows?.length ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-8 text-center text-xl font-medium text-slate-500"
                >
                  No records yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {(rows || []).length > ACCOUNTS_MODULE_PAGE_SIZE ? (
        <div className="mt-4 flex flex-col gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-lg font-medium text-slate-500">
            Showing{" "}
            <span className="font-semibold text-slate-900">
              {(page - 1) * ACCOUNTS_MODULE_PAGE_SIZE + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-slate-900">
              {Math.min(page * ACCOUNTS_MODULE_PAGE_SIZE, (rows || []).length)}
            </span>{" "}
            of <span className="font-semibold text-slate-900">{(rows || []).length}</span> records
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-lg font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, index) => {
              const pageNumber = index + 1;
              const isActive = pageNumber === page;

              return (
                <button
                  key={`bank-ledger-page-${pageNumber}`}
                  type="button"
                  onClick={() => setPage(pageNumber)}
                  className={`h-11 min-w-[44px] rounded-full border px-3 text-lg font-bold transition ${
                    isActive
                      ? "border-cyan-600 bg-cyan-600 text-white shadow-[0_10px_24px_rgba(8,145,178,0.18)]"
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
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-lg font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const ReconciliationDataPage = () => {
  const navigate = useNavigate();
  const refreshTimerRef = useRef(null);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const toastTimerRef = useRef(null);
  const [bankLedger, setBankLedger] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (message, tone = "success") => {
    setToast({ message, tone });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const isAbortedRequest = (error) =>
    error?.code === "ERR_CANCELED" ||
    error?.message === "canceled" ||
    error?.message === "Request aborted" ||
    error?.name === "CanceledError";

  const bankLedgerFields = [
    { name: "entryDate", label: "Entry Date", type: "date", required: true },
    { name: "bankName", label: "Bank Name", required: true },
    { name: "bankAccount", label: "Bank Account" },
    { name: "referenceNo", label: "Reference No" },
    { name: "description", label: "Description", required: true },
    {
      name: "paymentMode",
      label: "Payment Mode",
      type: "select",
      defaultValue: "Bank Transfer",
      options: ["Bank Transfer", "UPI", "Card", "Cheque", "Cash", "Manual"],
    },
    { name: "amount", label: "Amount", type: "number", defaultValue: 0 },
    {
      name: "direction",
      label: "Direction",
      type: "select",
      defaultValue: "in",
      options: ["in", "out"],
    },
    { name: "debit", label: "Debit", type: "number", defaultValue: 0 },
    { name: "credit", label: "Credit", type: "number", defaultValue: 0 },
    {
      name: "sourceType",
      label: "Source Type",
      type: "select",
      defaultValue: "",
      options: ["", "invoice", "restaurant_bill", "vendor_payment"],
    },
    { name: "sourceId", label: "Source ID", type: "number" },
    {
      name: "reconciliationStatus",
      label: "Status",
      type: "select",
      required: true,
      defaultValue: "Pending",
      options: ["Pending", "Paid", "Reconciled", "Mismatch"],
    },
    {
      name: "matchStatus",
      label: "Match Status",
      type: "select",
      defaultValue: "unmatched",
      options: ["unmatched", "partial", "matched", "reconciled"],
    },
    { name: "statementRef", label: "Statement Ref" },
    { name: "statementDate", label: "Statement Date", type: "date" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  const bankLedgerColumns = [
    { key: "entry_date", label: "Date" },
    { key: "bank_name", label: "Bank" },
    { key: "payment_mode", label: "Payment Mode" },
    { key: "reconciliation_status", label: "Status" },
    { key: "match_status", label: "Match" },
    { key: "credit", label: "Credit" },
    { key: "debit", label: "Debit" },
  ];

  const fetchBankLedger = async () => {
    try {
      const res = await API.get("/accounts/bank-ledger");
      setBankLedger(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      if (isAbortedRequest(error)) return;
      console.error("Error loading bank ledger", error);
      setBankLedger([]);
    }
  };

  const refreshData = async () => {
    if (refreshInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;

    try {
      do {
        pendingRefreshRef.current = false;
        await fetchBankLedger();
      } while (pendingRefreshRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    let active = true;

    const runRefresh = async () => {
      if (!active) return;
      await refreshData();
    };

    runRefresh();

    const handleAccountsUpdated = () => {
      runRefresh();
    };

    refreshTimerRef.current = window.setInterval(() => {
      runRefresh();
    }, 30000);

    window.addEventListener("accountsUpdated", handleAccountsUpdated);
    window.addEventListener("focus", handleAccountsUpdated);

    return () => {
      active = false;
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      window.removeEventListener("accountsUpdated", handleAccountsUpdated);
      window.removeEventListener("focus", handleAccountsUpdated);
    };
  }, []);

  const createBankLedgerEntry = async (form) => {
    try {
      await API.post("/accounts/bank-ledger", form);
      await refreshData();
      window.dispatchEvent(new Event("accountsUpdated"));
      showToast("Bank entry saved");
      return true;
    } catch (error) {
      console.error("Error saving bank ledger", error);
      showToast(error.response?.data?.message || "Bank entry could not be saved.", "error");
      return false;
    }
  };

  const updateBankLedgerEntry = async (id, form) => {
    try {
      await API.put(`/accounts/bank-ledger/${id}`, form);
      await refreshData();
      window.dispatchEvent(new Event("accountsUpdated"));
      showToast("Bank entry updated");
      return true;
    } catch (error) {
      console.error("Error updating bank ledger", error);
      showToast(error.response?.data?.message || "Bank entry update failed.", "error");
      return false;
    }
  };

  const deleteBankLedgerEntry = async (id) => {
    try {
      await API.delete(`/accounts/bank-ledger/${id}`);
      await refreshData();
      window.dispatchEvent(new Event("accountsUpdated"));
      showToast("Bank entry deleted");
      return true;
    } catch (error) {
      console.error("Error deleting bank ledger", error);
      showToast(error.response?.data?.message || "Bank entry delete failed.", "error");
      return false;
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#f5fbff_0%,#f3f8f4_28%,#fff8f1_58%,#f8fafc_100%)] p-4 sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-8%] top-[-6%] h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl sm:h-96 sm:w-96" />
        <div className="absolute right-[-10%] top-[8%] h-72 w-72 rounded-full bg-amber-200/45 blur-3xl sm:h-[28rem] sm:w-[28rem]" />
      </div>

      {toast && (
        <div className={`fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold shadow-2xl transition-all duration-300 ${toast.tone === "error" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}>
          <span className="inline-flex items-center gap-2">
            {toast.tone === "error" ? <FaExclamationCircle /> : <FaCheckCircle />}
            {toast.message}
          </span>
        </div>
      )}

      <div className="space-y-7">
        <section className="overflow-hidden rounded-[28px] border border-slate-900/10 bg-[linear-gradient(120deg,#071b34_0%,#0d4a53_52%,#162d45_100%)] px-5 py-6 text-white shadow-[0_22px_55px_rgba(15,23,42,0.12)] sm:px-7 sm:py-8">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-cyan-200">
              Finance Center
            </p>
            <h1 className="text-4xl font-black leading-tight sm:text-5xl">
              Reconciliation data workspace
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-100/85 sm:text-xl">
              Bank reconciliation ka form popup se fill karein aur neeche saved reconciliation data
              ko table format me review karein.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/accounts/bank-reconciliation")}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-base font-bold text-slate-900 shadow-[0_16px_35px_rgba(255,255,255,0.15)]"
              >
                <FaArrowLeft className="text-cyan-600" />
                Back To Bank Reconciliation
              </button>
            </div>
          </div>
        </section>

        <ReconciliationDataModuleCard
          title="Bank Reconciliation Data"
          subtitle="Track the daily bank ledger and reconciliation status from a separate page."
          fields={bankLedgerFields}
          rows={bankLedger}
          columns={bankLedgerColumns}
          submitLabel="Add Bank Entry"
          editLabel="Update Bank Entry"
          onSubmit={createBankLedgerEntry}
          onUpdate={updateBankLedgerEntry}
          onDelete={deleteBankLedgerEntry}
          toFormState={(row) => ({
            entryDate: formatInputDate(row.entry_date),
            bankName: row.bank_name || "",
            bankAccount: row.bank_account || "",
            referenceNo: row.reference_no || "",
            description: row.description || "",
            paymentMode: row.payment_mode || "Bank Transfer",
             amount: row.amount ?? row.credit ?? row.debit ?? 0,
            direction: row.direction || (Number(row.debit || 0) > 0 ? "out" : "in"),
            debit: row.debit || 0,
            credit: row.credit || 0,
            sourceType: row.source_type || "",
            sourceId: row.source_id || "",
            reconciliationStatus: row.reconciliation_status || "Pending",
            matchStatus: row.match_status || "unmatched",
            statementRef: row.statement_ref || "",
            statementDate: formatInputDate(row.statement_date),
            notes: row.notes || "",
          })}
        />
      </div>
    </div>
  );
};

export default ReconciliationDataPage;
