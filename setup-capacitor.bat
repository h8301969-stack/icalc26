@echo off
setlocal enabledelayedexpansion

echo.
echo 🚀 iCalc Capacitor Setup
echo ========================
echo.

REM Step 1: Install dependencies
echo 1️⃣  Installing npm dependencies...
call npm install
if errorlevel 1 goto :error

REM Step 2: Build web app
echo.
echo 2️⃣  Building web app...
call npm run build
if errorlevel 1 goto :error

REM Step 3: Initialize Capacitor (if not already done)
if not exist "capacitor.config.ts" (
  echo.
  echo 3️⃣  Initializing Capacitor...
  call npx cap init --web-dir dist
  if errorlevel 1 goto :error
)

REM Step 4: Add Android
if not exist "android" (
  echo.
  echo 4️⃣  Adding Android platform...
  call npx cap add android
  if errorlevel 1 goto :error
) else (
  echo.
  echo 4️⃣  Android platform already exists, syncing...
  call npx cap sync android
)

REM Step 5: Sync
echo.
echo 5️⃣  Syncing all platforms...
call npx cap sync
if errorlevel 1 goto :error

echo.
echo ✅ Setup complete!
echo.
echo Next steps:
echo   * Android: npm run mobile:android
echo   * Read MOBILE_DEPLOYMENT.md for store submission
echo.
goto :end

:error
echo.
echo ❌ Setup failed!
exit /b 1

:end
