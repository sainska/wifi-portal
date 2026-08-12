$ErrorActionPreference = 'Stop'

$ruleNames = @(
  'WiFiPortal-UDP53',
  'WiFiPortal-TCP80',
  'WiFiPortal-TCP443'
)

foreach ($name in $ruleNames) {
  try {
    Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  } catch {}
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $nodePath) {
  Write-Host 'node.exe not found in PATH; skipping firewall rule creation.'
  exit 0
}

$program = $nodePath

New-NetFirewallRule -DisplayName 'WiFiPortal-UDP53' -Direction Inbound -Protocol UDP -LocalPort 53 -Program $program -Profile Private,Domain -Action Allow | Out-Null
New-NetFirewallRule -DisplayName 'WiFiPortal-TCP80' -Direction Inbound -Protocol TCP -LocalPort 80 -Program $program -Profile Private,Domain -Action Allow | Out-Null
New-NetFirewallRule -DisplayName 'WiFiPortal-TCP443' -Direction Inbound -Protocol TCP -LocalPort 443 -Program $program -Profile Private,Domain -Action Allow | Out-Null

Write-Host 'Firewall rules created for the portal DNS/HTTP ports.'
