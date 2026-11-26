[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Proteggi')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Verifica')]
  [switch]$Verifica,

  [Parameter(Mandatory = $true, ParameterSetName = 'Ripristina')]
  [switch]$RipristinaAvvio
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$lockPath = Join-Path $projectRoot 'runtime\andreagpt-isolamento.lock'
$profileName = 'andreagpt-restritto.config.toml'
$profileSource = Join-Path $projectRoot $profileName
$profileDirectory = Join-Path $env:USERPROFILE '.codex'
$profileDestination = Join-Path $profileDirectory $profileName
$containerNames = @('andreagpt', 'andreagpt-n8n', 'andreagpt-scrapling', 'andreagpt-searxng')
$dockerPipe = 'npipe:////./pipe/dockerDesktopLinuxEngine'

function Invoke-LocalDocker {
  $docker = Get-Command docker.exe -CommandType Application | Select-Object -First 1
  # Usa una configurazione vuota per evitare di caricare le credenziali del client Docker.
  $dockerConfig = Join-Path ([IO.Path]::GetTempPath()) ('andreagpt-docker-' + [guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($dockerConfig) | Out-Null
  try {
    $result = & $docker.Source --config $dockerConfig --host $dockerPipe @args
    if ($LASTEXITCODE -ne 0) { throw "Il motore Docker locale ha restituito il codice $LASTEXITCODE." }
    return $result
  } finally {
    try { [IO.Directory]::Delete($dockerConfig, $false) } catch [IO.IOException] {}
  }
}

function Get-AppContainers([switch]$All) {
  $listArgs = @('container', 'ls', '--filter', 'name=^/?andreagpt(-n8n|-scrapling|-searxng)?$', '--format', '{{.Names}}')
  if ($All) { $listArgs += '--all' }
  Invoke-LocalDocker @listArgs | Where-Object { $containerNames -ccontains $_ }
}

function Get-AppWorkers {
  $scripts = @{
    'node.exe' = Join-Path $projectRoot 'scripts\app\adb_bridge.mjs'
    'powershell.exe' = Join-Path $projectRoot 'scripts\app\telemetria_windows.ps1'
  }
  foreach ($processName in $scripts.Keys) {
    # La query restituisce solo i PID dei processi che eseguono questi script del progetto.
    $scriptPath = $scripts[$processName].Replace('\', '\\').Replace("'", "\'").Replace('[', '[[]').Replace('%', '[%]').Replace('_', '[_]')
    Get-CimInstance -Query "SELECT ProcessId FROM Win32_Process WHERE Name = '$processName' AND CommandLine LIKE '%$scriptPath%'" |
      Select-Object -ExpandProperty ProcessId
  }
  $comfyRoot = (Join-Path $projectRoot 'runtime\ComfyUI').Replace('\', '\\').Replace("'", "\'")
  $comfyScript = "$comfyRoot\\main.py".Replace('[', '[[]').Replace('%', '[%]').Replace('_', '[_]')
  $comfyPython = "$comfyRoot\\.venv\\Scripts\\python.exe"
  $comfyProcesses = @(Get-CimInstance -Query "SELECT ProcessId FROM Win32_Process WHERE Name = 'python.exe' AND (CommandLine LIKE '%$comfyScript%' OR (ExecutablePath = '$comfyPython' AND CommandLine LIKE '%main.py%'))")
  foreach ($comfy in $comfyProcesses) {
    Get-CimInstance -Query "SELECT ProcessId FROM Win32_Process WHERE Name = 'python.exe' AND ParentProcessId = $($comfy.ProcessId) AND CommandLine LIKE '%main.py%'" |
      Select-Object -ExpandProperty ProcessId
    $comfy.ProcessId
  }
}

function Show-Status {
  $isLocked = Test-Path -LiteralPath $lockPath -PathType Leaf
  $containers = @(Get-AppContainers)
  $workers = @(Get-AppWorkers)
  Write-Host "Blocco dei launcher: $isLocked"
  Write-Host "Container AndreaGPT attivi: $($containers.Count)"
  Write-Host "Processi ausiliari AndreaGPT attivi: $($workers.Count)"
  Write-Host "Profilo Codex locale presente: $(Test-Path -LiteralPath $profileDestination -PathType Leaf)"
  if (!$isLocked -or $containers.Count -or $workers.Count) {
    throw 'Isolamento non verificato.'
  }
  Write-Host 'Servizi AndreaGPT arrestati. I launcher sono bloccati.' -ForegroundColor Green
}

if ($Verifica) {
  Show-Status
  return
}

if ($RipristinaAvvio) {
  if (!(Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    Write-Host 'Il blocco dei launcher non e attivo.'
    return
  }
  if (!$PSCmdlet.ShouldProcess('AndreaGPT', 'Rimuovere il blocco dei launcher e ripristinare la politica di riavvio')) { return }
  $containers = @(Get-AppContainers -All)
  if ($containers.Count) { Invoke-LocalDocker update --restart=unless-stopped @containers | Out-Null }
  Remove-Item -LiteralPath $lockPath -ErrorAction Stop
  Write-Host 'Avvio ripristinato. Per avviare AndreaGPT usa Avvia-AndreaGPT.bat.'
  return
}

if (!$PSCmdlet.ShouldProcess('AndreaGPT', 'Arrestare i servizi e bloccare i launcher')) { return }

New-Item -ItemType Directory -Path (Split-Path -Parent $lockPath) -Force | Out-Null
if (!(Test-Path -LiteralPath $lockPath -PathType Leaf)) {
  New-Item -ItemType File -Path $lockPath | Out-Null
}

$failures = [System.Collections.Generic.List[string]]::new()
try {
  $containers = @(Get-AppContainers -All)
  if ($containers.Count) {
    try { Invoke-LocalDocker update --restart=no @containers | Out-Null }
    catch { $failures.Add('Disattivazione del riavvio automatico Docker non riuscita.') }
    $running = @(Get-AppContainers)
    if ($running.Count) { Invoke-LocalDocker container stop --time 30 @running | Out-Null }
  }
} catch { $failures.Add('Arresto dei container non verificato. Controlla Docker Desktop e i permessi del tuo account.') }

try {
  foreach ($workerId in @(Get-AppWorkers | Select-Object -Unique)) {
    try {
      $worker = Get-Process -Id $workerId -ErrorAction SilentlyContinue
      if ($worker) { $worker | Stop-Process -ErrorAction Stop }
    } catch { $failures.Add("Arresto del processo AndreaGPT $workerId non riuscito.") }
  }
} catch { $failures.Add('Arresto dei processi ausiliari non verificato.') }

try {
  if (!(Test-Path -LiteralPath $profileDestination -PathType Leaf)) {
    New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
    [IO.File]::Copy($profileSource, $profileDestination, $false)
    Write-Host 'Profilo Codex installato per le nuove sessioni CLI.'
  } else {
    Write-Host 'Profilo Codex gia presente. Conservata la copia esistente.'
  }
  Write-Host 'Per una nuova sessione CLI: codex -p andreagpt-restritto'
  Write-Host 'Per una sessione con permessi gestiti, il profilo va selezionato dal gestore dei permessi.'
} catch { $failures.Add('Installazione del profilo Codex non riuscita.') }

try { Show-Status }
catch { $failures.Add('La verifica finale dei servizi non e riuscita.') }
if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
