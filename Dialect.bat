@echo off
setlocal
cd /d "%~dp0"
title Dialect

:: Dialect launcher.
::
:: Double-click to run the app. The first run compiles it, which takes a few
:: minutes; every run after that starts instantly from the built exe.
::
::   Dialect.bat            launch (build only if there is nothing to launch)
::   Dialect.bat rebuild    rebuild first, to pick up code changes

set EXE=apps\desktop\src-tauri\target\release\dialect.exe

:: -- Rust lives outside PATH on a fresh rustup install -----------------------
where cargo >nul 2>nul
if errorlevel 1 set PATH=%USERPROFILE%\.cargo\bin;%PATH%

:: -- Prerequisites ----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to build Dialect from source.
  echo Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust is required to build Dialect.
  echo Install it from https://rustup.rs and run this file again.
  echo.
  echo You also need the Visual Studio Build Tools with the C++ workload:
  echo   winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  echo.
  pause
  exit /b 1
)

:: -- Dependencies, first run only -------------------------------------------
if not exist node_modules (
  echo Installing dependencies - this happens only on the first run...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

:: -- Build ------------------------------------------------------------------
if /i "%~1"=="rebuild" goto build
if not exist "%EXE%" goto build
goto launch

:build
echo Building Dialect - the first build takes a few minutes, later ones are quick...
echo.
pushd apps\desktop
call npx tauri build --no-bundle
set BUILD_FAILED=%errorlevel%
popd
if not "%BUILD_FAILED%"=="0" (
  echo.
  echo Build failed. The lines above say why.
  pause
  exit /b 1
)
if not exist "%EXE%" (
  echo.
  echo The build reported success but %EXE% is not there.
  pause
  exit /b 1
)

:launch
echo Starting Dialect...
start "" "%EXE%"
exit /b 0
