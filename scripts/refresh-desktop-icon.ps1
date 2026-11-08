param([Parameter(Mandatory = $true)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$backupPath = (Resolve-Path -LiteralPath $BackupDirectory).ProviderPath
$releasePrefix = (Join-Path $taskRoot 'release').TrimEnd('\') + '\'
if (-not $backupPath.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase) -or ((Get-Item -LiteralPath $backupPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Shortcut backup must be in the retained build inside this workspace.' }
$target = Join-Path $taskRoot 'release\win-unpacked\Cadence.exe'
$icon = Join-Path $taskRoot 'build\icon.ico'
if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or -not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw 'The installed application or icon is missing.' }
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Cadence Reader.lnk'
if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { Write-Output 'No existing Cadence Reader desktop shortcut to refresh.'; return }
if ((Get-Item -LiteralPath $shortcut).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The desktop shortcut is redirected; it has been left unchanged.' }
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
if ($link.TargetPath -ne $target) { throw 'The desktop shortcut points to a different application; it has been left unchanged.' }
$arguments = $link.Arguments; $workingDirectory = $link.WorkingDirectory
$backup = Join-Path $backupPath 'Cadence Reader shortcut.lnk'
if (Test-Path -LiteralPath $backup) { throw 'A shortcut backup already exists.' }
Copy-Item -LiteralPath $shortcut -Destination $backup
try {
  $link.IconLocation = "$icon,0"
  $link.Save()
  $verified = $shell.CreateShortcut($shortcut)
  if ($verified.TargetPath -ne $target -or $verified.Arguments -ne $arguments -or $verified.WorkingDirectory -ne $workingDirectory -or $verified.IconLocation -ne "$icon,0") { throw 'Shortcut verification failed.' }
} catch { Copy-Item -LiteralPath $backup -Destination $shortcut -Force; throw }
Write-Output "Refreshed only the Cadence desktop shortcut icon. Original retained at: $backup"
