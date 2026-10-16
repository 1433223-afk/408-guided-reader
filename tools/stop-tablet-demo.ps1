param([int]$Port = 8876)
$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) { Write-Host 'Tablet Demo is already stopped.'; return }
foreach ($tabletProcessId in ($listeners.OwningProcess | Select-Object -Unique)) {
    $tabletProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$tabletProcessId"
    if ($tabletProcess.CommandLine -notmatch '(?:^|\s)-m\s+reader_service(?:\s|$)' -or
        $tabletProcess.CommandLine -notmatch '--tablet-lan\s+' -or
        $tabletProcess.CommandLine -notmatch "--port\s+$Port(?:\s|$)") {
        throw "Port $Port belongs to another process. No process was stopped."
    }
    Stop-Process -Id $tabletProcessId
}
Write-Host 'Tablet Demo stopped. Its independent reading data is retained.'
