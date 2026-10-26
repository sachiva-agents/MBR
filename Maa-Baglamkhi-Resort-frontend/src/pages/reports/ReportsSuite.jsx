import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaBan,
  FaBoxOpen,
  FaCalendarAlt,
  FaChartBar,
  FaDownload,
  FaFileAlt,
  FaHotel,
  FaListAlt,
  FaMoneyBillWave,
  FaPrint,
  FaStar,
  FaSyncAlt,
  FaUserFriends,
  FaUtensils,
} from "react-icons/fa";
import { createPortal } from "react-dom";
import API from "../../api";
import { formatINR, formatDay, todayISO } from "./reportUtils";

// Every report in the suite, each mapped to its /api/reports-suite/<key> endpoint.
const REPORTS = [
  { key: "mis", label: "MIS Report", note: "Money across every department", icon: FaChartBar },
  { key: "invoice-register", label: "Invoice Register", note: "All invoices and booking charges", icon: FaFileAlt },
  { key: "service-wise", label: "Service-wise Report", note: "Revenue by service line", icon: FaChartBar },
  { key: "room-occupancy", label: "Room Occupancy", note: "Nights and % per room", icon: FaHotel },
  { key: "rooms-all", label: "All Rooms Summary", note: "Live status of every room", icon: FaHotel },
  { key: "rooms-checkin", label: "Check-in Room Summary", note: "Rooms handed over in the period", icon: FaHotel },
  { key: "rooms-checkout", label: "Check-out Room Summary", note: "Rooms picked up in the period", icon: FaHotel },
  { key: "company-ledger", label: "Company Ledger", note: "Transactions and two-leg entries", icon: FaMoneyBillWave },
  { key: "room-history", label: "Room History", note: "Every booking per room", icon: FaHotel },
  { key: "room-performance", label: "Room Performance", note: "Revenue and rate per room", icon: FaHotel },
  { key: "guest-list-police", label: "Guest List (Police)", note: "In-house + recently checked-out", icon: FaUserFriends },
  { key: "housekeeping-history", label: "Housekeeping History", note: "Room-by-room cleaning log", icon: FaPrint },
  { key: "maintenance-history", label: "Maintenance History", note: "Requests, status and cost", icon: FaPrint },
  { key: "general-ledger", label: "General Ledger", note: "Chart of accounts with period activity", icon: FaMoneyBillWave },
  { key: "cashbook-summary", label: "Cashbook Summary", note: "Payments by channel and day", icon: FaMoneyBillWave },
  { key: "night-audit", label: "Night Audit", note: "Closing snapshot by department", icon: FaMoneyBillWave },
  { key: "cash-summary", label: "Cash Summary", note: "Petty cash and cash receipts", icon: FaMoneyBillWave },
  { key: "refund-collection", label: "Refund Collection", note: "Refunded payments and cancelled bookings", icon: FaMoneyBillWave },
  { key: "stock-summary", label: "Current Stock Summary", note: "On-hand quantities and value", icon: FaChartBar },
  { key: "collection-report", label: "Collection Report", note: "Receipts by day and channel", icon: FaMoneyBillWave },
  { key: "item-wise", label: "Item-wise Report", note: "Quantity and value per item", icon: FaListAlt },
  { key: "invoice-group-wise", label: "Invoice Group-wise", note: "Sales grouped by invoice", icon: FaFileAlt },
  { key: "sales-by-guest", label: "Sales by Guest", note: "Charges per in-house guest", icon: FaUserFriends },
  { key: "sales-by-order-type", label: "Sales by Order Type", note: "Table / room / takeaway split", icon: FaUtensils },
  { key: "due-list", label: "Due List", note: "Open balances right now", icon: FaMoneyBillWave },
  { key: "table-wise", label: "Table-wise Report", note: "Sales per restaurant table", icon: FaUtensils },
  { key: "nc-sales", label: "Non-Cash Sales", note: "Card, UPI and netbanking receipts", icon: FaMoneyBillWave },
  { key: "parcel-sales", label: "Parcel Sales", note: "Takeaway and delivery sales", icon: FaBoxOpen },
  { key: "void-kot-history", label: "Void / KOT History", note: "Cancelled items and KOTs", icon: FaBan },
  { key: "refund-item-summary", label: "Refund Item Summary", note: "Refunded payments in the period", icon: FaMoneyBillWave },
  { key: "pax", label: "Pax Report", note: "Guest counts per booking", icon: FaUserFriends },
  { key: "day-end-summary", label: "Day-end Summary", note: "One line per day", icon: FaCalendarAlt },
  { key: "feedback-analytics", label: "Feedback Analytics", note: "Guest ratings and reviews", icon: FaStar },
];

const isoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function DateControls({ from, to, onFrom, onTo, onReload, disabled }) {
  const presets = [
    ["today", () => { onFrom(todayISO()); onTo(todayISO()); }],
    ["month", () => { const d = new Date(); onFrom(isoDate(new Date(d.getFullYear(), d.getMonth(), 1))); onTo(todayISO()); }],
    ["30d", () => { const d = new Date(); d.setDate(d.getDate() - 29); onFrom(isoDate(d)); onTo(todayISO()); }],
  ];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] font-bold uppercase tracking-wide text-slate-400">
        <span className="flex items-center gap-1"><FaCalendarAlt size={12} /> From</span>
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-bold uppercase tracking-wide text-slate-400">
        <span>To</span>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700" />
      </label>
      <div className="flex gap-1">
        {presets.map(([label, fn]) => (
          <button key={label} type="button" onClick={fn} disabled={disabled} className="rounded-xl border border-slate-300 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {label === "30d" ? "Last 30d" : label}
          </button>
        ))}
      </div>
      <button type="button" onClick={onReload} disabled={disabled} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
        <FaSyncAlt size={13} /> Load
      </button>
    </div>
  );
}

function ReportTable({ columns, rows, summary }) {
  return (
    <div className="space-y-3">
      {summary && Object.keys(summary).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{k.replace(/_/g, " ")}</div>
              <div className="text-sm font-bold text-slate-800">
                {typeof v === "number" || isMoneyCol(k) ? formatINR(typeof v === "number" ? v : Number(v) || 0) : String(v)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">No rows in this window.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>{columns.map((c) => <th key={c} className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-2 text-slate-700">
                      {renderCell(row[c], c) === "—" ? <span className="text-slate-300">—</span> : renderCell(row[c], c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// A column whose name is a money field (total, amount, value, balance, ...) so it
// can render as a real Rs. figure. Count/label-ish names are excluded on purpose.
const MONEY_TOKENS = ["amount", "total", "paid", "balance", "debit", "credit", "due", "revenue", "cost", "refund", "value", "price", "cash", "card", "upi", "netbanking", "expense", "payroll", "income", "charges", "extra", "rate", "sales"];
const NONMONEY_TOKENS = ["guest", "pax", "count", "qty", "quantity", "occupancy", "nights", "stays", "rating", "stock", "reorder", "inhouse"];
function isMoneyCol(name) {
  // Total-ness wins when it is not part of a count word (total_pax stays a count).
  const n = String(name || "").toLowerCase().replace(/[_\-\s]/g, "").replace("totalpax", "pax");
  if (NONMONEY_TOKENS.some((t) => n.includes(t))) return false;
  return MONEY_TOKENS.some((t) => n.includes(t));
}

// Renders one cell for screen + print: money fields as Rs. en-IN, other numbers
// with Indian grouping, booleans as Yes/No, empty/NaN as an em dash. Never a raw NaN.
function renderCell(value, col) {
  if (value === null || value === undefined || value === "") return "—";
  if (isMoneyCol(col)) {
    const num = Number(value);
    return Number.isFinite(num) ? formatINR(num) : "—";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
  const text = String(value).trim();
  if (text === "" || text === "null" || text === "undefined" || text.toLowerCase() === "nan") return "—";
  return text;
}

// Clean-print-only view, portalled to #reports-print-root so the app chrome never lands on paper.
function PrintView({ data }) {
  const { reports, from, to } = data;
  return (
    <div className="rp-document">
      <div className="rp-header">
        <div className="rp-hotel">Maa Baglamkhi Resort</div>
        <div className="rp-sub">Reports Suite — All Reports ({reports.length})</div>
        <div className="rp-period">Period: {from ? formatDay(from) : "start"} to {to ? formatDay(to) : "now"}</div>
      </div>
      {reports.map((rep) => (
        <section key={rep.key} className="rp-section">
          <h2>{rep.label}</h2>
          {rep.summary && Object.keys(rep.summary).length > 0 ? (
            <div className="rp-summary">
              {Object.entries(rep.summary).map(([k, v]) => (
                <span key={k} className="rp-chip">
                  <b>{k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</b>{" "}
                  {(typeof v === "number" || isMoneyCol(k)) ? formatINR(typeof v === "number" ? v : Number(v) || 0) : String(v)}
                </span>
              ))}
            </div>
          ) : null}
          {rep.error ? (
            <p className="rp-err">{rep.error}</p>
          ) : rep.rows.length === 0 ? (
            <p className="rp-empty">No data in this window.</p>
          ) : (
            <table>
              <thead>
                <tr>{rep.columns.map((c) => <th key={c}>{String(c).replace(/_/g, " ")}</th>)}</tr>
              </thead>
              <tbody>
                {rep.rows.map((row, i) => (
                  <tr key={i}>
                    {rep.columns.map((c) => <td key={c}>{renderCell(row[c], c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

export default function ReportsSuite() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return isoDate(d); });
  const [to, setTo] = useState(todayISO());
  const [reportKey, setReportKey] = useState("mis");
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [printAllData, setPrintAllData] = useState(null);
  const [printAllBusy, setPrintAllBusy] = useState(false);

  const current = useMemo(() => REPORTS.find((r) => r.key === reportKey) || REPORTS[0], [reportKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await API.get(`/reports-suite/${reportKey}`, { params });
      const data = res.data || {};
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err?.response?.data?.message || "Report could not be loaded.");
    }
    setLoading(false);
  }, [reportKey, from, to]);

  useEffect(() => { load(); }, [load]);

  // Fetches every report for the selected window, then prints the whole set.
  const printAll = async () => {
    setPrintAllBusy(true);
    setError("");
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const settled = await Promise.allSettled(
        REPORTS.map((r) => API.get(`/reports-suite/${r.key}`, { params }).then((res) => res.data || {}))
      );
      const reports = settled.map((res, i) => {
        if (res.status === "fulfilled") {
          const data = res.value;
          return {
            ...REPORTS[i],
            columns: data.columns || [],
            rows: data.rows || [],
            summary: data.summary || null,
            error: "",
          };
        }
        return {
          ...REPORTS[i],
          columns: [],
          rows: [],
          summary: null,
          error: res.reason?.response?.data?.message || "Report could not be loaded for this print.",
        };
      });
      setPrintAllData({ reports, from, to });
    } catch {
      setError("Printing the full report set failed.");
    }
    setPrintAllBusy(false);
  };

  // Fires the browser print dialog once the print-only view is in the DOM.
  useEffect(() => {
    if (!printAllData) return undefined;
    const timer = setTimeout(() => { window.print(); }, 120);
    const clear = () => setPrintAllData(null);
    window.addEventListener("afterprint", clear);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", clear);
    };
  }, [printAllData]);

  const printRoot = typeof document !== "undefined" ? document.getElementById("reports-print-root") : null;

  const downloadNow = async () => {
    setDownloading(true);
    try {
      const params = { format: "csv" };
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await API.get(`/reports-suite/${reportKey}`, { params, responseType: "blob" });
      const blob = res.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportKey}_${from || "all"}_${to || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("CSV download failed.");
    }
    setDownloading(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.16em] text-emerald-600">
              <FaChartBar size={14} /> Reports Suite
            </div>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{current.label}</h1>
            <p className="text-sm text-slate-500">{current.note}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={printAll}
              disabled={printAllBusy || loading}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              <FaPrint size={13} /> {printAllBusy ? `Preparing… ${REPORTS.length} reports` : `Print All ${REPORTS.length} Reports`}
            </button>
            <button
              type="button"
              onClick={downloadNow}
              disabled={loading || rows.length === 0}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <FaDownload size={13} /> Download CSV
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {REPORTS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => { setReportKey(r.key); }}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-bold tracking-wide transition ${reportKey === r.key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <DateControls from={from} to={to} onFrom={setFrom} onTo={setTo} onReload={load} disabled={loading} />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">Loading {current.label}…</div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            <FaFileAlt size={15} /> {error}
          </div>
        ) : (
          <ReportTable columns={columns} rows={rows} summary={summary} />
        )}
      </div>

      {printAllData && printRoot ? createPortal(<PrintView data={printAllData} />, printRoot) : null}
    </div>
  );
}
