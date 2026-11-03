param([string]$PreparedDirectory = 'release\staged-1.0.12\win-unpacked')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$rootPrefix = $taskRoot.TrimEnd('\') + '\'
$currentDirectory = [IO.Path]::GetFullPath((Join-Path $taskRoot 'release\win-unpacked'))
$preparedPath = (Resolve-Path -LiteralPath (Join-Path $taskRoot $PreparedDirectory)).ProviderPath
$backupDirectory = [IO.Path]::GetFullPath((Join-Path $taskRoot ('release\previous-build-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss'))))

# All directory moves must remain inside this exact workspace.
foreach ($taskPath in @($currentDirectory, $preparedPath, $backupDirectory)) {
    if (-not $taskPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Update path is outside the workspace: $taskPath"
    }
    if (Test-Path -LiteralPath $taskPath) {
        if ((Get-Item -LiteralPath $taskPath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "The updater does not move redirected directories: $taskPath"
        }
    }
}
if ($preparedPath -eq $currentDirectory) { throw 'Prepared build must be separate from the running application.' }
if (Test-Path -LiteralPath $backupDirectory) { throw 'Backup directory already exists.' }
$preparedExecutable = Join-Path $preparedPath 'Cadence.exe'
$currentExecutable = Join-Path $currentDirectory 'Cadence.exe'
foreach ($taskFile in @($preparedExecutable, (Join-Path $preparedPath 'resources\app.asar'), (Join-Path $preparedPath 'resources\models\onnx-community\Kokoro-82M-v1.0-ONNX\onnx\model.onnx'))) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Prepared build is incomplete: $taskFile" }
}

$matchingProcesses = @(Get-Process -Name Cadence -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $currentExecutable })
foreach ($taskProcess in $matchingProcesses) {
    if ($taskProcess.MainWindowHandle -ne [IntPtr]::Zero) { [void]$taskProcess.CloseMainWindow() }
}
foreach ($taskProcess in $matchingProcesses) {
    if (-not $taskProcess.HasExited -and -not $taskProcess.WaitForExit(10000)) {
        throw 'Cadence is still running. The existing build has been preserved; close its window before applying the update.'
    }
}

Move-Item -LiteralPath $currentDirectory -Destination $backupDirectory
try { Move-Item -LiteralPath $preparedPath -Destination $currentDirectory }
catch {
    if (-not (Test-Path -LiteralPath $currentDirectory)) { Move-Item -LiteralPath $backupDirectory -Destination $currentDirectory }
    throw
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$newProcess = Start-Process -FilePath $currentExecutable -WorkingDirectory $currentDirectory -WindowStyle Normal -PassThru
Start-Sleep -Seconds 2
if ($newProcess.HasExited) { throw 'The updated app closed during startup. The previous build is retained in release.' }
Write-Output "Updated and opened Cadence. Desktop shortcut target: $currentExecutable"
Write-Output "Previous build retained at: $backupDirectory"
