$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\andreagpt-isolamento.lock')) { exit 1 }
$config = Join-Path $projectRoot 'runtime\adb-bridge.json'
$adb = Join-Path $projectRoot 'runtime\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw 'ADB mancante: installa gli Android Platform Tools in runtime\platform-tools.' }
if (Test-Path -LiteralPath $config) {
  $state = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($state.port)/adb" -Method Post -Headers @{ Authorization = "Bearer $($state.token)" } -ContentType 'application/json' -Body '{"args":["devices"]}' -TimeoutSec 5 | Out-Null
    exit 0
  } catch { }
}
New-Item -ItemType Directory -Force (Join-Path $projectRoot 'runtime\logs') | Out-Null
Start-Process -FilePath (Get-Command node.exe).Source -WindowStyle Hidden -WorkingDirectory $projectRoot -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'adb_bridge.mjs') + '"')) -RedirectStandardOutput (Join-Path $projectRoot 'runtime\logs\adb-bridge.log') -RedirectStandardError (Join-Path $projectRoot 'runtime\logs\adb-bridge-error.log')
