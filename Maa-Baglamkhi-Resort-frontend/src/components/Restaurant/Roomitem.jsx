import React, { useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiFileText, FiHome, FiPlusCircle, FiSearch, FiTrendingUp, FiUser } from "react-icons/fi";

import API from "../../api";
import RestaurantContext from "../../Context/restaurantContext";
import { restaurantService } from "../../services/restaurantService";
import {
  expandBookings,
  getRoomBookingReference,
  getRoomBookingForDate,
  mergeBookingsWithRooms,
  normalizeRooms,
  todayISO,
} from "../Dashboard/stayoverUtils";

const ACTIVE_INVOICE_KEY = "restaurant-active-invoice";
const SAVED_INVOICE_KEY = "restaurant-saved-invoice";
const ROOM_PAGE_SIZE = 18;
const normalizeInvoiceStatus = (value) => String(value || "").trim().toLowerCase();
const isSettledInvoiceStatus = (value) => {
  const normalized = normalizeInvoiceStatus(value);
  return normalized === "paid" || normalized === "posted to room";
};
const getReusableBill = (bill) => (isSettledInvoiceStatus(bill?.invoiceStatus) ? null : bill);
const createBillLookupKey = (entityType, tableName, tokenId) =>
  tokenId
    ? `${String(entityType || "Table").toLowerCase()}:token:${Number(tokenId)}`
    : `${String(entityType || "Table").toLowerCase()}:table:${String(tableName || "").trim()}`;

const formatCurrency = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;

const formatShortDate = (value) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const isOccupiedRoomStatus = (room, booking) => {
  // Room is occupied if status is "occupied" OR if there's an active booking with checked-in status
  const statusOccupied = String(room.status || room.hotelStatus || "").toLowerCase() === "occupied";
  const bookingOccupied = booking && !String(booking.bookingStatus || "").toLowerCase().includes("checked out");
  return statusOccupied || bookingOccupied;
};

const Roomitem = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedTable } = useContext(RestaurantContext);

  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tokenSnapshots, setTokenSnapshots] = useState({});
  const [billByRoom, setBillByRoom] = useState({});
  const [roomPage, setRoomPage] = useState(1);
  const [addonForms, setAddonForms] = useState({});

  const [search, setSearch] = useState("");
  const [menuItems, setMenuItems] = useState([]);

  /* Room-service order actions (HAG-12, gap 5):
     PUT  /api/room-service/order/:roomNumber/pay  -> mark the pending order paid
     POST /api/room-service/bill                    -> create a room bill record */
  const [roomServiceBusy, setRoomServiceBusy] = useState("");
  const [roomServiceMsg, setRoomServiceMsg] = useState("");

  const sayRoomService = (text) => {
    setRoomServiceMsg(text);
    setTimeout(() => setRoomServiceMsg(""), 6000);
  };

  const markRoomOrderPaid = async (room) => {
    const roomRef = String(room.roomNo);
    setRoomServiceBusy(`${roomRef}:pay`);
    try {
      await API.put(`/room-service/order/${roomRef}/pay`);
      sayRoomService(`Room ${roomRef} order marked paid.`);
      refreshTokenSnapshots([room]);
    } catch (error) {
      if (error.response?.status === 404) {
        sayRoomService(`No pending room order for room ${roomRef}.`);
      } else {
        console.error(error);
        sayRoomService(error.response?.data?.message || "Could not mark room order paid.");
      }
    } finally {
      setRoomServiceBusy("");
    }
  };

  const createRoomServiceBill = async (room) => {
    const roomRef = String(room.roomNo);
    const snapshot = tokenSnapshots[roomRef];
    const items = snapshot?.items || [];
    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0),
      0,
    );
    const gst = subtotal * 0.05;
    setRoomServiceBusy(`${roomRef}:bill`);
    try {
      const res = await API.post("/room-service/bill", {
        roomNumber: roomRef,
        subtotal,
        gst,
        total: subtotal + gst,
        paymentMethod: "Cash",
      });
      sayRoomService(`Room bill created${res.data?.id ? ` (bill #${res.data.id})` : ""} for room ${roomRef}.`);
    } catch (error) {
      console.error(error);
      sayRoomService(error.response?.data?.message || "Could not create room bill.");
    } finally {
      setRoomServiceBusy("");
    }
  };

  const focusRoomNo = String(location.state?.focusRoomNo || "");

  /* ---------- data loading (unchanged: real rooms + bookings from the same
     /housekeeping + /hotel/all-bookings endpoints BookingFlow.jsx uses) ---------- */

  const loadRooms = async () => {
    try {
      setLoading(true);
      const [roomsResponse, bookingsResponse] = await Promise.all([
        API.get("/housekeeping"),
        API.get("/hotel/all-bookings"),
      ]);
      setRooms(normalizeRooms(roomsResponse.data));
      setBookings(expandBookings(bookingsResponse.data));
    } catch (error) {
      console.error(error);
      alert("Hotel room data could not be loaded.");
      setRooms([]);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  useEffect(() => {
    const loadBills = async () => {
      try {
        const response = await API.get("/restaurant/bills");
        const latestByRoom = {};
        (Array.isArray(response.data) ? response.data : []).forEach((bill) => {
          const key = createBillLookupKey(bill.entityType, bill.tableNumber, bill.tokenId);
          if (!latestByRoom[key] || Number(bill.id || 0) > Number(latestByRoom[key].id || 0)) {
            latestByRoom[key] = bill;
          }
        });
        setBillByRoom(latestByRoom);
      } catch (error) {
        console.error("Failed to load room bills:", error);
        setBillByRoom({});
      }
    };

    loadBills();
    window.addEventListener("tokenUpdated", loadBills);
    return () => window.removeEventListener("tokenUpdated", loadBills);
  }, []);

  const mergedBookings = useMemo(() => mergeBookingsWithRooms(bookings, rooms), [bookings, rooms]);
  const today = todayISO();

  const getBookingForRoom = (room) =>
    getRoomBookingForDate(room.roomNo, today, mergedBookings, false) ||
    getRoomBookingReference(room.roomNo, today, mergedBookings);

  const occupiedRooms = useMemo(() => {
    return rooms.filter((room) => {
      const booking = getBookingForRoom(room);
      return isOccupiedRoomStatus(room, booking);
    });
  }, [rooms, mergedBookings, today]);

  // Menu items for the inline "Add-on" quick-add dropdown on each occupied
  // room card. Uses the same restaurantService.getMenu() endpoint that
  // MenuPage.jsx uses (GET /restaurant/menu?tableNumber=...), so the data
  // structure is identical.  Placed after occupiedRooms so the closure can
  // safely reference it.
  useEffect(() => {
    let active = true;
    const loadMenu = async () => {
      try {
        // Pass the first occupied room's number as tableNumber so the
        // backend returns the full shared menu. Fall back to "1" if no
        // rooms are loaded yet.
        const tableNumber = occupiedRooms.length ? String(occupiedRooms[0].roomNo) : "1";
        const data = await restaurantService.getMenu(tableNumber);
        if (!active) return;
        const list = Array.isArray(data) ? data : data?.data || [];
        setMenuItems(
          list.map((item) => ({
            id: item.id,
            name: item.name || item.item_name || "Menu Item",
            price: Number(item.price ?? item.rate ?? 0),
          })),
        );
      } catch (error) {
        console.error("Failed to load menu items:", error);
        if (active) setMenuItems([]);
      }
    };
    loadMenu();
    return () => {
      active = false;
    };
  }, [occupiedRooms]);

  const roomCards = useMemo(
    () =>
      rooms
        .map((room) => {
          const booking = getBookingForRoom(room);
          const occupied = isOccupiedRoomStatus(room, booking);
          return { room, booking, occupied };
        })
        .filter(({ occupied }) => occupied), // show only occupied rooms
    [rooms, mergedBookings, today],
  );

  const filteredRoomCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roomCards.filter(({ room, booking }) => {
      if (!q) return true;
      const guestName = String(room.guest || booking?.guestName || "").toLowerCase();
      return String(room.roomNo).toLowerCase().includes(q) || guestName.includes(q);
    });
  }, [roomCards, search]);

  const totalRoomPages = Math.max(1, Math.ceil(filteredRoomCards.length / ROOM_PAGE_SIZE));
  const paginatedCards = useMemo(
    () => filteredRoomCards.slice((roomPage - 1) * ROOM_PAGE_SIZE, roomPage * ROOM_PAGE_SIZE),
    [filteredRoomCards, roomPage],
  );
  const visibleRoomStart = filteredRoomCards.length ? (roomPage - 1) * ROOM_PAGE_SIZE + 1 : 0;
  const visibleRoomEnd = Math.min(roomPage * ROOM_PAGE_SIZE, filteredRoomCards.length);

  useEffect(() => {
    setRoomPage(1);
  }, [search]);

  useEffect(() => {
    if (roomPage > totalRoomPages) {
      setRoomPage(totalRoomPages);
    }
  }, [roomPage, totalRoomPages]);

  /* ---------- token snapshots for occupied rooms (kept same shape as before) ---------- */

  const refreshTokenSnapshots = async (roomsToLoad) => {
    if (!roomsToLoad.length) {
      setTokenSnapshots({});
      return;
    }

    try {
      const entries = await Promise.all(
        roomsToLoad.map(async (room) => {
          const roomRef = String(room.roomNo);
          const tokenRes = await API.get(`/token/table/${roomRef}`);
          const tokenId = tokenRes.data?.id || null;
          const tokenCode = tokenRes.data?.token_code || tokenRes.data?.tokenCode || null;

          if (!tokenId) {
            return [roomRef, { tokenId: null, tokenCode: null, items: [] }];
          }

          const itemsRes = await API.get(`/token/items/${tokenId}`);
          return [roomRef, { tokenId, tokenCode, items: itemsRes.data || [] }];
        }),
      );

      setTokenSnapshots(Object.fromEntries(entries));
    } catch (error) {
      console.error("Failed to load room token snapshots:", error);
      setTokenSnapshots({});
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!active) return;
      await refreshTokenSnapshots(occupiedRooms);
    };
    load();
    window.addEventListener("tokenUpdated", load);
    return () => {
      active = false;
      window.removeEventListener("tokenUpdated", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupiedRooms]);

  /* ---------- stats ---------- */

  const pendingBillTotal = useMemo(() => {
    return occupiedRooms.reduce((sum, room) => {
      const roomRef = String(room.roomNo);
      const snapshot = tokenSnapshots[roomRef];
      const items = snapshot?.items || [];

      if (items.length) {
        const subtotal = items.reduce(
          (itemSum, item) => itemSum + Number(item.qty || 0) * Number(item.rate || 0),
          0,
        );
        return sum + subtotal + subtotal * 0.05;
      }

      const bill = billByRoom[createBillLookupKey("Room", roomRef, snapshot?.tokenId || null)];
      if (bill && !isSettledInvoiceStatus(bill.invoiceStatus)) {
        return sum + Number(bill.total || 0);
      }
      return sum;
    }, 0);
  }, [occupiedRooms, tokenSnapshots, billByRoom]);

  /* ---------- add room ---------- */

  const addRoom = async (explicitRoomNo) => {
    const value = String(explicitRoomNo || "").trim();
    if (!value) {
      alert("Enter Room Number");
      return;
    }

    const exists = rooms.some((room) => String(room.roomNo) === value);
    if (exists) {
      alert("Room already exists");
      return;
    }

    try {
      await API.post("/housekeeping", {
        roomNumber: value,
        roomNo: value,
        status: "Vacant Dirty",
        assignee: "No Housekeeper",
      });
      loadRooms();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Room could not be added.");
    }
  };

  const handleAddRoomClick = () => {
    const value = window.prompt("Enter new room number");
    if (value) addRoom(value);
  };

  /* ---------- inline add-on (per-card quick add) ---------- */

  const updateAddonForm = (roomNo, patch) => {
    setAddonForms((current) => ({
      ...current,
      [roomNo]: {
        open: false,
        menuItemId: "",
        qty: 1,
        submitting: false,
        ...current[roomNo],
        ...patch,
      },
    }));
  };

  const toggleAddonForm = (roomNo) => {
    setAddonForms((current) => {
      const existing = current[roomNo] || { open: false, menuItemId: "", qty: 1, submitting: false };
      return { ...current, [roomNo]: { ...existing, open: !existing.open } };
    });
  };

  const handleAddToBill = async (room) => {
    const roomRef = String(room.roomNo);
    const form = addonForms[roomRef];
    const menuItem = menuItems.find((item) => String(item.id) === String(form?.menuItemId));
    if (!menuItem) {
      alert("Menu item select kijiye.");
      return;
    }
    const qty = Math.max(1, Number(form?.qty || 1));
    const baseAmount = menuItem.price * qty;
    const gstPercent = 5;
    const gstAmount = Number((baseAmount * gstPercent / 100).toFixed(2));
    const lineTotal = Number((baseAmount + gstAmount).toFixed(2));

    // Get the active booking so we can post to the folio
    const booking = getBookingForRoom(room);
    const bookingId = booking?.bookingId || null;

    updateAddonForm(roomRef, { submitting: true });
    try {
      let snapshot = tokenSnapshots[roomRef];
      let tokenId = snapshot?.tokenId;

      if (!tokenId) {
        // NOTE: adjust this endpoint/payload if your backend's token-create route differs.
        const createdToken = await API.post("/token/create", {
          tableNumber: roomRef,
          waiter: "Room Service",
        });
        tokenId = createdToken.data?.tokenId || null;
      }

      if (!tokenId) {
        throw new Error("Token could not be created.");
      }

      // NOTE: adjust this endpoint/payload if your backend's add-item route differs.
      await API.post("/token/item", {
        tokenId,
        name: menuItem.name,
        qty,
        rate: menuItem.price,
      });

      const [itemsRes, tokenRes] = await Promise.all([
        API.get(`/token/items/${tokenId}`),
        API.get(`/token/table/${roomRef}`),
      ]);

      setTokenSnapshots((current) => ({
        ...current,
        [roomRef]: {
          tokenId,
          tokenCode: tokenRes.data?.token_code || tokenRes.data?.tokenCode || snapshot?.tokenCode || null,
          items: itemsRes.data || [],
        },
      }));

      // Also post to the hotel folio so it appears in FolioView.jsx for this guest.
      // 🐛 FIX (this revision): the previous version posted `price × qty` (base
      // amount only) to the folio — the 5% GST was only applied later at the
      // hotel invoice level, so the on-screen Folio total and the printed
      // invoice did not match. Now `lineTotal` already INCLUDES the mandatory
      // 5% GST (`baseAmount + baseAmount * 5%`), and the description makes
      // this explicit so staff can see why the folio amount is slightly more
      // than the menu price × qty.
      if (bookingId) {
        try {
          const today = new Date().toISOString().slice(0, 10);
          await API.post(`/hotel/folio/${bookingId}`, {
            entry_date: today,
            entry_type: "Extra Charge",
            category: "Room Service",
            description: `${menuItem.name} x${qty} (incl. 5% GST)`,
            amount: lineTotal,
            created_by: "Room Service",
          });
          // Notify FolioView to reload if it's open
          window.dispatchEvent(new Event("folioUpdated"));
        } catch (folioErr) {
          // Non-fatal — token item already saved, just log the folio error
          console.warn("Folio post failed (non-fatal):", folioErr);
        }
      }

      updateAddonForm(roomRef, { open: false, menuItemId: "", qty: 1, submitting: false });
      window.dispatchEvent(new Event("tokenUpdated"));
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || error.message || "Add-on could not be added.");
      updateAddonForm(roomRef, { submitting: false });
    }
  };

  /* ---------- navigation / invoice / pay-now (unchanged logic) ---------- */

  const openRoomMenu = (room) => {
    const roomRef = String(room.roomNo);
    const booking = getBookingForRoom(room);
    const activeBooking = booking || getBookingForRoom(room);

    navigate(`/restaurant/menu/${roomRef}`, {
      state: {
        entityType: "Room",
        roomData: room,
        bookingId: activeBooking?.bookingId || null,
        guestName: room.guest || activeBooking?.guestName || "",
        roomId: room.roomId || room.id || null,
        focusRoomNo: roomRef,
      },
    });
  };

  const openRoomInvoice = async (room) => {
    const roomRef = String(room.roomNo);
    const snapshot = tokenSnapshots[roomRef];
    const items = snapshot?.items || [];
    const relatedBill = getReusableBill(
      billByRoom[createBillLookupKey("Room", roomRef, snapshot?.tokenId || null)] || null,
    );
    const activeBooking = getBookingForRoom(room);
    const customerName = relatedBill?.customerName || room.guest || activeBooking?.guestName || "Walk-in Customer";
    const phone = relatedBill?.phone || activeBooking?.mobile || "";

    if (!items.length) {
      return;
    }

    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0),
      0,
    );
    const gst = subtotal * 0.05;
    const total = subtotal + gst;

    const invoicePayload = {
      table: roomRef,
      tokenId: snapshot.tokenId,
      tokenCode: snapshot.tokenCode || null,
      items: items.map((item) => ({
        id: item.id,
        name: item.item_name,
        qty: Number(item.qty),
        rate: Number(item.rate),
      })),
      subtotal,
      gst,
      total,
      date: new Date().toISOString(),
      entityType: "Room",
      billId: relatedBill?.id || null,
      invoiceStatus: relatedBill?.invoiceStatus || null,
      customerName,
      phone,
      paymentMethod: relatedBill?.paymentMethod || "Cash",
      discountAmount: Number(relatedBill?.discountAmount || 0),
      splitCount: Number(relatedBill?.split_count || 1),
      personCount: Number(relatedBill?.split_count || 1),
      bookingId: activeBooking?.bookingId || null,
      bookingCode: activeBooking?.bookingCode || "",
      roomData: room,
    };

    try {
      const response = await restaurantService.createBill({
        ...invoicePayload,
        tokenId: snapshot?.tokenId || null,
        invoiceStatus: "Generated",
        paymentMethod: null,
      });
      const persistedInvoice = {
        ...invoicePayload,
        billId: response?.id || invoicePayload.billId || null,
        invoiceStatus: response?.bill?.invoiceStatus || "Generated",
      };
      localStorage.setItem(ACTIVE_INVOICE_KEY, JSON.stringify(persistedInvoice));
      localStorage.setItem(SAVED_INVOICE_KEY, JSON.stringify(persistedInvoice));
      window.dispatchEvent(new Event("tokenUpdated"));
      navigate("/restaurant/payment", { state: persistedInvoice });
    } catch (error) {
      alert(error.response?.data?.message || "Invoice could not be created.");
    }
  };

  const openPayNow = (room) => {
    const roomRef = String(room.roomNo);
    const snapshot = tokenSnapshots[roomRef];
    const items = snapshot?.items || [];
    const relatedBill = items.length
      ? getReusableBill(billByRoom[createBillLookupKey("Room", roomRef, snapshot?.tokenId || null)] || null)
      : billByRoom[createBillLookupKey("Room", roomRef, snapshot?.tokenId || null)] || null;
    const activeBooking = getBookingForRoom(room);
    const subtotal = items.length
      ? items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0), 0)
      : Number(relatedBill?.subtotal || 0);
    const gst = items.length ? subtotal * 0.05 : Number(relatedBill?.gst || 0);
    const discountAmount = Number(relatedBill?.discountAmount || 0);
    const total = items.length ? subtotal + gst - discountAmount : Number(relatedBill?.total || 0);

    navigate(`/restaurant/pay-now/${roomRef}`, {
      state: {
        table: roomRef,
        tokenId: snapshot?.tokenId || null,
        tokenCode: snapshot?.tokenCode || null,
        waiterName: "Room Service",
        items: items.map((item) => ({
          id: item.id,
          name: item.item_name,
          qty: Number(item.qty),
          rate: Number(item.rate),
        })),
        subtotal,
        gst,
        total,
        date: relatedBill?.created_at || new Date().toISOString(),
        entityType: "Room",
        billId: relatedBill?.id || null,
        invoiceStatus: relatedBill?.invoiceStatus || null,
        customerName: relatedBill?.customerName || room.guest || activeBooking?.guestName || "Walk-in Customer",
        phone: relatedBill?.phone || activeBooking?.mobile || "",
        paymentMethod: relatedBill?.paymentMethod || "Cash",
        discountAmount,
        splitCount: Number(relatedBill?.split_count || 1),
        personCount: Number(relatedBill?.split_count || 1),
        bookingId: activeBooking?.bookingId || null,
        bookingCode: activeBooking?.bookingCode || "",
        roomData: room,
      },
    });
  };

  const openCheckIn = (room) => {
    // Hands off to BookingFlow's "New Booking" screen (mounted at /hotel/guest),
    // which is where real guest + stay data actually gets created.
    navigate("/hotel/guest", { state: { focusRoomNo: room.roomNo } });
  };

  /* ---------- render ---------- */

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-gradient-to-b from-blue-50/40 via-white to-blue-50/30 p-3 sm:p-6 lg:p-8">
      {/* ---------- hero section ---------- */}
      <div className="relative mb-5 sm:mb-8 overflow-hidden rounded-[18px] sm:rounded-[28px] bg-gradient-to-br from-blue-950 via-blue-900 via-blue-700 to-sky-500 px-4 py-6 sm:px-10 sm:py-10 shadow-[0_10px_30px_rgba(29,78,216,0.3)] sm:shadow-[0_20px_60px_rgba(29,78,216,0.35)]">
        {/* soft abstract wave background */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-30"
          viewBox="0 0 1000 300"
          preserveAspectRatio="none"
        >
          <path
            d="M0,180 C150,240 350,120 500,160 C650,200 800,260 1000,190 L1000,300 L0,300 Z"
            fill="rgba(255,255,255,0.10)"
          />
          <path
            d="M0,120 C180,60 320,200 520,140 C700,90 850,180 1000,110 L1000,300 L0,300 Z"
            fill="rgba(255,255,255,0.06)"
          />
        </svg>
        {/* blue glow effects */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sky-400/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-blue-500/30 blur-3xl" />

        <div className="relative flex flex-col gap-4 sm:gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:gap-4">
            <span className="flex h-11 w-11 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-white/15 text-white shadow-lg backdrop-blur-md ring-1 ring-white/25">
              <FiHome className="h-[18px] w-[18px] sm:h-6 sm:w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[24px] sm:text-[32px] font-black leading-tight tracking-tight text-white break-words">
                Room Dashboard
              </h2>
              <p className="mt-1 sm:mt-1.5 max-w-xl text-[14px] sm:text-[18px] font-medium leading-snug text-blue-50/90">
                Every room, its guest, and its running bill — at a glance.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- room-service action status (HAG-12) ---------- */}
      {roomServiceMsg && (
        <div className="mb-4 rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] font-bold text-emerald-800 sm:mb-5">
          {roomServiceMsg}
        </div>
      )}

      {/* ---------- stat cards ---------- */}
      <div className="mb-5 sm:mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        <div className="group flex h-full items-center justify-between gap-3 rounded-[18px] sm:rounded-[26px] border border-blue-100 bg-white/90 p-4 sm:p-6 shadow-[0_10px_30px_rgba(29,78,216,0.08)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(29,78,216,0.14)] sm:col-span-2 lg:col-span-1">
          <div className="min-w-0">
            <div className="text-[13px] sm:text-[17px] font-bold uppercase tracking-wide text-blue-500/80">Total Rooms</div>
            <div className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black text-slate-900">{rooms.length}</div>
            <div className="mt-1 text-[12px] sm:text-[15px] font-medium text-slate-400">Total rooms in the property</div>
          </div>
          <span className="flex h-11 w-11 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 transition-transform duration-300 group-hover:scale-110">
            <FiHome className="h-[18px] w-[18px] sm:h-[22px] sm:w-[22px]" />
          </span>
        </div>

        <div className="group flex h-full items-center justify-between gap-3 rounded-[18px] sm:rounded-[26px] border border-blue-100 bg-white/90 p-4 sm:p-6 shadow-[0_10px_30px_rgba(29,78,216,0.08)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(29,78,216,0.14)]">
          <div className="min-w-0">
            <div className="text-[13px] sm:text-[17px] font-bold uppercase tracking-wide text-amber-500/80">Occupied</div>
            <div className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black text-slate-900">{occupiedRooms.length}</div>
            <div className="mt-1 text-[12px] sm:text-[15px] font-medium text-slate-400">Rooms currently occupied</div>
          </div>
          <span className="flex h-11 w-11 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 transition-transform duration-300 group-hover:scale-110">
            <FiFileText className="h-[18px] w-[18px] sm:h-[22px] sm:w-[22px]" />
          </span>
        </div>

        <div className="group flex h-full items-center justify-between gap-3 rounded-[18px] sm:rounded-[26px] border border-blue-100 bg-white/90 p-4 sm:p-6 shadow-[0_10px_30px_rgba(29,78,216,0.08)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(29,78,216,0.14)]">
          <div className="min-w-0">
            <div className="text-[13px] sm:text-[17px] font-bold uppercase tracking-wide text-emerald-500/80">Pending Bill Total</div>
            <div className="mt-1 sm:mt-2 text-xl sm:text-4xl font-black text-slate-900 break-words">{formatCurrency(pendingBillTotal)}</div>
            <div className="mt-1 text-[12px] sm:text-[15px] font-medium text-slate-400">Total pending amount</div>
          </div>
          <span className="flex h-11 w-11 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 transition-transform duration-300 group-hover:scale-110">
            <FiTrendingUp className="h-[18px] w-[18px] sm:h-[22px] sm:w-[22px]" />
          </span>
        </div>
      </div>

      {/* ---------- search + add room ---------- */}
      <div className="mb-5 sm:mb-8 flex flex-col items-stretch gap-3 rounded-[18px] sm:rounded-[26px] border border-blue-100 bg-white/90 p-3 sm:p-4 shadow-[0_10px_30px_rgba(29,78,216,0.08)] backdrop-blur-sm sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <FiSearch className="pointer-events-none absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-blue-300" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search room no. or guest name"
            className="h-12 sm:h-14 w-full rounded-xl border-2 border-blue-100 bg-white pl-11 sm:pl-12 pr-4 text-[15px] sm:text-[17px] text-slate-700 shadow-sm transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100"
          />
        </div>

        <button
          type="button"
          onClick={handleAddRoomClick}
          className="inline-flex h-12 sm:h-14 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 sm:px-7 text-[15px] sm:text-[17px] font-bold text-white shadow-[0_8px_20px_rgba(29,78,216,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-[0_10px_26px_rgba(29,78,216,0.32)]"
        >
          <FiPlusCircle size={18} /> Add Room
        </button>
      </div>

      {/* ---------- room compact card grid — every room on this page renders at once ---------- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {loading ? (
          <div className="col-span-full rounded-[18px] sm:rounded-[28px] border-2 border-dashed border-blue-200 bg-blue-50/30 p-8 sm:p-12 text-center text-[16px] sm:text-[21px] font-semibold text-blue-900/70">
            Loading hotel rooms...
          </div>
        ) : paginatedCards.length ? (
          paginatedCards.map(({ room, booking, occupied }) => {
            const roomRef = String(room.roomNo);
            const isFocused = focusRoomNo && roomRef === focusRoomNo;
            const snapshot = tokenSnapshots[roomRef] || { tokenId: null, tokenCode: null, items: [] };
            const items = snapshot.items || [];
            const hasMenuItems = items.length > 0;
            const itemsTotal = items.reduce(
              (sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0),
              0,
            );
            const relatedBill = billByRoom[createBillLookupKey("Room", roomRef, snapshot.tokenId || null)] || null;
            const showPayNow = Boolean(relatedBill) && !isSettledInvoiceStatus(relatedBill.invoiceStatus);
            const guestName = room.guest || booking?.guestName || "Guest";
            const checkInLabel = formatShortDate(room.checkIn || booking?.checkIn);
            const checkOutLabel = formatShortDate(room.checkOut || booking?.checkOut);

            return (
              <div
                key={`${room.roomId}-${room.roomNo}`}
                className={`group relative flex flex-col overflow-hidden rounded-xl border bg-white p-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:rounded-2xl sm:p-3 ${
                  isFocused
                    ? "border-blue-400 ring-2 ring-blue-100"
                    : occupied
                    ? "border-amber-200"
                    : "border-emerald-200"
                }`}
              >
                {/* status accent strip */}
                <span
                  className={`absolute inset-x-0 top-0 h-1 ${occupied ? "bg-amber-400" : "bg-emerald-400"}`}
                  aria-hidden="true"
                />

                {/* Header: room number + status */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-extrabold text-blue-700 sm:text-[17px]">Room {room.roomNo}</div>
                    <div className="truncate text-[10px] font-medium text-slate-400 sm:text-[11px]">
                      {room.categoryName || room.roomType || "Hotel Room"}
                    </div>
                  </div>
                  <span
                    className={`inline-flex h-2 w-2 shrink-0 rounded-full ${occupied ? "bg-amber-500" : "bg-emerald-500"}`}
                    title={occupied ? "Occupied" : "Vacant"}
                  />
                </div>

                {occupied ? (
                  <>
                    <div className="mt-2 flex min-w-0 items-center gap-1 text-[11px] font-bold text-slate-700 sm:text-[12px]">
                      <FiUser className="shrink-0 text-blue-400" />
                      <span className="truncate">{guestName}</span>
                    </div>
                    <div className="mt-1 truncate text-[10px] text-slate-500 sm:text-[11px]">
                      {checkInLabel} → {checkOutLabel}
                    </div>

                    <div className="mt-1.5 flex items-center justify-between gap-1.5 rounded-lg bg-blue-50/70 px-2 py-1">
                      <span className="truncate text-[10px] text-slate-500 sm:text-[11px]">
                        {hasMenuItems ? `${items.length} items` : "No items"}
                      </span>
                      <span className="shrink-0 text-[11px] font-extrabold text-slate-900 sm:text-[12px]">
                        {formatCurrency(itemsTotal)}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => openRoomMenu(room)}
                        className="col-span-2 rounded-lg bg-slate-900 px-2 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 sm:text-[12px]"
                      >
                        Open Menu
                      </button>

                      <button
                        type="button"
                        onClick={() => openRoomInvoice(room)}
                        className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-bold text-blue-700 shadow-sm transition-all duration-200 hover:border-blue-300 hover:bg-blue-50 sm:text-[12px]"
                      >
                        View Bill
                      </button>

                      {showPayNow ? (
                        <button
                          type="button"
                          onClick={() => openPayNow(room)}
                          className="rounded-lg bg-emerald-500 px-2 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all duration-200 hover:bg-emerald-600 sm:text-[12px]"
                        >
                          Pay Now
                        </button>
                      ) : (
                        <span />
                      )}

                      {/* Room-service settlement actions (HAG-12) */}
                      <button
                        type="button"
                        onClick={() => markRoomOrderPaid(room)}
                        disabled={roomServiceBusy === `${roomRef}:pay`}
                        className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700 shadow-sm transition-all duration-200 hover:bg-emerald-100 disabled:opacity-50 sm:text-[12px]"
                      >
                        {roomServiceBusy === `${roomRef}:pay` ? "Marking paid…" : "Mark Order Paid"}
                      </button>
                      <button
                        type="button"
                        onClick={() => createRoomServiceBill(room)}
                        disabled={roomServiceBusy === `${roomRef}:bill`}
                        className="col-span-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 disabled:opacity-50 sm:text-[12px]"
                      >
                        {roomServiceBusy === `${roomRef}:bill` ? "Creating…" : "Create Room Bill"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 flex flex-1 flex-col justify-between">
                    <div className="text-[10px] text-slate-400 sm:text-[11px]">Ready for check-in.</div>
                    <button
                      type="button"
                      onClick={() => openCheckIn(room)}
                      className="mt-2 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-[11px] font-bold text-blue-700 shadow-sm transition-all duration-200 hover:border-blue-300 hover:bg-blue-50 sm:text-[12px]"
                    >
                      Check-in Guest
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="col-span-full rounded-[18px] sm:rounded-[28px] border-2 border-dashed border-blue-200 bg-blue-50/30 p-8 sm:p-12 text-center text-[16px] sm:text-[21px] font-semibold text-blue-900/70">
            No rooms match your search.
          </div>
        )}
      </div>

      {/* ---------- pagination ---------- */}
      <div className="mt-5 sm:mt-8 flex flex-col gap-4 rounded-[18px] sm:rounded-[26px] border border-blue-100 bg-white/90 px-4 sm:px-6 py-4 sm:py-5 shadow-[0_10px_30px_rgba(29,78,216,0.08)] backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="text-center text-[13px] sm:text-[16px] text-slate-500 lg:text-left">
          Showing <span className="font-bold text-slate-900">{visibleRoomStart}</span>-
          <span className="font-bold text-slate-900">{visibleRoomEnd}</span> of{" "}
          <span className="font-bold text-slate-900">{filteredRoomCards.length}</span> rooms
        </div>

        {totalRoomPages > 1 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setRoomPage((current) => Math.max(1, current - 1))}
              disabled={roomPage === 1}
              className="rounded-full border-2 border-blue-100 bg-white px-4 sm:px-5 py-2 sm:py-2.5 text-[13px] sm:text-[16px] font-bold text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              Previous
            </button>

            {Array.from({ length: totalRoomPages }, (_, index) => index + 1).map((pageNumber) => {
              const isActive = pageNumber === roomPage;
              return (
                <button
                  key={`room-page-${pageNumber}`}
                  type="button"
                  onClick={() => setRoomPage(pageNumber)}
                  className={`h-9 w-9 sm:h-11 sm:min-w-11 sm:w-auto rounded-full px-2.5 sm:px-3.5 text-[13px] sm:text-[16px] font-bold transition-all duration-200 ${
                    isActive
                      ? "bg-blue-700 text-white shadow-[0_10px_24px_rgba(29,78,216,0.3)]"
                      : "border-2 border-blue-100 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-700"
                  }`}
                >
                  {pageNumber}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setRoomPage((current) => Math.min(totalRoomPages, current + 1))}
              disabled={roomPage === totalRoomPages}
              className="rounded-full border-2 border-blue-100 bg-white px-4 sm:px-5 py-2 sm:py-2.5 text-[13px] sm:text-[16px] font-bold text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Roomitem;