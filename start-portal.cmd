@echo off
setlocal

:: Re-launch elevated if not already running as Administrator.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"

set HTTP_PORT=80
set HTTP_BIND_IP=192.168.137.1
set DNS_BIND_IP=192.168.137.1
set PORTAL_IP=192.168.137.1

echo.
echo WiFi Billing Portal
echo ===================
echo.
echo Before continuing, turn ON Windows Mobile Hotspot:
echo   Settings ^> Network ^& Internet ^> Mobile hotspot
echo.
pause

echo Stopping any old portal instance...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":80 "') do taskkill /F /PID %%p >nul 2>&1

echo Stopping Windows ICS so this app can use port 53...
net stop SharedAccess
if %errorlevel% neq 0 (
  echo WARNING: Could not stop SharedAccess. DNS may fail if port 53 is still in use.
)

echo.
echo Starting portal (leave this window open)...
start "WiFi Portal" /B node server.js > portal.log 2>&1
timeout /t 2 /nobreak >nul

findstr /C:"DNS captive-portal server listening" portal.log >nul
if %errorlevel% neq 0 (
  echo.
  echo Portal failed to start. Check portal.log:
  type portal.log
  pause
  exit /b 1
)

echo.
echo Portal is running. Restarting Mobile Hotspot...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-hotspot.ps1"

echo.
type portal.log
if exist hotspot-restart.txt type hotspot-restart.txt

echo.
echo Done. Connect a phone to your hotspot and open any website.
echo Payments are processed via M-Pesa.
echo Admin dashboard: http://192.168.137.1/admin  (open on THIS laptop)
echo Hotspot name: FREE FAST WiFi  (open, no password)
echo.
echo Press any key to stop the portal and restore ICS...
pause >nul

for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":80 "') do taskkill /F /PID %%p >nul 2>&1
net start SharedAccess
echo ICS restored. You may need to toggle Mobile Hotspot in Settings.
pause
