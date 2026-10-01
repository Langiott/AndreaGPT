@echo off
setlocal
title AndreaGPT - Log in tempo reale
cd /d "%~dp0"
echo Log Docker in tempo reale. Premi Ctrl+C per uscire: l'app restera attiva.
echo.
docker compose logs --follow --tail=150 andreagpt searxng
if errorlevel 1 (
  echo.
  echo Docker non e disponibile oppure AndreaGPT non e avviato.
  pause
)
