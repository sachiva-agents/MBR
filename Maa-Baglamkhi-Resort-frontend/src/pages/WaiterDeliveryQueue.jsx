/**
 * WaiterDeliveryQueue.jsx
 * Mobile-friendly delivery queue showing all "Ready" room orders assigned to the logged-in waiter.
 * Each card has a single "Mark Delivered" action that auto-posts the charge to guest folio.
 */
import React, { useEffect, useState, useCallback } from "react";
import { FaSyncAlt, FaCheckCircle, FaClock, FaUtensils } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import API from "../api";
import { getCurrentActor } from "../utils/currentActor";
import WaiterAssignmentCard from "../components/Restaurant/WaiterAssignmentCard";
import ReadyOrdersPanel from "../components/Waiter/ReadyOrdersPanel";

const POLL_INTERVAL = 5000;

export default function WaiterDeliveryQueue() {
  const navigate = useNavigate();
  const actor = getCurrentActor();
  const waiterName = actor?.name || "";

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchQueue = useCallback(async () => {
    if (!waiterName) {
      setLoading(false);
      return;
    }
    try {
      const res = await API.get("/room-service-delivery/waiter-queue", {
        params: { waiterName },
      });
      setOrders(Array.isArray(res.data) ? res.data : []);
      setLastRefresh(new Date());
      setError("");
    } catch (err) {
      console.error("Failed to load delivery queue:", err);
      setError("Could not load delivery queue");
    } finally {
      setLoading(false);
    }
  }, [waiterName]);

  useEffect(() => {
    if (!waiterName) return;
    fetchQueue();
    const interval = setInterval(fetchQueue, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchQueue, waiterName]);

  const handleDelivered = (orderId, result) => {
    setOrders((prev) => prev.filter((o) => String(o.id) !== String(orderId)));
    setDeliveredCount((c) => c + 1);
  };

  if (!waiterName) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center">
          <div className="text-3xl font-black text-rose-800">Login Required</div>
          <div className="mt-3 text-xl text-rose-600">
            Please login as a Waiter to view your delivery queue.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f5fbff_0%,#f3f8f4_28%,#fff8f1_58%,#f8fafc_100%)] p-4 transition-all duration-300">
      {/* Header */}
      <div className="mb-6 overflow-hidden rounded-[26px] border border-sky-400/60 bg-[linear-gradient(90deg,#0EA5E9_0%,#0284C7_45%,#0369A1_100%)] px-4 py-5 shadow-[0_22px_55px_rgba(14,165,233,0.24)] sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-sky-100 sm:text-base">
              Room Service
            </p>
            <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Waiter Delivery Queue
            </h1>
            <p className="mt-1 text-base text-white/80 sm:text-lg">
              Welcome, <span className="font-bold">{waiterName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={fetchQueue}
            className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-base font-bold text-white backdrop-blur-sm transition hover:bg-white/30"
          >
            <FaSyncAlt className="text-white" />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {[
            { label: "Pending", value: orders.length, icon: FaClock, color: "text-white" },
            { label: "Delivered", value: deliveredCount, icon: FaCheckCircle, color: "text-emerald-200" },
            { label: "Last Sync", value: lastRefresh ? lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "--:--", icon: FaSyncAlt, color: "text-white/80" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-2xl border border-white/20 bg-white/15 px-4 py-3 text-center backdrop-blur-sm">
              <div className={`text-xs font-medium uppercase tracking-wide ${color} opacity-80`}>{label}</div>
              <div className={`mt-1 text-xl font-black ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ready restaurant orders (pickup / mark served) */}
      <div className="mb-6">
        <ReadyOrdersPanel onNavigateToKitchen={() => navigate("/kitchen-dashboard")} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-lg font-semibold text-rose-700">
          {error}
        </div>
      )}

      {/* Order Cards */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-[22px] bg-white/60" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-slate-300 bg-white/70 p-10 text-center">
          <FaUtensils className="mx-auto mb-4 text-5xl text-slate-300" />
          <div className="text-2xl font-bold text-slate-700">No deliveries pending</div>
          <div className="mt-2 text-lg text-slate-500">
            New room-service orders will appear here automatically when assigned to you.
          </div>
          <div className="mt-4 text-base text-slate-400">
            Auto-refreshes every {POLL_INTERVAL / 1000} seconds.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id}>
              {/* Order Summary Header */}
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-700">
                    Room {order.room_number || order.table_number || "--"}
                  </span>
                  <span className="ml-2 text-sm text-slate-500">
                    Order #{order.id} · {order.items?.length || 0} items
                  </span>
                </div>
                <div className="text-xl font-black text-slate-900">
                  Rs.{" "}
                  {(
                    (order.items || []).reduce((sum, item) => {
                      return sum + Number(item.qty ?? 1) * Number(item.price || 0);
                    }, 0)
                  ).toLocaleString("en-IN")}
                </div>
              </div>

              {/* Items List */}
              <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold text-slate-600">Items</div>
                <div className="mt-1 space-y-1">
                  {(order.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-base">
                      <span className="text-slate-800">
                        {item.name || item.item_name} × {item.qty ?? item.quantity ?? 1}
                      </span>
                      <span className="font-semibold text-slate-700">
                        Rs. {Number(item.price || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assignment Card */}
              <WaiterAssignmentCard
                order={order}
                onDelivered={handleDelivered}
                assigneeOptions={[]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
