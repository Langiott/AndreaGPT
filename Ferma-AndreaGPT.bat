@echo off
setlocal
title Arresto AndreaGPT
cd /d "%~dp0"
docker compose down
if errorlevel 1 pause
