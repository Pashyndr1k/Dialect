@echo off
setlocal
cd /d "%~dp0"
title Dialect - dev

:: Development launcher.
::
:: Runs the app against the Vite dev server, so edits to the interface appear
:: without a restart. Rust changes still need the window closed and reopened.
::
:: Keep this console window open while you work - closing it stops the app.
:: Use Dialect.bat instead if you just want to use Dialect.

where cargo >nul 2>nul
if errorlevel 1 set PATH=%USERPROFILE%\.cargo\bin;%PATH%

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust is required. Install it from https://rustup.rs
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - this happens only on the first run...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Dialect in dev mode...
echo Close this window to stop it.
echo.
cd apps\desktop
call npx tauri dev

:: Only reached when the app exits. Hold the window open so a crash is readable.
echo.
echo Dialect has stopped.
pause
