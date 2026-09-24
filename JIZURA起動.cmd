@echo off
rem JIZURA launcher: rebuild index.html from src/, start a local server, open the browser.
rem Close the minimized "JIZURA server" window to stop the server.
setlocal
cd /d "%~dp0"
set PORT=8770
set URL=http://127.0.0.1:%PORT%/

where python >nul 2>nul
if errorlevel 1 (
  echo [JIZURA] Python not found. Install Python 3 and try again.
  pause
  exit /b 1
)

echo [JIZURA] Building index.html ...
python build.py
if errorlevel 1 (
  echo [JIZURA] Build failed. See the error above.
  pause
  exit /b 1
)

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if errorlevel 1 (
  echo [JIZURA] Starting server on port %PORT% ...
  start "JIZURA server" /min python -m http.server %PORT% --bind 127.0.0.1
  ping -n 3 127.0.0.1 >nul
) else (
  echo [JIZURA] Server already running on port %PORT%.
)

if not defined JIZURA_NOOPEN start "" "%URL%"
echo [JIZURA] Opened %URL%
endlocal
