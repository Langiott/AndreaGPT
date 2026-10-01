param([switch]$Once)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$directory = Join-Path $projectRoot 'OUTPUT\Log'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$target = Join-Path $directory 'host-telemetry.json'
$lock = $null
try {
  $lock = [System.IO.File]::Open((Join-Path $directory 'host-telemetry.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch { exit 0 }
try {
  [System.IO.File]::WriteAllText((Join-Path $directory 'host-telemetry.pid'), [string]$PID)
  do {
    $cpu = $null
    $gpu = $null
    try {
      $processor = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'"
      if ($null -ne $processor.PercentProcessorUtility) { $cpu = [Math]::Min(100, [double]$processor.PercentProcessorUtility) }
    } catch {}
    try {
      $engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
      if ($engines.Count -gt 0) {
        # Sum processes sharing the same physical engine, then select busiest engine.
        $totals = @{}
        foreach ($engine in $engines) {
          $key = $engine.Name -replace '^pid_\d+_', ''
          $totals[$key] += [double]$engine.UtilizationPercentage
        }
        $gpu = [Math]::Min(100, ($totals.Values | Measure-Object -Maximum).Maximum)
      }
    } catch {}
    $sample = @{ at = [DateTime]::UtcNow.ToString('o'); cpu = $cpu; gpu = $gpu; source = 'Windows CIM'; gpuScope = 'Motore piu occupato, tutte le GPU' }
    $temporary = "$target.tmp"
    [System.IO.File]::WriteAllText($temporary, ($sample | ConvertTo-Json -Compress))
    Move-Item -LiteralPath $temporary -Destination $target -Force
    if (-not $Once) { Start-Sleep -Seconds 2 }
  } while (-not $Once)
} finally { $lock.Dispose() }
