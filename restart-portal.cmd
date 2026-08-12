@echo off
setlocal
cd /d "%~dp0"

echo Stopping old portal...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":80 "') do taskkill /F /PID %%p >nul 2>&1

echo Stopping SharedAccess to free port 53...
net stop SharedAccess >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting portal...
start "WiFi Portal" /B node server.js 1> portal.log 2> portal.err.log
timeout /t 3 /nobreak >nul

echo --- portal.log ---
type portal.log 2>nul
echo --- portal.err.log ---
type portal.err.log 2>nul

echo Restarting Mobile Hotspot...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enable-hotspot.ps1"

echo Done.
