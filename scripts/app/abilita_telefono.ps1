$ErrorActionPreference = "Stop"

$ruleName = "AndreaGPT - telefono rete locale"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description "Consente AndreaGPT solo ai dispositivi della rete Wi-Fi locale 192.168.2.0/24." `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalAddress 192.168.2.221 `
  -LocalPort 3000 `
  -RemoteAddress 192.168.2.0/24 `
  -Profile Any | Out-Null

exit 0
