@echo off
setlocal
cd /d "%~dp0"
title Dialect

:: Dialect launcher.
::
:: Double-click to run the app. The first run compiles it, which takes a few
:: minutes; later runs start instantly unless the code has changed since.
::
::   Dialect.bat            launch, rebuilding first if the code has moved on
::   Dialect.bat rebuild    rebuild whatever the state of things
::   Dialect.bat run        launch what is there, without checking

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

:: -- Which version this is --------------------------------------------------
:: Read from the one place that decides it, so the console cannot disagree with
:: the window.
set VERSION=
for /f "usebackq tokens=*" %%v in (`node -p "require('./package.json').version" 2^>nul`) do set VERSION=%%v

:: -- Is what we have still the current code? ---------------------------------
:: The exe existing is not the same as the exe being current. Without this,
:: every launch after an edit or a pull silently starts the old build, and
:: nothing on screen says so.
if /i "%~1"=="rebuild" goto build
if /i "%~1"=="run" goto launch

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\needs-build.ps1" -Exe "%EXE%" -Root "%CD%"
if errorlevel 1 goto build
goto launch

:build
:: A running copy holds the exe open, and cargo reports that as a bare
:: "Access is denied" with no hint of what to close.
tasklist /fi "imagename eq dialect.exe" /nh 2>nul | find /i "dialect.exe" >nul
if not errorlevel 1 (
  echo Dialect is already running, and its window holds the file this build has to
  echo replace. Close it and run this again.
  echo.
  pause
  exit /b 1
)

if defined VERSION (
  echo Building Dialect %VERSION% - the first build takes a few minutes, later ones are quick...
) else (
  echo Building Dialect - the first build takes a few minutes, later ones are quick...
)
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
if defined VERSION (
  echo Starting Dialect %VERSION%...
) else (
  echo Starting Dialect...
)
start "" "%EXE%"
exit /b 0
