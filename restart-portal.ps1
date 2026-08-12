# Start the WiFi portal and restart Mobile Hotspot (run as Administrator)
function Assert-Administrator {
  $current = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Administrator rights required. Relaunching with elevation..."
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit 0
  }
}

Assert-Administrator
Set-Location $PSScriptRoot

# Force the captive-portal defaults for Windows ICS/hotspot bindings.
$env:HTTP_PORT = "80"
$env:HTTP_BIND_IP = "192.168.137.1"
$env:DNS_BIND_IP = "192.168.137.1"
$env:PORTAL_IP = "192.168.137.1"

# Preflight checks: ensure Node and server.js are present and ready
$errors = @()
$log = Join-Path $PSScriptRoot "portal.log"
$errLog = Join-Path $PSScriptRoot "portal.err.log"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $errors += "Node.js not found in PATH. Install Node LTS and retry."
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'server.js'))) {
  $errors += "Missing server.js in the portal directory ($PSScriptRoot). Ensure you're in the project root."
}

if ($errors.Count -gt 0) {
  Write-Host "Preflight checks failed:" -ForegroundColor Red
  $errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
  exit 1
}

$nodeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"

foreach ($procEntry in $nodeProcesses) {
  try {
    Stop-Process -Id $procEntry.ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped Node.js process PID $($procEntry.ProcessId)"
  } catch {
    Write-Host "Could not stop Node.js process PID $($procEntry.ProcessId): $($_.Exception.Message)"
  }
}

Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

$sharedAccess = Get-Service -Name SharedAccess -ErrorAction SilentlyContinue
if ($sharedAccess) {
  if ($sharedAccess.Status -ne 'Running') {
    Write-Host "Starting Windows SharedAccess (ICS)..."
    Start-Service -Name SharedAccess -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  } else {
    Write-Host "SharedAccess (ICS) is already running."
  }
} else {
  Write-Host "SharedAccess service not found; ensure Internet Connection Sharing is configured." -ForegroundColor Yellow
}

Write-Host "Enabling hotspot before starting the portal..."
& (Join-Path $PSScriptRoot 'enable-hotspot.ps1')
Start-Sleep -Seconds 6

Remove-Item $log, $errLog -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog
Start-Sleep -Seconds 5

Write-Host "Node PID: $($proc.Id)"
if (Test-Path $log) { Write-Host "--- portal.log ---"; Get-Content $log }
if (Test-Path $errLog) { $e = Get-Content $errLog -Raw; if ($e) { Write-Host "--- portal.err.log ---"; Write-Host $e } }

$http = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
Write-Host "HTTP listening: $($null -ne $http)"

Write-Host "Restarting Mobile Hotspot..."
& (Join-Path $PSScriptRoot "enable-hotspot.ps1")
Start-Sleep -Seconds 2

if (Test-Path (Join-Path $PSScriptRoot "hotspot-restart.txt")) {
  Get-Content (Join-Path $PSScriptRoot "hotspot-restart.txt")
}

if (Test-Path $log) { Write-Host "--- portal.log (after hotspot) ---"; Get-Content $log }
