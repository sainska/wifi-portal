@echo off
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"

echo.
echo ========================================
echo   FREE FAST WiFi - Captive Portal Launch
echo ========================================
echo.

echo [1/4] Stopping old portal...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":80 "') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":53 "') do taskkill /F /PID %%p >nul 2>&1

for /f "tokens=2" %%p in ('wmic process where "name='node.exe' and commandline like '%%server.js%%'" get processid ^| findstr /R /V "^PID$"') do taskkill /F /PID %%p >nul 2>&1

echo [2/4] Freeing port 53 (stop Windows ICS)...
net stop SharedAccess >nul 2>&1
timeout /t 2 /nobreak >nul

echo [3/4] Configuring open hotspot "FREE FAST WiFi"...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-hotspot.ps1"
timeout /t 2 /nobreak >nul

echo [4/4] Starting captive portal...
start "WiFi Portal" /B node server.js > portal.log 2>&1
timeout /t 3 /nobreak >nul

echo.
echo --- Portal log ---
type portal.log 2>nul
echo.
if exist hotspot-restart.txt (
  echo --- Hotspot ---
  type hotspot-restart.txt
)

netstat -ano | findstr "LISTENING" | findstr ":80 " >nul
if %errorlevel% neq 0 (
  echo.
  echo ERROR: Portal did not start on port 80. Check portal.log
  pause
  exit /b 1
)

echo.
echo SUCCESS!
echo   Hotspot SSID : FREE FAST WiFi (open)
echo   Portal       : http://192.168.137.1
echo   Admin        : http://192.168.137.1/admin
echo.
start http://192.168.137.1/admin
echo Portal is running. Keep this window open or leave WiFi Portal process running.
pause
