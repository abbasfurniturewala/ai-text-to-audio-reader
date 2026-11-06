@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set CADENCE_QA=
set CADENCE_QA_OFFLINE=
set CADENCE_DATA_DIR=
set CADENCE_DEV_URL=
if exist "release\win-unpacked\Cadence.exe" (
  start "" "release\win-unpacked\Cadence.exe"
) else (
  start "" "node_modules\electron\dist\electron.exe" .
)
