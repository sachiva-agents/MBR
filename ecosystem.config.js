/**
 * MBR PM2 kit (HAG-22) — run the whole resort stack on a hotel's local PC.
 *
 * From the MBR repo root:
 *   npm i -g pm2          # one-time, if PM2 is not installed
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   # optional: start the apps on OS boot
 *   pm2 monit               # watch
 *   pm2 logs resort-backend  # tail logs
 *
 * Two apps:
 *   1. resort-backend   — the API + socket.io server on 127.0.0.1:5002.
 *   2. resort-frontend  — static server for the built dist on 0.0.0.0:4173
 *                         that ALSO proxies /api + /socket.io to 5002, so the
 *                         browser (same-origin) and LAN devices all reach it
 *                         through a single port.
 *
 * Everything is env-driven; the defaults below are the zero-config values.
 * Override with your own .env / pm2 env if a hotel needs a different DB.
 */
const path = require("path");

const root = __dirname;
const backendDir = path.join(root, "Maa-Baglamkhi-Resort-Backend");

module.exports = {
  apps: [
    {
      name: "resort-backend",
      cwd: backendDir,
      script: "index.js",
      interpreter: "node",
      args: "",
      // Bind to 0.0.0.0 so LAN devices can reach the API directly if needed;
      // the frontend proxy still talks to it over 127.0.0.1.
      env: {
        NODE_ENV: "production",
        PORT: "5002",
        HOST: "0.0.0.0",
        // Zero-config DB (created + seeded on first start by the app).
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_USER: "root",
        DB_PASSWORD: "",
        DB_NAME: "resort_management",
        // Leave empty on first start: the app auto-generates + persists a
        // JWT_SECRET to backend/.env (HAG-22). Set a real value in prod.
        JWT_SECRET: "",
      },
      out_file: path.join(root, "logs", "backend.out.log"),
      error_file: path.join(root, "logs", "backend.err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: "5000",
      watch: false,
      autorestart: true,
      instances: 1,
      exec_mode: "fork",
      windowsHide: true,
    },
    {
      name: "resort-frontend",
      cwd: root,
      script: "frontend-static-server.js",
      interpreter: "node",
      env: {
        PORT_FRONTEND: "4173",
        PORT_API: "5002",
        HOST_BIND: "0.0.0.0",
      },
      out_file: path.join(root, "logs", "frontend.out.log"),
      error_file: path.join(root, "logs", "frontend.err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_restarts: 10,
      min_uptime: "5s",
      watch: false,
      autorestart: true,
      instances: 1,
      exec_mode: "fork",
      windowsHide: true,
    },
  ],
};
