$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AndreaNativeIcon {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$assets = Join-Path $root "assets"
if (-not (Test-Path -LiteralPath $assets)) {
    New-Item -ItemType Directory -Path $assets | Out-Null
}

$iconPath = Join-Path $assets "andreagpt-cornetto.ico"
$public = Join-Path $root "public"
$sourcePath = Join-Path $root "img\LOGO1.png"
$webLogoPath = Join-Path $public "andreagpt-logo.png"
if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Logo sorgente non trovato: $sourcePath"
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
$cropSize = [int]([Math]::Min($source.Width, $source.Height) * 0.56)
$crop = New-Object System.Drawing.Rectangle(
    [int](($source.Width - $cropSize) / 2),
    [int]($source.Height * 0.14),
    $cropSize,
    $cropSize
)

$webLogo = New-Object System.Drawing.Bitmap 512, 512
$webGraphics = [System.Drawing.Graphics]::FromImage($webLogo)
$webGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$webGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$webGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#FFF8E7"))
$webGraphics.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, 512, 512), $crop, [System.Drawing.GraphicsUnit]::Pixel)
$webLogo.Save($webLogoPath, [System.Drawing.Imaging.ImageFormat]::Png)

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#FFF8E7"))
$graphics.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, 256, 256), $crop, [System.Drawing.GraphicsUnit]::Pixel)

$handle = $bitmap.GetHicon()
try {
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    $stream = [System.IO.File]::Create($iconPath)
    try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose() }
} finally {
    [AndreaNativeIcon]::DestroyIcon($handle) | Out-Null
    $graphics.Dispose()
    $bitmap.Dispose()
    $webGraphics.Dispose()
    $webLogo.Dispose()
    $source.Dispose()
}

$shell = New-Object -ComObject WScript.Shell
$shortcuts = @(
    @{ Name = "Avvia AndreaGPT.lnk"; Target = "Avvia-AndreaGPT.bat"; Description = "Avvia AndreaGPT" },
    @{ Name = "Ferma AndreaGPT.lnk"; Target = "Ferma-AndreaGPT.bat"; Description = "Ferma AndreaGPT" }
)

foreach ($item in $shortcuts) {
    $shortcut = $shell.CreateShortcut((Join-Path $root $item.Name))
    $shortcut.TargetPath = Join-Path $root $item.Target
    $shortcut.WorkingDirectory = $root
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = $item.Description
    $shortcut.WindowStyle = 1
    $shortcut.Save()
}

Write-Host "Logo e collegamenti AndreaGPT creati correttamente."
