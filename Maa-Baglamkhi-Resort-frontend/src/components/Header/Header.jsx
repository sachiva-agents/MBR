import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  FaBars,
  FaBell,
  FaChevronDown,
  FaCog,
  FaSearch,
  FaSignOutAlt,
  FaTimes,
  FaUserCircle,
} from "react-icons/fa";

import { getDashboardNotifications } from "../Dashboard/dashboardNotifications";
import { getDashboardSearchResults } from "../../utils/dashboardSearch";
import NotificationBell from "../Dashboard/NotificationBell";

const Header = ({
  setIsAuthenticated,
  sidebarOffset = 0,
  isMobile = false,
  sidebarOpen = false,
  setSidebarOpen = () => {},
}) => {
  const navigate = useNavigate();
  const headerActionsRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const userName = localStorage.getItem("name") || "Admin User";
  const userRole = localStorage.getItem("role") || "admin";
  const avatarUrl = localStorage.getItem("avatarUrl") || "";

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Safe portal render - only when body exists
  const renderPortal = (children) => {
    if (!isMounted || typeof document === 'undefined' || !document.body) return null;
    return createPortal(children, document.body);
  };

  useEffect(() => {
    const syncNotifications = () => {
      setNotifications(getDashboardNotifications());
    };

    syncNotifications();
    window.addEventListener("dashboard-notifications-updated", syncNotifications);
    window.addEventListener("storage", syncNotifications);

    return () => {
      window.removeEventListener("dashboard-notifications-updated", syncNotifications);
      window.removeEventListener("storage", syncNotifications);
    };
  }, []);

  useEffect(() => {
    setAvatarError(false);
  }, [avatarUrl]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (headerActionsRef.current && !headerActionsRef.current.contains(event.target)) {
        setNotificationMenuOpen(false);
        setProfileMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setNotificationMenuOpen(false);
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("avatarUrl");

    if (setIsAuthenticated) {
      setIsAuthenticated(false);
    }

    navigate("/login");
  };

  const handleMenuAction = (path, options) => {
    setNotificationMenuOpen(false);
    setProfileMenuOpen(false);
    navigate(path, options);
  };

  const handleNotificationClick = (item) => {
    setNotificationMenuOpen(false);
    if (item?.route) {
      navigate(item.route);
    }
  };

  const unreadCount = notifications.length;
  const searchResults = useMemo(() => getDashboardSearchResults(searchQuery), [searchQuery]);

  const openSearchTarget = (target) => {
    setSearchQuery("");
    setSearchFocused(false);
    if (!target?.route) return;
    navigate(target.route);
  };

  return (
    <header
      className="fixed top-0 z-50 flex w-full flex-col overflow-x-visible rounded-b-[26px] border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,249,252,0.96))] px-3 pb-5 pt-2 text-slate-900 shadow-[0_10px_34px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-none sm:px-4 sm:pb-3 sm:pt-3 md:h-[92px] md:flex-row md:items-center md:justify-between md:overflow-x-hidden md:px-6 md:py-4 lg:px-7"
      style={{
        left: isMobile ? 0 : sidebarOffset,
        width: isMobile ? "100%" : `calc(100% - ${sidebarOffset}px)`,
      }}
    >
      {/* Row 1 on mobile: logo + name (left), notification/profile (right). On md+, display:contents lets both
          children become direct flex items of the header row, exactly matching the original desktop layout. */}
      <div className="flex w-full items-center justify-between gap-2 md:contents">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4 lg:gap-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {/* Hamburger moved to the floating mobile search row below (md:hidden there). On md+ it
                never rendered here in the first place, so desktop layout is untouched. */}

            <div className="flex aspect-square h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 shadow-lg ring-1 ring-slate-900/10 sm:h-10 sm:w-10 sm:rounded-2xl md:h-12 md:w-12">
              <img
                className="h-full w-full object-cover"
                src="https://www.maabaglamukhinalkehda.com/assets/images/maa2.jpg"
                alt="Logo"
              />
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[15px] font-bold text-slate-900 sm:text-lg md:text-xl lg:text-[19px] xl:text-[20px]">
                Maa Baglamukhi Resort
              </h1>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 md:flex md:justify-center">
            <div className="relative w-full max-w-3xl">
              <label className="group relative block">
                <span className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex items-center pl-4 text-slate-400 transition group-focus-within:text-sky-600 lg:pl-5">
                  <FaSearch className="text-sm lg:text-base" />
                </span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && searchResults.length) {
                      openSearchTarget(searchResults[0]);
                    }
                  }}
                  placeholder="Search..."
                  className="h-12 w-full min-w-0 rounded-full border border-slate-200/90 bg-white/96 pl-11 pr-11 text-[15px] font-semibold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.06)] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-300 focus:ring-4 focus:ring-sky-100 lg:h-14 lg:pl-12 lg:pr-12 lg:text-[14px] xl:h-16"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 z-[1] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 lg:right-4 lg:h-8 lg:w-8"
                  >
                    <FaTimes className="text-[11px] lg:text-[13px]" />
                  </button>
                ) : null}
              </label>

              {searchFocused && (searchQuery || searchResults.length) ? (
                <div className="absolute left-0 right-0 top-full z-[90] mt-3 max-w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.2)] lg:rounded-[28px]">
                  <div className="max-h-[320px] overflow-y-auto p-2 lg:p-2.5">
                    {searchResults.length ? (
                      searchResults.map((target) => (
                        <button
                          key={target.route}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => openSearchTarget(target)}
                          className="flex w-full min-w-0 items-center justify-between gap-2 rounded-[18px] border border-slate-200/80 px-3 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50/60 lg:rounded-[20px] lg:px-4 lg:py-3.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-black text-black lg:text-base">{target.label}</div>
                            <div className="mt-1 truncate text-[13px] font-semibold text-slate-700 lg:text-sm">{target.helper}</div>
                          </div>
                          <span className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-black lg:px-3 lg:py-1.5 lg:text-xs">
                            Open
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-slate-300 px-3 py-4 text-[13px] font-semibold text-slate-700 lg:rounded-[20px] lg:px-4 lg:text-sm">
                        No page found. Try keywords like <span className="font-semibold text-slate-900">housekeeping</span>,
                        <span className="font-semibold text-slate-900"> booking</span>, <span className="font-semibold text-slate-900">accounts</span>.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-3 md:gap-4" ref={headerActionsRef}>
          {/* Live REST notification bell (HAG-12) — separate from the static dashboard bell */}
          <NotificationBell />

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotificationMenuOpen((open) => !open);
                setProfileMenuOpen(false);
              }}
              className="group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:text-sky-700 hover:shadow-[0_16px_36px_rgba(14,165,233,0.16)] focus:outline-none focus:ring-4 focus:ring-sky-100 sm:h-12 sm:w-12 sm:rounded-[20px] md:h-14 md:w-14"
              aria-haspopup="menu"
              aria-expanded={notificationMenuOpen}
              aria-label="Open notifications"
            >
              <FaBell className="text-lg sm:text-xl md:text-[24px]" />
              {unreadCount ? (
                <span className="absolute right-1 top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white shadow-[0_8px_18px_rgba(244,63,94,0.35)] sm:right-2 sm:top-2 sm:min-h-5 sm:min-w-5 sm:text-[10px]">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white sm:right-2.5 sm:top-2.5 sm:h-2.5 sm:w-2.5" />
              )}
            </button>

            {notificationMenuOpen && renderPortal(
              <div
                className="fixed left-1/2 top-[90px] z-[99999] w-[min(94vw,360px)] -translate-x-1/2 overflow-hidden rounded-[22px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(249,247,255,0.94)_100%)] p-3 shadow-[0_24px_58px_rgba(15,23,42,0.14)] backdrop-blur-xl sm:left-auto sm:right-4 sm:top-[92px] sm:w-[min(94vw,420px)] sm:-translate-x-0 sm:rounded-[26px] sm:p-4 md:w-[min(94vw,520px)] md:rounded-[30px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between sm:mb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-500 sm:text-sm md:tracking-[0.26em] md:text-base">
                      Notifications
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-slate-900 sm:text-xl md:text-2xl">Messages and updates</h3>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-700 sm:gap-2 sm:px-3 sm:text-lg md:text-xl">
                    <FaBell />
                    {unreadCount}
                  </span>
                </div>

                <div className="max-h-[280px] space-y-2.5 overflow-y-auto pr-1 sm:max-h-[360px] sm:space-y-3">
                  {notifications.length ? (
                    notifications.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => handleNotificationClick(item)}
                        className="w-full min-w-0 rounded-[16px] border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:rounded-[18px] sm:px-4"
                        role="menuitem"
                      >
                        <div className="flex items-start justify-between gap-2 sm:gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-slate-900 sm:text-lg md:text-xl">
                              {item.title || "Notification"}
                            </div>
                            <div className="mt-1 text-[13px] leading-5 text-slate-500 sm:text-sm">
                              {item.message || "New update available."}
                            </div>
                          </div>
                          <div className="shrink-0 rounded-full bg-slate-50 px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-400 sm:px-2.5 sm:text-[15px] sm:tracking-[0.16em]">
                            {new Date(item.createdAt || Date.now()).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500 sm:rounded-[18px] sm:px-4 sm:py-5 sm:text-sm">
                      No notifications yet.
                    </div>
                  )}
                </div>
              </div>,
              document.body
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileMenuOpen((open) => !open);
                setNotificationMenuOpen(false);
              }}
              className="group inline-flex min-w-0 items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white/95 px-1.5 py-1.5 text-left shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_16px_36px_rgba(14,165,233,0.16)] focus:outline-none focus:ring-4 focus:ring-sky-100 sm:gap-3 sm:rounded-[24px] sm:px-3 sm:py-2.5"
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-700 text-xs font-bold text-white shadow-[0_10px_24px_rgba(14,165,233,0.28)] ring-2 ring-white sm:h-10 sm:w-10 sm:text-sm md:h-12 md:w-12">
                {avatarUrl && !avatarError ? (
                  <img
                    src={avatarUrl}
                    alt={`${userName} avatar`}
                    className="h-full w-full object-cover"
                    onError={() => {
                      setAvatarError(true);
                    }}
                  />
                ) : (
                  (userName || "A").charAt(0).toUpperCase()
                )}
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="max-w-[110px] truncate text-[13px] font-semibold text-slate-900 md:max-w-[140px] md:text-sm">{userName}</p>
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:text-[14px] md:tracking-[0.16em]">
                  {userRole}
                </p>
              </div>
              <span
                className={`hidden text-slate-400 transition-transform duration-200 sm:inline-block ${profileMenuOpen ? "rotate-180 text-sky-600" : "group-hover:text-sky-600"}`}
              >
                <FaChevronDown className="text-xs md:text-sm" />
              </span>
            </button>

            {profileMenuOpen && renderPortal(
              <div
                className="fixed left-1/2 top-[90px] z-[99999] w-[min(88vw,15rem)] -translate-x-1/2 overflow-hidden rounded-[20px] border border-slate-200/80 bg-white/98 p-2 shadow-[0_22px_55px_rgba(15,23,42,0.16)] backdrop-blur-xl sm:left-auto sm:right-4 sm:top-[92px] sm:-translate-x-0 sm:rounded-[24px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 rounded-[16px] bg-slate-50 px-3 py-3 sm:rounded-[18px] sm:px-4">
                  <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    Manage your profile, preferences, and session.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleMenuAction("/profile")}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50 hover:text-sky-700 sm:rounded-[18px] sm:px-4"
                  role="menuitem"
                >
                  <FaUserCircle className="shrink-0 text-base" />
                  <span className="truncate">View Profile</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleMenuAction("/profile", {
                      state: { focusSection: "security" },
                    })
                  }
                  className="mt-1 flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50 hover:text-sky-700 sm:rounded-[18px] sm:px-4"
                  role="menuitem"
                >
                  <FaCog className="shrink-0 text-base" />
                  <span className="truncate">Settings</span>
                </button>

                <div className="my-2 h-px bg-slate-200" />

                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 sm:rounded-[18px] sm:px-4"
                  role="menuitem"
                >
                  <FaSignOutAlt className="shrink-0 text-base" />
                  <span className="truncate">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2 on mobile only: hamburger + search bar beneath the logo/actions row.
          Hidden at md and up, where the inline search bar (above) is used instead.
          The header's own background (rounded-b-[26px], extra pb-5 on mobile) now fully
          contains this row so the search bar reads as "floating" inside one premium card
          instead of spilling outside the header background. Increase the page content's
          top padding (in the layout that renders <Header />) to roughly match the header's
          taller mobile height so content doesn't start under it. */}
      <div className="relative z-50 mt-3 flex w-full items-center gap-3 px-1 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          aria-expanded={sidebarOpen}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-sky-300 bg-white text-sky-600 shadow-lg transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-100"
        >
          {sidebarOpen ? <FaTimes className="text-lg" /> : <FaBars className="text-lg" />}
        </button>

        <div className="relative min-w-0 flex-1">
          <label className="group relative block">
            <span className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex items-center pl-3.5 text-slate-400 transition group-focus-within:text-sky-600">
              <FaSearch className="text-sm" />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && searchResults.length) {
                  openSearchTarget(searchResults[0]);
                }
              }}
              placeholder="Search..."
              className="h-12 w-full min-w-0 rounded-full border border-slate-200/90 bg-white pl-10 pr-10 text-sm font-semibold text-slate-700 shadow-lg outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100 sm:h-[52px]"
            />
            {searchQuery ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 z-[1] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
              >
                <FaTimes className="text-[10px]" />
              </button>
            ) : null}
          </label>

          {searchFocused && (searchQuery || searchResults.length) ? (
            <div className="absolute left-0 right-0 top-full z-[90] w-full max-w-full overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_24px_50px_rgba(15,23,42,0.2)] mt-2">
              <div className="max-h-[280px] overflow-y-auto p-2">
                {searchResults.length ? (
                  searchResults.map((target) => (
                    <button
                      key={target.route}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openSearchTarget(target)}
                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-[16px] border border-slate-200/80 px-3 py-2.5 text-left transition hover:border-sky-200 hover:bg-sky-50/60"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-black">{target.label}</div>
                        <div className="mt-1 truncate text-xs font-semibold text-slate-700">{target.helper}</div>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-300 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-black">
                        Open
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="rounded-[16px] border border-dashed border-slate-300 px-3 py-4 text-xs font-semibold text-slate-700">
                    No page found. Try keywords like <span className="font-semibold text-slate-900">housekeeping</span>,
                    <span className="font-semibold text-slate-900"> booking</span>, <span className="font-semibold text-slate-900">accounts</span>.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
};

export default Header;