$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logRoot = Join-Path $projectRoot "runtime\logs"
$startupLog = Join-Path $logRoot "andreagpt-startup.log"
$stateFile = Join-Path $logRoot "andreagpt-state.json"
$composeFile = Join-Path $projectRoot "compose.yaml"
$comfyStarter = Join-Path $PSScriptRoot "avvia_comfyui.ps1"

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
if ((Test-Path -LiteralPath $startupLog) -and (Get-Item -LiteralPath $startupLog).Length -gt 5MB) {
  Move-Item -LiteralPath $startupLog -Destination "$startupLog.1" -Force
}
function Write-Startup([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Write-Host $line
  Add-Content -LiteralPath $startupLog -Value $line -Encoding UTF8
}
function Invoke-Compose([string[]]$Arguments) {
  # Docker Compose invia anche il normale avanzamento della build su stderr.
  # Windows PowerShell lo converte in ErrorRecord quando è reindirizzato: non
  # deve interrompere lo script. Il risultato reale è il codice di uscita.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $composeOutput = [System.Collections.Generic.List[string]]::new()
  try {
    & docker compose --project-directory $projectRoot -f $composeFile @Arguments 2>&1 |
      ForEach-Object {
        $line = $_.ToString()
        $composeOutput.Add($line)
        Add-Content -LiteralPath $startupLog -Value $line -Encoding UTF8
        Write-Host $line
      }
    $composeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($composeExitCode -ne 0) {
    $failure = [System.Exception]::new("docker compose $($Arguments -join ' ') non riuscito (codice $composeExitCode).")
    $failure.Data["ComposeOutput"] = $composeOutput -join "`n"
    throw $failure
  }
}

try {
  Write-Startup "Avvio AndreaGPT."
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-File', ('"' + (Join-Path $PSScriptRoot 'telemetria_windows.ps1') + '"'))
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker non è disponibile nel PATH." }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    $dockerDesktop = @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe", "$env:LocalAppData\Docker\Docker Desktop.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $dockerDesktop) { throw "Docker Desktop non è avviato e non è stato trovato." }
    Write-Startup "Avvio Docker Desktop."
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    $dockerReady = $false
    foreach ($attempt in 1..60) {
      Start-Sleep -Seconds 2
      & docker info *> $null
      if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
    }
    if (-not $dockerReady) { throw "Docker non è diventato operativo entro 120 secondi." }
  }

  Write-Startup "Avvio o aggiornamento dei container."
  try {
    Invoke-Compose @("up", "-d", "--build", "--remove-orphans")
  } catch {
    $buildOutput = [string]$_.Exception.Data["ComposeOutput"]
    if ($buildOutput -notmatch '(?is)lookup\s+registry-1\.docker\.io[^\r\n]*no such host') { throw }
    Write-Startup "ATTENZIONE: Docker non risolve il DNS di Docker Hub. Tento l'avvio con le immagini locali, senza download."
    Write-Startup "Le ultime modifiche al codice non sono state compilate: verra' usata la versione gia' disponibile."
    try {
      Invoke-Compose @("up", "-d", "--no-build", "--pull", "never", "--remove-orphans")
    } catch {
      throw "Avvio con immagini locali non riuscito. Ripristina la connessione/DNS di Docker Desktop e riprova. Dettaglio: $($_.Exception.Message)"
    }
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $comfyStarter
  if ($LASTEXITCODE -eq 3) { Write-Startup "ComfyUI non installato in runtime\ComfyUI: generazione immagini non disponibile, il resto funziona." }
  elseif ($LASTEXITCODE -ne 0) { Write-Startup "ATTENZIONE: ComfyUI non è partito (dettagli in runtime\ComfyUI\andreagpt-comfy-error.log); la chat resta utilizzabile." }

  $portLine = & docker compose --project-directory $projectRoot -f $composeFile port andreagpt 3000 2>$null | Select-Object -First 1
  if ($portLine) {
    $browserAddress = $portLine -replace '^0\.0\.0\.0:', '127.0.0.1:' -replace '^\[::\]:', '127.0.0.1:'
    $url = "http://$browserAddress"
  } else { $url = "http://127.0.0.1:3000" }
  $ready = $false
  foreach ($attempt in 1..60) {
    try {
      $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
      if ($health) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $ready) {
    Write-Startup "AndreaGPT non ha superato il controllo di salute. Ultimi log:"
    Invoke-Compose @("logs", "--tail=100", "andreagpt")
    throw "Il server non ha risposto entro 120 secondi."
  }

  @{ startedAt = (Get-Date).ToString("o"); url = $url; projectRoot = $projectRoot } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
  Write-Startup "AndreaGPT operativo su $url"
  Write-Host "Log avvio: $startupLog"
  Write-Host "Log in tempo reale: apri Log-AndreaGPT.bat"
  Start-Process $url
  exit 0
} catch {
  Write-Startup "ERRORE: $($_.Exception.Message)"
  Write-Host "Dettagli salvati in $startupLog" -ForegroundColor Red
  exit 1
}
