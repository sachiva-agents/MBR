import { useMemo, useEffect, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  FaBalanceScale,
  FaBell,
  FaBoxes,
  FaBroom,
  FaChartBar,
  FaChevronDown,
  FaClipboardList,
  FaCoins,
  FaDatabase,
  FaExchangeAlt,
  FaFire,
  FaGlassCheers,
  FaHistory,
  FaHome,
  FaHotel,
  FaListAlt,
  FaMoneyBillWave,
  FaShoppingCart,
  FaSignOutAlt,
  FaStar,
  FaTasks,
  FaTruck,
  FaUser,
  FaUserCheck,
  FaUtensils,
  FaWallet,
  FaWarehouse,
  FaWhatsapp,
} from "react-icons/fa";

import { getRoleHome, normalizeRole } from "../../utils/roleHome";
import useReadyOrdersCount from "../../hooks/useReadyOrdersCount";

const HEADER_HEIGHT = 92;

// Brand shown in the sidebar header. Adjust here if it should come from config/API later.
const BRAND_NAME = "Maa Baglamukhi";

const ROLE_LABEL_MAP = {
  admin: "Resort Admin",
  manager: "Hotel Manager",
  receptionist: "Receptionist",
  housekeeping: "Housekeeping Staff",
  accountant: "Accountant",
  kitchen: "Kitchen Staff",
  chef: "Chef",
  waiter: "Waiter",
  staff: "Staff",
};

// Fixed display order for grouped sections. Add more keys here if new sections are introduced.
const SECTION_ORDER = ["operations", "records"];
const SECTION_LABELS = {
  operations: "Operations",
  records: "Records",
};

const Sidebar = ({ isMobile, sidebarOpen, setSidebarOpen, setIsAuthenticated }) => {
  // NOTE: unchanged from the previous responsive pass — the mobile overlay,
  // slide-in transform, outside-click-to-close (overlay onClick), and
  // close-on-menu-select (handleNavClick below) already live in this file.
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredItem, setHoveredItem] = useState(null);
  const [hoveredControl, setHoveredControl] = useState(null);
  const [expandedItem, setExpandedItem] = useState(null);
  const readyOrdersCount = useReadyOrdersCount();

  const role = normalizeRole(localStorage.getItem("role"));
  const unreadNotificationCount = role === "waiter" ? readyOrdersCount : 0;

  const clearHoveredStates = () => {
    setHoveredItem(null);
    setHoveredControl(null);
  };

  const isControlHighlighted = (control) => hoveredControl === control;
  const isItemHighlighted = (id, active) => active || hoveredItem === id;

  const handlePointerHover = (value) => (event) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      value === "brand" || value === "avatar"
        ? setHoveredControl(value)
        : setHoveredItem(value);
    }
  };

  const clearPointerHover = (value) => (event) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      value === "brand" || value === "avatar"
        ? setHoveredControl((current) => (current === value ? null : current))
        : setHoveredItem((current) => (current === value ? null : current));
    }
  };

  const dashboardPath = getRoleHome(role);
  const roleLabel = ROLE_LABEL_MAP[role] || "Staff Member";
  const brandInitial = BRAND_NAME.trim().charAt(0).toUpperCase();

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

  // Each item can optionally declare a `section` ("operations" | "records").
  // Items without a `section` render ungrouped, directly under the header.
  //
  // IMPORTANT: every `id` below must be UNIQUE across the whole array.
  // Duplicate ids previously caused two buttons to highlight together
  // (e.g. "Banquet" and "Accounts" both used id 109).
  const roleMenuMap = {
    admin: [
      { id: 101, name: "Attendance", icon: FaUserCheck, path: "/attendance" },
      { id: 115, name: "Fingerprint Attendance", icon: FaUserCheck, path: "/zk-attendance", section: "operations" },
      { id: 102, name: "Hotel", icon: FaHotel, path: "/hotel", section: "operations" },
      { id: 103, name: "Restaurant POS", icon: FaUtensils, path: "/restaurant", section: "operations" },
      { id: 104, name: "Kitchen", icon: FaFire, path: "/kitchen", section: "operations" },
      { id: 105, name: "Housekeeping", icon: FaBroom, path: "/housekeeping", section: "operations" },
      { id: 106, name: "HK Notifications", icon: FaBell, path: "/housekeeping/notifications", section: "operations" },
      { id: 107, name: "Assignments", icon: FaTasks, path: "/assignments", section: "operations" },
      { id: 108, name: "Assign Notifications", icon: FaBell, path: "/assignment-notification", section: "operations" },
      { id: 109, name: "Banquet", icon: FaGlassCheers, path: "/banquet", section: "operations" },
      { id: 1090, name: "Accounts", icon: FaWallet, path: "/accounts", section: "records" },
      { id: 110, name: "Inventory", icon: FaBoxes, path: "/inventory", section: "records" },
      { id: 1102, name: "Inventory Masters", icon: FaWarehouse, path: "/inventory/masters", section: "records" },
      { id: 1103, name: "Menu Recipes", icon: FaUtensils, path: "/inventory/recipes", section: "records" },
      { id: 1101, name: "Chef Issues", icon: FaExchangeAlt, path: "/inventory/chef-issues", section: "records" },
      { id: 111, name: "Reports", icon: FaChartBar, path: "/reports", section: "records" },
      { id: 1110, name: "Reports Suite", icon: FaListAlt, path: "/reports/suite", section: "records" },
      { id: 112, name: "Audit Logs", icon: FaHistory, path: "/audit-logs", section: "records" },
      { id: 113, name: "User Management", icon: FaUserCheck, path: "/user", section: "records" },
      { id: 1131, name: "Print Management", icon: FaClipboardList, path: "/print", section: "records" },

      { id: 114, name: "Salary", icon: FaMoneyBillWave, path: "/salary", section: "records" },
      { id: 1141, name: "Payroll & Roles", icon: FaCoins, path: "/payroll", section: "records" },
      { id: 1115, name: "Backup & Restore", icon: FaDatabase, path: "/backup-settings", section: "records" },
    ],
    manager: [
      { id: 201, name: "All Bookings", icon: FaHotel, path: "/hotel/all-bookings", section: "operations" },
      { id: 101, name: "Attendance", icon: FaUserCheck, path: "/attendance" },
      { id: 202, name: "Housekeeping", icon: FaBroom, path: "/housekeeping", section: "operations" },
      { id: 203, name: "HK Notifications", icon: FaBell, path: "/housekeeping/notifications", section: "operations" },
      { id: 204, name: "Assignments", icon: FaTasks, path: "/assignments", section: "operations" },
      { id: 205, name: "Assign Notifications", icon: FaBell, path: "/assignment-notification", section: "operations" },
      { id: 206, name: "Banquet", icon: FaGlassCheers, path: "/banquet", section: "operations" },
      { id: 207, name: "Restaurant POS", icon: FaUtensils, path: "/restaurant", section: "operations" },
      { id: 208, name: "Accounts", icon: FaWallet, path: "/accounts", section: "records" },
      { id: 209, name: "Reports", icon: FaChartBar, path: "/reports", section: "records" },
      { id: 2090, name: "Reports Suite", icon: FaListAlt, path: "/reports/suite", section: "records" },
      { id: 210, name: "Inventory", icon: FaBoxes, path: "/inventory", section: "records" },
      { id: 2101, name: "Chef Issues", icon: FaExchangeAlt, path: "/inventory/chef-issues", section: "records" },
      { id: 211, name: "Audit Logs", icon: FaHistory, path: "/audit-logs", section: "records" },

    ],
    receptionist: [
      { id: 301, name: "Guest Booking", icon: FaHotel, path: "/hotel/guest", section: "operations" },
      // { id: 303, name: "Check-In / Out", icon: FaTasks, path: "/hotel/communication", section: "operations" },
      { id: 304, name: "Guest List", icon: FaUserCheck, path: "/hotel/booking-history", section: "operations" },
      { id: 305, name: "Housekeeping", icon: FaBroom, path: "/housekeeping", section: "operations" },
      { id: 306, name: "HK Notifications", icon: FaBell, path: "/housekeeping/notifications", section: "operations" },
      { id: 307, name: "Assignments", icon: FaClipboardList, path: "/assignments", section: "operations" },
      { id: 308, name: "Assign Notifications", icon: FaBell, path: "/assignment-notification", section: "operations" },
      { id: 309, name: "Banquet", icon: FaGlassCheers, path: "/banquet", section: "operations" },
      { id: 310, name: "Restaurant POS", icon: FaUtensils, path: "/restaurant", section: "operations" },
      { id: 311, name: "Inventory", icon: FaBoxes, path: "/inventory", section: "records",
        // children: [
        //   { id: 3110, name: "Categories", path: "/inventory/categories", icon: FaListAlt },
        //   { id: 3111, name: "Vendors", path: "/inventory/vendors", icon: FaTruck },
        //   { id: 3112, name: "Units", path: "/inventory/units", icon: FaBalanceScale },
        //   { id: 3113, name: "Items / Stock", path: "/inventory/items", icon: FaWarehouse },
        //   { id: 3114, name: "Menu Items", path: "/inventory/menu-items", icon: FaUtensils },
        //   { id: 3115, name: "Menu List", path: "/inventory/menu-list", icon: FaClipboardList },
        //   { id: 3116, name: "Purchase Invoices", path: "/inventory/purchases", icon: FaShoppingCart },
        //   { id: 3117, name: "Reports", path: "/inventory/reports", icon: FaChartBar },
        // ]
      },
    ],
    housekeeping: [
      { id: 401, name: "Room Status", icon: FaBroom, path: "/housekeeping", section: "operations" },
      { id: 402, name: "HK Notifications", icon: FaBell, path: "/housekeeping/notifications", section: "operations" },
      { id: 403, name: "Assignments", icon: FaClipboardList, path: "/assignments", section: "operations" },
      { id: 405, name: "Assign Notifications", icon: FaBell, path: "/assignment-notification", section: "operations" },
      { id: 406, name: "Cleaned Rooms", icon: FaUserCheck, path: "/housekeeping", section: "operations" },
    ],
    accountant: [
      { id: 501, name: "Assignments", icon: FaTasks, path: "/assignments", section: "operations" },
      { id: 502, name: "Assign Notifications", icon: FaBell, path: "/assignment-notification", section: "operations" },
      { id: 503, name: "Accounts", icon: FaWallet, path: "/accounts", section: "records" },
      { id: 504, name: "Reports", icon: FaChartBar, path: "/reports", section: "records" },
      { id: 5040, name: "Reports Suite", icon: FaListAlt, path: "/reports/suite", section: "records" },
      // { id: 505, name: "Inventory", icon: FaBoxes, path: "/inventory", section: "records",
      //   children: [
      //     { id: 5050, name: "Categories", path: "/inventory/categories", icon: FaListAlt },
      //     { id: 5051, name: "Vendors", path: "/inventory/vendors", icon: FaTruck },
      //     { id: 5052, name: "Units", path: "/inventory/units", icon: FaBalanceScale },
      //     { id: 5053, name: "Items / Stock", path: "/inventory/items", icon: FaWarehouse },
      //     { id: 5054, name: "Menu Items", path: "/inventory/menu-items", icon: FaUtensils },
      //     { id: 5055, name: "Menu List", path: "/inventory/menu-list", icon: FaClipboardList },
      //     { id: 5056, name: "Purchase Invoices", path: "/inventory/purchases", icon: FaShoppingCart },
      //     { id: 5057, name: "Reports", path: "/inventory/reports", icon: FaChartBar },
      //   ]
      // },
      { id: 506, name: "Audit Logs", icon: FaHistory, path: "/reports/audit", section: "records" },
    ],
    kitchen: [
      { id: 601, name: "Kitchen Dashboard", icon: FaFire, path: "/kitchen-dashboard", section: "operations" },
      { id: 602, name: "Restaurant POS", icon: FaUtensils, path: "/restaurant", section: "operations" },
      { id: "602k", name: "Raw Material", icon: FaExchangeAlt, path: "/chef/inventory", section: "operations" },
      { id: 603, name: "Inventory", icon: FaBoxes, path: "/inventory", section: "records",
        // children: [
        //   { id: 6031, name: "Categories", path: "/inventory/categories", icon: FaListAlt },
        //   { id: 6032, name: "Vendors", path: "/inventory/vendors", icon: FaTruck },
        //   { id: 6033, name: "Units", path: "/inventory/units", icon: FaBalanceScale },
        //   { id: 6034, name: "Items / Stock", path: "/inventory/items", icon: FaWarehouse },
        //   { id: 6035, name: "Menu Items", path: "/inventory/menu-items", icon: FaUtensils },
        //   { id: 6036, name: "Menu List", path: "/inventory/menu-list", icon: FaClipboardList },
        //   { id: 6037, name: "Purchase Invoices", path: "/inventory/purchases", icon: FaShoppingCart },
        //   { id: 6038, name: "Reports", path: "/inventory/reports", icon: FaChartBar },
        // ]
      },
    ],
    chef: [
      // { id: "601c", name: "Chef Dashboard", icon: FaFire, path: "/chef-dashboard", section: "operations" },
      // { id: "602c", name: "Kitchen Orders", icon: FaFire, path: "/kitchen", section: "operations" },
      { id: "602d", name: "Raw Material", icon: FaExchangeAlt, path: "/chef/inventory", section: "operations" },
      { id: "603c", name: "Inventory", icon: FaBoxes, path: "/inventory", section: "records",
        // children: [
        //   { id: "6031", name: "Categories", path: "/inventory/categories", icon: FaListAlt },
        //   { id: "6032", name: "Vendors", path: "/inventory/vendors", icon: FaTruck },
        //   { id: "6033", name: "Units", path: "/inventory/units", icon: FaBalanceScale },
        //   { id: "6034", name: "Items / Stock", path: "/inventory/items", icon: FaWarehouse },
        //   { id: "6035", name: "Menu Items", path: "/inventory/menu-items", icon: FaUtensils },
        //   { id: "6036", name: "Menu List", path: "/inventory/menu-list", icon: FaClipboardList },
        //   { id: "6037", name: "Purchase Invoices", path: "/inventory/purchases", icon: FaShoppingCart },
        //   { id: "6038", name: "Reports", path: "/inventory/reports", icon: FaChartBar },
        // ]
      },
    ],
    waiter: [
      { id: 700, name: "Restaurant Dashboard", icon: FaUtensils, path: "/restaurant-dashboard", section: "operations" },
      { id: 701, name: "Restaurant POS", icon: FaUtensils, path: "/restaurant", section: "operations" },
      { id: 702, name: "Live Board", icon: FaClipboardList, path: "/restaurant/live-board", section: "operations" },
    ],
    staff: [
      { id: 801, name: "Assignments", icon: FaTasks, path: "/assignments", section: "operations" },
      { id: 802, name: "Assign Notifications", icon: FaBell, path: "/assignment-notification", section: "operations" },
      { id: 803, name: "My Attendance", icon: FaUserCheck, path: "/my-attendance", section: "operations" },
    ],
  };

  const roleMenuItems = (roleMenuMap[role] || []).map((item) => ({
    ...item,
    badgeCount: role === "waiter" && item.path === "/restaurant" ? readyOrdersCount : 0,
  }));

  // A role whose home route no menu item already covers keeps the top
  // "Dashboard" entry, which links straight to its own home dashboard.
  const roleMenusOwnHome = roleMenuItems.some((item) => item.path === dashboardPath);
  const menuItems = [
    ...(roleMenusOwnHome ? [] : [{ id: 1, name: "Dashboard", icon: FaHome, path: dashboardPath }]),
    ...roleMenuItems,
    { id: 99, name: "My Profile", icon: FaUser, path: "/profile" },
  ];

  // Split into: ungrouped head items, grouped sections (fixed order), then My Profile at the end.
  const { headItems, groupedSections, profileItem } = useMemo(() => {
    const profile = menuItems.find((item) => item.id === 99) || null;
    const rest = menuItems.filter((item) => item.id !== 99);

    const head = rest.filter((item) => !item.section);
    const sections = SECTION_ORDER.map((key) => ({
      key,
      label: SECTION_LABELS[key],
      items: rest.filter((item) => item.section === key),
    })).filter((group) => group.items.length > 0);

    return { headItems: head, groupedSections: sections, profileItem: profile };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleMenuItems, dashboardPath]);

  // Flat list of every navigable (non-parent) item, used to work out which
  // single button is "active" for the current route.
  const flatNavItems = useMemo(
    () => [...headItems, ...groupedSections.flatMap((g) => g.items), ...(profileItem ? [profileItem] : [])],
    [headItems, groupedSections, profileItem]
  );

  // FIX: previously every item whose path was a *prefix* of the current
  // pathname was marked active independently (e.g. "/inventory" matches
  // "/inventory/chef-issues"), so two buttons ("Inventory" and
  // "Chef Issues") lit up together for one click/hover.
  //
  // Now we pick exactly ONE winner: the item whose path is the longest
  // (i.e. most specific) match for the current pathname. Only that item
  // is marked active; every other item — even if its path is a partial
  // prefix — stays un-highlighted.
  const activeNavId = useMemo(() => {
    const pathname = location.pathname;
    let bestId = null;
    let bestLength = -1;

    flatNavItems.forEach((item) => {
      if (!item.path) return;
      const isExact = pathname === item.path;
      const isPrefix = pathname.startsWith(`${item.path}/`);
      if ((isExact || isPrefix) && item.path.length > bestLength) {
        bestLength = item.path.length;
        bestId = item.id;
      }
    });

    return bestId;
  }, [flatNavItems, location.pathname]);

  // Auto-expand any parent whose child matches the active route (unless user has manually collapsed).
  useEffect(() => {
    const allItems = [
      ...(groupedSections || []).flatMap((g) => g.items),
      ...(headItems || []),
    ];
    for (const item of allItems) {
      if (item.children && isChildActive(item.children)) {
        setExpandedItem((prev) => prev ?? item.id);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedSections, headItems, location.pathname]);

  const handleNavClick = (path) => {
    navigate(path);

    if (isMobile) {
      setSidebarOpen(false);
      return;
    }

    if (!sidebarOpen && setSidebarOpen) {
      setSidebarOpen(true);
    }
  };

  const toggleExpand = (itemId) => {
    setExpandedItem((prev) => (prev === itemId ? null : itemId));
  };

  const isActive = (path) => {
    if (location.pathname === path) {
      return true;
    }

    return Boolean(matchPath({ path: `${path}/*`, end: false }, location.pathname));
  };

  const isChildActive = (children) => {
    if (!children || !Array.isArray(children)) return false;
    return children.some((child) => isActive(child.path));
  };

  const showLabels = sidebarOpen;

  const renderNavButton = (item) => {
    const Icon = item.icon;
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    const isExpanded = expandedItem === item.id;
    // A parent with children is "active" if any child route matches.
    // A leaf item is active only if it WON the longest-match comparison
    // above — this guarantees exactly one leaf is active at a time.
    const groupActive = hasChildren ? isChildActive(item.children) : false;
    const active = hasChildren ? groupActive : item.id === activeNavId;
    const hovered = hoveredItem === item.id;
    const highlighted = isItemHighlighted(item.id, active);
    const showBadge = item.badgeCount > 0;

    const handleClick = () => {
      if (hasChildren) {
        toggleExpand(item.id);
        // Also navigate to the parent path so child routes don't strand the user
        if (item.path) {
          handleNavClick(item.path);
        }
      } else {
        handleNavClick(item.path);
      }
    };

    return (
      <div key={item.id} className="w-full">
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => setHoveredItem(item.id)}
          onMouseMove={() => setHoveredItem(item.id)}
          onMouseLeave={() => setHoveredItem(null)}
          onPointerEnter={handlePointerHover(item.id)}
          onPointerMove={handlePointerHover(item.id)}
          onPointerLeave={clearPointerHover(item.id)}
          onFocus={() => setHoveredItem(item.id)}
          onBlur={() => setHoveredItem(null)}
          onTouchStart={() => setHoveredItem(item.id)}
          onTouchEnd={clearHoveredStates}
          onTouchCancel={clearHoveredStates}
          title={!showLabels ? item.name : undefined}
          className={`
            sidebar-nav-button group relative isolate flex min-h-[44px] w-full cursor-pointer items-center overflow-hidden rounded-2xl border transition-all duration-300
            ${
              showLabels
                ? "justify-start gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3"
                : "justify-center px-2.5 py-2.5 sm:px-3 sm:py-3"
            }
            ${
              highlighted
                ? "is-highlighted border-blue-400/60 bg-white/[0.03] text-white shadow-[0_14px_28px_rgba(37,99,235,0.3)]"
                : "border-transparent bg-white/[0.03] text-slate-200 hover:border-blue-400/40 hover:text-white hover:shadow-[0_14px_28px_rgba(37,99,235,0.25)]"
            }
            ${hovered && !active ? "scale-[1.01] border-blue-400/40 text-white shadow-[0_14px_28px_rgba(37,99,235,0.3)]" : ""}
          `}
        >
          <span
            aria-hidden="true"
            className={`sidebar-nav-fill absolute inset-0 rounded-2xl bg-[linear-gradient(270deg,#2563eb_0%,#2f6df6_48%,#4f8dff_100%)] ${
              highlighted ? "scale-x-100" : ""
            }`}
          />
          <span
            className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300 sm:h-10 sm:w-10 lg:h-11 lg:w-11 ${
              highlighted
                ? "bg-white/18 text-white"
                : "bg-slate-800/80 text-slate-100 group-hover:bg-white/18 group-hover:text-white"
            }`}
          >
            <Icon className="text-xl" />
            {showBadge ? (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-black text-white ring-2 ring-[#0b1728]">
                {item.badgeCount > 9 ? "9+" : item.badgeCount}
              </span>
            ) : null}
          </span>
          {showLabels ? (
            <span className="relative z-10 min-w-0 flex-1 truncate text-left text-sm font-semibold leading-tight text-white sm:text-[15px] lg:text-base">
              {item.name}
            </span>
          ) : null}
          {showLabels && hasChildren ? (
            <FaChevronDown
              className={`relative z-10 text-xs text-slate-400 transition-transform duration-300 ${
                isExpanded ? "rotate-180 text-white" : ""
              }`}
            />
          ) : null}
        </button>

        {/* Children - only render when expanded OR active child */}
        {hasChildren && showLabels && (isExpanded || groupActive) ? (
          <div className="mt-1 ml-3 space-y-1 border-l border-white/10 pl-2">
            {item.children.map((child) => {
              const ChildIcon = child.icon;
              const childActive = isActive(child.path);
              return (
                <button
                  key={child.id || child.path}
                  type="button"
                  onClick={() => handleNavClick(child.path)}
                  onMouseEnter={() => setHoveredItem(`${item.id}-${child.path}`)}
                  onMouseLeave={() => setHoveredItem(null)}
                  title={!showLabels ? child.name : undefined}
                  className={`flex min-h-[36px] w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[13px] font-semibold transition-all duration-200 ${
                    childActive
                      ? "bg-white/10 text-white shadow-[0_8px_18px_rgba(37,99,235,0.18)]"
                      : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  {ChildIcon ? (
                    <ChildIcon
                      className={`text-[13px] ${childActive ? "text-blue-300" : "text-slate-400"}`}
                    />
                  ) : null}
                  <span className="truncate">{child.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderSectionLabel = (label) =>
    showLabels ? (
      <p className="truncate px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:px-3 sm:text-xs">
        {label}
      </p>
    ) : (
      <div className="my-2 h-px w-8 self-center bg-white/10" />
    );

  return (
    <>
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 transition-opacity duration-300"
          style={{ top: `${HEADER_HEIGHT}px` }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`
          desktop-scale-sidebar
          fixed bottom-0 left-0 top-0 z-40
          flex flex-col
          border-r border-slate-800/80 bg-[linear-gradient(180deg,#07111f_0%,#0b1728_52%,#09101b_100%)]
          text-slate-200 shadow-[0_18px_40px_rgba(2,8,23,0.45)]
          transition-all duration-300 ease-in-out
          overflow-hidden overflow-x-hidden
          ${isMobile ? "w-[82vw] max-w-[300px]" : sidebarOpen ? "w-[240px] lg:w-[250px]" : "w-[76px] lg:w-[88px]"}
        `}
      style={{
  top: isMobile ? "120px" : undefined,
  height: isMobile ? "calc(100dvh - 120px)" : undefined,
  transform: isMobile && !sidebarOpen ? "translateX(-100%)" : "translateX(0)",
}}
      >
        <style>{`
          .sidebar-scroll::-webkit-scrollbar { width: 6px; }
          .sidebar-scroll::-webkit-scrollbar-track { background: #0f172a; }
          .sidebar-scroll::-webkit-scrollbar-thumb { background: #192034; border-radius: 10px; }
          .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #1d4ed8; }
          .sidebar-nav-fill {
            transform: scaleX(0);
            transform-origin: left center;
            transition: transform 420ms ease, opacity 420ms ease;
            opacity: 0.92;
          }
          .sidebar-nav-button:hover .sidebar-nav-fill,
          .sidebar-nav-button:focus-visible .sidebar-nav-fill,
          .sidebar-nav-button.is-highlighted .sidebar-nav-fill {
            transform: scaleX(1);
          }
        `}</style>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.14),transparent_30%)]" />
        <div className="relative flex h-full min-h-0 flex-col overflow-x-hidden px-2.5 pb-0 pt-2.5 sm:px-3 sm:pt-3">
          {/* Brand header — click toggles the sidebar, same as the old Menu control */}
          <div className="-mx-2.5 shrink-0 border-b border-white/10 px-2.5 pb-2.5 sm:-mx-3 sm:px-3 sm:pb-3">
            <button
              type="button"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              onClick={() => setSidebarOpen((prev) => !prev)}
              onMouseEnter={() => setHoveredControl("brand")}
              onMouseMove={() => setHoveredControl("brand")}
              onMouseLeave={() => setHoveredControl(null)}
              onPointerEnter={handlePointerHover("brand")}
              onPointerMove={handlePointerHover("brand")}
              onPointerLeave={clearPointerHover("brand")}
              onFocus={() => setHoveredControl("brand")}
              onBlur={() => setHoveredControl(null)}
              onTouchStart={() => setHoveredControl("brand")}
              onTouchEnd={clearHoveredStates}
              onTouchCancel={clearHoveredStates}
              className={`flex min-h-[44px] w-full items-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm transition-all duration-300 hover:border-blue-400/50 hover:bg-white/[0.09] ${
                showLabels
                  ? "justify-start gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-3 sm:py-3"
                  : "justify-center px-2 py-2.5 sm:py-3"
              } ${isControlHighlighted("brand") ? "border-blue-400/50 bg-white/[0.09]" : ""}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(160deg,#f2b73f_0%,#c9861a_100%)] text-base font-black text-[#241503] shadow-[0_6px_14px_rgba(201,134,26,0.35)] sm:h-10 sm:w-10 sm:text-lg lg:h-11 lg:w-11">
                {brandInitial}
              </span>
              {showLabels ? (
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-base font-bold leading-tight text-white sm:text-lg lg:text-[15px]">
                    {BRAND_NAME}
                  </span>
                  <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {roleLabel}
                  </span>
                </span>
              ) : null}
            </button>

            {role === "waiter" && (
              <button
                type="button"
                onClick={() => navigate("/restaurant/notifications")}
                className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-bold text-slate-200 transition-all duration-300 hover:border-blue-400/50 hover:bg-white/[0.09] hover:text-white"
              >
                🔔
                {showLabels && <span>Notifications</span>}
                {unreadNotificationCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">
                    {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                  </span>
                )}
              </button>
            )}
            {role === "chef" && (
              <button
                type="button"
                onClick={() => navigate("/chef-dashboard")}
                className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-bold text-slate-200 transition-all duration-300 hover:border-blue-400/50 hover:bg-white/[0.09] hover:text-white"
              >
                🔔
                {showLabels && <span>Notifications</span>}
                {unreadNotificationCount > 0 && (
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">
                    {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
                  </span>
                )}
              </button>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            <nav
              className={`sidebar-scroll mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden font-bold ${
                showLabels ? "px-1 py-0 pr-2.5 sm:pr-3" : "items-center px-0 py-0 pr-2"
              }`}
              style={{ scrollbarGutter: "stable" }}
            >
              <div className="space-y-2">{headItems.map(renderNavButton)}</div>

              {groupedSections.map((group) => (
                <div key={group.key} className="mt-1">
                  {renderSectionLabel(group.label)}
                  <div className="space-y-2">{group.items.map(renderNavButton)}</div>
                </div>
              ))}

              {profileItem ? (
                <div className="mt-1">
                  {renderSectionLabel("Account")}
                  <div className="space-y-2">{renderNavButton(profileItem)}</div>
                </div>
              ) : null}
            </nav>

            {/* Logout sits naturally after the scroll area — no absolute positioning,
                so there is never leftover empty space beneath it. Safe-area padding
                keeps the panel's background filling the strip below the button on
                phones with a home-indicator inset instead of exposing raw black. */}
            <div
              className={`relative z-10 mt-2 shrink-0 border-t border-white/10 bg-[#09101b] pt-2.5 sm:pt-3 ${
                showLabels ? "px-2.5 sm:px-3" : "flex justify-center px-2"
              }`}
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <button
                type="button"
                onClick={handleLogout}
                onMouseEnter={() => setHoveredControl("logout")}
                onMouseMove={() => setHoveredControl("logout")}
                onMouseLeave={() => setHoveredControl(null)}
                onPointerEnter={handlePointerHover("logout")}
                onPointerMove={handlePointerHover("logout")}
                onPointerLeave={clearPointerHover("logout")}
                onFocus={() => setHoveredControl("logout")}
                onBlur={() => setHoveredControl(null)}
                onTouchStart={() => setHoveredControl("logout")}
                onTouchEnd={clearHoveredStates}
                onTouchCancel={clearHoveredStates}
                title="Logout"
                className={`flex min-h-[44px] w-full items-center rounded-2xl border transition-all duration-300 ${
                  showLabels
                    ? "cursor-pointer gap-2 bg-rose-500/14 px-2.5 py-2.5 text-left hover:border-rose-400/80 hover:bg-rose-500/18 sm:px-3 sm:py-3"
                    : "cursor-pointer justify-center bg-rose-500/14 p-2.5 hover:border-rose-400/80 hover:bg-rose-500/18 sm:p-3"
                } ${
                  isControlHighlighted("logout")
                    ? "border-rose-400/90 bg-rose-500/20 shadow-[0_14px_28px_rgba(244,63,94,0.25)]"
                    : "border-rose-400/40"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-100 sm:h-10 sm:w-10">
                  <FaSignOutAlt className="text-xl" />
                </div>
                {showLabels ? (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-tight text-white">Logout</p>
                    <p className="truncate text-[11px] font-medium leading-tight text-rose-100/80">
                      End your current session
                    </p>
                  </div>
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;