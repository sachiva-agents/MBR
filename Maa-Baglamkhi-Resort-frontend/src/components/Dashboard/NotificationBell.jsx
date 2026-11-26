import { useEffect, useRef, useState } from "react";
import {
  FaBell,
  FaCheck,
  FaCheckDouble,
  FaPlus,
  FaSpinner,
} from "react-icons/fa";

import API, { getErrorMessage } from "../../api";

/**
 * Live notification bell (HAG-12, gap 1).
 *
 * Wires the REST notification center:
 *   GET  /api/notifications          -> the list shown in the dropdown
 *   POST /api/notifications/:id/read -> "mark read" on a single item
 *   POST /api/notifications/mark-all-read
 *
 * Mounted in the app header next to the static dashboard bell. Purely
 * additive: it owns its own fetch + state and never touches the existing
 * dashboard-notifications flow.
 */
const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(null);
  const wrapRef = useRef(null);

  // Admin broadcast (POST /api/notifications) — the 4th gap route, folded
  // into the bell so the whole center stays one surface.
  const isAdmin = (localStorage.getItem("role") || "").toLowerCase() === "admin";
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcast, setBroadcast] = useState({ user_role: "admin", type: "announcement", title: "", message: "" });
  const [sending, setSending] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await API.get("/notifications");
      setItems(Array.isArray(res.data) ? res.data : []);
      setError("");
    } catch (err) {
      console.error("Failed to load notifications:", err);
      setError(getErrorMessage(err, "Notifications unavailable"));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!open) return;
    load(true);

    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unreadCount = items.filter((n) => !n.is_read && !n.isRead).length;

  const markRead = async (id) => {
    setActing(id);
    try {
      await API.post(`/notifications/${id}/read`);
      setItems((prev) =>
        prev.map((n) => (String(n.id) === String(id) ? { ...n, is_read: 1 } : n))
      );
    } catch (err) {
      setError(getErrorMessage(err, "Could not mark notification read"));
    } finally {
      setActing(null);
    }
  };

  const markAll = async () => {
    setActing("__all__");
    try {
      await API.post("/notifications/mark-all-read");
      setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    } catch (err) {
      setError(getErrorMessage(err, "Could not mark all read"));
    } finally {
      setActing(null);
    }
  };

  const sendBroadcast = async () => {
    if (!broadcast.title.trim() || !broadcast.message.trim()) {
      setError("Title and message are required for a broadcast.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await API.post("/notifications", {
        user_id: null, // broadcast to the role, not one user
        user_role: broadcast.user_role || "admin",
        type: broadcast.type || "announcement",
        title: broadcast.title.trim(),
        message: broadcast.message.trim(),
      });
      setShowBroadcast(false);
      setBroadcast((b) => ({ ...b, title: "", message: "" }));
      load(true);
    } catch (err) {
      setError(getErrorMessage(err, "Could not send notification"));
    } finally {
      setSending(false);
    }
  };

  const timeLabel = (value) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Live notifications"
        title="Live notifications"
        className="group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-violet-200/80 bg-violet-50/90 text-violet-600 shadow-[0_12px_28px_rgba(124,58,237,0.10)] transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-100/90 sm:h-12 sm:w-12 md:h-14 md:w-14"
      >
        <FaBell className="text-base sm:text-lg md:text-xl" />
        {unreadCount ? (
          <span className="absolute right-0.5 top-0.5 inline-flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-violet-600 px-1 text-[9px] font-bold leading-none text-white shadow-sm sm:right-1.5 sm:top-1.5 sm:min-h-[18px] sm:min-w-[18px] sm:text-[10px]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-violet-300 ring-2 ring-white sm:right-1.5 sm:top-1.5" />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+10px)] z-[99998] w-[min(92vw,420px)] overflow-hidden rounded-[22px] border border-violet-100 bg-white p-3 shadow-[0_24px_58px_rgba(15,23,42,0.16)] sm:p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-500 sm:text-xs">
                Live Feed
              </p>
              <h3 className="text-base font-bold text-slate-900 sm:text-lg">
                System notifications
              </h3>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={acting === "__all__"}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
              >
                {acting === "__all__" ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <FaCheckDouble />
                )}
                Mark all read
              </button>
            )}
          </div>

          {error && (
            <div className="mb-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700">
              {error}
            </div>
          )}

          {/* Admin broadcast (POST /notifications) */}
          {isAdmin && (showBroadcast ? (
            <div className="mb-3 space-y-2 rounded-[16px] border border-violet-200 bg-violet-50/60 p-3">
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-violet-600">
                Send announcement
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="w-full rounded-[10px] border border-violet-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-800 outline-none focus:border-violet-400"
                  placeholder="Audience role"
                  value={broadcast.user_role}
                  onChange={(e) => setBroadcast((b) => ({ ...b, user_role: e.target.value }))}
                />
                <input
                  className="w-full rounded-[10px] border border-violet-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-800 outline-none focus:border-violet-400"
                  placeholder="Type"
                  value={broadcast.type}
                  onChange={(e) => setBroadcast((b) => ({ ...b, type: e.target.value }))}
                />
                <input
                  className="w-full rounded-[10px] border border-violet-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-800 outline-none focus:border-violet-400"
                  placeholder="Title *"
                  value={broadcast.title}
                  onChange={(e) => setBroadcast((b) => ({ ...b, title: e.target.value }))}
                />
                <input
                  className="w-full rounded-[10px] border border-violet-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-800 outline-none focus:border-violet-400"
                  placeholder="Message *"
                  value={broadcast.message}
                  onChange={(e) => setBroadcast((b) => ({ ...b, message: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={sendBroadcast}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-violet-700 disabled:opacity-60"
                >
                  {sending ? <FaSpinner className="animate-spin" /> : <FaCheck />} Send
                </button>
                <button
                  type="button"
                  onClick={() => setShowBroadcast(false)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[12px] font-bold text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowBroadcast(true)}
              className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-violet-300 bg-white px-3 py-2 text-[13px] font-bold text-violet-700 transition hover:bg-violet-50"
            >
              <FaPlus /> New announcement
            </button>
          ))}

          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {items.length ? (
              items.map((item) => {
                const isRead = Boolean(item.is_read || item.isRead);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => !isRead && markRead(item.id)}
                    className={`flex w-full min-w-0 items-start justify-between gap-3 rounded-[16px] border px-3 py-2.5 text-left transition sm:px-3.5 ${
                      isRead
                        ? "border-slate-100 bg-slate-50/70 opacity-70 hover:opacity-100"
                        : "border-violet-200 bg-violet-50/70 hover:bg-violet-100/70"
                    }`}
                    title={isRead ? undefined : "Click to mark read"}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${isRead ? "bg-slate-300" : "bg-violet-500"}`}
                        />
                        <span className="truncate text-[15px] font-bold text-slate-900">
                          {item.title || item.type || "Notification"}
                        </span>
                      </div>
                      {item.message && (
                        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-500">
                          {item.message}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] font-semibold text-slate-400">
                        {timeLabel(item.created_at || item.createdAt)}
                      </p>
                    </div>
                    {!isRead && acting !== item.id && (
                      <FaCheck className="mt-1 shrink-0 text-[11px] text-violet-400" />
                    )}
                    {acting === item.id && (
                      <FaSpinner className="mt-1 shrink-0 animate-spin text-[11px] text-violet-500" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-[13px] font-semibold text-slate-400 sm:py-6">
                {loading ? "Loading notifications…" : "No notifications yet."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
