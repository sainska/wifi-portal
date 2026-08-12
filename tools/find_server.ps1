$out = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*server.js*' } | Select-Object ProcessId,CommandLine
if ($out) { $out | Format-List | Out-String | Write-Host } else { Write-Host 'No matching processes found.' }
