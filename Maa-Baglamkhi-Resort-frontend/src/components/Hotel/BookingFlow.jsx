// src/components/Hotel/BookingFlow.jsx
//
// ✅ SINGLE-PAGE BOOKING MODULE
// -----------------------------------------------------------------------------
// This ONE file replaces the old multi-route wizard (Guest.jsx -> otherBooking.jsx
// -> Reference.jsx -> company.jsx -> Room.jsx -> Pax.jsx -> RoomTariff.jsx ->
// Advance.jsx -> Communication.jsx) plus AllBooking.jsx / EditBooking.jsx /
// BookingCancelAction.jsx / CollectPayment.jsx.
//
// Everything now lives in ONE component. Nothing here calls `navigate()` to move
// between booking steps — moving between "New Booking / Confirmed / All Bookings /
// Booking Details / Manage Booking" is just a local React state change (`view`),
// so the browser never leaves this page and no data is lost in transit.
//
// -----------------------------------------------------------------------------
// PRINT-INVOICE FIX (this revision):
//  - The "Print" button on the Booking Details screen used to call
//    window.print(), which printed the ENTIRE Booking Details page (Guest
//    Info / Stay Info / Payment Info cards, buttons, everything visible).
//  - It now calls handlePrintInvoiceDirect(), which opens a separate print
//    window containing ONLY a properly formatted A4 tax invoice, built from
//    the SAME live data already on screen (room charges from bookingDetail.rooms,
//    folio/extra charges from folioCharges, advance paid from payment history).
//    This guarantees the printed total always matches what's shown on screen
//    (Room + Folio), instead of a possibly-stale backend invoice.total_amount.
// -----------------------------------------------------------------------------
//
// -----------------------------------------------------------------------------
// BOOKING HISTORY / PAYMENT HISTORY FIX (this revision):
//  - The FlowBar already had "Booking History" and "Payment History" steps,
//    and handleJumpStep already set view to "history" / "payments" and called
//    fetchHistory() / fetchAllPayments() — but there was NO renderHistory() /
//    renderPayments() function, and the final render block never checked for
//    those views. So clicking those tabs changed `view` but rendered nothing.
//  - Added renderHistory() and renderPayments() below, and wired them into the
//    final render block so both tabs now actually display their tables.
// -----------------------------------------------------------------------------
//
// -----------------------------------------------------------------------------
// ID PROOF / ID NUMBER FIELDS (this revision):
//  - Added "ID Proof Type" (dropdown: Aadhar Card / Driving License / Passport /
//    Voter ID / PAN Card / Other) and "ID Number" (text input) to the Guest
//    Information section of the New/Edit Booking form, matching the reference
//    layout image (row placed right after Phone Number, above Stay Details).
//  - These are captured in `formData` (idProofType, idNumber), validated on
//    save, sent to the backend on booking create/edit, and restored when
//    editing an existing booking.
// -----------------------------------------------------------------------------

import axios from "axios";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getBackendBaseURL } from "../../api";

// Booking uploads are large and slow, so this file keeps its own instance with a
// 60s timeout. It mirrors the shared client in src/api.js: same base URL, same
// Bearer token, same audit headers, same 401 handling.
const bookingAPI = axios.create({
  baseURL: getBackendBaseURL() + "/api",
  timeout: 60_000,
  withCredentials: false,
});

bookingAPI.interceptors.request.use((req) => {
  const token = localStorage.getItem("token");
  if (token) req.headers.Authorization = `Bearer ${token}`;
  const method = String(req.method || "get").toLowerCase();
  const inferredAction =
    req.auditAction ||
    (req.url?.includes("/login")
      ? "login"
      : method === "delete"
        ? "delete"
        : method === "put" || method === "patch"
          ? "update"
          : method === "post"
            ? "create"
            : "read");
  req.headers["X-Audit-Action"] = inferredAction;
  req.headers["X-Audit-Source"] = "frontend";
  return req;
});

bookingAPI.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.skipAuthRedirect) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("name");
      localStorage.removeItem("email");
      localStorage.removeItem("isAuthenticated");
      if (window.location.pathname !== "/login") {
        window.location.assign(`${window.location.origin}/login`);
      }
    }
    return Promise.reject(err);
  },
);

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  FaPlus,
  FaEye,
  FaEdit,
  FaTrash,
  FaSearch,
  FaFilter,
  FaDownload,
  FaCheckCircle,
  FaTimes,
  FaExclamationTriangle,
  FaPrint,
  FaEnvelope,
  FaWhatsapp,
  FaPaperPlane,
  FaUser,
  FaPhone,
  FaCommentDots,
  FaListUl,
  FaUserPlus,
  FaCogs,
  FaSignInAlt,
  FaSignOutAlt,
  FaBan,
  FaMoneyBillWave,
  FaUndo,
  FaChevronLeft,
  FaChevronRight,
  FaBook,
  FaHistory,
  FaFileUpload,
  FaFileAlt,
  FaUsers,
  FaUserFriends,
  FaChartBar,
  FaChartLine,
  FaIdCard,
  FaDoorOpen,
  FaSync,
  FaArrowLeft,
  FaHotel,
  FaMapMarkerAlt,
  FaCreditCard,
  FaKey,
} from "react-icons/fa";

import API from "../../api";
import { todayISO } from "../Dashboard/stayoverUtils";
import { setStoredBookingId, setStoredBookingCode } from "./bookingSession";
import FolioView from "./FolioView";
import GroupBooking from "./GroupBooking";
import OccupancyForecast from "./OccupancyForecast";
import GuestProfile from "./GuestProfile";
import Room, { DEFAULT_ROOMS } from "./Room";
import { normalizeRoomCategories } from "../../utils/roomCategories";

/* ─────────────────────────── shared style tokens ─────────────────────────── */

const fieldCls =
  "w-full h-[52px] sm:h-[54px] md:h-14 rounded-2xl border border-blue-200 bg-white px-4 sm:px-5 text-[17px] font-medium text-slate-800 shadow-sm transition-all duration-300 placeholder:text-base placeholder:font-medium placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:shadow-lg outline-none";

const labelCls = "mb-2 block text-[17px] font-semibold text-slate-700";

const panelCls = `
rounded-[24px] sm:rounded-[30px]
bg-white
border
border-blue-100
p-5 sm:p-6 md:p-8 lg:p-10
shadow-xl
shadow-blue-100/60
transition-all
duration-300
w-full
max-w-full
overflow-hidden
`;

const sectionTitleCls = `
mb-5 sm:mb-6
flex
items-center
gap-3
border-b-2
border-blue-100
pb-3 sm:pb-4
text-2xl sm:text-3xl md:text-[34px]
font-bold
text-blue-900
leading-tight
`;

const cardTitleCls =
  "text-[22px] sm:text-2xl md:text-[28px] font-bold text-slate-900 leading-tight";

const heroTitleCls =
  "text-[30px] sm:text-4xl md:text-[42px] font-black text-slate-900 leading-tight";

const modalTitleCls = "text-[28px] font-black leading-tight text-slate-900";

const btnBase = `
inline-flex
items-center
justify-center
gap-2
rounded-xl
px-5 sm:px-7 md:px-8
h-[52px]
sm:h-[54px]
md:h-14
text-[17px]
font-semibold
transition-all
duration-300
active:scale-[0.98]
disabled:opacity-50
disabled:cursor-not-allowed
disabled:hover:translate-y-0
disabled:active:scale-100
whitespace-nowrap
`;

const primaryBtn = `
${btnBase}
bg-gradient-to-r
from-blue-600
to-blue-700
text-white
shadow-xl
shadow-blue-200
hover:-translate-y-1
hover:shadow-2xl
hover:from-blue-700
hover:to-blue-800
`;

const ghostBtn = `
${btnBase}
border
border-blue-200
bg-white
text-blue-700
shadow-sm
hover:bg-blue-50
hover:border-blue-400
hover:-translate-y-0.5
`;

const dangerBtn = `
${btnBase}
border
border-red-200
bg-red-50
text-red-700
hover:bg-red-100
hover:-translate-y-0.5
`;

const rowActionBtn = (tone = "neutral") => {
  const toneCls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:border-rose-300"
      : tone === "primary"
        ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300";
  return `
inline-flex
items-center
justify-center
gap-1.5
sm:gap-2
rounded-xl
border
px-3
sm:px-3.5
h-10
sm:h-11
text-[17px]
font-semibold
shadow-sm
transition-all
duration-300
hover:-translate-y-0.5
hover:shadow-md
active:scale-[0.98]
whitespace-nowrap
${toneCls}
`;
};

/* Full-width variant of rowActionBtn used inside mobile card layouts (Booking
   History / Payment History) so every action button in a card footer shares
   equal width. Desktop table rows keep using rowActionBtn(tone) unchanged. */
const cardActionBtn = (tone = "neutral") =>
  `${rowActionBtn(tone)} flex-1 min-w-[0] justify-center text-[13px] h-10 px-2`;

const softBtn = (active) =>
  `
inline-flex
items-center
justify-center
gap-2
rounded-2xl
px-4 sm:px-5
h-11
sm:h-12
text-[17px]
font-semibold
transition-all
duration-300
active:scale-[0.98]
${
  active
    ? "bg-blue-600 text-white border-blue-600 shadow-lg"
    : "bg-white border border-blue-200 text-blue-700 hover:bg-blue-50"
}
`;

const cardTileCls =
  "rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 sm:p-5";

/* ─────────────────────────── helpers ─────────────────────────── */

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const formatDate = (value) => {
  if (!value) return "-";
  // Parse YYYY-MM-DD as LOCAL midnight so timezone offsets don't shift the day
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const uid = () => Math.random().toString(36).slice(2, 9);

const normalizeRoomTypeName = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

const DOCUMENT_TYPE_LABELS = {
  checkin_form: "Check-in Form",
  guest_photo: "Guest Photo",
  signature: "Signature",
  id_proof: "ID Proof",
};

// ── ID proof type options (used by the Guest Information form) ──────────
const ID_PROOF_TYPE_OPTIONS = [
  "Aadhar Card",
  "Driving License",
  "Passport",
  "Voter ID",
  "PAN Card",
  "Other",
];

// The backend stores the enum member (guest_identifications.id_type), not the
// human label the dropdown shows — so "Aadhar Card" comes back as "aadhaar",
// "Voter ID" as "voter_id", etc. Guest Information renders whatever it gets
// straight from the API, so without this map the panel displayed the raw enum
// ("aadhaar") instead of the option the user picked ("Aadhar Card").
const ID_PROOF_LABEL_BY_ENUM = {
  aadhaar: "Aadhar Card",
  aadhaarcard: "Aadhar Card",
  passport: "Passport",
  driving_license: "Driving License",
  drivinglicence: "Driving License",
  voter_id: "Voter ID",
  voterid: "Voter ID",
  pan: "PAN Card",
  pancard: "PAN Card",
  other: "Other",
};

// Accepts either the stored enum member or a label, and returns the label.
// `emptyFallback` is used when there is nothing stored: display sites want
// "-", but a <select value="..."> needs "" so it lands on the placeholder
// option rather than on a non-existent one.
const idProofLabel = (value, emptyFallback = "-") => {
  const raw = String(value ?? "").trim();
  if (!raw) return emptyFallback;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  return ID_PROOF_LABEL_BY_ENUM[key] || raw;
};

// ── Hotel resort constants (used by all invoice renders) ────────────────
// These match the reference "Tax Invoice" exactly.
const RESORT_NAME_INVOICE = "MAA BAGLAMUKHI RESORT";
const RESORT_ADDRESS_LINE_1 = "Maa Baglamukhi Mandir Raod, Nalkheda";
const RESORT_ADDRESS_LINE_2 = "Agar Malwa, 465445";
const RESORT_PHONE_INVOICE = "9522238777, 9522239777";
const RESORT_EMAIL_INVOICE = "maabaglamukhiresort@gmail.com";
const RESORT_GSTIN_INVOICE = "23AVDPR2928J1ZG";
const RESORT_STATE_CODE_INVOICE = "Madhya Pradesh (23)";
const RESORT_STATE_SHORT_INVOICE = "23";
const RESORT_WEBSITE = "www.maabaglamukhiresort.com";

const toNumber = (value) => Number(value) || 0;

const formatTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};
const buildUploadUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${getBackendBaseURL()}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

// Module-level toWords so handlePrintInvoiceDirect (and any other caller)
// outside InvoiceModal can use it without a scope error.
const toWords = (amount) => {
  if (!amount || amount <= 0) return "Rupees Zero Only";
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const words = (n) => {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + " " + words(n % 10);
    if (n < 1000)
      return ones[Math.floor(n / 100)] + " Hundred " + words(n % 100);
    if (n < 1e5)
      return words(Math.floor(n / 1000)) + " Thousand " + words(n % 1000);
    if (n < 1e7) return words(Math.floor(n / 1e5)) + " Lakh " + words(n % 1e5);
    return words(Math.floor(n / 1e7)) + " Crore " + words(n % 1e7);
  };
  const rounded = Math.round(amount * 100) / 100;
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);
  let result = "Rupees " + words(whole).trim();
  if (paise > 0) result += " and " + words(paise).trim() + " Paise";
  return result + " Only";
};

const STATUS_STYLES = {
  confirmed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  "checked-in": "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  "checked-out": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  cancelled: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
};

const statusStyle = (status) => {
  const key = String(status || "")
    .toLowerCase()
    .trim();
  return (
    STATUS_STYLES[key] || "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
  );
};

const statusBadgeCls = (status) =>
  `inline-block rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-sm font-bold ${statusStyle(status)}`;

/* ─────────────────────────── shared modal primitive ─────────────────────────── */

const Modal = ({
  open,
  onClose,
  icon: Icon,
  iconTone = "bg-blue-500",
  title,
  children,
  actions,
  closeOnBackdrop = true,
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 px-4 py-6 backdrop-blur-sm"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className="max-h-[90vh] w-full max-w-md sm:max-w-lg overflow-y-auto rounded-[24px] sm:rounded-[30px] border border-white/70 bg-white p-6 sm:p-8 md:p-10 shadow-[0_30px_90px_rgba(15,23,42,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        {(Icon || title) && (
          <div className="mb-4 flex items-start gap-4">
            {Icon && (
              <span
                className={`flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-full ${iconTone} text-2xl sm:text-3xl text-white shadow-lg`}
              >
                <Icon />
              </span>
            )}
            {title && <h3 className={`mt-1 ${modalTitleCls}`}>{title}</h3>}
            <button
              onClick={onClose}
              className="ml-auto shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
              type="button"
            >
              <FaTimes />
            </button>
          </div>
        )}
        <div className="text-[17px] leading-relaxed text-slate-600">
          {children}
        </div>
        {actions && (
          <div className="mt-7 sm:mt-8 flex flex-wrap justify-end gap-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────── top flow bar (image-1 style) ─────────────────────────── */

const FLOW_STEPS = [
  {
    view: "form",
    num: 1,
    icon: FaUserPlus,
    title: "New Booking",
    desc: "Fill all booking details and create a new reservation",
  },
  {
    view: "confirmed",
    num: 2,
    icon: FaCheckCircle,
    title: "Booking Confirmed",
    desc: "Booking is confirmed and reference number generated",
  },

  {
    view: "details",
    num: 3,
    icon: FaEye,
    title: "Booking Details",
    desc: "View full details of any specific booking",
  },
  {
    view: "manage",
    num: 4,
    icon: FaCogs,
    title: "Manage Booking",
    desc: "Edit, Cancel, Check-in / Check-out or Update payment",
  },
  {
    view: "list",
    num: 5,
    icon: FaListUl,
    title: "All Bookings",
    desc: "View all bookings in a list with status and details",
  },
  {
    view: "history",
    num: 6,
    icon: FaHistory,
    title: "Booking History",
    desc: "Checked-out bookings archive with history",
  },
  {
    view: "payments",
    num: 7,
    icon: FaMoneyBillWave,
    title: "Payment History",
    desc: "All payment transactions across bookings",
  },
];

const FlowBar = ({ view, onJump }) => (
  <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
    <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-2 sm:flex-nowrap">
      {FLOW_STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isActive = step.view === view;
        return (
          <React.Fragment key={step.view}>
            <button
              type="button"
              onClick={() => onJump(step.view)}
              className="group flex min-w-[104px] sm:min-w-[110px] flex-1 flex-col items-center gap-2 rounded-xl px-2 py-1 text-center transition hover:bg-slate-50"
              title={step.desc}
            >
              <span
                className={`flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full text-lg sm:text-xl transition ${
                  isActive
                    ? "bg-sky-500 text-white shadow-[0_8px_18px_rgba(14,165,233,0.35)]"
                    : "bg-sky-50 text-sky-600 group-hover:bg-sky-100"
                }`}
              >
                <Icon />
              </span>
              <span
                className={`text-[17px] font-bold leading-snug ${isActive ? "text-sky-700" : "text-slate-700"}`}
              >
                {step.num}. {step.title}
              </span>
            </button>
            {idx < FLOW_STEPS.length - 1 && (
              <div className="hidden h-px flex-1 bg-slate-200 sm:block" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  </div>
);

/* ─────────────────────────── initial form shape ─────────────────────────── */

const emptyForm = () => ({
  bookingId: null,
  bookingCode: "",
  firstName: "",
  lastName: "",
  guestEmail: "",
  mobile: "",
  idProofType: "",
  idNumber: "",
  checkIn: "",
  checkOut: "",
  arrival: "12:00",
  departure: "12:00",
  bookingType: "Walk-In",
  referralBy: "",
  company: "",
  gstNumber: "",
  reference: "",
  roomCategory: "",
  noOfRooms: 1,
  guestCapacity: "",
  roomMobile: "",
  owner: "",
  address: "",
  rooms: [],
  comingFrom: "",
  goingTo: "",
  purposeOfVisit: "",
  pickupFrom: "",
  pickup: false,
  packageDetails: "",
  remarks: "",
  amount: "",
  paymentMode: "",
  paymentStatus: "",
  paidBy: "",
  paymentNote: "",
});

// Base amount ONLY — deliberately NO GST applied here.
//
// ROOT CAUSE: this function used to add GST into the row total itself, then the
// backend invoice builder (InvoiceModel.buildInvoicePayload) applied GST again on
// the subtotal it built from these row totals. Room rent of ₹800 was therefore
// charged as ₹840 at booking time and taxed AGAIN on the invoice, so the guest
// was billed tax twice. The tax now lives in exactly one place — the invoice
// builder's `subtotal * GST_RATE` step — and this helper returns the pre-tax base.
const rowTotal = (row, nights = 0) => {
  const base =
    Number(row.price || 0) * Number(nights || 0) * Number(row.quantity || 0);
  return base;
};

// Display-only, GST-INCLUSIVE variant of rowTotal. The stored row total and
// the invoice taxable base stay pre-tax (room rent is taxed exactly once by
// the invoice builder at the flat GST_RATE), but the form has to show the
// entered GST % moving the total — that was the "GST not calculated" half of
// the bug: the section only ever rendered the pre-tax base.
const rowTotalGstInclusive = (row, nights = 0) => {
  const base = rowTotal(row, nights);
  return base * (1 + (Number(row.gst) || 0) / 100);
};

const normalizeBooking = (b) => {
  if (!b || typeof b !== "object") return b;

  let totalAmount = Number(
    b.totalAmount ??
      b.total_amount ??
      b.grandTotal ??
      b.grand_total ??
      b.finalTotal ??
      b.final_total ??
      b.invoiceTotal ??
      b.invoice_total ??
      b.amount ??
      b.bookingAmount ??
      b.booking_amount ??
      0,
  );
  if (!Number.isFinite(totalAmount)) totalAmount = 0;

  if (!totalAmount && Array.isArray(b.rooms) && b.rooms.length) {
    totalAmount = b.rooms.reduce((sum, r) => {
      if (!r || typeof r !== "object") return sum;
      const rowT = Number(r.total ?? r.amount ?? 0);
      if (rowT) return sum + rowT;
      const tariff = Number(r.tariff ?? r.price ?? 0);
      const qty = Number(r.quantity ?? 1);
      const gst = Number(r.gst ?? r.gstPercent ?? 0);
      const base = tariff * qty;
      return sum + base + (base * gst) / 100;
    }, 0);
  }

  const bookingType =
    b.bookingType ||
    b.booking_type ||
    b.bookingSource ||
    b.booking_source ||
    b.booking_Type ||
    b.type ||
    b.source ||
    "";

  let rooms =
    b.rooms ?? b.room_numbers ?? b.roomNumbers ?? b.room_no ?? b.roomNo ?? "";
  if (Array.isArray(rooms)) {
    rooms = rooms
      .map((r) =>
        typeof r === "string"
          ? r
          : r?.room_number || r?.roomNumber || r?.roomNo || r?.roomId || "",
      )
      .filter(Boolean)
      .join(", ");
  }

  return {
    ...b,
    totalAmount,
    bookingType,
    rooms,
  };
};

/* ─────────────────────────── main component ─────────────────────────── */

const FeatureModal = ({
  title,
  subtitle,
  size = "max-w-6xl",
  onClose,
  children,
}) => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center bg-slate-950/70 px-3 py-4 backdrop-blur-sm sm:px-6"
      onClick={onClose}
    >
      <div
        className={`relative max-h-[140vh] w-full ${size} overflow-y-auto rounded-[28px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.35)]`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className={modalTitleCls}>{title}</h3>
            {subtitle && (
              <p className="mt-1 text-[17px] text-slate-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
          >
            <FaTimes />
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
};

const documentTypeOptions = [
  { value: "checkin_form", label: "Check-in Form" },
  { value: "guest_photo", label: "Guest Photo" },
  { value: "signature", label: "Signature" },
  { value: "id_proof", label: "ID Proof" },
];

const PaymentHistoryModal = ({ booking, onClose }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadPaymentHistory = async () => {
    if (!booking?.bookingId) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await API.get(`/hotel/payment-history/${booking.bookingId}`);
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to load payment history:", err);
      setHistory([]);
      setLoadError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          "Could not load payment history. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPaymentHistory();
  }, [booking?.bookingId]);

  const formatDate = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);

  return (
    <FeatureModal
      title="Payment History"
      subtitle={`${booking?.guest_name || "Guest"} - ${booking?.bookingCode || `BK-${booking?.bookingId}`}`}
      size="max-w-4xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-4">
          <h3 className={cardTitleCls}>All Payment Transactions</h3>
          <button
            onClick={loadPaymentHistory}
            disabled={loading}
            className={ghostBtn}
          >
            <FaSync className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400">
            Loading payment history...
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-10 text-center">
            <p className="text-base font-bold text-rose-700">{loadError}</p>
            <button
              onClick={loadPaymentHistory}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-2.5 text-base font-bold text-white transition hover:bg-rose-700"
            >
              <FaSync /> Try again
            </button>
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
            No payment history found for this booking.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[600px] text-left">
              <thead className="bg-slate-50 text-base font-bold uppercase text-slate-400">
                <tr>
                  <th className="px-4 sm:px-5 py-3">Date & Time</th>
                  <th className="px-4 sm:px-5 py-3">Type</th>
                  <th className="px-4 sm:px-5 py-3">Amount</th>
                  <th className="px-4 sm:px-5 py-3">Mode</th>
                  <th className="px-4 sm:px-5 py-3">Status</th>
                  <th className="px-4 sm:px-5 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[17px]">
                {history.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 sm:px-5 py-3 text-slate-700">
                      {formatDate(payment.created_at)}
                    </td>
                    <td className="px-4 sm:px-5 py-3">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${
                          payment.payment_type === "Advance"
                            ? "bg-blue-50 text-blue-700"
                            : payment.payment_type === "Refund"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {payment.payment_type || "Payment"}
                      </span>
                    </td>
                    <td
                      className={`px-4 sm:px-5 py-3 font-bold ${
                        payment.payment_type === "Refund"
                          ? "text-rose-600"
                          : "text-emerald-600"
                      }`}
                    >
                      {payment.payment_type === "Refund" ? "-" : "+"}
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-slate-700">
                      {payment.payment_mode || "-"}
                    </td>
                    <td className="px-4 sm:px-5 py-3">
                      <span className={statusBadgeCls(payment.payment_status)}>
                        {payment.payment_status || "Pending"}
                      </span>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-slate-600 font-mono text-[17px]">
                      {payment.transaction_id || payment.reference_id || "-"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50/50">
                  <td
                    className="px-4 sm:px-5 py-3 font-bold text-slate-800"
                    colSpan={2}
                  >
                    Total
                  </td>
                  <td className="px-4 sm:px-5 py-3 font-black text-xl text-slate-900">
                    {formatCurrency(
                      history.reduce(
                        (sum, p) => sum + (Number(p.amount) || 0),
                        0,
                      ),
                    )}
                  </td>
                  <td className="px-4 sm:px-5 py-3" colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-between items-center gap-4 pt-4 border-t border-slate-200">
          <div className="text-[17px] text-slate-500">
            Showing {history.length} transaction
            {history.length !== 1 ? "s" : ""}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className={primaryBtn}>
              Close
            </button>
          </div>
        </div>
      </div>
    </FeatureModal>
  );
};

const DocumentUploadModal = ({ booking, onClose }) => {
  const bookingId = booking?.bookingId;
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    documentType: "id_proof",
    notes: "",
    termsAccepted: true,
  });
  const [file, setFile] = useState(null);
  const [uploadError, setUploadError] = useState("");

  const loadDocuments = async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const res = await API.get(`/hotel/guest-documents/${bookingId}`);
      setDocuments(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const handleUpload = async () => {
    if (!file || !bookingId) return;
    const data = new FormData();
    data.append("document", file);
    data.append("documentType", form.documentType);
    data.append("notes", form.notes);
    data.append("termsAccepted", form.termsAccepted ? "true" : "false");
    data.append("uploadedBy", localStorage.getItem("name") || "Front Desk");

    setUploading(true);
    setUploadError("");
    try {
      await API.post(`/hotel/guest-documents/${bookingId}`, data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      setForm((prev) => ({ ...prev, notes: "" }));
      await loadDocuments();
      window.dispatchEvent(new Event("documentsUpdated"));
    } catch (err) {
      console.error("Document upload failed:", err);
      setUploadError(
        err.response?.data?.message || err.response?.data?.error || "Document upload failed",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId) => {
    if (!window.confirm("Delete this document?")) return;
    await API.delete(`/hotel/guest-documents/${bookingId}/${documentId}`);
    await loadDocuments();
    window.dispatchEvent(new Event("documentsUpdated"));
  };

  return (
    <FeatureModal
      title="Document Upload"
      subtitle={`${booking?.guest_name || "Guest"} - ${booking?.bookingCode || `BK-${bookingId}`}`}
      size="max-w-5xl"
      onClose={onClose}
    >
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
          <div className={sectionTitleCls}>Upload Guest Document</div>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Document Type</label>
              <select
                className={fieldCls}
                value={form.documentType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    documentType: event.target.value,
                  }))
                }
              >
                {documentTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Image / PDF</label>
              <input
                type="file"
                accept="image/*,.pdf,application/pdf"
                className={fieldCls}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                rows={3}
                className={fieldCls}
                value={form.notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, notes: event.target.value }))
                }
                placeholder="Aadhaar, passport, signed check-in form..."
              />
            </div>
            <label className="flex items-center gap-2 text-[17px] font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.termsAccepted}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    termsAccepted: event.target.checked,
                  }))
                }
              />
              Guest consent / terms accepted
            </label>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              className={primaryBtn}
            >
              <FaFileUpload className="text-xs" />{" "}
              {uploading ? "Uploading..." : "Upload Document"}
            </button>
            {uploadError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="text-base font-bold text-rose-700">{uploadError}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className={sectionTitleCls}>Uploaded Documents</div>
          {loading ? (
            <div className="py-10 text-center text-slate-400">
              Loading documents...
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-slate-400">
              No documents uploaded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => {
                const url = buildUploadUrl(doc.file_url);
                const label =
                  documentTypeOptions.find(
                    (item) => item.value === doc.document_type,
                  )?.label || doc.document_type;
                return (
                  <div
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                  >
                    <div>
                      <div className="font-black text-slate-900">{label}</div>
                      <div className="mt-1 text-[17px] text-slate-500">
                        {doc.notes || "No notes"} -{" "}
                        {formatDate(doc.uploaded_at)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className={ghostBtn}
                      >
                        <FaEye className="text-xs" /> View
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        className={dangerBtn}
                      >
                        <FaTrash className="text-xs" /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </FeatureModal>
  );
};

const InvoiceModal = ({
  booking,
  roomChargesTotal = 0,
  folioCharges = [],
  paidAmount = 0,
  rooms = [],
  bookingDetail = null,
  onClose,
}) => {
  const bookingId = booking?.bookingId;
  const [invoice, setInvoice] = useState(null);
  const [invoiceError, setInvoiceError] = useState("");
  const [loading, setLoading] = useState(false);
  const [folioChargesLocal, setFolioChargesLocal] = useState(folioCharges);
  const [totalPaidLocal, setTotalPaidLocal] = useState(paidAmount);

  const loadInvoice = async () => {
    if (!bookingId) return;
    setLoading(true);
    setInvoiceError("");
    try {
      const existing = await API.get(`/invoice/by-booking/${bookingId}`);
      if (existing.data?.id) {
        setInvoice(existing.data);
        return;
      }
      const generated = await API.get(`/invoice/${bookingId}`);
      if (generated.data?.id) {
        setInvoice(generated.data);
      } else {
        setInvoice(null);
        setInvoiceError(
          `No invoice exists for booking #${bookingId} yet. Record an advance or folio entry, then regenerate.`,
        );
      }
    } catch (err) {
      console.error(err);
      setInvoice(null);
      setInvoiceError(err.response?.data?.error || "Invoice load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [folioRes, phRes] = await Promise.all([
          API.get(`/hotel/folio/${bookingId}`),
          API.get(`/hotel/payment-history/${bookingId}`),
        ]);
        if (cancelled) return;
        const folioEntries = Array.isArray(folioRes.data) ? folioRes.data : [];
        setFolioChargesLocal(
          folioEntries.filter((e) => e.entry_type === "Extra Charge"),
        );
        const history = Array.isArray(phRes.data) ? phRes.data : [];
        const total = history
          .filter((p) => p.payment_type !== "Refund")
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        setTotalPaidLocal(total);
      } catch {
        // best-effort; keep whatever the parent passed in
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const folioChargesTotal = folioChargesLocal.reduce(
    (sum, e) => sum + (Number(e.amount) || 0),
    0,
  );

  const folioItems = (
    Array.isArray(folioChargesLocal) ? folioChargesLocal : []
  ).map((e) => ({
    name: e.category || "Extra Charge",
    description: e.description || "Folio entry",
    quantity: 1,
    price: Number(e.amount) || 0,
    total: Number(e.amount) || 0,
    isFolio: true,
  }));

  const liveRoomItems = (
    Array.isArray(rooms) && rooms.length > 0 ? rooms : []
  ).map((r, idx) => {
    const tariff = Number(r.tariff ?? r.price ?? 0);
    const qty = Number(r.quantity ?? 1);
    const gstPercent = Number(r.gst ?? r.gstPercent ?? 0);
    const total = Number(r.total || 0);
    // booking_rooms.total is the PRE-TAX base (₹500 room, 5% GST → the
    // room's real charge is ₹525). GST is added on top — the dashboard's
    // "Rooms incl. GST" uses this same model, so the invoice preview must
    // too (the old back-out, total/(1+pct), under-reported every tax line).
    const baseAmount = total;
    const gstAmount = total > 0 ? total * (gstPercent / 100) : 0;
    return {
      id: `room-${idx}-${r.room_number || r.roomNumber || r.roomNo || idx}`,
      name: `Room ${r.room_number || r.roomNumber || r.roomNo || idx + 1}`,
      description: `${r.room_type || r.category || "Room"} — ${qty} room(s)${gstPercent > 0 ? `, ${gstPercent}% GST` : ""}`,
      quantity: qty,
      price: tariff,
      gst: gstPercent,
      gstAmount: Math.round(gstAmount * 100) / 100,
      total: total,
      isRoom: true,
    };
  });

  let items;
  if (liveRoomItems.length > 0) {
    items = [...liveRoomItems, ...folioItems];
  } else {
    const backendItems =
      Array.isArray(invoice?.items) && invoice.items.length > 0
        ? invoice.items
        : [
            {
              name: "Room Charges",
              description: "Total room / tariff charges",
              quantity: 1,
              price: roomChargesTotal,
              total: roomChargesTotal,
            },
          ];
    const seenKeys = new Set();
    items = [
      ...backendItems.filter((it) => {
        if (!it) return false;
        const key = `${it.name || ""}|${Number(it.total ?? it.price ?? 0)}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      }),
      ...folioItems.filter((it) => {
        const key = `${it.name}|${it.total}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      }),
    ];
  }

  // Room item totals are the PRE-TAX base (booking_rooms.total = tariff ×
  // nights, tax kept in the separate gst percent) — GST is ADDED on top,
  // matching the dashboard's "Rooms incl. GST" and the booking's stored
  // total_amount. Folio extra charges carry no GST.
  const itemsTotal = items.reduce((sum, it) => {
    const base = Number(it.total ?? it.price ?? 0) || 0;
    const pct = Number(it.gst ?? it.gstPercent ?? 0) || 0;
    return sum + (it.isRoom ? base * (1 + pct / 100) : base);
  }, 0);

  const roomItemsTotal = items
    .filter((it) => it.isRoom)
    .reduce((sum, it) => sum + (Number(it.total ?? 0) || 0), 0);
  const folioOnlyTotal = items
    .filter((it) => it.isFolio)
    .reduce((sum, it) => sum + (Number(it.total ?? 0) || 0), 0);

  const invoiceNo =
    invoice?.invoiceNo || invoice?.invoice_no || `INV-${bookingId}`;
  const guestName =
    invoice?.customerName ||
    invoice?.customer_name ||
    booking?.guest_name ||
    bookingDetail?.guest_name ||
    "Guest";
  const companyName =
    invoice?.companyName ||
    invoice?.company_name ||
    bookingDetail?.company_name ||
    booking?.company_name ||
    "";
  const companyGstin =
    invoice?.companyGstin ||
    invoice?.company_gstin ||
    invoice?.company_gst ||
    bookingDetail?.company_gst ||
    booking?.company_gst ||
    "";
  const folioTotalAmount = roomItemsTotal + folioOnlyTotal;
  const invoiceTotal = itemsTotal > 0 ? itemsTotal : folioTotalAmount;
  const paid =
    Number(
      totalPaidLocal ??
        paidAmount ??
        invoice?.paidAmount ??
        invoice?.paid_amount,
    ) || 0;
  const remainingAmount =
    paid > 0 ? Math.max(invoiceTotal - paid, 0) : invoiceTotal;

  const invoiceSubtotal = toNumber(invoice?.subtotal) || invoiceTotal;
  const invoiceTax = toNumber(invoice?.tax) || 0;
  const invoiceSgst = invoiceTax / 2;
  const invoiceCgst = invoiceTax / 2;
  const invoiceDiscount = toNumber(invoice?.discount) || 0;

  const buildLines = () => [
    ["Invoice No", invoiceNo],
    ["Guest", guestName],
    ["Phone", invoice?.phone || booking?.mobile || "-"],
    ["Rooms", invoice?.roomNumber || invoice?.room_no || booking?.rooms || "-"],
    [
      "Stay",
      `${formatDate(invoice?.checkIn || invoice?.check_in || booking?.check_in)} to ${formatDate(invoice?.checkOut || invoice?.check_out || booking?.check_out)}`,
    ],
    ["Folio Total Amount", formatCurrency(folioTotalAmount)],
    ["Updated Total Amount", formatCurrency(invoiceTotal)],
    ["Advance Paid", formatCurrency(paid)],
    ["Remaining Amount", formatCurrency(remainingAmount)],
    [
      "Payment Status",
      invoice?.paymentStatus ||
        invoice?.payment_status ||
        (remainingAmount > 0 ? "Pending" : "Paid"),
    ],
  ];

  // ── Reference-layout variables (used by the on-screen invoice preview) ──
  const folioNo = booking?.bookingId || booking?.bookingId || "-";
  const guestAddress = invoice?.address || booking?.address || "BHOPAL";
  const guestContact = invoice?.phone || booking?.mobile || "9424825679";
  const roomNo =
    invoice?.roomNumber ||
    invoice?.room_no ||
    booking?.rooms ||
    (Array.isArray(rooms) && rooms[0]
      ? rooms[0].room_number || rooms[0].roomNo || rooms[0].room_no
      : null) ||
    "104";
  const roomType =
    invoice?.roomType ||
    booking?.room_type ||
    (Array.isArray(rooms) && rooms[0]
      ? rooms[0].room_type || rooms[0].category
      : null) ||
    "Single";
  const noOfNights =
    invoice?.nights ||
    booking?.noOfNights ||
    booking?.nights ||
    (() => {
      if (invoice?.checkIn && invoice?.checkOut) {
        const d1 = new Date(invoice.checkIn);
        const d2 = new Date(invoice.checkOut);
        const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff : 1;
      }
      return 1;
    })();
  const pax =
    invoice?.pax ||
    booking?.no_of_guests ||
    booking?.guest_capacity ||
    "2 Adults, 0";
  const checkInDate =
    invoice?.checkIn || invoice?.check_in || booking?.check_in
      ? formatDate(
          new Date(invoice?.checkIn || invoice?.check_in || booking?.check_in),
        )
      : "-";
  const checkOutDate =
    invoice?.checkOut || invoice?.check_out || booking?.check_out
      ? formatDate(
          new Date(
            invoice?.checkOut || invoice?.check_out || booking?.check_out,
          ),
        )
      : "-";
  const arrivalTime = booking?.arrival || "4:25 pm";
  const departureTime = booking?.departure || "10:00 am";
  const paymentMode =
    invoice?.paymentMode ||
    invoice?.payment_method ||
    booking?.payment_mode ||
    "UPI";
  const generatedBy =
    invoice?.generatedBy ||
    booking?.generated_by ||
    booking?.staff_name ||
    "ABHISHEK RATHORE";
  const paymentNoteText = "Thanks Pl Visit Again!!!";

  // 2-decimal money formatter used by the preview (en-IN, no currency symbol)
  const formatMoney = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Build one row per stay night from `rooms` (live) or fall back to one row
  // for the booking span (when no per-room items exist).
  const stayDatesArr = (() => {
    if (invoice?.checkIn && invoice?.checkOut) {
      const s = new Date(invoice.checkIn);
      const e = new Date(invoice.checkOut);
      const n = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
      return Array.from({ length: n }, (_, i) => {
        const d = new Date(s);
        d.setDate(s.getDate() + i);
        return d;
      });
    }
    return [new Date()];
  })();

  // 🐛 FIX: this used to treat the per-night amount as pre-tax and then ADD
  // an extra flat 5% (2.5% SGST + 2.5% CGST) on top of it — even though
  // `roomItemsTotal` is already the real, GST-INCLUSIVE amount for the
  // room(s). A room configured with 0% GST (or any rate other than 5%)
  // came out inflated (e.g. a real ₹2,000 charge printed as ₹2,100). Now
  // the actual (quantity-weighted) GST % of the live room items is used to
  // correctly split the already-inclusive total instead of assuming 5%.
  const roomGrossTotal = roomItemsTotal || folioOnlyTotal || invoiceTotal;
  const weightedRoomGstPercent =
    roomItemsTotal > 0
      ? items
          .filter((it) => it.isRoom)
          .reduce(
            (sum, it) =>
              sum +
              ((Number(it.total) || 0) / roomItemsTotal) *
                (Number(it.gst) || 0),
            0,
          )
      : 0;
  // Per-night math: rooms total (roomGrossTotal) is the PRE-TAX base, so
  // GST is ADDED on top of each night's share — same model as the dashboard
  // "Rooms incl. GST". The old back-out (base = total/(1+pct)) showed
  // 476.19 taxable / 11.91+11.91 tax for a ₹500 room instead of 500 / 12.50+12.50.
  const perNightBase =
    stayDatesArr.length > 0
      ? Number((roomGrossTotal / stayDatesArr.length).toFixed(2))
      : 0;
  const perNightTaxable = perNightBase;
  const perNightTaxAmount = Number(
    (perNightBase * (weightedRoomGstPercent / 100)).toFixed(2),
  );
  const perNightSgst = Number((perNightTaxAmount / 2).toFixed(2));
  const perNightCgst = perNightSgst;
  const perNightTotal = Number((perNightBase + perNightTaxAmount).toFixed(2));
  const perNightTariff = perNightBase;
  const rType = String(roomType || "Room").toUpperCase();
  const dayRows = stayDatesArr.map((dt) => ({
    date: formatDate(dt),
    particulars: `Room Charges - ${rType} - ${rType}`,
    tariff: perNightTaxable,
    disc: 0,
    taxable: perNightTaxable,
    sgst: perNightSgst,
    cgst: perNightCgst,
    total: perNightTotal,
  }));

  const folioRowData = folioChargesLocal.map((e) => {
    const amount = Number(e.amount) || 0;
    return {
      date: e.date ? formatDate(new Date(e.date)) : formatDate(new Date()),
      particulars: e.description || e.category || "Extra Charge",
      tariff: amount,
      disc: 0,
      taxable: amount,
      sgst: 0,
      cgst: 0,
      total: amount,
    };
  });

  const allItems = [...dayRows, ...folioRowData];
  const tariffTotal = allItems.reduce((s, i) => s + (Number(i.tariff) || 0), 0);
  const totalTaxable = allItems.reduce(
    (s, i) => s + (Number(i.taxable) || 0),
    0,
  );
  const totalSgst = allItems.reduce((s, i) => s + (Number(i.sgst) || 0), 0);
  const totalCgst = allItems.reduce((s, i) => s + (Number(i.cgst) || 0), 0);
  // `roomChargesTotal` is the prop passed in by the parent — use it directly.
  const computedRoomChargesTotal = tariffTotal;
  const finalTotal = Number(
    allItems.reduce((s, i) => s + (Number(i.total) || 0), 0).toFixed(2),
  );
  const amountInWordsClean = (() => {
    const w = toWords(finalTotal || invoiceTotal || 0);
    return String(w || "")
      .replace(/^Rupees\s+/i, "")
      .replace(/\s*Only$/i, "");
  })();




  return (
    <FeatureModal
      title="Invoice"
      subtitle={`${guestName} - ${booking?.bookingCode || `BK-${bookingId}`}`}
      size="max-w-[900px]"
      onClose={onClose}
    >
      {loading ? (
        <div className="py-16 text-center text-slate-400">
          Preparing invoice...
        </div>
      ) : invoiceError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-14 text-center">
          <p className="text-base font-bold text-rose-700">{invoiceError}</p>
          <button
            type="button"
            onClick={loadInvoice}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 h-11 text-[17px] font-bold text-white transition hover:bg-rose-700"
          >
            <FaSync className="text-sm" /> Try again
          </button>
        </div>
      ) : (
        <div className="space-y-0">
          {/* ─── Action bar ─── */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-bold uppercase tracking-wider text-slate-400">
                Invoice Actions
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadInvoice}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 h-12 text-[17px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300 whitespace-nowrap"
              >
                <FaSync className="text-sm" /> Regenerate
              </button>
            </div>
          </div>

          {/* ─── Invoice paper — matches reference layout ─── */}
          <div
            id="hotel-invoice-paper"
            className="border border-black font-['Helvetica',Arial,sans-serif] text-black"
          >
            {/* 1. "Tax Invoice" centered title */}
            <div className="text-center py-1.5">
              <h2 className="text-[20px] font-extrabold tracking-wide leading-tight">
                Tax Invoice
              </h2>
            </div>

            {/* 2. Resort logo + name + address + GSTN */}
            <div className="text-center px-2 pb-2 leading-snug">
              <div className="inline-flex items-center justify-center gap-1.5 mb-1">
                <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-green-600 text-white text-[11px]">
                  ❀
                </span>
                <span className="text-[13px] font-extrabold tracking-wide">
                  {RESORT_NAME_INVOICE}
                </span>
              </div>
              <div className="text-[9px] leading-snug">
                {RESORT_ADDRESS_LINE_1}
              </div>
              <div className="text-[9px] leading-snug">
                District: {RESORT_ADDRESS_LINE_2}
              </div>
              <div className="text-[9px] leading-snug">
                Ph: {RESORT_PHONE_INVOICE}
              </div>
              <div className="text-[9px] leading-snug">
                {RESORT_EMAIL_INVOICE} | {RESORT_WEBSITE}
              </div>
              <div className="text-[9px] font-extrabold leading-snug">
                GSTN: {RESORT_GSTIN_INVOICE}
              </div>
            </div>

            <hr className="border-t border-black m-0" />

            {/* 3. Guest-info (left) | Booking-info (right) */}
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="px-3 py-2 border-r border-black text-[10px] leading-snug space-y-0.5">
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Folio No.
                  </span>
                  <span>{folioNo}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Guest Name
                  </span>
                  <span className="uppercase">{guestName}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Address
                  </span>
                  <span className="uppercase">{guestAddress}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Contact #
                  </span>
                  <span>{guestContact}</span>
                </div>
                {companyName && (
                  <div>
                    <span className="font-bold inline-block min-w-[110px]">
                      Company
                    </span>
                    <span className="uppercase">{companyName}</span>
                  </div>
                )}
                {companyGstin && (
                  <div>
                    <span className="font-bold inline-block min-w-[110px]">
                      GSTIN
                    </span>
                    <span>{companyGstin}</span>
                  </div>
                )}
              </div>
              <div className="px-3 py-2 border-l border-black text-[10px] leading-snug space-y-0.5">
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Invoice No.
                  </span>
                  <span>{invoiceNo}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Invoice Date
                  </span>
                  <span>{formatDate(invoice?.date || new Date())}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Room No.
                  </span>
                  <span>{roomNo}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Room Type
                  </span>
                  <span>{roomType}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Arrival
                  </span>
                  <span>
                    {checkInDate} {arrivalTime}
                  </span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Departure
                  </span>
                  <span>
                    {checkOutDate} {departureTime}
                  </span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    Pax
                  </span>
                  <span>{pax}</span>
                </div>
                <div>
                  <span className="font-bold inline-block min-w-[110px]">
                    No. of Nights
                  </span>
                  <span>{noOfNights}</span>
                </div>
              </div>
            </div>
            <hr className="border-t border-black m-0" />
            {/* 4. Billing Details table */}
            <div className="px-3 pt-2 pb-0.5 font-extrabold text-[10px]">
              Billing Details
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="font-bold text-[9px]">
                    <th className="border border-black px-1 py-1 w-[11%]">
                      Date
                    </th>
                    <th className="border border-black px-1 py-1 w-[38%]">
                      Particulars
                    </th>
                    <th className="border border-black px-1 py-1 w-[9%] text-right">
                      Tariff
                    </th>
                    <th className="border border-black px-1 py-1 w-[7%] text-right">
                      Disc
                    </th>
                    <th className="border border-black px-1 py-1 w-[9%] text-right">
                      Taxable
                    </th>
                    <th className="border border-black px-1 py-1 w-[9%] text-right">
                      SGST 2.5%
                    </th>
                    <th className="border border-black px-1 py-1 w-[9%] text-right">
                      CGST 2.5%
                    </th>
                    <th className="border border-black px-1 py-1 w-[8%] text-right">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allItems.length > 0 ? (
                    allItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className="border border-black px-1 py-1 align-top whitespace-nowrap">
                          {item.date || formatDate(new Date())}
                        </td>
                        <td className="border border-black px-1 py-1 leading-snug align-top">
                          {item.particulars}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums align-top">
                          {formatCurrency(item.tariff)}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums align-top">
                          {item.disc > 0 ? formatCurrency(item.disc) : "0.00"}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums align-top">
                          {formatCurrency(item.taxable)}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums align-top">
                          {formatCurrency(item.sgst)}
                        </td>
                        <td className="border border-black px-1 py-1 text-right tabular-nums align-top">
                          {formatCurrency(item.cgst)}
                        </td>
                        <td className="border border-black px-1 py-1 text-right font-extrabold tabular-nums align-top">
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        className="border border-black px-2 py-2 text-center text-slate-400"
                      >
                        No charges recorded
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 5. Remarks (left) | Totals summary (right) */}
            <div className="grid grid-cols-1 md:grid-cols-2 border-t border-black">
              <div className="px-3 py-3 border-r border-black text-[10px] space-y-2">
                <div className="font-extrabold text-[9px] tracking-wider uppercase">
                  Remarks
                </div>
                <div className="min-h-[80px] text-[9px] text-slate-400">-</div>
              </div>
              <div className="px-3 py-3 text-[10px] leading-snug">
                <div className="font-extrabold text-[9px] tracking-wider uppercase mb-1">
                  Payment Summary
                </div>
                <table className="w-full border-collapse text-[10px]">
                  <tbody>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        Tariff Total
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums w-[80px]">
                        {formatCurrency(tariffTotal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        Discount
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums">
                        0.00
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        Taxable Amount
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums">
                        {formatCurrency(totalTaxable)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        SGST
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums">
                        {formatCurrency(totalSgst)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        CGST
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums">
                        {formatCurrency(totalCgst)}
                      </td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="border border-black px-1.5 py-0.5 text-left font-extrabold">
                        Room Total
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right font-extrabold tabular-nums">
                        {formatCurrency(roomChargesTotal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        Round Off Disc.
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums">
                        0.00
                      </td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="border border-black px-1.5 py-0.5 text-left font-extrabold">
                        Final Total
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right font-extrabold tabular-nums">
                        {formatCurrency(finalTotal)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-black px-1.5 py-0.5 text-left">
                        Service Total
                      </td>
                      <td className="border border-black px-1.5 py-0.5 text-right tabular-nums">
                        0.00
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 6. Amount-in-words (left) | Final Total (right) */}
            <div className="grid grid-cols-1 md:grid-cols-2 border-t border-black">
              <div className="px-3 py-2.5 border-r border-black font-bold text-[11px] italic">
                Rupees {amountInWordsClean} Only
              </div>
              <div className="px-3 py-2.5 flex items-center justify-between font-extrabold text-[12px]">
                <span>Final Total</span>
                <span className="tabular-nums text-[14px]">
                  Rs. {formatMoney(finalTotal)}
                </span>
              </div>
            </div>

           {/* 7. Invoice Note (left) | Payment Detail (right) */}
<div className="grid grid-cols-1 md:grid-cols-2 border-t border-black">

  {/* LEFT - INVOICE NOTE */}
  <div className="border-r border-black">

    {/* Header */}
    <div className="px-3 py-1.5 border-b border-black text-[11px] font-extrabold">
      INVOICE NOTE
    </div>

    {/* Content */}
    <div className="px-3 py-2.5 text-[11px] font-semibold">
      {paymentNoteText || "Thanks Pl Visit Again!!!"}
    </div>

  </div>

  {/* RIGHT - PAYMENT DETAIL */}
  <div>

    {/* Header */}
    <div className="px-3 py-1.5 border-b border-black text-[11px] font-extrabold text-right">
      PAYMENT DETAIL
    </div>

    {/* Payment content */}
    <div className="px-3 py-1.5 text-[10px] leading-snug">

      <div className="flex justify-between">
        <span>{(paymentMode || "UPI").toUpperCase()}</span>
        <span className="tabular-nums">
          {formatMoney(paid)}
        </span>
      </div>

      <div className="flex justify-between border-t border-black pt-1 mt-1 font-extrabold">
        <span>Balance</span>
        <span className="tabular-nums">
          {formatMoney(remainingAmount)}
        </span>
      </div>

    </div>

  </div>

</div>

            {/* 8. Signature + 9. Generated-by */}
            <div className="relative h-[92px] border-t border-black px-3 py-2">
              {/* For Resort - TOP LEFT */}
              <div className="absolute left-3 top-2 text-[10px] font-extrabold">
                For {RESORT_NAME_INVOICE}
              </div>

              {/* Guest Signature - TOP RIGHT */}
              <div className="absolute right-3 top-2 w-[145px] text-center">
                <div className="text-[10px] font-extrabold">
                  Guest Signature
                </div>

                <div className="mt-6 border-t border-black pt-1.5 text-[9px] font-semibold"></div>
              </div>

              {/* Authorized Signature - BOTTOM LEFT */}
              <div className="absolute left-3 bottom-3 w-[145px] text-center">
                <div className="border-t border-black pt-1.5 text-[9px] font-semibold">
                  Authorised Signature
                </div>
              </div>

              {/* Generated By - BOTTOM LEFT */}
              <div className="absolute left-3 bottom-1 text-left text-[9px] font-semibold">
                Invoice Generated By:{" "}
                <span className="font-bold">{generatedBy}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </FeatureModal>
  );
};

/* ────────────────── WhatsApp Send Modal Component ─────────────────────────── */

const WhatsAppSendModal = ({
  booking,
  detail,
  invoice,
  sending,
  result,
  onSend,
  onClose,
}) => {
  const b = booking || {};
  const inv = invoice || detail?.invoice || {};
  const guestName =
    inv.customerName ||
    inv.customer_name ||
    detail?.guest_name ||
    b.guest_name ||
    "Guest";
  const customerPhone = inv.phone || detail?.mobile || b.mobile || "—";
  const invoiceNo = inv.invoiceNo || inv.invoice_no || `BK-${b.bookingId}`;
  const invoiceTotal = Number(
    inv.totalAmount ||
      inv.total_amount ||
      inv.finalTotal ||
      inv.final_total ||
      0,
  );
  const paymentStatus =
    inv.paymentStatus ||
    inv.payment_status ||
    (invoiceTotal > 0 ? "Pending" : "Paid");
  const advancePaid = Number(
    inv.paidAmount || inv.paid_amount || b.paidAmount || 0,
  );
  const balanceDue = Math.max(invoiceTotal - advancePaid, 0);
  const roomNumber =
    inv.roomNumber ||
    inv.room_number ||
    (Array.isArray(detail?.rooms)
      ? detail.rooms
          .map((r) => r.room_number || r.roomNumber)
          .filter(Boolean)
          .join(", ")
      : "") ||
    b.rooms ||
    "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
        onClick={sending ? undefined : onClose}
      />
      <div className="relative w-full max-w-md bg-white rounded-[24px] shadow-[0_30px_80px_rgba(15,23,42,0.35)] overflow-hidden">
        {/* Brand header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 sm:px-6 py-5 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white shadow-lg">
            <FaWhatsapp className="text-[#25D366] text-3xl" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-black text-lg sm:text-xl leading-tight">
              Send Invoice via WhatsApp
            </h3>
            <p className="text-white/75 text-xs sm:text-sm mt-0.5">
              Invoice details will be sent by WhatsApp
            </p>
          </div>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-4">
          {/* Summary strip */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Invoice
              </div>
              <div className="text-sm font-black text-slate-900 mt-0.5">
                {invoiceNo}
              </div>
            </div>
            <div className="flex-1 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                Total Amount
              </div>
              <div className="text-sm font-black text-emerald-700 mt-0.5">
                {formatCurrency(invoiceTotal)}
              </div>
            </div>
            <div className="flex-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Status
              </div>
              <div className="mt-1">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    paymentStatus === "Paid"
                      ? "bg-emerald-50 text-emerald-700"
                      : paymentStatus === "Pending"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {paymentStatus}
                </span>
              </div>
            </div>
          </div>

          {/* Guest card */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Guest Information
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                <FaUser className="text-sm" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 font-medium">
                  Guest Name
                </div>
                <div className="text-[15px] font-black text-slate-900">
                  {guestName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <FaPhone className="text-sm" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 font-medium">
                  Mobile Number
                </div>
                <div className="text-[15px] font-black text-slate-900">
                  {customerPhone}
                </div>
              </div>
            </div>
            {detail?.guest_email || b.guestEmail ? (
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700">
                  <FaEnvelope className="text-sm" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-medium">
                    Email
                  </div>
                  <div className="text-[15px] font-black text-slate-900">
                    {detail?.guest_email || b.guestEmail || "-"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Room & Payment details preview */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Booking Details
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700">
                <FaHotel className="text-sm" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] text-slate-400 font-medium">
                  Room Type
                </div>
                <div className="text-[15px] font-black text-slate-900">
                  {detail?.room_category ||
                    detail?.roomType ||
                    b.roomCategory ||
                    b.roomType ||
                    "—"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                <FaKey className="text-sm" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] text-slate-400 font-medium">
                  Room No
                </div>
                <div className="text-[15px] font-black text-slate-900">
                  {roomNumber}
                </div>
              </div>
            </div>
            <div className="border-t border-slate-200 pt-2.5 mt-2.5 grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Total
                </div>
                <div className="text-sm font-black text-slate-900 mt-0.5">
                  {formatCurrency(invoiceTotal)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                  Advance
                </div>
                <div className="text-sm font-black text-emerald-700 mt-0.5">
                  {formatCurrency(advancePaid)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-rose-500">
                  Balance
                </div>
                <div className="text-sm font-black text-rose-700 mt-0.5">
                  {formatCurrency(balanceDue)}
                </div>
              </div>
            </div>
          </div>

          {/* Delivery channels */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/50 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <FaWhatsapp className="text-emerald-600 text-lg" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                  Customer
                </span>
              </div>
              <div className="text-[13px] font-bold text-slate-800">
                {customerPhone}
              </div>
              <div className="mt-1.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                Will receive invoice details
              </div>
            </div>
            <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <FaHotel className="text-slate-500 text-lg" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  Admin (Resort)
                </span>
              </div>
              <div className="text-[13px] font-bold text-slate-800">
                Resort Notification
              </div>
              <div className="mt-1.5 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                Notification copy
              </div>
            </div>
          </div>

          {/* Result banner */}
          {result && (
            <div
              className={`rounded-xl border-l-[4px] p-4 ${
                result.type === "success"
                  ? "border-l-emerald-500 bg-emerald-50"
                  : result.type === "partial"
                    ? "border-l-amber-500 bg-amber-50"
                    : "border-l-rose-500 bg-rose-50"
              }`}
            >
              <div className="flex items-start gap-3">
                {result.type === "success" && (
                  <FaCheckCircle className="text-emerald-600 text-lg mt-0.5 shrink-0" />
                )}
                {result.type === "partial" && (
                  <FaExclamationTriangle className="text-amber-600 text-lg mt-0.5 shrink-0" />
                )}
                {result.type === "error" && (
                  <FaTimes className="text-rose-600 text-lg mt-0.5 shrink-0" />
                )}
                <div>
                  <p
                    className={`font-bold text-[15px] ${
                      result.type === "success"
                        ? "text-emerald-800"
                        : result.type === "partial"
                          ? "text-amber-800"
                          : "text-rose-800"
                    }`}
                  >
                    {result.type === "success"
                      ? "Sent Successfully"
                      : result.type === "partial"
                        ? "Partially Sent"
                        : "Failed to Send"}
                  </p>
                  <p
                    className={`text-[13px] mt-1 ${
                      result.type === "success"
                        ? "text-emerald-600"
                        : result.type === "partial"
                          ? "text-amber-600"
                          : "text-rose-600"
                    }`}
                  >
                    {result.message}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer action row */}
        <div className="px-5 sm:px-6 pb-5 pt-1">
          {!sending && !result && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all duration-200 text-[15px]"
              >
                Cancel
              </button>
              <button
                onClick={onSend}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 hover:shadow-xl active:scale-[0.98] transition-all duration-200 text-[15px] flex items-center justify-center gap-2"
              >
                <FaPaperPlane className="text-sm" /> Send Now
              </button>
            </div>
          )}
          {sending && (
            <div className="flex items-center justify-center gap-3 py-3">
              <svg
                className="animate-spin h-5 w-5 text-emerald-600"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-slate-500 font-medium text-[15px]">
                Sending...
              </span>
            </div>
          )}
          {result && !sending && (
            <button
              onClick={onClose}
              className="w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl active:scale-[0.98] transition-all duration-200 text-[15px]"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const BookingFlow = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = todayISO();

  const prefillRoomNumber =
    (location.state && (location.state.roomNumber || location.state.roomNo)) ||
    searchParams.get("roomNo") ||
    searchParams.get("roomNumber") ||
    "";
  const prefillCategory =
    (location.state && (location.state.category || location.state.roomType)) ||
    searchParams.get("roomType") ||
    searchParams.get("category") ||
    "";
  const prefillCheckIn =
    (location.state && location.state.checkIn) ||
    searchParams.get("checkIn") ||
    today;
  const prefillCheckOut =
    (location.state && location.state.checkOut) ||
    searchParams.get("checkOut") ||
    "";
  const shouldResetDraft =
    (location.state && location.state.resetBookingDraft) ||
    searchParams.get("reset") === "true";

  const [view, setView] = useState(() =>
    location.pathname.includes("guest") ? "form" : "list",
  );
  const [isEdit, setIsEdit] = useState(false);

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;

  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // Synchronous re-entrancy lock. `disabled={saving}` only blocks the button on
  // the NEXT render, so a fast double/triple-click (or any repeated trigger
  // inside the same tick) runs handleSaveBooking several times before the UI
  // re-renders — each run POSTs a brand-new /hotel/guest booking and each one
  // auto-sends its "Booking Confirmed" WhatsApp, so the guest sees it 3x.
  // This ref is set immediately and synchronously, closing that window.
  const savingRef = useRef(false);
  const [categorySetup, setCategorySetup] = useState([]);

  const [selectedBooking, setSelectedBooking] = useState(null);
  const [bookingDetail, setBookingDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [folioCharges, setFolioCharges] = useState([]);
  const [folioLoading, setFolioLoading] = useState(false);
  const [totalPaid, setTotalPaid] = useState(0);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waResult, setWaResult] = useState(null);
  const [waInvoice, setWaInvoice] = useState(null);

  // When the WhatsApp modal opens, fetch the invoice data so the summary
  // shows the exact same invoice that will be sent.
  useEffect(() => {
    if (!showWhatsAppModal) {
      setWaInvoice(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const existing = await API.get(
          `/invoice/by-booking/${selectedBooking?.bookingId}`,
        );
        if (cancelled) return;
        if (existing.data?.id) {
          setWaInvoice(existing.data);
        } else {
          const generated = await API.get(
            `/invoice/${selectedBooking?.bookingId}`,
          );
          if (!cancelled) setWaInvoice(generated.data || null);
        }
      } catch {
        if (!cancelled) setWaInvoice(null);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [showWhatsAppModal, selectedBooking?.bookingId]);

  const [toast, setToast] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
  });
  const [cancelModal, setCancelModal] = useState({
    open: false,
    reason: "",
    submitting: false,
  });
  const [collectModal, setCollectModal] = useState({
    open: false,
    amount: "",
    mode: "Cash",
    submitting: false,
  });
  const [refundModal, setRefundModal] = useState({
    open: false,
    amount: "",
    submitting: false,
  });
  // 🐛 RESTRICTION: blocks check-out until any pending balance is collected.
  // Triggered from handleLifecycle when remaining > 0; the user is asked to
  // either Collect Payment now (opens the CollectPayment modal pre-filled
  // with the remaining balance) or cancel the check-out attempt.
  const [checkoutGuardModal, setCheckoutGuardModal] = useState({
    open: false,
    booking: null,
    remaining: 0,
    paymentStatus: "Pending",
  });
  const [manageStatus, setManageStatus] = useState("");
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(false);

  // Booking History (view === "history") and Payment History (view === "payments")
  // full-page state — these are the real "Booking History" / "Payment History"
  // steps in the top status bar, separate from the per-booking PaymentHistoryModal.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 9;

  const [allPayments, setAllPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const showToast = (type, title, message) =>
    setToast({ open: true, type, title, message });
  const closeToast = () => setToast((t) => ({ ...t, open: false }));

  /* ---------- data loading ---------- */

  const fetchBookings = async () => {
    try {
      setLoading(true);
      const res = await API.get("/hotel/all-bookings");
      const raw = Array.isArray(res.data) ? res.data : [];
      setBookings(raw.map(normalizeBooking));
    } catch (err) {
      console.error("Failed to load bookings:", err);
      showToast(
        "error",
        "Could not load bookings",
        "Please check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Dedupe booking-history rows by guest+mobile+stay-dates, keeping only the
  // most recent bookingId per unique stay (protects against duplicate rows
  // if the backend returns the same checked-out stay more than once).
  const dedupeHistory = (rows) => {
    const map = new Map();
    rows.forEach((row) => {
      const key = [
        String(row.guest_name || "")
          .trim()
          .toLowerCase(),
        String(row.mobile || "").trim(),
        String(row.check_in || "").trim(),
        String(row.check_out || "").trim(),
      ].join("|");
      const current = map.get(key);
      if (
        !current ||
        Number(row.bookingId || 0) > Number(current.bookingId || 0)
      ) {
        map.set(key, row);
      }
    });
    return Array.from(map.values());
  };

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await API.get("/hotel/booking-history");
      setHistory(dedupeHistory(Array.isArray(res.data) ? res.data : []));
      setHistoryPage(1);
    } catch (err) {
      console.error("Failed to load booking history:", err);
      showToast(
        "error",
        "Could not load history",
        "Please check your connection.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  // Pulls payment-history for the most recently created bookings and
  // flattens them into one combined, sorted transaction list for the
  // "Payment History" status-bar step (renderPayments).
  const fetchAllPayments = async () => {
    try {
      setPaymentsLoading(true);
      const recent = [...bookings]
        .sort((a, b) => Number(b.bookingId || 0) - Number(a.bookingId || 0))
        .slice(0, 8);

      const results = await Promise.all(
        recent.map((b) =>
          API.get(`/hotel/payment-history/${b.bookingId}`)
            .then((res) => ({
              booking: b,
              entries: Array.isArray(res.data) ? res.data : [],
            }))
            .catch(() => ({ booking: b, entries: [] })),
        ),
      );

      const flattened = results.flatMap(({ booking, entries }) =>
        entries.map((entry) => ({
          id:
            entry.id ||
            `${booking.bookingId}-${entry.created_at || Math.random()}`,
          bookingId: booking.bookingId,
          bookingCode: booking.bookingCode || `BK-${booking.bookingId}`,
          guestName: entry.guest_name || booking.guest_name || "Guest",
          amount: Number(entry.amount || 0),
          discount: Number(entry.discount_amount || 0),
          paymentMode: entry.payment_mode || "-",
          paymentType: entry.payment_type || entry.type || "Payment",
          createdAt: entry.created_at || booking.check_in,
          status: Number(booking.remainingAmount) > 0 ? "Pending" : "Paid",
          rooms: entry.rooms || booking.rooms || "-",
        })),
      );

      flattened.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setAllPayments(flattened);
    } catch (err) {
      console.error("Failed to load payment history:", err);
      showToast("error", "Could not load payment history", "Please try again.");
      setAllPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  };

  // Shared by the initial load and by handleCloseAddRoom. Kept as one helper
  // so both paths always normalise the backend payload identically — see
  // src/utils/roomCategories.js for why every category must end up with real
  // `rooms` / `roomDetails` arrays (a room type with no rooms yet previously
  // came back as `undefined`, which rendered a permanently empty room
  // dropdown and made the booking unsaveable).
  const loadCategorySetup = (res) => {
    setCategorySetup(
      normalizeRoomCategories(res.data, DEFAULT_ROOMS),
    );
  };

  useEffect(() => {
    fetchBookings();
    API.get("/hotel/rooms/setup")
      .then(loadCategorySetup)
      .catch((err) => console.error("Failed to load room categories:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncFolio = async () => {
      const bookingId = selectedBooking?.bookingId;
      if (!bookingId) return;
      try {
        const folioRes = await API.get(`/hotel/folio/${bookingId}`);
        const allEntries = Array.isArray(folioRes.data) ? folioRes.data : [];
        setFolioCharges(
          allEntries.filter((e) => e.entry_type === "Extra Charge"),
        );
      } catch (err) {
        console.error("Failed to reload folio charges after update:", err);
        setFolioCharges([]);
      }
    };

    window.addEventListener("folioUpdated", syncFolio);
    return () => window.removeEventListener("folioUpdated", syncFolio);
  }, [selectedBooking]);

  useEffect(() => {
    if (!prefillRoomNumber) return;

    setView("form");

    setFormData((prev) => {
      const base = shouldResetDraft ? emptyForm() : prev;
      return {
        ...base,
        checkIn: prefillCheckIn || base.checkIn,
        checkOut: prefillCheckOut || base.checkOut,
      };
    });

    const resolveCategoryId = () => {
      if (!prefillCategory || !categorySetup.length) return "";
      const wanted = normalizeRoomTypeName(prefillCategory);

      const exact = categorySetup.find(
        (c) => normalizeRoomTypeName(c.name) === wanted,
      );
      if (exact) return String(exact.id);

      const tokens = wanted.split(/\s+/).filter(Boolean);
      const fuzzy = categorySetup.find((c) =>
        tokens.every((t) => normalizeRoomTypeName(c.name).includes(t)),
      );
      if (fuzzy) return String(fuzzy.id);

      const ownerByRoom = categorySetup.find((c) =>
        (Array.isArray(c.rooms) ? c.rooms : []).some(
          (rn) => String(rn).trim() === String(prefillRoomNumber).trim(),
        ),
      );
      return ownerByRoom ? String(ownerByRoom.id) : "";
    };

    const categoryId = resolveCategoryId();
    const owningCategory = categorySetup.find(
      (c) => String(c.id) === String(categoryId),
    );
    const defaultPrice = owningCategory
      ? Number(owningCategory.defaultPrice || 0)
      : 0;

    setFormData((prev) => {
      if (!shouldResetDraft && prev.rooms.length > 0) {
        return prev;
      }
      return {
        ...prev,
        roomCategory: categoryId,
        noOfRooms: 1,
        rooms: [
          {
            id: uid(),
            categoryId,
            roomNo: String(prefillRoomNumber).trim(),
            price: defaultPrice,
            gst: 5,
            quantity: 1,
          },
        ],
      };
    });

    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySetup.length, prefillRoomNumber, prefillCategory]);

  useEffect(() => {
    if (!location.state?.autoManage) return;

    const bookingId = location.state.bookingId || null;
    const focusRoomNo = location.state.focusRoomNo || null;
    const guestName = location.state.guestName || "";

    const resolveBooking = () => {
      if (bookingId) {
        const byId = bookings.find(
          (b) =>
            String(b.bookingId) === String(bookingId) ||
            String(b.booking_code) === String(bookingId) ||
            String(b.bookingCode) === String(bookingId),
        );
        if (byId) return byId;
      }

      if (focusRoomNo) {
        const byRoom = bookings.find((b) => {
          const roomTokens = [b.rooms, b.roomNumber, b.roomNo]
            .filter(Boolean)
            .flatMap((v) =>
              typeof v === "string"
                ? v.split(",").map((s) => s.trim())
                : [String(v)],
            )
            .filter(Boolean);
          return roomTokens.includes(String(focusRoomNo));
        });
        if (byRoom) return byRoom;
      }

      if (guestName) {
        return (
          bookings.find((b) =>
            String(b.guest_name || b.guestName || "")
              .toLowerCase()
              .includes(guestName.toLowerCase()),
          ) || null
        );
      }

      return null;
    };

    const matched = resolveBooking();
    if (matched) {
      openManage(matched);
      navigate(location.pathname, { replace: true, state: null });
      return;
    }

    setSearch(focusRoomNo || guestName || "");
    setView("list");
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookings,
    location.state?.autoManage,
    location.state?.bookingId,
    location.state?.focusRoomNo,
    location.state?.guestName,
  ]);

  /* ---------- derived ---------- */

  const filteredBookings = useMemo(() => {
    let list = bookings;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((b) =>
        [b.guest_name, b.bookingCode, b.bookingId, b.mobile, b.rooms]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    // 🐛 FIX: exclude Checked-Out bookings from the "All Bookings" list.
    // Once a guest is checked out, their booking belongs in Booking History
    // only — it should NOT still appear in the active All Bookings table.
    // The checkout restriction (above) already prevents check-out when
    // payment is pending, so any booking reaching Checked-Out here has
    // been fully settled.
    list = list.filter(
      (b) =>
        String(b.booking_status || "")
          .toLowerCase()
          .trim() !== "checked-out",
    );
    return list;
  }, [bookings, search]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / pageSize));
  const pagedBookings = filteredBookings.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  const guestFullName = `${formData.firstName} ${formData.lastName}`.trim();

  const stayNights = useMemo(() => {
    if (!formData.checkIn || !formData.checkOut) return 0;
    const inD = new Date(formData.checkIn);
    const outD = new Date(formData.checkOut);
    const diff = Math.round((outD - inD) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  }, [formData.checkIn, formData.checkOut]);

  // Grand total shown to the guest is GST-inclusive: it is exactly what the
  // invoice bills (pre-tax base + base × gst%). baseTotal is the pre-tax part
  // that the stored row total and the invoice taxable base stay at.
  const baseTotal = useMemo(
    () =>
      formData.rooms.reduce((sum, row) => sum + rowTotal(row, stayNights), 0),
    [formData.rooms, stayNights],
  );
  const grandTotal = useMemo(
    () =>
      formData.rooms.reduce(
        (sum, row) => sum + rowTotalGstInclusive(row, stayNights),
        0,
      ),
    [formData.rooms, stayNights],
  );
  const gstAmount = Math.round((grandTotal - baseTotal) * 100) / 100;

  const [showFolio, setShowFolio] = useState(false);
  const [showGroupBooking, setShowGroupBooking] = useState(false);
  const [showOccupancyForecast, setShowOccupancyForecast] = useState(false);
  const [showGuestProfile, setShowGuestProfile] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);

  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [hotelPdfBusy, setHotelPdfBusy] = useState(false);

  /* ---------- navigation between the 5 "screens" (all local state) ---------- */

  const goToList = () => {
    setView("list");
    fetchBookings();
  };

  const openNewBooking = () => {
    setFormData(emptyForm());
    setIsEdit(false);
    setSelectedBooking(null);
    setView("form");
  };

  const openEditBooking = async (booking) => {
    try {
      setSelectedBooking(booking);
      setStoredBookingId(booking.bookingId);
      const res = await API.get(`/hotel/full-booking/${booking.bookingId}`);
      const data = res.data || {};
      const nameParts = String(data.guest_name || data.guestName || "")
        .trim()
        .split(" ");
      setFormData({
        ...emptyForm(),
        bookingId: booking.bookingId,
        bookingType: data.bookingType || "Walk-In",
        bookingCode:
          data.booking_code || data.bookingCode || booking.bookingCode || "",
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        guestEmail: data.guest_email || data.guestEmail || "",
        mobile: data.mobile || "",
        // The API returns the stored enum member (aadhaar / voter_id /
        // driving_license), but the dropdown options are the human labels from
        // ID_PROOF_TYPE_OPTIONS. Feeding a raw enum into `value` matches no
        // <option>, so the select silently renders as blank/"Select ID Proof
        // Type" — which is why a saved ID proof looked like it was never
        // entered. Normalise to the label before it reaches formData.
        idProofType: idProofLabel(data.id_proof_type || data.idProofType, ""),
        idNumber: data.id_proof_number || data.idNumber || "",
        checkIn: (data.check_in || data.checkIn || "").slice(0, 10),
        checkOut: (data.check_out || data.checkOut || "").slice(0, 10),
        company: data.company_name || data.companyName || "",
        gstNumber: data.company_gst || "",
        // 🐛 FIX: the edit form always started from blank/default payment
        // fields (amount 0, mode "Cash") instead of the booking's actual
        // saved advance. Combined with the save request not including these
        // fields at all, editing a booking silently reset its real advance
        // amount/payment mode back to 0/Cash. Now the form is pre-filled
        // with what's actually stored, so an edit that doesn't touch
        // payment info re-submits the SAME (correct) values instead of
        // wiping them.
        amount: data.paidAmount || 0,
        discountAmount: data.discountAmount || 0,
        paymentMode: data.paymentMode || "Cash",
        paymentNote: data.paymentRemarks || "",
        rooms: (Array.isArray(data.rooms) ? data.rooms : []).map((r) => {
          const roomNo = r.room_number || r.roomNumber || r.roomNo || "";
          const ownerCategory = categorySetup.find((c) =>
            (Array.isArray(c.rooms) ? c.rooms : []).some(
              (rn) => String(rn).trim() === String(roomNo).trim(),
            ),
          );
          return {
            id: uid(),
            categoryId: ownerCategory ? String(ownerCategory.id) : "",
            roomNo,
            price: r.tariff || r.price || 0,
            // Legacy room lines predate per-row GST storage; the resort bills
            // room rent at 5%, so an absent rate reopens at 5, not 0.
            gst: r.gst || r.gstPercent || 5,
            quantity: r.quantity || 1,
          };
        }),
      });
      setIsEdit(true);
      setView("form");
    } catch (err) {
      console.error(err);
      showToast(
        "error",
        "Could not load booking",
        "We couldn't fetch this booking's details for editing.",
      );
    }
  };

  const openDetails = async (booking) => {
    setSelectedBooking(booking);
    setView("details");
    setDetailLoading(true);
    setFolioLoading(true);
    try {
      const res = await API.get(`/hotel/full-booking/${booking.bookingId}`);
      const data = res.data || {};
      setBookingDetail(data);
      if (data.mobile) {
        setSelectedBooking((prev) => ({
          ...(prev || {}),
          mobile: data.mobile,
        }));
      }
    } catch (err) {
      console.error(err);
      setBookingDetail(null);
    } finally {
      setDetailLoading(false);
    }
    try {
      const folioRes = await API.get(`/hotel/folio/${booking.bookingId}`);
      const allEntries = Array.isArray(folioRes.data) ? folioRes.data : [];
      setFolioCharges(
        allEntries.filter((e) => e.entry_type === "Extra Charge"),
      );
    } catch (err) {
      console.error("Failed to load folio charges:", err);
      setFolioCharges([]);
    } finally {
      setFolioLoading(false);
    }
    try {
      const phRes = await API.get(
        `/hotel/payment-history/${booking.bookingId}`,
      );
      const history = Array.isArray(phRes.data) ? phRes.data : [];
      const total = history
        .filter((p) => String(p.payment_type || "").toLowerCase() !== "refund")
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      setTotalPaid(total);
    } catch (err) {
      console.error("Failed to load payment history for total paid:", err);
      setTotalPaid(0);
    }
  };

  const openManage = async (booking) => {
    setSelectedBooking(booking);
    setManageStatus(booking.booking_status || "");
    setView("manage");
    try {
      const res = await API.get(`/hotel/full-booking/${booking.bookingId}`);
      const data = res.data || {};
      if (data.mobile) {
        setSelectedBooking((prev) => ({
          ...(prev || {}),
          mobile: data.mobile,
        }));
      }
    } catch {
      /* best-effort */
    }
  };
  const handleJumpStep = (stepView) => {
    if (stepView === "form") {
      openNewBooking();
      return;
    }

    if (stepView === "list") {
      goToList();
      return;
    }

    if (stepView === "history") {
      setView("history");
      fetchHistory();
      return;
    }

    if (stepView === "payments") {
      setView("payments");
      fetchAllPayments();
      return;
    }

    if (stepView === "confirmed") {
      if (!formData.bookingId) {
        showToast(
          "error",
          "No booking found",
          "Please create a booking first.",
        );
        return;
      }

      setView("confirmed");
      return;
    }

    if (stepView === "group-booking") {
      setShowGroupBooking(true);
      return;
    }

    if (stepView === "guest-booking") {
      setShowGuestProfile(true);
      return;
    }

    if (stepView === "occupancy-forecast") {
      setShowOccupancyForecast(true);
      return;
    }

    if (stepView === "add-room") {
      setShowAddRoom(true);
      return;
    }

    if (stepView === "details") {
      if (!selectedBooking) {
        showToast(
          "error",
          "Select a booking first",
          "Please select any booking.",
        );
        return;
      }

      openDetails(selectedBooking);
      return;
    }

    if (stepView === "manage") {
      if (!selectedBooking) {
        showToast(
          "error",
          "Select a booking first",
          "Please select any booking.",
        );
        return;
      }

      openManage(selectedBooking);
    }
  };

  /* ---------- form field handlers ---------- */

  const setField = (name, value) =>
    setFormData((prev) => ({ ...prev, [name]: value }));

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setField(name, type === "checkbox" ? checked : value);
  };

  const addRoomRow = () => {
    const cat = categorySetup.find(
      (c) => String(c.id) === String(formData.roomCategory),
    );
    const newRow = {
      id: uid(),
      categoryId: formData.roomCategory || "",
      roomNo: "",
      price: cat ? Number(cat.defaultPrice || 0) : 0,
      gst: 5,
      quantity: Number(formData.noOfRooms) || 1,
    };
    setFormData((prev) => ({
      ...prev,
      rooms: [...prev.rooms, newRow],
    }));
  };

  const updateRoomRow = (id, field, value) => {
    setFormData((prev) => ({
      ...prev,
      rooms: prev.rooms.map((r) => {
        if (r.id !== id) return r;

        if (field === "categoryId") {
          const cat = categorySetup.find((c) => String(c.id) === String(value));
          return {
            ...r,
            categoryId: value,
            roomNo: "",
            price: cat ? Number(cat.defaultPrice || 0) : r.price,
          };
        }

        if (field === "gst") {
          const numeric = Math.max(5, Number(value) || 5);
          return { ...r, gst: numeric };
        }

        return { ...r, [field]: value };
      }),
    }));
  };

  const getRoomNumbersForCategory = (categoryId, currentRoomNo = "") => {
    const cat = categorySetup.find((c) => String(c.id) === String(categoryId));
    if (!cat) return [];

    const statusByRoom = new Map();
    (Array.isArray(cat.roomDetails) ? cat.roomDetails : []).forEach((rd) => {
      if (rd.roomNumber) {
        statusByRoom.set(
          String(rd.roomNumber).trim(),
          rd.status || "Available",
        );
      }
    });

    const roomsAlreadyPicked = new Set(
      formData.rooms
        .filter((r) => String(r.categoryId || "") === String(categoryId))
        .map((r) => String(r.roomNo || "").trim())
        .filter((rn) => rn && rn !== String(currentRoomNo || "").trim()),
    );

    return (Array.isArray(cat.rooms) ? cat.rooms : [])
      .map((rn) => String(rn).trim())
      .filter(Boolean)
      .map((rn) => ({
        roomNo: rn,
        status: statusByRoom.get(rn) || "Available",
        alreadyPicked: roomsAlreadyPicked.has(rn),
      }));
  };

  const removeRoomRow = (id) => {
    setFormData((prev) => ({
      ...prev,
      rooms: prev.rooms.filter((r) => r.id !== id),
    }));
  };

  /* ---------- save booking (creates OR updates, all from this one page) ---------- */

  const validateForm = () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      showToast(
        "error",
        "Guest name required",
        "Please enter the guest's first and last name.",
      );
      return false;
    }
    const email = formData.guestEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast(
        "error",
        "Valid email required",
        "Please enter a valid guest email address.",
      );
      return false;
    }
    if (!formData.mobile.trim() || !/^\d{10}$/.test(formData.mobile.trim())) {
      showToast(
        "error",
        "Mobile number required",
        "Please enter a valid 10-digit mobile number.",
      );
      return false;
    }
    if (!formData.idProofType || !String(formData.idProofType).trim()) {
      showToast(
        "error",
        "ID proof type required",
        "Please select the guest's ID proof type.",
      );
      return false;
    }
    if (!formData.idNumber || !String(formData.idNumber).trim()) {
      showToast(
        "error",
        "ID number required",
        "Please enter the guest's ID proof number.",
      );
      return false;
    }
    if (!formData.guestCapacity.trim()) {
      showToast(
        "error",
        "Guest capacity required",
        "Please enter the guest capacity (adults + children).",
      );
      return false;
    }
    if (!formData.address.trim()) {
      showToast(
        "error",
        "Address required",
        "Please enter the guest's address.",
      );
      return false;
    }
    if (!formData.checkIn || !formData.checkOut) {
      showToast(
        "error",
        "Stay dates required",
        "Please select both check-in and check-out dates.",
      );
      return false;
    }
    if (formData.checkOut < formData.checkIn) {
      showToast(
        "error",
        "Invalid dates",
        "Check-out date cannot be before check-in date.",
      );
      return false;
    }
    if (!Array.isArray(formData.rooms) || formData.rooms.length === 0) {
      showToast(
        "error",
        "Room required",
        "Please add at least one room tariff row before saving.",
      );
      return false;
    }
    const missingRoomIndex = formData.rooms.findIndex(
      (row) => !row || !String(row.roomNo || "").trim(),
    );
    if (missingRoomIndex !== -1) {
      showToast(
        "error",
        "Room number required",
        `Row ${missingRoomIndex + 1}: Room number is mandatory. Booking cannot be saved without a room number.`,
      );
      return false;
    }
    const duplicateRoom = (() => {
      const seen = new Set();
      for (let i = 0; i < formData.rooms.length; i += 1) {
        const key = String(formData.rooms[i]?.roomNo || "").trim();
        if (!key) continue;
        if (seen.has(key)) return { index: i, roomNo: key };
        seen.add(key);
      }
      return null;
    })();
    if (duplicateRoom) {
      showToast(
        "error",
        "Duplicate room",
        `Room ${duplicateRoom.roomNo} is already added in row ${duplicateRoom.index + 1}. Please select a different room.`,
      );
      return false;
    }
    return true;
  };

  const handleSaveBooking = async () => {
    if (!validateForm()) return;
    // Synchronous lock: block concurrent re-entry. `saving` state only disables
    // the button after a re-render, so without this a fast double/triple-click
    // starts 3 parallel saves — each creates a NEW booking and each auto-sends
    // its "Booking Confirmed" WhatsApp, so the guest sees it 3 times.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      let bookingId = formData.bookingId;
      let bookingCode = formData.bookingCode;

      if (!isEdit) {
        const bookedBy = localStorage.getItem("name") || "Front Desk";
        const guestRes = await bookingAPI.post("/hotel/guest", {
          agentBooking: false,
          bookingPoint: "",
          mobile: formData.mobile,
          guestName: guestFullName,
          guestEmail: formData.guestEmail,
          checkIn: formData.checkIn,
          checkOut: formData.checkOut,
          arrival: formData.arrival,
          departure: formData.departure,
          bookingStatus: "Confirmed",
          bookedBy,
          bookingType: formData.bookingType,
          // ID Proof fields now persisted on the guest row.
          idProofType: formData.idProofType || "",
          idProofNumber: formData.idNumber || "",
        });
        bookingId = guestRes.data.bookingId;
        bookingCode = guestRes.data.bookingCode || "";
        setStoredBookingId(bookingId);
        setStoredBookingCode(bookingCode);

        const buildPayload = (row) => ({
          roomNumber: row.roomNo,
          date: new Date().toISOString().slice(0, 19).replace("T", " "),
          quantity: row.quantity,
          tariff: row.price,
          gstPercent: row.gst,
          total: rowTotal(row, stayNights),
        });

        const parallelTasks = [
          bookingAPI.post(`/hotel/other-booking/${bookingId}`, {
            bookingType: formData.bookingType,
            bookingSource: formData.bookingType,
            bookingReference: formData.reference,
            address: formData.address,
            country: "",
            state: "",
            city: "",
            pincode: "",
          }),
          bookingAPI.post(`/hotel/reference/${bookingId}`, {
            guestType: "",
            guestNotes: formData.remarks,
            internalNotes: formData.purposeOfVisit,
          }),
          bookingAPI.post(`/hotel/company/${bookingId}`, {
            companyName: formData.company || "Direct Booking",
            gst: formData.gstNumber || "",
          }),
          // Room lines must be created BEFORE pax counts can be written to
          // them: /hotel/room-tariff upserts the booking_rooms row, and
          // /hotel/pax then UPDATEs that row's adults/children. Firing pax in
          // the same batch loses the counts to a 404 "No room line found", so
          // pax is deliberately sequenced after the tariffs below.
          ...formData.rooms.map((row) =>
            bookingAPI.post(
              `/hotel/room-tariff/${bookingId}`,
              buildPayload(row),
            ),
          ),
        ];

        if (Number(formData.amount) > 0) {
          parallelTasks.push(
            bookingAPI.post(`/hotel/advance/${bookingId}`, {
              amount: Number(formData.amount),
              discount: 0,
              paymentMode: formData.paymentMode || "Cash",
              notes: formData.paymentNote,
            }),
          );
        }

        // The room-tariff writes are the ones that actually matter: they create
        // the booking_rooms rows the booking is priced from. Every task is
        // therefore settled independently — an individual secondary failure
        // (company, reference) is logged instead of rejecting the whole batch,
        // which previously discarded the room lines too.
        const results = await Promise.allSettled(parallelTasks);
        const tariffFailures = results.filter(
          (r) =>
            r.status === "rejected" &&
            r.reason?.config?.url?.includes("/room-tariff/"),
        );
        if (tariffFailures.length) {
          throw tariffFailures[0].reason;
        }
        results.forEach((r) => {
          if (
            r.status === "rejected" &&
            !r.reason?.config?.url?.includes("/room-tariff/")
          ) {
            console.warn(
              "Booking sub-save failed:",
              r.reason?.config?.url,
              r.reason?.response?.data,
            );
          }
        });

        // Pax counts run strictly AFTER the room lines exist. /hotel/pax/:id
        // takes a SINGLE room number (room_number / roomNumber) and UPDATEs the
        // matching booking_rooms row — it never accepted the
        // { guestCapacity, owner, rooms: [...] } object the old code sent, so
        // it always answered 400 "Room number required" and took the whole save
        // down with it. Send one call per room row now that the rows exist.
        const capacity = Number(formData.guestCapacity) || 0;
        const totalRooms = formData.rooms.length || 1;
        const adultsPerRoom = capacity
          ? Math.max(1, Math.floor(capacity / totalRooms))
          : 1;

        await Promise.all(
          formData.rooms.map((row) =>
            bookingAPI
              .post(`/hotel/pax/${bookingId}`, {
                roomNumber: row.roomNo,
                adults: adultsPerRoom,
                children: 0,
                guestCapacity: formData.guestCapacity,
                owner: formData.owner,
              })
              .catch((err) => {
                // Pax is metadata, not a room line — never fail the save for it.
                console.warn(
                  "Pax save failed for room",
                  row.roomNo,
                  err.response?.data,
                );
              }),
          ),
        );
      } else {
        // 🐛 FIX: the Edit Booking form has a working "Payment Mode" dropdown
        // (bound to formData.paymentMode) and an Amount field, but this save
        // request never included them — so picking Cash -> UPI/Card looked
        // fine in the form, but the actual save silently dropped it, and the
        // backend fell back to its default (Cash / ₹0). That's why a page
        // refresh always showed the OLD payment mode: it genuinely was never
        // saved. Now these fields are sent so the edit actually persists.
        await bookingAPI.put(`/hotel/full-booking/${bookingId}`, {
          guest_name: guestFullName,
          mobile: formData.mobile,
          company_name: formData.company,
          checkIn: formData.checkIn,
          checkOut: formData.checkOut,
          rooms: formData.rooms.map((r) => ({
            roomNumber: r.roomNo,
            tariff: r.price,
            gst: r.gst,
            quantity: r.quantity,
            total: rowTotal(r, stayNights),
          })),
          paidAmount: Number(formData.amount) || 0,
          discountAmount: Number(formData.discountAmount) || 0,
          paymentMode: formData.paymentMode || "Cash",
          paymentRemarks: formData.paymentNote || "",
          idProofType: formData.idProofType || "",
          idProofNumber: formData.idNumber || "",
          gstNumber: formData.gstNumber || "",
          bookingType: formData.bookingType,
          bookingSource: formData.bookingType,
        });
      }

      setFormData((prev) => ({ ...prev, bookingId, bookingCode }));
      setSelectedBooking((prev) => ({
        ...(prev || {}),
        bookingId,
        bookingCode,
        guest_name: guestFullName,
      }));
      showToast(
        "success",
        isEdit ? "Booking Updated" : "Booking Confirmed",
        isEdit
          ? "The booking has been updated successfully."
          : "Your booking has been created successfully.",
      );
      await fetchBookings();

      setView("confirmed");
    } catch (err) {
      console.error(err);
      showToast(
        "error",
        "Save Failed",
        err.response?.data?.message ||
          "We could not save this booking. Please check the required fields and try again.",
      );
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  /* ---------- manage-booking actions ---------- */

  const extractRoomNumbersFromBooking = (booking) => {
    if (!booking) return [];
    const raw = booking.rooms;
    if (Array.isArray(raw)) {
      return raw
        .map((r) => {
          if (!r) return "";
          if (typeof r === "string") return r;
          return r.room_number || r.roomNumber || r.roomNo || r.roomId || "";
        })
        .map((v) => String(v).trim())
        .filter(Boolean);
    }
    return String(raw || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  };

  const queueRoomsForCleaning = async (booking) => {
    const roomNumbers = extractRoomNumbersFromBooking(booking);
    if (!roomNumbers.length) return;

    const guestName = booking?.guest_name || booking?.guestName || "";
    const bookingCode = booking?.bookingCode || booking?.booking_code || "";

    for (const roomNumber of roomNumbers) {
      const roomKey = String(roomNumber).trim();
      if (!roomKey) continue;

      try {
        await API.put(`/housekeeping/status/${roomKey}`, {
          status: "Vacant Dirty",
        });
      } catch (error) {
        console.warn(
          `Failed to mark room ${roomKey} dirty after checkout`,
          error,
        );
      }

      try {
        const dueAt = new Date(Date.now() + 30 * 60000).toISOString();
        await API.post("/housekeeping/message", {
          roomId: roomKey,
          roomNo: roomKey,
          assignedTo: "Unassigned",
          message: `Cleaning required after check-out${bookingCode ? ` (Booking ${bookingCode})` : ""}${guestName ? ` • Guest: ${guestName}` : ""}`,
          taskLabel: "Post Check-Out Cleaning",
          dueAt,
        });
      } catch (error) {
        console.warn(
          `Failed to create cleaning task message for room ${roomKey}`,
          error,
        );
      }
    }
  };

  // Compute payment status for a booking from live remaining/paid amounts.
  // Used by check-out guard and all on-screen payment status badges:
  // Pending → no payment; Partial → some paid but balance > 0; Paid → fully paid.
  const computePaymentStatus = (booking) => {
    if (!booking) return "Pending";
    const remaining = Number(
      booking.remainingAmount || booking.balanceAmount || 0,
    );
    const paid = Number(booking.netPaid || booking.paidAmount || 0);
    if (remaining <= 0 && paid > 0) return "Paid";
    if (paid > 0) return "Partial";
    return "Pending";
  };

  const handleLifecycle = async (action, booking = selectedBooking) => {
    if (!booking?.bookingId) return;
    const newStatus = action === "check-out" ? "Checked-Out" : "Checked-In";

    // 🐛 RESTRICTION: block check-out if a non-zero balance is still pending.
    // The user must first "Collect Payment" from the Manage Booking screen
    // (or do a partial settlement) until the booking is fully Paid. If the
    // user clicks Check-Out while a balance is still due, we open a warning
    // dialog asking whether to go collect payment first, instead of
    // silently moving the guest to Checked-Out with money still owed.
    if (action === "check-out") {
      const paymentStatus = computePaymentStatus(booking);
      const remaining = Number(
        booking.remainingAmount || booking.balanceAmount || 0,
      );
      if (remaining > 0 && paymentStatus !== "Paid") {
        setCheckoutGuardModal({
          open: true,
          booking,
          remaining,
          paymentStatus,
        });
        return;
      }
    }

    try {
      await API.put(`/hotel/${action}/${booking.bookingId}`);
      if (action === "check-out") {
        await queueRoomsForCleaning(booking);
      }
      showToast(
        "success",
        action === "check-out" ? "Checked Out" : "Checked In",
        action === "check-out"
          ? "Guest has been checked out. Room moved to Cleaning on the Dashboard."
          : "Guest has been checked in successfully.",
      );
      // After checkout, re-fetch active bookings (Checked-Out are now
      // filtered out of the All Bookings list) and also refresh the
      // booking-history list so the just-checked-out guest appears there.
      await fetchBookings();
      await fetchHistory();
      setSelectedBooking((prev) => ({
        ...(prev || {}),
        booking_status: newStatus,
      }));
    } catch (err) {
      console.error(err);
      showToast(
        "error",
        "Action Failed",
        "We could not update this booking's status. Please try again.",
      );
    }
  };

  const handleConfirmCancel = async () => {
    if (!selectedBooking?.bookingId) return;
    const reason = cancelModal.reason.trim();
    if (!reason) {
      showToast(
        "error",
        "Reason required",
        "Please enter a cancellation reason.",
      );
      return;
    }
    try {
      setCancelModal((c) => ({ ...c, submitting: true }));
      await API.put(`/hotel/cancel/${selectedBooking.bookingId}`, { reason });
      setCancelModal({ open: false, reason: "", submitting: false });
      showToast(
        "success",
        "Booking Cancelled",
        `Booking #${selectedBooking.bookingCode || selectedBooking.bookingId} has been cancelled.`,
      );
      await fetchBookings();
      goToList();
    } catch (err) {
      console.error(err);
      setCancelModal((c) => ({ ...c, submitting: false }));
      showToast(
        "error",
        "Cancellation Failed",
        err.response?.data?.message || "Could not cancel this booking.",
      );
    }
  };

  const handleCollectPayment = async () => {
    if (!selectedBooking?.bookingId) return;
    const amount = Number(collectModal.amount);
    if (!amount || amount <= 0) {
      showToast(
        "error",
        "Enter a valid amount",
        "Payment amount must be greater than zero.",
      );
      return;
    }
    try {
      setCollectModal((c) => ({ ...c, submitting: true }));
      await API.post(`/hotel/advance/${selectedBooking.bookingId}`, {
        amount,
        discount: 0,
        paymentMode: collectModal.mode,
      });
      setCollectModal({
        open: false,
        amount: "",
        mode: "Cash",
        submitting: false,
      });
      showToast(
        "success",
        "Payment Collected",
        `${formatCurrency(amount)} recorded against this booking.`,
      );

      // Re-fetch bookings (and the detail rows) so the booking's paidAmount /
      // remainingAmount / status update everywhere — booking list, booking
      // details, manage booking, accounts billing, accounts dashboard, etc.
      // Without this, the payment status badge kept showing "Pending" even
      // after a successful collection.
      await fetchBookings();

      // Compute the new payment state from the freshly-fetched booking row.
      // If the user just settled the final balance, close the checkout guard
      // (if open) and surface a "Paid" toast.
      const refreshed = (bookings || []).find(
        (b) => String(b.bookingId) === String(selectedBooking.bookingId),
      );
      const liveBooking = refreshed || selectedBooking;
      const oldPaid = Number(
        liveBooking.netPaid || liveBooking.paidAmount || 0,
      );
      const oldRemaining = Number(
        liveBooking.remainingAmount || liveBooking.balanceAmount || 0,
      );
      const newPaid = oldPaid + amount;
      const newRemaining = Math.max(oldRemaining - amount, 0);

      // Patch selectedBooking with the new totals so the Manage screen's
      // payment-status badge immediately flips to Paid once balance is zero.
      setSelectedBooking((prev) => ({
        ...(prev || {}),
        ...(liveBooking || {}),
        netPaid: newPaid,
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        balanceAmount: newRemaining,
      }));

      // Also patch the bookings list optimistically so other views (Accounts
      // dashboard billing list, Bookings table, etc.) reflect the new status
      // without a second round trip.
      setBookings((prev) =>
        prev.map((b) =>
          String(b.bookingId) === String(selectedBooking.bookingId)
            ? {
                ...b,
                netPaid: newPaid,
                paidAmount: newPaid,
                remainingAmount: newRemaining,
                balanceAmount: newRemaining,
              }
            : b,
        ),
      );

      // If the booking just became fully Paid and a checkout-guard dialog
      // was waiting on this very payment, auto-close the guard and tell the
      // user they can now proceed to check-out.
      if (newRemaining <= 0 && oldRemaining > 0) {
        if (checkoutGuardModal.open) {
          setCheckoutGuardModal({
            open: false,
            booking: null,
            remaining: 0,
            paymentStatus: "Pending",
          });
          showToast(
            "success",
            "Payment Complete",
            `Booking ${liveBooking.bookingCode || liveBooking.bookingId} is now fully Paid. You may proceed to Check-Out.`,
          );
        } else {
          showToast(
            "success",
            "Fully Paid",
            `Booking ${liveBooking.bookingCode || liveBooking.bookingId} is now fully Paid.`,
          );
        }
        // Broadcast a global event so Accounts pages re-fetch their
        // billing / summary when this same browser session is showing them.
        window.dispatchEvent(
          new CustomEvent("bookingPaymentUpdated", {
            detail: {
              bookingId: selectedBooking.bookingId,
              paidAmount: newPaid,
              remainingAmount: newRemaining,
            },
          }),
        );
        window.dispatchEvent(new Event("accountsUpdated"));
      }
    } catch (err) {
      console.error(err);
      setCollectModal((c) => ({ ...c, submitting: false }));
      showToast(
        "error",
        "Payment Failed",
        err.response?.data?.message || "Could not record this payment.",
      );
    }
  };

  const handleRefund = async () => {
    if (!selectedBooking?.bookingId) return;
    const amount = Number(refundModal.amount);
    if (!amount || amount <= 0) {
      showToast(
        "error",
        "Enter a valid amount",
        "Refund amount must be greater than zero.",
      );
      return;
    }
    try {
      setRefundModal((r) => ({ ...r, submitting: true }));
      await API.post(`/hotel/refund/${selectedBooking.bookingId}`, { amount });
      setRefundModal({ open: false, amount: "", submitting: false });
      showToast(
        "success",
        "Refund Processed",
        `${formatCurrency(amount)} has been refunded.`,
      );
      await fetchBookings();
    } catch (err) {
      console.error(err);
      setRefundModal((r) => ({ ...r, submitting: false }));
      showToast("error", "Refund Failed", "Could not process this refund.");
    }
  };

  const handleOpenFolio = (booking) => {
    if (!booking?.bookingId) return;

    setStoredBookingId(booking.bookingId);
    setStoredBookingCode(booking.bookingCode || "");
    setSelectedBookingId(booking.bookingId);
    setShowFolio(true);
  };

  const handleCloseFolio = () => {
    setShowFolio(false);
    setSelectedBookingId(null);
  };

  const handleOpenPaymentHistory = (booking) => {
    if (!booking?.bookingId) return;
    setShowPaymentHistory(true);
  };

  const handleClosePaymentHistory = () => {
    setShowPaymentHistory(false);
    setPaymentHistory([]);
  };

  const handleCloseDocumentUpload = () => {
    setShowDocumentUpload(false);
    window.dispatchEvent(new Event("folioUpdated"));
  };

  const handleOpenGroupBooking = (booking) => {
    if (!booking?.bookingId) return;
    setSelectedBookingId(booking.bookingId);
    setShowGroupBooking(true);
  };

  // Send invoice to customer WhatsApp + admin WhatsApp directly from booking details
  const handleSendWhatsAppFromDetails = async () => {
    const bid = selectedBooking?.bookingId;
    if (!bid) return;
    setWaSending(true);
    setWaResult(null);
    try {
      let invoice = null;
      try {
        const existing = await API.get(`/invoice/by-booking/${bid}`, { timeout: 10000 });
        if (existing.data?.id) invoice = existing.data;
      } catch {
        /* not found, will generate */
      }

      if (!invoice) {
        const generated = await API.get(`/invoice/${bid}`, { timeout: 10000 });
        invoice = generated.data || null;
      }
      if (!invoice) {
        setWaResult({ type: "error", message: "Could not generate invoice." });
        setWaSending(false);
        return;
      }

      const b = selectedBooking || {};
      const d = bookingDetail || {};
      // 🐛 FIX: totals were already computed from live data, but
      // `bookingRooms` was read from `selectedBooking.rooms` (the stale
      // summary row from the bookings list) and — worse — the `items` sent
      // to the backend were `invoice.items`, the raw, possibly-outdated
      // line items saved on the invoice row in the database. Whenever a
      // booking's stay length or room list changed after the invoice was
      // first generated (e.g. extended from 1 night to 3-4 nights, or
      // rooms added), the total shown matched the current booking but the
      // itemised WhatsApp PDF still showed the OLD 1-room/1-night
      // breakdown. Fixed by reading rooms from the live `bookingDetail`
      // (same source the Booking Details page uses for its total) and by
      // building a fresh `items` array from that live data instead of
      // reusing `invoice.items`.
      const bookingRooms =
        Array.isArray(d.rooms) && d.rooms.length > 0
          ? d.rooms
          : Array.isArray(b.rooms)
            ? b.rooms
            : [];
      const roomTotal = bookingRooms.reduce(
        (sum, r) => sum + (Number(r.total) || Number(r.amount) || 0),
        0,
      );

      // Try to load folio charges for accurate totals
      let folioEntries = [];
      try {
        const folioRes = await API.get(`/hotel/folio/${bid}`, { timeout: 10000 });
        folioEntries = Array.isArray(folioRes.data) ? folioRes.data : [];
      } catch {
        /* best-effort */
      }
      const folioChargeEntries = folioEntries.filter(
        (e) => e.entry_type === "Extra Charge",
      );
      const folioTotal = folioChargeEntries.reduce(
        (sum, e) => sum + (Number(e.amount) || 0),
        0,
      );

      const computedTotal = roomTotal + folioTotal;
      // 🐛 FIX: this used to always assume a flat 5% GST ("/ 1.05") when
      // reversing the tax out of the total. A room configured with 0% GST
      // (or any rate other than 5%) got the wrong subtotal/tax split, which
      // then flowed into the PDF as an inflated Final Total (e.g. a real
      // ₹2,000 room printed as ₹2,100). Now the subtotal is the actual sum
      // of each room's own taxable amount, computed from its real GST %.
      const computedSubtotal =
        bookingRooms.reduce((sum, r) => {
          const tariff = Number(r.tariff ?? r.price ?? 0);
          const qty = Number(r.quantity ?? 1);
          const gstPercent = Number(r.gst ?? r.gstPercent ?? 0);
          const total = Number(r.total ?? tariff * qty) || 0;
          const taxable =
            gstPercent > 0 ? total / (1 + gstPercent / 100) : total;
          return sum + taxable;
        }, 0) + folioTotal; // folio extra charges are treated as tax-exempt, same as before
      const computedTax = computedTotal - computedSubtotal;

      // Build the live itemised breakdown (one line per room + one per
      // folio extra charge) so the WhatsApp PDF matches what the Booking
      // Details / Generate Invoice screens show. Each room now also carries
      // its real gstPercent so the backend PDF applies the correct tax
      // instead of assuming a flat 5%.
      const liveItems = [
        ...bookingRooms.map((r) => {
          const roomNo = r.room_number || r.roomNumber || r.roomNo || "";
          const roomType = r.roomType || r.room_type || r.category || "Room";
          const tariff = Number(r.tariff ?? r.price ?? 0);
          const qty = Number(r.quantity ?? 1);
          const gstPercent = Number(r.gst ?? r.gstPercent ?? 0);
          const total = Number(r.total ?? tariff * qty) || 0;
          return {
            name: `${roomType} - Room ${roomNo}`,
            price: tariff,
            quantity: qty,
            gstPercent,
            total,
          };
        }),
        ...folioChargeEntries.map((e) => ({
          name: e.description || e.category || "Extra Charge",
          price: Number(e.amount) || 0,
          quantity: 1,
          gstPercent: 0,
          total: Number(e.amount) || 0,
        })),
      ];

      const customerMobile = b.mobile || d.mobile || "";
      const response = await API.post(
        "/hotel/invoice/pdf",
        {
          bookingId: bid,
          customerNumber: customerMobile,
          invoiceData: {
            invoiceNo: invoice.invoiceNo || invoice.invoice_no || `INV-${bid}`,
            totalAmount: computedTotal,
            subtotal: computedSubtotal,
            tax: computedTax,
            advancePaid: Number(totalPaid) || 0,
            balanceLeft: Math.max(computedTotal - (Number(totalPaid) || 0), 0),
            customerName: invoice.customerName || d.guest_name || b.guest_name || "Guest",
            phone: customerMobile,
            roomNumber: bookingRooms
              .map((room) => room.room_number || room.roomNumber || room.roomNo)
              .filter(Boolean)
              .join(", "),
            checkIn: invoice.checkIn || invoice.check_in || b.check_in || "",
            checkOut: invoice.checkOut || invoice.check_out || b.check_out || "",
            items: liveItems,
          },
        },
        { timeout: 20_000 },
      );
      const customerSent = response.data?.customer?.whatsapp?.ok;
      const customerSkipped = response.data?.customer?.whatsapp?.skipped;
      setWaResult({
        type: customerSent || customerSkipped ? "success" : "error",
        message: customerSent
          ? "Invoice details sent successfully on WhatsApp."
          : customerSkipped
            ? `Invoice details were not sent: ${response.data.customer.whatsapp.reason || "customer WhatsApp is unavailable"}.`
            : response.data?.customer?.whatsapp?.error || "Invoice URL could not be sent.",
      });
    } catch (err) {
      setWaResult({
        type: "error",
        message: err.response?.data?.error || err.message || "Send failed.",
      });
    } finally {
      setWaSending(false);
    }
  };

  // ============================================================
  // Shared "Tax Invoice" document builder — the single source of truth for
  // the hotel print/PDF invoice. Both the "Print Invoice" button and the
  // "PDF" download render THIS template (via buildHotelInvoiceDocument),
  // so the downloaded file is pixel-identical to the printed sheet instead
  // of a separate, divergent layout.
  const buildHotelInvoiceDocument = () => {
    const d = bookingDetail || {};
    const b = selectedBooking || {};

    const roomChargesTotal =
      Array.isArray(d.rooms) && d.rooms.length > 0
        ? d.rooms.reduce((sum, r) => sum + (Number(r.total) || 0), 0)
        : Number(b.totalAmount) || 0;

    const folioChargesTotal = folioCharges.reduce(
      (sum, e) => sum + (Number(e.amount) || 0),
      0,
    );
    // Same pre-tax-vs-inclusive rule as the details screen: the stored room
    // totals are pre-tax, so add the per-room GST back for the grand totals.
    const roomsList = Array.isArray(d.rooms) && d.rooms.length > 0 ? d.rooms : [];
    const roomsGstAmount = roomsList.length
      ? roomsList.reduce(
          (sum, r) =>
            sum +
            (Number(r.total) || 0) *
              ((Number(r.gst ?? r.gstPercent ?? 5) || 0) / 100),
          0,
        )
      : roomChargesTotal * 0.05;
    const finalTotal = roomChargesTotal + folioChargesTotal + roomsGstAmount;
    const effectivePaid = totalPaid > 0 ? totalPaid : Number(b.paidAmount) || 0;
    const remainingAmount =
      effectivePaid > 0 ? Math.max(finalTotal - effectivePaid, 0) : 0;
    const invoiceNo =
      d.invoice_no || d.invoiceNo || b.bookingCode || `INV-${b.bookingId}`;
    const guestName = d.guest_name || b.guest_name || "AMAR SHARMA";
    const printCompanyName = d.company_name || b.company_name || "";
    const printCompanyGstin = d.company_gst || b.company_gst || "";
    const roomType =
      (Array.isArray(d.rooms) && d.rooms[0] && (d.rooms[0].roomType || d.rooms[0].room_type)) ||
      d.room_type || b.room_type || b.roomType || "Single";
    const roomNo =
      d.room_no ||
      d.roomNumber ||
      d.room_no_list ||
      (Array.isArray(d.rooms) && d.rooms[0]
        ? d.rooms[0].room_number || d.rooms[0].roomNo || d.rooms[0].room_no
        : null) ||
      b.room_no ||
      b.roomNumber ||
      (Array.isArray(b.rooms) && b.rooms[0]
        ? b.rooms[0].room_number || b.rooms[0].roomNo || b.rooms[0].room_no
        : null) ||
      "104";
    const noOfNights =
      d.no_of_nights || b.no_of_nights || b.nights || d.nights || 1;
    const pax =
      d.no_of_guests || d.guest_capacity || b.no_of_guests || "2 Adults, 0";
    const guestAddress = d.address || b.address || "BHOPAL";
    const guestContact =
      d.mobile || d.contact_no || b.mobile || b.contact_no || "9424825679";
    const folioNo = b.bookingId || d.booking_id || "-";
    const invoiceDate = formatDate(d.invoice_date || new Date());
    const checkInDate =
      d.check_in || b.check_in
        ? formatDate(new Date(d.check_in || b.check_in))
        : "-";
    const checkOutDate =
      d.check_out || b.check_out
        ? formatDate(new Date(d.check_out || b.check_out))
        : "-";
    const arrivalTime = d.arrival_time || d.arrival || "4:25 pm";
    const departureTime = d.departure_time || d.departure || "10:00 am";
    const amountInWords = toWords(finalTotal);
    const paymentMode =
      d.payment_mode || d.paymentMode || b.payment_mode || "UPI";
    const generatedBy = b.generated_by || b.staff_name || "ABHISHEK RATHORE";

    // Build per-day line items (one row per night of stay), exactly like
    // the reference: "Room Charges - SUPER Deluxe - SUPER Deluxe" on its
    // own row for each stay date.
    const stayDates = [];
    if (d.check_in && d.check_out) {
      const start = new Date(d.check_in);
      const end = new Date(d.check_out);
      const total = Math.max(
        1,
        Math.round((end - start) / (1000 * 60 * 60 * 24)),
      );
      for (let i = 0; i < total; i += 1) {
        const dt = new Date(start);
        dt.setDate(start.getDate() + i);
        stayDates.push(dt);
      }
    }
    if (stayDates.length === 0) {
      stayDates.push(new Date());
    }

    // Stored booking_rooms totals are PRE-tax, so the GST has to be added
    // back per room (row total × (1 + row gst%/100)) and the per-night
    // line items carry that inclusive gross; the tax columns then split
    // it into taxable + SGST/CGST at the room's real rate.
    const printRoomsList =
      Array.isArray(d.rooms) && d.rooms.length > 0 ? d.rooms : [];
    const roomsGstInclusiveTotal = printRoomsList.length
      ? printRoomsList.reduce(
          (sum, r) =>
            sum +
            (Number(r.total) || 0) *
              (1 + ((Number(r.gst ?? r.gstPercent ?? 5) || 0) / 100)),
          0,
        )
      : roomChargesTotal * 1.05;
    const weightedGstPercent =
      roomChargesTotal > 0
        ? (roomsGstInclusiveTotal / roomChargesTotal - 1) * 100
        : 0;
    const perNightGrossTotal =
      stayDates.length > 0
        ? Number((roomsGstInclusiveTotal / stayDates.length).toFixed(2))
        : 0;
    const perNightDisc = 0;
    const perNightTaxable =
      weightedGstPercent > 0
        ? Number(
            (perNightGrossTotal / (1 + weightedGstPercent / 100)).toFixed(2),
          )
        : perNightGrossTotal;
    const perNightSgst = Number(
      ((perNightGrossTotal - perNightTaxable) / 2).toFixed(2),
    );
    const perNightCgst = perNightSgst;
    const perNightTotal = perNightGrossTotal;

    const dayRows = stayDates.map((dt) => ({
      date: formatDate(dt),
      particulars: `Room Charges - ${(roomType || "Room").toUpperCase()} - ${(roomType || "Room").toUpperCase()}`,
      tariff: perNightTaxable,
      disc: perNightDisc,
      taxable: perNightTaxable,
      sgst: perNightSgst,
      cgst: perNightCgst,
      total: perNightTotal,
    }));

    const folioRows = folioCharges.map((e) => {
      const amt = Number(e.amount) || 0;
      // 🐛 FIX (this revision): Folio entries now carry 5% GST-inclusive amounts
      // (e.g. Room Service charges from Roomitem.jsx). If the category is
      // "Room Service" (or "Restaurant"), split the stored total back into
      // taxable + 5% GST so the printed invoice shows the proper SGST/CGST
      // columns instead of lumping everything into "tariff" with 0% GST.
      const isGstCategory =
        e.category === "Room Service" || e.category === "Restaurant";
      const gstPercent = isGstCategory ? 5 : 0;
      const taxable =
        gstPercent > 0
          ? Number((amt / (1 + gstPercent / 100)).toFixed(2))
          : amt;
      const sgst = Number(((amt - taxable) / 2).toFixed(2));
      const cgst = sgst;
      return {
        date: e.date ? formatDate(new Date(e.date)) : formatDate(new Date()),
        particulars: e.description || e.category || "Extra Charge",
        tariff: taxable,
        disc: 0,
        taxable,
        sgst,
        cgst,
        total: amt,
      };
    });

    const allItems = [...dayRows, ...folioRows];
    const tariffTotal = allItems.reduce((s, i) => s + i.tariff, 0);
    const totalDiscount = allItems.reduce((s, i) => s + i.disc, 0);
    const totalTaxable = allItems.reduce((s, i) => s + i.taxable, 0);
    const totalSgst = allItems.reduce((s, i) => s + i.sgst, 0);
    const totalCgst = allItems.reduce((s, i) => s + i.cgst, 0);
    const roundOff = 0.0;
    const serviceTotal = 0.0;
    // Room Total in the reference = sum(tariff) + SGST + CGST (per night totals)
    const roomTotalComputed = Number(
      (tariffTotal + totalSgst + totalCgst).toFixed(2),
    );
    const amountInWordsClean = amountInWords
      .replace(/^Rupees\s+/i, "")
      .replace(/\s*Only$/i, "");

    const renderInvoiceRow = (item) => `
      <tr>
        <td class="td-date">${item.date}</td>
        <td class="td-particulars">${item.particulars}</td>
        <td class="text-right">${formatCurrency(item.tariff)}</td>
        <td class="text-right">${item.disc > 0 ? formatCurrency(item.disc) : "0.00"}</td>
        <td class="text-right">${formatCurrency(item.taxable)}</td>
        <td class="text-right">${formatCurrency(item.sgst)}</td>
        <td class="text-right">${formatCurrency(item.cgst)}</td>
        <td class="text-right td-total">${formatCurrency(item.total)}</td>
      </tr>
    `;

    // Format per-night totals to 2 decimals everywhere (matches reference)
    const fmtMoney = (v) =>
      Number(v || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    return `
      <html>
      <head>
        <title>${invoiceNo} - ${RESORT_NAME_INVOICE}</title>
        <style>
          @page { size: A4; margin: 6mm; }
          html, body {
            background: #ffffff !important;
            background-color: #ffffff !important;
            color: #000000;
            margin: 0; padding: 0;
          }
          * { box-sizing: border-box; }
          body {
            font-family: "Helvetica", Arial, sans-serif;
            color: #000000;
            background: #ffffff !important;
            padding: 0;
            font-size: 10px;
            line-height: 1.35;
          }

          /* Outer framed container — the entire invoice sits inside
             one big black-bordered box, exactly like the reference. */
          .invoice {
            border: 1.5px solid #000000;
            padding: 0;
            width: 100%;
          }

          /* ── 1. "Tax Invoice" centered title ───────────────────── */
          .title-row {
            text-align: center;
            padding: 6px 0 4px 0;
          }
          .title-row h1 {
            margin: 0;
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 0.02em;
          }

          /* ── 2. Resort logo + name + address block ────────────── */
          .resort-block {
            text-align: center;
            padding: 2px 0 6px 0;
          }
          .resort-block .leaf {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px; height: 18px;
            background: #16a34a;
            color: #fff;
            border-radius: 50%;
            font-size: 11px;
            margin-right: 4px;
            vertical-align: middle;
          }
          .resort-block .name {
            display: inline-block;
            vertical-align: middle;
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.03em;
          }
          .resort-block .sub {
            font-size: 10px;
            margin-top: 2px;
            line-height: 1.45;
          }
          .resort-block .gst {
            font-weight: 800;
            font-size: 10px;
            margin-top: 2px;
          }

          .divider {
            border-top: 1.5px solid #000000;
            margin: 0;
          }

          /* ── 3. Guest-info (left) | Booking-info (right) ──────── */
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            width: 100%;
          }
          .meta-cell {
            padding: 6px 10px;
          }
          .meta-cell + .meta-cell {
            border-left: 1px solid #000000;
          }
          .meta-row-line {
            font-size: 10px;
            line-height: 1.6;
          }
          .meta-row-line .lbl {
            display: inline-block;
            min-width: 110px;
            font-weight: 700;
          }
          .meta-row-line .val {
            font-weight: 500;
          }

          /* ── 4. Billing-Details items table ──────────────────── */
          .section-label {
            padding: 4px 10px;
            font-weight: 800;
            font-size: 10px;
          }
          table.items {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5px;
          }
          table.items thead th {
            background: #ffffff;
            color: #000;
            border-top: 1px solid #000000;
            border-bottom: 1px solid #000000;
            padding: 4px 5px;
            font-weight: 700;
            font-size: 9px;
            text-align: left;
          }
          table.items tbody td {
            padding: 4px 5px;
            border-bottom: 1px solid #000000;
            vertical-align: middle;
            font-size: 9.5px;
          }
          table.items tbody tr:last-child td {
            border-bottom: 1px solid #000000;
          }
          table.items tbody td {
            border-left: 1px solid #000000;
            border-right: 1px solid #000000;
          }
          table.items thead th {
            border-left: 1px solid #000000;
            border-right: 1px solid #000000;
          }
          .td-date { white-space: nowrap; }
          .td-particulars { line-height: 1.3; }
          .td-total { font-weight: 800; }
          .text-right { text-align: right; }

          /* ── 5. Remarks (left) | Payment-summary (right) ──────── */
          .bottom-grid {
            display: grid;
            grid-template-columns: 1.05fr 0.95fr;
            width: 100%;
            border-top: 1px solid #000000;
          }
          .remarks-cell {
            padding: 8px 10px;
            border-right: 1px solid #000000;
            min-height: 150px;
          }
          .remarks-cell .lbl {
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.06em;
            margin-bottom: 4px;
          }
          .totals-list {
            font-size: 10px;
            line-height: 1.6;
          }
          .totals-list .row {
            display: flex;
            justify-content: space-between;
            padding: 1px 4px;
          }
          .totals-list .row.bold {
            font-weight: 800;
          }

          /* ── 6. Amount-in-words (left) | Final Total (right) ─── */
          .words-row {
            display: grid;
            grid-template-columns: 1.05fr 0.95fr;
            border-top: 1px solid #000000;
            width: 100%;
          }
          .words-cell {
            padding: 8px 10px;
            font-weight: 700;
            font-size: 11px;
            border-right: 1px solid #000000;
          }
          .final-cell {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 10px;
            font-weight: 800;
            font-size: 12px;
          }
          .final-cell .lbl { font-size: 12px; }
          .final-cell .val { font-size: 14px; }

          /* ── 7. Invoice Note (left) | Payment Detail (right) ── */
         .footer-row {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  border-top: 1px solid #000000;
  width: 100%;
  min-height: 58px;
}

.note-cell {
  border-right: 1px solid #000000;
  padding: 0;
  font-size: 10px;
}

.payment-detail {
  padding: 0;
  font-size: 10px;
}

.footer-row .section-header {
  height: 22px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  padding: 3px 10px;
  border-bottom: 1px solid #000000;
  font-size: 10px;
  font-weight: 800;
}

.note-content {
  padding: 7px 10px;
  font-size: 10px;
  font-weight: 600;
}

.payment-content {
  padding: 5px 10px;
  font-size: 9px;
}

.payment-detail .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 4px;
}

.payment-detail .row.bold {
  font-weight: 800;
}

.payment-detail .divider {
  border-top: 1px solid #000000;
  margin: 2px 0;
}

          /* ── Outer box bottom border ── */
          .invoice-bottom {
            border-top: 1.5px solid #000000;
          }

          /* ── Signature section ───────────────────────────── */

/* ── Signature section ───────────────────────────── */

.signature-area {
  position: relative;
  height: 160px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-top: 1px solid #000000;
}

/* Main signature row */
.sig-row {
  position: relative;
  width: 100%;
  height: 100%;
  margin: 0;
}

/* FOR MAA BAGLAMUKHI RESORT - TOP LEFT */
.sig-row .for {
  position: absolute;
  top: 0;
  left: 2px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

/* AUTHORIZED SIGNATURE - LOWER LEFT */
.sig-row .sig-line-block.authorized {
  position: absolute;
  left: 2px;
  bottom: 35px;
  width: 180px;
  text-align: center;
}

.sig-row .sig-line-block.authorized .line {
  display: block;
  border-top: 1px solid #000000;
  padding-top: 4px;
  font-size: 9px;
  font-weight: 600;
}

/* GUEST SIGNATURE - TOP RIGHT */
.sig-row .sig-line-block.guest {
  position: absolute;
  right: 2px;
  top: 0;
  width: 180px;
  text-align: center;
}

.sig-row .sig-line-block.guest .line {
  display: block;
  margin-top: 55px;
  border-top: 1px solid #000000;
  padding-top: 4px;
  font-size: 9px;
  font-weight: 600;
}

/* INVOICE GENERATED BY - BOTTOM LEFT */
.generated-by {
  position: absolute;
  left: 12px;
  bottom: 6px;
  text-align: left;
  font-size: 9px;
  font-weight: 700;
  margin: 0;
  padding: 0;
  white-space: nowrap;
}

.generated-by .lbl {
  font-weight: 600;
}

        </style>
      </head>
      <body>
        <div class="invoice">

          <div class="title-row">
            <h1>Tax Invoice</h1>
          </div>

          <div class="resort-block">
            <div>
              <span class="leaf">❀</span><span class="name">MAA BAGLAMUKHI RESORT</span>
            </div>
            <div class="sub">${RESORT_ADDRESS_LINE_1}</div>
            <div class="sub">District: ${RESORT_ADDRESS_LINE_2}</div>
            <div class="sub">Ph: ${RESORT_PHONE_INVOICE}</div>
            <div class="sub">${RESORT_EMAIL_INVOICE} | ${RESORT_WEBSITE}</div>
            <div class="gst">GSTN: ${RESORT_GSTIN_INVOICE}</div>
          </div>

          <div class="divider"></div>

          <div class="meta-grid">
            <div class="meta-cell">
              <div class="meta-row-line"><span class="lbl">Folio No.</span><span class="val">${folioNo}</span></div>
              <div class="meta-row-line"><span class="lbl">Guest Name</span><span class="val">${guestName.toUpperCase()}</span></div>
              <div class="meta-row-line"><span class="lbl">Address</span><span class="val">${guestAddress.toUpperCase()}</span></div>
              <div class="meta-row-line"><span class="lbl">Contact #</span><span class="val">${guestContact}</span></div>
              ${printCompanyName ? `<div class="meta-row-line"><span class="lbl">Company</span><span class="val">${printCompanyName.toUpperCase()}</span></div>` : ""}
              ${printCompanyGstin ? `<div class="meta-row-line"><span class="lbl">GSTIN</span><span class="val">${printCompanyGstin.toUpperCase()}</span></div>` : ""}
            </div>
            <div class="meta-cell">
              <div class="meta-row-line"><span class="lbl">Invoice No.</span><span class="val">${invoiceNo}</span></div>
              <div class="meta-row-line"><span class="lbl">Invoice Date</span><span class="val">${invoiceDate}</span></div>
              <div class="meta-row-line"><span class="lbl">Room No.</span><span class="val">${roomNo}</span></div>
              <div class="meta-row-line"><span class="lbl">Room Type</span><span class="val">${roomType}</span></div>
              <div class="meta-row-line"><span class="lbl">Arrival</span><span class="val">${checkInDate} ${arrivalTime}</span></div>
              <div class="meta-row-line"><span class="lbl">Departure</span><span class="val">${checkOutDate} ${departureTime}</span></div>
              <div class="meta-row-line"><span class="lbl">Pax</span><span class="val">${pax}</span></div>
              <div class="meta-row-line"><span class="lbl">No. of Nights</span><span class="val">${noOfNights}</span></div>
            </div>
          </div>
          <div class="divider"></div>

          <div class="section-label">Billing Details</div>
          

          <table class="items">
            <thead>
              <tr>
                <th style="width:11%">Date</th>
                <th style="width:38%">Particulars</th>
                <th style="width:9%" class="text-right">Tariff</th>
                <th style="width:7%" class="text-right">Disc</th>
                <th style="width:9%" class="text-right">Taxable</th>
                <th style="width:9%" class="text-right">SGST 2.5%</th>
                <th style="width:9%" class="text-right">CGST 2.5%</th>
                <th style="width:8%" class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${allItems.length > 0 ? allItems.map(renderInvoiceRow).join("") : `<tr><td colspan="8" style="text-align:center;padding:10px">No charges recorded</td></tr>`}
            </tbody>
          </table>

          <div class="bottom-grid">
            <div class="remarks-cell">
              <div class="lbl">Remarks</div>
              <div style="font-size:10px;color:#64748b;min-height:120px">&nbsp;</div>
            </div>
            <div class="remarks-cell" style="border-right:0">
              <div class="totals-list">
                <div class="row"><span>Tariff Total</span><span>${fmtMoney(tariffTotal)}</span></div>
                <div class="row"><span>Discount</span><span>${fmtMoney(totalDiscount)}</span></div>
                <div class="row"><span>Taxable Amount</span><span>${fmtMoney(totalTaxable)}</span></div>
                <div class="row"><span>GST (SGST 2.5%)</span><span>${fmtMoney(totalSgst)}</span></div>
                <div class="row"><span>GST (CGST 2.5%)</span><span>${fmtMoney(totalCgst)}</span></div>
                <div class="row bold"><span>Room Total</span><span>${fmtMoney(roomTotalComputed)}</span></div>
                <div class="row"><span>Round Off Disc.</span><span>${fmtMoney(roundOff)}</span></div>
                <div class="row bold"><span>Final Total</span><span>${fmtMoney(finalTotal)}</span></div>
                <div class="row"><span>Service Total</span><span>${fmtMoney(serviceTotal)}</span></div>
              </div>
            </div>
          </div>

          <div class="words-row">
            <div class="words-cell">Rupees ${amountInWordsClean} Only</div>
            <div class="final-cell"><span class="lbl">Final Total</span><span class="val">Rs. ${fmtMoney(finalTotal)}</span></div>
          </div>

          <div class="footer-row">

  <!-- INVOICE NOTE -->
  <div class="note-cell">
    <div class="section-header">
      INVOICE NOTE
    </div>

    <div class="note-content">
      Thanks Pl Visit Again!!!
    </div>
  </div>

  <!-- PAYMENT DETAIL -->
  <div class="payment-detail">
    <div class="section-header">
      PAYMENT DETAIL
    </div>

    <div class="payment-content">
      <div class="row">
        <span>${(paymentMode || "UPI").toUpperCase()}</span>
        <span>${fmtMoney(effectivePaid)}</span>
      </div>

      <div class="divider"></div>

      <div class="row bold">
        <span>Balance</span>
        <span>${fmtMoney(remainingAmount)}</span>
      </div>
    </div>
  </div>

</div>

          <div class="invoice-bottom"></div>

          <div class="signature-area">
  <div class="sig-row">

    <div class="for">
      For ${RESORT_NAME_INVOICE}
    </div>

    <div class="sig-line-block authorized">
      <div class="line">
        Authorized Signature
      </div>
    </div>

    <div class="sig-line-block guest">
      <div class="line">
        Guest Signature
      </div>
    </div>

  </div>

  <div class="generated-by">
    <span class="lbl">Invoice Generated By:</span> ${generatedBy}
  </div>
</div>
        </div>
      </body>
      </html>
    `;
  };

  // "Print Invoice" button: render the shared document in a fresh A4 window
  // and print it — the EXACT same markup the PDF download captures.
  const handlePrintInvoiceDirect = () => {
    const html = buildHotelInvoiceDocument();
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    const doPrint = () => {
      win.focus();
      win.print();
    };
    if (win.document.readyState === "complete") {
      window.setTimeout(doPrint, 150);
    } else {
      win.addEventListener("load", () => window.setTimeout(doPrint, 150), {
        once: true,
      });
    }
  };

  // "PDF" download: capture the SAME shared document in an offscreen iframe,
  // rasterise it and save as A4 — so the downloaded file matches the printed
  // sheet (both render buildHotelInvoiceDocument).
  const handleDownloadHotelInvoicePdf = async () => {
    if (hotelPdfBusy) return;
    setHotelPdfBusy(true);
    let iframe = null;
    try {
      const html = buildHotelInvoiceDocument();
      iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";
      document.body.appendChild(iframe);
      const idoc = iframe.contentDocument;
      idoc.open();
      idoc.write(html);
      idoc.close();
      await new Promise((r) => setTimeout(r, 200));

      // html2canvas ignores @page margins, and the shared document's frame
      // (.invoice width:100%) sits flush against a zero-padded body — so
      // without this the captured image has the invoice touching both edges
      // and the PDF below would look cut off. Give the body real padding so
      // the frame is surrounded by white space before rasterising.
      const bodyStyle = idoc.createElement("style");
      bodyStyle.textContent =
        "html, body { background:#ffffff !important; margin:0; } body { padding:16px 12px; }";
      idoc.head.appendChild(bodyStyle);
      await new Promise((r) => setTimeout(r, 80));

      const canvas = await html2canvas(idoc.body, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: 794,
      });
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      // Place the image with a page margin instead of edge-to-edge.
      const margin = 8;
      const contentW = pageW - margin * 2;
      let imgH = (canvas.height * contentW) / canvas.width;
      let imgW = contentW;

      if (imgH <= pageH - margin * 2 + 1) {
        pdf.addImage(imgData, "JPEG", margin, margin, imgW, imgH);
      } else {
        // Content is taller than one page: scale it to fit the printable
        // height (keeps margins), or fall back to multi-page tiling.
        const scaleFit = (pageH - margin * 2) / imgH;
        if (scaleFit > 0.55) {
          imgW = imgW * scaleFit;
          imgH = (pageH - margin * 2);
          pdf.addImage(
            imgData,
            "JPEG",
            (pageW - imgW) / 2,
            margin,
            imgW,
            imgH,
          );
        } else {
          let position = 0;
          let pageNo = 0;
          while (position < imgH) {
            if (pageNo > 0) pdf.addPage();
            pdf.addImage(imgData, "JPEG", margin, margin - position, imgW, imgH);
            position += pageH - margin * 2;
            pageNo += 1;
          }
        }
      }
      const docNo =
        (bookingDetail?.invoice_no ||
          bookingDetail?.invoiceNo ||
          selectedBooking?.bookingCode ||
          `INV-${selectedBooking?.bookingId}`) ||
          "invoice";
      pdf.save(`Tax_Invoice_${docNo}.pdf`);
    } catch (err) {
      console.error("Hotel invoice PDF failed:", err);
      alert(
        "PDF could not be generated. Use the Print button and choose “Save as PDF”."
      );
    } finally {
      if (iframe) {
        try {
          document.body.removeChild(iframe);
        } catch {
          /* noop */
        }
      }
      setHotelPdfBusy(false);
    }
  };

  const handleCloseGroupBooking = () => {
    setShowGroupBooking(false);
    setSelectedBookingId(null);
  };

  const handleOpenGuestProfile = (booking) => {
    if (!booking?.bookingId) return;
    setSelectedBookingId(booking.bookingId);
    setShowGuestProfile(true);
  };

  const handleCloseGuestProfile = () => {
    setShowGuestProfile(false);
    setSelectedBookingId(null);
  };

  const handleCloseOccupancyForecast = () => {
    setShowOccupancyForecast(false);
  };

  const handleCloseAddRoom = () => {
    setShowAddRoom(false);
    // Refetch so a room just added in the Add Room modal shows up in the
    // New Booking room-type dropdowns immediately. Same normalisation as the
    // initial load, so empty categories keep rendering a usable dropdown.
    API.get("/hotel/rooms/setup")
      .then(loadCategorySetup)
      .catch((err) => console.error("Failed to refresh room categories:", err));
  };

  const handleNotify = async (channel) => {
    if (!selectedBooking?.bookingId) return;
    try {
      await API.post(`/hotel/notify/${selectedBooking.bookingId}`, { channel });
      showToast(
        "success",
        channel === "email" ? "Email Sent" : "SMS Sent",
        `Booking details were sent to the guest via ${channel === "email" ? "email" : "SMS"}.`,
      );
    } catch (err) {
      console.error(err);
      showToast(
        "error",
        "Notification Failed",
        "This needs a /hotel/notify endpoint on your backend — please add it, or hook this button to your existing notification service.",
      );
    }
  };

  const handleExportCSV = () => {
    const headers = [
      "Booking No",
      "Guest Name",
      "Check-In",
      "Check-Out",
      "Rooms",
      "Amount",
      "Status",
      "Booking Type",
    ];
    const rows = filteredBookings.map((b) => [
      b.bookingCode || b.bookingId,
      b.guest_name || "",
      formatDate(b.check_in),
      formatDate(b.check_out),
      b.rooms || "",
      b.totalAmount || 0,
      b.booking_status || "",
      b.bookingType || "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${v}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bookings.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ─────────────────────────── render: All Bookings (list) ─────────────────────────── */

  const renderList = () => (
    <div className={panelCls}>
      <div className="mb-5 sm:mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className={cardTitleCls}>All Bookings</h2>
          <p className="mt-1 text-[17px] text-slate-500">
            View and manage all your hotel reservations
          </p>
        </div>
        <button type="button" onClick={openNewBooking} className={primaryBtn}>
          <FaPlus className="text-lg" /> New Booking
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative min-w-[220px] flex-1">
          <FaSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by booking no, guest name, email or phone..."
            className={`${fieldCls} pl-11`}
          />
        </div>
        <button type="button" className={ghostBtn}>
          <FaFilter className="text-sm" /> Filter
        </button>
        <button type="button" onClick={handleExportCSV} className={ghostBtn}>
          <FaDownload className="text-sm" /> Export
        </button>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[860px] text-left">
          <thead className="sticky top-0 z-10 bg-slate-50 text-base font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Booking No</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Guest Name</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Check-In</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Check-Out</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Rooms</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Amount</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Payment Status</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Status</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Booking Type</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[17px]">
            {loading ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  Loading bookings...
                </td>
              </tr>
            ) : pagedBookings.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  No active bookings found. Checked-out bookings are available
                  in Booking History.
                </td>
              </tr>
            ) : (
              pagedBookings.map((b) => (
                <tr key={b.bookingId} className="hover:bg-slate-50/70">
                  <td className="px-4 sm:px-5 py-3 sm:py-4 font-bold text-slate-800">
                    {b.bookingCode || `BK-${b.bookingId}`}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-700">
                    {b.guest_name || "Walk-in Guest"}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {formatDate(b.check_in)}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {formatDate(b.check_out)}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {b.rooms || "-"}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 font-semibold text-slate-800">
                    {formatCurrency(b.totalAmount)}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4">
                    {(() => {
                      const status = computePaymentStatus(b);
                      const remaining = Number(
                        b.remainingAmount || b.balanceAmount || 0,
                      );
                      const cls =
                        status === "Paid"
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : status === "Partial"
                            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                            : "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${cls}`}
                          >
                            {status}
                          </span>
                          {status !== "Paid" && remaining > 0 && (
                            <span className="text-[12px] font-semibold text-rose-600">
                              Due {formatCurrency(remaining)}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4">
                    <span className={statusBadgeCls(b.booking_status)}>
                      {b.booking_status || "Pending"}
                    </span>
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {b.bookingType || "-"}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        title="View details"
                        onClick={() => openDetails(b)}
                        className={rowActionBtn("neutral")}
                      >
                        <FaEye className="text-[18px] sm:text-xl" />
                        <span>View</span>
                      </button>
                      <button
                        title="Edit booking"
                        onClick={() => openEditBooking(b)}
                        className={rowActionBtn("neutral")}
                      >
                        <FaEdit className="text-[18px] sm:text-xl" />
                        <span>Edit</span>
                      </button>
                      <button
                        title="Guest folio"
                        onClick={() => handleOpenFolio(b)}
                        className={rowActionBtn("primary")}
                      >
                        <FaBook className="text-[18px] sm:text-xl" />
                        <span>Folio</span>
                      </button>
                      <button
                        title="Manage booking"
                        onClick={() => openManage(b)}
                        className={rowActionBtn("danger")}
                      >
                        <FaTrash className="text-[18px] sm:text-xl" />
                        <span>Delete</span>
                      </button>
                      <button
                        title="Guest Profile"
                        onClick={() => handleOpenGuestProfile(b)}
                        className={rowActionBtn("neutral")}
                      >
                        <FaIdCard className="text-[18px] sm:text-xl" />
                        <span>Guest Profile</span>
                      </button>
                      {(b.booking_status === "Pending" ||
                        b.booking_status === "Confirmed" ||
                        !b.booking_status) && (
                        <button
                          title="Check In"
                          onClick={() => {
                            setSelectedBooking(b);
                            handleLifecycle("check-in", b);
                          }}
                          className={rowActionBtn("primary")}
                        >
                          <FaSignInAlt className="text-[18px] sm:text-xl" />
                          <span>Check-In</span>
                        </button>
                      )}
                      {b.booking_status === "Checked-In" && (
                        <button
                          title="Check Out"
                          onClick={() => {
                            setSelectedBooking(b);
                            handleLifecycle("check-out", b);
                          }}
                          className={rowActionBtn("primary")}
                        >
                          <FaSignOutAlt className="text-[18px] sm:text-xl" />
                          <span>Check-Out</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row flex-wrap items-center justify-center sm:justify-between gap-3 text-[17px] text-slate-500">
        <span className="text-center sm:text-left">
          Showing {pagedBookings.length ? (page - 1) * pageSize + 1 : 0} to{" "}
          {(page - 1) * pageSize + pagedBookings.length} of{" "}
          {filteredBookings.length} entries
        </span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition disabled:opacity-40"
          >
            <FaChevronLeft className="text-sm" />
          </button>
          {Array.from({ length: totalPages })
            .slice(0, 5)
            .map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i + 1)}
                className={`h-10 w-10 sm:h-11 sm:w-11 rounded-lg text-[17px] font-bold transition ${
                  page === i + 1
                    ? "bg-sky-500 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {i + 1}
              </button>
            ))}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition disabled:opacity-40"
          >
            <FaChevronRight className="text-sm" />
          </button>
        </div>
      </div>
    </div>
  );

  /* ─────────────────────────── render: New / Edit Booking ─────────────────────────── */

  const renderForm = () => (
    <div className={panelCls}>
      <div className="mb-6 sm:mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 sm:pb-6">
        <div>
          <h2 className={cardTitleCls}>
            {isEdit ? "Edit Booking" : "New Booking"}
          </h2>
          <p className="mt-1 text-[17px] text-slate-500">
            {isEdit
              ? "Update the booking details below."
              : "Fill all details below to create a new booking — everything happens on this one page."}
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <button type="button" onClick={goToList} className={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveBooking}
            disabled={saving}
            className={primaryBtn}
          >
            {saving ? "Saving..." : "Save Booking"}
          </button>
        </div>
      </div>

      <div className="mb-6 sm:mb-8 flex flex-wrap gap-2 sm:gap-3">
        {[
          { id: "sec-guest", label: "Guest Information" },
          { id: "sec-booking", label: "Booking Details" },
          { id: "sec-room", label: "Room & Tariff" },
          { id: "sec-other", label: "Other Details" },
          { id: "sec-payment", label: "Payment Details" },
        ].map((s) => (
          <a key={s.id} href={`#${s.id}`} className={softBtn(false)}>
            {s.label}
          </a>
        ))}
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-5 sm:space-y-6">
          <div id="sec-guest" className={cardTileCls}>
            <div className={sectionTitleCls}>Guest Information</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              <div>
                <label className={labelCls}>
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter first name"
                />
              </div>

              <div>
                <label className={labelCls}>
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter last name"
                />
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="guestEmail"
                  value={formData.guestEmail}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter guest email"
                />
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  name="mobile"
                  value={formData.mobile}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter phone number"
                />
              </div>

              {/* ── NEW: ID Proof Type + ID Number (matches reference layout) ── */}
              <div>
                <label className={labelCls}>
                  ID Proof Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="idProofType"
                  value={formData.idProofType}
                  onChange={handleChange}
                  className={fieldCls}
                >
                  <option value="">Select ID Proof Type</option>
                  {ID_PROOF_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>
                  ID Number <span className="text-red-500">*</span>
                </label>
                <input
                  name="idNumber"
                  value={formData.idNumber}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter ID number"
                />
                <p className="mt-1.5 text-sm text-slate-400">
                  Enter your valid ID proof number (Aadhar Card, Driving
                  License, Passport, etc.)
                </p>
              </div>
              {/* ── END NEW FIELDS ── */}
            </div>

            <div className="mt-5 sm:mt-6 border-t border-slate-200 pt-5 sm:pt-6">
              <div className="mb-3 text-xl font-bold text-blue-900">
                Stay Details
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <div>
                  <label className={labelCls}>Check-In</label>
                  <input
                    type="date"
                    name="checkIn"
                    min={today}
                    value={formData.checkIn}
                    onChange={handleChange}
                    className={fieldCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Check-Out</label>
                  <input
                    type="date"
                    name="checkOut"
                    min={formData.checkIn || today}
                    value={formData.checkOut}
                    onChange={handleChange}
                    className={fieldCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Expected Arrival</label>
                  <input
                    type="time"
                    name="arrival"
                    value={formData.arrival}
                    onChange={handleChange}
                    className={fieldCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Expected Departure</label>
                  <input
                    type="time"
                    name="departure"
                    value={formData.departure}
                    onChange={handleChange}
                    className={fieldCls}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <div id="sec-booking" className={cardTileCls}>
            <div className={sectionTitleCls}>Booking Information</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              <div>
                <label className={labelCls}>Booking No</label>
                <input
                  disabled
                  value={formData.bookingCode || "Auto-generated on save"}
                  className={`${fieldCls} bg-slate-100 text-slate-500`}
                />
              </div>
              <div>
                <label className={labelCls}>Booking Date</label>
                <input
                  disabled
                  value={formatDate(today)}
                  className={`${fieldCls} bg-slate-100 text-slate-500`}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Booking Type</label>
                <div className="flex flex-wrap gap-4 sm:gap-5 pt-1">
                  {["Walk-In", "VIA", "Online"].map((t) => (
                    <label
                      key={t}
                      className="flex items-center gap-2 text-[17px] font-semibold text-slate-700"
                    >
                      <input
                        type="radio"
                        name="bookingType"
                        checked={formData.bookingType === t}
                        onChange={() => setField("bookingType", t)}
                        className="h-5 w-5 sm:h-6 sm:w-6 accent-blue-600"
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Referral By</label>
                <input
                  name="referralBy"
                  value={formData.referralBy}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter referral name"
                />
              </div>
              <div>
                <label className={labelCls}>Company</label>
                <input
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter company name"
                />
              </div>
              <div>
                <label className={labelCls}>GST Number</label>
                <input
                  name="gstNumber"
                  value={formData.gstNumber}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter GSTIN"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Reference</label>
                <input
                  name="reference"
                  value={formData.reference}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter reference details"
                />
              </div>
            </div>
          </div>

          <div id="sec-room" className={cardTileCls}>
            <div className={sectionTitleCls}>Room &amp; Tariff Details</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              <div>
                <label className={labelCls}>Room Category</label>
                <select
                  name="roomCategory"
                  value={formData.roomCategory}
                  onChange={handleChange}
                  className={fieldCls}
                >
                  <option value="">Select Category</option>
                  {categorySetup.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>No. Of Rooms</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    name="noOfRooms"
                    value={formData.noOfRooms}
                    onChange={handleChange}
                    className={fieldCls}
                  />
                  <button
                    type="button"
                    onClick={addRoomRow}
                    className="shrink-0 h-[52px] sm:h-[54px] md:h-14 rounded-xl bg-sky-500 px-4 sm:px-5 text-[17px] font-bold text-white transition hover:bg-sky-600 active:scale-95"
                  >
                    + Add
                  </button>
                </div>
              </div>
              <div>
                <label className={labelCls}>
                  Guest Capacity <span className="text-red-500">*</span>
                </label>
                <input
                  name="guestCapacity"
                  value={formData.guestCapacity}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Adults + Children"
                />
              </div>
              <div>
                <label className={labelCls}>Mobile Number</label>
                <input
                  name="roomMobile"
                  value={formData.roomMobile}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Primary mobile number"
                />
              </div>
              <div>
                <label className={labelCls}>Owner</label>
                <input
                  name="owner"
                  value={formData.owner}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter owner name"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>
                  Address <span className="text-red-500">*</span>
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  rows={2}
                  className={`${fieldCls} h-auto py-3`}
                  placeholder="Enter address"
                />
              </div>
            </div>

            {formData.rooms.length > 0 && (
              <div className="mt-4 sm:mt-5 max-w-full overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-left">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-base font-bold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Category</th>
                      <th className="px-3 py-2.5">Room No</th>
                      <th className="px-3 py-2.5">Price</th>
                      <th className="px-3 py-2.5">GST %</th>
                      <th className="px-3 py-2.5">Qty</th>
                      <th className="px-3 py-2.5">Total</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-[17px]">
                    {formData.rooms.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          <select
                            value={row.categoryId || ""}
                            onChange={(e) =>
                              updateRoomRow(
                                row.id,
                                "categoryId",
                                e.target.value,
                              )
                            }
                            className="w-28 sm:w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-[17px]"
                          >
                            <option value="">Select category</option>
                            {categorySetup.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={row.roomNo}
                            onChange={(e) =>
                              updateRoomRow(row.id, "roomNo", e.target.value)
                            }
                            disabled={!row.categoryId}
                            className="w-24 sm:w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-[17px] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            <option value="">
                              {row.categoryId
                                ? "Select room"
                                : "Pick category first"}
                            </option>
                            {getRoomNumbersForCategory(
                              row.categoryId,
                              row.roomNo,
                            ).map((r) => (
                              <option
                                key={r.roomNo}
                                value={r.roomNo}
                                disabled={r.alreadyPicked}
                              >
                                {r.roomNo}
                                {r.status &&
                                r.status.toLowerCase() !== "available"
                                  ? ` (${r.status})`
                                  : ""}
                                {r.alreadyPicked ? " — already added" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.price}
                            onChange={(e) =>
                              updateRoomRow(row.id, "price", e.target.value)
                            }
                            className="w-20 sm:w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[17px]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={5}
                            value={row.gst}
                            onChange={(e) =>
                              updateRoomRow(row.id, "gst", e.target.value)
                            }
                            className="w-16 sm:w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-[17px]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            value={row.quantity}
                            onChange={(e) =>
                              updateRoomRow(row.id, "quantity", e.target.value)
                            }
                            className="w-16 sm:w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-[17px]"
                          />
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-700">
                          {formatCurrency(rowTotalGstInclusive(row, stayNights))}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeRoomRow(row.id)}
                            className="text-rose-500 transition hover:text-rose-700 active:scale-95"
                          >
                            <FaTimes className="text-lg" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <div id="sec-other" className={cardTileCls}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5"></div>
          </div>

          <div id="sec-payment" className={cardTileCls}>
            <div className={sectionTitleCls}>Advance Payment Details</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              <div>
                <label className={labelCls}>Amount (₹)</label>
                <input
                  type="number"
                  name="amount"
                  value={formData.amount}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className={labelCls}>Payment Mode</label>
                <select
                  name="paymentMode"
                  value={formData.paymentMode}
                  onChange={handleChange}
                  className={fieldCls}
                >
                  <option value="">Select Mode</option>
                  <option>Cash</option>
                  <option>Card</option>
                  <option>UPI</option>
                  <option>Bank Transfer</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Payment Status</label>
                <select
                  name="paymentStatus"
                  value={formData.paymentStatus}
                  onChange={handleChange}
                  className={fieldCls}
                >
                  <option value="">Select Status</option>
                  <option>Paid</option>
                  <option>Partial</option>
                  <option>Pending</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Paid By</label>
                <input
                  name="paidBy"
                  value={formData.paidBy}
                  onChange={handleChange}
                  className={fieldCls}
                  placeholder="Enter paid by name"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Payment Note</label>
                <textarea
                  name="paymentNote"
                  value={formData.paymentNote}
                  onChange={handleChange}
                  rows={2}
                  className={`${fieldCls} h-auto py-3`}
                  placeholder="Enter payment note (optional)"
                />
              </div>

              <div className="sm:col-span-2 mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-3">
                  Payment Summary
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Base (pre-tax)
                    </div>
                    <div className="text-base sm:text-lg font-bold text-slate-700">
                      {formatCurrency(baseTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      GST
                    </div>
                    <div className="text-base sm:text-lg font-bold text-amber-600">
                      {formatCurrency(gstAmount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Total Amount
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-blue-700">
                      {formatCurrency(grandTotal)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Balance Due
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-rose-600">
                      {formatCurrency(
                        Math.max(grandTotal - Number(formData.amount || 0), 0),
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-center">
                  <div className="inline-flex items-center gap-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <span>
                      Advance Paid:{" "}
                      <span className="text-emerald-600">
                        {formatCurrency(formData.amount)}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 sm:mt-8 flex flex-wrap items-center justify-between gap-5 sm:gap-6 rounded-2xl border border-slate-200 bg-slate-50 px-5 sm:px-6 py-4 sm:py-5">
        <div className="flex flex-wrap gap-6 sm:gap-8 text-[17px]">
          <div>
            <div className="text-sm font-bold uppercase text-slate-400">
              Guest Name
            </div>
            <div className="font-bold text-slate-800">
              {guestFullName || "-"}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold uppercase text-slate-400">
              Stay Duration
            </div>
            <div className="font-bold text-slate-800">
              {stayNights} Night{stayNights === 1 ? "" : "s"}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold uppercase text-slate-400">
              Check-In
            </div>
            <div className="font-bold text-slate-800">
              {formData.checkIn ? formatDate(formData.checkIn) : "-"}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold uppercase text-slate-400">
              Check-Out
            </div>
            <div className="font-bold text-slate-800">
              {formData.checkOut ? formatDate(formData.checkOut) : "-"}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold uppercase text-slate-400">
              Total Rooms
            </div>
            <div className="font-bold text-slate-800">
              {formData.rooms.length || "-"}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold uppercase text-slate-400">
            Total Amount
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600">
            {formatCurrency(grandTotal)}
          </div>
        </div>
      </div>
    </div>
  );

  /* ─────────────────────────── render: Booking Confirmed ─────────────────────────── */

  const renderConfirmed = () => (
    <div
      className={`
        ${panelCls}
        mx-auto
        max-w-2xl
        p-5
        sm:p-8
        md:p-12
        lg:p-16
        xl:p-20
        text-center
        flex
        flex-col
        items-center
      `}
    >
      <div className="mx-auto flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-emerald-500 text-3xl sm:text-4xl text-white shadow-[0_14px_30px_rgba(16,185,129,0.35)]">
        <FaCheckCircle />
      </div>

      <h2 className={`mt-5 ${heroTitleCls} text-center`}>Booking Confirmed!</h2>

      <p className="mt-2 text-[17px] sm:text-lg text-slate-500 text-center">
        Your booking has been confirmed successfully.
      </p>

      <div className="mx-auto mt-6 w-full max-w-xs rounded-2xl bg-emerald-50 px-5 py-4 shadow-sm text-center">
        <div className="text-sm font-bold uppercase text-emerald-600">
          Booking Reference
        </div>

        <div className="mt-1 text-2xl font-black text-emerald-700 break-all">
          {formData.bookingCode || formData.bookingId}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 text-center w-full max-w-xl mx-auto justify-items-center">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Guest Name
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-800 wrap-break-word">
            {guestFullName}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Room Type
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-800 wrap-break-word">
            {(() => {
              const rawCat = String(
                formData.rooms[0]?.categoryId ||
                  formData.roomCategory ||
                  formData.roomType ||
                  "",
              );
              const cat = categorySetup.find(
                (c) => String(c.id) === rawCat,
              );
              return cat?.name || rawCat || "—";
            })()}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Advance Paid
          </div>
          <div className="text-lg sm:text-xl font-bold text-emerald-600 wrap-break-word">
            {formatCurrency(formData.amount)}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Balance Due
          </div>
          <div className="text-lg sm:text-xl font-bold text-rose-600 wrap-break-word">
            {formatCurrency(Math.max(grandTotal - formData.amount, 0))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Check-In
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-800 wrap-break-word">
            {formatDate(formData.checkIn)}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Check-Out
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-800 wrap-break-word">
            {formatDate(formData.checkOut)}
          </div>
        </div>

        <div className="col-span-2 border-t border-slate-200 pt-5 text-center">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Total Amount
          </div>

          <div className="mt-1 text-2xl sm:text-3xl font-black text-blue-700">
            {formatCurrency(grandTotal)}
            <div className="text-[17px] text-emerald-600">
              ({formData.rooms.length} room
              {formData.rooms.length > 1 ? "s" : ""} × {stayNights} night
              {stayNights > 1 ? "s" : ""})
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 flex justify-center w-full">
        <div className="grid w-full max-w-xl grid-cols-1 gap-4">
          <button
            type="button"
            onClick={goToList}
            className={`${primaryBtn} w-full`}
          >
            View All Bookings
          </button>
        </div>
      </div>
    </div>
  );

  /* ─────────────────────────── render: Booking Details ─────────────────────────── */

  const renderDetails = () => {
    const d = bookingDetail || {};
    const b = selectedBooking || {};

    const roomsList =
      Array.isArray(d.rooms) && d.rooms.length > 0 ? d.rooms : [];
    const roomChargesTotal = roomsList.length
      ? roomsList.reduce((sum, r) => sum + (Number(r.total) || 0), 0)
      : Number(b.totalAmount) || 0;

    // Stored booking_rooms totals are PRE-tax (the form saves rowTotal
    // before GST), so the GST shown on the new-booking screen and on the
    // invoice has to be added back here instead of hidden.
    // No rooms on the detail → the list-level totalAmount is already
    // GST-inclusive, so nothing more to add (adding a flat 5% here would
    // tax the total twice).
    const roomsGstAmount = roomsList.length
      ? Number(
          roomsList.reduce(
            (sum, r) =>
              sum +
              (Number(r.total) || 0) *
                ((Number(r.gst ?? r.gstPercent ?? 5) || 0) / 100),
            0,
          ).toFixed(2),
        )
      : 0;

    const folioChargesTotal = folioCharges.reduce(
      (sum, e) => sum + (Number(e.amount) || 0),
      0,
    );

    const updatedTotalAmount =
      roomChargesTotal + folioChargesTotal + roomsGstAmount;

    const advancePaid =
      Number(
        d.paidAmount ??
          d.paid_amount ??
          d.advancePaid ??
          d.advance_paid ??
          d.amountPaid ??
          d.amount_paid ??
          d.totalPaid ??
          d.total_paid ??
          b.paidAmount ??
          b.paid_amount ??
          b.advancePaid ??
          b.advance_paid ??
          0,
      ) || 0;

    const effectivePaid = totalPaid > 0 ? totalPaid : advancePaid;
    const remainingAmount =
      effectivePaid > 0
        ? Math.max(updatedTotalAmount - effectivePaid, 0)
        : updatedTotalAmount;

    return (
      <div className={panelCls}>
        <div className="mb-5 sm:mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 sm:pb-5">
          <div>
            <div className="text-sm font-bold uppercase text-slate-400">
              Booking Reference
            </div>
            <h2 className={cardTitleCls}>
              {d.booking_code || b.bookingCode || `BK-${b.bookingId}`}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span
              className={statusBadgeCls(d.booking_status || b.booking_status)}
            >
              {d.booking_status || b.booking_status || "Pending"}
            </span>
            {(() => {
              // Payment status derived from live remaining / paid amounts.
              // This stays in sync with the Accounts dashboard because both
              // read the same `remainingAmount` / `paidAmount` / `netPaid` fields.
              const paid = Number(
                d.netPaid || d.paidAmount || b.netPaid || b.paidAmount || 0,
              );
              const remaining = Number(
                d.remainingAmount ||
                  d.balanceAmount ||
                  b.remainingAmount ||
                  b.balanceAmount ||
                  0,
              );
              const pStatus =
                remaining <= 0 && paid > 0
                  ? "Paid"
                  : paid > 0
                    ? "Partial"
                    : "Pending";
              const pCls =
                pStatus === "Paid"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : pStatus === "Partial"
                    ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
              return (
                <span
                  className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${pCls}`}
                >
                  Payment: {pStatus}
                  {remaining > 0 && pStatus !== "Paid" && (
                    <span className="ml-1 text-rose-600">
                      ({formatCurrency(remaining)} due)
                    </span>
                  )}
                </span>
              );
            })()}
            {/*
              PRINT-INVOICE FIX: this button used to call window.print(),
              which printed the whole Booking Details screen. It now calls
              handlePrintInvoiceDirect(), which opens a separate A4 window
              containing ONLY a real invoice built from live room + folio
              + advance-paid data.
            */}
            <button onClick={handlePrintInvoiceDirect} className={ghostBtn}>
              <FaPrint className="text-sm" /> Print Invoice
            </button>
            <button
              onClick={handleDownloadHotelInvoicePdf}
              disabled={hotelPdfBusy}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-all duration-200 hover:shadow-lg text-sm disabled:opacity-50"
            >
              <FaDownload className="text-sm" />
              {hotelPdfBusy ? "Preparing PDF…" : "Download PDF"}
            </button>
            <button onClick={() => openEditBooking(b)} className={ghostBtn}>
              <FaEdit className="text-sm" /> Edit
            </button>
            <button
              onClick={() => setShowInvoiceModal(true)}
              className={primaryBtn}
            >
              <FaFileAlt className="text-sm" /> Generate Invoice
            </button>
            <button
              onClick={() => {
                setWaResult(null);
                setShowWhatsAppModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#25D366] hover:bg-[#1da851] text-white font-semibold rounded-lg shadow-md transition-all duration-200 hover:shadow-lg text-sm"
            >
              <FaWhatsapp className="text-lg" /> Send Invoice via WhatsApp
            </button>
          </div>
        </div>

        {detailLoading ? (
          <div className="py-10 text-center text-lg text-slate-400">
            Loading booking details...
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            <div className={cardTileCls}>
              <div className={sectionTitleCls}>Guest Information</div>
              <dl className="space-y-2.5 text-[17px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-bold text-slate-800">
                    {d.guest_name || b.guest_name || "-"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Email</dt>
                  <dd className="font-bold text-slate-800">
                    {d.guest_email || "-"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Mobile</dt>
                  <dd className="font-bold text-slate-800">
                    {d.mobile || b.mobile || "-"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">ID Proof</dt>
                  <dd className="font-bold text-slate-800">
                    {idProofLabel(d.id_proof_type || d.idProofType)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">ID Number</dt>
                  <dd className="font-bold text-slate-800">
                    {d.id_proof_number || d.idNumber || "-"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Company Name</dt>
                  <dd className="font-bold text-slate-800">
                    {d.company_name || "-"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">GST Number</dt>
                  <dd className="font-bold text-slate-800">
                    {d.company_gst || "-"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className={cardTileCls}>
              <div className={sectionTitleCls}>Payment Information</div>
              <dl className="space-y-2.5 text-[17px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Room Charges</dt>
                  <dd className="font-bold text-slate-800">
                    {formatCurrency(roomChargesTotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">
                    GST on Rooms
                    <span className="ml-1 text-xs font-semibold text-amber-600">
                      {roomsList.length
                        ? (roomsList.reduce((s, r) => s + (Number(r.gst ?? r.gstPercent ?? 5) || 0), 0) / roomsList.length).toFixed(1)
                        : "5.0"}
                      %
                    </span>
                  </dt>
                  <dd className="font-bold text-amber-600">
                    {formatCurrency(roomsGstAmount)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Folio Charges</dt>
                  <dd className="font-bold text-slate-800">
                    {formatCurrency(folioChargesTotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Total (incl. GST)</dt>
                  <dd className="font-bold text-slate-800">
                    {formatCurrency(updatedTotalAmount)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Advance Paid</dt>
                  <dd className="font-bold text-emerald-600">
                    {formatCurrency(effectivePaid)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Remaining (incl. Folio)</dt>
                  <dd className="font-bold text-rose-600">
                    {formatCurrency(remainingAmount)}
                  </dd>
                </div>
              </dl>
            </div>

            {Array.isArray(d.rooms) && d.rooms.length > 0 && (
              <div className={`md:col-span-3 ${cardTileCls}`}>
                <div className={sectionTitleCls}>
                  Room &amp; Tariff Information
                </div>
                <div className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-[460px] text-left">
                    <thead className="text-base font-bold uppercase text-slate-400">
                      <tr>
                        <th className="py-2 pr-4">Room No</th>
                        <th className="py-2 pr-4">Tariff</th>
                        <th className="py-2 pr-4">GST %</th>
                        <th className="py-2 pr-4">Qty</th>
                        <th className="py-2">Total (incl. GST)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-[17px]">
                      {d.rooms.map((r, i) => (
                        <tr key={i}>
                          <td className="py-2 pr-4 font-semibold text-slate-800">
                            {r.room_number || r.roomNumber || r.roomNo}
                          </td>
                          <td className="py-2 pr-4">
                            {formatCurrency(r.tariff || r.price)}
                          </td>
                          <td className="py-2 pr-4">
                            {Number(r.gst ?? r.gstPercent ?? 5) || 0}%
                          </td>
                          <td className="py-2 pr-4">{r.quantity || 1}</td>
                          <td className="py-2 font-semibold text-amber-700">
                            {formatCurrency(
                              (Number(r.total) || 0) *
                                (1 + ((Number(r.gst ?? r.gstPercent ?? 5) || 0) / 100)),
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-200">
                        <td colSpan={4} className="py-2 pr-4 font-bold text-slate-800">
                          Rooms incl. GST
                        </td>
                        <td className="py-2 font-bold text-slate-900">
                          {formatCurrency(roomChargesTotal + roomsGstAmount)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className={`md:col-span-3 ${cardTileCls}`}>
              <div className={sectionTitleCls}>Folio (Extra) Charges</div>
              {folioLoading ? (
                <div className="py-6 text-center text-slate-400">
                  Loading folio charges...
                </div>
              ) : folioCharges.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  No extra folio charges added for this booking.
                </div>
              ) : (
                <div className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-[460px] text-left">
                    <thead className="text-base font-bold uppercase text-slate-400">
                      <tr>
                        <th className="py-2 pr-4">Charge Name</th>
                        <th className="py-2 pr-4">Description</th>
                        <th className="py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-[17px]">
                      {folioCharges.map((entry) => (
                        <tr key={entry.id}>
                          <td className="py-2 pr-4 font-semibold text-slate-800">
                            {entry.category || "Extra Charge"}
                          </td>
                          <td className="py-2 pr-4 text-slate-600">
                            {entry.description || "-"}
                          </td>
                          <td className="py-2 font-semibold">
                            {formatCurrency(entry.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200">
                        <td
                          className="py-2 pr-4 font-bold text-slate-800"
                          colSpan={2}
                        >
                          Folio Charges Total
                        </td>
                        <td className="py-2 font-bold text-slate-900">
                          {formatCurrency(folioChargesTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div
              className={`md:col-span-3 ${cardTileCls} flex flex-wrap items-center justify-between gap-4`}
            >
              <div>
                <div className={sectionTitleCls + " !mb-0 !border-none !pb-0"}>
                  Updated Total Amount
                </div>
                <div className="text-2xl sm:text-3xl font-black text-emerald-600">
                  {formatCurrency(updatedTotalAmount)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold uppercase text-slate-400">
                  Remaining Charge
                </div>
                <div className="text-2xl sm:text-3xl font-black text-rose-600">
                  {formatCurrency(remainingAmount)}
                </div>
              </div>
            </div>
          </div>
        )}

        {showInvoiceModal && (
          <InvoiceModal
            booking={{ ...b, totalAmount: updatedTotalAmount }}
            roomChargesTotal={roomChargesTotal}
            folioCharges={folioCharges}
            paidAmount={effectivePaid}
            rooms={d.rooms || []}
            bookingDetail={d}
            onClose={() => setShowInvoiceModal(false)}
          />
        )}

        {showWhatsAppModal && (
          <WhatsAppSendModal
            booking={b}
            detail={d}
            invoice={waInvoice}
            sending={waSending}
            result={waResult}
            onSend={handleSendWhatsAppFromDetails}
            onClose={() => {
              if (!waSending) setShowWhatsAppModal(false);
            }}
          />
        )}

        <div className="mt-6 sm:mt-8 flex flex-wrap justify-end gap-2 sm:gap-3 border-t border-slate-100 pt-5 sm:pt-6">
          <button onClick={goToList} className={ghostBtn}>
            Back to All Bookings
          </button>
          <button onClick={() => openManage(b)} className={primaryBtn}>
            Manage This Booking
          </button>
        </div>
      </div>
    );
  };

  /* ─────────────────────────── render: Manage Booking ─────────────────────────── */

  const renderManage = () => {
    const b = selectedBooking || {};
    return (
      <div className={panelCls}>
        <div className="mb-5 sm:mb-6 border-b border-slate-100 pb-4 sm:pb-5">
          <div className="text-sm font-bold uppercase text-slate-400">
            Managing Booking
          </div>
          <h2 className={cardTitleCls}>
            {b.bookingCode || `BK-${b.bookingId}`}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`${statusBadgeCls(b.booking_status)}`}>
              {b.booking_status || "Pending"}
            </span>
            {(() => {
              const payStatus = computePaymentStatus(b);
              const remaining = Number(
                b.remainingAmount || b.balanceAmount || 0,
              );
              const payCls =
                payStatus === "Paid"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : payStatus === "Partial"
                    ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
              return (
                <span
                  className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${payCls}`}
                >
                  Payment: {payStatus}
                  {remaining > 0 && payStatus !== "Paid" && (
                    <span className="ml-1 text-rose-600">
                      ({formatCurrency(remaining)} due)
                    </span>
                  )}
                </span>
              );
            })()}
          </div>
        </div>

        <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
          <div className={cardTileCls}>
            <div className={sectionTitleCls}>Update Status</div>
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={manageStatus}
                onChange={(e) => setManageStatus(e.target.value)}
                className={fieldCls}
              >
                <option value="">Select New Status</option>
                <option value="Checked-In">Checked-In</option>
                <option value="Checked-Out">Checked-Out</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (manageStatus === "Checked-In")
                    handleLifecycle("check-in", b);
                  else if (manageStatus === "Checked-Out")
                    handleLifecycle("check-out", b);
                  else if (manageStatus === "Cancelled")
                    setCancelModal({
                      open: true,
                      reason: "",
                      submitting: false,
                    });
                  else
                    showToast(
                      "error",
                      "Select a status",
                      "Please choose a status to update to.",
                    );
                }}
                className={primaryBtn}
              >
                Update
              </button>
            </div>

            <div className="mt-5 sm:mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => openEditBooking(b)} className={ghostBtn}>
                <FaEdit className="text-sm" /> Edit Booking
              </button>
              {(b.booking_status === "Pending" ||
                b.booking_status === "Confirmed" ||
                !b.booking_status) && (
                <button
                  onClick={() => handleLifecycle("check-in", b)}
                  className={ghostBtn}
                >
                  <FaSignInAlt className="text-sm" /> Check-In
                </button>
              )}
              {b.booking_status === "Checked-In" && (
                <button
                  onClick={() => handleLifecycle("check-out", b)}
                  className={ghostBtn}
                >
                  <FaSignOutAlt className="text-sm" /> Check-Out
                </button>
              )}
              <button
                onClick={() =>
                  setCancelModal({ open: true, reason: "", submitting: false })
                }
                className={dangerBtn}
              >
                <FaBan className="text-sm" /> Cancel Booking
              </button>
            </div>

            <div className="mt-5 sm:mt-6 border-t border-slate-200 pt-5 sm:pt-6">
              <div className={sectionTitleCls}>Folio &amp; History</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button onClick={() => handleOpenFolio(b)} className={ghostBtn}>
                  <FaBook className="text-sm" /> Guest Folio
                </button>
                <button
                  onClick={() => setShowDocumentUpload(true)}
                  className={ghostBtn}
                >
                  <FaFileUpload className="text-sm" /> Upload Document
                </button>
                <button
                  onClick={() => handleOpenPaymentHistory(b)}
                  className={ghostBtn}
                >
                  <FaHistory className="text-sm" /> Payment History
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-5 sm:space-y-6">
            <div className={cardTileCls}>
              <div className={sectionTitleCls}>Payment Actions</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() =>
                    setCollectModal({
                      open: true,
                      amount: "",
                      mode: "Cash",
                      submitting: false,
                    })
                  }
                  className={ghostBtn}
                >
                  <FaMoneyBillWave className="text-sm" /> Collect Payment
                </button>
                <button
                  onClick={() =>
                    setRefundModal({
                      open: true,
                      amount: "",
                      submitting: false,
                    })
                  }
                  className={ghostBtn}
                >
                  <FaUndo className="text-sm" /> Refund Payment
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 sm:mt-8 flex justify-end border-t border-slate-100 pt-5 sm:pt-6">
          <button onClick={goToList} className={ghostBtn}>
            Back to All Bookings
          </button>
        </div>
      </div>
    );
  };

  /* ─────────────────────────── render: Booking History (view === "history") ─────────────────────────── */
  /* FIX: this render function was MISSING before. The FlowBar tab and         */
  /* handleJumpStep("history") already existed and correctly called            */
  /* fetchHistory(), but nothing rendered for view === "history", so the tab   */
  /* appeared to "not show" anything. This restores that screen using the      */
  /* existing history / historyLoading / historyPage / HISTORY_PAGE_SIZE state.*/

  const renderHistory = () => {
    const totalHistoryPages = Math.max(
      1,
      Math.ceil(history.length / HISTORY_PAGE_SIZE),
    );
    const pagedHistory = history.slice(
      (historyPage - 1) * HISTORY_PAGE_SIZE,
      historyPage * HISTORY_PAGE_SIZE,
    );

    return (
      <div className={panelCls}>
        <div className="mb-5 sm:mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 sm:pb-5">
          <div>
            <h2 className={cardTitleCls}>Booking History</h2>
            <p className="mt-1 text-[17px] text-slate-500">
              Checked-out bookings archive
            </p>
          </div>
          <button
            type="button"
            onClick={fetchHistory}
            disabled={historyLoading}
            className={ghostBtn}
          >
            <FaSync className={historyLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="max-w-full overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-slate-50 text-base font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Booking</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Guest</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Contact</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Stay Dates</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Rooms</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Total</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Payment Status</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Remaining</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4">Status</th>
                <th className="px-4 sm:px-5 py-3 sm:py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[17px]">
              {historyLoading ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    Loading history...
                  </td>
                </tr>
              ) : pagedHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    No checked-out bookings yet.
                  </td>
                </tr>
              ) : (
                pagedHistory.map((row) => {
                  const remaining = Number(row.remainingAmount || 0);
                  const paid = Number(row.netPaid || row.paidAmount || 0);
                  const rowStatus =
                    remaining <= 0 && paid > 0
                      ? "Paid"
                      : paid > 0
                        ? "Partial"
                        : "Pending";
                  const rowStatusCls =
                    rowStatus === "Paid"
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                      : rowStatus === "Partial"
                        ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                        : "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
                  const roomDetails = String(
                    row.roomDetails || row.rooms || "-",
                  )
                    .split(" || ")
                    .join(", ");
                  return (
                    <tr key={row.bookingId} className="hover:bg-slate-50/70">
                      <td className="px-4 sm:px-5 py-3 sm:py-4 font-bold text-slate-800">
                        {row.bookingCode || `BK-${row.bookingId}`}
                        <div className="text-[13px] font-normal text-slate-400">
                          {row.company_name || "Direct booking"}
                        </div>
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-700">
                        {row.guest_name || "Walk-in Guest"}
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                        {row.mobile || "-"}
                        <div className="text-[13px] text-slate-400 wrap-break-word max-w-50">
                          {row.guest_email || "-"}
                        </div>
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                        {formatDate(row.check_in)} → {formatDate(row.check_out)}
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                        {roomDetails}
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4 font-semibold text-slate-800">
                        {formatCurrency(row.totalAmount)}
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4">
                        <span
                          className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${rowStatusCls}`}
                        >
                          {rowStatus}
                        </span>
                      </td>
                      <td
                        className={`px-4 sm:px-5 py-3 sm:py-4 font-semibold ${remaining > 0 ? "text-rose-600" : "text-emerald-600"}`}
                      >
                        {formatCurrency(row.remainingAmount)}
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4">
                        <span
                          className={statusBadgeCls(
                            row.booking_status || "Checked-Out",
                          )}
                        >
                          {row.booking_status || "Checked-Out"}
                        </span>
                      </td>
                      <td className="px-4 sm:px-5 py-3 sm:py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            title="Payment history"
                            onClick={() => {
                              setSelectedBooking(row);
                              setShowPaymentHistory(true);
                            }}
                            className={rowActionBtn("primary")}
                          >
                            <FaMoneyBillWave className="text-lg" />
                            <span>Payments</span>
                          </button>
                          <button
                            title="View details"
                            onClick={() => openDetails(row)}
                            className={rowActionBtn("neutral")}
                          >
                            <FaEye className="text-lg" />
                            <span>View</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {history.length > 0 && (
          <div className="mt-5 flex flex-col sm:flex-row flex-wrap items-center justify-center sm:justify-between gap-3 text-[17px] text-slate-500">
            <span className="text-center sm:text-left">
              Showing{" "}
              {pagedHistory.length
                ? (historyPage - 1) * HISTORY_PAGE_SIZE + 1
                : 0}{" "}
              to {(historyPage - 1) * HISTORY_PAGE_SIZE + pagedHistory.length}{" "}
              of {history.length} records
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition disabled:opacity-40"
              >
                <FaChevronLeft className="text-sm" />
              </button>
              {Array.from({ length: totalHistoryPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setHistoryPage(i + 1)}
                  className={`h-10 w-10 sm:h-11 sm:w-11 rounded-lg text-[17px] font-bold transition ${
                    historyPage === i + 1
                      ? "bg-sky-500 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                disabled={historyPage >= totalHistoryPages}
                onClick={() =>
                  setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))
                }
                className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition disabled:opacity-40"
              >
                <FaChevronRight className="text-sm" />
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 sm:mt-8 flex justify-end border-t border-slate-100 pt-5 sm:pt-6">
          <button onClick={goToList} className={ghostBtn}>
            Back to All Bookings
          </button>
        </div>
      </div>
    );
  };

  /* ─────────────────────────── render: Payment History (view === "payments") ─────────────────────────── */
  /* FIX: same issue as renderHistory above — this render function was         */
  /* MISSING. handleJumpStep("payments") already called fetchAllPayments()     */
  /* correctly, filling allPayments / paymentsLoading, but the tab had         */
  /* nothing to display. This restores that screen.                           */

  const renderPayments = () => (
    <div className={panelCls}>
      <div className="mb-5 sm:mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 sm:pb-5">
        <div>
          <h2 className={cardTitleCls}>Payment History</h2>
          <p className="mt-1 text-[17px] text-slate-500">
            Recent payment transactions across bookings
          </p>
        </div>
        <button
          type="button"
          onClick={fetchAllPayments}
          disabled={paymentsLoading}
          className={ghostBtn}
        >
          <FaSync className={paymentsLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[860px] text-left">
          <thead className="bg-slate-50 text-base font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Booking</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Guest</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Rooms</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Amount</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Mode</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Type</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Date</th>
              <th className="px-4 sm:px-5 py-3 sm:py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[17px]">
            {paymentsLoading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  Loading payments...
                </td>
              </tr>
            ) : allPayments.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  No payment transactions found.
                </td>
              </tr>
            ) : (
              allPayments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/70">
                  <td className="px-4 sm:px-5 py-3 sm:py-4 font-bold text-slate-800">
                    {p.bookingCode}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-700">
                    {p.guestName}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {p.rooms}
                  </td>
                  <td
                    className={`px-4 sm:px-5 py-3 sm:py-4 font-semibold ${p.paymentType === "Refund" ? "text-rose-600" : "text-emerald-600"}`}
                  >
                    {p.paymentType === "Refund" ? "-" : "+"}
                    {formatCurrency(p.amount)}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {p.paymentMode}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {p.paymentType}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4 text-slate-600">
                    {p.createdAt ? new Date(p.createdAt).toLocaleString() : "-"}
                  </td>
                  <td className="px-4 sm:px-5 py-3 sm:py-4">
                    <span className={statusBadgeCls(p.status)}>{p.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 sm:mt-8 flex justify-end border-t border-slate-100 pt-5 sm:pt-6">
        <button onClick={goToList} className={ghostBtn}>
          Back to All Bookings
        </button>
      </div>
    </div>
  );

  /* ─────────────────────────── page shell ─────────────────────────── */

  return (
    <div
      className="min-h-screen w-full max-w-full overflow-x-hidden bg-gradient-to-br from-blue-50 via-white to-blue-100 space-y-6 sm:space-y-8 p-3 sm:p-6 md:p-8 lg:p-10 xl:p-12"
      style={{ fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif' }}
    >
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => navigate("/hotel")}
          className="flex items-center gap-2 rounded-lg bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-white hover:text-blue-700 active:scale-[0.98] transition"
          title="Back to Hotel"
        >
          <FaArrowLeft className="text-base" />
          Back
        </button>
      </div>

      <FlowBar view={view} onJump={handleJumpStep} />

      {view === "list" && renderList()}
      {view === "form" && renderForm()}
      {view === "confirmed" && renderConfirmed()}
      {view === "details" && renderDetails()}
      {view === "manage" && renderManage()}
      {view === "history" && renderHistory()}
      {view === "payments" && renderPayments()}

      {showFolio && (
        <FeatureModal
          title="Guest Folio"
          size="max-w-[95vw]"
          onClose={handleCloseFolio}
        >
          <FolioView bookingId={selectedBookingId} onClose={handleCloseFolio} />
        </FeatureModal>
      )}

      {showGroupBooking && (
        <FeatureModal title="Group Booking" onClose={handleCloseGroupBooking}>
          <GroupBooking
            bookingId={selectedBookingId}
            onClose={handleCloseGroupBooking}
          />
        </FeatureModal>
      )}

      {showGuestProfile && (
        <FeatureModal
          title="Guest Profile"
          size="max-w-[95vw]"
          onClose={handleCloseGuestProfile}
        >
          <GuestProfile
            bookingId={selectedBookingId}
            onClose={handleCloseGuestProfile}
          />
        </FeatureModal>
      )}

      {showOccupancyForecast && (
        <FeatureModal
          title="Occupancy Forecast"
          onClose={handleCloseOccupancyForecast}
        >
          <OccupancyForecast onClose={handleCloseOccupancyForecast} />
        </FeatureModal>
      )}

      {showPaymentHistory && (
        <PaymentHistoryModal
          booking={selectedBooking}
          onClose={handleClosePaymentHistory}
        />
      )}

      {showDocumentUpload && (
        <DocumentUploadModal
          booking={selectedBooking}
          onClose={handleCloseDocumentUpload}
        />
      )}

      {showAddRoom && (
        <FeatureModal title="Add Room" onClose={handleCloseAddRoom}>
          <Room />
        </FeatureModal>
      )}

      <Modal
        open={toast.open}
        onClose={closeToast}
        icon={toast.type === "success" ? FaCheckCircle : FaExclamationTriangle}
        iconTone={toast.type === "success" ? "bg-emerald-500" : "bg-rose-500"}
        title={toast.title}
        actions={
          <button onClick={closeToast} className={primaryBtn}>
            Continue
          </button>
        }
      >
        {toast.message}
      </Modal>

      <Modal
        open={cancelModal.open}
        onClose={() =>
          setCancelModal({ open: false, reason: "", submitting: false })
        }
        icon={FaBan}
        iconTone="bg-rose-500"
        title="Cancel this booking?"
        actions={
          <>
            <button
              onClick={() =>
                setCancelModal({ open: false, reason: "", submitting: false })
              }
              className={ghostBtn}
            >
              Close
            </button>
            <button
              onClick={handleConfirmCancel}
              disabled={cancelModal.submitting}
              className={dangerBtn}
            >
              {cancelModal.submitting ? "Cancelling..." : "Confirm Cancel"}
            </button>
          </>
        }
      >
        <p>
          This will release the assigned room(s). This action cannot be undone.
        </p>
        <label className="mt-4 block text-left">
          <span className={labelCls}>Cancellation Reason</span>
          <textarea
            value={cancelModal.reason}
            onChange={(e) =>
              setCancelModal((c) => ({ ...c, reason: e.target.value }))
            }
            rows={3}
            className={`${fieldCls} h-auto py-3`}
            placeholder="Guest changed mind, wrong date, pricing issue..."
          />
        </label>
      </Modal>

      {/* 🐛 RESTRICTION: opens from handleLifecycle when the user tries to
          Check-Out a booking that still has a pending balance. Closes
          automatically once Collect Payment brings the balance to zero. */}
      <Modal
        open={checkoutGuardModal.open}
        onClose={() =>
          setCheckoutGuardModal({
            open: false,
            booking: null,
            remaining: 0,
            paymentStatus: "Pending",
          })
        }
        icon={FaExclamationTriangle}
        iconTone="bg-amber-500"
        title="Payment Pending — Cannot Check-Out"
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                setCheckoutGuardModal({
                  open: false,
                  booking: null,
                  remaining: 0,
                  paymentStatus: "Pending",
                })
              }
              className={ghostBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                // Pre-fill the Collect Payment modal with the remaining
                // balance and close the guard so the user can settle it.
                const remaining = Number(checkoutGuardModal.remaining || 0);
                setCollectModal({
                  open: true,
                  amount: remaining > 0 ? String(remaining.toFixed(2)) : "",
                  mode: "Cash",
                  submitting: false,
                });
                setCheckoutGuardModal({
                  open: false,
                  booking: null,
                  remaining: 0,
                  paymentStatus: "Pending",
                });
              }}
              className={primaryBtn}
            >
              Collect Payment Now
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p>
            Booking{" "}
            <span className="font-black text-slate-900">
              {checkoutGuardModal.booking?.bookingCode ||
                `BK-${checkoutGuardModal.booking?.bookingId}`}
            </span>{" "}
            cannot be checked out while a payment is still pending.
          </p>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-[13px] font-bold uppercase tracking-wider text-amber-700">
              Current Payment Status
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span
                className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${
                  checkoutGuardModal.paymentStatus === "Paid"
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                    : checkoutGuardModal.paymentStatus === "Partial"
                      ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                      : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                }`}
              >
                {checkoutGuardModal.paymentStatus}
              </span>
              <span className="text-base font-black text-rose-700">
                Pending: {formatCurrency(checkoutGuardModal.remaining || 0)}
              </span>
            </div>
          </div>
          <p className="text-[15px] text-slate-600">
            Please collect the pending payment first. Once the balance is fully
            paid, the Check-Out button will be enabled automatically.
          </p>
        </div>
      </Modal>

      <Modal
        open={collectModal.open}
        onClose={() =>
          setCollectModal({
            open: false,
            amount: "",
            mode: "Cash",
            submitting: false,
          })
        }
        icon={FaMoneyBillWave}
        iconTone="bg-emerald-500"
        title="Collect Payment"
        actions={
          <>
            <button
              onClick={() =>
                setCollectModal({
                  open: false,
                  amount: "",
                  mode: "Cash",
                  submitting: false,
                })
              }
              className={ghostBtn}
            >
              Close
            </button>
            <button
              onClick={handleCollectPayment}
              disabled={collectModal.submitting}
              className={primaryBtn}
            >
              {collectModal.submitting ? "Saving..." : "Collect"}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-left">
          <div>
            <label className={labelCls}>Amount (₹)</label>
            <input
              type="number"
              value={collectModal.amount}
              onChange={(e) =>
                setCollectModal((c) => ({ ...c, amount: e.target.value }))
              }
              className={fieldCls}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={labelCls}>Payment Mode</label>
            <select
              value={collectModal.mode}
              onChange={(e) =>
                setCollectModal((c) => ({ ...c, mode: e.target.value }))
              }
              className={fieldCls}
            >
              <option>Cash</option>
              <option>Card</option>
              <option>UPI</option>
              <option>Bank Transfer</option>
            </select>
          </div>
        </div>
      </Modal>

      <Modal
        open={refundModal.open}
        onClose={() =>
          setRefundModal({ open: false, amount: "", submitting: false })
        }
        icon={FaUndo}
        iconTone="bg-blue-500"
        title="Refund Payment"
        actions={
          <>
            <button
              onClick={() =>
                setRefundModal({ open: false, amount: "", submitting: false })
              }
              className={ghostBtn}
            >
              Close
            </button>
            <button
              onClick={handleRefund}
              disabled={refundModal.submitting}
              className={primaryBtn}
            >
              {refundModal.submitting ? "Processing..." : "Refund"}
            </button>
          </>
        }
      >
        <div className="text-left">
          <label className={labelCls}>Refund Amount (₹)</label>
          <input
            type="number"
            value={refundModal.amount}
            onChange={(e) =>
              setRefundModal((r) => ({ ...r, amount: e.target.value }))
            }
            className={fieldCls}
            placeholder="0.00"
          />
        </div>
      </Modal>
    </div>
  );
};

export default BookingFlow;
