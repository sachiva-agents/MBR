import React, { useEffect, useState } from "react";
import {
  FaCoins,
  FaHistory,
  FaListUl,
  FaPlus,
  FaSpinner,
} from "react-icons/fa";

import API, { getErrorMessage } from "../api";

/**
 * Generic payment capture + history (HAG-12, gap 11).
 *
 * Wires the two /api/payment gap routes for the front desk:
 *   POST /api/payment -> capture a payment (table reference + amount + method id)
 *   GET  /api/payment -> payment history list
 *
 * Booking top-ups still go through the existing /hotel/advance flow
 * (CollectPayment.jsx) — this screen is for standalone captures.
 *
 * payment_method_id is a real FK into the accounts payment_methods table,
 * so the method picker is fed from GET /accounts/payment-settings (the
 * same list Accounts.jsx edits) instead of free text.
 */
const inr = (n) => `₹ ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const field = (row, ...keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row[key] !== "") return row[key];
  }
  return "";
};

const PaymentDesk = () => {
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState({ booking_ref: "", total: "", method: "" });
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState({ type: "", text: "" });
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [tab, setTab] = useState("capture");

  const input =
    "w-full rounded-[14px] border border-blue-200 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const label = "mb-1.5 block text-[12px] font-bold uppercase tracking-[0.08em] text-slate-500";

  const loadMethods = async () => {
    try {
      const res = await API.get("/accounts/payment-settings");
      const rows = Array.isArray(res.data) ? res.data : [];
      setMethods(rows.map((m) => ({ id: m.id, name: field(m, "name", "payment_method", "title") })));
    } catch {
      setMethods([]);
    }
  };

  const loadHistory = async (silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      const res = await API.get("/payment");
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to load payment history:", err);
      setHistory([]);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadMethods();
    loadHistory();
  }, []);

  const flashMsg = (type, text) => {
    setFlash({ type, text });
    if (type) setTimeout(() => setFlash({ type: "", text: "" }), 4000);
  };

  const handleCapture = async () => {
    if (!form.total || Number(form.total) <= 0) {
      flashMsg("error", "Enter an amount greater than zero.");
      return;
    }
    if (!form.method) {
      flashMsg("error", "Choose a payment method.");
      return;
    }
    setCapturing(true);
    try {
      await API.post("/payment", {
        table: form.booking_ref.trim() || "FRONT",
        total: Number(form.total),
        method: Number(form.method),
      });
      flashMsg("success", "Payment captured.");
      setForm((f) => ({ ...f, booking_ref: "", total: "" }));
      loadHistory(true);
    } catch (err) {
      flashMsg("error", getErrorMessage(err, "Payment capture failed"));
    } finally {
      setCapturing(false);
    }
  };

  const methodLabel = (id) =>
    methods.find((m) => String(m.id) === String(id))?.name || String(id || "--");

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 shadow-sm">
            <FaCoins className="text-[13px] text-emerald-600" />
            <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-emerald-700">
              Payments
            </span>
          </div>
          <h2 className="mt-3 text-[26px] lg:text-[34px] font-extrabold leading-tight text-slate-900">
            Payment Desk
          </h2>
          <p className="mt-1 max-w-2xl text-[15px] font-semibold text-slate-500">
            Capture standalone payments and browse their history. Booking top-ups stay on the
            booking flow (advance payments).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab("capture")}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-bold transition ${
              tab === "capture"
                ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-lg"
                : "border border-emerald-100 bg-white text-slate-600 hover:border-emerald-300"
            }`}
          >
            <FaPlus className="text-[13px]" /> Capture
          </button>
          <button
            onClick={() => setTab("history")}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-bold transition ${
              tab === "history"
                ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-lg"
                : "border border-emerald-100 bg-white text-slate-600 hover:border-emerald-300"
            }`}
          >
            <FaHistory className="text-[13px]" /> History
          </button>
        </div>
      </div>

      {flash.type && (
        <div
          className={`rounded-[18px] border px-4 py-3 text-[15px] font-bold ${
            flash.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {flash.text}
        </div>
      )}

      {tab === "capture" && (
        <section className="max-w-3xl rounded-[22px] border border-emerald-100 bg-white p-5 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.18)] sm:p-6">
          <h3 className="mb-4 text-[19px] font-extrabold text-slate-900">Capture a payment</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Booking / table ref</label>
              <input
                className={input}
                value={form.booking_ref}
                placeholder="e.g. 42 or booking id"
                onChange={(e) => setForm((f) => ({ ...f, booking_ref: e.target.value }))}
              />
            </div>
            <div>
              <label className={label}>Amount (Rs.)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={input}
                value={form.total}
                onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
              />
            </div>
            <div>
              <label className={label}>Method</label>
              <select
                className={input}
                value={form.method}
                onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              >
                <option value="">Select method…</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleCapture}
              disabled={capturing}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 px-6 py-2.5 text-[15px] font-bold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {capturing ? <FaSpinner className="animate-spin" /> : <FaPlus />}
              Capture Payment
            </button>
          </div>
        </section>
      )}

      {tab === "history" && (
        <section className="overflow-hidden rounded-[22px] border border-emerald-100 bg-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.18)]">
          <div className="flex items-center gap-2 border-b border-emerald-50 px-5 py-4">
            <FaListUl className="text-emerald-600" />
            <h3 className="text-[19px] font-extrabold text-slate-900">Payment History</h3>
            <span className="ml-auto text-[13px] font-bold text-slate-400">{history.length} records</span>
          </div>
          {historyLoading ? (
            <div className="flex justify-center p-8">
              <FaSpinner className="animate-spin text-emerald-500" />
            </div>
          ) : history.length ? (
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-left text-[15px]">
                <thead className="sticky top-0 bg-[#f4faf8] text-[12px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={row.id || i} className="border-t border-emerald-50/60 hover:bg-emerald-50/30">
                      <td className="px-4 py-3 font-bold text-slate-900">#{row.id}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700">{inr(row.amount)}</td>
                      <td className="px-4 py-3 text-slate-600">{methodLabel(row.payment_method_id)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-slate-600">
                          {row.status || "completed"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {row.created_at ? new Date(row.created_at).toLocaleString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-[15px] font-semibold text-slate-400">
              No payments captured yet.
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default PaymentDesk;
