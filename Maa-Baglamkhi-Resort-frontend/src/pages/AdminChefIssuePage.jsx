import React, { useEffect, useMemo, useState } from "react";
import {
  FaBoxOpen, FaClipboardCheck, FaHandHolding, FaSearch, FaSyncAlt,
  FaUndo, FaUsers, FaCheckCircle, FaHourglassHalf, FaTimes, FaChartPie,
} from "react-icons/fa";
import chefService from "../services/chefService";
import { getUserFromStorage } from "../utils/authStorage";

function StatusBadge({ status }) {
  const map = {
    issued: { label: "Issued", classes: "bg-amber-100 text-amber-700 border-amber-200", Icon: FaHourglassHalf },
    partially_returned: { label: "Partially Returned", classes: "bg-cyan-100 text-cyan-700 border-cyan-200", Icon: FaUndo },
    fully_returned: { label: "Fully Returned", classes: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: FaCheckCircle },
  };
  const cfg = map[status] || { label: status || "—", classes: "bg-slate-100 text-slate-600", Icon: FaHourglassHalf };
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold xl:px-3 xl:py-1 xl:text-[15px] ${cfg.classes}`}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
}

function Field({ label, required, children, full = false }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wider text-slate-600 xl:mb-2 xl:text-[17px]">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

// Small label/value pair used inside the mobile stacked cards.
function CardStat({ label, value, full = false }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-[14px] font-semibold text-slate-800">{value || "—"}</p>
    </div>
  );
}

const RECORDS_PER_PAGE = 10;

// Windowed page list: 1 … (around current) … last — like the User page.
function buildPageItems(current, total) {
  if (total <= 1) return total ? [1] : [];
  const items = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push("start-ellipsis");
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < total - 1) items.push("end-ellipsis");
  if (total > 1) items.push(total);
  return items;
}

function PaginationBar({ current, total, pages, onPageChange, shownFrom, shownTo, totalRecords }) {
  if (!total) return null;
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-4 sm:flex-row">
      <p className="text-[13px] font-medium text-slate-500 xl:text-[15px]">
        Showing {shownFrom} to {shownTo} of {totalRecords} records
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 xl:text-[15px]"
        >
          Previous
        </button>
        {pages.map((item, idx) =>
          item === "start-ellipsis" || item === "end-ellipsis" ? (
            <span key={item} className="px-1 text-[13px] text-slate-400">…</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={`h-8 w-8 rounded-full text-[13px] font-bold transition xl:h-9 xl:w-9 xl:text-[15px] ${
                item === current
                  ? "bg-indigo-600 text-white shadow-[0_6px_14px_rgba(99,102,241,0.35)]"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          disabled={current >= total}
          onClick={() => onPageChange(current + 1)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 xl:text-[15px]"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function AdminChefIssuePage() {
  const user = getUserFromStorage() || {};
  const adminName = user?.username || user?.name || user?.fullName || "Admin";

  const [items, setItems] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Issue-to-chef form (admin can push raw material to any chef) ──────────
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueDraft, setIssueDraft] = useState({
    itemId: "", itemName: "", quantityIssued: "", unit: "",
    chefName: "", chefId: "", purpose: "", remarks: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // ── Filters ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterChef, setFilterChef] = useState("");

  // ── Pagination ─────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);

  // ── Return modal (admin can reconcile a return on behalf of any chef) ────
  const [returnModal, setReturnModal] = useState(null); // { id, itemName, chefName, max }
  const [returnForm, setReturnForm] = useState({ quantityReturned: "", remarks: "" });
  const [returning, setReturning] = useState(false);

  const clearBanners = () => {
    setError("");
    setSuccess("");
  };

  // ── Load items + every chef's issues ──────────────────────────────────────
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [itemsRes, issuesRes] = await Promise.all([
        chefService.getInventoryItems(),
        chefService.getChefIssues(), // no filters → full ledger, we filter client-side
      ]);
      const itemsList = Array.isArray(itemsRes)
        ? itemsRes
        : Array.isArray(itemsRes?.items)
          ? itemsRes.items
          : Array.isArray(itemsRes?.data)
            ? itemsRes.data
            : [];
      setItems(itemsList);
      setIssues(Array.isArray(issuesRes) ? issuesRes : []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load chef issue records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Issue item to a chef ───────────────────────────────────────────────────
  const handleItemSelect = (e) => {
    const id = e.target.value;
    const found = items.find((it) => String(it.id) === String(id));
    setIssueDraft((c) => ({
      ...c,
      itemId: id,
      itemName: found?.name || "",
      unit: found?.unit || "",
    }));
  };

  const handleIssueSubmit = async (e) => {
    e.preventDefault();
    clearBanners();
    if (!issueDraft.itemId) return setError("Select an inventory item.");
    if (!issueDraft.chefName.trim()) return setError("Enter the chef's name.");
    const qty = Number(issueDraft.quantityIssued);
    if (!qty || qty <= 0) return setError("Quantity must be greater than zero.");
    const selectedItem = items.find((it) => String(it.id) === String(issueDraft.itemId));
    if (selectedItem && Number(selectedItem.stock || 0) < qty) {
      return setError(`Insufficient stock. Available: ${selectedItem.stock} ${selectedItem.unit || ""}`);
    }
    setSubmitting(true);
    try {
      await chefService.createChefIssue({
        itemId: Number(issueDraft.itemId),
        itemName: issueDraft.itemName,
        quantityIssued: qty,
        unit: issueDraft.unit,
        chefName: issueDraft.chefName.trim(),
        chefId: issueDraft.chefId || null,
        purpose: issueDraft.purpose,
        remarks: issueDraft.remarks,
      });
      setSuccess(`Issued ${qty} ${issueDraft.unit || ""} of ${issueDraft.itemName} to ${issueDraft.chefName}.`);
      setIssueDraft({ itemId: "", itemName: "", quantityIssued: "", unit: "", chefName: "", chefId: "", purpose: "", remarks: "" });
      setShowIssueForm(false);
      await refresh();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to issue item.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Return / reconcile ──────────────────────────────────────────────────
  const openReturn = (row) => {
    const remaining = Number(row.quantityIssued || 0) - Number(row.quantityReturned || 0);
    clearBanners();
    setReturnModal({ id: row.id, itemName: row.itemName, chefName: row.chefName, max: remaining });
    setReturnForm({ quantityReturned: "", remarks: "" });
  };

  const submitReturn = async (e) => {
    e.preventDefault();
    if (!returnModal) return;
    const qty = Number(returnForm.quantityReturned);
    if (!qty || qty <= 0) return setError("Return quantity must be greater than zero.");
    if (qty > returnModal.max) {
      return setError(`Cannot return more than remaining ${returnModal.max}.`);
    }
    setReturning(true);
    setError("");
    try {
      await chefService.returnChefIssue(returnModal.id, {
        quantityReturned: qty,
        remarks: returnForm.remarks,
      });
      setSuccess(`Return of ${qty} recorded for ${returnModal.itemName} (${returnModal.chefName}).`);
      setReturnModal(null);
      await refresh();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to record return.");
    } finally {
      setReturning(false);
    }
  };

  // ── Derived: chef list for filter dropdown ─────────────────────────────
  const chefOptions = useMemo(() => {
    const names = new Set(issues.map((r) => r.chefName).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  // ── Derived: filtered issues (client-side so status + chef + search can combine) ──
  const filteredIssues = useMemo(() => {
    let rows = issues;
    if (filterStatus) rows = rows.filter((r) => r.status === filterStatus);
    if (filterChef) rows = rows.filter((r) => r.chefName === filterChef);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.itemName || "").toLowerCase().includes(q) ||
          String(r.chefName || "").toLowerCase().includes(q) ||
          String(r.purpose || "").toLowerCase().includes(q),
      );
    }
    return [...rows].sort(
      (a, b) => new Date(b.issuedAt || 0).getTime() - new Date(a.issuedAt || 0).getTime(),
    );
  }, [issues, search, filterStatus, filterChef]);

  // ── Derived: pagination over the filtered list ──────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / RECORDS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRecords = useMemo(
    () => filteredIssues.slice((safePage - 1) * RECORDS_PER_PAGE, safePage * RECORDS_PER_PAGE),
    [filteredIssues, safePage],
  );
  const shownFrom = filteredIssues.length ? (safePage - 1) * RECORDS_PER_PAGE + 1 : 0;
  const shownTo = Math.min(safePage * RECORDS_PER_PAGE, filteredIssues.length);
  const pageItems = buildPageItems(safePage, totalPages);

  // Reset to page 1 whenever the visible set of records changes.
  useEffect(() => {
    setPage(1);
  }, [search, filterStatus, filterChef]);

  // ── Derived: fleet-wide stats ────────────────────────────────────────────
  const stats = useMemo(() => {
    const openRows = issues.filter((r) => r.status !== "fully_returned");
    const issuedTotal = issues.reduce((sum, r) => sum + Number(r.quantityIssued || 0), 0);
    const returnedTotal = issues.reduce((sum, r) => sum + Number(r.quantityReturned || 0), 0);
    return {
      totalRecords: issues.length,
      openCount: openRows.length,
      activeChefs: new Set(openRows.map((r) => r.chefName).filter(Boolean)).size,
      issuedTotal,
      returnedTotal,
      withChefs: issuedTotal - returnedTotal,
    };
  }, [issues]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef2ff_100%)] p-3 sm:p-4 xl:p-8">
      <div className="w-full space-y-4 xl:space-y-6">
        {/* Header */}
        <div className="overflow-hidden rounded-[20px] border border-white/70 bg-[linear-gradient(135deg,#172554_0%,#1e40af_55%,#3b82f6_100%)] px-4 py-5 text-white shadow-[0_24px_60px_rgba(15,23,42,0.25)] sm:px-5 xl:rounded-[28px] xl:px-6 xl:py-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 xl:h-12 xl:w-12">
                <FaChartPie size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold md:text-3xl">Chef Issue &amp; Return Oversight</h1>
                <p className="mt-1 text-[15px] text-white/80 sm:text-[16px] xl:text-[19px]">
                  Signed in as {adminName} · Track raw material issued to every chef and reconcile returns.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <div className="rounded-xl bg-white/10 px-3 py-2.5 xl:rounded-2xl xl:px-4 xl:py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/70 sm:text-[13px] xl:text-[15px]">Records</p>
                <p className="text-[18px] font-bold sm:text-[20px] xl:text-[23px]">{stats.totalRecords}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5 xl:rounded-2xl xl:px-4 xl:py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/70 sm:text-[13px] xl:text-[15px]">Open</p>
                <p className="text-[18px] font-bold sm:text-[20px] xl:text-[23px]">{stats.openCount}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5 xl:rounded-2xl xl:px-4 xl:py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/70 sm:text-[13px] xl:text-[15px]">Active Chefs</p>
                <p className="text-[18px] font-bold sm:text-[20px] xl:text-[23px]">{stats.activeChefs}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5 xl:rounded-2xl xl:px-4 xl:py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/70 sm:text-[13px] xl:text-[15px]">Issued</p>
                <p className="text-[18px] font-bold sm:text-[20px] xl:text-[23px]">{stats.issuedTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5 xl:rounded-2xl xl:px-4 xl:py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/70 sm:text-[13px] xl:text-[15px]">Returned</p>
                <p className="text-[18px] font-bold sm:text-[20px] xl:text-[23px]">{stats.returnedTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5 xl:rounded-2xl xl:px-4 xl:py-3">
                <p className="text-[11px] uppercase tracking-wider text-white/70 sm:text-[13px] xl:text-[15px]">With Chefs</p>
                <p className="text-[18px] font-bold sm:text-[20px] xl:text-[23px]">{stats.withChefs.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] font-medium text-red-700 sm:px-4 sm:py-3 xl:rounded-2xl xl:text-[17px]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[14px] font-medium text-emerald-700 sm:px-4 sm:py-3 xl:rounded-2xl xl:text-[17px]">
            {success}
          </div>
        )}

        {/* Issue-to-chef (collapsible) */}
        <div className="rounded-[20px] border border-white/80 bg-white p-4 shadow-[0_22px_50px_rgba(15,23,42,0.08)] sm:p-5 xl:rounded-[26px] xl:p-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <FaHandHolding className="text-indigo-500" />
              <h2 className="text-[20px] font-bold text-slate-900 sm:text-[26px] xl:text-[32px]">Issue Item to a Chef</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowIssueForm((v) => !v)}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-[14px] font-semibold text-indigo-700 hover:bg-indigo-100 xl:text-[17px]"
            >
              {showIssueForm ? "Close" : "New Issue"}
            </button>
          </div>

          {showIssueForm && (
            <form onSubmit={handleIssueSubmit} className="mt-4 grid gap-3 sm:gap-4 md:grid-cols-2">
              <Field label="Inventory Item" required>
                <select
                  value={issueDraft.itemId}
                  onChange={handleItemSelect}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                >
                  <option value="">Select an item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} · {it.stock ?? 0} {it.unit || ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Chef Name" required>
                <input
                  value={issueDraft.chefName}
                  onChange={(e) => setIssueDraft((c) => ({ ...c, chefName: e.target.value }))}
                  placeholder="e.g. Ramesh Kumar"
                  list="admin-chef-issue-known-chefs"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                />
                <datalist id="admin-chef-issue-known-chefs">
                  {chefOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>

              <Field label="Quantity" required>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={issueDraft.quantityIssued}
                  onChange={(e) => setIssueDraft((c) => ({ ...c, quantityIssued: e.target.value }))}
                  placeholder="e.g. 2"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                />
              </Field>

              <Field label="Unit">
                <input
                  value={issueDraft.unit}
                  onChange={(e) => setIssueDraft((c) => ({ ...c, unit: e.target.value }))}
                  placeholder="kg / ltr / pcs"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                />
              </Field>

              <Field label="Purpose (optional)">
                <input
                  value={issueDraft.purpose}
                  onChange={(e) => setIssueDraft((c) => ({ ...c, purpose: e.target.value }))}
                  placeholder="e.g. Lunch prep / Banquet / Daily cooking"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                />
              </Field>

              <Field label="Remarks (optional)">
                <input
                  value={issueDraft.remarks}
                  onChange={(e) => setIssueDraft((c) => ({ ...c, remarks: e.target.value }))}
                  placeholder="Any additional note"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                />
              </Field>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-600 px-6 py-3 text-[14px] font-semibold text-white shadow-[0_18px_30px_rgba(99,102,241,0.25)] transition hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto xl:text-[17px]"
                >
                  <FaBoxOpen size={12} />
                  {submitting ? "Issuing…" : "Issue Item"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* All chef issues */}
        <div className="rounded-[20px] border border-white/80 bg-white p-4 shadow-[0_22px_50px_rgba(15,23,42,0.08)] sm:p-5 xl:rounded-[26px] xl:p-6">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <FaClipboardCheck className="text-emerald-500" />
              <h2 className="text-[20px] font-bold text-slate-900 sm:text-[26px] xl:text-[32px]">All Chef Issues</h2>
            </div>
            <div className="flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
              <div className="flex w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2.5 xl:w-auto xl:py-2">
                <FaSearch className="text-slate-400" size={12} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search item, chef, purpose…"
                  className="w-full bg-transparent text-[14px] outline-none xl:w-48 xl:text-[17px]"
                />
              </div>
              <div className="flex w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2.5 xl:w-auto xl:py-2">
                <FaUsers className="text-slate-400" size={12} />
                <select
                  value={filterChef}
                  onChange={(e) => setFilterChef(e.target.value)}
                  className="w-full bg-transparent text-[14px] outline-none xl:w-auto xl:text-[17px]"
                >
                  <option value="">All Chefs</option>
                  {chefOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full rounded-full border border-slate-200 bg-white px-3 py-2.5 text-[14px] xl:w-auto xl:py-2 xl:text-[17px]"
              >
                <option value="">All Status</option>
                <option value="issued">Issued</option>
                <option value="partially_returned">Partially Returned</option>
                <option value="fully_returned">Fully Returned</option>
              </select>
              <button
                type="button"
                onClick={refresh}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-[14px] font-semibold text-cyan-700 hover:bg-cyan-100 xl:w-auto xl:py-2 xl:text-[17px]"
              >
                <FaSyncAlt size={10} /> Refresh
              </button>
            </div>
          </div>

          {/* Desktop / tablet table (≥768px) */}
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-[14px] md:text-[15px] xl:text-[17px]">
              <thead className="bg-slate-50 text-[13px] uppercase tracking-wide text-slate-500 md:text-[14px] xl:text-[16px]">
                <tr>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Item</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Chef</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Issued</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Returned</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">With Chef</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Purpose</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Status</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Issued At</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Returned At</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Issued By</th>
                  <th className="px-3 py-2.5 text-left xl:px-4 xl:py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : pageRecords.length ? (
                  pageRecords.map((row) => {
                    const remaining = Number(row.quantityIssued || 0) - Number(row.quantityReturned || 0);
                    return (
                      <tr key={row.id} className="border-t border-slate-100 hover:bg-indigo-50/40">
                        <td className="px-3 py-2.5 font-medium text-slate-800 xl:px-4 xl:py-3">
                          {row.itemName}
                          <div className="text-[12px] text-slate-500 xl:text-[15px]">{row.unit || ""}</div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 xl:px-4 xl:py-3">{row.chefName || "—"}</td>
                        <td className="px-3 py-2.5 text-slate-700 xl:px-4 xl:py-3">{Number(row.quantityIssued || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-slate-700 xl:px-4 xl:py-3">{Number(row.quantityReturned || 0).toFixed(2)}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-900 xl:px-4 xl:py-3">{remaining.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-slate-600 xl:px-4 xl:py-3">{row.purpose || "—"}</td>
                        <td className="px-3 py-2.5 xl:px-4 xl:py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-slate-500 xl:px-4 xl:py-3 xl:text-[15px]">
                          {row.issuedAt ? new Date(row.issuedAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-slate-500 xl:px-4 xl:py-3 xl:text-[15px]">
                          {row.returnedAt ? new Date(row.returnedAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-slate-600 xl:px-4 xl:py-3 xl:text-[15px]">{row.createdBy || "—"}</td>
                        <td className="px-3 py-2.5 xl:px-4 xl:py-3">
                          {row.status === "fully_returned" ? (
                            <span className="text-[12px] text-slate-400 xl:text-[15px]">Closed</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openReturn(row)}
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100 xl:text-[15px]"
                            >
                              <FaUndo size={10} /> Return
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-[18px] text-slate-400 xl:text-[21px]">
                      No chef issue records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="hidden md:block">
              <PaginationBar
                current={safePage}
                total={totalPages}
                pages={pageItems}
                onPageChange={setPage}
                shownFrom={shownFrom}
                shownTo={shownTo}
                totalRecords={filteredIssues.length}
              />
            </div>
          )}

          {/* Mobile stacked cards (<768px) */}
          <div className="space-y-3 md:hidden">
            {loading ? (
              <div className="py-10 text-center text-[16px] text-slate-400">Loading…</div>
            ) : pageRecords.length ? (
              pageRecords.map((row) => {
                const remaining = Number(row.quantityIssued || 0) - Number(row.quantityReturned || 0);
                return (
                  <div
                    key={row.id}
                    className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_25px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
                        <FaBoxOpen size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-bold text-slate-900">{row.itemName}</p>
                            <p className="text-[13px] text-slate-500">{row.unit || "—"}</p>
                          </div>
                          <StatusBadge status={row.status} />
                        </div>
                        <p className="mt-1 truncate text-[13px] text-slate-500">
                          Chef: <span className="font-semibold text-slate-700">{row.chefName || "—"}</span>
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-slate-100 pt-3">
                      <CardStat label="Issued" value={Number(row.quantityIssued || 0).toFixed(2)} />
                      <CardStat label="Returned" value={Number(row.quantityReturned || 0).toFixed(2)} />
                      <CardStat label="With Chef" value={remaining.toFixed(2)} />
                      <CardStat label="Issued By" value={row.createdBy} />
                      <CardStat label="Purpose" value={row.purpose} full />
                      <CardStat
                        label="Issued At"
                        value={row.issuedAt ? new Date(row.issuedAt).toLocaleString() : "—"}
                        full
                      />
                      {row.returnedAt && (
                        <CardStat
                          label="Returned At"
                          value={new Date(row.returnedAt).toLocaleString()}
                          full
                        />
                      )}
                    </div>

                    <div className="mt-4">
                      {row.status === "fully_returned" ? (
                        <span className="block rounded-full bg-slate-50 py-2 text-center text-[13px] font-semibold text-slate-400">
                          Closed
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openReturn(row)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-2.5 text-[14px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          <FaUndo size={11} /> Return
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-10 text-center text-[18px] text-slate-400">
                No chef issue records found.
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="md:hidden">
              <PaginationBar
                current={safePage}
                total={totalPages}
                pages={pageItems}
                onPageChange={setPage}
                shownFrom={shownFrom}
                shownTo={shownTo}
                totalRecords={filteredIssues.length}
              />
            </div>
          )}
        </div>
      </div>

      {/* Return modal */}
      {returnModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-[22px] bg-white p-4 shadow-2xl sm:p-5 xl:rounded-3xl xl:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-[18px] font-bold text-slate-900 sm:text-[20px] xl:text-[23px]">
                Record Return — {returnModal.itemName}
              </h3>
              <button
                type="button"
                onClick={() => setReturnModal(null)}
                className="shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100"
              >
                <FaTimes />
              </button>
            </div>
            <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-[14px] font-medium text-amber-700 xl:text-[17px]">
              Chef: {returnModal.chefName || "—"} · Maximum returnable quantity: {returnModal.max}
            </p>
            <form onSubmit={submitReturn} className="space-y-4">
              <Field label="Quantity to Return" required>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={returnModal.max}
                  value={returnForm.quantityReturned}
                  onChange={(e) => setReturnForm((c) => ({ ...c, quantityReturned: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                  placeholder="e.g. 2"
                />
              </Field>
              <Field label="Remarks (optional)">
                <textarea
                  rows={2}
                  value={returnForm.remarks}
                  onChange={(e) => setReturnForm((c) => ({ ...c, remarks: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:px-4 sm:py-3 xl:text-[17px]"
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setReturnModal(null)}
                  className="w-full rounded-full border border-slate-200 bg-white px-5 py-2.5 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto xl:text-[17px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={returning}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg disabled:opacity-60 sm:w-auto xl:text-[17px]"
                >
                  <FaUndo size={12} />
                  {returning ? "Saving…" : "Confirm Return"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}