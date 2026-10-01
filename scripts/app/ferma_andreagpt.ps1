$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logRoot = Join-Path $projectRoot "runtime\logs"
$stopLog = Join-Path $logRoot "andreagpt-stop.log"
$stateFile = Join-Path $logRoot "andreagpt-state.json"
$comfyPidFile = Join-Path $projectRoot "runtime\ComfyUI\andreagpt-comfy.pid"
$composeFile = Join-Path $projectRoot "compose.yaml"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Write-Stop([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Write-Host $line
  Add-Content -LiteralPath $stopLog -Value $line -Encoding UTF8
}

$failed = $false
Write-Stop "Arresto AndreaGPT."
$telemetryPidFile = Join-Path $projectRoot 'OUTPUT\Log\host-telemetry.pid'
if (Test-Path -LiteralPath $telemetryPidFile) {
  $telemetryPid = [int](Get-Content -LiteralPath $telemetryPidFile)
  $telemetryProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$telemetryPid" -ErrorAction SilentlyContinue
  if ($telemetryProcess.CommandLine -like '*telemetria_windows.ps1*') { Stop-Process -Id $telemetryPid -ErrorAction SilentlyContinue }
}
if (Get-Command docker -ErrorAction SilentlyContinue) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & docker compose --project-directory $projectRoot -f $composeFile down --remove-orphans 2>&1 |
      Tee-Object -FilePath $stopLog -Append |
      ForEach-Object { Write-Host $_ }
    $composeExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($composeExitCode -ne 0) { Write-Stop "ATTENZIONE: arresto Docker non riuscito (codice $composeExitCode)."; $failed = $true }
} else { Write-Stop "ATTENZIONE: Docker non è disponibile nel PATH."; $failed = $true }

if (Test-Path -LiteralPath $comfyPidFile) {
  $comfyPid = [int](Get-Content -LiteralPath $comfyPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$comfyPid" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match 'main\.py' -and $process.CommandLine -match '(?:--port\s+8188|--listen\s+127\.0\.0\.1)') {
    Stop-Process -Id $comfyPid -Force -ErrorAction SilentlyContinue
    Write-Stop "ComfyUI arrestato (PID $comfyPid)."
  } else { Write-Stop "PID ComfyUI già terminato o non corrispondente: nessun processo estraneo è stato chiuso." }
  Remove-Item -LiteralPath $comfyPidFile -Force -ErrorAction SilentlyContinue
} else { Write-Stop "Nessun PID ComfyUI registrato; risulta già arrestato." }

Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
if ($failed) { Write-Stop "Arresto completato con avvisi. Controlla $stopLog"; exit 1 }
Write-Stop "AndreaGPT arrestato correttamente."
exit 0
