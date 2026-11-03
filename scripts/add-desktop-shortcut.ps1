$ErrorActionPreference = 'Stop'

$taskRoot = Split-Path -Parent $PSScriptRoot
$appDirectory = Join-Path $taskRoot 'release\win-unpacked'
$appExecutable = Join-Path $appDirectory 'Cadence.exe'
if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
    throw 'Build Cadence first. The Windows executable is missing.'
}

$desktopDirectory = [Environment]::GetFolderPath('DesktopDirectory')
if (-not $desktopDirectory -or -not (Test-Path -LiteralPath $desktopDirectory -PathType Container)) {
    throw 'The Windows desktop folder could not be located.'
}

$shortcutPath = Join-Path $desktopDirectory 'Cadence Reader.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existingShortcut = $shortcutShell.CreateShortcut($shortcutPath)
    if ($existingShortcut.TargetPath -ne $appExecutable) {
        throw 'A shortcut named Cadence Reader already points to another application. It has been preserved.'
    }
}

$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $appExecutable
$shortcut.WorkingDirectory = $appDirectory
$shortcut.IconLocation = "$appExecutable,0"
$shortcut.Description = 'Cadence — PDF and document reader with natural offline voices'
$shortcut.Save()

$verifiedShortcut = $shortcutShell.CreateShortcut($shortcutPath)
if ($verifiedShortcut.TargetPath -ne $appExecutable) { throw 'The desktop shortcut could not be verified.' }

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$appProcess = Start-Process -FilePath $appExecutable -WorkingDirectory $appDirectory -WindowStyle Normal -PassThru
Start-Sleep -Seconds 2
if ($appProcess.HasExited) { throw 'Cadence closed during startup. The shortcut was created, but the app needs to be checked.' }

Write-Output "Desktop shortcut created: $shortcutPath"
Write-Output "Cadence is running (process $($appProcess.Id))."
