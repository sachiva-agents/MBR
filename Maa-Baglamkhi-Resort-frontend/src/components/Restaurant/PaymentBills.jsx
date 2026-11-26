import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import API from "../../api";
import { getCurrentActor } from "../../utils/currentActor";

const PAYMENT_BILLS_PAGE_SIZE = 10;
const formatCurrency = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
const formatVisitId = (tokenCode, tokenId) => tokenCode || (tokenId ? `VIS-${String(tokenId).padStart(6, "0")}` : "--");

const formatDate = (value) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getCustomerDisplay = (bill, enrichedGuest) => {
  // Use bill's customer data first, or fallback to enriched guest data from rooms/bookings
  const billName = String(bill?.customerName || "").trim();
  const billPhone = String(bill?.phone || "").trim();

  // enrichedGuest comes from room/booking data
  const guestName = billName || String(enrichedGuest?.guestName || enrichedGuest?.name || "").trim() || "Walk-in Customer";
  const phone = billPhone || String(enrichedGuest?.mobile || enrichedGuest?.phone || "").trim() || "--";

  return { name: guestName, phone: phone };
};
const createBillCardKey = (bill) =>
  bill?.tokenId
    ? `${String(bill.entityType || "Table").toLowerCase()}:token:${Number(bill.tokenId)}`
    : [
        String(bill?.tableNumber || "").trim(),
        String(bill?.entityType || "Table").trim().toLowerCase(),
      ].join("|");

const getStatusMeta = (bill) => {
  const normalizedStatus = String(bill?.invoiceStatus || "").toLowerCase();
  const isPaid = normalizedStatus === "paid";
  const isPostedToRoom = normalizedStatus === "posted to room";
  return {
    label: isPaid ? "Paid" : isPostedToRoom ? "Posted To Room" : "Pending",
    billStage: isPaid ? "Payment Completed" : isPostedToRoom ? "Shifted To Folio" : "Bill Generated",
    classes: isPaid
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : isPostedToRoom
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-amber-200 bg-amber-50 text-amber-700",
  };
};

// Small inline icon set (kept purely presentational, no logic impact)
const IconBillDoc = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M6 3.75A1.75 1.75 0 0 1 7.75 2h6.19c.464 0 .909.184 1.238.513l3.31 3.31c.329.329.513.774.513 1.238V20.25A1.75 1.75 0 0 1 17.25 22h-9.5A1.75 1.75 0 0 1 6 20.25V3.75Z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9 9h6M9 12.5h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconHome = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 10.5 12 4l8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 9.5V19a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1V9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconTable = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 8h18M5 8v11M19 8v11M3 8l2-4h14l2 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconWallet = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h13A1.5 1.5 0 0 1 19 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 16.5v-9Z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M15.5 12.5h3a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-3a1.5 1.5 0 0 0 0 3Z" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const PaymentBills = () => {
  const actor = getCurrentActor();
  const sectionRef = useRef(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roomNumbers, setRoomNumbers] = useState(new Set());
  const [rooms, setRooms] = useState([]);
  const [selectedBill, setSelectedBill] = useState(null);
  const [billPage, setBillPage] = useState(1);

  // Split-bills list (HAG-12, gap 7): GET /api/restaurant/split-bills
  const [view, setView] = useState("bills");
  const [splitBills, setSplitBills] = useState([]);
  const [splitLoading, setSplitLoading] = useState(false);

  const loadSplitBills = useCallback(async () => {
    setSplitLoading(true);
    try {
      const res = await API.get("/restaurant/split-bills");
      setSplitBills(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSplitBills([]);
    } finally {
      setSplitLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "splits") loadSplitBills();
  }, [view, loadSplitBills]);

  const closeBillDetail = useCallback(() => setSelectedBill(null), []);

  // Create guest info lookup from rooms (for enriching bill data)
  const guestLookup = useMemo(() => {
    const lookup = new Map();
    (Array.isArray(rooms) ? rooms : []).forEach((room) => {
      const roomNo = String(room.roomNo || room.roomNumber || "").trim();
      if (roomNo) {
        lookup.set(roomNo, {
          name: room.guest || null,
          mobile: room.mobile || room.phone || null,
        });
      }
    });
    return lookup;
  }, [rooms]);

  // Get enriched guest info for a bill based on room number
  const getGuestInfoForBill = (bill) => {
    const roomNo = String(bill?.tableNumber || "").trim();
    return guestLookup.get(roomNo) || null;
  };

  useEffect(() => {
    const fetchBills = async () => {
      try {
        setLoading(true);
        const [billsResponse, roomsResponse] = await Promise.all([
          API.get("/restaurant/bills"),
          API.get("/housekeeping"),
        ]);

        const nextBills = Array.isArray(billsResponse.data) ? billsResponse.data : [];
        setBills(nextBills);
        // NOTE: selectedBill is intentionally NOT auto-set here.
        // The detail popup should only open when the user clicks "View"
        // on a bill row, not automatically whenever this page loads.
        setRoomNumbers(
          new Set(
            (Array.isArray(roomsResponse.data) ? roomsResponse.data : [])
              .map((room) => String(room.roomNo || room.roomNumber || "").trim())
              .filter(Boolean),
          ),
        );
        setRooms(Array.isArray(roomsResponse.data) ? roomsResponse.data : []);
      } catch (error) {
        setBills([]);
        setSelectedBill(null);
        setRoomNumbers(new Set());
        setRooms([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBills();
  }, []);

  const uniqueBills = useMemo(() => {
    const latestByTable = new Map();
    (Array.isArray(bills) ? bills : []).forEach((bill) => {
      const key = createBillCardKey(bill);

      const existing = latestByTable.get(key);
      if (!existing || Number(bill.id || 0) > Number(existing.id || 0)) {
        latestByTable.set(key, bill);
      }
    });

    return Array.from(latestByTable.values()).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }, [bills]);

  const resolveEntityType = (bill) => {
    const explicitType = String(bill.entityType || "").trim().toLowerCase();
    if (explicitType === "room" || explicitType === "table") return explicitType;
    return roomNumbers.has(String(bill.tableNumber || "").trim()) ? "room" : "table";
  };

  const getEntityLabel = (bill) =>
    resolveEntityType(bill) === "room"
      ? `Room ${bill.tableNumber || "--"}`
      : `Table ${bill.tableNumber || "--"}`;

  const latestBill = uniqueBills[0] || null;
  const totalBillPages = Math.max(1, Math.ceil(uniqueBills.length / PAYMENT_BILLS_PAGE_SIZE));
  const paginatedBills = uniqueBills.slice(
    (billPage - 1) * PAYMENT_BILLS_PAGE_SIZE,
    billPage * PAYMENT_BILLS_PAGE_SIZE,
  );

  useEffect(() => {
    setBillPage(1);
  }, [uniqueBills]);

  useEffect(() => {
    if (billPage > totalBillPages) {
      setBillPage(totalBillPages);
    }
  }, [billPage, totalBillPages]);

  useEffect(() => {
    if (!selectedBill) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeBillDetail();
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [selectedBill, closeBillDetail]);

  const billDetailPopup = selectedBill
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden overscroll-contain bg-slate-950/55 px-3 py-4 backdrop-blur-sm"
          onClick={(event) => {
            // Only close when clicking the backdrop itself, not the inner card
            if (event.target === event.currentTarget) {
              closeBillDetail();
            }
          }}
        >
          <div className="relative flex max-h-[90vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[18px] border border-white/40 bg-white/95 shadow-[0_28px_80px_rgba(15,23,42,0.32)] sm:rounded-[22px]">
            <button
              type="button"
              onClick={closeBillDetail}
              className="absolute right-3 top-3 z-10 rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-bold text-white backdrop-blur-sm ring-1 ring-white/30 transition hover:bg-white/25"
            >
              Close
            </button>

            <div className="overflow-y-auto overscroll-contain">
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-950 via-blue-700 to-sky-500 px-4 py-4 text-white sm:px-5">
                <IconBillDoc className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 text-white/10" />
                <p className="relative z-10 pr-16 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/85">
                  Bill Detail Card
                </p>
                <h3 className="relative z-10 mt-1.5 break-words text-xl font-black sm:text-2xl">{getEntityLabel(selectedBill)}</h3>
                <p className="relative z-10 mt-1 break-words text-[12px] text-white/85 sm:text-[13px]">
                  Bill #{selectedBill.id} | {formatDate(selectedBill.created_at)}
                </p>
              </div>

              <div className="px-4 py-4 sm:px-5">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="min-w-0 rounded-[12px] border border-blue-100 bg-blue-50/50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Customer Name</div>
                    <div className="mt-1 break-words text-[15px] font-black text-slate-900">
                      {getCustomerDisplay(selectedBill, getGuestInfoForBill(selectedBill)).name}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[12px] border border-blue-100 bg-blue-50/50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Mobile Number</div>
                    <div className="mt-1 break-words text-[15px] font-black text-slate-900">
                      {getCustomerDisplay(selectedBill, getGuestInfoForBill(selectedBill)).phone}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[12px] border border-blue-100 bg-blue-50/50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Bill Status</div>
                    <div
                      className={`mt-1.5 inline-flex rounded-full border px-2.5 py-1 text-[12px] font-black ${getStatusMeta(selectedBill).classes}`}
                    >
                      {getStatusMeta(selectedBill).label}
                    </div>
                    <div className="mt-1 text-[12px] text-slate-500">{getStatusMeta(selectedBill).billStage}</div>
                  </div>
                  <div className="min-w-0 rounded-[12px] border border-emerald-100 bg-emerald-50/60 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Total Amount</div>
                    <div className="mt-1 break-words text-lg font-black text-emerald-600">{formatCurrency(selectedBill.total)}</div>
                  </div>
                </div>

                <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                  <div className="min-w-0 rounded-[12px] border border-blue-100 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Subtotal</div>
                    <div className="mt-1 break-words text-[14px] font-black text-slate-900">{formatCurrency(selectedBill.subtotal)}</div>
                  </div>
                  <div className="min-w-0 rounded-[12px] border border-blue-100 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Tax</div>
                    <div className="mt-1 break-words text-[14px] font-black text-slate-900">{formatCurrency(selectedBill.gst)}</div>
                  </div>
                  <div className="min-w-0 rounded-[12px] border border-blue-100 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Payment Mode</div>
                    <div className="mt-1 break-words text-[14px] font-black text-slate-900">{selectedBill.paymentMethod || "Pending"}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeBillDetail}
                  className="mt-3 w-full rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-[13px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-50 md:hidden"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;
  return (
    <section ref={sectionRef} className="w-full max-w-full space-y-5 overflow-x-hidden px-3 sm:space-y-6 sm:px-4 md:space-y-8 md:px-6 lg:px-0">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[20px] border border-blue-900/20 bg-gradient-to-br from-blue-950 via-blue-900 via-blue-700 to-sky-500 px-4 py-6 text-white shadow-[0_25px_65px_rgba(15,44,111,0.28)] sm:rounded-[24px] sm:px-6 sm:py-7 md:rounded-[28px] md:px-8 md:py-9 lg:px-10 lg:py-10">
        {/* Blue glow */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sky-300/40 blur-3xl sm:-right-16 sm:-top-16 sm:h-64 sm:w-64" />
        <div className="pointer-events-none absolute -bottom-14 left-1/3 h-36 w-36 rounded-full bg-blue-400/30 blur-3xl sm:-bottom-20 sm:h-56 sm:w-56" />
        {/* Watermark icon */}
        <IconBillDoc className="pointer-events-none absolute -right-3 top-1/2 hidden h-28 w-28 -translate-y-1/2 text-white/10 xs:block sm:-right-4 sm:h-40 sm:w-40 md:h-48 md:w-48" />

        <div className="relative z-10 flex items-center gap-2.5 sm:gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/25 sm:h-11 sm:w-11 sm:rounded-2xl">
            <IconBillDoc className="h-5 w-5 text-white sm:h-6 sm:w-6" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/85 sm:text-[11px] sm:tracking-[0.34em]">
            {actor.isWaiter ? "Waiter Billing" : "Restaurant Billing"}
          </p>
        </div>
        <h2 className="relative z-10 mt-3 text-2xl font-black leading-tight sm:mt-4 sm:text-[28px] md:text-[32px]">
          {actor.isWaiter ? "My Payment Bills" : "Payment Bills"}
        </h2>
      </div>

      <div className="grid gap-4 sm:gap-5 md:gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Latest Bill Card */}
        <div className="min-w-0 rounded-[20px] border border-blue-100 bg-white/90 p-4 shadow-[0_20px_50px_rgba(30,64,175,0.08)] backdrop-blur-sm sm:rounded-[24px] sm:p-5 md:rounded-[28px] md:p-6 lg:p-7">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100 sm:h-9 sm:w-9 sm:rounded-xl">
              <IconBillDoc className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-blue-600 sm:text-[15px] sm:tracking-[0.28em]">Latest Bill</p>
          </div>

          {latestBill ? (
            <div className="mt-4 space-y-3 sm:mt-5 sm:space-y-4">
              <div className="rounded-[16px] border border-blue-50 bg-blue-50/50 p-4 sm:rounded-[22px] sm:p-5">
                <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:text-[15px] sm:tracking-[0.18em]">Customer</div>
                <div className="mt-1.5 break-words text-xl font-black text-slate-900 sm:mt-2 sm:text-2xl md:text-3xl">
                  {getCustomerDisplay(latestBill, getGuestInfoForBill(latestBill)).name}
                </div>
                <div className="mt-1 break-words text-sm font-semibold text-slate-600 sm:text-[18px]">
                  {getCustomerDisplay(latestBill, getGuestInfoForBill(latestBill)).phone}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                <div className="min-w-0 rounded-[14px] border border-slate-200 bg-white p-3 shadow-sm sm:rounded-[20px] sm:p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-slate-500 sm:gap-2 sm:text-[15px] sm:tracking-[0.18em]">
                    {resolveEntityType(latestBill) === "room" ? (
                      <IconHome className="h-3.5 w-3.5 shrink-0 text-blue-500 sm:h-4 sm:w-4" />
                    ) : (
                      <IconTable className="h-3.5 w-3.5 shrink-0 text-blue-500 sm:h-4 sm:w-4" />
                    )}
                    <span className="truncate">Entity</span>
                  </div>
                  <div className="mt-1.5 truncate text-lg font-black text-slate-900 sm:mt-2 sm:text-2xl">{getEntityLabel(latestBill)}</div>
                </div>
                <div className="min-w-0 rounded-[14px] border border-slate-200 bg-white p-3 shadow-sm sm:rounded-[20px] sm:p-4">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500 sm:text-[15px] sm:tracking-[0.18em]">Status</div>
                  <div
                    className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold sm:mt-2 sm:px-4 sm:py-1.5 sm:text-[15px] ${getStatusMeta(latestBill).classes}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                    <span className="truncate">{getStatusMeta(latestBill).label}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-[16px] border border-emerald-100 bg-emerald-50/70 p-4 sm:rounded-[22px] sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-emerald-700 sm:text-[15px] sm:tracking-[0.18em]">Total Amount</div>
                    <div className="mt-1.5 break-words text-2xl font-black text-emerald-700 sm:mt-2 sm:text-3xl md:text-4xl">{formatCurrency(latestBill.total)}</div>
                    <div className="mt-1.5 text-[13px] text-emerald-900/80 sm:mt-2 sm:text-[17px]">{formatDate(latestBill.created_at)}</div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 sm:h-11 sm:w-11 sm:rounded-2xl">
                    <IconWallet className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center gap-2.5 rounded-[16px] border border-dashed border-blue-200 bg-blue-50/40 px-4 py-8 text-center sm:mt-6 sm:gap-3 sm:rounded-[22px] sm:py-10">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-500 sm:h-14 sm:w-14 sm:rounded-2xl">
                <IconBillDoc className="h-6 w-6 sm:h-7 sm:w-7" />
              </span>
              <p className="text-base font-semibold text-slate-500 sm:text-[20px] md:text-[22px]">No bill has been generated yet.</p>
            </div>
          )}
        </div>

        {/* Bills Overview */}
        <div className="min-w-0 rounded-[20px] border border-blue-100 bg-white/90 p-4 shadow-[0_20px_50px_rgba(30,64,175,0.08)] backdrop-blur-sm sm:rounded-[24px] sm:p-5 md:rounded-[28px] md:p-6 lg:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100 sm:h-9 sm:w-9 sm:rounded-xl">
                <IconBillDoc className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-blue-600 sm:text-[15px] sm:tracking-[0.28em]">Bills Overview</p>
                <h3 className="mt-0.5 text-xl font-black leading-tight text-slate-900 sm:mt-1 sm:text-[26px] md:text-[30px] lg:text-[34px]">
                  Generated payment bill cards
                </h3>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setView("bills")}
                className={`rounded-full px-3 py-1.5 text-[13px] font-bold ring-1 transition sm:px-4 sm:py-2 sm:text-[15px] ${
                  view === "bills"
                    ? "bg-blue-700 text-white ring-blue-700"
                    : "bg-blue-50 text-blue-700 ring-blue-100 hover:bg-blue-100"
                }`}
              >
                Bills
              </button>
              <button
                type="button"
                onClick={() => setView("splits")}
                className={`rounded-full px-3 py-1.5 text-[13px] font-bold ring-1 transition sm:px-4 sm:py-2 sm:text-[15px] ${
                  view === "splits"
                    ? "bg-blue-700 text-white ring-blue-700"
                    : "bg-blue-50 text-blue-700 ring-blue-100 hover:bg-blue-100"
                }`}
              >
                Split Bills
              </button>
            </div>
          </div>

          {/* Split bills (HAG-12, gap 7): GET /restaurant/split-bills */}
          {view === "splits" ? (
            splitLoading ? (
              <div className="mt-5 rounded-[16px] border border-blue-100 bg-blue-50/40 px-4 py-10 text-center text-base font-semibold text-slate-500 sm:mt-6 sm:rounded-[22px] sm:py-12 sm:text-[20px]">
                Split bills loading...
              </div>
            ) : splitBills.length ? (
              <div className="mt-5 space-y-3 sm:mt-6">
                {splitBills.map((bill) => (
                  <div
                    key={bill.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-blue-100 bg-white p-3.5 shadow-sm sm:p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900 sm:text-[17px]">
                        {getEntityLabel(bill)}
                        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">
                          Split {bill.splitNo || 1}/{bill.splitCount || 1}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-slate-500">
                        {bill.customerName || "--"} · {formatDate(bill.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[15px] font-black text-emerald-600 sm:text-[17px]">
                        {formatCurrency(bill.total)}
                      </div>
                      <span
                        className={`mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          getStatusMeta(bill).classes
                        }`}
                      >
                        {getStatusMeta(bill).label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 flex flex-col items-center gap-2.5 rounded-[16px] border border-dashed border-blue-200 bg-blue-50/40 px-4 py-10 text-center sm:mt-6 sm:py-12">
                <p className="base font-semibold text-slate-500 sm:text-[20px]">No split bills yet.</p>
              </div>
            )
          ) : view === "bills" ? (
            <>
            {loading ? (
            <div className="mt-5 rounded-[16px] border border-blue-100 bg-blue-50/40 px-4 py-10 text-center text-base font-semibold text-slate-500 sm:mt-6 sm:rounded-[22px] sm:py-12 sm:text-[20px]">
              Bills loading...
            </div>
          ) : uniqueBills.length ? (
            <div className="mt-5 sm:mt-6">
              {/* Mobile / small-tablet card list (no table) */}
              <div className="space-y-3 md:hidden">
                {paginatedBills.map((bill) => {
                  const statusMeta = getStatusMeta(bill);
                  const customer = getCustomerDisplay(bill, getGuestInfoForBill(bill));
                  const active = selectedBill?.id === bill.id;

                  return (
                    <div
                      key={bill.id}
                      className={`rounded-[16px] border p-3.5 shadow-sm transition-colors sm:rounded-[18px] sm:p-4 ${
                        active ? "border-blue-300 bg-blue-50/70" : "border-blue-100 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-900 sm:text-[13px]">
                            {resolveEntityType(bill) === "room" ? (
                              <IconHome className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                            ) : (
                              <IconTable className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                            )}
                            <span className="truncate text-[15px] sm:text-[17px]">{getEntityLabel(bill)}</span>
                          </div>
                          <div className="mt-1.5 truncate text-[15px] font-semibold text-slate-900 sm:text-[17px]">{customer.name}</div>
                          <div className="mt-0.5 truncate text-[13px] text-slate-500 sm:text-[14px]">{customer.phone}</div>
                        </div>
                        <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:text-[13px] ${statusMeta.classes}`}>
                          {statusMeta.label}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-blue-50 pt-3 text-[12px] sm:text-[13px]">
                        <div className="min-w-0">
                          <div className="text-slate-400">Visit ID</div>
                          <div className="mt-0.5 truncate font-semibold text-slate-700">{formatVisitId(bill.tokenCode, bill.tokenId)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-slate-400">Date</div>
                          <div className="mt-0.5 truncate font-semibold text-slate-700">{formatDate(bill.created_at)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-slate-400">Amount</div>
                          <div className="mt-0.5 truncate font-bold text-emerald-600">{formatCurrency(bill.total)}</div>
                        </div>
                        <div className="flex items-end justify-end">
                          <button
                            type="button"
                            onClick={() => setSelectedBill(bill)}
                            className={`w-full rounded-lg px-3 py-2 text-[13px] font-bold shadow-sm transition-all duration-150 ${
                              active
                                ? "bg-blue-700 text-white hover:bg-blue-800"
                                : "border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                            }`}
                          >
                            {active ? "Selected" : "View"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tablet+ table layout */}
              <div className="hidden overflow-hidden rounded-[18px] border border-blue-100 md:block lg:rounded-[22px]">
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white text-left">
                    <thead className="bg-blue-50/70 text-[13px] uppercase tracking-[0.1em] text-blue-900/70 lg:text-[16px] lg:tracking-[0.16em] xl:text-[17px]">
                      <tr>
                        <th className="whitespace-nowrap px-3 py-3 font-bold lg:px-5 lg:py-4">Entity</th>
                        <th className="whitespace-nowrap px-3 py-3 font-bold lg:px-5 lg:py-4">Customer</th>
                        <th className="whitespace-nowrap px-3 py-3 font-bold lg:px-5 lg:py-4">Visit ID</th>
                        <th className="whitespace-nowrap px-3 py-3 font-bold lg:px-5 lg:py-4">Date</th>
                        <th className="whitespace-nowrap px-3 py-3 font-bold lg:px-5 lg:py-4">Amount</th>
                        <th className="whitespace-nowrap px-3 py-3 font-bold lg:px-5 lg:py-4">Status</th>
                        <th className="whitespace-nowrap px-3 py-3 text-center font-bold lg:px-5 lg:py-4">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedBills.map((bill) => {
                        const statusMeta = getStatusMeta(bill);
                        const customer = getCustomerDisplay(bill, getGuestInfoForBill(bill));
                        const active = selectedBill?.id === bill.id;

                        return (
                          <tr
                            key={bill.id}
                            className={`border-t border-blue-50 transition-colors ${
                              active ? "bg-blue-50/70" : "bg-white hover:bg-blue-50/40"
                            }`}
                          >
                            <td className="whitespace-nowrap px-3 py-3.5 text-[14px] font-bold text-slate-900 lg:px-5 lg:py-5 lg:text-[18px]">
                              <span className="flex items-center gap-1.5 lg:gap-2">
                                {resolveEntityType(bill) === "room" ? (
                                  <IconHome className="h-3.5 w-3.5 shrink-0 text-blue-400 lg:h-4 lg:w-4" />
                                ) : (
                                  <IconTable className="h-3.5 w-3.5 shrink-0 text-blue-400 lg:h-4 lg:w-4" />
                                )}
                                {getEntityLabel(bill)}
                              </span>
                            </td>
                            <td className="px-3 py-3.5 lg:px-5 lg:py-5">
                              <div className="text-[14px] font-semibold text-slate-900 lg:text-[18px]">{customer.name}</div>
                              <div className="mt-0.5 text-[12px] text-slate-500 lg:mt-1 lg:text-[16px]">{customer.phone}</div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 text-[13px] text-slate-600 lg:px-5 lg:py-5 lg:text-[17px]">
                              {formatVisitId(bill.tokenCode, bill.tokenId)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 text-[13px] text-slate-600 lg:px-5 lg:py-5 lg:text-[17px]">
                              {formatDate(bill.created_at)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 text-[14px] font-bold text-emerald-600 lg:px-5 lg:py-5 lg:text-[18px]">
                              {formatCurrency(bill.total)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 lg:px-5 lg:py-5">
                              <span className={`rounded-full border px-3 py-1 text-[12px] font-bold lg:px-4 lg:py-1.5 lg:text-[15px] ${statusMeta.classes}`}>
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 text-center lg:px-5 lg:py-5">
                              <button
                                type="button"
                                onClick={() => setSelectedBill(bill)}
                                className={`rounded-xl px-3.5 py-2 text-[13px] font-bold shadow-sm transition-all duration-150 lg:px-5 lg:py-2.5 lg:text-[17px] ${
                                  active
                                    ? "bg-blue-700 text-white hover:bg-blue-800"
                                    : "border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                                }`}
                              >
                                {active ? "Selected" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {uniqueBills.length > PAYMENT_BILLS_PAGE_SIZE ? (
                <div className="mt-3 flex flex-col gap-3 rounded-[16px] border border-blue-100 bg-blue-50/30 px-3.5 py-4 sm:mt-0 sm:gap-4 sm:rounded-none sm:rounded-b-[18px] sm:border-t-0 sm:px-5 sm:py-5 sm:flex-row sm:items-center sm:justify-between lg:rounded-b-[22px]">
                  <div className="text-center text-[13px] text-slate-500 sm:text-left sm:text-[16px] lg:text-[17px]">
                    Showing{" "}
                    <span className="font-semibold text-slate-900">
                      {(billPage - 1) * PAYMENT_BILLS_PAGE_SIZE + 1}
                    </span>{" "}
                    to{" "}
                    <span className="font-semibold text-slate-900">
                      {Math.min(billPage * PAYMENT_BILLS_PAGE_SIZE, uniqueBills.length)}
                    </span>{" "}
                    of <span className="font-semibold text-slate-900">{uniqueBills.length}</span> bills
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setBillPage((current) => Math.max(1, current - 1))}
                      disabled={billPage === 1}
                      className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-[13px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-[16px] lg:text-[17px]"
                    >
                      Previous
                    </button>

                    {Array.from({ length: totalBillPages }, (_, index) => index + 1).map((pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setBillPage(pageNumber)}
                        className={`rounded-lg px-3 py-2 text-[13px] font-semibold shadow-sm transition sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-[16px] lg:text-[17px] ${
                          pageNumber === billPage
                            ? "bg-blue-700 text-white"
                            : "border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                        }`}
                      >
                        {pageNumber}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => setBillPage((current) => Math.min(totalBillPages, current + 1))}
                      disabled={billPage === totalBillPages}
                      className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-[13px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-[16px] lg:text-[17px]"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center gap-2.5 rounded-[16px] border border-dashed border-blue-200 bg-blue-50/40 px-4 py-10 text-center sm:mt-6 sm:gap-3 sm:rounded-[22px] sm:py-12">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-500 sm:h-14 sm:w-14 sm:rounded-2xl">
                <IconBillDoc className="h-6 w-6 sm:h-7 sm:w-7" />
              </span>
              <p className="text-base text-slate-500 sm:text-[20px] md:text-[22px]">After generating the bill, the bill card will appear here.</p>
            </div>
          )}
            </>
          ) : null}
        </div>
      </div>

      {billDetailPopup}

    </section>
  );
};

export default PaymentBills;
