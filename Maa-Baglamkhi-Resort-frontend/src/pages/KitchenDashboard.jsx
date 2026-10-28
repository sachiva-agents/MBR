import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaCheckCircle,
  FaClipboardList,
  FaFire,
  FaUtensils,
} from "react-icons/fa";

import RoleDashboardShell from "../components/roleDashboards/RoleDashboardShell";
import useDashboardAutoRefresh from "../hooks/useDashboardAutoRefresh";
import { restaurantService } from "../services/restaurantService";

const KitchenDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const data = await restaurantService.getKitchenOrders();
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setError("Kitchen dashboard data could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useDashboardAutoRefresh(load);

  const byStatus = (needle) =>
    orders.filter((item) => String(item.status || "").toLowerCase().includes(needle)).length;

  const stats = useMemo(() => [
    { label: "Pending Orders", value: byStatus("pending"), note: "Orders waiting for kitchen pickup.", icon: FaClipboardList, tone: "amber" },
    { label: "Preparing", value: byStatus("prepar"), note: "Orders actively being prepared.", icon: FaFire, tone: "rose" },
    { label: "Ready Orders", value: byStatus("ready"), note: "KOT items ready to dispatch.", icon: FaCheckCircle, tone: "emerald" },
    { label: "Completed", value: byStatus("complete") + byStatus("served"), note: "Closed or fully served kitchen orders.", icon: FaUtensils, tone: "cyan" },
  ], [orders]);

  const insights = useMemo(() => [
    {
      label: "Visible KOTs",
      value: orders.length,
      note: "Kitchen queue visible for current session.",
    },
    {
      label: "Rush Load",
      value: byStatus("pending") + byStatus("prepar"),
      note: "Orders demanding immediate team attention.",
    },
    {
      label: "Dispatch Queue",
      value: byStatus("ready"),
      note: "Ready items waiting for handover to service staff.",
    },
  ], [orders]);

  const table = useMemo(() => ({
    eyebrow: "Kitchen Status Board",
    title: "Live kitchen order feed",
    meta: `${orders.length} orders`,
    columns: [
      { key: "ref", label: "Order", render: (row) => row.orderId || row.id || "--" },
      { key: "tableRef", label: "Ref", render: (row) => row.table || row.table_number || row.entityType || "--" },
      { key: "itemCount", label: "Items", render: (row) => row.itemCount || row.items?.length || row.qty || "--" },
      { key: "status", label: "Status" },
      { key: "updatedAt", label: "Updated", render: (row) => row.updatedAt || row.createdAt || "--" },
    ],
    rows: orders.slice(0, 10),
    emptyText: "No kitchen orders are currently available.",
  }), [orders]);

  return (
    <RoleDashboardShell
      badge="Kitchen Queue"
      title="Kitchen dashboard for order flow control"
      description="Pending, preparing, ready aur completed kitchen tickets ko ek focused pass-through dashboard mein monitor karein."
      stats={stats}
      quickActions={[
        { label: "Open Kitchen", helper: "Full kitchen order workspace aur status actions dekhein.", route: "/kitchen", icon: FaFire, tone: "rose" },
        { label: "Restaurant POS", helper: "Front of house order source ko review karein.", route: "/restaurant", icon: FaUtensils, tone: "cyan" },
        { label: "Inventory", helper: "Ingredient aur supply readiness check karein.", route: "/inventory", icon: FaClipboardList, tone: "amber" },
        { label: "My Profile", helper: "Profile aur account details access karein.", route: "/profile", icon: FaCheckCircle, tone: "emerald" },
      ]}
      insights={insights}
      table={table}
      loading={loading}
      error={error}
    />
  );
};

export default KitchenDashboard;
