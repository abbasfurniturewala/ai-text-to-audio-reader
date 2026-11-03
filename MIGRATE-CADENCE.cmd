@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0migration\restore.ps1"
if errorlevel 1 (
  echo.
  echo Migration could not finish. Read the message above or ask Codex to continue.
  pause
  exit /b 1
)
echo.
echo Cadence is ready. You can close this window.
pause
