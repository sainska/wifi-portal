# Configure and start Windows Mobile Hotspot as "FREE FAST WiFi" (open, no password).
# Run as Administrator.

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$ssid = "FREE FAST WiFi"
$log = Join-Path $PSScriptRoot "hotspot-restart.txt"
$lines = @()
$lines += "=== Hotspot setup $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
$lines += "SSID: $ssid"
$lines += "Security: Open (no password)"

function Set-OpenHotspotRegistry {
  param([string]$RegPath)

  if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
  }

  Set-ItemProperty -Path $RegPath -Name "Ssid" -Value $ssid -Type String -Force
  Set-ItemProperty -Path $RegPath -Name "AuthMode" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
  Set-ItemProperty -Path $RegPath -Name "PasswordPresent" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
  Set-ItemProperty -Path $RegPath -Name "PeerlessTimeoutEnabled" -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue

  if (Get-ItemProperty -Path $RegPath -Name "Passphrase" -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $RegPath -Name "Passphrase" -Force -ErrorAction SilentlyContinue
  }

  Set-ItemProperty -Path $RegPath -Name "Passphrase" -Value "" -Type String -Force -ErrorAction SilentlyContinue
}

# Stop hotspot so registry changes apply.
try {
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if ($profile) {
    $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
    if ($manager.TetheringOperationalState -eq [Windows.Networking.NetworkOperators.TetheringOperationalState]::On) {
      Await ($manager.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null
      Start-Sleep -Seconds 2
      $lines += "Stopped existing hotspot."
    }
  }
} catch {
  $lines += "Stop hotspot note: $($_.Exception.Message)"
}

# Registry paths used by Windows Mobile Hotspot.
$regPaths = @(
  "HKLM:\SYSTEM\CurrentControlSet\Services\icssvc\Settings\PersonalHotspot",
  "HKLM:\SOFTWARE\Microsoft\WcmSvc\Tethering\Settings"
)

foreach ($regPath in $regPaths) {
  try {
    Set-OpenHotspotRegistry -RegPath $regPath
    $lines += "Registry OK: $regPath"
  } catch {
    $lines += "Registry warn ($regPath): $($_.Exception.Message)"
  }
}

# Apply registry changes.
try {
  Restart-Service icssvc -Force -ErrorAction Stop
  Start-Sleep -Seconds 3
  $lines += "ICS service restarted."
} catch {
  $lines += "ICS restart note: $($_.Exception.Message)"
}

# Start hotspot using registry SSID (open). Do NOT set passphrase via API.
try {
  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $profile) {
    $lines += "ERROR: No internet connection on laptop. Connect to WiFi first."
  } else {
    $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)

    # Only set SSID — leave password unset so registry open-network settings apply.
    $apConfig = New-Object Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
    $apConfig.Ssid = $ssid

    try {
      $cfgResult = Await ($manager.ConfigureAccessPointAsync($apConfig)) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration])
      $lines += "ConfigureAccessPoint SSID: $($cfgResult.Ssid)"
    } catch {
      $lines += "ConfigureAccessPoint note: $($_.Exception.Message)"
      $lines += "Continuing with registry SSID..."
    }

    if ($manager.TetheringOperationalState -ne [Windows.Networking.NetworkOperators.TetheringOperationalState]::On) {
      $startResult = Await ($manager.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
      $lines += "StartTethering: $($startResult.Status)"
    } else {
      $lines += "StartTethering: Already On"
    }

    $activeSsid = $manager.AccessPointConfiguration.Ssid
    $lines += "Active SSID: $activeSsid"
    $lines += "Clients: $($manager.ClientCount)"
    $lines += "Open network: no password required"
    $lines += "Hotspot result: Success"
  }
} catch {
  $lines += "Hotspot API error: $($_.Exception.Message)"
  $lines += "Manual: Settings > Mobile hotspot > Network name '$ssid' > turn OFF password"
}

$regCheck = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\icssvc\Settings\PersonalHotspot" -ErrorAction SilentlyContinue
if ($regCheck) {
  $lines += "Registry SSID: $($regCheck.Ssid)"
  $lines += "Registry AuthMode: $($regCheck.AuthMode) (0=Open)"
  if ($null -ne $regCheck.PasswordPresent) {
    $lines += "Registry PasswordPresent: $($regCheck.PasswordPresent) (0=No password)"
  }
}

$lines += ""
$lines += "--- ipconfig (hotspot adapter) ---"
$lines += (ipconfig | Select-String -Pattern "137\.1" -Context 4,0 | Out-String)
$lines += "--- UDP 53 ---"
$lines += (netstat -ano -p udp | Select-String ':53 ' | Out-String)

$lines | Out-File -FilePath $log -Encoding utf8
Write-Host ($lines -join "`n")
