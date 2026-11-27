@echo off
rem ============================================================
rem  MBR one-command start (Windows) - HAG-22
rem
rem  What this does:
rem    1. Installs backend npm deps if missing
rem    2. Builds the frontend dist if missing
rem    3. Starts API + frontend via PM2 (installs PM2 if missing)
rem
rem  Result: http://<your-PCs-LAN-ip>:4173  (open from any device
rem  on the network). Admin login: admin@resort.com / password
rem  (change it after first login).
rem ============================================================
setlocal
set ROOT=%~dp0
set BACKEND=%ROOT%Maa-Baglamkhi-Resort-Backend
set FRONTEND=%ROOT%Maa-Baglamkhi-Resort-frontend

echo == MBR start ==

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node 20 LTS from https://nodejs.org first.
  pause
  exit /b 1
)

echo [1/3] Backend dependencies...
if not exist "%BACKEND%\node_modules" (
  pushd "%BACKEND%"
  call npm install
  popd
)

echo [2/3] Frontend build...
if not exist "%FRONTEND%\dist\index.html" (
  pushd "%FRONTEND%"
  call npm install
  call npm run build
  popd
)

echo [3/3] Starting via PM2...
where pm2 >nul 2>nul
if errorlevel 1 (
  echo     PM2 not found - installing globally (one time)...
  call npm install -g pm2
)

rem Idempotent: first run starts, later runs restart with the same state.
call pm2 startOrReload "%ROOT%ecosystem.config.js" --update-env
call pm2 save

echo.
echo ============================================================
echo  MBR is running.
echo    - Open the app on this PC:        http://localhost:4173
echo    - Open it from phones/LAN:        http://<your-PCs-LAN-ip>:4173
echo      (find your LAN IP:  ipconfig    - look for "IPv4 Address")
echo    - Login: admin@resort.com / password   (change it in the app)
echo  Status:  pm2 list        Logs:  pm2 logs
echo  Stop:    pm2 stop all
echo ============================================================
pause
