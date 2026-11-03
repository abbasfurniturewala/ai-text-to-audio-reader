param(
    [string]$Destination = (Join-Path $env:USERPROFILE 'CadenceReader'),
    [string]$ProfileDirectory = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Cadence'),
    [switch]$NoLaunch,
    [switch]$NoShortcut,
    [switch]$PrepareBuild
)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64')) { throw 'This bundle targets Windows with an Intel/AMD 64-bit processor.' }
$bundleRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$localRoot = [IO.Path]::GetFullPath($Destination)
$profilePath = [IO.Path]::GetFullPath($ProfileDirectory)
$bundleManifest = Join-Path $bundleRoot 'MIGRATION_BUNDLE.json'
if (-not (Test-Path -LiteralPath $bundleManifest)) { throw 'Extract the complete migration ZIP before running this script.' }
if ($localRoot.TrimEnd('\') -eq [IO.Path]::GetPathRoot($localRoot).TrimEnd('\')) { throw 'Choose a project folder, not a drive root.' }
if ($localRoot.StartsWith($bundleRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a destination outside the extracted transfer folder to avoid recursive copies.' }
foreach ($cloudRoot in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) {
    if ($cloudRoot -and ($localRoot.TrimEnd('\') -eq $cloudRoot.TrimEnd('\') -or $localRoot.StartsWith($cloudRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase))) { throw 'Choose a local destination outside OneDrive for the working app.' }
}
$bundle = Get-Content -LiteralPath $bundleManifest -Raw | ConvertFrom-Json
$nodeSource = Join-Path $bundleRoot 'tools\node\node.exe'
Write-Output 'Verifying the complete transfer...'
& $nodeSource (Join-Path $bundleRoot 'migration\verify-bundle.mjs') $bundleRoot
if ($LASTEXITCODE -ne 0) { throw 'Bundle verification failed. Re-download the ZIP and extract it again.' }
if ($localRoot -ne $bundleRoot) {
    if ((Test-Path -LiteralPath $localRoot) -and @(Get-ChildItem -LiteralPath $localRoot -Force).Count -gt 0) {
        $existingManifest = Join-Path $localRoot 'MIGRATION_BUNDLE.json'
        if (-not (Test-Path -LiteralPath $existingManifest) -or (Get-Content -LiteralPath $existingManifest -Raw | ConvertFrom-Json).bundleId -ne $bundle.bundleId) { throw "Destination already contains files. Choose another -Destination; existing work has been preserved: $localRoot" }
        Write-Output 'This migration already has a local workspace. Preserving its existing files and edits.'
    } else {
        New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
        foreach ($entry in Get-ChildItem -LiteralPath $bundleRoot -Force) { Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $localRoot $entry.Name) -Recurse }
    }
}
$nodeLocal = Join-Path $localRoot 'tools\node\node.exe'
$appDirectory = Join-Path $localRoot 'release\win-unpacked'
$appExecutable = Join-Path $appDirectory 'Cadence.exe'
if (-not (Test-Path -LiteralPath $appExecutable)) { throw 'The packaged app is missing.' }
if (Get-Process -Name Cadence -ErrorAction SilentlyContinue) { throw 'Close Cadence before restoring its library, then run this command again.' }
Write-Output 'Restoring books, bookmarks and reading positions (existing destination books are preserved)...'
& $nodeLocal (Join-Path $localRoot 'migration\migrate-library.mjs') import --app $appExecutable --profile $profilePath --input (Join-Path $localRoot 'migration\library')
if ($LASTEXITCODE -ne 0) { throw 'Library restoration failed. The original transfer and existing library have been preserved.' }
if ($PrepareBuild) {
    $modelCache = Join-Path $localRoot '.cache\models'
    if (-not (Test-Path -LiteralPath (Join-Path $modelCache 'onnx-community\Kokoro-82M-v1.0-ONNX\onnx\model.onnx'))) {
        New-Item -ItemType Directory -Path $modelCache -Force | Out-Null
        foreach ($entry in Get-ChildItem -LiteralPath (Join-Path $appDirectory 'resources\models') -Force) { Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $modelCache $entry.Name) -Recurse }
    }
}
if (-not $NoShortcut) {
    $desktopFolder = [Environment]::GetFolderPath('DesktopDirectory')
    $shortcutPath = Join-Path $desktopFolder 'Cadence Reader.lnk'
    $shell = New-Object -ComObject WScript.Shell
    if ((Test-Path -LiteralPath $shortcutPath) -and $shell.CreateShortcut($shortcutPath).TargetPath -ne $appExecutable) { $shortcutPath = Join-Path $desktopFolder 'Cadence Reader (migrated).lnk' }
    if ((Test-Path -LiteralPath $shortcutPath) -and $shell.CreateShortcut($shortcutPath).TargetPath -ne $appExecutable) { throw 'A migrated shortcut already points elsewhere. Run with -NoShortcut or choose a shortcut name manually.' }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $appExecutable; $shortcut.WorkingDirectory = $appDirectory; $shortcut.IconLocation = "$appExecutable,0"
    $shortcut.Description = 'Cadence Reader - natural offline narration'
    $shortcut.Save()
    Write-Output "Desktop shortcut: $shortcutPath"
}
@{ appVersion = $bundle.appVersion; bundleId = $bundle.bundleId; restoredAt = [DateTime]::UtcNow.ToString('o'); workspace = $localRoot; profile = $profilePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localRoot 'migration\RESTORE_REPORT.json') -Encoding UTF8
Write-Output "Ready. Open this folder in Codex: $localRoot"
Write-Output 'Read CODEX_SETUP_PROMPT.txt to continue development. ElevenLabs must be reconnected on this device.'
if (-not $NoLaunch) {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Start-Process -FilePath $appExecutable -WorkingDirectory $appDirectory -WindowStyle Normal | Out-Null
}
