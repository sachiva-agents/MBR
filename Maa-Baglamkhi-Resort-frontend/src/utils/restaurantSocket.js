import { getBackendBaseURL } from "../api";

let socketPromise = null;
let socketInstance = null;
let socketUsers = 0;
let disconnectTimer = null;
const SOCKET_CLIENT_VERSION = "proxy-ws-v3";
const SOCKET_RELEASE_DELAY_MS = 750;

const resolveSocketBaseURL = () => {
  const explicitOrigin = import.meta.env.VITE_BACKEND_ORIGIN || import.meta.env.VITE_API_URL || "";
  if (/^https?:\/\//i.test(explicitOrigin)) {
    return explicitOrigin.replace(/\/api\/?$/, "");
  }
  return getBackendBaseURL();
};

// 127.0.0.1, not localhost: on this dev machine Node/Winsock resolve
// localhost to ::1 (IPv6) and the backend only listens on IPv4, which broke
// the socket script fetch with ECONNREFUSED ::1:5002.
const SOCKET_FALLBACK_ORIGIN = "http://127.0.0.1:5002";

const getSocketScriptURL = () => {
  const base = (import.meta.env.VITE_BACKEND_ORIGIN || SOCKET_FALLBACK_ORIGIN).replace(/\/$/, "");
  return `${base}/socket.io/socket.io.js?v=${SOCKET_CLIENT_VERSION}`;
};

const getSocketServerURL = () => {
  const base = (import.meta.env.VITE_BACKEND_ORIGIN || SOCKET_FALLBACK_ORIGIN).replace(/\/$/, "");
  return `${base}/socket.io`;
};

const loadSocketScript = () =>
  new Promise((resolve, reject) => {
    if (window.io) {
      resolve(window.io);
      return;
    }

    const existing = document.querySelector('script[data-socket-io-client="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.io), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = getSocketScriptURL();
    script.async = true;
    script.dataset.socketIoClient = "true";
    script.onload = () => resolve(window.io);
    script.onerror = reject;
    document.head.appendChild(script);
  });

const cancelPendingDisconnect = () => {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
};

const scheduleDisconnect = () => {
  cancelPendingDisconnect();
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (socketUsers > 0) return;

    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }

    socketPromise = null;
  }, SOCKET_RELEASE_DELAY_MS);
};

export const getRestaurantSocket = async () => {
  socketUsers += 1;
  cancelPendingDisconnect();

  if (!socketPromise) {
    socketPromise = loadSocketScript().then((ioFactory) => {
      if (!ioFactory) return null;
      socketInstance = ioFactory(getSocketServerURL(), {
        path: "/socket.io",
        transports: ["websocket", "polling"],
        withCredentials: false,
        forceNew: true,
        reconnection: true,
      });
      return socketInstance;
    });
  }

  try {
    const socket = await socketPromise;
    if (socket && socket.disconnected) {
      socket.connect();
    }
    return socket;
  } catch (error) {
    socketUsers = Math.max(0, socketUsers - 1);
    socketPromise = null;
    throw error;
  }
};

export const releaseRestaurantSocket = () => {
  socketUsers = Math.max(0, socketUsers - 1);
  if (socketUsers === 0) {
    scheduleDisconnect();
  }
};
