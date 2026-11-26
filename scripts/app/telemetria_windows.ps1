param([switch]$Once)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\andreagpt-isolamento.lock')) { exit 1 }
$directory = Join-Path $projectRoot 'OUTPUT\Log'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$target = Join-Path $directory 'host-telemetry.json'
$systemTarget = Join-Path $directory 'host-system.json'

function Write-Sample($Path, $Sample) {
  $temporary = "$Path.tmp"
  [System.IO.File]::WriteAllText($temporary, ($Sample | ConvertTo-Json -Depth 7 -Compress))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Read-Temperatures {
  $sensors = @()
  try {
    $entries = Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType='Temperature'" -ErrorAction Stop
    $sensors = @($entries | Where-Object { $_.Value -gt 0 -and $_.Value -le 130 } | Select-Object -First 24 | ForEach-Object {
      @{ id = [string]$_.Identifier; label = [string]$_.Name; celsius = [Math]::Round($_.Value, 1); source = 'LibreHardwareMonitor' }
    })
  } catch {}
  if ($sensors.Count) { return $sensors }

  try {
    $zones = Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction Stop
    $sensors = @($zones | Where-Object { $_.Temperature -gt 273 -and $_.Temperature -le 403 } | Select-Object -First 12 | ForEach-Object {
      @{ id = "zone:$($_.Name)"; label = "Zona termica $($_.Name)"; celsius = [Math]::Round([double]$_.Temperature - 273.15, 1); source = 'Windows ACPI' }
    })
  } catch {}
  if ($sensors.Count) { return $sensors }

  try {
    $zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
    $sensors = @($zones | Where-Object { $_.CurrentTemperature -gt 2731 -and $_.CurrentTemperature -le 4031 } | Select-Object -First 12 | ForEach-Object {
      @{ id = "acpi:$($_.InstanceName)"; label = 'Zona termica ACPI'; celsius = [Math]::Round($_.CurrentTemperature / 10 - 273.15, 1); source = 'Windows ACPI' }
    })
  } catch {}
  if ($sensors.Count) { return $sensors }

  try {
    Get-PhysicalDisk -ErrorAction Stop | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | Where-Object {
      $_.Temperature -gt 0 -and $_.Temperature -le 130
    } | Select-Object -First 12 | ForEach-Object {
      @{ id = "disk:$($_.DeviceId)"; label = "Disco fisico $($_.DeviceId)"; celsius = [double]$_.Temperature; source = 'Windows Storage' }
    }
  } catch {}
}

$lock = $null
try {
  $lock = [System.IO.File]::Open((Join-Path $directory 'host-telemetry.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch { exit 0 }
try {
  [System.IO.File]::WriteAllText((Join-Path $directory 'host-telemetry.pid'), [string]$PID)
  $computer = $null
  $processors = @()
  $graphics = @()
  try { $computer = Get-CimInstance Win32_ComputerSystem } catch {}
  try { $processors = @(Get-CimInstance Win32_Processor) } catch {}
  try { $graphics = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) } catch {}
  $history = @()
  try {
    $prior = Get-Content -LiteralPath $systemTarget -Raw | ConvertFrom-Json
    $history = @($prior.history | Select-Object -Last 179)
  } catch {}
  $lastHistoryAt = [DateTime]::MinValue
  $lastDetailAt = [DateTime]::MinValue
  $systemDrive = [string]$env:SystemDrive
  $volumes = @()
  $temperatures = @()
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
    $memory = $null
    $os = $null
    try {
      $os = Get-CimInstance Win32_OperatingSystem -Property Caption, LastBootUpTime, TotalVisibleMemorySize, FreePhysicalMemory
      if ($os.TotalVisibleMemorySize -gt 0) {
        $total = [long]$os.TotalVisibleMemorySize * 1KB
        $free = [long]$os.FreePhysicalMemory * 1KB
        if ($free -ge 0 -and $free -le $total) { $memory = @{ total = $total; free = $free } }
      }
    } catch {}

    if (([DateTime]::UtcNow - $lastDetailAt).TotalSeconds -ge 15) {
      try {
        $volumes = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.Size -gt 0 -and $null -ne $_.FreeSpace } | Sort-Object DeviceID | ForEach-Object {
          @{ drive = [string]$_.DeviceID; label = [string]$_.VolumeName; total = [long]$_.Size; free = [long]$_.FreeSpace }
        })
      } catch { $volumes = @() }
      $temperatures = @(Read-Temperatures)
      $lastDetailAt = [DateTime]::UtcNow
    }

    $now = [DateTime]::UtcNow
    $sample = @{ at = $now.ToString('o'); cpu = $cpu; gpu = $gpu; source = 'Windows CIM'; gpuScope = 'Motore piu occupato, tutte le GPU' }
    Write-Sample $target $sample
    $primaryDisk = $volumes | Where-Object { $_.drive -eq $systemDrive } | Select-Object -First 1
    $sensor = $temperatures | Sort-Object celsius -Descending | Select-Object -First 1
    $point = @{
      at = $sample.at; cpu = $cpu; gpu = $gpu
      ram = if ($memory) { [Math]::Round(100 * ($memory.total - $memory.free) / $memory.total, 1) } else { $null }
      disk = if ($primaryDisk) { [Math]::Round(100 * ($primaryDisk.total - $primaryDisk.free) / $primaryDisk.total, 1) } else { $null }
      temperature = if ($sensor) { $sensor.celsius } else { $null }
      sensorId = if ($sensor) { $sensor.id } else { $null }
    }
    if (($now - $lastHistoryAt).TotalSeconds -ge 10) {
      $history = @($history | Select-Object -Last 179) + @($point)
      $lastHistoryAt = $now
    }
    $boot = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToUniversalTime().ToString('o') } else { $null }
    Write-Sample $systemTarget @{
      at = $sample.at; source = $sample.source; cpu = $cpu; gpu = $gpu; memory = $memory; systemDrive = $systemDrive
      manufacturer = [string]$computer.Manufacturer; model = [string]$computer.Model; os = [string]$os.Caption; boot = $boot
      processor = ($processors.Name -join ' / '); threads = [int]($processors | Measure-Object NumberOfLogicalProcessors -Sum).Sum
      graphics = $graphics; disks = $volumes; temperatures = $temperatures; history = $history
    }
    if (-not $Once) { Start-Sleep -Seconds 2 }
  } while (-not $Once)
} finally { $lock.Dispose() }
