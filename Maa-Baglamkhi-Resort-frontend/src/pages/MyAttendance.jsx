import React, { useEffect, useState } from "react";
import {
  FaCalendarAlt,
  FaClipboardCheck,
  FaClock,
  FaMoneyBillWave,
  FaUserCheck,
  FaUsers,
} from "react-icons/fa";
import SummaryCard from "../components/Attendance/SummaryCard";
import API, { getErrorMessage } from "../api";
import { localDate, localMonth } from "../utils/localDate";

const STATUS_LABEL = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half Day",
  on_leave: "On Leave",
  holiday: "Holiday",
  week_off: "Week Off",
};

const STATUS_BADGE = {
  Present: "bg-green-100 text-green-700",
  Absent: "bg-red-100 text-red-700",
  Late: "bg-yellow-100 text-yellow-700",
  "Half Day": "bg-amber-100 text-amber-700",
  "On Leave": "bg-blue-100 text-blue-700",
  Holiday: "bg-purple-100 text-purple-700",
  "Week Off": "bg-slate-200 text-slate-700",
};

const labelOf = (value) => {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  return STATUS_LABEL[raw.toLowerCase()] || raw;
};

const MyAttendance = () => {
  const [date, setDate] = useState(localDate());
  const [month, setMonth] = useState(localMonth());
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markStatus, setMarkStatus] = useState("present");
  const [markIn, setMarkIn] = useState("");
  const [markOut, setMarkOut] = useState("");
  const [loadError, setLoadError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryEmpty, setSummaryEmpty] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);

  const fetchToday = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await API.get("/attendance/me", { params: { date } });
      setRecords(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error loading attendance:", err);
      setRecords([]);
      setLoadError(getErrorMessage(err, "Could not load attendance for this date."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchToday();
  }, [date]);

  const fetchMonthly = async () => {
    setSummaryError("");
    setSummaryEmpty(false);
    try {
      const res = await API.get("/attendance/me/salary", { params: { month } });
      setSummary(res.data || null);
      setSummaryEmpty(!res.data);
    } catch (err) {
      console.error("Error loading monthly summary:", err);
      setSummary(null);
      setSummaryError(getErrorMessage(err, "Could not load your monthly salary summary."));
    }
  };

  useEffect(() => {
    fetchMonthly();
  }, [month]);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const handle = window.setTimeout(() => setSaveNotice(null), 4000);
    return () => window.clearTimeout(handle);
  }, [saveNotice]);

  const handleMark = async (status) => {
    setMarking(true);
    try {
      const payload = { date, status };
      if (status === "present" || status === "late") {
        if (markIn) payload.checkIn = markIn;
        if (markOut) payload.checkOut = markOut;
      } else if (status === "half_day") {
        if (markIn) payload.checkIn = markIn;
      }
      const res = await API.post("/attendance", payload);
      setSaveNotice({ message: res.data?.message || "Attendance saved", tone: "success" });
      fetchToday();
      fetchMonthly();
    } catch (err) {
      console.error("Error marking attendance:", err);
      setSaveNotice({
        message: err?.response?.data?.message || "Could not save your attendance",
        tone: "error",
      });
    } finally {
      setMarking(false);
    }
  };

  const countStatus = (label) =>
    records.filter((r) => labelOf(r.status) === label).length;

  const presentCount = countStatus("Present");
  const absentCount = countStatus("Absent");
  const lateCount = countStatus("Late");
  const leaveCount = countStatus("On Leave");
  const halfDayCount = countStatus("Half Day");
  const holidayCount = countStatus("Holiday");
  const weekOffCount = countStatus("Week Off");

  const mSummary = summary?.summary || {};
  const monthlyTotal = Number(mSummary.totalEarned ?? mSummary.totalAmountEarned ?? summary?.totalPaid ?? 0);
  const monthlySalary = Number(summary?.employee?.monthlySalary ?? summary?.employee?.salary ?? 0);
  const userName = localStorage.getItem("name") || localStorage.getItem("username") || summary?.employee?.name || "You";

  const formatCurrency = (amount) => {
    const n = parseFloat(amount || 0);
    return `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const markBtn = (status, label, cls) => (
    <button
      type="button"
      disabled={marking}
      onClick={() => handleMark(status)}
      className={`rounded-xl px-4 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 ${cls}`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="inline-flex items-center gap-3 rounded-full bg-cyan-100/80 px-4 py-2">
          <span className="h-3 w-3 rounded-full bg-cyan-600"></span>
          <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-cyan-700">
            My Attendance
          </span>
        </div>
        <h2 className="mt-4 text-[34px] font-extrabold text-slate-900">
          {userName}'s Attendance &amp; Salary
        </h2>
        <p className="mt-2 text-[16px] text-slate-600">
          View your attendance records and calculated salary.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-4">
        <SummaryCard label="Present" value={presentCount} color="green" icon={FaUserCheck} />
        <SummaryCard label="Absent" value={absentCount} color="red" icon={FaClipboardCheck} />
        <SummaryCard label="Late" value={lateCount} color="yellow" icon={FaClock} />
        <SummaryCard label="Half Day" value={halfDayCount} color="amber" icon={FaClock} />
        <SummaryCard label="Leave" value={leaveCount} color="blue" icon={FaCalendarAlt} />
        <SummaryCard label="Holiday" value={holidayCount} color="purple" icon={FaCalendarAlt} />
        <SummaryCard label="Week Off" value={weekOffCount} color="slate" icon={FaClock} />
        <SummaryCard
          label="Monthly Pay"
          value={formatCurrency(monthlySalary)}
          color="emerald"
          icon={FaMoneyBillWave}
        />
        <SummaryCard
          label="Earned"
          value={formatCurrency(monthlyTotal)}
          color="emerald"
          icon={FaMoneyBillWave}
        />
      </div>

      {/* Mark today's attendance */}
      <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-[15px] font-bold uppercase tracking-wider text-slate-600">
          Mark my attendance for {date}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="time"
            value={markIn}
            onChange={(e) => setMarkIn(e.target.value)}
            placeholder="Check in"
            className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-[14px] font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          <input
            type="time"
            value={markOut}
            onChange={(e) => setMarkOut(e.target.value)}
            placeholder="Check out"
            className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-[14px] font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          {markBtn("present", "Mark Present", "bg-emerald-600")}
          {markBtn("late", "Mark Late", "bg-amber-500")}
          {markBtn("half_day", "Half Day", "bg-orange-400")}
          {markBtn("on_leave", "On Leave", "bg-blue-600")}
          {markBtn("holiday", "Holiday", "bg-purple-500")}
          {markBtn("week_off", "Week Off", "bg-slate-500")}
          {markBtn("absent", "Absent", "bg-rose-500")}
          {marking && <span className="text-[14px] font-semibold text-slate-500">Saving…</span>}
        </div>
        {saveNotice && (
          <div className={`mt-3 rounded-xl border px-4 py-2.5 text-[14px] font-semibold ${saveNotice.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {saveNotice.message}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div>
          <label className="mb-2 block text-[13px] font-bold uppercase tracking-wider text-slate-600">
            View Attendance For Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-2xl border border-blue-100 bg-white px-5 py-3.5 text-[15px] font-semibold text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <div>
          <label className="mb-2 block text-[13px] font-bold uppercase tracking-wider text-slate-600">
            Monthly Summary
          </label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-2xl border border-blue-100 bg-white px-5 py-3.5 text-[15px] font-semibold text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>
      </div>

      {/* Selected-date records */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="border-b border-blue-50 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">
            Attendance on {date}
          </h3>
        </div>

        {loadError ? (
          <div className="p-8 text-center text-rose-600">{loadError}</div>
        ) : records.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">#</th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Designation</th>
                <th className="p-3 text-left">Check In</th>
                <th className="p-3 text-left">Check Out</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Daily Salary</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, idx) => {
                const label = labelOf(r.status) || "—";
                return (
                  <tr key={r.id ?? idx} className="border-b hover:bg-blue-50/30">
                    <td className="p-3 font-semibold text-slate-500">{idx + 1}</td>
                    <td className="p-3 font-bold text-slate-900">
                      {r.name || r.employeeName || "—"}
                    </td>
                    <td className="p-3">{r.designation || r.role || r.role_name || "—"}</td>
                    <td className="p-3">
                      <span className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 font-semibold text-blue-700">
                        {r.checkIn || r.in_time || "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
                        {r.checkOut || r.out_time || "—"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ${STATUS_BADGE[label] || "bg-blue-100 text-blue-700"}`}>
                        {label}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-bold text-emerald-700">
                        {formatCurrency(r.salary_amount)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-slate-500">
            {loading ? "Loading..." : "No attendance records found for this date."}
          </div>
        )}
      </div>

      {/* Monthly summary */}
      {summaryError ? (
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-center text-[14px] font-semibold text-rose-600">
          {summaryError}
        </div>
      ) : summaryEmpty ? (
        <div className="rounded-xl border border-slate-100 bg-white p-6 text-center text-[14px] text-slate-500 shadow-sm">
          No salary summary for {month}.
        </div>
      ) : summary && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-emerald-50 to-green-50 p-6 shadow">
            <h3 className="mb-2 text-xl font-extrabold text-slate-900">
              Monthly Salary Summary — {summary.summary?.month || summary.month || month}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Monthly Salary
                </p>
                <p className="text-2xl font-extrabold text-green-700">
                  {formatCurrency(monthlySalary)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Paid Days
                </p>
                <p className="text-2xl font-extrabold text-slate-900">
                  {mSummary.paidDays ?? summary.daysRecorded ?? 0}
                  <span className="text-base font-semibold text-slate-400">
                    {" "}of {mSummary.totalWorkingDays ?? summary.daysInMonth ?? 0}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total Earned
                </p>
                <p className="text-2xl font-extrabold text-emerald-700">
                  {formatCurrency(monthlyTotal)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Payout %
                </p>
                <p className="text-2xl font-extrabold text-slate-900">
                  {monthlySalary > 0 ? `${Math.round((monthlyTotal / monthlySalary) * 100)}%` : "0%"}
                </p>
              </div>
            </div>
            {mSummary.statusTotals && (
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(mSummary.statusTotals).filter(([, v]) => v > 0).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-white/80 px-3 py-1 text-[13px] font-bold text-slate-700">
                    {STATUS_LABEL[k] || k}: {v}
                  </span>
                ))}
              </div>
            )}
          </div>

          {Array.isArray(summary.records) && summary.records.length > 0 && (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="border-b border-blue-50 px-6 py-4">
                <h3 className="text-lg font-bold text-slate-900">Daily Breakdown</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-3 text-left">#</th>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Check In</th>
                    <th className="p-3 text-left">Check Out</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-left">Salary Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.records.map((r, idx) => {
                    const label = labelOf(r.status) || "—";
                    return (
                      <tr key={r.id ?? idx} className="border-b hover:bg-blue-50/30">
                        <td className="p-3 font-semibold text-slate-500">{idx + 1}</td>
                        <td className="p-3 font-semibold text-slate-900">{r.date}</td>
                        <td className="p-3">{r.checkIn || r.in_time || "—"}</td>
                        <td className="p-3">{r.checkOut || r.out_time || "—"}</td>
                        <td className="p-3">
                          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ${STATUS_BADGE[label] || "bg-blue-100 text-blue-700"}`}>
                            {label}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="font-bold text-emerald-700">
                            {formatCurrency(r.salary_amount ?? r.daySalary)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MyAttendance;
