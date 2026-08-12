# Register scheduled tasks to start the WiFi portal and refresh the hotspot at boot and every 24 hours.
# Run this once as Administrator.

function Ensure-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Administrator rights required. Relaunching with elevation..."
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit 0
  }
}

Ensure-Administrator

$scriptPath = Join-Path $PSScriptRoot 'restart-portal.ps1'
if (-not (Test-Path $scriptPath)) {
  Write-Error "Required script not found: $scriptPath"
  exit 1
}

$powerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $powerShellExe)) {
  Write-Error "powershell.exe not found at $powerShellExe"
  exit 1
}

$taskAction = "$powerShellExe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
$taskNameStartup = 'WiFi Portal Startup'
$taskNameDaily = 'WiFi Portal Daily Refresh'

function Create-Task($name, $schedule, $arguments, $startTime) {
  Write-Host "Creating scheduled task: $name"
  $args = @('/Create', '/TN', $name, '/TR', $arguments, '/SC', $schedule, '/RL', 'HIGHEST', '/RU', 'SYSTEM', '/F')
  if ($startTime) {
    $args += '/ST'
    $args += $startTime
  }

  $process = Start-Process -FilePath 'schtasks.exe' -ArgumentList $args -NoNewWindow -Wait -PassThru -ErrorAction Stop
  if ($process.ExitCode -ne 0) {
    throw "schtasks failed with exit code $($process.ExitCode)"
  }
}

try {
  Create-Task -name $taskNameStartup -schedule 'ONSTART' -arguments $taskAction -startTime $null

  $dailyTime = (Get-Date).AddMinutes(2).ToString('HH:mm')
  Create-Task -name $taskNameDaily -schedule 'DAILY' -arguments $taskAction -startTime $dailyTime

  Write-Host "Scheduled tasks created successfully."
  Write-Host "  - $taskNameStartup"
  Write-Host "  - $taskNameDaily"
  Write-Host "Verify them with: schtasks /Query /TN `"$taskNameStartup`" /FO LIST"
} catch {
  Write-Error "Failed to register scheduled tasks: $($_.Exception.Message)"
  exit 1
}
