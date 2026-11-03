param([Parameter(Mandatory=$true)][string]$SnapshotDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$snapshotPath = [IO.Path]::GetFullPath($SnapshotDirectory)
if (-not $snapshotPath.StartsWith($projectRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Snapshot must stay inside this workspace.' }
if (Test-Path -LiteralPath $snapshotPath) { throw 'Use a new empty snapshot path.' }
$liveProfile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Cadence'
if (-not (Test-Path -LiteralPath $liveProfile -PathType Container)) { throw 'The Cadence library profile was not found.' }
$running = @(Get-Process -Name Cadence -ErrorAction SilentlyContinue)
foreach ($processItem in $running) {
    if ($processItem.MainWindowHandle -ne [IntPtr]::Zero) { [void]$processItem.CloseMainWindow() }
}
foreach ($processItem in $running) {
    if (-not $processItem.HasExited -and -not $processItem.WaitForExit(10000)) { throw 'Cadence is still running. Its profile has not been copied.' }
}
New-Item -ItemType Directory -Path $snapshotPath | Out-Null
foreach ($folderName in @('IndexedDB', 'Local Storage', 'blob_storage')) {
    $sourceFolder = Join-Path $liveProfile $folderName
    if (Test-Path -LiteralPath $sourceFolder) { Copy-Item -LiteralPath $sourceFolder -Destination (Join-Path $snapshotPath $folderName) -Recurse }
}
# Credentials, cookies, machine-bound encryption keys, caches and logs are excluded.
Write-Output "Captured library/settings snapshot: $snapshotPath"
Write-Output "CadenceWasRunning=$($running.Count -gt 0)"
