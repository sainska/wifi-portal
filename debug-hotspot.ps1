Add-Type -AssemblyName System.Runtime.WindowsRuntime
Write-Host '--- START DEBUG ---'
$profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
Write-Host 'Internet profile object:'
if ($profile -eq $null) { Write-Host 'NULL'; } else { Write-Host $profile; Write-Host 'Type:' $profile.GetType().FullName }
if ($profile -ne $null) {
  $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
  Write-Host 'Tethering manager type:' $manager.GetType().FullName
  $async = $manager.StartTetheringAsync()
  Write-Host 'StartTetheringAsync type:' $async.GetType().FullName
  $task = [System.WindowsRuntimeSystemExtensions]::AsTask($async)
  Write-Host 'Task type:' $task.GetType().FullName
  try {
    $task.Wait(-1)
    Write-Host 'Task status:' $task.Status
    Write-Host 'Task result:' $task.Result
    if ($task.Result -ne $null) { $task.Result | Get-Member | Format-Table -AutoSize }
  } catch { Write-Host 'Task wait error:' $_.Exception.Message }
}
Write-Host '--- NETWORK ADAPTERS ---'
Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Tether|Hotspot|Wi-Fi|Wireless|WLAN' } | Format-Table -AutoSize
Write-Host '--- CONNECTION PROFILES ---'
Get-NetConnectionProfile | Format-Table -AutoSize
Write-Host '--- REGISTRY HOTSPOT ---'
Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\icssvc\Settings\PersonalHotspot' -ErrorAction SilentlyContinue | Format-List *
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WcmSvc\Tethering\Settings' -ErrorAction SilentlyContinue | Format-List *
