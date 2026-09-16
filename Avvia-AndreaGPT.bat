@echo off
setlocal EnableExtensions EnableDelayedExpansion
title AndreaGPT - Server locale
cd /d "%~dp0"

echo ========================================
echo        Avvio AndreaGPT locale
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERRORE: Node.js non e disponibile nel PATH.
  echo Installa Node.js 22 o successivo e riprova.
  goto :errore
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERRORE: npm non e disponibile nel PATH.
  goto :errore
)
where ollama >nul 2>nul
if errorlevel 1 (
  echo ERRORE: Ollama non e installato o non e disponibile nel PATH.
  goto :errore
)

if not exist "node_modules" (
  echo Installazione dipendenze in corso...
  call npm install
  if errorlevel 1 goto :errore
)
if not exist "dist\index.html" (
  echo Creazione interfaccia in corso...
  call npm run build
  if errorlevel 1 goto :errore
)

curl.exe -s --max-time 2 http://127.0.0.1:11434/api/version >nul 2>nul
if errorlevel 1 (
  echo Avvio Ollama in background...
  start "Ollama" /min ollama serve
  ping 127.0.0.1 -n 5 >nul
)

set "APP_PORT=3000"
for /f "tokens=2 delims==" %%A in ('findstr /b "APP_PORT=" ".env" 2^>nul') do set "APP_PORT=%%A"

call :is_andreagpt %APP_PORT%
if not errorlevel 1 goto :pronto

set /a "LAST_PORT=APP_PORT+20"
set "SELECTED_PORT="
for /f %%P in ('powershell.exe -NoProfile -Command "$used = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port; for ($candidate = %APP_PORT%; $candidate -le !LAST_PORT!; $candidate++) { if ($candidate -notin $used) { Write-Output $candidate; break } }"') do set "SELECTED_PORT=%%P"
if not defined SELECTED_PORT (
  echo ERRORE: nessuna porta libera trovata tra %APP_PORT% e !LAST_PORT!.
  goto :errore
)
if not "%APP_PORT%"=="!SELECTED_PORT!" (
  echo La porta %APP_PORT% e usata da un altro programma.
  echo AndreaGPT verra avviato sulla porta !SELECTED_PORT!.
)
set "APP_PORT=!SELECTED_PORT!"

echo Il browser si aprira su http://127.0.0.1:!APP_PORT!
echo.

echo Avvio del server Node in una finestra minimizzata...
start "AndreaGPT Server" /min cmd.exe /d /k "cd /d %~dp0 && set PORT=!APP_PORT! && call npm start"

for /l %%I in (1,1,60) do (
  call :is_andreagpt !APP_PORT!
  if not errorlevel 1 goto :pronto
  ping 127.0.0.1 -n 2 >nul
)

echo ERRORE: il server non ha risposto entro 60 secondi.
echo Apri la finestra minimizzata "AndreaGPT Server" per leggere l'errore.
goto :errore

:pronto
if not exist "data" mkdir "data"
>"data\.andreagpt-port" echo !APP_PORT!
echo AndreaGPT e attivo su http://127.0.0.1:!APP_PORT!
start "" "http://127.0.0.1:!APP_PORT!/"
echo.
echo Puoi chiudere questa finestra: il server resta nella finestra minimizzata.
echo Usa Ferma-AndreaGPT.bat oppure chiudi "AndreaGPT Server" per arrestarlo.
pause
exit /b 0

:errore
echo.
echo AndreaGPT non e stato avviato. Leggi l'errore qui sopra.
pause
exit /b 1

:is_andreagpt
set "HEALTH_FILE=%TEMP%\andreagpt-health-%RANDOM%-%RANDOM%.tmp"
curl.exe -s --max-time 2 "http://127.0.0.1:%~1/" >"!HEALTH_FILE!" 2>nul
findstr /c:"<title>AndreaGPT</title>" "!HEALTH_FILE!" >nul 2>nul
set "HEALTH_RESULT=!errorlevel!"
del /q "!HEALTH_FILE!" >nul 2>nul
exit /b !HEALTH_RESULT!
