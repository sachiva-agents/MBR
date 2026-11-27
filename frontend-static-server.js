#!/usr/bin/env node
/**
 * MBR frontend static server + API proxy (HAG-22 PM2 kit).
 *
 * Serves the built frontend (../Maa-Baglamkhi-Resort-frontend/dist) on
 * PORT_FRONTEND (default 4173) bound to 0.0.0.0 so a hotel's LAN devices
 * can open http://<host-lan-ip>:4173. The frontend is built to call
 * same-origin /api, so this server proxies:
 *   /api/*      -> http://127.0.0.1:<PORT_API>   (default 5002)
 *   /socket.io/*-> same target, with WS upgrade
 *
 * Zero external dependencies (pure node http/fs/net/path/url), so it runs
 * with just `node` on a stock install — nothing to `npm i`.
 *
 * Env:
 *   PORT_FRONTEND     static port (default 4173)
 *   PORT_API          backend port to proxy to (default 5002)
 *   FRONTEND_DIST     dist dir (default ../Maa-Baglamkhi-Resort-frontend/dist)
 *   HOST_BIND         bind address (default 0.0.0.0 for LAN reach)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT_FRONTEND = Number(process.env.PORT_FRONTEND || 4173);
const PORT_API = Number(process.env.PORT_API || 5002);
const HOST_BIND = process.env.HOST_BIND || "0.0.0.0";
const DIST =
  process.env.FRONTEND_DIST ||
  path.resolve(__dirname, "Maa-Baglamkhi-Resort-frontend", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

const isProxyPath = (p) =>
  p === "/api" || p.startsWith("/api/") || p === "/socket.io" || p.startsWith("/socket.io/");

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    // HTML must not be cached aggressively; assets can be.
    if (ext === ".html") {
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
    res.end(data);
  });
}

// Proxy a plain HTTP /api request to the backend.
function proxyHttp(req, res, targetPath) {
  const opts = {
    host: "127.0.0.1",
    port: PORT_API,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${PORT_API}` },
  };
  const proxied = http.request(opts, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxied.on("error", (e) => {
    console.error(`[proxy] ${req.method} ${req.url} -> ${e.message}`);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
    }
    res.end(JSON.stringify({ error: "API backend unreachable", detail: e.message }));
  });
  req.pipe(proxied);
}

// Proxy a /socket.io WebSocket upgrade to the backend.
function proxyUpgrade(req, socket, head, targetPath) {
  const upstream = http.request({
    host: "127.0.0.1",
    port: PORT_API,
    path: targetPath,
    method: "GET",
    headers: { ...req.headers, host: `127.0.0.1:${PORT_API}` },
  });
  upstream.on("upgrade", (code, headers, upstreamSocket) => {
    const lines = [
      `HTTP/1.1 ${code} ${headers.statusMessage || "Upgrade"}`,
    ];
    for (const [k, v] of Object.entries(headers)) {
      lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    }
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstream.on("error", (e) => {
    console.error(`[ws-proxy] ${targetPath} -> ${e.message}`);
    socket.end();
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname || "/");

  if (isProxyPath(pathname)) {
    const targetPath = req.url; // keep query string
    return proxyHttp(req, res, targetPath);
  }

  // Static: resolve inside DIST, fall back to index.html for SPA routes.
  let filePath = path.join(DIST, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(DIST)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  fs.stat(filePath, (err, st) => {
    if (!err && st.isFile()) {
      return serveFile(res, filePath);
    }
    // SPA fallback (client-side routing) — serve index.html.
    serveFile(res, path.join(DIST, "index.html"));
  });
});

// WebSocket /socket.io upgrade.
server.on("upgrade", (req, socket, head) => {
  const targetPath = req.url;
  proxyUpgrade(req, socket, head, targetPath);
});

server.listen(PORT_FRONTEND, HOST_BIND, () => {
  console.log(`[frontend] static server on http://${HOST_BIND}:${PORT_FRONTEND}`);
  console.log(`[frontend] serving ${DIST}`);
  console.log(`[frontend] proxying /api + /socket.io -> http://127.0.0.1:${PORT_API}`);
});
