$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modelsRoot = Join-Path $projectRoot "runtime\ComfyUI\models"
Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:ALL_PROXY -ErrorAction SilentlyContinue

function Download-Model([string]$Url, [string]$Target) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $Target) | Out-Null
  if (Test-Path -LiteralPath $Target) {
    $existing = Get-Item -LiteralPath $Target
    if ($existing.Length -gt 100MB) {
      Write-Host "Gia presente, salto: $($existing.Name)"
      return
    }
    Remove-Item -LiteralPath $Target -Force
  }
  & curl.exe -L --fail --retry 20 --retry-all-errors --continue-at - --output $Target $Url
  if ($LASTEXITCODE -ne 0) { throw "Download fallito: $Target" }
}

Download-Model "https://huggingface.co/AlperKTS/Qwen-Image-2.1-GGUF/resolve/main/qwen_image_2.1_Q5_K_M.gguf?download=true" (Join-Path $modelsRoot "diffusion_models\qwen_image_2.1_Q5_K_M.gguf")
Download-Model "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_w4a8.safetensors?download=true" (Join-Path $modelsRoot "text_encoders\qwen3vl_8b_w4a8.safetensors")
Download-Model "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors?download=true" (Join-Path $modelsRoot "vae\qwen_image_2.1_vae_bf16.safetensors")
Set-Content -LiteralPath (Join-Path $modelsRoot ".andreagpt-qwen-ready") -Value (Get-Date -Format o)
