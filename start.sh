#!/usr/bin/env bash
# ============================================================
#  MBR one-command start (Linux / macOS) - HAG-22
#  Same behaviour as start.bat on Windows.
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/Maa-Baglamkhi-Resort-Backend"
FRONTEND="$ROOT/Maa-Baglamkhi-Resort-frontend"

command -v node >/dev/null || { echo "[ERROR] Node.js 20 LTS required: https://nodejs.org"; exit 1; }

echo "[1/3] Backend dependencies..."
[ -d "$BACKEND/node_modules" ] || (cd "$BACKEND" && npm install)

echo "[2/3] Frontend build..."
[ -f "$FRONTEND/dist/index.html" ] || (cd "$FRONTEND" && npm install && npm run build)

echo "[3/3] Starting via PM2..."
if ! command -v pm2 >/dev/null; then
  echo "      PM2 not found - installing globally (one time)..."
  npm install -g pm2
fi

mkdir -p "$ROOT/logs"
pm2 startOrReload "$ROOT/ecosystem.config.js" --update-env
pm2 save

cat <<EOF

============================================================
 MBR is running.
   - This PC:            http://localhost:4173
   - Phones / LAN:       http://<your-LAN-ip>:4173
     (find it:  ip a  /  ifconfig)
   - Login: admin@resort.com / password  (change it in-app)
 Status:  pm2 list        Logs:  pm2 logs
 Stop:    pm2 stop all
============================================================
EOF
