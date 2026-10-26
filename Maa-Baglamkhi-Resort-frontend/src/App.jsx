import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, Outlet } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import API from "./api";
import { RestaurantProvider } from "./Context/RestaurantContext.jsx";
import DashboardFooter from "./components/Dashboard/DashboardFooter";
import Header from "./components/Header/Header";
import InventoryDashboard from "./components/Inventory/InventoryDashboard";
import InventoryHubPage from "./pages/InventoryHubPage";
import InventoryMastersModulePage from "./pages/InventoryMastersModulePage";
import InventoryProcurementPage from "./pages/InventoryProcurementPage";
import InventoryItemsPage from "./pages/InventoryItemsPage";
import InventoryVendorsPage from "./pages/InventoryVendorsPage";
import InventoryPurchasesPage from "./pages/InventoryPurchasesPage";
import InventoryReportsPage from "./pages/InventoryReportsPage";
import InventoryUnitsPage from "./pages/InventoryUnitsPage";
import InventoryCategoriesPage from "./pages/InventoryCategoriesPage";
import InventoryStockCategoriesPage from "./pages/InventoryStockCategoriesPage";
import InventoryMenuItemsPage from "./pages/InventoryMenuItemsPage";
import InventoryMenuListPage from "./pages/InventoryMenuListPage";
import MenuRecipeModulePage from "./pages/MenuRecipeModulePage";
import ProtectedRoute from "./components/ProtectedRoute";
import AddMenuItemPage from "./components/Restaurant/AddMenuItemPage";
import EditToken from "./components/Restaurant/EditToken";
import MenuPage from "./components/Restaurant/MenuPage";
import Payment from "./components/Restaurant/Payment";
import PaymentBills from "./components/Restaurant/PaymentBills";
import PayNowPage from "./components/Restaurant/PayNowPage";
import Roomitem from "./components/Restaurant/Roomitem";
import TablePage from "./components/Restaurant/TablePage";
import TokenItemsPage from "./components/Restaurant/TokenItempage";
import TokenPage from "./components/Restaurant/TokenPage";
import Sidebar from "./components/Sidebar/Sidebar";
import RoleHomeRedirect from "./components/RoleHomeRedirect";
import Stayover from "./components/Dashboard/Stayover";
import Accounts from "./pages/Accounts";
import BankReconciliation from "./pages/BankReconciliation";
import ReconciliationDataPage from "./pages/ReconciliationDataPage";
import AccountsCustomerInvoices from "./pages/AccountsCustomerInvoices";
import AccountsDashboard from "./pages/AccountsDashboard";
import AuditLogs from "./pages/AuditLogs";
import BackupSettings from "./pages/BackupSettings";
import Assignment from "./pages/Assignments";
import AssignmentNotification from "./pages/assignmentnotification";
import Attendance from "./pages/Attendance";
import ZkAttendance from "./pages/ZkAttendance";
import Payroll from "./pages/Payroll";
import SalaryManagement from "./pages/SalaryManagement";
import MyAttendance from "./pages/MyAttendance";
import Banquet from "./pages/Banquet";
import CustomerInvoicePage from "./pages/CustomerInvoicePage";
import Dashboard from "./pages/Dashboard";
import Hotel from "./pages/Hotel";
import Housekeeping from "./pages/Housekeeping";
import HousekeepingDashboard from "./pages/HousekeepingDashboard";
import HousekeeperNotification from "./pages/housekeepernotification";
import Kitchen from "./pages/Kitchen";
import KitchenDashboard from "./pages/KitchenDashboard";
import ChefDashboard from "./pages/ChefDashboard";
import ChefInventoryPage from "./pages/ChefInventoryPage";
import AdminChefIssuePage from "./pages/AdminChefIssuePage";
import WaiterDeliveryQueue from "./pages/WaiterDeliveryQueue";
import Login from "./pages/Login";
import ManagerDashboard from "./pages/ManagerDashboard";
import Profile from "./pages/Profile";
import ReceptionDashboard from "./pages/ReceptionDashboard";
import Register from "./pages/Register";
import Reports from "./pages/Reports";
import RestaurantDashboard from "./pages/RestaurantDashboard";
import RestaurantPOS from "./pages/RestaurantPOS";
import WaiterNotifications from "./pages/WaiterNotifications";
import LiveBoard from "./pages/LiveBoard";
import PrintManagement from "./pages/PrintManagement";
import StaffDashboard from "./pages/StaffDashboard";
import User from "./pages/User";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "./components/ErrorBoundary";
import AuditReport from "./pages/reports/AuditReport";
import CollectionReport from "./pages/reports/CollectionReport";
import DaywiseCollection from "./pages/reports/DaywiseCollection";
import IncomeExpenditure from "./pages/reports/IncomeExpenditure";
import SalesReport from "./pages/reports/SalesReport";
import ReportsSuite from "./pages/reports/ReportsSuite";

function isValidSession(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      data.id &&
      data.role
  );
}

const ROLES = {
  ALL: ["admin", "manager", "receptionist", "waiter", "kitchen", "chef", "housekeeping", "accountant", "staff"],
  ADMIN_ONLY: ["admin"],
  HOTEL: ["admin", "manager", "receptionist", "accountant", "housekeeping", "staff"],
  RESTAURANT: ["admin", "manager", "waiter", "kitchen", "staff", "receptionist"],
  KITCHEN: ["admin", "manager", "kitchen", "chef"],
  ACCOUNTS: ["admin", "manager", "accountant"],
  INVENTORY: ["admin", "manager", "kitchen", "chef", "receptionist"],
  HOUSEKEEPING: ["admin", "manager", "housekeeping", "receptionist"],
  BANQUET: ["admin", "manager", "receptionist"],
  REPORTS: ["admin", "manager", "accountant"],
  AUDIT: ["admin", "manager", "accountant"],
  ASSIGNMENTS: ["admin", "manager", "receptionist", "housekeeping", "accountant", "staff"],
  ASSIGNMENT_NOTIFICATIONS: ["admin", "manager", "receptionist", "housekeeping", "accountant", "staff"],
  CHEF_ISSUE_ADMIN: ["admin", "manager"],
  CHEF_ISSUE_SELF: ["chef", "kitchen"],
};

const HEADER_HEIGHT = 92;
const HEADER_CONTENT_GAP = 18;

function Layout({ children, setIsAuthenticated, fullWidth }) {
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [footerOverlap, setFooterOverlap] = useState(0);
  const scrollContainerRef = useRef(null);
  const sidebarWidth = isMobile ? 0 : sidebarOpen ? 250 : 88;
  const showDashboardFooter = location.pathname === "/dashboard";

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!showDashboardFooter || isMobile) {
      setFooterOverlap(0);
      return undefined;
    }

    const syncFooterOverlap = () => {
      const scrollContainer = scrollContainerRef.current;
      const footer = document.getElementById("dashboard-footer");
      if (!footer || !scrollContainer) {
        setFooterOverlap(0);
        return;
      }

      const footerRect = footer.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const overlap = Math.max(0, Math.round(containerRect.bottom - footerRect.top));
      setFooterOverlap(overlap);
    };

    syncFooterOverlap();
    const scrollContainer = scrollContainerRef.current;
    scrollContainer?.addEventListener("scroll", syncFooterOverlap, { passive: true });
    window.addEventListener("resize", syncFooterOverlap);

    return () => {
      scrollContainer?.removeEventListener("scroll", syncFooterOverlap);
      window.removeEventListener("resize", syncFooterOverlap);
    };
  }, [isMobile, showDashboardFooter]);

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-slate-50">
      {!isMobile ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-30 border-r border-white/10 bg-[linear-gradient(180deg,#081225_0%,#0b1730_55%,#09101f_100%)] shadow-[0_18px_40px_rgba(2,8,23,0.2)]"
          style={{ width: sidebarWidth }}
        />
      ) : null}
      <Sidebar
        footerOverlap={showDashboardFooter && !isMobile ? footerOverlap : 0}
        isMobile={isMobile}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        setIsAuthenticated={setIsAuthenticated}
      />
      <div
        className="flex min-h-screen flex-col transition-all duration-300"
        style={{
          marginLeft: isMobile ? 0 : fullWidth ? 0 : sidebarWidth,
          width: isMobile ? "100%" : fullWidth ? "100%" : `calc(100% - ${sidebarWidth}px)`,
        }}
      >
        <Header
          setIsAuthenticated={setIsAuthenticated}
          sidebarOffset={isMobile ? 0 : sidebarWidth}
          isMobile={isMobile}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
          style={{ paddingTop: `${HEADER_HEIGHT + HEADER_CONTENT_GAP}px` }}
        >
          <div
            className={fullWidth ? "p-3 sm:p-4 lg:p-5" : "p-3 sm:p-4 lg:p-5"}
            style={
              fullWidth && !isMobile
                ? { paddingLeft: `${sidebarWidth + 12}px` }
                : undefined
            }
          >
            {children}
          </div>
        </div>
      </div>
      {showDashboardFooter ? (
        <DashboardFooter contentOffset={isMobile ? 0 : sidebarWidth} />
      ) : null}
    </div>
  );
}

function AppRoutes({ isAuthenticated, setIsAuthenticated, protect }) {
  const location = useLocation();
  const isAuthRoute =
    location.pathname === "/login" || location.pathname === "/register";

  // While the session is being verified, render a minimal splash
  if (isAuthenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        Loading...
      </div>
    );
  }

  // Auth routes render WITHOUT the desktop zoom wrapper
  if (isAuthRoute) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? (
              <RoleHomeRedirect />
            ) : (
              <Login setIsAuthenticated={setIsAuthenticated} />
            )
          }
        />
        <Route
          path="/register"
          element={isAuthenticated ? <RoleHomeRedirect /> : <Register />}
        />
        <Route path="/" element={<RoleHomeRedirect />} />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }

  // All other routes render with the desktop layout shell + zoom
  return (
    <div className="desktop-scale-shell">
      <div className="desktop-scale-content">
        <Routes>
          <Route path="/" element={<RoleHomeRedirect />} />
          <Route path="/dashboard" element={protect(<Dashboard />, ["admin"], { fullWidth: true })} />
          <Route path="/manager-dashboard" element={protect(<ManagerDashboard />, ["manager"])} />
          <Route
            path="/reception-dashboard"
            element={protect(<ReceptionDashboard />, ["receptionist"])}
          />
          <Route
            path="/housekeeping-dashboard"
            element={protect(<HousekeepingDashboard />, ["housekeeping"])}
          />
          <Route
            path="/accounts-dashboard"
            element={protect(<AccountsDashboard />, ["accountant"])}
          />
          <Route path="/kitchen-dashboard" element={protect(<KitchenDashboard />, ["kitchen"])} />
          <Route path="/chef-dashboard" element={protect(<ChefDashboard />, ["chef"])} />
          <Route
            path="/restaurant-dashboard"
            element={protect(<RestaurantDashboard />, ROLES.RESTAURANT)}
          />
          <Route path="/staff-dashboard" element={protect(<StaffDashboard />, ["staff"])} />
          <Route path="/stayover" element={protect(<Stayover />, ["admin", "manager"])} />

          <Route path="/profile" element={protect(<Profile />, ROLES.ALL)} />
          <Route path="/attendance" element={protect(<Attendance />, ROLES.ALL)} />
          <Route path="/zk-attendance" element={protect(<ZkAttendance />, ["admin"])} />
          <Route path="/my-attendance" element={protect(<MyAttendance />, ROLES.ALL)} />
          <Route path="/salary" element={protect(<SalaryManagement />, ["admin"])} />
          <Route path="/payroll" element={protect(<Payroll />, ["admin"])} />
          <Route path="/hotel/*" element={protect(<Hotel />, ROLES.HOTEL)} />
          <Route path="/accounts" element={protect(<Accounts />, ROLES.ACCOUNTS)} />
          <Route
            path="/accounts/bank-reconciliation"
            element={protect(<BankReconciliation />, ROLES.ACCOUNTS)}
          />
          <Route
            path="/accounts/reconciliation-data"
            element={protect(<ReconciliationDataPage />, ROLES.ACCOUNTS)}
          />
          <Route
            path="/accounts/customer-invoices"
            element={protect(<AccountsCustomerInvoices />, ROLES.ACCOUNTS)}
          />
          <Route path="/audit-logs" element={protect(<AuditLogs />, ROLES.AUDIT)} />
          <Route path="/inventory" element={protect(<InventoryHubPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/items" element={protect(<InventoryItemsPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/categories" element={protect(<InventoryCategoriesPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/stock-categories" element={protect(<InventoryStockCategoriesPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/units" element={protect(<InventoryUnitsPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/vendors" element={protect(<InventoryVendorsPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/menu-items" element={protect(<InventoryMenuItemsPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/menu-list" element={protect(<InventoryMenuListPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/purchases" element={protect(<InventoryPurchasesPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/reports" element={protect(<InventoryReportsPage />, ROLES.INVENTORY)} />
          <Route path="/inventory/procurement" element={protect(<Navigate to="/inventory/purchases" replace />, ROLES.INVENTORY)} />
          <Route path="/inventory/masters" element={protect(<InventoryMastersModulePage />, ROLES.INVENTORY)} />
          <Route path="/inventory/recipes" element={protect(<MenuRecipeModulePage />, ROLES.INVENTORY)} />
          <Route path="/inventory/chef-issues" element={protect(<AdminChefIssuePage />, ROLES.CHEF_ISSUE_ADMIN)} />
          <Route path="/chef/inventory" element={protect(<ChefInventoryPage />, ROLES.CHEF_ISSUE_SELF)} />
          <Route path="/housekeeping" element={protect(<Housekeeping />, ROLES.HOUSEKEEPING)} />
          <Route
            path="/housekeeping/notifications"
            element={protect(<HousekeeperNotification />, ROLES.HOUSEKEEPING)}
          />
          <Route path="/banquet" element={protect(<Banquet />, ROLES.BANQUET)} />
          <Route path="/reports" element={protect(<Reports />, ROLES.REPORTS)} />
          <Route path="/assignments" element={protect(<Assignment />, ROLES.ASSIGNMENTS)} />
          <Route
            path="/assignment-notification"
            element={protect(<AssignmentNotification />, ROLES.ASSIGNMENT_NOTIFICATIONS)}
          />
          <Route path="/kitchen" element={protect(<Kitchen />, ROLES.KITCHEN)} />
          <Route path="/waiter-delivery" element={protect(<WaiterDeliveryQueue />, ROLES.RESTAURANT)} />
          <Route path="/user" element={protect(<User />, ROLES.ADMIN_ONLY)} />
          <Route path="/print" element={protect(<PrintManagement />, ["admin"])} />
          <Route path="/backup-settings" element={protect(<BackupSettings />, ROLES.ADMIN_ONLY)} />
          <Route path="/invoice/:customerId" element={protect(<CustomerInvoicePage />, ROLES.ALL)} />

          <Route path="/reports/suite" element={protect(<ReportsSuite />, ROLES.REPORTS)} />
          <Route path="/reports/sales" element={protect(<SalesReport />, ROLES.REPORTS)} />
          <Route
            path="/reports/income-exp"
            element={protect(<IncomeExpenditure />, ROLES.REPORTS)}
          />
          <Route path="/reports/daywise" element={protect(<DaywiseCollection />, ROLES.REPORTS)} />
          <Route
            path="/reports/collection"
            element={protect(<CollectionReport />, ROLES.REPORTS)}
          />
          <Route path="/reports/audit" element={protect(<AuditReport />, ROLES.AUDIT)} />

          <Route
            path="/restaurant"
            element={
              <ProtectedRoute allowedRoles={ROLES.RESTAURANT}>
                <Layout setIsAuthenticated={setIsAuthenticated}>
                  <RestaurantProvider>
                    <RestaurantPOS />
                  </RestaurantProvider>
                </Layout>
              </ProtectedRoute>
            }
          >
            <Route index element={<TablePage />} />
            <Route path="token/:table" element={<TokenPage />} />
            <Route path="menu/:table" element={<MenuPage />} />
            <Route path="edit-token/:table" element={<EditToken />} />
            <Route path="payment" element={<Payment />} />
            <Route path="pay-now/:table" element={<PayNowPage />} />
            <Route path="payment-bills" element={<PaymentBills />} />
            <Route path="token-items/:table" element={<TokenItemsPage />} />
            <Route path="room-items" element={<Roomitem />} />
            <Route path="add-menu-item" element={<AddMenuItemPage />} />
            <Route path="notifications" element={<WaiterNotifications />} />
            <Route path="live-board" element={<LiveBoard />} />
          </Route>

          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = loading, true/false = checked

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      try {
        const res = await API.get("/auth/me", { timeout: 5000 });
        if (!cancelled) setIsAuthenticated(isValidSession(res.data));
      } catch {
        if (!cancelled) setIsAuthenticated(false);
      }
    };

    verify();
    return () => { cancelled = true; };
  }, []);

  // When any API call gets 401, the interceptor clears localStorage.
  // Listen for it and update auth state so routes re-evaluate without a page reload.
  useEffect(() => {
    const handleUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, []);

  const protect = (element, roles, options = {}) => (
    <ProtectedRoute allowedRoles={roles}>
      <Layout setIsAuthenticated={setIsAuthenticated} fullWidth={options.fullWidth}>
        {element}
      </Layout>
    </ProtectedRoute>
  );

  return (
    <ErrorBoundary>
      <Router>
        <AppRoutes
          isAuthenticated={isAuthenticated}
          setIsAuthenticated={setIsAuthenticated}
          protect={protect}
        />
      </Router>
    </ErrorBoundary>
  );
}

export default App;