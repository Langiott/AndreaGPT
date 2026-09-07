@echo off
setlocal
title AndreaGPT Launcher
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop non e installato o non e disponibile nel PATH.
  echo Scaricalo da https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Avvia Docker Desktop, attendi che sia pronto e riprova.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
)

:check_config
set "NVIDIA_API_KEY="
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"NVIDIA_API_KEY=" ".env" 2^>nul') do set "NVIDIA_API_KEY=%%B"
if not defined NVIDIA_API_KEY goto configure
if /i "%NVIDIA_API_KEY%"=="nvapi-inserisci-la-tua-chiave" goto configure
goto config_ok

:configure
echo Configurazione richiesta: inserisci una NVIDIA API key valida nel file .env.
start "" notepad ".env"
echo Dopo aver salvato il file, premi un tasto per continuare.
pause >nul
goto check_config

:config_ok

echo Avvio di AndreaGPT...
docker compose up --build -d
if errorlevel 1 (
  echo Impossibile avviare AndreaGPT. Controlla i messaggi Docker qui sopra.
  pause
  exit /b 1
)

timeout /t 3 /nobreak >nul
for /f "tokens=2 delims==" %%A in ('findstr /b "APP_PORT=" ".env" 2^>nul') do set "APP_PORT=%%A"
if not defined APP_PORT set "APP_PORT=3000"
start "AndreaGPT" "http://localhost:%APP_PORT%"
echo AndreaGPT e in esecuzione su http://localhost:%APP_PORT%
echo Puoi chiudere questa finestra: il container rimarra attivo.
timeout /t 4 /nobreak >nul
