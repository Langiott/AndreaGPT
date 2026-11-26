[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$NuovoCodice)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\andreagpt-isolamento.lock')) {
  throw "AndreaGPT in isolamento. Sblocca l'avvio e avvia il container prima di installare l'accesso privato."
}
if (!$PSCmdlet.ShouldProcess('AndreaGPT', 'Installare il codice di accesso e riavviare il container')) { return }

$docker = (Get-Command docker.exe -CommandType Application | Select-Object -First 1).Source
$pipe = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('andreagpt-accesso-' + [guid]::NewGuid().ToString('N'))
$context = Join-Path $stage 'image'
$dockerConfig = Join-Path $stage 'docker'
$base = 'andreagpt-andreagpt:latest'
$image = 'andreagpt-andreagpt:accesso-privato'
$files = @('private_access.ts', 'private_access_setup.ts', 'index.ts')
$stopOnError = $false

function Invoke-AppDocker {
  & $docker --config $dockerConfig --host $pipe @args
  if ($LASTEXITCODE -ne 0) { throw "Operazione Docker locale non riuscita ($LASTEXITCODE)." }
}

[IO.Directory]::CreateDirectory($context) | Out-Null
[IO.Directory]::CreateDirectory($dockerConfig) | Out-Null
try {
  $running = @(Invoke-AppDocker container ls --filter 'name=^/?andreagpt$' --format '{{.Names}}')
  if ($running -cnotcontains 'andreagpt') { throw "Avvia AndreaGPT prima di installare l'accesso privato." }
  $baseId = Invoke-AppDocker image ls --filter "reference=$base" --format '{{.ID}}'
  if (!$baseId) { throw 'Immagine AndreaGPT locale mancante.' }
  foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $projectRoot 'backend') $file) -Destination $context
  }
  @'
FROM andreagpt-andreagpt:latest
COPY private_access.ts private_access_setup.ts index.ts /app/backend/
'@ | Set-Content -LiteralPath (Join-Path $context 'Dockerfile') -Encoding ASCII
  Invoke-AppDocker build --pull=false --network=none -t $image $context

  $stopOnError = $true
  foreach ($file in $files) {
    Invoke-AppDocker cp (Join-Path $context $file) "andreagpt:/app/backend/$file"
  }
  $setupArgs = @('exec', 'andreagpt', 'node', '--import', 'tsx', 'backend/private_access_setup.ts')
  if ($NuovoCodice) { $setupArgs += '--rotate' }
  Invoke-AppDocker @setupArgs
  Invoke-AppDocker restart --time 30 andreagpt

  $probe = "const a=fetch('http://127.0.0.1:3000/api/office'); const b=fetch('http://127.0.0.1:3000/accesso'); Promise.all([a,b]).then(([x,y])=>process.exit(x.status===401&&y.status===200?0:1),()=>process.exit(1));"
  $protected = $false
  foreach ($attempt in 1..25) {
    & $docker --config $dockerConfig --host $pipe exec andreagpt node -e $probe 2>$null
    if ($LASTEXITCODE -eq 0) { $protected = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (!$protected) { throw 'AndreaGPT non ha superato il controllo del blocco di accesso.' }
  Invoke-AppDocker tag $image $base
  $stopOnError = $false
  Write-Host 'Accesso privato attivo. Richiesta senza sessione respinta. Apri AndreaGPT dal browser e usa il codice.' -ForegroundColor Green
} catch {
  if ($stopOnError) {
    try { Invoke-AppDocker stop --time 30 andreagpt | Out-Null }
    catch { Write-Warning "Arresto non verificato. Usa Proteggi-AndreaGPT.ps1 per isolare l'app." }
  }
  throw
} finally {
  foreach ($file in @($files) + 'Dockerfile') {
    $stagedFile = Join-Path $context $file
    if (Test-Path -LiteralPath $stagedFile -PathType Leaf) { Remove-Item -LiteralPath $stagedFile }
  }
  foreach ($directory in @($context, $dockerConfig, $stage)) {
    try { [IO.Directory]::Delete($directory, $false) } catch [IO.IOException] {}
  }
}
