import { useMemo } from "react";
import {
  FaTimes,
  FaArrowDown,
  FaUser,
  FaPhone,
  FaCalendar,
  FaFileInvoice,
  FaGlassCheers,
  FaHotel,
  FaUtensils,
  FaMoneyBillWave,
  FaReceipt,
  FaSearch,
} from "react-icons/fa";

const toNumber = (value) => Number(value) || 0;

const formatINR = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(toNumber(amount));

const formatDay = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// Normalize a phone-ish value to digits only so "9876543210", "+91 98...",
// and "9876543210 " all match the same customer.
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const isQueryNumberish = (q) => q.length >= 6 && q.replace(/\D/g, "").length >= 5;

// A customer record "matches" the query when it is a name fragment match OR a
// phone fragment match. Returns true/false per record.
const matches = (query, nameFields, phoneFields) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;
  const name = (nameFields || [])
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (name.includes(q)) return true;
  if (isQueryNumberish(q)) {
    const phone = (phoneFields || []).map((v) => digits(v)).filter(Boolean).join("");
    if (phone && phone.includes(digits(q))) return true;
  }
  return false;
};

const cardCls = "rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs";
const sectionTitle =
  "flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500";
const pill = (tone) =>
  tone === "outstanding"
    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200/60"
    : tone === "paid"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
      : tone === "partial"
        ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60"
        : "bg-slate-100 text-slate-600 ring-1 ring-slate-200";

function KpiTile({ label, value, tone = "text-slate-900", sub }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-black ${tone}`}>{value}</div>
      {sub ? <div className="text-[11px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

function RecordList({ title, icon: Icon, rows, emptyLabel }) {
  return (
    <div className={cardCls}>
      <div className={sectionTitle}>
        <Icon className="text-slate-400" />
        <span>{title}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-4 text-center text-xs font-medium text-slate-400">
          {emptyLabel || "No records"}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-900">{row.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    {row.meta.map((item, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        {item.icon ? <item.icon className="text-[9px] text-slate-400" /> : null}
                        {item.text}
                      </span>
                    ))}
                  </div>
                  {row.note ? (
                    <div className="mt-1 truncate text-[11px] font-medium text-slate-600" title={row.note}>
                      <span className="font-bold uppercase tracking-wider text-slate-400">Note:</span>{" "}
                      {row.note}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="text-sm font-black text-slate-900">{row.total}</div>
                  {row.balance > 0 ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pill("outstanding")}`}>
                      {row.balanceLabel || "Due"} {formatINR(row.balance)}
                    </span>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pill("paid")}`}>
                      {row.status || "Settled"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CustomerHistoryModal = ({
  query,
  records = [],
  customerInvoices = [],
  hotelBookings = [],
  restaurantBills = [],
  banquetBookings = [],
  paymentHistory = [],
  onClose,
}) => {
  const profile = useMemo(() => {
    const banquet = banquetBookings.filter((b) =>
      matches(query, [b.customerName, b.customer_name, b.eventTitle, b.event_type], [b.phone]),
    );
    const hotel = hotelBookings.filter((b) =>
      matches(query, [b.guest_name, b.guestName, b.customerName, b.company_name], [b.mobile, b.contact_no]),
    );
    const restaurant = restaurantBills.filter((b) =>
      matches(query, [b.customerName, b.customer_name], [b.phone, b.mobile]),
    );
    const invoices = customerInvoices.filter((i) =>
      matches(query, [i.customer_name, i.customerName], [i.customer_mobile, i.mobile]),
    );
    const ledger = records.filter((r) =>
      matches(query, [r.customerName, r.customer_name, r.narration, r.description], [r.customerMobile, r.customer_mobile]),
    );
    const payments = paymentHistory.filter((p) =>
      matches(query, [p.guest_name], [p.mobile]),
    );

    // Show the best-known name: prefer a matched name, else the query itself.
    const name =
      banquet[0]?.customerName ||
      banquet[0]?.customer_name ||
      hotel[0]?.guest_name ||
      restaurant[0]?.customerName ||
      invoices[0]?.customer_name ||
      ledger[0]?.customerName ||
      String(query || "").trim();

    const phone =
      banquet[0]?.phone ||
      restaurant[0]?.phone ||
      invoices[0]?.customer_mobile ||
      ledger[0]?.customerMobile ||
      "";

    const totalBooked =
      banquet.reduce((s, b) => s + toNumber(b.grandTotal ?? b.total), 0) +
      hotel.reduce((s, b) => s + toNumber(b.totalAmount ?? b.total_amount), 0) +
      restaurant.reduce((s, b) => s + toNumber(b.total), 0) +
      invoices.reduce((s, i) => s + toNumber(i.totalAmount ?? i.total_amount ?? i.final_total), 0);
    const totalPaid =
      banquet.reduce((s, b) => s + toNumber(b.advance || 0), 0) +
      hotel.reduce((s, b) => s + toNumber(b.paidAmount ?? b.netPaid ?? 0), 0) +
      restaurant.reduce((s, b) => s + toNumber(b.paidAmount ?? b.netPaid ?? 0), 0) +
      invoices.reduce((s, i) => s + toNumber(i.paidAmount ?? i.paid_amount ?? i.amount_paid ?? 0), 0);
    const totalOutstanding =
      banquet.reduce((s, b) => s + toNumber(b.balanceDue ?? b.balance ?? 0), 0) +
      hotel.reduce((s, b) => s + toNumber(b.remainingAmount ?? b.balanceAmount ?? 0), 0) +
      restaurant.reduce((s, b) => s + Math.max(0, toNumber(b.total) - toNumber(b.paidAmount ?? b.netPaid ?? 0)), 0) +
      invoices.reduce((s, i) => s + toNumber(i.remainingAmount ?? i.balanceAmount ?? 0), 0);

    const allRows =
      banquet.length + hotel.length + restaurant.length + invoices.length + ledger.length + payments.length;

    return { name, phone, totalBooked, totalPaid, totalOutstanding, allRows, banquet, hotel, restaurant, invoices, ledger, payments };
  }, [query, records, customerInvoices, hotelBookings, restaurantBills, banquetBookings, paymentHistory]);

  const banquetRows = profile.banquet.map((b) => ({
    id: `banquet-${b.id}`,
    title: `${b.eventTitle || b.event_type || "Banquet"}${b.invoiceNo ? ` · ${b.invoiceNo}` : ""}`,
    meta: [
      { icon: FaCalendar, text: formatDay(b.date) },
      { icon: FaGlassCheers, text: b.hallName || b.hall_name || b.hall || "Hall" },
      { text: `${b.guests || b.guest_count || 0} guests` },
    ],
    total: formatINR(b.grandTotal ?? b.total),
    balance: toNumber(b.balanceDue ?? b.balance ?? 0),
    status: b.paymentStatus || b.payment_status || b.status,
    note: b.notes || b.customMenuItems,
  }));

  const hotelRows = profile.hotel.map((b) => ({
    id: `hotel-${b.bookingId || b.id}`,
    title: `${b.booking_code || b.bookingCode || `Booking #${b.bookingId || b.id}`}${b.rooms ? ` · Room ${b.rooms}` : ""}`,
    meta: [
      { icon: FaCalendar, text: `${formatDay(b.check_in ?? b.checkIn)} – ${formatDay(b.check_out ?? b.checkOut)}` },
      { text: b.guest_name || "Guest" },
    ],
    total: formatINR(b.totalAmount ?? b.total_amount),
    balance: toNumber(b.remainingAmount ?? b.balanceAmount ?? 0),
    status: b.paymentStatus || b.status,
    note: b.notes || b.remarks,
  }));

  const restaurantRows = profile.restaurant.map((b) => ({
    id: `rest-${b.id}`,
    title: `${b.reference || `Bill #${b.id}`}${b.locationLabel ? ` · ${b.locationLabel}` : ""}`,
    meta: [
      { icon: FaCalendar, text: formatDay(b.created_at || b.date) },
      { text: b.customerName || b.customer_name || "Customer" },
    ],
    total: formatINR(b.total),
    balance: Math.max(0, toNumber(b.total) - toNumber(b.paidAmount ?? b.netPaid ?? 0)),
    status: b.paymentStatus || b.invoiceStatus || b.status,
    note: b.notes || b.notes_text,
  }));

  const invoiceRows = profile.invoices.map((i) => ({
    id: `invoice-${i.id}`,
    title: `${i.invoice_no || i.invoiceNo || `Invoice #${i.id}`}`,
    meta: [
      { icon: FaCalendar, text: formatDay(i.date) },
      { text: i.customer_name || i.customerName || "Customer" },
    ],
    total: formatINR(i.totalAmount ?? i.total_amount ?? i.final_total),
    balance: toNumber(i.remainingAmount ?? i.balanceAmount ?? 0),
    status: i.paymentStatus || i.payment_status || i.status,
    note: i.notes || i.narration,
  }));

  const ledgerRows = profile.ledger.map((r) => ({
    id: `ledger-${r.id}`,
    title: r.description || r.narration || "Ledger entry",
    meta: [
      { icon: FaCalendar, text: r.date || formatDay(r.created_at) },
      { icon: r.type === "Income" ? FaMoneyBillWave : FaArrowDown, text: r.type || "Entry" },
      { text: r.paymentMode || "Cash" },
    ],
    total: formatINR(r.amount),
    balance: 0,
    status: r.type === "Income" ? "Inflow" : "Outflow",
    // Show the narration/notes only when it isn't already used as the title.
    note: r.description ? r.narration : "",
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4 backdrop-blur-xs">
      <div className="accounts-form-modal relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <FaUser className="text-lg" />
            </div>
            <div>
              <div className="text-base font-black text-slate-900 sm:text-lg">
                {profile.name ? profile.name : "Customer"}
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                {phone ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                    <FaPhone className="text-[10px]" /> {phone}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <FaSearch className="text-[10px]" /> "{String(query || "").trim()}"
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close customer history"
          >
            <FaTimes className="text-sm" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
          {profile.allRows === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
              <div className="text-sm font-bold text-slate-600">No records found for "{String(query || "").trim()}"</div>
              <div className="mt-1 text-xs text-slate-400">
                No bookings, bills, invoices or ledger entries matched this name or number.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Money summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiTile label="Booked / Billed" value={formatINR(profile.totalBooked)} tone="text-blue-700" />
                <KpiTile label="Received" value={formatINR(profile.totalPaid)} tone="text-emerald-700" />
                <KpiTile
                  label="Outstanding"
                  value={formatINR(profile.totalOutstanding)}
                  tone={profile.totalOutstanding > 0 ? "text-rose-600" : "text-emerald-700"}
                />
                <KpiTile label="Total Records" value={String(profile.allRows)} tone="text-slate-900" />
              </div>

              <RecordList
                title="Banquet Bookings"
                icon={FaGlassCheers}
                rows={banquetRows}
                emptyLabel="No banquet bookings"
              />
              <RecordList
                title="Hotel Bookings"
                icon={FaHotel}
                rows={hotelRows}
                emptyLabel="No hotel bookings"
              />
              <RecordList
                title="Restaurant Bills"
                icon={FaUtensils}
                rows={restaurantRows}
                emptyLabel="No restaurant bills"
              />
              <RecordList
                title="Invoices"
                icon={FaFileInvoice}
                rows={invoiceRows}
                emptyLabel="No invoices"
              />
              <RecordList
                title="Ledger Transactions"
                icon={FaReceipt}
                rows={ledgerRows}
                emptyLabel="No manual ledger entries"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerHistoryModal;
