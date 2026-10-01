$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$comfyRoot = Join-Path $projectRoot "runtime\ComfyUI"
$python = Join-Path $comfyRoot ".venv\Scripts\python.exe"
$stdoutLog = Join-Path $comfyRoot "andreagpt-comfy.log"
$stderrLog = Join-Path $comfyRoot "andreagpt-comfy-error.log"
$pidFile = Join-Path $comfyRoot "andreagpt-comfy.pid"

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8188/system_stats" -TimeoutSec 2 | Out-Null
  $existing = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'main\.py' -and $_.CommandLine -match '(?:--port\s+8188|--listen\s+127\.0\.0\.1)' } | Select-Object -First 1
  if ($existing) { Set-Content -LiteralPath $pidFile -Value $existing.ProcessId -Encoding ASCII }
  exit 0
} catch { }

$requiredFiles = @(
  $python,
  (Join-Path $comfyRoot "main.py"),
  (Join-Path $comfyRoot "models\diffusion_models\qwen_image_2.1_Q5_K_M.gguf"),
  (Join-Path $comfyRoot "models\text_encoders\qwen3vl_8b_w4a8.safetensors"),
  (Join-Path $comfyRoot "models\vae\qwen_image_2.1_vae_bf16.safetensors")
)
$missing = $requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) {
  $missing | ForEach-Object { Add-Content -LiteralPath $stderrLog -Value "File mancante: $_" }
  exit 2
}

$process = Start-Process -FilePath $python `
  -ArgumentList @("main.py", "--listen", "127.0.0.1", "--port", "8188", "--lowvram") `
  -WorkingDirectory $comfyRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
