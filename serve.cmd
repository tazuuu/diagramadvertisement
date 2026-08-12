@echo off
REM ---------------------------------------------------------------------------
REM  Double-click this to preview the site with the liquid hero working.
REM
REM  Why this exists: opening index.html directly gives it a "file://" address,
REM  and browsers treat that as origin "null". The WebGL texture upload is
REM  refused, so the hero correctly falls back to the still image and the fluid
REM  never runs. Serving over http:// is the only way around it.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this machine.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Serving this folder at http://127.0.0.1:5188
echo   Opening your browser...
echo.
echo   Leave this window open while you browse.
echo   Press Ctrl+C here when you are finished.
echo.

start "" "http://127.0.0.1:5188/index.html"
npx --yes http-server -p 5188 -c-1 --silent

pause
