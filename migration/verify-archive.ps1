param([Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).ProviderPath)
try {
    $manifestEntry = $zip.GetEntry('MIGRATION_BUNDLE.json')
    if (-not $manifestEntry) { throw 'Migration manifest is missing from the ZIP.' }
    $reader = New-Object IO.StreamReader($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.format -ne 'cadence-project-migration') { throw 'Unsupported archive.' }
    $count = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') }).Count
    if ($count -ne @($manifest.files).Count + 1) { throw 'Unexpected or missing archive files.' }
    foreach ($record in $manifest.files) {
        $entry = $zip.GetEntry($record.path)
        if (-not $entry -or $entry.Length -ne $record.size) { throw "Archive file is missing or incomplete: $($record.path)" }
        $stream = $entry.Open()
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $hash.Dispose(); $stream.Dispose() }
        if ($actual -ne $record.sha256) { throw "Archive checksum mismatch: $($record.path)" }
    }
    Write-Output "Verified every ZIP entry: $count files; Cadence $($manifest.appVersion); $($manifest.documents) saved documents."
} finally { $zip.Dispose() }
