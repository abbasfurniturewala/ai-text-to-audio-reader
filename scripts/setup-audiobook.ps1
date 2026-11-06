param([switch]$SkipModels)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimeRoot = Join-Path $taskRoot '.cache\audiobook'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$env:UV_CACHE_DIR = Join-Path $runtimeRoot 'uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeRoot 'python'
$env:UV_PYTHON_BIN_DIR = Join-Path $runtimeRoot 'python-bin'
$env:UV_SYSTEM_CERTS = 'true'
$env:HF_HOME = Join-Path $runtimeRoot 'hf-cache'
$env:HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
$uvVersion = '0.13.7'
$uvDigest = '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021'
function Download-Verified([string]$Uri, [string]$Destination, [string]$Digest) {
    if (-not (Test-Path -LiteralPath $Destination)) { Invoke-WebRequest -Uri $Uri -OutFile ($Destination + '.partial'); Move-Item -LiteralPath ($Destination + '.partial') -Destination $Destination }
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ne $Digest) { throw "Download hash mismatch: $Destination" }
}
$uvZip = Join-Path $runtimeRoot "uv-$uvVersion.zip"
Download-Verified "https://github.com/astral-sh/uv/releases/download/$uvVersion/uv-x86_64-pc-windows-msvc.zip" $uvZip $uvDigest
$uvDirectory = Join-Path $runtimeRoot "uv-$uvVersion"
if (-not (Test-Path -LiteralPath (Join-Path $uvDirectory 'uv.exe'))) { Expand-Archive -LiteralPath $uvZip -DestinationPath $uvDirectory }
$uv = Join-Path $uvDirectory 'uv.exe'
& $uv python install 3.12.16 --no-registry
if ($LASTEXITCODE -ne 0) { throw 'Portable Python setup failed.' }
foreach ($environmentName in @('ort')) {
    $environmentPath = Join-Path $runtimeRoot $environmentName
    if (-not (Test-Path -LiteralPath (Join-Path $environmentPath 'Scripts\python.exe'))) {
        & $uv venv --python 3.12.16 $environmentPath
        if ($LASTEXITCODE -ne 0) { throw "Environment setup failed: $environmentName" }
    }
    $python = Join-Path $environmentPath 'Scripts\python.exe'
    & $uv pip install --python $python 'torch==2.7.1' 'torchaudio==2.7.1' --index-url 'https://download.pytorch.org/whl/cu128'
    if ($LASTEXITCODE -ne 0) { throw "CUDA PyTorch setup failed: $environmentName" }
    & $uv pip install --python $python --requirement (Join-Path $PSScriptRoot "audiobook-$environmentName-requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Speech package setup failed: $environmentName" }
    & $uv pip freeze --python $python | Set-Content -LiteralPath (Join-Path $runtimeRoot "$environmentName-resolved.txt") -Encoding utf8
}
$ffZip = Join-Path $runtimeRoot 'ffmpeg-9.0.zip'
$ffDigest = '3ef1842c32bb9a6fb72d4edc5df8c9ecde66ebf84b6f1f35c0e5ac8e4a68b5f1'
Download-Verified 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-9.0.zip' $ffZip $ffDigest
$ffDirectory = Join-Path $runtimeRoot 'ffmpeg'
if (-not (Test-Path -LiteralPath $ffDirectory)) { Expand-Archive -LiteralPath $ffZip -DestinationPath $ffDirectory }
$ffmpeg = (Get-ChildItem -LiteralPath $ffDirectory -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1).FullName
$ffprobe = (Get-ChildItem -LiteralPath $ffDirectory -Filter ffprobe.exe -File -Recurse | Select-Object -First 1).FullName
if (-not $ffmpeg -or -not $ffprobe) { throw 'The verified FFmpeg archive is incomplete.' }
$configuration = [ordered]@{ version = 1; ortPython = 'ort\Scripts\python.exe'; ffmpeg = $ffmpeg.Substring($runtimeRoot.Length + 1); ffprobe = $ffprobe.Substring($runtimeRoot.Length + 1); uvVersion = $uvVersion; uvSha256 = $uvDigest; ffmpegSha256 = $ffDigest }
$configuration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'runtime.json') -Encoding utf8
Write-Output "Local audiobook tools prepared at $runtimeRoot"
