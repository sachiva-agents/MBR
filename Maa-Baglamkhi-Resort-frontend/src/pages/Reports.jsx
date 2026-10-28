import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaCalendarAlt,
  FaChartLine,
  FaDownload,
  FaFileInvoice,
  FaPrint,
  FaSearch,
  FaSyncAlt,
  FaWallet,
} from "react-icons/fa";

import ReportCharts from "../components/Reports/ReportCharts";
import ReportFilters from "../components/Reports/ReportFilters";
import ReportTable from "../components/Reports/ReportTable";
import ReportTypeSelector from "../components/Reports/ReportTypeSelector";
import API from "../api";
import { localDate } from "../utils/localDate";

const REPORT_TYPES = [
  { id: "room", label: "Room", note: "Occupancy and stay performance" },
  { id: "banquet", label: "Banquet", note: "Events, halls and settlement" },
  { id: "restaurant", label: "Restaurant", note: "Orders and food sales" },
  { id: "housekeeping", label: "Housekeeping", note: "Room status and staff load" },
  { id: "accounts", label: "Accounts", note: "Income, expense and net flow" },
  { id: "expense", label: "Expense", note: "Expense breakdown by department and category" },
  { id: "all-bills", label: "All Bills", note: "Combined billing across modules" },
  { id: "attendance", label: "Attendance", note: "Daily staff attendance and earned pay" },
];

const PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer"];
const HALLS = [
  "Grand Ballroom",
  "Garden Banquet",
  "Crystal Hall",
  "Board Room",
];
const STATUSES = [
  "All",
  "Pending",
  "Confirmed",
  "Completed",
  "Billed",
  "Vacant Dirty",
  "Vacant Clean",
  "Occupied",
  "Posted",
];

const formatCurrency = (amount) =>
  `Rs. ${Number(amount || 0).toLocaleString("en-IN")}`;

const todayISO = () => localDate();
const normalizeDate = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return localDate(parsed);
  }

  return raw.slice(0, 10);
};
const normalizePaymentMode = (value, fallback = "N/A") => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};
const toAmount = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number(values[0]) || 0;
};

function inDateRange(dateISO, fromISO, toISO) {
  if (!dateISO) return false;
  if (fromISO && dateISO < fromISO) return false;
  if (toISO && dateISO > toISO) return false;
  return true;
}

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getPrimaryValue(reportType, rows) {
  if (reportType === "banquet") {
    return formatCurrency(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  }
  if (reportType === "restaurant") {
    return formatCurrency(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  }
  if (reportType === "accounts" || reportType === "all-bills" || reportType === "expense") {
    return formatCurrency(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  }
  if (reportType === "housekeeping") {
    return String(rows.reduce((sum, row) => sum + (Number(row.rooms) || 0), 0));
  }
  if (reportType === "attendance") {
    return formatCurrency(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  }
  return formatCurrency(rows.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0));
}

function getInsight(reportType, rows) {
  if (!rows.length) {
    return "Current filters ke liye koi report row available nahi hai.";
  }

  if (reportType === "banquet") {
    const topHall = rows.reduce(
      (best, row) =>
        Number(row.amount || 0) > Number(best.amount || 0) ? row : best,
      rows[0]
    );
    return `Top banquet entry ${topHall.hall || "Hall"} se aa rahi hai with ${formatCurrency(topHall.amount)}.`;
  }

  if (reportType === "restaurant") {
    const busiest = rows.reduce(
      (best, row) =>
        Number(row.amount || 0) > Number(best.amount || 0) ? row : best,
      rows[0]
    );
    return `Restaurant ka strongest billing day ${busiest.date || "selected period"} hai with ${formatCurrency(busiest.amount)}.`;
  }

  if (reportType === "accounts") {
    const income = rows
      .filter((row) => row.type === "Income")
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const expense = rows
      .filter((row) => row.type === "Expense")
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return `Net position ${formatCurrency(income - expense)} hai for selected account transactions.`;
  }

  if (reportType === "expense") {
    if (!rows.length) {
      return "Selected period me koi expense record available nahi hai.";
    }
    const departmentTotals = new Map();
    rows.forEach((row) => {
      const dept = row.department || "Other";
      departmentTotals.set(dept, (departmentTotals.get(dept) || 0) + (Number(row.amount) || 0));
    });
    const topDepartment = Array.from(departmentTotals.entries()).sort(
      (left, right) => right[1] - left[1],
    )[0];
    return topDepartment
      ? `Top expense department ${topDepartment[0]} hai contributing ${formatCurrency(topDepartment[1])} in selected range.`
      : "No expense department data available.";
  }

  if (reportType === "housekeeping") {
    const open = rows.filter((row) => row.status === "Vacant Dirty").length;
    return `${open} rooms abhi immediate cleaning attention demand kar rahe hain.`;
  }

  if (reportType === "attendance") {
    const present = rows.filter((row) => row.status === "Present").length;
    const earned = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return `${present} present entries recorded and ${formatCurrency(earned)} earned from attendance in selected range.`;
  }

  if (reportType === "all-bills") {
    const topBill = rows.reduce(
      (best, row) =>
        Number(row.amount || 0) > Number(best.amount || 0) ? row : best,
      rows[0]
    );
    return `Highest bill ${topBill.source || "module"} source se hai at ${formatCurrency(topBill.amount)}.`;
  }

  const active = rows.filter((row) => row.status === "Occupied").length;
  return `${active} room bookings occupied status mein hain within the selected range.`;
}

async function loadRoomReportRows() {
  const [bookingRes, folioRes] = await Promise.all([
    API.get("/hotel/all-bookings"),
    API.get("/accounts/hotel-billing"),
  ]);

  const rows = Array.isArray(bookingRes.data) ? bookingRes.data : [];
  const billingRows = Array.isArray(folioRes.data) ? folioRes.data : [];

  // Build a map of bookingId -> billing data (includes folioCharges, paidAmount, remainingAmount, paymentStatus)
  const billingMap = new Map();
  billingRows.forEach((r) => {
    billingMap.set(String(r.bookingId || r.id), {
      folioCharges: Number(r.folioCharges) || 0,
      paidAmount: Number(r.paidAmount) || 0,
      remainingAmount: Number(r.remainingAmount) || 0,
      paymentStatus: r.paymentStatus || "Pending",
      paymentMode: r.paymentMode || "Pending",
      totalAmount: Number(r.totalAmount) || 0,
      updatedTotalAmount: Number(r.updatedTotalAmount) || Number(r.totalAmount) || 0,
    });
  });

  return rows.map((row) => {
    const bid = String(row.bookingId || row.id);
    const b = billingMap.get(bid) || {};

    const roomCharges = Number(row.totalAmount) || 0;
    const folioCharges = b.folioCharges || 0;
    const updatedTotal = roomCharges + folioCharges;

    return {
      id: row.bookingId || row.id,
      date: normalizeDate(row.check_in || row.date),
      guest: row.guest_name || row.customerName || "Guest",
      roomNumber: row.rooms || row.roomNo || row.roomNumber || "-",
      roomType: row.roomType || row.room_type || row.categoryName || row.category_name || "Room",
      status: row.booking_status || row.bookingStatus || "Confirmed",
      paymentMode: normalizePaymentMode(b.paymentMode || row.paymentMode, "Pending"),
      revenue: updatedTotal,
      roomCharges,
      folioCharges,
      updatedTotalAmount: updatedTotal,
      advancePaid: b.paidAmount || 0,
      remainingAmount: b.remainingAmount || updatedTotal,
      paymentStatus: b.paymentStatus || "Pending",
      checkOut: normalizeDate(row.check_out),
    };
  });
}

async function loadBanquetReportRows() {
  const response = await API.get("/banquet");
  const halls = Array.isArray(response.data?.halls) ? response.data.halls : [];
  const bookings = Array.isArray(response.data?.bookings) ? response.data.bookings : [];
  const hallLookup = new Map(
    halls.map((hall) => [String(hall.id), hall.name || hall.hallName || `Hall ${hall.id}`]),
  );

  return bookings.map((row) => ({
    id: row.id,
    date: normalizeDate(row.date),
    hall:
      row.hallName ||
      row.hall ||
      hallLookup.get(String(row.hallId || row.hall_id || "")) ||
      "Banquet Hall",
    status: row.status || "Confirmed",
    eventType: row.eventType || row.event_type || row.eventTitle || "Banquet Event",
    guests: Number(row.guests) || 0,
    amount: toAmount(row.grandTotal, row.totalAmount, row.total, row.amount, row.advance),
    paymentMode: normalizePaymentMode(row.paymentMode || row.paymentStatus),
  }));
}

async function loadRestaurantReportRows() {
  const response = await API.get("/accounts/restaurant-billing");
  const rows = Array.isArray(response.data) ? response.data : [];

  return rows.map((row) => ({
    id: row.id,
    date: normalizeDate(row.date),
    table_number: row.locationLabel || row.tableNumber || row.table_number || row.reference || "-",
    status: row.paymentStatus || row.status || "Pending",
    paymentMode: normalizePaymentMode(row.paymentMode, "Pending"),
    amount: Number(row.total) || 0,
  }));
}

async function loadHousekeepingReportRows() {
  const response = await API.get("/housekeeping");
  const rows = Array.isArray(response.data) ? response.data : [];

  return rows.map((row) => ({
    id: row.id,
    date: normalizeDate(row.updated_at || row.created_at || row.date),
    roomNo: row.roomNo || row.room_number || "-",
    roomType: row.roomType || row.room_type || row.categoryName || row.category_name || "Room",
    status: row.status || "Pending",
    assignee: row.assignee || "Unassigned",
    rooms: 1,
  }));
}

async function loadAccountsReportRows() {
  const response = await API.get("/accounts/transactions");
  const rows = Array.isArray(response.data) ? response.data : [];

  return rows.map((row) => ({
    id: row.id,
    date: normalizeDate(row.date),
    type: row.type || "Income",
    description: row.description || "Accounts transaction",
    amount: Number(row.amount) || 0,
    paymentMode: normalizePaymentMode(row.paymentMode, "N/A"),
    status: "Posted",
  }));
}

async function loadExpenseReportRows() {
  const response = await API.get("/accounts/transactions");
  const rows = Array.isArray(response.data) ? response.data : [];

  return rows
    .filter((row) => (row.type || "").toLowerCase() === "expense")
    .map((row) => ({
      id: row.id,
      date: normalizeDate(row.date),
      type: row.type || "Expense",
      description: row.description || "Expense entry",
      amount: Number(row.amount) || 0,
      paymentMode: normalizePaymentMode(row.paymentMode, "N/A"),
      department: row.department || "Other",
      sourceModule: row.sourceModule || row.source_module || "Accounts",
    }));
}

async function loadAllBillsReportRows() {
  const [hotelRes, restaurantRes, banquetRes, accountsRes] = await Promise.all([
    API.get("/accounts/hotel-billing"),
    API.get("/accounts/restaurant-billing"),
    API.get("/banquet"),
    API.get("/accounts/transactions"),
  ]);

  const hotelRows = (Array.isArray(hotelRes.data) ? hotelRes.data : []).map((row) => ({
    id: `hotel-${row.bookingId || row.id}`,
    date: normalizeDate(row.date || row.check_out || row.check_in),
    source: "Hotel",
    billNo: row.bookingCode || `HOT-${String(row.bookingId || row.id || "").padStart(6, "0")}`,
    description: `${row.customerName || row.guest_name || "Guest"} / Room ${row.roomNo || row.rooms || "-"}`,
    amount: Number(row.totalAmount) || 0,
    paymentMode: normalizePaymentMode(row.paymentMode, "Pending"),
    status: row.paymentStatus || row.bookingStatus || "Pending",
    type: "Income",
  }));

  const restaurantRows = (Array.isArray(restaurantRes.data) ? restaurantRes.data : []).map((row) => ({
    id: String(row.id || ""),
    date: normalizeDate(row.date),
    source: "Restaurant",
    billNo: row.reference || `RES-${row.actionId || row.id || ""}`,
    description: `${row.customerName || "Walk-in"} / ${row.locationLabel || "Restaurant"}`,
    amount: Number(row.total) || 0,
    paymentMode: normalizePaymentMode(row.paymentMode, "Pending"),
    status: row.paymentStatus || "Pending",
    type: "Income",
  }));

  const banquetPayload = banquetRes.data || {};
  const banquetHalls = Array.isArray(banquetPayload.halls) ? banquetPayload.halls : [];
  const banquetBookings = Array.isArray(banquetPayload.bookings) ? banquetPayload.bookings : [];
  const banquetHallLookup = new Map(
    banquetHalls.map((hall) => [String(hall.id), hall.name || hall.hallName || `Hall ${hall.id}`]),
  );
  const banquetRows = banquetBookings.map((row) => ({
    id: `banquet-${row.id}`,
    date: normalizeDate(row.date),
    source: "Banquet",
    billNo: row.invoiceNo || `BNQ-${String(row.id || "").padStart(6, "0")}`,
    description: `${row.customerName || row.eventType || "Banquet booking"} / ${
      row.hallName || row.hall || banquetHallLookup.get(String(row.hallId || row.hall_id || "")) || "Banquet Hall"
    }`,
    amount: toAmount(row.grandTotal, row.totalAmount, row.total, row.amount, row.advance),
    paymentMode: normalizePaymentMode(row.paymentMode || row.paymentStatus),
    status: row.status || "Confirmed",
    type: "Income",
  }));

  const accountsRows = (Array.isArray(accountsRes.data) ? accountsRes.data : []).map((row) => ({
    id: `accounts-${row.id}`,
    date: normalizeDate(row.date),
    source: "Accounts",
    billNo: `ACC-${String(row.id || "").padStart(6, "0")}`,
    description: row.description || "Accounts transaction",
    amount: Number(row.amount) || 0,
    paymentMode: normalizePaymentMode(row.paymentMode, "N/A"),
    status: "Posted",
    type: row.type || "Income",
  }));

  return [...hotelRows, ...restaurantRows, ...banquetRows, ...accountsRows].sort((left, right) => {
    if (left.date === right.date) return String(right.id).localeCompare(String(left.id));
    return String(right.date || "").localeCompare(String(left.date || ""));
  });
}

const ATTENDANCE_STATUS_LABEL = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half Day",
  on_leave: "On Leave",
  holiday: "Holiday",
  week_off: "Week Off",
};

async function loadAttendanceReportRows(dateFrom, dateTo) {
  const params = {};
  if (dateFrom) params.from = dateFrom;
  if (dateTo) params.to = dateTo;
  const response = await API.get("/attendance/report", { params });
  const payload = response.data || {};

  const rows = Array.isArray(payload.rows)
    ? payload.rows
    : (Array.isArray(payload.employees) ? payload.employees.flatMap((e) => e.days || []) : []);

  return rows
    .map((row) => ({
      id: row.id,
      date: normalizeDate(row.date),
      employee: row.name || row.employeeName || "Unassigned",
      department: row.department || row.departmentName || "Other",
      designation: row.designation || row.role || "-",
      checkIn: row.checkIn || row.in_time || null,
      checkOut: row.checkOut || row.out_time || null,
      status: ATTENDANCE_STATUS_LABEL[String(row.status || "").toLowerCase()] || row.statusLabel || row.status || "-",
      method: row.method || "Manual",
      amount: Number(row.salary_amount || 0),
      monthlySalary: Number(row.user_salary || 0),
    }))
    .sort((left, right) =>
      String(left.date || "").localeCompare(String(right.date || ""))
    );
}

async function loadReportRows(reportType, filters) {
  if (reportType === "room") return loadRoomReportRows();
  if (reportType === "banquet") return loadBanquetReportRows();
  if (reportType === "restaurant") return loadRestaurantReportRows();
  if (reportType === "housekeeping") return loadHousekeepingReportRows();
  if (reportType === "accounts") return loadAccountsReportRows();
  if (reportType === "expense") return loadExpenseReportRows();
  if (reportType === "all-bills") return loadAllBillsReportRows();
  if (reportType === "attendance") return loadAttendanceReportRows(filters?.dateFrom, filters?.dateTo);
  return [];
}

/* ------------------------------------------------------------------ */
/* Shared premium UI primitives (design tokens match User Management  */
/* / Audit Logs: deep blue gradient hero, white glass cards, rounded  */
/* corners, soft layered shadows, blue focus states).                 */
/* ------------------------------------------------------------------ */

const CARD_BASE =
  "rounded-2xl sm:rounded-[24px] border border-slate-200/70 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl";

/* Requested palette */
const BRAND = {
  primary: "#1D4ED8",
  secondary: "#2563EB",
  accent: "#38BDF8",
  bg: "#F8FAFC",
};

const SummaryPanel = ({ cards }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {cards.map((card) => (
      <div
        key={card.label}
        className={`${CARD_BASE} group flex h-full flex-col p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[#BFDBFE] hover:shadow-[0_18px_40px_rgba(29,78,216,0.14)] sm:p-6`}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1D4ED8]/10 text-[#1D4ED8] shadow-[inset_0_0_0_1px_rgba(29,78,216,0.12)] transition-transform duration-300 group-hover:scale-105">
            {card.icon}
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-sm md:text-[16px]">
            {card.label}
          </span>
        </div>
        <div className="mt-4 text-[26px] font-bold leading-none text-slate-900 sm:text-[30px] md:text-[34px] lg:text-[42px]">
          {card.value}
        </div>
        <div className="mt-3 text-sm font-medium leading-6 text-slate-500 sm:text-[16px]">
          {card.note}
        </div>
      </div>
    ))}
  </div>
);

const Reports = () => {
  const [reportType, setReportType] = useState("room");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState(null);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: todayISO(),
    status: "All",
    hall: "All",
    roomType: "All",
    paymentMode: "All",
    department: "All",
  });

  const reportMeta = useMemo(
    () => REPORT_TYPES.find((item) => item.id === reportType),
    [reportType]
  );

  const options = useMemo(
    () => {
      const dynamicStatuses = Array.from(
        new Set(data.map((row) => row.status).filter(Boolean)),
      );
      const dynamicHalls = Array.from(
        new Set(data.map((row) => row.hall).filter(Boolean)),
      );
      const dynamicRoomTypes = Array.from(
        new Set(data.map((row) => row.roomType).filter(Boolean)),
      );
      const dynamicPaymentModes = Array.from(
        new Set(data.map((row) => row.paymentMode).filter(Boolean)),
      );
      const dynamicDepartments = Array.from(
        new Set(data.map((row) => row.department).filter(Boolean)),
      );

      const mergeOptions = (defaults, dynamic) => [
        "All",
        ...Array.from(new Set([...defaults, ...dynamic].filter((item) => item && item !== "All"))),
      ];

      return {
        statuses: mergeOptions(STATUSES, dynamicStatuses),
        halls: mergeOptions(HALLS, dynamicHalls),
        roomTypes: mergeOptions([], dynamicRoomTypes),
        paymentModes: mergeOptions(PAYMENT_MODES, dynamicPaymentModes),
        departments: mergeOptions([], dynamicDepartments),
      };
    },
    [data]
  );

  const visibleFilters = useMemo(
    () => ({
      hall: reportType === "banquet",
      roomType: reportType === "room" || reportType === "housekeeping",
      department: reportType === "expense",
      paymentMode:
        reportType === "accounts" ||
        reportType === "restaurant" ||
        reportType === "room" ||
        reportType === "all-bills" ||
        reportType === "expense",
      status: reportType === "room" || reportType === "banquet" || reportType === "all-bills",
    }),
    [reportType]
  );

  useEffect(() => {
    let active = true;

    const fetchSummary = async () => {
      try {
        const res = await API.get("/reports/summary");
        if (active) setSummary(res.data);
      } catch (err) {
        console.error("Error loading report summary", err);
        if (active) setSummary(null);
      }
    };

    fetchSummary();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return data.filter((row) => {
      if (!inDateRange(row.date, filters.dateFrom, filters.dateTo)) {
        return false;
      }
      if (filters.status !== "All" && row.status && row.status !== filters.status) {
        return false;
      }
      if (filters.hall !== "All" && row.hall && row.hall !== filters.hall) {
        return false;
      }
      if (
        filters.roomType !== "All" &&
        row.roomType &&
        row.roomType !== filters.roomType
      ) {
        return false;
      }
      if (
        filters.paymentMode !== "All" &&
        row.paymentMode &&
        row.paymentMode !== filters.paymentMode
      ) {
        return false;
      }
      if (
        filters.department !== "All" &&
        row.department &&
        row.department !== filters.department
      ) {
        return false;
      }
      if (!q) return true;

      return Object.values(row).join(" ").toLowerCase().includes(q);
    });
  }, [data, filters, query]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    let lastError = null;

    try {
      const rows = await loadReportRows(reportType, filters);
      setData(Array.isArray(rows) ? rows : []);
      setLastFetchedAt(new Date());
    } catch (err) {
      lastError = err;
      console.error("Error fetching report data", err);
      setData([]);
    } finally {
      setLoading(false);
    }

    if (lastError) {
      const status = Number(lastError.response?.status);
      setError(
        status
          ? `The reports service rejected this request (HTTP ${status}). ` +
            "The table below is empty; adjust the filters and try again."
          : "Unable to load report data right now. Please refresh and try again."
      );
    }
  }, [reportType, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const flashActionNotice = (message) => {
    setActionNotice(message);
    window.setTimeout(() => setActionNotice(""), 4000);
  };

  const exportCSV = () => {
    const csv = toCSV(filtered);
    if (!csv) {
      flashActionNotice("No rows to export");
      return;
    }
    downloadText(`report-${reportType}-${todayISO()}.csv`, csv);
  };

  const printReport = () => {
    const rows = filtered;
    if (!rows.length) {
      flashActionNotice("No data to print.");
      return;
    }

    const reportLabel = reportMeta?.label || reportType;
    const today = todayISO();
    const dateRangeText =
      filters.dateFrom && filters.dateTo
        ? `${filters.dateFrom} to ${filters.dateTo}`
        : filters.dateFrom
          ? `From ${filters.dateFrom}`
          : filters.dateTo
            ? `Until ${filters.dateTo}`
            : "All dates";

    const fmtCurrency = (v) =>
      `Rs. ${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Build columns based on report type
    let columns = [];
    if (reportType === "room") {
      columns = [
        { key: "date", label: "Date" },
        { key: "guest", label: "Guest" },
        { key: "roomNumber", label: "Room No" },
        { key: "roomType", label: "Room Type" },
        { key: "status", label: "Status" },
        { key: "paymentMode", label: "Payment Mode" },
        { key: "roomCharges", label: "Room Charges", format: fmtCurrency },
        { key: "folioCharges", label: "Folio Charges", format: fmtCurrency },
        { key: "updatedTotalAmount", label: "Total Amount", format: fmtCurrency },
        { key: "advancePaid", label: "Advance Paid", format: fmtCurrency },
        { key: "remainingAmount", label: "Balance Due", format: fmtCurrency },
        { key: "paymentStatus", label: "Payment Status" },
      ];
    } else if (reportType === "banquet") {
      columns = [
        { key: "date", label: "Date" },
        { key: "hall", label: "Hall" },
        { key: "status", label: "Status" },
        { key: "eventType", label: "Event Type" },
        { key: "guests", label: "Guests" },
        { key: "amount", label: "Amount", format: fmtCurrency },
        { key: "paymentMode", label: "Payment Mode" },
      ];
    } else if (reportType === "restaurant") {
      columns = [
        { key: "date", label: "Date" },
        { key: "table_number", label: "Table" },
        { key: "status", label: "Status" },
        { key: "paymentMode", label: "Payment Mode" },
        { key: "amount", label: "Amount", format: fmtCurrency },
      ];
    } else if (reportType === "housekeeping") {
      columns = [
        { key: "date", label: "Date" },
        { key: "roomNo", label: "Room No" },
        { key: "roomType", label: "Room Type" },
        { key: "status", label: "Status" },
        { key: "assignee", label: "Assignee" },
        { key: "rooms", label: "Rooms" },
      ];
    } else if (reportType === "accounts") {
      columns = [
        { key: "date", label: "Date" },
        { key: "type", label: "Type" },
        { key: "description", label: "Description" },
        { key: "amount", label: "Amount", format: fmtCurrency },
        { key: "paymentMode", label: "Payment Mode" },
        { key: "status", label: "Status" },
      ];
    } else if (reportType === "expense") {
      columns = [
        { key: "date", label: "Date" },
        { key: "department", label: "Department" },
        { key: "description", label: "Description" },
        { key: "amount", label: "Amount", format: fmtCurrency },
        { key: "paymentMode", label: "Payment Mode" },
        { key: "sourceModule", label: "Source" },
      ];
    } else if (reportType === "all-bills") {
      columns = [
        { key: "date", label: "Date" },
        { key: "source", label: "Source" },
        { key: "billNo", label: "Bill No" },
        { key: "description", label: "Description" },
        { key: "amount", label: "Amount", format: fmtCurrency },
        { key: "paymentMode", label: "Payment Mode" },
        { key: "status", label: "Status" },
        { key: "type", label: "Type" },
      ];
    } else if (reportType === "attendance") {
      columns = [
        { key: "date", label: "Date" },
        { key: "employee", label: "Employee" },
        { key: "department", label: "Department" },
        { key: "designation", label: "Designation" },
        { key: "checkIn", label: "Check In" },
        { key: "checkOut", label: "Check Out" },
        { key: "status", label: "Status" },
        { key: "method", label: "Method" },
        { key: "amount", label: "Earned Pay", format: fmtCurrency },
      ];
    }

    // Build table rows
    const bodyRows = rows
      .map(
        (row) =>
          `<tr>${columns
            .map(
              (col) =>
                `<td class="td-${col.key}">${col.format ? col.format(row[col.key]) : (row[col.key] || "-")}</td>`,
            )
            .join("")}</tr>`,
      )
      .join("");

    // Compute totals for currency columns
    const totalsRow =
      columns.some((c) => c.format) ?
        `<tr class="totals-row">
          <td colspan="${columns.findIndex((c) => c.format)}" style="font-weight:800;text-align:right">Total</td>
          ${columns
            .filter((c) => c.format)
            .map(
              (c) =>
                `<td style="font-weight:800;text-align:right">${fmtCurrency(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0))}</td>`,
            )
            .join("")}
        </tr>` :
        "";

    const win = window.open("", "_blank", "width=1000,height=700");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${reportLabel} Report</title>
  <style>
    @page { size: A4 landscape; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      color: #1f2937;
      padding: 20px;
    }
    h1 {
      font-size: 20px;
      font-weight: 800;
      text-align: center;
      margin-bottom: 4px;
    }
    .subtitle {
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 2px;
    }
    .meta {
      text-align: center;
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    thead th {
      background: #1e3a8a;
      color: #ffffff;
      padding: 6px 8px;
      font-weight: 700;
      text-align: left;
      border: 1px solid #1e3a8a;
      white-space: nowrap;
    }
    tbody td {
      padding: 5px 8px;
      border: 1px solid #d1d5db;
      vertical-align: top;
    }
    tbody tr:nth-child(even) {
      background: #f3f4f6;
    }
    .totals-row td {
      background: #e5e7eb !important;
      font-weight: 800;
      border: 1px solid #9ca3af;
    }
    .footer {
      margin-top: 16px;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <h1>${reportLabel} Report</h1>
  <div class="subtitle">MAA BAGLAMUKHI RESORT</div>
  <div class="meta">Period: ${dateRangeText} | Generated: ${today} | Total Rows: ${rows.length}</div>
  <table>
    <thead>
      <tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr>
    </thead>
    <tbody>${bodyRows}${totalsRow}</tbody>
  </table>
  <div class="footer">Generated on ${today} at ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const applyQuickRange = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);

    setFilters((prev) => ({
      ...prev,
      dateFrom: localDate(d),
      dateTo: todayISO(),
    }));
  };

  const summaryCards = useMemo(() => {
    const rowsCount = filtered.length;
    const primaryValue = getPrimaryValue(reportType, filtered);
    const uniqueDays = new Set(filtered.map((row) => row.date).filter(Boolean)).size;
    const activeStatuses = new Set(filtered.map((row) => row.status).filter(Boolean)).size;

    const totalExpense = filtered.reduce(
      (sum, row) => sum + (Number(row.amount) || 0),
      0,
    );
    const uniqueDepartments = new Set(
      filtered.map((row) => row.department).filter(Boolean),
    ).size;

    return [
      {
        label: "Visible Rows",
        value: rowsCount,
        note: "The report rows currently visible after applying filters and search.",
        icon: <FaSearch className="text-[16px]" />,
      },
      {
        label: reportType === "expense" ? "Total Expense" : "Primary Total",
        value: primaryValue,
        note:
          reportType === "expense"
            ? "Sum of all expense entries in the selected date range."
            : reportType === "housekeeping"
              ? "Total room count in selected rows."
              : "Overall business total for the selected report type.",
        icon:
          reportType === "expense" ? (
            <FaWallet className="text-[16px]" />
          ) : (
            <FaChartLine className="text-[16px]" />
          ),
      },
      {
        label: "Active Days",
        value: uniqueDays || "--",
        note: "How many distinct dates’ records are currently visible on the screen.",
        icon: <FaCalendarAlt className="text-[16px]" />,
      },
      {
        label: reportType === "expense" ? "Departments" : "Status Mix",
        value: reportType === "expense" ? uniqueDepartments || "--" : activeStatuses || "--",
        note:
          reportType === "expense"
            ? `${uniqueDepartments} unique department(s) contributing ${formatCurrency(totalExpense)} in selected range.`
            : "Selected rows unique operational statuses.",
        icon: <FaSyncAlt className="text-[16px]" />,
      },
    ];
  }, [filtered, reportType]);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#F8FAFC]">
      <div className="w-full space-y-6 px-3 py-4 sm:space-y-7 sm:px-5 sm:py-6 md:px-8 md:py-8 lg:px-10 xl:px-12">
        {/* ---------------------------------------------------------- */}
        {/* Hero                                                       */}
        {/* ---------------------------------------------------------- */}
        <section className="relative w-full overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,theme(colors.blue.950),theme(colors.blue.700),theme(colors.sky.500))] px-5 py-7 shadow-[0_24px_60px_rgba(29,78,216,0.28)] sm:rounded-[28px] sm:px-7 sm:py-8 md:px-9 lg:px-10">
          {/* decorative abstract shapes */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-[#38BDF8]/25 blur-3xl sm:h-80 sm:w-80" />
            <div className="absolute -right-10 top-[-10%] h-72 w-72 rounded-full bg-[#60A5FA]/25 blur-3xl sm:h-96 sm:w-96" />
            <div className="absolute bottom-[-30%] left-[30%] h-64 w-64 rounded-full bg-[#38BDF8]/10 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:44px_44px] opacity-40" />
          </div>

          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.9fr)] lg:items-center">
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-wide text-sky-200 sm:text-sm md:text-[14px]">
                Insight Studio
              </p>
              <div className="space-y-2">
                <h1 className="text-[26px] font-black leading-tight text-white sm:text-[32px] md:text-[36px] lg:text-[40px]">
                  Reports built for faster daily decisions
                </h1>
                
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={fetchData}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-[#1D4ED8] shadow-[0_16px_35px_rgba(255,255,255,0.18)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[linear-gradient(90deg,#1D4ED8_0%,#2563EB_100%)] hover:text-white hover:shadow-[0_18px_38px_rgba(37,99,235,0.35)] disabled:cursor-not-allowed disabled:opacity-70 sm:text-[16px]"
                >
                  <FaSyncAlt className={loading ? "animate-spin" : ""} />
                  {loading ? "Refreshing..." : "Refresh Reports"}
                </button>
                <button
                  type="button"
                  onClick={exportCSV}
                  className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200/60 hover:bg-white/20 hover:shadow-[0_16px_35px_rgba(56,189,248,0.22)] sm:text-[16px]"
                >
                  Export Current Report
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                { label: "Current Type", value: reportMeta?.label || reportType, icon: <FaSyncAlt /> },
                { label: "Visible Rows", value: filtered.length || 0, icon: <FaSearch /> },
                {
                  label: "Last Update",
                  value: lastFetchedAt
                    ? lastFetchedAt.toLocaleTimeString()
                    : "--",
                  icon: <FaCalendarAlt />,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-[#38BDF8]/50 hover:bg-white/15 hover:shadow-[0_14px_32px_rgba(56,189,248,0.22)]"
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-100/85 sm:text-sm md:text-[16px]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] text-[#BAE0FD]">
                      {item.icon}
                    </span>
                    {item.label}
                  </span>
                  <div className="mt-2 text-[22px] font-bold leading-none sm:text-2xl md:text-[28px]">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Module selector + Insight Snapshot                         */}
        {/* ---------------------------------------------------------- */}
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_380px]">
          <div className={`${CARD_BASE} flex flex-col p-4 sm:p-6`}>
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#1D4ED8] sm:text-sm md:text-[16px]">
                  Report Type
                </p>
                <h2 className="mt-1 text-xl font-black text-slate-900 sm:text-2xl md:text-[28px] lg:text-[34px]">
                  Select analytics module
                </h2>
                <p className="mt-2 text-sm leading-7 text-slate-500 sm:text-[16px]">
                  {reportMeta?.note || "Operational report module"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[7, 30, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => applyQuickRange(days)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2563EB]/40 hover:bg-[linear-gradient(90deg,#1D4ED8_0%,#2563EB_100%)] hover:text-white hover:shadow-[0_14px_28px_rgba(37,99,235,0.24)] sm:text-[16px]"
                  >
                    Last {days} days
                  </button>
                ))}
              </div>
            </div>
            <ReportTypeSelector
              value={reportType}
              onChange={setReportType}
              types={REPORT_TYPES}
            />
          </div>

          <div className={`${CARD_BASE} flex flex-col p-4 sm:p-6`}>
            <p className="text-xs font-bold uppercase tracking-wide text-[#1D4ED8] sm:text-sm md:text-[16px]">
              Insight Snapshot
            </p>
            <div className="mt-3 flex items-start gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1D4ED8_0%,#2563EB_100%)] text-[20px] text-white shadow-[0_10px_24px_rgba(29,78,216,0.28)]">
                <FaChartLine />
              </span>
              <div>
                <div className="text-lg font-bold text-slate-900 sm:text-xl">Smart takeaway</div>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600 sm:text-[16px]">
                  {getInsight(reportType, filtered)}
                </p>
              </div>
            </div>
            {summary ? (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
                {[
                  ["Rooms", summary.totalRooms],
                  ["Hotel", summary.hotelBookings],
                  ["Banquet", summary.banquetBookings],
                  ["Restaurant", summary.restaurantBills],
                  ["Accounts", summary.accountsTransactions],
                  ["Attendance", summary.attendanceRecords],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-[#EFF6FF] px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#BFDBFE] hover:shadow-[0_10px_24px_rgba(29,78,216,0.10)]"
                  >
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 sm:text-sm">
                      {label}
                    </div>
                    <div className="mt-2 text-[22px] font-bold leading-none text-slate-900 sm:text-[26px]">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Summary cards                                               */}
        {/* ---------------------------------------------------------- */}
        <SummaryPanel cards={summaryCards} />

        {/* ---------------------------------------------------------- */}
        {/* Search + export/print + filters                            */}
        {/* ---------------------------------------------------------- */}
        <section className={`${CARD_BASE} p-4 sm:p-6`}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="relative w-full">
              <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search guest, hall, source, payment mode, amount..."
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-medium text-slate-900 outline-none transition-all duration-300 placeholder:text-slate-400 focus:border-[#38BDF8] focus:ring-4 focus:ring-[#38BDF8]/20 sm:text-[16px]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportCSV}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(90deg,#1D4ED8_0%,#2563EB_100%)] px-5 text-sm font-bold text-white shadow-[0_14px_30px_rgba(29,78,216,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(29,78,216,0.36)] sm:text-[16px]"
              >
                <FaDownload />
                Export CSV
              </button>
              <button
                type="button"
                onClick={printReport}
                className="inline-flex h-12 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2563EB]/40 hover:text-[#1D4ED8] hover:shadow-[0_10px_22px_rgba(28,63,138,0.12)] sm:text-[16px]"
              >
                <FaPrint />
                Print
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#1D4ED8]/8 px-3 py-2 text-sm font-medium text-[#1E3A8A] sm:text-[16px]">
              <FaCalendarAlt />
              {filters.dateFrom || "--"} to {filters.dateTo || "--"}
            </span>
            <span className="rounded-full bg-[#1D4ED8]/8 px-3 py-2 text-sm font-medium text-[#1E3A8A] sm:text-[16px]">
              Rows: <strong className="font-bold">{filtered.length}</strong>
            </span>
            {lastFetchedAt ? (
              <span className="rounded-full bg-[#1D4ED8]/8 px-3 py-2 text-sm font-medium text-[#1E3A8A] sm:text-[16px]">
                Last fetched:{" "}
                <strong className="font-bold">
                  {lastFetchedAt.toLocaleString()}
                </strong>
              </span>
            ) : null}
          </div>
        </section>

        <ReportFilters
          value={filters}
          onChange={setFilters}
          visible={visibleFilters}
          options={options}
        />

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-bold text-rose-700 sm:text-[16px]">
            {error}
          </div>
        ) : null}

        {actionNotice ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-bold text-amber-700 sm:text-[16px]">
            {actionNotice}
          </div>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Charts + report summary                                    */}
        {/* ---------------------------------------------------------- */}
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_380px]">
          <div className={`${CARD_BASE} min-w-0 p-4 sm:p-6`}>
            <ReportCharts reportType={reportType} rows={filtered} />
          </div>

          <div className={`${CARD_BASE} p-4 sm:p-6`}>
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-[0_10px_22px_rgba(217,119,6,0.28)]">
                <FaFileInvoice />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#1D4ED8] sm:text-sm md:text-[16px]">
                  Report Summary
                </p>
                <h2 className="mt-1 text-xl font-black leading-tight text-slate-900 sm:text-2xl md:text-[28px]">
                  Filter-based metrics
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-[#EFF6FF] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#BFDBFE] hover:shadow-[0_10px_22px_rgba(29,78,216,0.10)]"
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-sm">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1D4ED8]/10 text-[#1D4ED8]">
                      {card.icon}
                    </span>
                    {card.label}
                  </div>
                  <div className="mt-2 text-[24px] font-bold leading-none text-slate-900 sm:text-[28px]">
                    {card.value}
                  </div>
                  <div className="mt-2 text-sm font-medium leading-6 text-slate-500 sm:text-[16px]">
                    {card.note}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Table                                                       */}
        {/* ---------------------------------------------------------- */}
        <div className={`${CARD_BASE} overflow-hidden p-0`}>
          <ReportTable reportType={reportType} rows={filtered} loading={loading} />
        </div>
      </div>
    </div>
  );
};

export default Reports;