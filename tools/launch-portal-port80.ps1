$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\Users\Admin\Downloads\wifi-portal\wifi-portal'
$log = Join-Path $projectRoot 'portal.log'
$errLog = Join-Path $projectRoot 'portal.err.log'

Set-Location $projectRoot

$env:HTTP_PORT = '80'
$env:HTTP_BIND_IP = '0.0.0.0'
$env:DNS_BIND_IP = '0.0.0.0'
$env:PORTAL_IP = '192.168.137.1'

Remove-Item $log, $errLog -ErrorAction SilentlyContinue

Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog
Start-Sleep -Seconds 5

Write-Host 'Portal launch attempted.'
Get-Content $log -ErrorAction SilentlyContinue
if (Test-Path $errLog) {
  $e = Get-Content $errLog -Raw -ErrorAction SilentlyContinue
  if ($e) { Write-Host '--- stderr ---'; Write-Host $e }
}

Write-Host '--- HTTP listeners ---'
Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, State, OwningProcess | Format-Table -AutoSize

Write-Host '--- DNS listeners ---'
Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize

Write-Host '--- HTTP check ---'
curl.exe -I http://127.0.0.1:80/ | Select-Object -First 5
