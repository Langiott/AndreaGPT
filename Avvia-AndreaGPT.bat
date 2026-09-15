@echo off
setlocal
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

echo Il browser si aprira su http://127.0.0.1:%APP_PORT%
echo.

curl.exe -s --max-time 2 http://127.0.0.1:%APP_PORT%/ >nul 2>nul
if not errorlevel 1 goto :pronto

echo Avvio del server Node in una finestra minimizzata...
start "AndreaGPT Server" /min cmd.exe /d /k "cd /d %~dp0 && set PORT=%APP_PORT% && call npm start"

for /l %%I in (1,1,60) do (
  curl.exe -s --max-time 1 http://127.0.0.1:%APP_PORT%/ >nul 2>nul
  if not errorlevel 1 goto :pronto
  ping 127.0.0.1 -n 2 >nul
)

echo ERRORE: il server non ha risposto entro 60 secondi.
echo Apri la finestra minimizzata "AndreaGPT Server" per leggere l'errore.
goto :errore

:pronto
echo AndreaGPT e attivo su http://127.0.0.1:%APP_PORT%
start "" "http://127.0.0.1:%APP_PORT%/"
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
