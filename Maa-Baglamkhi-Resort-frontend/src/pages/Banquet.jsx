import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaBell,
  FaCalendarAlt,
  FaCheckCircle,
  FaEdit,
  FaEnvelope,
  FaExclamationTriangle,
  FaFilter,
  FaGlassCheers,
  FaHeadset,
  FaImage,
  FaLightbulb,
  FaLink,
  FaMoneyCheckAlt,
  FaPaperPlane,
  FaPrint,
  FaPlus,
  FaReceipt,
  FaSearch,
  FaSyncAlt,
  FaTrash,
  FaUpload,
  FaUtensils,
  FaUsers,
  FaWhatsapp,
  FaArrowLeft,
  FaChevronRight,
  FaRegClock,
} from "react-icons/fa";

import BanquetBill from "../components/Banquet/BanquetBill";
import BanquetWhatsAppModal from "../components/Banquet/BanquetWhatsAppModal";
import API, { getBackendBaseURL } from "../api";
import { printBanquetInvoice } from "../utils/printBanquetInvoice";
import {
  banquetConfigStorageKey,
  banquetMenuDraftStorageKey,
  buildNotesPayload,
  buildCustomMenuItemsText,
  calculateBookingGrandTotal,
  calculateRestaurantMenuCharge,
  defaultPricingConfig,
  deriveBookingFinancials,
  formatINR,
  getStoredPricingConfig,
  hoursBetween,
  mealSections,
  normalizeCategory,
  normalizeBooking,
  normalizeHall,
} from "./banquetUtils";

const BANQUET_NAV_GROUPS = [
  {
    id: "venue",
    label: "Venue",
    items: [
      { id: "halls", label: "Banquet Halls", icon: FaGlassCheers, desc: "Capacity and venue overview" },
      { id: "reservations", label: "Reservations", icon: FaCalendarAlt, desc: "Create and manage bookings" },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    items: [
      { id: "meals", label: "Meal Menus", icon: FaUtensils, desc: "Event meal planning" },
      { id: "addons", label: "Banquet Addons", icon: FaLightbulb, desc: "Decor, AV and event support" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { id: "settlement", label: "Settlement Report", icon: FaMoneyCheckAlt, desc: "Revenue snapshot and bill actions" },
    ],
  },
];

const BANQUET_SECTIONS = BANQUET_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, groupId: group.id, groupLabel: group.label }))
);

const c = {
  paper: "#F6F5F1",
  line: "#E4E1D8",
  tealDeep: "#0B4F48",
  teal: "#0F6E64",
  muted: "#6B6F66",
  text: "#1C231F",
  amber: "#C8791A",
  rose: "#B5442E",
};

const banquteFieldCls =
  "w-full h-14 rounded-[18px] border border-[#E1E7F5] bg-white px-4 py-2.5 text-[13.5px] font-medium text-[#0B1B33] shadow-[0_2px_10px_rgba(15,40,90,0.05)] transition-all duration-300 focus:border-[#2F6FE4] focus:outline-none focus:ring-4 focus:ring-blue-100";
const banquteLabelCls =
  "mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#64748B]";
const banqutePrimaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-[18px] sm:rounded-[20px] px-4 py-2.5 text-[13.5px] font-bold bg-gradient-to-r from-blue-800 via-blue-700 to-sky-500 text-white shadow-[0_10px_26px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(37,99,235,0.38)] active:translate-y-0";
const banquteGhostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-[18px] sm:rounded-[20px] px-4 py-2.5 text-[13.5px] font-bold border border-[#E1E7F5] text-[#0B1B33] bg-white hover:border-blue-300 hover:bg-blue-50/60 transition-all duration-300";
const banquteDangerBtn =
  "inline-flex items-center justify-center gap-1 rounded-[18px] px-2.5 py-1.5 text-[12px] font-bold border border-rose-100 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:shadow-sm transition-all duration-300";

const defaultWizard = {
  hallId: "",
  customerName: "",
  phone: "",
  guestEmail: "",
  eventTitle: "",
  eventType: "Wedding",
  guests: 150,
  menuPackageId: "standard",
  mealSection: "Main Course",
  customMenuItems: "",
  lightingSystem: "classic",
  eventSupportFee: 12000,
  decorationFee: 15000,
  notes: "",
  date: "",
  startTime: "18:00",
  endTime: "22:00",
  discount: 0,
  gstPercent: 5,
  advance: 0,
  paymentMode: "Pending",
  paymentReferenceId: "",
  receiptFileName: "",
  refundAmount: 0,
  selectedCustomMenuItems: [],
  selectedRestaurantMenuItems: [],
  manualCustomMenuItems: [],
  manualMenuEntry: "",
};

const defaultHall = {
  name: "",
  capacity: "",
  ratePerHour: "",
  image: "",
  is_ac: true,
  status: "Available",
};

const bookingFilterDefaults = {
  search: "",
  eventType: "all",
  status: "all",
  dateFrom: "",
  dateTo: "",
};

const inputCls =
  "w-full h-14 rounded-[18px] border border-[#E1E7F5] bg-white px-4 py-3 text-[14px] font-semibold text-slate-900 shadow-[0_2px_10px_rgba(15,40,90,0.05)] outline-none transition-all duration-300 placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:text-[16px]";

const labelCls =
  "mb-2 block text-[14px] font-bold uppercase tracking-[0.16em] text-slate-500 sm:text-[17px]";

const modalCloseBtnCls =
  "rounded-full border border-blue-100 bg-white px-3 py-1.5 text-[14px] font-bold text-slate-700 transition-all duration-300 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm sm:px-4 sm:py-2 sm:text-[17px]";

const statIcons = [FaCalendarAlt, FaCheckCircle, FaReceipt, FaUsers];

function ModalShell({
  title,
  eyebrow,
  onClose,
  children,
  widthClass = "max-w-5xl",
  heightClass = "h-[min(88vh,760px)]",
  wideClass,
  headerActions = null,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/55 p-3 backdrop-blur-md sm:p-4">
      <div className={`w-full ${widthClass} ${wideClass ? `xl:${wideClass}` : ""}`}>
        <div
          className={`mx-auto flex w-full flex-col overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,#ffffff_0%,#f5f9ff_100%)] p-4 shadow-[0_40px_110px_rgba(15,40,90,0.32)] sm:p-6 ${heightClass}`}
        >
          <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {eyebrow ? (
                <p className="text-[13px] font-bold uppercase tracking-[0.24em] text-sky-500 sm:text-[15px]">
                  {eyebrow}
                </p>
              ) : null}
              {title ? (
                <h3 className="mt-1 text-[24px] font-black text-blue-950 sm:text-[32px]">
                  {title}
                </h3>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {headerActions ? <div className="flex items-center gap-2">{headerActions}</div> : null}
              <button type="button" onClick={onClose} className={modalCloseBtnCls}>
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function useDelayedValue(value, delay = 1000) {
  const [delayedValue, setDelayedValue] = useState(value);

  useEffect(() => {
    if (!value) {
      setDelayedValue(value);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setDelayedValue(value);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return delayedValue;
}

function PaginationControls({
  page,
  totalPages,
  onChange,
  label,
  totalItems = 0,
  pageSize = 0,
  pageSizeOptions = null,
  onPageSizeChange,
}) {
  if (totalPages <= 1 && !pageSizeOptions) return null;

  const startItem =
    totalItems && pageSize ? (page - 1) * pageSize + 1 : null;
  const endItem =
    totalItems && pageSize ? Math.min(page * pageSize, totalItems) : null;
  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((pageNumber) => {
      if (totalPages <= 5) return true;
      if (pageNumber === 1 || pageNumber === totalPages) return true;
      return Math.abs(pageNumber - page) <= 1;
    });

  return (
    <div className="flex flex-col gap-3 rounded-[18px] sm:rounded-[20px] sm:rounded-[22px] border border-[#E1E7F5] bg-white px-3 py-3 shadow-[0_8px_24px_rgba(15,40,90,0.06)] lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="text-[14px] font-bold text-slate-600 sm:text-[17px]">
          {label} Page {page} of {totalPages}
          {startItem && endItem ? ` • Showing ${startItem}-${endItem} of ${totalItems}` : ""}
        </div>
        {pageSizeOptions?.length && onPageSizeChange ? (
          <label className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:text-[14px]">
            Rows
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded-full border border-blue-100 bg-white px-3 py-2 text-[13px] font-bold text-slate-700 outline-none transition-all duration-300 focus:border-blue-300 sm:text-[14px]"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} / page
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded-full border border-blue-100 px-3 py-2 text-[13px] font-bold text-slate-700 transition-all duration-300 hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:py-2.5 sm:text-[17px]"
        >
          Previous
        </button>
        {visiblePages.map((pageNumber, index) => {
          const previousPage = visiblePages[index - 1];
          const shouldShowGap = previousPage && pageNumber - previousPage > 1;

          return (
            <div key={pageNumber} className="flex items-center gap-2">
              {shouldShowGap ? (
                <span className="px-1 text-[14px] font-bold text-slate-300 sm:text-[17px]">...</span>
              ) : null}
              <button
                type="button"
                onClick={() => onChange(pageNumber)}
                className={`h-9 min-w-[36px] rounded-full px-2.5 text-[13px] font-bold transition-all duration-300 sm:h-10 sm:min-w-[40px] sm:px-3 sm:text-[17px] ${
                  pageNumber === page
                    ? "bg-gradient-to-r from-blue-800 to-sky-500 text-white shadow-[0_10px_25px_rgba(37,99,235,0.3)]"
                    : "border border-blue-100 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
                }`}
              >
                {pageNumber}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="rounded-full border border-blue-100 px-3 py-2 text-[13px] font-bold text-slate-700 transition-all duration-300 hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:py-2.5 sm:text-[17px]"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function formatBookingDate(dateValue) {
  if (!dateValue) return "Date pending";

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return String(dateValue);

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

// ─────────────────────────────────────────────────────────────────────────
// IMAGE UPLOAD FIX (this revision):
// Previously this function only prepended the backend base URL when the
// stored value did NOT start with "/", "http://", "https://" or "data:".
// Backend upload routes (multer etc.) almost always return a path that
// DOES start with "/" (e.g. "/uploads/hall-123.jpg"), so the old check
// `raw.startsWith("/")` incorrectly treated that as an "already complete"
// URL and returned it as-is. The browser then tried to resolve it against
// the FRONTEND origin (e.g. http://localhost:5173/uploads/hall-123.jpg)
// instead of the BACKEND origin, so the image 404'd even though the hall
// record itself saved fine.
// Fix: only treat true absolute URLs (http/https) and data: URIs as
// "already complete". Everything else (including "/uploads/xyz.jpg") gets
// the backend base URL prepended, matching the working pattern already
// used by buildUploadUrl() in BookingFlow.jsx.
// ─────────────────────────────────────────────────────────────────────────
function resolveBanquetHallImage(image) {
  const raw = String(image || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) {
    return raw;
  }
  return `${getBackendBaseURL()}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function getReservationStatusBadgeClass(status) {
  const baseClass =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.1em] shadow-[0_2px_8px_rgba(15,40,90,0.05)] sm:px-3 sm:py-1 sm:text-[14px]";

  switch (status) {
    case "Confirmed":
      return `${baseClass} border-emerald-200 bg-emerald-50 text-emerald-700`;
    case "Completed":
      return `${baseClass} border-blue-200 bg-blue-50 text-blue-700`;
    case "Billed":
      return `${baseClass} border-sky-200 bg-sky-50 text-sky-700`;
    case "Cancelled":
      return `${baseClass} border-rose-200 bg-rose-50 text-rose-700`;
    case "Refunded":
      return `${baseClass} border-purple-200 bg-purple-50 text-purple-700`;
    default:
      return `${baseClass} border-amber-200 bg-amber-50 text-amber-700`;
  }
}

function getPaymentStatusBadgeClass(status) {
  const baseClass =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-bold shadow-[0_2px_8px_rgba(15,40,90,0.05)] sm:px-3 sm:py-1 sm:text-[14px]";

  switch (status) {
    case "Paid":
      return `${baseClass} border-emerald-200 bg-emerald-50 text-emerald-700`;
    case "Partial":
      return `${baseClass} border-orange-200 bg-orange-50 text-orange-700`;
    case "Refunded":
      return `${baseClass} border-purple-200 bg-purple-50 text-purple-700`;
    default:
      return `${baseClass} border-amber-200 bg-amber-50 text-amber-700`;
  }
}

const Banquet = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const restoredMenuStateKeyRef = useRef(null);
  const processedFocusStateRef = useRef("");
  const pricingConfigHydratedRef = useRef(false);
  const skipNextPricingConfigSyncRef = useRef(false);
  const pricingConfigSyncTimeoutRef = useRef(null);
  const [hallsPerPage, setHallsPerPage] = useState(2);
  const bookingsPerPage = 5;
  const [halls, setHalls] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [hallPage, setHallPage] = useState(1);
  const [bookingPage, setBookingPage] = useState(1);
  const [showReservationForm, setShowReservationForm] = useState(false);
  const [showAddHall, setShowAddHall] = useState(false);
  const [detailHall, setDetailHall] = useState(null);
  const [hallDeleteTarget, setHallDeleteTarget] = useState(null);
  const [showBill, setShowBill] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [selectedMenuPackage, setSelectedMenuPackage] = useState(null);
  const [activeQuickSection, setActiveQuickSection] = useState(null);
  const [openNavGroup, setOpenNavGroup] = useState("venue");
  const [pricingConfig, setPricingConfig] = useState(getStoredPricingConfig);
  const [menuCatalog, setMenuCatalog] = useState([]);
  const [hallFormError, setHallFormError] = useState("");
  const [isAddingHall, setIsAddingHall] = useState(false);
  const [editingHallId, setEditingHallId] = useState(null);
  const [editingBookingId, setEditingBookingId] = useState(null);
  const [isDeletingHall, setIsDeletingHall] = useState(false);
  const [reservationError, setReservationError] = useState("");
  const [isSavingReservation, setIsSavingReservation] = useState(false);
  const [reservationSuccess, setReservationSuccess] = useState(null);
  const [showBanquetWhatsAppModal, setShowBanquetWhatsAppModal] = useState(false);
  const [selectedBookingForWhatsApp, setSelectedBookingForWhatsApp] = useState(null);
  const [receiptInputKey, setReceiptInputKey] = useState(0);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState("");
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [bookingFiltersDraft, setBookingFiltersDraft] = useState(() => ({
    ...bookingFilterDefaults,
  }));
  const [bookingFilters, setBookingFilters] = useState(() => ({
    ...bookingFilterDefaults,
  }));
  const [wizard, setWizard] = useState(() => ({
    ...defaultWizard,
    eventSupportFee: getStoredPricingConfig().eventSupportFee,
    decorationFee: getStoredPricingConfig().decorServiceFee,
  }));
  const [newHall, setNewHall] = useState(defaultHall);
  const [hallImageMode, setHallImageMode] = useState("upload");
  const [hallImageFile, setHallImageFile] = useState(null);
  const [hallImagePreview, setHallImagePreview] = useState("");
  const delayedShowReservationForm = useDelayedValue(showReservationForm);
  const delayedShowAddHall = useDelayedValue(showAddHall);
  const delayedDetailHall = useDelayedValue(detailHall);
  const delayedHallDeleteTarget = useDelayedValue(hallDeleteTarget);
  const delayedShowBill = useDelayedValue(showBill);
  const delayedSelectedMenuPackage = useDelayedValue(selectedMenuPackage);
  const delayedReservationSuccess = useDelayedValue(reservationSuccess);

  const selectedHall = useMemo(
    () => halls.find((hall) => String(hall.id) === String(wizard.hallId)),
    [halls, wizard.hallId]
  );

  useEffect(() => {
    return () => {
      if (hallImagePreview && hallImagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(hallImagePreview);
      }
    };
  }, [hallImagePreview]);

  const selectedPackage = useMemo(
    () =>
      pricingConfig.menuPackages.find((pkg) => pkg.id === wizard.menuPackageId),
    [pricingConfig.menuPackages, wizard.menuPackageId]
  );

  const selectedLighting = useMemo(
    () =>
      pricingConfig.lightingOptions.find(
        (option) => option.id === wizard.lightingSystem
      ),
    [pricingConfig.lightingOptions, wizard.lightingSystem]
  );

  const menuCategories = useMemo(() => {
    const labels = menuCatalog.map(
      (item) => (item.category || "Other").trim() || "Other"
    );

    return labels.filter(
      (label, index, arr) =>
        arr.findIndex((value) => normalizeCategory(value) === normalizeCategory(label)) ===
        index
    );
  }, [menuCatalog]);

  const menuCatalogByCategory = useMemo(
    () =>
      menuCategories.reduce((acc, category) => {
        acc[category] = menuCatalog.filter(
          (item) =>
            normalizeCategory(item.category) === normalizeCategory(category)
        );
        return acc;
      }, {}),
    [menuCatalog, menuCategories]
  );

  const enrichBooking = (booking) => {
    const normalized = normalizeBooking(booking);
    const financials = deriveBookingFinancials(normalized, halls, pricingConfig);

    return {
      ...normalized,
      hallCharge: financials.hallCharge,
      mealCharge: financials.mealCharge,
      customMenuCharge: financials.customMenuCharge,
      lightingCharge: financials.lightingCharge,
      subtotalAmount: financials.subtotalAmount,
      gstAmount: financials.gstAmount,
      grandTotal: financials.grandTotal,
      netReceived: financials.netReceived,
      balanceDue: financials.balanceDue,
      paymentStatus: financials.paymentStatus,
    };
  };

  const wizardHours = useMemo(
    () => hoursBetween(wizard.startTime, wizard.endTime),
    [wizard.startTime, wizard.endTime]
  );

  const wizardTotals = useMemo(() => {
    const hallCharge = (selectedHall?.ratePerHour || 0) * wizardHours;
    const mealCharge =
      (Number(wizard.guests) || 0) * (selectedPackage?.perGuest || 0);
    const customMenuCharge = calculateRestaurantMenuCharge(
      wizard.selectedRestaurantMenuItems
    );
    const lightingCharge = selectedLighting?.price || 0;
    const eventSupportCharge = Number(wizard.eventSupportFee) || 0;
    const decorationCharge = Number(wizard.decorationFee) || 0;
    const subtotal =
      hallCharge +
      mealCharge +
      customMenuCharge +
      lightingCharge +
      eventSupportCharge +
      decorationCharge;
    const discount = Math.min(subtotal, Number(wizard.discount) || 0);
    const taxable = subtotal - discount;
    const gst = Math.round((taxable * (Number(wizard.gstPercent) || 0)) / 100);

    return {
      hallCharge,
      mealCharge,
      customMenuCharge,
      lightingCharge,
      eventSupportCharge,
      decorationCharge,
      subtotal,
      gst,
      grandTotal: taxable + gst,
      advance: Math.max(0, Number(wizard.advance) || 0),
      balanceDue: Math.max(0, taxable + gst - (Number(wizard.advance) || 0)),
    };
  }, [selectedHall, selectedLighting, selectedPackage, wizard, wizardHours]);

  const eventTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(bookings.map((booking) => booking.eventType).filter(Boolean))
      ),
    [bookings]
  );

  const filteredBookings = useMemo(() => {
    const normalizedSearch = bookingFilters.search.trim().toLowerCase();

    return bookings.filter((booking) => {
      const bookingDate = String(booking.date || "").slice(0, 10);
      const searchableText = [
        booking.customerName,
        booking.hallName,
        booking.guestEmail,
        booking.phone,
        booking.eventTitle,
        booking.eventType,
        booking.invoiceNo,
      ]
        .join(" ")
        .toLowerCase();

      if (
        normalizedSearch &&
        !searchableText.includes(normalizedSearch)
      ) {
        return false;
      }

      if (
        bookingFilters.eventType !== "all" &&
        booking.eventType !== bookingFilters.eventType
      ) {
        return false;
      }

      if (
        bookingFilters.status !== "all" &&
        booking.status !== bookingFilters.status
      ) {
        return false;
      }

      if (bookingFilters.dateFrom && (!bookingDate || bookingDate < bookingFilters.dateFrom)) {
        return false;
      }

      if (bookingFilters.dateTo && (!bookingDate || bookingDate > bookingFilters.dateTo)) {
        return false;
      }

      return true;
    });
  }, [bookingFilters, bookings]);

  const menuPackageNameMap = useMemo(
    () =>
      pricingConfig.menuPackages.reduce((acc, pkg) => {
        acc[pkg.id] = pkg.name;
        return acc;
      }, {}),
    [pricingConfig.menuPackages]
  );

  const lightingLabelMap = useMemo(
    () =>
      pricingConfig.lightingOptions.reduce((acc, option) => {
        acc[option.id] = option.label;
        return acc;
      }, {}),
    [pricingConfig.lightingOptions]
  );

  const stats = useMemo(() => {
    const confirmedCount = bookings.filter(
      (booking) => booking.status === "Confirmed"
    ).length;
    const billedCount = bookings.filter((booking) => booking.invoiceNo).length;
    const uniqueGuests = new Set(
      bookings.map(
        (booking) =>
          booking.guestEmail ||
          booking.phone ||
          booking.customerName
      )
    ).size;

    return [
      {
        label: "Total events",
        value: String(bookings.length),
        tone:
          "border-white/15 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
      },
      {
        label: "Confirmed",
        value: String(confirmedCount),
        tone:
          "border-emerald-300/25 bg-emerald-400/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
      },
      {
        label: "Billed invoices",
        value: String(billedCount),
        tone:
          "border-violet-300/25 bg-violet-400/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
      },
      {
        label: "Unique guests",
        value: String(uniqueGuests),
        tone:
          "border-sky-300/25 bg-sky-400/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
      },
    ];
  }, [bookings]);

  const healthSnapshot = useMemo(() => {
    const activeBookings = bookings.filter(
      (booking) => !["Cancelled", "Refunded"].includes(booking.status)
    );
    const conversionBase = activeBookings.length || bookings.length || 1;
    const confirmedOrBilled = bookings.filter((booking) =>
      ["Confirmed", "Completed", "Billed"].includes(booking.status)
    ).length;
    const availableHalls = halls.filter(
      (hall) => hall.status === "Available"
    ).length;
    const pendingDueAmount = bookings.reduce(
      (sum, booking) => sum + (Number(booking.balanceDue) || 0),
      0
    );

    return [
      {
        label: "Confirmation rate",
        value: `${Math.round((confirmedOrBilled / conversionBase) * 100)}%`,
        note: "Healthy mix of confirmed and billed events.",
        tone:
          "border-emerald-200 bg-emerald-50/80 text-emerald-900",
        icon: FaCheckCircle,
        iconTone: "text-emerald-600",
      },
      {
        label: "Pending collection",
        value: formatINR(pendingDueAmount),
        note: "Track unsettled banquet balances before billing.",
        tone:
          "border-rose-200 bg-rose-50/80 text-rose-900",
        icon: FaExclamationTriangle,
        iconTone: "text-rose-600",
      },
      {
        label: "Available halls",
        value: `${availableHalls}/${halls.length || 0}`,
        note: "Venue slots ready for the next reservation.",
        tone:
          "border-blue-200 bg-blue-50/80 text-blue-900",
        icon: FaUsers,
        iconTone: "text-blue-600",
      },
      {
        label: "Live estimate",
        value: formatINR(wizardTotals.grandTotal),
        note: "Current quotation preview from the reservation form.",
        tone:
          "border-amber-200 bg-amber-50/80 text-amber-900",
        icon: FaReceipt,
        iconTone: "text-amber-600",
      },
    ];
  }, [bookings, halls, wizardTotals.grandTotal]);

  const totalHallPages = useMemo(
    () => Math.max(1, Math.ceil(halls.length / hallsPerPage)),
    [halls.length, hallsPerPage]
  );

  const totalBookingPages = useMemo(
    () => Math.max(1, Math.ceil(filteredBookings.length / bookingsPerPage)),
    [filteredBookings.length]
  );

  const paginatedHalls = useMemo(() => {
    const start = (hallPage - 1) * hallsPerPage;
    return halls.slice(start, start + hallsPerPage);
  }, [hallPage, halls, hallsPerPage]);

  const paginatedBookings = useMemo(() => {
    const start = (bookingPage - 1) * bookingsPerPage;
    return filteredBookings.slice(start, start + bookingsPerPage);
  }, [bookingPage, filteredBookings]);

  const hasAppliedBookingFilters = useMemo(
    () =>
      Boolean(
        bookingFilters.search.trim() ||
          bookingFilters.eventType !== "all" ||
          bookingFilters.status !== "all" ||
          bookingFilters.dateFrom ||
          bookingFilters.dateTo
      ),
    [bookingFilters]
  );

  const todayStr = useMemo(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, []);

  const todaysBookings = useMemo(
    () =>
      bookings
        .filter((booking) => String(booking.date || "").slice(0, 10) === todayStr)
        .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || ""))),
    [bookings, todayStr]
  );

  const upcomingBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        const bookingDate = String(booking.date || "").slice(0, 10);
        return (
          bookingDate > todayStr && !["Cancelled", "Refunded"].includes(booking.status)
        );
      }),
    [bookings, todayStr]
  );

  const recentBookings = useMemo(
    () =>
      [...bookings]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 3),
    [bookings]
  );

  const dashboardRevenue = useMemo(() => {
    const totalRevenue = bookings.reduce(
      (sum, booking) => sum + (Number(booking.grandTotal) || 0),
      0
    );
    const advanceReceived = bookings.reduce(
      (sum, booking) => sum + (Number(booking.advance) || 0),
      0
    );
    const pendingAmount = bookings.reduce(
      (sum, booking) => sum + (Number(booking.balanceDue) || 0),
      0
    );
    return { totalRevenue, advanceReceived, pendingAmount };
  }, [bookings]);

  const dashboardStatCards = useMemo(
    () => [
      {
        label: "Total Halls",
        value: String(halls.length),
        icon: FaGlassCheers,
        iconTone: "bg-gradient-to-br from-blue-700 to-blue-500",
        sectionId: "halls",
      },
      {
        label: "Total Reservations",
        value: String(bookings.length),
        icon: FaCalendarAlt,
        iconTone: "bg-gradient-to-br from-sky-600 to-sky-400",
        sectionId: "reservations",
      },
      {
        label: "Today's Events",
        value: String(todaysBookings.length),
        icon: FaCalendarAlt,
        iconTone: "bg-gradient-to-br from-orange-500 to-amber-400",
        sectionId: "reservations",
      },
      {
        label: "Upcoming Events",
        value: String(upcomingBookings.length),
        icon: FaCalendarAlt,
        iconTone: "bg-gradient-to-br from-violet-600 to-purple-400",
        sectionId: "reservations",
      },
      {
        label: "Total Revenue",
        value: formatINR(dashboardRevenue.totalRevenue),
        icon: FaMoneyCheckAlt,
        iconTone: "bg-gradient-to-br from-emerald-600 to-emerald-400",
        sectionId: "settlement",
      },
      {
        label: "Pending Payments",
        value: formatINR(dashboardRevenue.pendingAmount),
        icon: FaReceipt,
        iconTone: "bg-gradient-to-br from-rose-600 to-rose-400",
        sectionId: "settlement",
      },
    ],
    [halls.length, bookings.length, todaysBookings.length, upcomingBookings.length, dashboardRevenue]
  );

  const sectionIconTones = {
    halls: "bg-gradient-to-br from-blue-700 to-blue-500",
    reservations: "bg-gradient-to-br from-sky-600 to-sky-400",
    meals: "bg-gradient-to-br from-orange-500 to-amber-400",
    addons: "bg-gradient-to-br from-violet-600 to-purple-400",
    settlement: "bg-gradient-to-br from-emerald-600 to-emerald-400",
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await API.get("/banquet");
        if (res.data?.pricingConfig) {
          skipNextPricingConfigSyncRef.current = true;
          pricingConfigHydratedRef.current = true;
          setPricingConfig(res.data.pricingConfig);
        } else {
          pricingConfigHydratedRef.current = true;
        }
        setHalls((res.data?.halls || []).map((hall) => normalizeHall(hall)));
        setBookings(
          (res.data?.bookings || []).map((booking) => enrichBooking(booking))
        );
      } catch {
        pricingConfigHydratedRef.current = true;
      }
    };

    load();
  }, []);

  useEffect(() => {
    setBookings((prev) => prev.map((booking) => enrichBooking(booking)));
  }, [halls, pricingConfig]);

  useEffect(() => {
    const loadMenuCatalog = async () => {
      try {
        const response = await API.get("/restaurant/menu");
        setMenuCatalog(Array.isArray(response.data) ? response.data : []);
      } catch {
        setMenuCatalog([]);
      }
    };

    loadMenuCatalog();
  }, []);

  useEffect(() => {
    const hasBanquetMenuState =
      Boolean(location.state?.banquetMenuSelection) ||
      Boolean(location.state?.banquetMenuCancelled);

    if (!hasBanquetMenuState) {
      restoredMenuStateKeyRef.current = null;
      return;
    }

    if (restoredMenuStateKeyRef.current === location.key) {
      return;
    }

    restoredMenuStateKeyRef.current = location.key;

    let draft = null;

    try {
      draft = JSON.parse(
        window.sessionStorage.getItem(banquetMenuDraftStorageKey) || "null"
      );
    } catch {
      draft = null;
    }

    const restoredWizard = {
      ...defaultWizard,
      eventSupportFee: pricingConfig.eventSupportFee,
      decorationFee: pricingConfig.decorServiceFee,
      ...(draft?.wizard || {}),
      selectedCustomMenuItems:
        location.state?.banquetMenuSelection?.selectedCustomMenuItems ||
        draft?.wizard?.selectedCustomMenuItems ||
        [],
      selectedRestaurantMenuItems:
        location.state?.banquetMenuSelection?.selectedRestaurantMenuItems ||
        draft?.wizard?.selectedRestaurantMenuItems ||
        [],
      manualCustomMenuItems: draft?.wizard?.manualCustomMenuItems || [],
      manualMenuEntry: "",
    };

    setReservationError("");
    setEditingBookingId(draft?.editingBookingId || null);
    setReceiptInputKey((prev) => prev + 1);
    setWizard(restoredWizard);
    setActiveQuickSection(null);
    setShowReservationForm(true);
    window.sessionStorage.removeItem(banquetMenuDraftStorageKey);
  }, [
    location.key,
    location.state,
    pricingConfig.decorServiceFee,
    pricingConfig.eventSupportFee,
  ]);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl && receiptPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
    };
  }, [receiptPreviewUrl]);

  useEffect(() => {
    const focusBookingId = location.state?.focusBookingId;
    if (!focusBookingId || !bookings.length) return;

    const focusKey = `${location.key}:${focusBookingId}:${Boolean(
      location.state?.openBanquetBill,
    )}`;
    if (processedFocusStateRef.current === focusKey) return;

    const booking = bookings.find(
      (item) => String(item.id) === String(focusBookingId),
    );
    if (!booking) return;

    processedFocusStateRef.current = focusKey;
    setActiveQuickSection("reservations");

    if (location.state?.openBanquetBill && booking.invoiceNo) {
      setSelectedBooking(booking);
      setShowBill(true);
    }
  }, [bookings, location.key, location.state]);

  useEffect(() => {
    window.localStorage.setItem(
      banquetConfigStorageKey,
      JSON.stringify(pricingConfig)
    );

    if (!pricingConfigHydratedRef.current) return;

    if (skipNextPricingConfigSyncRef.current) {
      skipNextPricingConfigSyncRef.current = false;
      return;
    }

    if (pricingConfigSyncTimeoutRef.current) {
      window.clearTimeout(pricingConfigSyncTimeoutRef.current);
    }

    pricingConfigSyncTimeoutRef.current = window.setTimeout(() => {
      API.put("/banquet/config", pricingConfig).catch(() => {});
    }, 400);
  }, [pricingConfig]);

  useEffect(() => {
    return () => {
      if (pricingConfigSyncTimeoutRef.current) {
        window.clearTimeout(pricingConfigSyncTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hallPage > totalHallPages) {
      setHallPage(totalHallPages);
    }
  }, [hallPage, totalHallPages]);

  useEffect(() => {
    if (bookingPage > totalBookingPages) {
      setBookingPage(totalBookingPages);
    }
  }, [bookingPage, totalBookingPages]);

  useEffect(() => {
    const hasOpenModal =
      delayedShowReservationForm ||
      delayedShowAddHall ||
      Boolean(delayedDetailHall) ||
      Boolean(delayedHallDeleteTarget) ||
      delayedShowBill ||
      Boolean(delayedReservationSuccess) ||
      Boolean(delayedSelectedMenuPackage) ||
      showBanquetWhatsAppModal;

    if (!hasOpenModal) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;

      if (selectedMenuPackage) {
        setSelectedMenuPackage(null);
        return;
      }
      if (showBanquetWhatsAppModal) {
        setShowBanquetWhatsAppModal(false);
        return;
      }
      if (showBill) {
        setShowBill(false);
        return;
      }
      if (reservationSuccess) {
        setReservationSuccess(null);
        return;
      }
      if (detailHall) {
        setDetailHall(null);
        return;
      }
      if (hallDeleteTarget) {
        setHallDeleteTarget(null);
        return;
      }
      if (showAddHall) {
        setHallFormError("");
        setShowAddHall(false);
        return;
      }
      if (showReservationForm) {
        resetWizard();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    delayedDetailHall,
    delayedHallDeleteTarget,
    delayedReservationSuccess,
    delayedSelectedMenuPackage,
    delayedShowAddHall,
    delayedShowBill,
    delayedShowReservationForm,
    detailHall,
    hallDeleteTarget,
    reservationSuccess,
    selectedMenuPackage,
    showAddHall,
    showBanquetWhatsAppModal,
    showBill,
    showReservationForm,
  ]);

  const resetWizard = () => {
    setReservationError("");
    setEditingBookingId(null);
    setReceiptInputKey((prev) => prev + 1);
    setReceiptPreviewUrl((prev) => {
      if (prev && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return "";
    });
    setWizard({
      ...defaultWizard,
      eventSupportFee: pricingConfig.eventSupportFee,
      decorationFee: pricingConfig.decorServiceFee,
    });
    setShowReservationForm(false);
  };

  const openCreateReservationForm = () => {
    setReservationError("");
    setEditingBookingId(null);
    setReceiptInputKey((prev) => prev + 1);
    setReceiptPreviewUrl((prev) => {
      if (prev && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return "";
    });
    setWizard({
      ...defaultWizard,
      eventSupportFee: pricingConfig.eventSupportFee,
      decorationFee: pricingConfig.decorServiceFee,
    });
    setShowReservationForm(true);
  };

  const openAddHallForm = () => {
    setHallFormError("");
    setEditingHallId(null);
    setNewHall(defaultHall);
    setHallImageMode("upload");
    setHallImageFile(null);
    setHallImagePreview("");
    setActiveQuickSection("halls");
    setShowAddHall(true);
  };

  const handleHallImageFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setHallImageFile(file);

    if (hallImagePreview && hallImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(hallImagePreview);
    }

    if (file) {
      setHallImagePreview(URL.createObjectURL(file));
      setHallImageMode("upload");
      return;
    }

    setHallImagePreview("");
  };

  const handleEditBooking = (booking) => {
    const normalizedBooking = normalizeBooking(booking);
    setReservationError("");
    setEditingBookingId(booking.id);
    setReceiptInputKey((prev) => prev + 1);
    setReceiptPreviewUrl((prev) => {
      if (prev && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return "";
    });
    setWizard({
      ...defaultWizard,
      ...normalizedBooking,
      hallId: String(normalizedBooking.hallId || ""),
      guests: String(normalizedBooking.guests || ""),
      eventSupportFee: String(normalizedBooking.eventSupportFee || 0),
      decorationFee: String(normalizedBooking.decorationFee || 0),
      discount: String(normalizedBooking.discount || 0),
      gstPercent: String(normalizedBooking.gstPercent || 5),
      advance: String(normalizedBooking.advance || 0),
      refundAmount: String(normalizedBooking.refundAmount || 0),
      selectedCustomMenuItems: normalizedBooking.selectedCustomMenuItems || [],
      selectedRestaurantMenuItems:
        normalizedBooking.selectedRestaurantMenuItems || [],
      manualCustomMenuItems: normalizedBooking.manualCustomMenuItems || [],
      manualMenuEntry: "",
    });
    setShowReservationForm(true);
    setActiveQuickSection(null);
  };

  const toggleCustomMenuSelection = (name) => {
    setWizard((prev) => {
      const exists = prev.selectedCustomMenuItems.includes(name);
      return {
        ...prev,
        selectedCustomMenuItems: exists
          ? prev.selectedCustomMenuItems.filter((item) => item !== name)
          : [...prev.selectedCustomMenuItems, name],
      };
    });
  };

  const handleAddManualMenuItem = () => {
    const value = String(wizard.manualMenuEntry || "").trim();
    if (!value) return;

    setWizard((prev) => ({
      ...prev,
      manualCustomMenuItems: prev.manualCustomMenuItems.includes(value)
        ? prev.manualCustomMenuItems
        : [...prev.manualCustomMenuItems, value],
      manualMenuEntry: "",
    }));
  };

  const handleRemoveManualMenuItem = (itemToRemove) => {
    setWizard((prev) => ({
      ...prev,
      manualCustomMenuItems: prev.manualCustomMenuItems.filter(
        (item) => item !== itemToRemove
      ),
    }));
  };

  const handleRemoveSelectedRestaurantMenuItem = (itemToRemove, indexToRemove) => {
    setWizard((prev) => {
      const nextRestaurantItems = prev.selectedRestaurantMenuItems.filter(
        (_, index) =>
          index !== indexToRemove ||
          String(itemToRemove?.name || "").trim() !==
            String(prev.selectedRestaurantMenuItems[index]?.name || "").trim()
      );
      const removedName = String(itemToRemove?.name || "").trim();
      const shouldKeepCustomChip =
        !removedName ||
        nextRestaurantItems.some((item) => item.name === removedName) ||
        prev.manualCustomMenuItems.includes(removedName);

      return {
        ...prev,
        selectedRestaurantMenuItems: nextRestaurantItems,
        selectedCustomMenuItems: shouldKeepCustomChip
          ? prev.selectedCustomMenuItems
          : prev.selectedCustomMenuItems.filter((item) => item !== removedName),
      };
    });
  };

  const handleRemoveSelectedCustomMenuItem = (itemToRemove) => {
    setWizard((prev) => ({
      ...prev,
      selectedCustomMenuItems: prev.selectedCustomMenuItems.filter(
        (item) => item !== itemToRemove
      ),
      selectedRestaurantMenuItems: prev.selectedRestaurantMenuItems.filter(
        (item) => item.name !== itemToRemove
      ),
    }));
  };

  const handleOpenRestaurantMenu = () => {
    window.sessionStorage.setItem(
      banquetMenuDraftStorageKey,
      JSON.stringify({
        wizard,
        editingBookingId,
      })
    );

    navigate("/restaurant/menu/banquet", {
      state: {
        banquetMenuPicker: true,
        returnTo: "/banquet",
      },
    });
  };

  const handleReceiptUpload = async (file) => {
    if (!file) return;

    const maxFileSize = 2 * 1024 * 1024;
    if (file.size > maxFileSize) {
      setReservationError("Receipt file 2MB se chhoti honi chahiye.");
      setReceiptInputKey((prev) => prev + 1);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setReceiptPreviewUrl((prev) => {
      if (prev && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return nextPreviewUrl;
    });
    setReservationError("");
    setWizard((prev) => ({
      ...prev,
      receiptFileName: file.name,
    }));
  };

  const handleRemoveReceipt = () => {
    setReceiptPreviewUrl((prev) => {
      if (prev && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return "";
    });
    setWizard((prev) => ({
      ...prev,
      receiptFileName: "",
    }));
    setReceiptInputKey((prev) => prev + 1);
  };

  const showReservationSuccessPopup = ({
    title,
    eyebrow,
    message,
    customerName,
    hallName,
    date,
    detail,
    subjectLabel,
  }) => {
    setReservationSuccess({
      title,
      eyebrow,
      message,
      customerName,
      hallName,
      date,
      detail,
      subjectLabel,
    });
  };

  const handleConfirmBooking = async ({ cancelAfterSave = false } = {}) => {
    if (!wizard.hallId || !wizard.customerName.trim() || !wizard.date) {
      setReservationError(
        "Hall, guest name aur booking date bharna zaroori hai."
      );
      return;
    }

    if (!wizard.startTime || !wizard.endTime || wizardHours <= 0) {
      setReservationError("Start time aur end time valid select kijiye.");
      return;
    }

    if (Number(wizard.refundAmount || 0) > Number(wizard.advance || 0)) {
      setReservationError(
        "Refund amount cannot exceed payment received."
      );
      return;
    }

    setReservationError("");
    setIsSavingReservation(true);

    const customMenuItems = buildCustomMenuItemsText(
      wizard.selectedCustomMenuItems,
      wizard.manualCustomMenuItems
    );
    const existingBooking = bookings.find(
      (booking) => booking.id === editingBookingId
    );

    const reservationMeta = {
      guestEmail: wizard.guestEmail,
      eventTitle: wizard.eventTitle,
      mealSection: wizard.mealSection,
      customMenuItems,
      selectedCustomMenuItems: wizard.selectedCustomMenuItems,
      selectedRestaurantMenuItems: wizard.selectedRestaurantMenuItems,
      manualCustomMenuItems: wizard.manualCustomMenuItems,
      lightingSystem: wizard.lightingSystem,
      eventSupportFee: wizard.eventSupportFee,
      phone: wizard.phone,
      advance: wizard.advance,
      paymentMode: wizard.paymentMode,
      paymentReferenceId: wizard.paymentReferenceId,
      receiptFileName: wizard.receiptFileName,
      refundAmount: Number(wizard.refundAmount || 0),
    };

    const payload = {
      ...wizard,
      customMenuItems,
      customMenuCharge: wizardTotals.customMenuCharge,
      lightingCharge: wizardTotals.lightingCharge,
      hallCharge: wizardTotals.hallCharge,
      mealCharge: wizardTotals.mealCharge,
      eventSupportFee: Number(wizard.eventSupportFee || 0),
      subtotalAmount: wizardTotals.subtotal,
      gstAmount: wizardTotals.gst,
      grandTotal: wizardTotals.grandTotal,
      advance: Number(wizard.advance || 0),
      refundAmount: Number(wizard.refundAmount || 0),
      paymentMode: wizard.paymentMode || "Pending",
      paymentStatus:
        wizardTotals.grandTotal > 0 && wizardTotals.advance >= wizardTotals.grandTotal
          ? "Paid"
          : wizardTotals.advance > 0
          ? "Partial"
          : "Pending",
      paymentReferenceNo: wizard.paymentReferenceId || "",
      notes: buildNotesPayload(wizard.notes, reservationMeta),
    };

    try {
      if (editingBookingId) {
        await API.put(`/banquet/${editingBookingId}`, payload);
        let updatedStatus = existingBooking?.status || "Confirmed";

        if (cancelAfterSave) {
          await API.put(`/banquet/${editingBookingId}/cancel`);
          updatedStatus = "Cancelled";
        }

        const updatedBooking = enrichBooking({
          ...payload,
          id: editingBookingId,
          hallName: selectedHall?.name || "Banquet Hall",
          status: updatedStatus,
          invoiceNo: existingBooking?.invoiceNo || "",
        });

        setBookings((prev) =>
          prev.map((booking) =>
            booking.id === editingBookingId ? updatedBooking : booking
          )
        );

        showReservationSuccessPopup({
          title: cancelAfterSave
            ? "Booking cancelled"
            : "Reservation updated",
          eyebrow: cancelAfterSave ? "Booking Cancelled" : "Reservation Updated",
          message: cancelAfterSave
            ? "booking has been cancelled."
            : "reservation has been updated.",
          customerName: updatedBooking.customerName,
          hallName: updatedBooking.hallName,
          date: updatedBooking.date,
        });
      } else {
        const res = await API.post("/banquet", payload);
        const newBooking = enrichBooking({
          ...payload,
          id: res.data?.id || Date.now(),
          hallName: selectedHall?.name || "Banquet Hall",
          rawStatus: "confirmed",
          invoiceNo: "",
        });

        setBookings((prev) => [newBooking, ...prev]);
        showReservationSuccessPopup({
          title: "Reservation successful",
          eyebrow: "Booking Confirmed",
          message: "reservation has been saved.",
          customerName: newBooking.customerName,
          hallName: newBooking.hallName,
          date: newBooking.date,
        });
      }
      resetWizard();
    } catch (error) {
      setReservationError(
        error.response?.data?.message || "Reservation could not be saved."
      );
    } finally {
      setIsSavingReservation(false);
    }
  };

  const handleCompleteBooking = async (bookingId) => {
    try {
      await API.put(`/banquet/${bookingId}/complete`);

      setBookings((prev) =>
        prev.map((booking) =>
          booking.id === bookingId ? { ...booking, status: "completed" } : booking
        )
      );
    } catch (error) {
      setReservationError(
        error.response?.data?.message || "Could not complete the booking."
      );
    }
  };

  const handleCancelBooking = async (booking) => {
    const confirmed = window.confirm(
      `${booking.customerName} ki booking cancel karni hai?`
    );
    if (!confirmed) return;

    try {
      await API.put(`/banquet/${booking.id}/cancel`);
    } catch (error) {
      setReservationError(
        error.response?.data?.message || "Could not cancel the booking."
      );
      return;
    }

    const cancelledBooking = {
      ...booking,
      status: "cancelled",
      balanceDue: 0,
    };

    setBookings((prev) =>
      prev.map((item) =>
        item.id === booking.id
          ? cancelledBooking
          : item
      )
    );

    showReservationSuccessPopup({
      title: "Booking cancelled",
      eyebrow: "Booking Cancelled",
      message: "booking has been cancelled.",
      customerName: cancelledBooking.customerName,
      hallName: cancelledBooking.hallName,
      date: cancelledBooking.date,
    });
  };

  const handleRefundBooking = async (booking) => {
    const remainingRefund = Math.max(
      0,
      Number(booking.advance || 0) - Number(booking.refundAmount || 0)
    );

    if (remainingRefund <= 0) {
      setReservationError("Is booking ka pura payment pehle hi refund ho chuka hai.");
      return;
    }

    const value = window.prompt(
      `Kitna refund karna hai? Max ${remainingRefund}`,
      String(remainingRefund)
    );
    if (value === null) return;

    const refundAmount = Number(value);
    if (!refundAmount || refundAmount <= 0 || refundAmount > remainingRefund) {
      setReservationError("Refund amount valid nahi hai.");
      return;
    }

    const rawStatus = booking.rawStatus || booking.status;

    try {
      const response = await API.put(`/banquet/${booking.id}/refund`, {
        refundAmount,
      });
      const totalRefund = Number(response.data?.refundAmount || 0);
      const nextStatus =
        response.data?.status ||
        (totalRefund >= Number(booking.advance || 0)
          ? "Refunded"
          : booking.status);

      setBookings((prev) =>
        prev.map((item) =>
          item.id === booking.id
            ? {
                ...item,
                refundAmount: totalRefund,
                netReceived: Number(
                  response.data?.netReceived ??
                    Math.max(0, Number(item.advance || 0) - totalRefund)
                ),
                status: nextStatus,
              rawStatus: response.data?.status || rawStatus,
                balanceDue: Number(response.data?.balanceDue ?? item.balanceDue ?? 0),
                paymentStatus:
                  response.data?.paymentStatus ||
                  (nextStatus === "Refunded" ? "Refunded" : item.paymentStatus),
              }
            : item
        )
      );
    } catch (error) {
      setReservationError(
        error.response?.data?.message || "Refund could not be recorded."
      );
    }
  };

  const handleDeleteBooking = async (booking) => {
    if (
      !["cancelled", "refunded", "Cancelled", "Refunded"].includes(booking.status)
    ) {
      setReservationError(
        "Delete sirf cancelled ya refunded reservation ke liye available hai."
      );
      return;
    }

    const confirmed = window.confirm(
      `${booking.customerName} ki booking permanently delete karni hai?`
    );
    if (!confirmed) return;

    try {
      await API.delete(`/banquet/${booking.id}`);
      setBookings((prev) => prev.filter((item) => item.id !== booking.id));
      showReservationSuccessPopup({
        title: "Reservation deleted",
        eyebrow: "History Deleted",
        message: "reservation history has been deleted.",
        customerName: booking.customerName,
        hallName: booking.hallName,
        date: booking.date,
      });
    } catch (error) {
      setReservationError(
        error.response?.data?.message || "Could not delete the reservation."
      );
    }
  };

  const handleGenerateBill = async (booking) => {
    const invoiceNo =
      booking.invoiceNo || `BNQ-${String(booking.id).padStart(6, "0")}`;

    try {
      await API.put(`/banquet/${booking.id}/bill`, { invoiceNo });
    } catch (error) {
      setReservationError(
        error.response?.data?.message || "Could not generate the invoice."
      );
      return;
    }

    const updatedBooking = enrichBooking({
      ...booking,
      invoiceNo,
      status: "completed",
    });

    setBookings((prev) =>
      prev.map((item) => (item.id === booking.id ? updatedBooking : item))
    );
    setSelectedBooking(updatedBooking);
    setShowBill(true);
  };

  const handleSendQuotation = (booking, type) => {
    const hall = halls.find((item) => String(item.id) === String(booking.hallId));
    const pkg = pricingConfig.menuPackages.find(
      (item) => item.id === booking.menuPackageId
    );
    const lighting = pricingConfig.lightingOptions.find(
      (item) => item.id === booking.lightingSystem
    );

    const subtotal =
      (hall?.ratePerHour || 0) * hoursBetween(booking.startTime, booking.endTime) +
      (pkg?.perGuest || 0) * (Number(booking.guests) || 0) +
      calculateRestaurantMenuCharge(booking.selectedRestaurantMenuItems) +
      (Number(booking.eventSupportFee) || 0) +
      (Number(booking.decorationFee) || 0) +
      (lighting?.price || 0);
    const estimatedAmount =
      Number(booking.grandTotal) ||
      calculateBookingGrandTotal(booking, halls, pricingConfig);

    const quoteLines = [
      `Banquet quotation for ${booking.customerName}`,
      `Hall: ${booking.hallName}`,
      `Event: ${booking.eventTitle || booking.eventType}`,
      `Date: ${booking.date}`,
      `Time: ${booking.startTime} - ${booking.endTime}`,
      `Guests: ${booking.guests}`,
      `Meal: ${pkg?.name || booking.menuPackageId} / ${
        booking.mealSection || "Meal plan"
      }`,
      `Menu items: ${booking.customMenuItems || "As discussed"}`,
      `Custom menu amount: ${formatINR(
        calculateRestaurantMenuCharge(booking.selectedRestaurantMenuItems)
      )}`,
      `Lighting: ${lighting?.label || "Standard"}`,
      `Event support: ${formatINR(booking.eventSupportFee || 0)}`,
      `Estimated amount: ${formatINR(estimatedAmount || subtotal)}`,
      `Paid: ${formatINR(booking.advance || 0)}`,
      `Refunded: ${formatINR(booking.refundAmount || 0)}`,
      `Balance due: ${formatINR(booking.balanceDue || 0)}`,
    ];

    const message = encodeURIComponent(quoteLines.join("\n"));

    if (type === "email") {
      const subject = encodeURIComponent(
        `Banquet quotation - ${booking.eventTitle || booking.eventType}`
      );
      const email = booking.guestEmail || "";
      window.open(`mailto:${email}?subject=${subject}&body=${message}`, "_self");
      return;
    }

    const whatsappNumber = String(booking.phone || "").replace(/\D/g, "");
    window.open(`https://wa.me/${whatsappNumber}?text=${message}`, "_blank");
  };

  const handleSendBanquetInvoiceWhatsApp = (booking) => {
    if (!booking.invoiceNo) {
      setReservationError(
        "Pehle invoice generate karein (Bill button) phir WhatsApp se send karein."
      );
      return;
    }
    setSelectedBookingForWhatsApp(booking);
    setShowBanquetWhatsAppModal(true);
  };

  const handleBanquetWhatsAppSuccess = (result) => {
    if (!selectedBookingForWhatsApp || !result) return;

    const sendMode = result.sendMode || "pdf";
    const detailText =
      sendMode === "text-only"
        ? "Invoice text message sent successfully (PDF file could not be delivered — check backend or ngrok URL)."
        : "Invoice PDF and message sent to customer and admin successfully.";

    showReservationSuccessPopup({
      title: sendMode === "text-only" ? "Invoice sent (text only)" : "Invoice sent via WhatsApp",
      eyebrow: "WhatsApp Sent",
      message: `banquet invoice #${selectedBookingForWhatsApp.invoiceNo} has been sent.`,
      customerName: selectedBookingForWhatsApp.customerName,
      hallName: selectedBookingForWhatsApp.hallName,
      date: selectedBookingForWhatsApp.date,
      detail: detailText,
      subjectLabel: "WhatsApp",
    });
  };

  const handleAddHall = async () => {
    const payload = {
      ...newHall,
      name: newHall.name.trim(),
      capacity: Number(newHall.capacity),
      ratePerHour: Number(newHall.ratePerHour),
      image: String(newHall.image || "").trim(),
    };

    if (!payload.name || payload.capacity <= 0 || payload.ratePerHour <= 0) {
      setHallFormError("Please enter a valid hall name, capacity, and hourly rate.");
      return;
    }

    setIsAddingHall(true);
    setHallFormError("");

    try {
      const usingFormData = !!hallImageFile;
      const requestBody = usingFormData
        ? (() => {
            const formData = new FormData();
            formData.append("name", payload.name);
            formData.append("capacity", String(payload.capacity));
            formData.append("ratePerHour", String(payload.ratePerHour));
            formData.append("is_ac", payload.is_ac ? "true" : "false");
            formData.append("image", hallImageFile);
            if (editingHallId) {
              formData.append("status", newHall.status || "Available");
            }
            return formData;
          })()
        : {
            ...payload,
            image: hallImageMode === "url" ? payload.image : "",
          };

      const apiConfig = usingFormData
        ? { headers: { "Content-Type": "multipart/form-data" } }
        : {};

      if (editingHallId) {
        await API.put(`/banquet/halls/${editingHallId}`, requestBody, apiConfig);
      } else {
        await API.post("/banquet/halls", requestBody, apiConfig);
      }
      const refreshed = await API.get("/banquet");
      if (refreshed.data?.pricingConfig) {
        skipNextPricingConfigSyncRef.current = true;
        setPricingConfig(refreshed.data.pricingConfig);
      }
      setHalls((refreshed.data?.halls || []).map((hall) => normalizeHall(hall)));
      showReservationSuccessPopup({
        title: editingHallId ? "Hall updated" : "Hall added",
        eyebrow: editingHallId ? "Hall Updated" : "Hall Added",
        message: editingHallId
          ? "hall details have been updated."
          : "hall has been added successfully.",
        customerName: payload.name,
        hallName: `${payload.capacity} guests capacity`,
        detail: `Rate ${formatINR(payload.ratePerHour)} per hour`,
        subjectLabel: "Hall",
      });
      setNewHall(defaultHall);
      setHallImageMode("upload");
      setHallImageFile(null);
      setHallImagePreview("");
      setEditingHallId(null);
      setShowAddHall(false);
      setActiveQuickSection("halls");
    } catch (error) {
      setHallFormError(
        error.response?.data?.message ||
          (editingHallId
            ? "Unable to update the banquet hall."
            : "Unable to add the banquet hall.")
      );
    } finally {
      setIsAddingHall(false);
    }
  };

  const handleEditHall = (hall) => {
    setHallFormError("");
    setEditingHallId(hall.id);
    setNewHall({
      name: hall.name || "",
      capacity: String(hall.capacity || ""),
      ratePerHour: String(hall.ratePerHour || ""),
      image: hall.image || "",
      is_ac: Boolean(hall.is_ac),
      status: hall.status || "Available",
    });
    setHallImageMode(hall.image ? "url" : "upload");
    setHallImageFile(null);
    setHallImagePreview("");
    setDetailHall(null);
    setShowAddHall(true);
  };

  const handleDeleteHall = async (hall) => {
    setHallDeleteTarget(hall);
  };

  const confirmDeleteHall = async () => {
    if (!hallDeleteTarget?.id) return;
    setIsDeletingHall(true);
    setHallFormError("");

    try {
      await API.delete(`/banquet/halls/${hallDeleteTarget.id}`);
      const refreshed = await API.get("/banquet");
      if (refreshed.data?.pricingConfig) {
        skipNextPricingConfigSyncRef.current = true;
        setPricingConfig(refreshed.data.pricingConfig);
      }
      setHalls((refreshed.data?.halls || []).map((hall) => normalizeHall(hall)));
      showReservationSuccessPopup({
        title: "Hall deleted",
        eyebrow: "Hall Deleted",
        message: "hall has been deleted successfully.",
        customerName: hallDeleteTarget.name,
        hallName: `${hallDeleteTarget.capacity} guests capacity`,
        detail: `Rate ${formatINR(hallDeleteTarget.ratePerHour)} per hour`,
        subjectLabel: "Hall",
      });
      setHallDeleteTarget(null);
      setDetailHall(null);
      if (String(wizard.hallId) === String(hallDeleteTarget.id)) {
        setWizard((prev) => ({ ...prev, hallId: "" }));
      }
    } catch (error) {
      setHallFormError(
        error.response?.data?.message || "Unable to delete the banquet hall."
      );
    } finally {
      setIsDeletingHall(false);
    }
  };

  const handleMenuPriceChange = (packageId, value) => {
    setPricingConfig((prev) => ({
      ...prev,
      menuPackages: prev.menuPackages.map((pkg) =>
        pkg.id === packageId ? { ...pkg, perGuest: Number(value) || 0 } : pkg
      ),
    }));
  };

  const handleLightingPriceChange = (lightingId, value) => {
    setPricingConfig((prev) => ({
      ...prev,
      lightingOptions: prev.lightingOptions.map((option) =>
        option.id === lightingId
          ? { ...option, price: Number(value) || 0 }
          : option
      ),
    }));
  };

  const handleMealSectionPriceChange = (section, value) => {
    setPricingConfig((prev) => ({
      ...prev,
      mealSectionPrices: {
        ...prev.mealSectionPrices,
        [section]: Number(value) || 0,
      },
    }));
  };

  const renderQuickSectionModal = () => {
    if (!activeQuickSection) return null;

    if (activeQuickSection === "halls") {
      return (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[15px] font-black uppercase tracking-[0.24em] text-sky-500">
                Venue Options
              </p>
              <h3 className="mt-1 text-[32px] font-black text-blue-950 sm:text-[34px]">
                Banquet halls
              </h3>
            </div>
            <button
              type="button"
              onClick={openAddHallForm}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-800 to-sky-500 px-4 py-2.5 text-[17px] font-bold text-white shadow-[0_12px_28px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(37,99,235,0.38)]"
            >
              <FaPlus />
              Add Hall
            </button>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-[#E1E7F5] bg-white shadow-[0_20px_60px_rgba(15,40,90,0.08)]">
            {halls.length ? (
              <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left text-[17px]">
                <thead className="sticky top-0 z-10 bg-[linear-gradient(180deg,#f4f9ff_0%,#e8f2ff_100%)] text-[13px] sm:text-[14px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-4">Image</th>
                      <th className="px-4 py-4">Hall Name</th>
                      <th className="px-4 py-4">Capacity</th>
                      <th className="px-4 py-4">Rate / Hour</th>
                      <th className="px-4 py-4">Type</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHalls.map((hall) => {
                      const hallImage = resolveBanquetHallImage(hall.image);
                      const isSelected =
                        String(wizard.hallId) === String(hall.id);

                      return (
                        <tr
                          key={hall.id}
                          className={`border-t border-blue-50 transition-all duration-300 ${
                            isSelected ? "bg-blue-50/70" : "bg-white"
                          } hover:bg-blue-50/40`}
                        >
                          <td className="px-4 py-4 align-top">
                            <button
                              type="button"
                              onClick={() =>
                                setWizard((prev) => ({
                                  ...prev,
                                  hallId: hall.id,
                                }))
                              }
                              className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[18px] sm:rounded-[20px] border border-blue-100 bg-slate-50 shadow-sm transition-all duration-300 hover:border-blue-300 hover:shadow-[0_12px_30px_rgba(37,99,235,0.18)]"
                            >
                              {hallImage ? (
                                <img
                                  src={hallImage}
                                  alt={hall.name || "Banquet hall"}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#e3f0ff_0%,#eef6ff_50%,#dceeff_100%)] text-blue-700">
                                  <FaGlassCheers className="text-2xl" />
                                </div>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <button
                              type="button"
                              onClick={() =>
                                setWizard((prev) => ({
                                  ...prev,
                                  hallId: hall.id,
                                }))
                              }
                              className="text-left"
                            >
                              <div className="text-lg font-black text-blue-950 transition-all duration-300 hover:text-blue-700">
                                {hall.name || "Unnamed Hall"}
                              </div>
                            </button>
                            <p className="mt-1 max-w-[34ch] text-[13px] sm:text-[14px] leading-7 text-slate-500">
                              Elegant venue setup for weddings, celebrations,
                              conferences and premium social events.
                            </p>
                          </td>
                          <td className="px-4 py-4 align-top font-semibold text-slate-900">
                              {hall.capacity || 0}
                          </td>
                          <td className="px-4 py-4 align-top font-semibold text-slate-900">
                            {formatINR(hall.ratePerHour)}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-[15px] font-bold text-blue-700 shadow-[0_2px_8px_rgba(15,40,90,0.05)]">
                              {hall.is_ac ? "AC Hall" : "Non-AC Hall"}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-[15px] font-bold shadow-[0_2px_8px_rgba(15,40,90,0.05)] ${
                                hall.status === "Available"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : hall.status === "Maintenance"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {hall.status || "Available"}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setDetailHall(hall)}
                                className="rounded-[18px] border border-blue-200 bg-blue-50 px-3 py-1.5 text-[15px] font-bold text-blue-700 transition-all duration-300 hover:border-blue-300 hover:bg-blue-100 hover:shadow-sm"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditHall(hall)}
                                className="inline-flex items-center gap-1 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-[15px] font-bold text-amber-700 transition-all duration-300 hover:border-amber-300 hover:bg-amber-100 hover:shadow-sm"
                              >
                                <FaEdit />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteHall(hall)}
                                className="inline-flex items-center gap-1 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-1.5 text-[15px] font-bold text-rose-700 transition-all duration-300 hover:border-rose-300 hover:bg-rose-100 hover:shadow-sm"
                              >
                                <FaTrash />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 p-3 sm:p-4 lg:hidden">
                {paginatedHalls.map((hall) => {
                  const hallImage = resolveBanquetHallImage(hall.image);
                  const isSelected = String(wizard.hallId) === String(hall.id);

                  return (
                    <div
                      key={hall.id}
                      className={`rounded-[22px] border p-3 sm:p-4 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 ${
                        isSelected
                          ? "border-blue-300 bg-blue-50/70"
                          : "border-[#E1E7F5] bg-white"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <button
                          type="button"
                          onClick={() =>
                            setWizard((prev) => ({ ...prev, hallId: hall.id }))
                          }
                          className="mx-auto flex h-32 w-full max-w-[240px] shrink-0 items-center justify-center overflow-hidden rounded-[18px] sm:rounded-[20px] border border-blue-100 bg-slate-50 shadow-sm sm:mx-0 sm:h-20 sm:w-20 sm:max-w-none"
                        >
                          {hallImage ? (
                            <img
                              src={hallImage}
                              alt={hall.name || "Banquet hall"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#e3f0ff_0%,#eef6ff_50%,#dceeff_100%)] text-blue-700">
                              <FaGlassCheers className="text-3xl sm:text-xl" />
                            </div>
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() =>
                              setWizard((prev) => ({ ...prev, hallId: hall.id }))
                            }
                            className="text-left"
                          >
                            <div className="text-center text-[16px] font-black text-blue-950 sm:text-left sm:text-[17px]">
                              {hall.name || "Unnamed Hall"}
                            </div>
                          </button>
                          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                            <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[13px] font-bold text-blue-700">
                              {hall.is_ac ? "AC Hall" : "Non-AC Hall"}
                            </span>
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[13px] font-bold ${
                                hall.status === "Available"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : hall.status === "Maintenance"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {hall.status || "Available"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] text-slate-600 sm:text-[15px]">
                        <div>Capacity: <span className="font-bold text-slate-900">{hall.capacity || 0}</span></div>
                        <div>Rate: <span className="font-bold text-slate-900">{formatINR(hall.ratePerHour)}</span></div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailHall(hall)}
                          className="min-h-[40px] flex-1 rounded-[16px] border border-blue-200 bg-blue-50 px-3 py-2.5 text-[13px] sm:text-[14px] font-bold text-blue-700 sm:flex-none"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditHall(hall)}
                          className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1 rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] sm:text-[14px] font-bold text-amber-700 sm:flex-none"
                        >
                          <FaEdit />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHall(hall)}
                          className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1 rounded-[16px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] sm:text-[14px] font-bold text-rose-700 sm:flex-none"
                        >
                          <FaTrash />
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 p-8 text-center sm:p-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-500 sm:h-16 sm:w-16">
                  <FaGlassCheers className="text-xl sm:text-2xl" />
                </div>
                <div className="text-[15px] font-bold text-blue-950 sm:text-[17px]">No banquet hall yet</div>
                <div className="text-[13px] font-medium text-slate-500 sm:text-[15px]">
                  No banquet hall has been added yet. Create a new hall using Add Hall.
                </div>
              </div>
            )}
          </div>
          <PaginationControls
            page={hallPage}
            totalPages={totalHallPages}
            onChange={setHallPage}
            label="Halls"
            totalItems={halls.length}
            pageSize={hallsPerPage}
            pageSizeOptions={[2, 5, 10]}
            onPageSizeChange={(value) => {
              setHallsPerPage(value);
              setHallPage(1);
            }}
          />
        </div>
      );
    }

    if (activeQuickSection === "addons") {
      return (
        <div className="space-y-5">
          <div>
              <p className="text-[15px] font-black uppercase tracking-[0.24em] text-sky-500">
              Banquet Addons
            </p>
            <h3 className="mt-1 text-[30px] font-black text-blue-950">
              Addon pricing controls
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {pricingConfig.lightingOptions.map((option) => (
              <div
                key={option.id}
                className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(15,40,90,0.1)]"
              >
                <div className="text-[18px] font-black text-blue-950">
                  {option.label}
                </div>
                <div className="mt-3">
                  <label className={labelCls}>Lighting Price</label>
                  <input
                    type="number"
                    min="0"
                    value={option.price}
                    onChange={(e) =>
                      handleLightingPriceChange(option.id, e.target.value)
                    }
                    className={inputCls}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(15,40,90,0.1)]">
              <div className="text-[18px] font-black text-blue-950">
                Event support
              </div>
              <label className={`${labelCls} mt-4`}>Setup Price</label>
              <input
                type="number"
                min="0"
                value={pricingConfig.eventSupportFee}
                onChange={(e) =>
                  setPricingConfig((prev) => ({
                    ...prev,
                    eventSupportFee: Number(e.target.value) || 0,
                  }))
                }
                className={inputCls}
              />
            </div>
            <div className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(15,40,90,0.1)]">
              <div className="text-[18px] font-black text-blue-950">
                Decor and service
              </div>
              <label className={`${labelCls} mt-4`}>Decor Price</label>
              <input
                type="number"
                min="0"
                value={pricingConfig.decorServiceFee}
                onChange={(e) =>
                  setPricingConfig((prev) => ({
                    ...prev,
                    decorServiceFee: Number(e.target.value) || 0,
                  }))
                }
                className={inputCls}
              />
            </div>
          </div>
        </div>
      );
    }

    if (activeQuickSection === "meals") {
      return (
        <div className="  space-y-4">
          <div>
                <p className="text-[15px] font-bold uppercase tracking-[0.24em] text-sky-500">
              Event Dining
            </p>
              <h3 className="mt-1 text-[30px] font-black text-blue-950">
                Meal menu pricing
              </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {pricingConfig.menuPackages.map((menu) => (
              <div
                key={menu.id}
                className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(15,40,90,0.1)]"
              >
                <div className="text-[17px] font-black uppercase tracking-[0.14em] text-blue-700">
                  {menu.name}
                </div>
                <label className={`${labelCls} mt-4`}>Per Guest Price</label>
                <input
                  type="number"
                  min="0"
                  value={menu.perGuest}
                  onChange={(e) =>
                    handleMenuPriceChange(menu.id, e.target.value)
                  }
                  className={inputCls}
                />
                <p className="mt-4 text-[17px] text-slate-500">{menu.mealLabel}</p>
              </div>
            ))}
          </div>
          <div className="rounded-[28px] border border-[#E1E7F5] bg-blue-50/40 p-5">
            <div className="text-[18px] font-black text-blue-950">
              Meal section prices
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {mealSections.map((section) => (
                <div key={section} className="rounded-2xl bg-white p-4 shadow-[0_6px_18px_rgba(15,40,90,0.05)]">
                  <div className="text-[17px] font-bold text-slate-800">
                    {section}
                  </div>
                  <label className={`${labelCls} mt-3`}>Section Price</label>
                  <input
                    type="number"
                    min="0"
                    value={pricingConfig.mealSectionPrices[section] || 0}
                    onChange={(e) =>
                      handleMealSectionPriceChange(section, e.target.value)
                    }
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (activeQuickSection === "reservations") {
      return (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <p className="text-[15px] font-black uppercase tracking-[0.24em] text-sky-500">
                Reservation Dashboard
              </p>
              <h3 className="mt-1 text-[30px] font-black text-blue-950">
                Manage banquet reservations
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveQuickSection(null);
                openCreateReservationForm();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-800 to-sky-500 px-4 py-2.5 text-[17px] font-bold text-white shadow-[0_12px_28px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(37,99,235,0.38)]"
            >
              <FaPlus />
              Add New
            </button>
          </div>
          <div className="grid gap-4">
            {bookings.length ? (
              paginatedBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-[26px] border border-[#E1E7F5] bg-white p-4 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(15,40,90,0.1)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[17px] font-bold text-blue-950">
                        {booking.hallName}
                      </div>
                      <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                        {booking.customerName} |{" "}
                        {booking.eventTitle || booking.eventType}
                      </div>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-[15px] font-semibold text-blue-700">
                      {booking.status}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[13px] sm:text-[14px] text-slate-600 md:grid-cols-4">
                    <div>Date: {booking.date}</div>
                    <div>
                      Time: {booking.startTime} - {booking.endTime}
                    </div>
                    <div>Guests: {booking.guests}</div>
                    <div>Meal: {booking.mealSection || "Planned"}</div>
                    <div>Paid: {formatINR(booking.advance || 0)}</div>
                    <div>Refunded: {formatINR(booking.refundAmount || 0)}</div>
                    <div>Due: {formatINR(booking.balanceDue || 0)}</div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditBooking(booking)}
                      className="inline-flex items-center gap-2 rounded-[18px] border border-blue-100 bg-white px-3 py-2 text-[15px] font-bold text-slate-700 transition-all duration-300 hover:border-blue-300"
                    >
                      <FaEdit />
                      Edit
                    </button>
                    {booking.status === "Confirmed" ? (
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(booking)}
                        className="rounded-[18px] bg-rose-500 px-3 py-2 text-[15px] font-bold text-white transition-all duration-300 hover:bg-rose-600"
                      >
                        Cancel
                      </button>
                    ) : null}
                    {["Cancelled", "Refunded"].includes(booking.status) &&
                    Number(booking.advance || 0) >
                      Number(booking.refundAmount || 0) ? (
                      <button
                        type="button"
                        onClick={() => handleRefundBooking(booking)}
                        className="rounded-[18px] bg-violet-600 px-3 py-2 text-[15px] font-bold text-white transition-all duration-300 hover:bg-violet-700"
                      >
                        Refund
                      </button>
                    ) : null}
                    {booking.invoiceNo ? (
                      <button
                        type="button"
                        onClick={() => handleSendBanquetInvoiceWhatsApp(booking)}
                        className="inline-flex items-center gap-2 rounded-[18px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-[15px] font-bold text-emerald-700 transition-all duration-300 hover:border-emerald-300 hover:text-emerald-800"
                      >
                        <FaWhatsapp />
                        Send Invoice
                      </button>
                    ) : null}
                    {["Cancelled", "Refunded"].includes(booking.status) ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteBooking(booking)}
                        className="rounded-[18px] border border-rose-200 px-3 py-2 text-[15px] font-bold text-rose-600 transition-all duration-300 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[26px] border border-dashed border-blue-200 bg-blue-50/40 p-6 text-[17px] font-medium text-slate-500">
      No reservations are available. Create your first booking using 'Add New'.
              </div>
            )}
          </div>
          <PaginationControls
            page={bookingPage}
            totalPages={totalBookingPages}
            onChange={setBookingPage}
            label="Reservations"
            totalItems={filteredBookings.length}
            pageSize={bookingsPerPage}
          />
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div>
          <p className="text-[15px] font-black uppercase tracking-[0.24em] text-sky-500">
            Settlement Report
          </p>
          <h3 className="mt-1 text-[30px] font-black text-blue-950">
            Pricing and settlement preview
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {[
            { label: "Hall amount", value: formatINR(wizardTotals.hallCharge), icon: FaGlassCheers },
            { label: "Meal amount", value: formatINR(wizardTotals.mealCharge), icon: FaUtensils },
            {
              label: "Custom menu",
              value: formatINR(wizardTotals.customMenuCharge),
              icon: FaUtensils,
            },
            {
              label: "Lighting setup",
              value: formatINR(wizardTotals.lightingCharge),
              icon: FaLightbulb,
            },
            {
              label: "Event support",
              value: formatINR(wizardTotals.eventSupportCharge),
              icon: FaHeadset,
            },
            {
              label: "Estimated total",
              value: formatINR(wizardTotals.grandTotal),
              icon: FaReceipt,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
            <div
              key={item.label}
              className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(15,40,90,0.1)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Icon />
              </div>
                  <div className="mt-3 text-[13px] sm:text-[14px] font-black uppercase tracking-[0.14em] text-slate-500">
                {item.label}
              </div>
              <div className="mt-2 text-[30px] font-black text-blue-950">
                {item.value}
              </div>
            </div>
          );})}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)]">
            <div className="text-[18px] font-black text-blue-950">
              Global addon pricing
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className={labelCls}>Event Support Fee</label>
                <input
                  type="number"
                  min="0"
                  value={pricingConfig.eventSupportFee}
                  onChange={(e) =>
                    setPricingConfig((prev) => ({
                      ...prev,
                      eventSupportFee: Number(e.target.value) || 0,
                    }))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Decor Service Fee</label>
                <input
                  type="number"
                  min="0"
                  value={pricingConfig.decorServiceFee}
                  onChange={(e) =>
                    setPricingConfig((prev) => ({
                      ...prev,
                      decorServiceFee: Number(e.target.value) || 0,
                    }))
                  }
                  className={inputCls}
                />
              </div>
            </div>
          </div>
          <div className="rounded-[26px] border border-[#E1E7F5] bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)]">
            <div className="text-[18px] font-black text-blue-950">
              Menu package pricing
            </div>
            <div className="mt-4 space-y-4">
              {pricingConfig.menuPackages.map((pkg) => (
                <div key={pkg.id}>
                  <label className={labelCls}>{pkg.name}</label>
                  <input
                    type="number"
                    min="0"
                    value={pkg.perGuest}
                    onChange={(e) =>
                      handleMenuPriceChange(pkg.id, e.target.value)
                    }
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const activeGroupLabel = useMemo(
    () => BANQUET_NAV_GROUPS.find((g) => g.id === openNavGroup)?.label || "Overview",
    [openNavGroup]
  );

  const banqOverviewCards = [
    {
      label: "Total Events",
      value: String(bookings.length),
      icon: FaCalendarAlt,
      iconTone: "bg-[#0B4F48] text-white",
      valueTone: "text-[#0B4F48]",
      meta: "",
    },
    {
      label: "Confirmed",
      value: String(bookings.filter((b) => b.status === "Confirmed").length),
      icon: FaCheckCircle,
      iconTone: "bg-[#0F6E64] text-white",
      valueTone: "text-[#0F6E64]",
      meta: "",
    },
    {
      label: "Billed",
      value: String(bookings.filter((b) => b.invoiceNo).length),
      icon: FaReceipt,
      iconTone: "bg-[#C8791A] text-white",
      valueTone: "text-[#C8791A]",
      meta: "",
    },
    {
      label: "Available Halls",
      value: `${halls.filter((h) => h.status === "Available").length}/${halls.length || 0}`,
      icon: FaUsers,
      iconTone: "bg-[#1E7A6E] text-white",
      valueTone: "text-[#1E7A6E]",
      meta: "Venue ready",
    },
  ];

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        weekday: "long",
      }).format(new Date()),
    []
  );

  const hallAvailabilityList = useMemo(() => halls.slice(0, 4), [halls]);

  const getScheduleStatusLabel = (booking) => {
    if (booking.status === "Completed") return "Completed";
    if (booking.status === "Cancelled") return "Cancelled";
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = String(booking.startTime || "0:0").split(":").map(Number);
    const [endH, endM] = String(booking.endTime || "0:0").split(":").map(Number);
    const startMinutes = (startH || 0) * 60 + (startM || 0);
    const endMinutes = (endH || 0) * 60 + (endM || 0);
    if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) return "In Progress";
    if (nowMinutes > endMinutes) return "Wrapping Up";
    return "Upcoming";
  };

  const getScheduleStatusTone = (label) => {
    switch (label) {
      case "In Progress":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "Completed":
        return "border-blue-200 bg-blue-50 text-blue-700";
      case "Cancelled":
        return "border-rose-200 bg-rose-50 text-rose-700";
      default:
        return "border-blue-200 bg-blue-50 text-blue-700";
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[linear-gradient(180deg,#F2F6FF_0%,#F7F9FE_40%,#FFFFFF_100%)] p-3 sm:p-6">
      <div className="space-y-6">
        {/* Header / Hero */}
        <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-b from-blue-950 via-blue-800 to-sky-500 p-4 shadow-[0_20px_60px_rgba(15,40,90,0.25)] sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-white sm:text-[36px]">Banquet Dashboard</h1>
              <p className="mt-1 text-[15px] sm:text-[20px] text-white/80">
                Manage banquet halls, events, reservations and more
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex h-12 w-full items-center gap-2 rounded-[18px] sm:rounded-[20px] border border-white/30 bg-white px-3 shadow-[0_8px_20px_rgba(15,40,90,0.15)] transition-all duration-300 focus-within:border-sky-300 focus-within:shadow-[0_8px_24px_rgba(37,99,235,0.2)] hover:shadow-[0_10px_26px_rgba(15,40,90,0.2)] sm:h-14 sm:w-auto sm:min-w-[220px] sm:px-4">
                <FaSearch className="text-blue-300" size={14} />
                <input
                  value={dashboardSearch}
                  onChange={(e) => setDashboardSearch(e.target.value)}
                  placeholder="Quick search reservations, halls..."
                  className="w-full bg-transparent text-[14px] font-medium text-[#0B1B33] outline-none placeholder:text-slate-400 sm:text-[16px]"
                />
              </div>
              <div className="flex h-12 items-center gap-2 rounded-[18px] border border-white/30 bg-white px-3 sm:h-14 sm:px-4">
                <FaCalendarAlt className="text-blue-600" size={14} />
                <span className="text-[13px] font-semibold text-[#0B1B33] sm:text-[15px]">{todayLabel}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Stat cards */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {dashboardStatCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="group relative overflow-hidden rounded-[22px] sm:rounded-[26px] border border-[#E1E7F5] bg-white p-3 shadow-[0_10px_28px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_38px_rgba(15,40,90,0.12)] sm:p-4"
              >
                <span className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-blue-50/70 transition-all duration-300 group-hover:scale-125" />
                <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-[12px] text-white shadow-[0_8px_18px_rgba(15,40,90,0.18)] sm:h-11 sm:w-11 sm:rounded-[14px] ${card.iconTone}`}>
                  <Icon size={14} className="sm:hidden" />
                  <Icon size={16} className="hidden sm:block" />
                </span>
                <div className="relative mt-2 text-[14px] font-medium text-[#64748B] sm:text-[17px]">{card.label}</div>
                <div className="relative mt-1 text-[18px] font-bold text-[#0B1B33] leading-tight sm:text-[22px] lg:text-[24px]">
                  {card.value}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveQuickSection(card.sectionId)}
                  className="relative mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F6FE4] transition-all duration-300 hover:text-[#0B4F9C] sm:mt-2 sm:text-[15px]"
                >
                  View Details <FaChevronRight size={8} className="sm:hidden" /><FaChevronRight size={9} className="hidden sm:block" />
                </button>
              </div>
            );
          })}
        </section>

        {activeQuickSection ? (
          <section className="rounded-[30px] border border-[#E1E7F5] bg-white p-4 shadow-[0_16px_44px_rgba(15,40,90,0.08)] sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveQuickSection(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#E1E7F5] text-[#0B1B33] transition-all duration-300 hover:bg-blue-50 hover:border-blue-200"
                >
                  <FaArrowLeft size={13} />
                </button>
                <div>
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#64748B]">Section</p>
                  <h2 className="mt-0.5 text-[30px] font-bold text-[#0B1B33] sm:text-[32px] md:text-[34px]">
                    {BANQUET_SECTIONS.find((s) => s.id === activeQuickSection)?.label || "Quick View"}
                  </h2>
                </div>
              </div>
              <button type="button" onClick={() => setActiveQuickSection(null)} className={banquteGhostBtn}>
                Close
              </button>
            </div>
            {renderQuickSectionModal()}
          </section>
        ) : (
          <>
            {/* All sections */}
            <section>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-[26px] font-bold text-[#0B1B33] sm:text-[30px]">All Sections</h2>
                <button
                  type="button"
                  onClick={openCreateReservationForm}
                  className={banqutePrimaryBtn}
                >
                  <FaPlus className="text-sm" />
                  Book Now
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {BANQUET_SECTIONS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveQuickSection(item.id)}
                      className="group flex items-start gap-3 rounded-[18px] sm:rounded-[20px] sm:rounded-[24px] border border-[#E1E7F5] bg-white p-3 text-left shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 hover:-translate-y-1 hover:border-[#2F6FE4] hover:shadow-[0_16px_34px_rgba(37,99,235,0.14)] sm:p-4"
                    >
                      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-white shadow-[0_8px_18px_rgba(15,40,90,0.16)] sm:h-11 sm:w-11 sm:rounded-[14px] ${sectionIconTones[item.id] || "bg-[#0F6E64]"}`}>
                        <Icon size={15} className="sm:hidden" />
                        <Icon size={17} className="hidden sm:block" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[18px] font-bold text-[#0B1B33] sm:text-[22px]">{item.label}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-[#64748B] sm:text-[17px]">{item.desc}</span>
                      </span>
                      <FaChevronRight size={10} className="mt-1 shrink-0 text-[#CBD5F0] transition-all duration-300 group-hover:translate-x-1 group-hover:text-blue-400 sm:hidden" />
                      <FaChevronRight size={12} className="mt-1.5 hidden shrink-0 text-[#CBD5F0] transition-all duration-300 group-hover:translate-x-1 group-hover:text-blue-400 sm:block" />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Schedule + recent reservations */}
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[28px] border border-[#E1E7F5] bg-white p-4 shadow-[0_10px_30px_rgba(15,40,90,0.06)] sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[17px] font-bold text-[#0B1B33]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue-50 text-[#2F6FE4]">
                      <FaCalendarAlt size={13} />
                    </span>
                    Today's Schedule
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveQuickSection("reservations")}
                    className="text-[15px] font-semibold text-[#2F6FE4] transition-all duration-300 hover:text-[#0B4F9C]"
                  >
                    View All
                  </button>
                </div>
                <div className="space-y-2.5">
                  {todaysBookings.length ? (
                    todaysBookings.map((booking) => {
                      const statusLabel = getScheduleStatusLabel(booking);
                      return (
                        <div
                          key={booking.id}
                          className="flex items-center gap-3 rounded-[18px] border border-[#EEF2FB] bg-[#F8FAFF] px-3 py-2.5 transition-all duration-300 hover:bg-blue-50/60"
                        >
                          <span className="flex h-9 w-16 shrink-0 items-center justify-center gap-1 rounded-[12px] bg-white text-[14px] font-bold text-[#0B1B33] shadow-sm">
                            <FaRegClock size={10} className="text-[#64748B]" />
                            {booking.startTime || "--:--"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] sm:text-[14px] font-bold text-[#0B1B33]">
                              {booking.hallName || "Hall"}
                            </div>
                            <div className="truncate text-[13px] sm:text-[14px] text-[#64748B]">
                              {booking.eventTitle || booking.eventType}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-[14px] font-bold uppercase tracking-wide ${getScheduleStatusTone(statusLabel)}`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center gap-2 rounded-[18px] border border-dashed border-[#DCE4F7] bg-[#F8FAFF] px-4 py-7 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-blue-400 shadow-sm">
                        <FaCalendarAlt size={16} />
                      </span>
                      <span className="text-[13px] font-medium text-[#64748B]">No events scheduled for today.</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 border-t border-[#EEF2FB] pt-3 text-[12.5px] font-semibold text-[#64748B]">
                  Total Events Today: {todaysBookings.length}
                </div>
              </div>

              <div className="rounded-[28px] border border-[#E1E7F5] bg-white p-4 shadow-[0_10px_30px_rgba(15,40,90,0.06)] sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[17px] font-bold text-[#0B1B33]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-sky-50 text-[#2F6FE4]">
                      <FaReceipt size={13} />
                    </span>
                    Recent Reservations
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveQuickSection("reservations")}
                    className="text-[15px] font-semibold text-[#2F6FE4] transition-all duration-300 hover:text-[#0B4F9C]"
                  >
                    View All
                  </button>
                </div>
                <div className="space-y-2.5">
                  {recentBookings.length ? (
                    recentBookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="flex items-center gap-3 rounded-[18px] border border-[#EEF2FB] bg-[#F8FAFF] px-3 py-2.5 transition-all duration-300 hover:bg-blue-50/60"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#2F6FE4]/10 text-[#2F6FE4]">
                          <FaCalendarAlt size={13} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] sm:text-[14px] font-bold text-[#0B1B33]">
                            {booking.customerName}
                          </div>
                          <div className="truncate text-[13px] sm:text-[14px] text-[#64748B]">
                            {booking.hallName || "Hall"} • {booking.guests || 0} Guests
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[12px] text-[#64748B]">{formatBookingDate(booking.date)}</div>
                          <div className="text-[13.5px] font-bold text-[#0B1B33]">
                            {formatINR(booking.grandTotal || 0)}
                          </div>
                          <span
                            className={`inline-block text-[10.5px] font-bold ${
                              booking.status === "Confirmed"
                                ? "text-emerald-600"
                                : booking.status === "Cancelled"
                                ? "text-rose-600"
                                : "text-amber-600"
                            }`}
                          >
                            {booking.status}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center gap-2 rounded-[18px] border border-dashed border-[#DCE4F7] bg-[#F8FAFF] px-4 py-7 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-blue-400 shadow-sm">
                        <FaReceipt size={16} />
                      </span>
                      <span className="text-[13px] font-medium text-[#64748B]">No reservations yet.</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 border-t border-[#EEF2FB] pt-3 text-[12.5px] font-semibold text-[#64748B]">
                  Total Reservations: {bookings.length}
                </div>
              </div>
            </section>

            {/* Hall availability + revenue overview */}
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[28px] border border-[#E1E7F5] bg-white p-4 shadow-[0_10px_30px_rgba(15,40,90,0.06)] sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[17px] font-bold text-[#0B1B33]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
                      <FaGlassCheers size={13} />
                    </span>
                    Hall Availability Overview
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveQuickSection("halls")}
                    className="text-[15px] font-semibold text-[#2F6FE4] transition-all duration-300 hover:text-[#0B4F9C]"
                  >
                    View Calendar
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {hallAvailabilityList.length ? (
                    hallAvailabilityList.map((hall) => (
                      <div
                        key={hall.id}
                        className="rounded-[18px] border border-[#EEF2FB] bg-[#F8FAFF] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,40,90,0.08)]"
                      >
                        <div className="truncate text-[13px] font-bold text-[#0B1B33]">{hall.name}</div>
                        <div
                          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            hall.status === "Available"
                              ? "bg-emerald-50 text-emerald-600"
                              : hall.status === "Maintenance"
                              ? "bg-rose-50 text-rose-600"
                              : "bg-amber-50 text-amber-600"
                          }`}
                        >
                          {hall.status || "Available"}
                        </div>
                        <div className="mt-1.5 text-[11.5px] text-[#64748B]">
                          {hall.capacity || 0} Capacity
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-full rounded-[18px] border border-dashed border-[#DCE4F7] bg-[#F8FAFF] px-4 py-6 text-center text-[13px] text-[#64748B]">
                      No halls added yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-[#E1E7F5] bg-white p-4 shadow-[0_10px_30px_rgba(15,40,90,0.06)] sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[17px] font-bold text-[#0B1B33]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-700">
                      <FaMoneyCheckAlt size={13} />
                    </span>
                    Revenue Overview
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveQuickSection("settlement")}
                    className="text-[15px] font-semibold text-[#2F6FE4] transition-all duration-300 hover:text-[#0B4F9C]"
                  >
                    This Month
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="rounded-[18px] border border-[#EEF2FB] bg-[#F8FAFF] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,40,90,0.08)]">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-100 text-emerald-700">
                      <FaMoneyCheckAlt size={13} />
                    </span>
                    <div className="mt-2 text-[15px] text-[#64748B]">Total Revenue</div>
                    <div className="text-[17px] font-bold text-[#0B1B33]">
                      {formatINR(dashboardRevenue.totalRevenue)}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-[#EEF2FB] bg-[#F8FAFF] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,40,90,0.08)]">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue-100 text-blue-700">
                      <FaReceipt size={13} />
                    </span>
                    <div className="mt-2 text-[12px] text-[#64748B]">Advance Received</div>
                    <div className="text-[15px] font-bold text-[#0B1B33]">
                      {formatINR(dashboardRevenue.advanceReceived)}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-[#EEF2FB] bg-[#F8FAFF] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,40,90,0.08)]">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-rose-100 text-rose-700">
                      <FaExclamationTriangle size={13} />
                    </span>
                    <div className="mt-2 text-[12px] text-[#64748B]">Pending Amount</div>
                    <div className="text-[15px] font-bold text-[#0B1B33]">
                      {formatINR(dashboardRevenue.pendingAmount)}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        <section
          id="reservation-section"
          className="rounded-[30px] border border-[#E1E7F5] bg-white p-4 shadow-[0_16px_44px_rgba(15,40,90,0.08)] sm:p-6"
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[30px] font-bold text-[#0B1B33] sm:text-[32px] md:text-[34px]">All Reservations</h2>
              <p className="mt-1 text-[17px] sm:text-[18px] text-[#94A3C4]">
                Showing {paginatedBookings.length} of {filteredBookings.length} reservations
                {hasAppliedBookingFilters ? " (filtered)" : ""}.
              </p>
            </div>
            <button type="button" onClick={openCreateReservationForm} className={banqutePrimaryBtn}>
              <FaPlus className="text-sm" />
              Add New
            </button>
          </div>
          <div className="hidden overflow-x-auto rounded-[28px] border border-[#E1E7F5] md:block">
            {filteredBookings.length ? (
              <table className="min-w-full overflow-hidden bg-white">
                <thead className="sticky top-0 z-10 bg-[linear-gradient(180deg,#f4f9ff_0%,#e8f1ff_100%)] text-left text-[13px] sm:text-[14px] uppercase tracking-[0.12em] text-[#64748B]">
                  <tr>
                    <th className="px-3 py-4 text-[#64748B]">Guest</th>
                    <th className="px-3 py-4 text-[#64748B]">Event</th>
                    <th className="px-3 py-4 text-[#64748B]">Hall</th>
                    <th className="px-3 py-4 text-[#64748B]">Slot</th>
                    <th className="px-3 py-4 text-[#64748B]">Payment</th>
                    <th className="px-3 py-4 text-[#64748B]">Status</th>
                    <th className="px-3 py-4 text-[#64748B]">Menu</th>
                    <th className="px-3 py-4 text-[#64748B]">Invoice</th>
                    <th className="px-3 py-4 text-[#64748B]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedBookings.map((booking) => {
                    const customItemsCount =
                      (booking.selectedRestaurantMenuItems?.length || 0) +
                      (booking.manualCustomMenuItems?.length || 0) +
                      (booking.selectedCustomMenuItems?.length || 0);

                    return (
                      <tr
                        key={booking.id}
                        className="border-t border-blue-50 align-top transition-all duration-300 hover:bg-blue-50/50"
                      >
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-bold text-blue-950">
                            {booking.customerName}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                            {booking.guestEmail || booking.phone || "Contact pending"}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-semibold text-blue-950">
                            {booking.eventTitle || booking.eventType}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                            {booking.eventType || "Event"} • {booking.guests || 0} guests
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-semibold text-blue-950">
                            {booking.hallName || "Hall pending"}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                            {lightingLabelMap[booking.lightingSystem] ||
                              booking.lightingSystem ||
                              "Lighting pending"}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-semibold text-blue-950">
                            {formatBookingDate(booking.date)}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                            {booking.startTime || "--"} - {booking.endTime || "--"}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-semibold text-blue-950">
                            {formatINR(booking.grandTotal || 0)}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-emerald-700">
                            Received {formatINR(booking.netReceived || 0)}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-rose-600">
                            Due {formatINR(booking.balanceDue || 0)}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-2">
                            <span className={getReservationStatusBadgeClass(booking.status)}>
                              {booking.status}
                            </span>
                            <div>
                              <span className={getPaymentStatusBadgeClass(booking.paymentStatus)}>
                                {booking.paymentStatus || "Pending"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-semibold text-blue-950">
                            {menuPackageNameMap[booking.menuPackageId] || "Custom package"}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                            {booking.mealSection || "Meal section pending"}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-blue-700">
                            {customItemsCount} custom selections
                          </div>
                        </td>
                        <td className="px-4 py-4 text-[17px] text-slate-700">
                          <div className="font-semibold text-blue-950">
                            {booking.invoiceNo || "Draft only"}
                          </div>
                          <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                            {booking.paymentMode || "Pending"}
                          </div>
                          {booking.paymentReferenceId ? (
                            <div className="mt-1 text-[13px] sm:text-[14px] text-slate-400">
                              Ref {booking.paymentReferenceId}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-[260px] flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditBooking(booking)}
                              className="inline-flex min-h-[44px] items-center gap-2 rounded-[18px] border border-blue-100 bg-white px-3 py-2 text-[17px] font-bold text-slate-700 transition-all duration-300 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm"
                            >
                              <FaEdit />
                              Edit
                            </button>
                            {booking.status === "Confirmed" ? (
                              <button
                                type="button"
                                onClick={() => handleCancelBooking(booking)}
                                className="min-h-[44px] rounded-[18px] bg-rose-500 px-3 py-2 text-[17px] font-bold text-white transition-all duration-300 hover:bg-rose-600 hover:shadow-sm"
                              >
                                Cancel
                              </button>
                            ) : null}
                            {booking.status === "Confirmed" ? (
                              <button
                                type="button"
                                onClick={() => handleCompleteBooking(booking.id)}
                                className="min-h-[44px] rounded-[18px] bg-amber-500 px-3 py-2 text-[17px] font-bold text-white transition-all duration-300 hover:bg-amber-600 hover:shadow-sm"
                              >
                                Complete
                              </button>
                            ) : null}
                            {["Completed", "Confirmed"].includes(booking.status) ? (
                              <button
                                type="button"
                                onClick={() => handleGenerateBill(booking)}
                                className="min-h-[44px] rounded-[18px] bg-emerald-600 px-3 py-2 text-[17px] font-bold text-white transition-all duration-300 hover:bg-emerald-700 hover:shadow-sm"
                              >
                                Bill
                              </button>
                            ) : null}
                            {booking.invoiceNo ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBooking(booking);
                                  setShowBill(true);
                                }}
                                className="min-h-[44px] rounded-[18px] border border-blue-100 bg-white px-3 py-2 text-[17px] font-bold text-slate-700 transition-all duration-300 hover:border-sky-300 hover:text-sky-700 hover:shadow-sm"
                              >
                                View
                              </button>
                            ) : null}
                            {booking.invoiceNo ? (
                              <button
                                type="button"
                                onClick={() => handleSendBanquetInvoiceWhatsApp(booking)}
                                className="inline-flex min-h-[44px] items-center gap-2 rounded-[18px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-[17px] font-bold text-emerald-700 transition-all duration-300 hover:border-emerald-300 hover:text-emerald-800 hover:shadow-sm"
                              >
                                <FaWhatsapp />
                                Send Invoice
                              </button>
                            ) : null}
                            {["Cancelled", "Refunded"].includes(booking.status) &&
                            Number(booking.advance || 0) >
                              Number(booking.refundAmount || 0) ? (
                              <button
                                type="button"
                                onClick={() => handleRefundBooking(booking)}
                                className="min-h-[44px] rounded-[18px] bg-violet-600 px-3 py-2 text-[17px] font-bold text-white transition-all duration-300 hover:bg-violet-700 hover:shadow-sm"
                              >
                                Refund
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleSendQuotation(booking, "email")}
                              className="inline-flex min-h-[44px] items-center gap-2 rounded-[18px] border border-blue-100 bg-white px-3 py-2 text-[17px] font-bold text-slate-700 transition-all duration-300 hover:border-sky-300 hover:text-sky-700 hover:shadow-sm"
                            >
                              <FaEnvelope />
                              Email
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSendQuotation(booking, "whatsapp")}
                              className="inline-flex min-h-[44px] items-center gap-2 rounded-[18px] border border-blue-100 bg-white px-3 py-2 text-[17px] font-bold text-slate-700 transition-all duration-300 hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm"
                            >
                              <FaWhatsapp />
                              WhatsApp
                            </button>
                            {["Cancelled", "Refunded"].includes(booking.status) ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteBooking(booking)}
                      className="min-h-[44px] rounded-[18px] border border-rose-200 bg-white px-3 py-2 text-[17px] font-bold text-rose-600 transition-all duration-300 hover:bg-rose-50 hover:shadow-sm"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="rounded-[28px] border border-dashed border-blue-200 bg-blue-50/30 p-6 text-[14px] text-slate-500 sm:text-[17px]">
                {hasAppliedBookingFilters
                  ? "Current filters ke saath koi reservation match nahi hua."
                  : "No reservations are available. Create your first booking using ‘Add New."}
              </div>
            )}
          </div>

          {filteredBookings.length ? (
            <div className="mt-4">
              <PaginationControls
                page={bookingPage}
                totalPages={totalBookingPages}
                onChange={setBookingPage}
                label="Reservations"
                totalItems={filteredBookings.length}
                pageSize={bookingsPerPage}
              />
            </div>
          ) : null}

          <div className="grid gap-4 md:hidden">
            {filteredBookings.length ? (
              paginatedBookings.map((booking) => {
                const customItemsCount =
                  (booking.selectedRestaurantMenuItems?.length || 0) +
                  (booking.manualCustomMenuItems?.length || 0) +
                  (booking.selectedCustomMenuItems?.length || 0);

                return (
                  <div
                    key={booking.id}
                    className="rounded-[22px] border border-[#E1E7F5] bg-white p-3 shadow-[0_8px_24px_rgba(15,40,90,0.06)] transition-all duration-300 sm:rounded-[24px] sm:p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[16px] font-bold text-blue-950 sm:text-[18px]">
                          {booking.customerName}
                        </div>
                        <div className="mt-1 text-[13px] text-slate-500 sm:text-[15px]">
                          {booking.eventTitle || booking.eventType} • {booking.hallName}
                        </div>
                      </div>
                      <span className={getReservationStatusBadgeClass(booking.status).replace(/text-\[15px\]/g, 'text-[12px]').replace(/sm:text-\[16px\]/g, 'sm:text-[14px]')}>
                        {booking.status}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Event:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.eventTitle || booking.eventType || "N/A"}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Hall:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.hallName || "N/A"}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Date:</span>
                        <span className="font-bold text-blue-950 text-right">{formatBookingDate(booking.date)}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Slot:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.startTime || "--"} - {booking.endTime || "--"}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Guests:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.guests || 0}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Payment:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.paymentStatus || "Pending"}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Total:</span>
                        <span className="font-bold text-blue-950 text-right">{formatINR(booking.grandTotal || 0)}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Received:</span>
                        <span className="font-bold text-emerald-700 text-right">{formatINR(booking.netReceived || 0)}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Balance Due:</span>
                        <span className="font-bold text-rose-600 text-right">{formatINR(booking.balanceDue || 0)}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Package:</span>
                        <span className="font-bold text-blue-950 text-right">{menuPackageNameMap[booking.menuPackageId] || "Custom"}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Custom Items:</span>
                        <span className="font-bold text-blue-950 text-right">{customItemsCount}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Invoice:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.invoiceNo || "Draft only"}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-slate-500">Payment Mode:</span>
                        <span className="font-bold text-blue-950 text-right">{booking.paymentMode || "Pending"}</span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditBooking(booking)}
                        className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[16px] border border-blue-100 bg-white px-2 py-2 text-[13px] font-bold text-slate-700 transition-all duration-300 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm sm:text-[15px]"
                      >
                        <FaEdit /> Edit
                      </button>
                      {booking.status === "Confirmed" ? (
                        <button
                          type="button"
                          onClick={() => handleCancelBooking(booking)}
                          className="min-h-[40px] rounded-[16px] bg-rose-500 px-2 py-2 text-[13px] font-bold text-white transition-all duration-300 hover:bg-rose-600 hover:shadow-sm sm:text-[15px]"
                        >
                          Cancel
                        </button>
                      ) : null}
                      {booking.status === "Confirmed" ? (
                        <button
                          type="button"
                          onClick={() => handleCompleteBooking(booking.id)}
                          className="min-h-[40px] rounded-[16px] bg-amber-500 px-2 py-2 text-[13px] font-bold text-white transition-all duration-300 hover:bg-amber-600 hover:shadow-sm sm:text-[15px]"
                        >
                          Complete
                        </button>
                      ) : null}
                      {["Completed", "Confirmed"].includes(booking.status) ? (
                        <button
                          type="button"
                          onClick={() => handleGenerateBill(booking)}
                          className="min-h-[40px] rounded-[16px] bg-emerald-600 px-2 py-2 text-[13px] font-bold text-white transition-all duration-300 hover:bg-emerald-700 hover:shadow-sm sm:text-[15px]"
                        >
                          Bill
                        </button>
                      ) : null}
                      {booking.invoiceNo ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBooking(booking);
                            setShowBill(true);
                          }}
                          className="min-h-[40px] rounded-[16px] border border-blue-100 bg-white px-2 py-2 text-[13px] font-bold text-slate-700 transition-all duration-300 hover:border-sky-300 hover:text-sky-700 hover:shadow-sm sm:text-[15px]"
                        >
                          View
                        </button>
                      ) : null}
                      {booking.invoiceNo ? (
                        <button
                          type="button"
                          onClick={() => handleSendBanquetInvoiceWhatsApp(booking)}
                          className="min-h-[40px] rounded-[16px] border border-emerald-100 bg-emerald-50 px-2 py-2 text-[13px] font-bold text-emerald-700 transition-all duration-300 hover:border-emerald-300 hover:text-emerald-800 hover:shadow-sm sm:text-[15px]"
                          title="Send Invoice via WhatsApp"
                        >
                          <FaWhatsapp />
                        </button>
                      ) : null}
                      {["Cancelled", "Refunded"].includes(booking.status) &&
                      Number(booking.advance || 0) >
                        Number(booking.refundAmount || 0) ? (
                        <button
                          type="button"
                          onClick={() => handleRefundBooking(booking)}
                          className="min-h-[40px] rounded-[16px] bg-violet-600 px-2 py-2 text-[13px] font-bold text-white transition-all duration-300 hover:bg-violet-700 hover:shadow-sm sm:text-[15px]"
                        >
                          Refund
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleSendQuotation(booking, "email")}
                        className="min-h-[40px] rounded-[16px] border border-blue-100 bg-white px-2 py-2 text-[13px] font-bold text-slate-700 transition-all duration-300 hover:border-sky-300 hover:text-sky-700 hover:shadow-sm sm:text-[15px]"
                      >
                        <FaEnvelope />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendQuotation(booking, "whatsapp")}
                        className="min-h-[40px] rounded-[16px] border border-blue-100 bg-white px-2 py-2 text-[13px] font-bold text-slate-700 transition-all duration-300 hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm sm:text-[15px]"
                      >
                        <FaWhatsapp />
                      </button>
                      {["Cancelled", "Refunded"].includes(booking.status) ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteBooking(booking)}
                          className="min-h-[40px] rounded-[16px] border border-rose-200 bg-white px-2 py-2 text-[13px] font-bold text-rose-600 transition-all duration-300 hover:bg-rose-50 hover:shadow-sm sm:text-[15px]"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[22px] border border-dashed border-blue-200 bg-blue-50/30 p-5 text-[14px] text-slate-500 sm:rounded-[24px] sm:p-6 sm:text-[16px]">
                {hasAppliedBookingFilters
                  ? "Current filters ke saath koi reservation match nahi hua."
                  : "Koi reservation available nahi hai. `Add New` se pehli booking create kijiye."}
              </div>
            )}
          </div>
        </section>
      </div>

      {delayedShowReservationForm && (
        <ModalShell
          title={
            editingBookingId
              ? "Edit banquet reservation"
              : "Add banquet reservation"
          }
          eyebrow="Reservation Form"
          onClose={resetWizard}
          widthClass="max-w-7xl"
          heightClass="h-[min(98vh,820px)]"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_340px]">
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Banquet Hall</label>
                    <select
                      value={wizard.hallId}
                      onChange={(e) =>
                        setWizard((prev) => ({ ...prev, hallId: e.target.value }))
                      }
                      className={inputCls}
                    >
                      <option value="">Select hall</option>
                      {halls.map((hall) => (
                        <option key={hall.id} value={hall.id}>
                          {hall.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Event Type</label>
                    <select
                      value={wizard.eventType}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          eventType: e.target.value,
                        }))
                      }
                      className={inputCls}
                    >
                      <option>Wedding</option>
                      <option>Engagement</option>
                      <option>Birthday</option>
                      <option>Corporate</option>
                      <option>Reception</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Guest Name</label>
                    <input
                      value={wizard.customerName}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          customerName: e.target.value,
                        }))
                      }
                      className={inputCls}
                      placeholder="Enter guest name"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Event Title</label>
                    <input
                      value={wizard.eventTitle}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          eventTitle: e.target.value,
                        }))
                      }
                      className={inputCls}
                      placeholder="Sangeet Night, Corporate Meet..."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Phone / WhatsApp</label>
                    <input
                      value={wizard.phone}
                      onChange={(e) =>
                        setWizard((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      className={inputCls}
                      placeholder="Enter mobile number"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Guest Email</label>
                    <input
                      type="email"
                      value={wizard.guestEmail}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          guestEmail: e.target.value,
                        }))
                      }
                      className={inputCls}
                      placeholder="guest@email.com"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Date</label>
                    <input
                      type="date"
                      value={wizard.date}
                      onChange={(e) =>
                        setWizard((prev) => ({ ...prev, date: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Guests</label>
                    <input
                      type="number"
                      min="1"
                      value={wizard.guests}
                      onChange={(e) =>
                        setWizard((prev) => ({ ...prev, guests: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Start Time</label>
                    <input
                      type="time"
                      value={wizard.startTime}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          startTime: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>End Time</label>
                    <input
                      type="time"
                      value={wizard.endTime}
                      onChange={(e) =>
                        setWizard((prev) => ({ ...prev, endTime: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Menu Package</label>
                    <select
                      value={wizard.menuPackageId}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          menuPackageId: e.target.value,
                        }))
                      }
                      className={inputCls}
                    >
                      {pricingConfig.menuPackages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.name} - {formatINR(pkg.perGuest)}/guest
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Meal Section</label>
                    <select
                      value={wizard.mealSection}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          mealSection: e.target.value,
                        }))
                      }
                      className={inputCls}
                    >
                      {mealSections.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Lighting System</label>
                    <select
                      value={wizard.lightingSystem}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          lightingSystem: e.target.value,
                        }))
                      }
                      className={inputCls}
                    >
                      {pricingConfig.lightingOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label} - {formatINR(option.price)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Event Support Fee</label>
                    <input
                      type="number"
                      min="0"
                      value={wizard.eventSupportFee}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          eventSupportFee: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Decoration Fee</label>
                    <input
                      type="number"
                      min="0"
                      value={wizard.decorationFee}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          decorationFee: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Discount</label>
                    <input
                      type="number"
                      min="0"
                      value={wizard.discount}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          discount: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>GST %</label>
                    <input
                      type="number"
                      min="0"
                      value={wizard.gstPercent}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          gstPercent: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Payment Received</label>
                    <input
                      type="number"
                      min="0"
                      value={wizard.advance}
                      onChange={(e) =>
                        setWizard((prev) => ({
                          ...prev,
                          advance: e.target.value,
                        }))
                      }
                      className={inputCls}
                      placeholder="Kitna payment mila hai"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 sm:col-span-2">
                    <div>
                      <label className={labelCls}>Payment Mode</label>
                      <select
                        value={wizard.paymentMode}
                        onChange={(e) =>
                          setWizard((prev) => ({
                            ...prev,
                            paymentMode: e.target.value,
                          }))
                        }
                        className={inputCls}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Cash">Cash</option>
                        <option value="UPI">UPI</option>
                        <option value="Card">Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Cheque">Cheque</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Payment Reference ID</label>
                      <input
                        value={wizard.paymentReferenceId}
                        onChange={(e) =>
                          setWizard((prev) => ({
                            ...prev,
                            paymentReferenceId: e.target.value,
                          }))
                        }
                        className={inputCls}
                        placeholder="UTR / Txn ID / Reference"
                      />
                    </div>
                  </div>
                  {editingBookingId ? (
                    <div>
                      <label className={labelCls}>Payment Refund</label>
                      <input
                        type="number"
                        min="0"
                        max={wizard.advance || 0}
                        value={wizard.refundAmount}
                        onChange={(e) =>
                          setWizard((prev) => ({
                            ...prev,
                            refundAmount: e.target.value,
                          }))
                        }
                        className={inputCls}
                        placeholder="Kitna refund kiya hai"
                      />
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className={labelCls}>Payment Receipt</label>
                  <div className="space-y-3 rounded-[24px] border border-blue-100 bg-white p-4 shadow-[0_6px_18px_rgba(15,40,90,0.05)]">
                    <input
                      key={receiptInputKey}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => handleReceiptUpload(e.target.files?.[0])}
                      className="block w-full text-[13px] sm:text-[14px] text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-gradient-to-r file:from-blue-800 file:to-sky-500 file:px-4 file:py-2 file:text-[15px] file:font-bold file:text-white"
                    />
                    <p className="text-[13px] sm:text-[14px] text-slate-500">
                      Optional hai. Image ya PDF receipt upload kar sakte hain.
                    </p>
                    {wizard.receiptFileName ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-blue-50/60 px-4 py-3 text-[13px] sm:text-[14px] text-slate-700">
                        <span className="font-semibold">{wizard.receiptFileName}</span>
                        {receiptPreviewUrl ? (
                          <a
                            href={receiptPreviewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-blue-700"
                          >
                            View receipt
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleRemoveReceipt}
                          className="font-semibold text-rose-600"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Custom Menu Items</label>
                  <div className="space-y-4 rounded-[24px] border border-blue-100 bg-white p-4 shadow-[0_6px_18px_rgba(15,40,90,0.05)]">
                    <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-[13px] sm:text-[14px] font-bold text-blue-950">
                          Restaurant menu se select karein
                        </div>
                        <div className="mt-1 text-[13px] sm:text-[14px] text-slate-500">
                          Full restaurant menu khol kar items select kijiye, fir
                          yahin reservation form par wapas aa jayenge.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenRestaurantMenu}
                        className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-800 to-sky-500 px-4 py-2.5 text-[13px] sm:text-[14px] font-bold text-white shadow-[0_10px_24px_rgba(37,99,235,0.28)] transition-all duration-300 hover:-translate-y-0.5"
                      >
                        Open Restaurant Menu
                      </button>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
                      <div className="max-h-[320px] space-y-4 overflow-y-auto pr-1">
                        {menuCategories.length ? (
                          menuCategories.map((category) => (
                            <div key={category} className="rounded-2xl border border-blue-50 p-4">
                              <div className="text-[13px] sm:text-[14px] font-bold text-blue-950">
                                {category}
                              </div>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {(menuCatalogByCategory[category] || []).map((item) => {
                                  const isSelected =
                                    wizard.selectedCustomMenuItems.includes(item.name);

                                  return (
                                    <button
                                      key={item.id || `${category}-${item.name}`}
                                      type="button"
                                      onClick={() => toggleCustomMenuSelection(item.name)}
                                      className={`rounded-2xl border px-3 py-3 text-left text-[13px] sm:text-[14px] font-semibold transition-all duration-300 ${
                                        isSelected
                                          ? "border-blue-300 bg-blue-50 text-blue-700"
                                          : "border-blue-50 bg-slate-50 text-slate-600 hover:border-blue-200 hover:text-blue-700"
                                      }`}
                                    >
                                      <span className="block text-[13px] sm:text-[14px] font-bold">
                                        {item.name}
                                      </span>
                                      {item.price ? (
                                        <span className="mt-1 block text-[15px] opacity-80">
                                          {formatINR(item.price)}
                                        </span>
                                      ) : null}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-dashed border-blue-100 px-4 py-5 text-[13px] sm:text-[14px] text-slate-500">
                            Restaurant menu abhi load nahi hua. Aap manual items add kar sakte hain.
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 rounded-2xl bg-blue-50/40 p-4">
                        <div className="text-[13px] sm:text-[14px] font-bold text-blue-950">
                          Manual item add
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={wizard.manualMenuEntry}
                            onChange={(e) =>
                              setWizard((prev) => ({
                                ...prev,
                                manualMenuEntry: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddManualMenuItem();
                              }
                            }}
                            className={inputCls}
                            placeholder="Special sweet, extra starter..."
                          />
                          <button
                            type="button"
                            onClick={handleAddManualMenuItem}
                          className="rounded-full bg-gradient-to-r from-blue-800 to-sky-500 px-4 py-2 text-[13px] sm:text-[14px] font-bold text-white"
                          >
                            Add
                          </button>
                        </div>
                        <div className="text-[13px] sm:text-[14px] text-slate-500">
              You can select from the full menu or manually add a custom item here.
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-[13px] sm:text-[14px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Selected items
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {wizard.selectedRestaurantMenuItems.length ||
                        [...wizard.selectedCustomMenuItems, ...wizard.manualCustomMenuItems].length ? (
                          <>
                            {wizard.selectedRestaurantMenuItems.map((item, index) => (
                              <button
                                key={`${item.name}-${index}`}
                                type="button"
                                onClick={() =>
                                  handleRemoveSelectedRestaurantMenuItem(item, index)
                                }
                              className="rounded-2xl bg-blue-50 px-3 py-2 text-[13px] sm:text-[14px] font-semibold text-blue-700"
                              >
                                {item.name} x{item.qty} • {formatINR(item.total)} x
                              </button>
                            ))}
                            {wizard.selectedCustomMenuItems.map((item) => (
                              wizard.selectedRestaurantMenuItems.some(
                                (restaurantItem) => restaurantItem.name === item
                              ) ? null : (
                                <button
                                  key={`selected-${item}`}
                                  type="button"
                                  onClick={() => handleRemoveSelectedCustomMenuItem(item)}
                                  className="rounded-full bg-blue-50 px-3 py-2 text-[13px] sm:text-[14px] font-semibold text-blue-700"
                                >
                                  {item} x
                                </button>
                              )
                            ))}
                            {wizard.manualCustomMenuItems.map((item) => (
                              <button
                                key={`manual-${item}`}
                                type="button"
                                onClick={() => handleRemoveManualMenuItem(item)}
                                className="rounded-full bg-amber-50 px-3 py-2 text-[13px] sm:text-[14px] font-semibold text-amber-700"
                              >
                                {item} x
                              </button>
                            ))}
                          </>
                        ) : (
                          <div className="text-[13px] sm:text-[14px] text-slate-500">
            “No custom menu item has been selected yet.”
                          </div>
                        )}
                      </div>
                      {wizard.selectedRestaurantMenuItems.length ? (
                        <div className="mt-4 flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] sm:text-[14px]">
                          <span className="font-semibold text-slate-700">
                            Selected items total
                          </span>
                          <span className="font-black text-blue-700">
                            {formatINR(wizardTotals.customMenuCharge)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Notes</label>
                  <textarea
                    rows="3"
                    value={wizard.notes}
                    onChange={(e) =>
                      setWizard((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    className={inputCls}
                    placeholder="Special stage, family table, projector requirement..."
                  />
                </div>
                {reservationError ? (
                  <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] sm:text-[14px] font-semibold text-rose-700">
                    {reservationError}
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-blue-100 bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)]">
                  <div className="text-[17px] font-bold text-blue-950">
                    Reservation summary
                  </div>
                  <div className="mt-4 space-y-3 text-[13px] sm:text-[14px] text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaGlassCheers className="text-blue-600" />
                        Hall charge
                      </span>
                      <span className="font-semibold text-blue-950">
                        {formatINR(wizardTotals.hallCharge)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaUtensils className="text-blue-600" />
                        Meal plan
                      </span>
                      <span className="font-semibold text-blue-950">
                        {formatINR(wizardTotals.mealCharge)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaUtensils className="text-blue-600" />
                        Custom menu
                      </span>
                      <span className="font-semibold text-blue-950">
                        {formatINR(wizardTotals.customMenuCharge)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaLightbulb className="text-blue-600" />
                        Lighting
                      </span>
                      <span className="font-semibold text-blue-950">
                        {formatINR(wizardTotals.lightingCharge)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaHeadset className="text-blue-600" />
                        Event support
                      </span>
                      <span className="font-semibold text-blue-950">
                        {formatINR(wizardTotals.eventSupportCharge)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaUsers className="text-blue-600" />
                        Guests
                      </span>
                      <span className="font-semibold text-blue-950">
                        {wizard.guests || 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2">
                        <FaMoneyCheckAlt className="text-blue-600" />
                        Payment received
                      </span>
                      <span className="font-semibold text-emerald-700">
                        {formatINR(wizardTotals.advance)}
                      </span>
                    </div>
                    {editingBookingId ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2">
                          <FaMoneyCheckAlt className="text-blue-600" />
                          Payment refund
                        </span>
                        <span className="font-semibold text-amber-600">
                          {formatINR(wizard.refundAmount || 0)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-5 rounded-[18px] sm:rounded-[20px] bg-gradient-to-br from-blue-950 to-blue-800 px-4 py-4 text-white shadow-[0_16px_34px_rgba(11,27,51,0.3)]">
              <div className="text-[13px] sm:text-[14px] uppercase tracking-[0.2em] text-blue-200">
                      Estimated total
                    </div>
                    <div className="mt-2 text-[30px] font-black">
                      {formatINR(wizardTotals.grandTotal)}
                    </div>
                    <div className="mt-3 text-[13px] sm:text-[14px] text-blue-100">
                      balance due: {formatINR(wizardTotals.balanceDue)}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-blue-100 bg-white p-5 shadow-[0_8px_24px_rgba(15,40,90,0.06)]">
                  <div className="text-[17px] font-bold text-blue-950">
                    After booking
                  </div>
                  <p className="mt-3 text-[13px] sm:text-[14px] leading-6 text-slate-500">
          “Action buttons are provided on the booking dashboard to send quotations to guests via email or WhatsApp.”
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-[13px] sm:text-[14px] font-semibold text-blue-700">
                      <FaEnvelope />
                      Email Quote
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-[13px] sm:text-[14px] font-semibold text-emerald-700">
                      <FaWhatsapp />
                      WhatsApp Quote
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleConfirmBooking()}
                  disabled={isSavingReservation}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-gradient-to-r from-blue-800 to-sky-500 px-5 py-4 text-[17px] font-bold text-white shadow-[0_16px_35px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5"
                >
                  <FaPaperPlane />
                  {isSavingReservation
                    ? "Saving..."
                    : editingBookingId
                    ? "Update Reservation"
                    : "Save Reservation"}
                </button>
                {editingBookingId ? (
                  <button
                    type="button"
                    onClick={() => handleConfirmBooking({ cancelAfterSave: true })}
                    disabled={isSavingReservation}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-gradient-to-r from-rose-600 to-rose-500 px-5 py-4 text-[17px] font-bold text-white shadow-[0_16px_35px_rgba(244,63,94,0.26)] transition-all duration-300 hover:-translate-y-0.5"
                  >
                    Cancel Booking
                  </button>
                ) : null}
              </div>
            </div>
        </ModalShell>
      )}

      {delayedShowAddHall && (
        <ModalShell
          title={editingHallId ? "Edit Hall" : "Add Hall"}
          eyebrow="Venue Setup"
          onClose={() => {
            setHallFormError("");
            setEditingHallId(null);
            setNewHall(defaultHall);
            setHallImageMode("upload");
            setHallImageFile(null);
            setHallImagePreview("");
            setShowAddHall(false);
          }}
          widthClass="max-w-xl"
          heightClass="h-[min(78vh,560px)]"
        >
          <div className="grid gap-4">
            <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
              <div>
                <label className={labelCls}>Hall Image</label>
                <div className="flex aspect-square w-full max-w-[140px] sm:max-w-[200px] xl:max-w-[280px] items-center justify-center overflow-hidden rounded-[24px] border border-dashed border-blue-200 bg-blue-50/40">
                  {hallImagePreview || newHall.image ? (
                    <img
                      src={hallImagePreview || resolveBanquetHallImage(newHall.image)}
                      alt={newHall.name || "Hall preview"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#e3f0ff_0%,#eef6ff_50%,#dceeff_100%)] text-blue-700">
                      <FaGlassCheers className="text-3xl" />
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Hall Name</label>
                  <input
                    className={inputCls}
                    placeholder="Enter hall name"
                    value={newHall.name}
                    onChange={(e) =>
                      setNewHall((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Image Source</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setHallImageMode("upload");
                        setNewHall((prev) => ({ ...prev, image: "" }));
                      }}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] sm:text-[14px] font-bold transition-all duration-300 ${
                        hallImageMode === "upload"
                          ? "bg-gradient-to-r from-blue-800 to-sky-500 text-white"
                          : "border border-blue-100 bg-white text-slate-600 hover:border-blue-300"
                      }`}
                    >
                      <FaUpload />
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (hallImagePreview && hallImagePreview.startsWith("blob:")) {
                          URL.revokeObjectURL(hallImagePreview);
                        }
                        setHallImageFile(null);
                        setHallImagePreview("");
                        setHallImageMode("url");
                      }}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] sm:text-[14px] font-bold transition-all duration-300 ${
                        hallImageMode === "url"
                          ? "bg-gradient-to-r from-blue-800 to-sky-500 text-white"
                          : "border border-blue-100 bg-white text-slate-600 hover:border-blue-300"
                      }`}
                    >
                      <FaLink />
                      URL
                    </button>
                  </div>
                </div>
                {hallImageMode === "upload" ? (
                  <div>
                    <label className={labelCls}>Upload Image</label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-3 text-[13px] sm:text-[14px] font-medium text-slate-600 transition-all duration-300 hover:border-blue-300 hover:bg-blue-50">
                      <FaImage className="text-slate-500" />
                      <span className="min-w-0 flex-1 truncate">
                        {hallImageFile
                          ? hallImageFile.name
                          : "Choose a square or landscape image"}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 text-[15px] font-bold text-slate-700 shadow-sm">
                        Browse
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleHallImageFileChange}
                      />
                    </label>
                  </div>
                ) : (
                  <div>
                    <label className={labelCls}>Image URL</label>
                    <input
                      className={inputCls}
                      placeholder="Paste image URL or /uploads/file-name.jpg"
                      value={newHall.image || ""}
                      onChange={(e) =>
                        setNewHall((prev) => ({ ...prev, image: e.target.value }))
                      }
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Capacity</label>
                  <input
                    className={inputCls}
                    placeholder="Enter capacity"
                    type="number"
                    value={newHall.capacity}
                    onChange={(e) =>
                      setNewHall((prev) => ({
                        ...prev,
                        capacity: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Rate Per Hour</label>
                  <input
                    className={inputCls}
                    placeholder="Enter hourly rate"
                    type="number"
                    value={newHall.ratePerHour}
                    onChange={(e) =>
                      setNewHall((prev) => ({
                        ...prev,
                        ratePerHour: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              {editingHallId ? (
                <div>
                  <label className={labelCls}>Hall Status</label>
                  <select
                    value={newHall.status || "Available"}
                    onChange={(e) =>
                      setNewHall((prev) => ({ ...prev, status: e.target.value }))
                    }
                    className={inputCls}
                  >
                    <option value="Available">Available</option>
                    <option value="Occupied">Occupied</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </div>
              ) : null}
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 px-4 py-3 text-[13px] sm:text-[14px] font-semibold text-slate-700">
                <span>AC enabled hall</span>
                <input
                  type="checkbox"
                  checked={newHall.is_ac}
                  onChange={(e) =>
                    setNewHall((prev) => ({ ...prev, is_ac: e.target.checked }))
                  }
                  className="h-5 w-5 accent-blue-600"
                />
              </label>
              {hallFormError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] sm:text-[14px] font-semibold text-rose-700">
                  {hallFormError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleAddHall}
                disabled={isAddingHall}
                className="rounded-[22px] bg-gradient-to-r from-blue-800 to-sky-500 px-5 py-4 text-[17px] font-bold text-white shadow-[0_16px_35px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAddingHall
                  ? editingHallId
                    ? "Updating..."
                    : "Adding..."
                  : editingHallId
                  ? "Update Hall"
                  : "Add Hall"}
              </button>
            </div>
        </ModalShell>
      )}

      {delayedDetailHall && (
        <ModalShell
          title={delayedDetailHall.name}
          eyebrow="Hall Details"
          onClose={() => setDetailHall(null)}
          widthClass="max-w-lg"
          heightClass="h-[min(72vh,520px)]"
        >
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[22px] border border-blue-100 bg-blue-50/40 p-4">
                <div className="text-[13px] sm:text-[14px] uppercase tracking-[0.18em] text-slate-500">
                  Capacity
                </div>
                <div className="mt-2 text-[24px] font-black text-blue-950">
                  {delayedDetailHall.capacity}
                </div>
              </div>
              <div className="rounded-[22px] border border-blue-100 bg-blue-50/40 p-4">
                <div className="text-[13px] sm:text-[14px] uppercase tracking-[0.18em] text-slate-500">
                  Rate / hour
                </div>
                <div className="mt-2 text-[24px] font-black text-blue-950">
                  {formatINR(delayedDetailHall.ratePerHour)}
                </div>
              </div>
              <div className="rounded-[22px] border border-blue-100 bg-blue-50/40 p-4">
                <div className="text-[13px] sm:text-[14px] uppercase tracking-[0.18em] text-slate-500">
                  Cooling
                </div>
                <div className="mt-2 text-[18px] font-bold text-blue-950">
                  {delayedDetailHall.is_ac ? "AC Hall" : "Non-AC Hall"}
                </div>
              </div>
              <div className="rounded-[22px] border border-blue-100 bg-blue-50/40 p-4">
                <div className="text-[13px] sm:text-[14px] uppercase tracking-[0.18em] text-slate-500">
                  Status
                </div>
                <div className="mt-2 text-[18px] font-bold text-blue-950">
                  {delayedDetailHall.status}
                </div>
              </div>
              {hallFormError ? (
                <div className="rounded-[22px] border border-rose-200 bg-rose-50 p-4 text-[13px] sm:text-[14px] font-semibold text-rose-700 sm:col-span-2">
                  {hallFormError}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => handleEditHall(delayedDetailHall)}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-[13px] sm:text-[14px] font-bold text-white transition-all duration-300 hover:bg-amber-600"
                >
                  <FaEdit />
                  Edit Hall
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteHall(delayedDetailHall)}
                  disabled={isDeletingHall}
                  className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-[13px] sm:text-[14px] font-bold text-white transition-all duration-300 hover:bg-rose-700 disabled:opacity-60"
                >
                  <FaTrash />
                  {isDeletingHall ? "Deleting..." : "Delete Hall"}
                </button>
              </div>
          </div>
        </ModalShell>
      )}

      {delayedHallDeleteTarget && (
        <ModalShell
          title="Delete Banquet Hall"
          eyebrow="Delete Confirmation"
          onClose={() => setHallDeleteTarget(null)}
          widthClass="max-w-2xl"
          heightClass="h-auto"
        >
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="flex aspect-square w-full max-w-[150px] items-center justify-center overflow-hidden rounded-[24px] border border-blue-100 bg-blue-50/40">
                {delayedHallDeleteTarget.image ? (
                  <img
                    src={resolveBanquetHallImage(delayedHallDeleteTarget.image)}
                    alt={delayedHallDeleteTarget.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#e3f0ff_0%,#eef6ff_50%,#dceeff_100%)] text-blue-700">
                    <FaGlassCheers className="text-4xl" />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] sm:text-[14px] leading-6 text-rose-700">
                  Are you sure you want to permanently delete this banquet hall? This action cannot be undone.
                </div>

                <div className="overflow-x-auto rounded-[22px] border border-blue-100">
                  <table className="min-w-full text-[13px] sm:text-[14px]">
                    <tbody>
                      <tr className="border-b border-blue-100 bg-blue-50/40">
                        <td className="px-4 py-3 font-semibold text-slate-500">Hall Name</td>
                        <td className="px-4 py-3 font-bold text-blue-950">{delayedHallDeleteTarget.name || "-"}</td>
                      </tr>
                      <tr className="border-b border-blue-100">
                        <td className="px-4 py-3 font-semibold text-slate-500">Capacity</td>
                        <td className="px-4 py-3 font-semibold text-blue-950">{delayedHallDeleteTarget.capacity || "-"}</td>
                      </tr>
                      <tr className="border-b border-blue-100 bg-blue-50/40">
                        <td className="px-4 py-3 font-semibold text-slate-500">Rate Per Hour</td>
                        <td className="px-4 py-3 font-semibold text-blue-950">{formatINR(delayedHallDeleteTarget.ratePerHour || 0)}</td>
                      </tr>
                      <tr className="border-b border-blue-100">
                        <td className="px-4 py-3 font-semibold text-slate-500">Cooling</td>
                        <td className="px-4 py-3 font-semibold text-blue-950">{delayedHallDeleteTarget.is_ac ? "Air Conditioned" : "Non Air Conditioned"}</td>
                      </tr>
                      <tr className="bg-blue-50/40">
                        <td className="px-4 py-3 font-semibold text-slate-500">Status</td>
                        <td className="px-4 py-3 font-semibold text-blue-950">{delayedHallDeleteTarget.status || "Available"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {hallFormError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] sm:text-[14px] font-semibold text-rose-700">
                {hallFormError}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setHallDeleteTarget(null)}
                className={modalCloseBtnCls}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteHall}
                disabled={isDeletingHall}
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-rose-600 to-rose-500 px-5 py-2.5 text-[13px] sm:text-[14px] font-bold text-white shadow-[0_14px_30px_rgba(244,63,94,0.24)] transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingHall ? "Deleting..." : "Delete Hall"}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {delayedReservationSuccess && (
        <ModalShell
          title={delayedReservationSuccess.title || "Reservation successful"}
          eyebrow={delayedReservationSuccess.eyebrow || "Booking Confirmed"}
          onClose={() => setReservationSuccess(null)}
          widthClass="max-w-md"
          heightClass="h-auto"
        >
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.26),_rgba(56,189,248,0.13)_60%,_rgba(255,255,255,0.96)_100%)] shadow-[0_18px_45px_rgba(37,99,235,0.2)]">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-800 to-sky-500 text-[20px] font-black text-white">
                OK
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[19px] font-black text-blue-950">
                {delayedReservationSuccess.customerName}
                {delayedReservationSuccess.subjectLabel ? " " : "'s "}
                {delayedReservationSuccess.message || "reservation has been saved."}
              </p>
              {delayedReservationSuccess.detail || delayedReservationSuccess.hallName ? (
                <p className="text-[13px] sm:text-[14px] leading-6 text-slate-600">
                  {delayedReservationSuccess.hallName ? (
                    <span className="font-semibold text-blue-950">
                      {delayedReservationSuccess.hallName}
                    </span>
                  ) : null}
                  {delayedReservationSuccess.hallName && delayedReservationSuccess.date
                    ? " ke liye "
                    : delayedReservationSuccess.hallName && delayedReservationSuccess.detail
                    ? " • "
                    : ""}
                  {delayedReservationSuccess.date ? (
                    <span className="font-semibold text-blue-950">
                      {delayedReservationSuccess.date}
                    </span>
                  ) : null}
                  {delayedReservationSuccess.detail && !delayedReservationSuccess.date
                    ? delayedReservationSuccess.detail
                    : ""}
                  {delayedReservationSuccess.date
                    ? " par status successfully update ho gaya hai."
                    : ""}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setReservationSuccess(null)}
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-800 to-sky-500 px-6 py-3 text-[13px] sm:text-[14px] font-bold text-white shadow-[0_16px_35px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5"
            >
              Continue
            </button>
          </div>
        </ModalShell>
      )}

      {delayedShowBill && selectedBooking && (
        <ModalShell
          title="Banquet Bill"
          eyebrow="Invoice View"
          onClose={() => setShowBill(false)}
          widthClass="max-w-4xl"
          heightClass="h-[min(88vh,780px)]"
          headerActions={
            <button
              type="button"
              onClick={() =>
                printBanquetInvoice(selectedBooking, {
                  halls,
                  menuPackages: pricingConfig.menuPackages,
                  lightingOptions: pricingConfig.lightingOptions,
                })
              }
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-800 to-sky-500 px-4 py-1.5 text-[13px] font-bold text-white shadow-[0_8px_20px_rgba(37,99,235,0.3)] transition-all duration-300 hover:-translate-y-0.5 sm:px-5 sm:py-2 sm:text-[14px]"
            >
              <FaPrint />
              Print Invoice
            </button>
          }
        >
            <BanquetBill
              booking={selectedBooking}
              halls={halls}
              menuPackages={pricingConfig.menuPackages}
              lightingOptions={pricingConfig.lightingOptions}
              formatINR={formatINR}
            />
        </ModalShell>
      )}

      {showBanquetWhatsAppModal && (
        <BanquetWhatsAppModal
          booking={selectedBookingForWhatsApp}
          onClose={() => setShowBanquetWhatsAppModal(false)}
          onSuccess={handleBanquetWhatsAppSuccess}
        />
      )}

      {delayedSelectedMenuPackage && (
        <ModalShell
          title={delayedSelectedMenuPackage.name}
          eyebrow="Banquet Menu Details"
          onClose={() => setSelectedMenuPackage(null)}
          widthClass="max-w-2xl"
          heightClass="h-[min(78vh,620px)]"
        >
            <div>
              <div className="text-[13px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-blue-600">
                Package Pricing
              </div>
              <div className="mt-4 max-w-xs">
                <label className={labelCls}>Per Guest Price</label>
                <input
                  type="number"
                  min="0"
                  value={delayedSelectedMenuPackage.perGuest}
                  onChange={(e) => {
                    handleMenuPriceChange(
                      delayedSelectedMenuPackage.id,
                      e.target.value
                    );
                    setSelectedMenuPackage((prev) =>
                      prev
                        ? {
                            ...prev,
                            perGuest: Number(e.target.value) || 0,
                          }
                        : prev
                    );
                  }}
                  className={inputCls}
                />
              </div>
              <p className="mt-5 text-[17px] leading-7 text-slate-600">
                {delayedSelectedMenuPackage.description}
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div className="rounded-[24px] border border-blue-100 bg-blue-50/30 p-5">
                <div className="text-[13px] sm:text-[14px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Included Highlights
                </div>
                <div className="mt-4 space-y-3">
                  {delayedSelectedMenuPackage.highlights.map((item) => (
                    <div
                      key={item}
                      className="rounded-2xl bg-white px-4 py-3 text-[13px] sm:text-[14px] font-medium text-slate-700 shadow-[0_4px_14px_rgba(15,40,90,0.05)]"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-blue-100 bg-[linear-gradient(180deg,#eef6ff_0%,#f8fafc_100%)] p-5">
                <div className="text-[13px] sm:text-[14px] font-bold uppercase tracking-[0.18em] text-blue-700">
                  Meal Type
                </div>
                <div className="mt-3 text-[18px] font-bold text-blue-950">
                  {delayedSelectedMenuPackage.mealLabel}
                </div>
                <div className="mt-6 text-[13px] sm:text-[14px] font-bold uppercase tracking-[0.18em] text-blue-700">
                  Available Sections
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {mealSections.map((section) => (
                    <span
                      key={section}
                      className="rounded-full bg-white px-3 py-1.5 text-[13px] sm:text-[14px] font-semibold text-slate-700 shadow-[0_4px_14px_rgba(15,40,90,0.05)]"
                    >
                      {section}
                    </span>
                  ))}
                </div>
              </div>
            </div>
        </ModalShell>
      )}
    </div>
  );
};

export default Banquet;