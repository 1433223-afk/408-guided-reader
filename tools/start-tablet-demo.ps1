param(
    [Parameter(Mandatory = $true)]
    [string]$BindAddress,
    [int]$Port = 8876,
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA '408GuidedReaderAndroidTabletDemo'),
    [string]$SourceDataDir,
    [string[]]$BookId = @(),
    [string]$Python = 'python',
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$tabletWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$previousPythonPath = $env:PYTHONPATH
$previousPythonEncoding = $env:PYTHONIOENCODING
try {
    # Always use this isolated checkout, even when python's editable install
    # still points to the desktop/main checkout.
    $env:PYTHONPATH = Join-Path $tabletWorkspace 'src'
    $env:PYTHONIOENCODING = 'utf-8'
    if ($BookId.Count -gt 0 -and -not $SourceDataDir) {
        throw 'BookId requires SourceDataDir.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $DataDir '.tablet-demo.json'))) {
        $prepareArgs = @('-m', 'reader_service.tablet_demo', 'prepare', '--data-dir', $DataDir)
        if ($SourceDataDir) {
            $prepareArgs += @('--source-data-dir', $SourceDataDir)
            foreach ($selectedBook in $BookId) {
                $prepareArgs += @('--book-id', $selectedBook)
            }
        }
        & $Python @prepareArgs
        if ($LASTEXITCODE -ne 0) { throw 'Tablet Demo preparation failed; source library was not changed.' }
    } elseif ($SourceDataDir -or $BookId.Count -gt 0) {
        Write-Host 'Using existing independent Demo data; the source library will not be copied again.'
    }
    $serveArgs = @('-m', 'reader_service', '--tablet-lan', $BindAddress, '--port', "$Port", '--data-dir', $DataDir, '--prepare-workers', '1')
    if ($NoOpen) { $serveArgs += '--no-open' }
    Write-Host 'Keep this window open. On the tablet, open the full READY address printed below.'
    Write-Host 'The READY address is a per-launch credential. Do not redirect output into a log or share it.'
    & $Python @serveArgs
    if ($LASTEXITCODE -ne 0) { throw 'Tablet Demo service stopped with an error.' }
} finally {
    $env:PYTHONPATH = $previousPythonPath
    $env:PYTHONIOENCODING = $previousPythonEncoding
}
