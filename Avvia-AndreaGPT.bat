@echo off
setlocal
title AndreaGPT - Avvio
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\app\avvia_andreagpt.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Avvio non riuscito. Premi un tasto per chiudere.
  pause >nul
)
exit /b %EXIT_CODE%
