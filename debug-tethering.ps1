Add-Type -AssemblyName System.Runtime.WindowsRuntime
Write-Host '--- START DEBUG ---'
$profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
Write-Host 'Profile:'
Write-Host $profile
if ($profile -eq $null) { Write-Host 'No profile'; exit 0 }
Write-Host 'Profile type:' $profile.GetType().FullName
$manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
Write-Host 'Manager type:' $manager.GetType().FullName
$async = $manager.StartTetheringAsync()
Write-Host 'Async type:' $async.GetType().FullName
$task = [System.WindowsRuntimeSystemExtensions]::AsTask($async)
Write-Host 'Task type:' $task.GetType().FullName
$task.Wait(-1)
Write-Host 'Task status:' $task.Status
Write-Host 'Task result:' $task.Result
if ($task.Result -ne $null) {
  $task.Result | Get-Member | Format-Table -AutoSize
}
Write-Host '--- END DEBUG ---'
