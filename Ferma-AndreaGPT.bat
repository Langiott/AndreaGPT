@echo off
setlocal
title Arresto AndreaGPT
cd /d "%~dp0"
set "APP_PORT=3000"
for /f "tokens=2 delims==" %%A in ('findstr /b "APP_PORT=" ".env" 2^>nul') do set "APP_PORT=%%A"
if exist "data\.andreagpt-port" set /p APP_PORT=<"data\.andreagpt-port"
echo Arresto AndreaGPT sulla porta %APP_PORT%...
powershell.exe -NoProfile -Command "$c=Get-NetTCPConnection -State Listen -LocalPort %APP_PORT% -ErrorAction SilentlyContinue; if(-not $c){Write-Host 'AndreaGPT non risulta attivo.'; exit 0}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.OwningProcess); if($p.CommandLine -notmatch 'server[/\\]index\.ts'){Write-Host 'La porta e usata da un altro programma: arresto annullato.'; exit 2}; Stop-Process -Id $c.OwningProcess -Force; Write-Host 'AndreaGPT arrestato.'"
if not errorlevel 1 del /q "data\.andreagpt-port" >nul 2>nul
if errorlevel 1 pause
