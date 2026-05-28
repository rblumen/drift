@echo off
:: ============================================================
::  Portfolio Rebalancer — demo launcher
::
::  Double-click this file to start the app pre-loaded with a
::  synthetic 5-account sample portfolio (no real data).
::
::  The server runs in a separate minimised window visible in
::  your taskbar.  Close that window (or press Ctrl+C inside
::  it) when you are done with the app.
:: ============================================================
setlocal
title Portfolio Rebalancer — Demo
cd /d "%~dp0"

:: ── 1. Make sure npm is reachable ────────────────────────────
where npm >nul 2>&1 || set "PATH=%PATH%;C:\Program Files\nodejs"
where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo   ERROR: npm not found.
  echo   Install Node.js from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

:: ── 2. Install dependencies on first run ─────────────────────
if not exist "node_modules\" (
  echo   First launch: installing dependencies ...
  echo   (this only happens once^)
  echo.
  npm install
  if errorlevel 1 (
    echo.
    echo   ERROR: npm install failed.  See errors above.
    pause
    exit /b 1
  )
)

:: ── 3. If the server is already up, just open the demo URL ───
curl -s --max-time 1 http://localhost:5173 >nul 2>&1
if not errorlevel 1 (
  echo   Dev server already running — opening demo.
  start "" http://localhost:5173/?demo
  exit /b 0
)

:: ── 4. Start Vite in a separate minimised window ─────────────
echo   Starting Portfolio Rebalancer (demo mode) ...
start /min "Portfolio Rebalancer — Server  (close to stop)" cmd /k "npm run dev"

:: ── 5. Poll until localhost:5173 responds (30 s timeout) ─────
set /a try=0
:wait
set /a try+=1
if %try% gtr 30 (
  echo.
  echo   ERROR: server not ready after 30 s.
  echo   Expand the server window in the taskbar to check for errors.
  echo.
  pause
  exit /b 1
)
curl -s --max-time 1 http://localhost:5173 >nul 2>&1
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)

:: ── 6. Open the demo URL, then close this window ─────────────
start "" http://localhost:5173/?demo
echo   Demo ready at http://localhost:5173/?demo
echo   Close the server window in the taskbar when done.
timeout /t 3 /nobreak >nul
exit /b 0
