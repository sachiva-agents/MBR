import { useState, useEffect, useCallback } from "react";
import API from "../api";
import { getCurrentActor } from "../utils/currentActor";
import { getRestaurantSocket, releaseRestaurantSocket } from "../utils/restaurantSocket";

const POLL_INTERVAL = 5000; // 5 seconds

export const useWaiterOrders = () => {
  const actor = getCurrentActor();
  const [readyOrders, setReadyOrders] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Play alert sound when new ready order arrives
  const playAlertSound = useCallback(() => {
    try {
      const audio = new Audio("/order.mp3");
      audio.volume = 0.7;
      audio.play().catch(() => {
        // Audio play failed - user hasn't interacted with page yet
      });
    } catch {
      // Audio not supported
    }
  }, []);

  // Fetch ready orders from backend
  const fetchReadyOrders = useCallback(async () => {
    try {
      const response = await API.get("/waiter/orders/ready");
      const orders = Array.isArray(response.data) ? response.data : response || [];
      setReadyOrders(orders);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch ready orders:", err);
      setError(err.message || "Failed to fetch ready orders");
    }
  }, []);

  // Poll for ready orders
  useEffect(() => {
    fetchReadyOrders();
    const interval = setInterval(fetchReadyOrders, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchReadyOrders]);

  // Listen to the shared socket.io event for real-time updates (the
  // window "kitchen-order-ready" event was never dispatched by any code)
  useEffect(() => {
    let activeSocket = null;
    let unsubscribed = false;

    const handleKitchenReady = (payload = {}) => {
      const data = payload.detail || payload;
      if (data.orderStatus === "ready" || data.status === "Ready") {
        // Add the new ready order to the list
        setReadyOrders((prev) => {
          // Check if order already exists
          const exists = prev.some(
            (order) =>
              order.tokenId === data.tokenId ||
              order.kitchenOrderId === data.id ||
              order.tableNumber === data.table
          );
          if (exists) return prev;

          // Add new order
          return [
            ...prev,
            {
              tokenId: data.tokenId,
              kitchenOrderId: data.id,
              tableNumber: data.table,
              waiter: data.waiter,
              entityType: data.entityType || "Table",
              orderStatus: "ready",
              readyAt: data.readyAt || new Date().toISOString(),
              items: data.items || [],
            },
          ];
        });
        playAlertSound();
        setLastUpdated(new Date());
      }
    };

    const setupSocket = async () => {
      const socket = await getRestaurantSocket();
      if (!socket || unsubscribed) return;
      activeSocket = socket;
      socket.on("kitchen-order-ready", handleKitchenReady);
      return () => {
        socket.off("kitchen-order-ready", handleKitchenReady);
      };
    };

    const teardownPromise = setupSocket();

    return () => {
      unsubscribed = true;
      Promise.resolve(teardownPromise).then((teardown) => teardown && teardown());
      activeSocket = null;
      releaseRestaurantSocket();
    };;
  }, [playAlertSound]);

  // Atomic pickup - only one waiter can succeed
  const pickupOrder = useCallback(async (tokenId) => {
    setLoading(true);
    try {
      const response = await API.patch(`/waiter/orders/${tokenId}/pickup`);

      if (response.data.success) {
        // Remove from ready orders
        setReadyOrders((prev) => prev.filter((order) => order.tokenId !== tokenId));

        // Add to active orders
        setActiveOrders((prev) => [
          ...prev,
          {
            ...response.data,
            pickedUpAt: new Date().toISOString(),
          },
        ]);

        return { success: true, message: "Order picked up successfully" };
      }

      return { success: false, message: response.data.message || "Pickup failed" };
    } catch (err) {
      if (err.response?.status === 409) {
        // Order already picked up by someone else
        setReadyOrders((prev) => prev.filter((order) => order.tokenId !== tokenId));
        return {
          success: false,
          message: "Order already picked up by another waiter",
          alreadyTaken: true,
        };
      }
      console.error("Pickup error:", err);
      return { success: false, message: err.message || "Failed to pickup order" };
    } finally {
      setLoading(false);
    }
  }, []);

  // Mark order as served
  const markServed = useCallback(async (tokenId) => {
    setLoading(true);
    try {
      const response = await API.patch(`/waiter/orders/${tokenId}/served`);

      if (response.data.success) {
        // Remove from active orders
        setActiveOrders((prev) =>
          prev.filter((order) => order.tokenId !== tokenId)
        );

        // Dispatch event for table status update
        window.dispatchEvent(new Event("tokenUpdated"));

        return { success: true, message: "Order marked as served" };
      }

      return { success: false, message: response.data.message || "Failed to mark served" };
    } catch (err) {
      console.error("Mark served error:", err);
      return { success: false, message: err.message || "Failed to mark order as served" };
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    readyOrders,
    activeOrders,
    loading,
    error,
    lastUpdated,
    pickupOrder,
    markServed,
    refreshReadyOrders: fetchReadyOrders,
  };
};
