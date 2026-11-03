@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "release\win-unpacked\Cadence.exe" (
  start "" "release\win-unpacked\Cadence.exe"
) else (
  start "" "node_modules\electron\dist\electron.exe" .
)
