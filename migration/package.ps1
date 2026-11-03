param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stage = (Resolve-Path -LiteralPath $Directory).ProviderPath
$allowed = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release\migration')).TrimEnd('\') + '\'
if (-not $stage.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only migration staging directories inside this workspace are packaged.' }
$zip = $stage + '-Windows-x64.zip'
if (Test-Path -LiteralPath $zip) { throw 'Archive already exists. It has been preserved.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zipFile = [IO.File]::Open($zip, [IO.FileMode]::CreateNew)
$archive = New-Object IO.Compression.ZipArchive($zipFile, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -Force -File) {
        $entryName = $file.FullName.Substring($stage.TrimEnd('\').Length + 1).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose(); $zipFile.Dispose() }
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
($hash + '  ' + [IO.Path]::GetFileName($zip)) | Set-Content -LiteralPath ($zip + '.sha256') -Encoding ASCII
Write-Output "Migration ZIP: $zip"
Write-Output "SHA256: $hash"
