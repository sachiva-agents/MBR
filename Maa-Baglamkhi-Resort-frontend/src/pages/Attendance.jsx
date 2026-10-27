import React, { useEffect, useMemo, useState } from "react";
import {
  FaCalendarAlt,
  FaClipboardCheck,
  FaClock,
  FaStar,
  FaTrash,
  FaUserCheck,
  FaUserPlus,
  FaUsers,
} from "react-icons/fa";

import AttendanceForm from "../components/Attendance/AttendanceForm";
import AttendanceRow from "../components/Attendance/AttendanceRow";
import FiltersSection from "../components/Attendance/FiltersSection";
import SummaryCard from "../components/Attendance/SummaryCard";
import API from "../api";
import { localDate } from "../utils/localDate";

const Attendance = () => {
  /* ================= ROLE ================= */

  const role = (localStorage.getItem("role") || "").toLowerCase();
  const isAdmin = role === "admin";

  /* ================= STATE ================= */

  const [date, setDate] = useState(
    localDate()
  );

  const [department, setDepartment] = useState("All Departments");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [searchQuery, setSearchQuery] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);

  // Festival / holiday calendar — admin adds a festival day; the backend
  // marks every active employee as a paid holiday for it, so salary counts it.
  const [holidays, setHolidays] = useState([]);
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayBusy, setHolidayBusy] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 5;

  /* ================= FETCH ================= */

  const loadStaff = async () => {
    try {
      const res = await API.get("/attendance/employees");
      const rows = Array.isArray(res.data) ? res.data : [];
      setStaff(rows.filter((s) => String(s.isActive ?? s.active ?? true) !== "false"));
    } catch (err) {
      console.error("Error loading staff", err);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const loadAttendance = async () => {
    try {
      const res = await API.get("/attendance", { params: { date } });
      const data = Array.isArray(res.data) ? res.data : [];
      setEmployees(data);
      setLoadError("");
    } catch (err) {
      console.error("Error loading attendance", err);
      setEmployees([]);
      setLoadError(err.response?.data?.message || "Attendance could not be loaded for this date.");
    }
  };

  useEffect(() => {
    loadAttendance();
  }, [date]);

  /* ================= FESTIVAL HOLIDAYS (admin) ================= */

  const loadHolidays = async () => {
    try {
      const res = await API.get("/attendance/holidays");
      setHolidays(Array.isArray(res.data) ? res.data : []);
    } catch {
      setHolidays([]);
    }
  };

  useEffect(() => {
    if (isAdmin) loadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const addHoliday = async () => {
    if (!holidayDate) {
      showNotice("Pick the festival date first", "error");
      return;
    }
    setHolidayBusy(true);
    try {
      const res = await API.post("/attendance/mark-holiday", {
        date: holidayDate,
        name: holidayName.trim() || "Festival Holiday",
      });
      showNotice(res.data?.message || `Holiday added for ${holidayDate}`);
      setHolidayName("");
      setHolidayDate("");
      loadHolidays();
      setDate(holidayDate);
    } catch (err) {
      showNotice(
        err?.response?.data?.message || "Could not add the holiday",
        "error"
      );
    } finally {
      setHolidayBusy(false);
    }
  };

  const removeHoliday = async (holiday) => {
    const when = String(holiday.date || "").slice(0, 10);
    if (!when) return;
    if (!window.confirm(`Remove ${holiday.name || when} from the holiday calendar? Already-marked attendance rows stay.`)) return;
    try {
      await API.delete(`/attendance/holidays/${when}`);
      showNotice(`Removed ${holiday.name || when} from the calendar`);
      loadHolidays();
    } catch (err) {
      showNotice(
        err?.response?.data?.message || "Could not remove the holiday",
        "error"
      );
    }
  };

  /* The grid lists every active staff member for the day. An employee who was
     never marked still shows a row with no status, so "Total" is the roster
     size and absentees are visible instead of silently missing. */
  const rowsForDate = useMemo(() => {
    const byKey = new Map();
    employees.forEach((r) => {
      const k = String(r.employeeId ?? r.employee_id ?? r.employeeUserId ?? r.id);
      byKey.set(k, r);
    });
    const out = [];
    staff.forEach((s) => {
      const key = String(s.employeeId ?? s.employee_id ?? s.id);
      const rec = byKey.get(key) || byKey.get(String(s.employeeUserId ?? s.userId ?? s.id)) || null;
      out.push(
        rec || {
          id: `unmarked-${key}`,
          employeeId: s.employeeId ?? s.employee_id,
          employeeUserId: s.employeeUserId ?? s.userId ?? s.id,
          name: s.name || "--",
          userName: s.name || null,
          department: s.department || "--",
          departmentName: s.department || null,
          role: s.designation || s.role || "--",
          designation: s.designation || null,
          checkIn: null,
          checkOut: null,
          in_time: null,
          out_time: null,
          status: null,
          statusLabel: null,
          salary_amount: 0,
          user_salary: Number(s.monthlySalary ?? s.base_salary ?? 0),
          method: null,
        }
      );
    });
    // Records for employees missing from the roster still surface.
    employees.forEach((r) => {
      const key = String(r.employeeId ?? r.employee_id ?? r.employeeUserId ?? r.id);
      if (!out.some((o) => String(o.employeeId ?? o.employee_id ?? o.id) === key)) out.push(r);
    });
    return out;
  }, [staff, employees]);

  /* ================= FILTER ================= */

  const optionSet = (key) =>
    [...new Set(staff.map((s) => s[key]).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b))
    );

  const departmentOptions = optionSet("department");
  const roleOptions = optionSet("designation");

  const filteredEmployees = useMemo(() => {
    const list = Array.isArray(rowsForDate) ? rowsForDate : [];
    return list.filter((employee) => {
      const matchesDepartment =
        department === "All Departments" ||
        employee.department === department ||
        employee.departmentName === department;

      const matchesRole =
        roleFilter === "All Roles" ||
        employee.role === roleFilter ||
        employee.designation === roleFilter;

      const matchesSearch =
        searchQuery === "" ||
        String(employee.name || employee.employeeName || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      return matchesDepartment && matchesRole && matchesSearch;
    });
  }, [department, roleFilter, rowsForDate, searchQuery]);

  /* ================= PAGINATION ================= */

  const indexOfLast = currentPage * recordsPerPage;
  const indexOfFirst = indexOfLast - recordsPerPage;

  const currentRecords = filteredEmployees.slice(
    indexOfFirst,
    indexOfLast
  );

  const totalPages = Math.ceil(
    filteredEmployees.length / recordsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filteredEmployees]);

  /* ================= STATS =================
     The API returns lowercase statuses ("present"); the UI paints by label, so
     compare case-insensitively or the Present/Absent cards stay at zero. */

  const statusCount = (value) =>
    rowsForDate.filter(
      (e) => (e.status || "").toLowerCase() === value.toLowerCase()
    ).length;

  const totalStaff = rowsForDate.length;
  // Statuses arrive lowercase with underscores from the API ("on_leave",
  // "half_day") — compare on the raw key, not the display label, or the
  // cards silently stay at zero.
  const statusCountRaw = (value) =>
    rowsForDate.filter((e) => String(e.status || "").toLowerCase() === value).length;

  const presentStaff = statusCountRaw("present");
  const absentStaff = statusCountRaw("absent");
  const lateStaff = statusCountRaw("late");
  const onLeaveStaff = statusCountRaw("on_leave");
  const totalSalary = rowsForDate.reduce(
    (sum, e) => sum + parseFloat(e.salary_amount || 0),
    0
  );
  const halfDayStaff = statusCountRaw("half_day");
  const holidayStaff = statusCountRaw("holiday");
  const weekOffStaff = statusCountRaw("week_off");
  const unmarkedStaff = rowsForDate.filter((e) => !e.status).length;

  const showNotice = (message, tone = "success") => {
    if (!message) return;
    setNotice({ message, tone });
    window.setTimeout(() => {
      setNotice((current) => (current && current.message === message ? null : current));
    }, 4000);
  };

  /* ================= ADD (admin only) ================= */

  const handleManualSubmit = async (data) => {
    if (!isAdmin) {
      showNotice("Only admin can add attendance", "error");
      return;
    }
    try {
      const payload = {
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        date: data.date || date,
        status: String(data.status || "present").toLowerCase(),
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        leaveType: data.leaveType,
        notes: data.notes,
        method: data.method || "Manual",
      };

      const res = await API.post("/attendance", payload);
      setShowManualEntry(false);
      showNotice(res.data?.message || "Attendance saved");
      setDate(payload.date);
      loadAttendance();
      loadStaff();
    } catch (err) {
      console.error("Error saving attendance", err);
      showNotice(err?.response?.data?.message || "Error saving attendance", "error");
    }
  };

  /* ================= CHECK IN / OUT (admin only) ================= */

  const nowTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const target = (employee) => {
    if (employee.employeeId != null) return { employeeId: employee.employeeId };
    if (employee.employeeUserId != null) return { userId: employee.employeeUserId };
    return { employeeName: employee.name };
  };

  const handleCheckIn = async (employee) => {
    if (!isAdmin) return;
    try {
      await API.post("/attendance", {
        ...target(employee),
        status: "present",
        date,
        checkIn: nowTime(),
      });
      showNotice(`${employee.name || "Employee"} checked in`);
      loadAttendance();
    } catch (err) {
      console.error("Error checking in", err);
      showNotice(err.response?.data?.message || "Could not record check-in", "error");
    }
  };

  const handleCheckOut = async (employee) => {
    if (!isAdmin) return;
    try {
      await API.post("/attendance", {
        ...target(employee),
        status: (employee.status || "present").toLowerCase(),
        date,
        checkOut: nowTime(),
      });
      showNotice(`${employee.name || "Employee"} checked out`);
      loadAttendance();
    } catch (err) {
      console.error("Error checking out", err);
      showNotice(err.response?.data?.message || "Could not record check-out", "error");
    }
  };

  /* ================= UI ================= */

  return (
    <div className="p-6 space-y-6">

      <FiltersSection
        date={date}
        department={department}
        role={roleFilter}
        searchQuery={searchQuery}
        onDateChange={setDate}
        onDepartmentChange={setDepartment}
        onRoleChange={setRoleFilter}
        onSearchChange={setSearchQuery}
        onAddManualEntry={() => setShowManualEntry(true)}
        showAddButton={isAdmin}
        departments={departmentOptions}
        roles={roleOptions}
      />

      {loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {loadError}
        </div>
      )}

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${notice.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {notice.message}
        </div>
      )}

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <SummaryCard label="Total" value={totalStaff} icon={FaUsers} />
        <SummaryCard label="Present" value={presentStaff} color="green" icon={FaUserCheck} />
        <SummaryCard label="Absent" value={absentStaff} color="red" icon={FaClipboardCheck} />
        <SummaryCard label="Late" value={lateStaff} color="yellow" icon={FaClock} />
        <SummaryCard label="Half Day" value={halfDayStaff} color="amber" icon={FaClock} />
        <SummaryCard label="Leave" value={onLeaveStaff} color="blue" icon={FaCalendarAlt} />
        <SummaryCard label="Holiday" value={holidayStaff} color="purple" icon={FaCalendarAlt} />
        <SummaryCard label="Week Off" value={weekOffStaff} color="slate" icon={FaClock} />
        <SummaryCard label="Unmarked" value={unmarkedStaff} color="slate" icon={FaUsers} />
        <SummaryCard
          label="Paid Today"
          value={`₹ ${totalSalary.toFixed(0)}`}
          color="emerald"
          icon={FaUsers}
        />
      </section>

      {/* FESTIVAL / HOLIDAY CALENDAR (admin) — adding a festival marks every
          active employee as a paid holiday for that date, so salary counts it
          at 100% and the Holiday card above picks it up. */}
      {isAdmin && (
        <section className="rounded-[24px] border border-purple-100 bg-gradient-to-br from-purple-50/60 to-white p-5 shadow-[0_6px_16px_rgba(109,40,217,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white shadow-sm">
                <FaStar />
              </div>
              <div>
                <h3 className="text-[16px] sm:text-[18px] font-extrabold text-slate-900">
                  Festival &amp; Holiday Calendar
                </h3>
                <p className="text-[12px] sm:text-[13px] text-slate-500">
                  Add a festival day — every staff member is marked as a paid holiday and salary counts it in full.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-purple-100 px-3 py-1 text-[12px] font-bold text-purple-700">
              {holidays.length} on calendar
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Festival / holiday name
              </label>
              <input
                value={holidayName}
                onChange={(e) => setHolidayName(e.target.value)}
                placeholder="e.g. Diwali, Holi, Christmas"
                className="w-full rounded-xl border border-purple-100 bg-white px-3.5 py-2.5 text-[14px] font-semibold text-slate-800 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
              />
            </div>
            <div className="sm:w-52">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Date
              </label>
              <input
                type="date"
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
                className="w-full rounded-xl border border-purple-100 bg-white px-3.5 py-2.5 text-[14px] font-semibold text-slate-800 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
              />
            </div>
            <button
              type="button"
              onClick={addHoliday}
              disabled={holidayBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-500 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              <FaStar size={13} />
              {holidayBusy ? "Adding…" : "Add & mark all staff"}
            </button>
          </div>

          {holidays.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {holidays.map((h) => {
                const when = String(h.date || "").slice(0, 10);
                return (
                  <span
                    key={when}
                    className="inline-flex items-center gap-2 rounded-full border border-purple-100 bg-white px-3 py-1.5 text-[13px] font-bold text-purple-700 shadow-sm"
                  >
                    <FaCalendarAlt size={12} />
                    {when} · {h.name}
                    <button
                      type="button"
                      onClick={() => removeHoliday(h)}
                      title={`Remove ${h.name} from calendar`}
                      className="rounded-full p-0.5 text-purple-300 transition hover:bg-purple-100 hover:text-purple-700"
                    >
                      <FaTrash size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TABLE */}
      <div className="rounded-[24px] border border-blue-100 bg-white shadow-[0_6px_16px_rgba(30,64,175,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[17px]">
            <thead className="bg-[linear-gradient(180deg,#f4f9ff_0%,#e8f2ff_100%)] text-[16px] font-bold uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-4 text-left">Employee</th>
              <th className="px-4 py-4">Check In</th>
              <th className="px-4 py-4">Check Out</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4">Method</th>
              <th className="px-4 py-4">Daily Salary</th>
              {isAdmin && <th className="px-4 py-4">Action</th>}
            </tr>
          </thead>

          <tbody>
            {currentRecords.map((employee) => (
              <AttendanceRow
                key={employee.id}
                employee={employee}
                isAdmin={isAdmin}
                onCheckIn={handleCheckIn}
                onCheckOut={handleCheckOut}
              />
            ))}

            {currentRecords.length === 0 && (
              <tr>
                <td
                  colSpan={isAdmin ? 7 : 6}
                  className="text-center p-6"
                >
                  No data found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* PAGINATION */}
        {totalPages > 1 && (
          <div className="flex flex-col gap-3 rounded-[22px] border border-blue-100 bg-white px-4 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="text-[17px] font-bold text-slate-600">
              Page {currentPage} of {totalPages} • Showing {(currentPage - 1) * recordsPerPage + 1}-{Math.min(currentPage * recordsPerPage, filteredEmployees.length)} of {filteredEmployees.length}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => prev - 1)}
                disabled={currentPage === 1}
                className="rounded-full border border-blue-100 px-4 py-2.5 text-[17px] font-bold text-slate-700 transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>

              {[...Array(totalPages)].map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`h-10 min-w-[40px] rounded-full px-3 text-[17px] font-bold transition ${
                    currentPage === i + 1
                      ? "bg-gradient-to-r from-blue-800 to-sky-500 text-white shadow-[0_10px_25px_rgba(37,99,235,0.28)]"
                      : "border border-blue-100 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
                  }`}
                >
                  {i + 1}
                </button>
              ))}

              <button
                onClick={() => setCurrentPage((prev) => prev + 1)}
                disabled={currentPage >= totalPages}
                className="rounded-full border border-blue-100 px-4 py-2.5 text-[17px] font-bold text-slate-700 transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* MODAL - admin only */}
      {isAdmin && showManualEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/50 p-3 backdrop-blur-sm sm:p-4">
          <div className="w-[calc(100%-1.5rem)] max-w-[760px] max-h-[calc(100vh-1.5rem)] sm:max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="mx-auto flex w-full flex-col overflow-hidden rounded-[32px] border border-white/60 bg-[linear-gradient(180deg,#ffffff_0%,#f5f9ff_100%)] p-5 shadow-[0_30px_90px_rgba(15,40,90,0.28)] sm:p-7">
              <AttendanceForm
                onSubmit={handleManualSubmit}
                onCancel={() => setShowManualEntry(false)}
                employees={staff}
                initialData={{ date }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
