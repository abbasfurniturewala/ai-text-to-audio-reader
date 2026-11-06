$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$trialRoot = Join-Path $taskRoot '.cache\chatterbox-trial'
$runtimeRoot = Join-Path $taskRoot '.cache\audiobook'
$env:UV_CACHE_DIR = Join-Path $runtimeRoot 'uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeRoot 'python'
$env:UV_SYSTEM_CERTS = 'true'
$env:HF_HOME = Join-Path $trialRoot 'hf-cache'
$env:HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
$uv = Join-Path $runtimeRoot 'uv-0.13.7\uv.exe'
$trialEnvironment = Join-Path $trialRoot 'environment'
if (-not (Test-Path -LiteralPath (Join-Path $trialEnvironment 'Scripts\python.exe'))) { & $uv venv --python 3.12.16 $trialEnvironment; if($LASTEXITCODE -ne 0) { throw 'Trial environment failed.' } }
$python = Join-Path $trialEnvironment 'Scripts\python.exe'
& $uv pip install --python $python 'torch==2.7.1' 'torchaudio==2.7.1' --index-url 'https://download.pytorch.org/whl/cu128'
if($LASTEXITCODE -ne 0) { throw 'Trial CUDA runtime failed.' }
& $uv pip install --python $python 'onnxruntime-gpu==1.23.2' 'numpy==2.2.6' 'transformers==4.57.3' 'huggingface-hub==0.36.2' 'soundfile==0.14.0'
if($LASTEXITCODE -ne 0) { throw 'Trial speech dependencies failed.' }
& $uv pip freeze --python $python | Set-Content -LiteralPath (Join-Path $trialRoot 'requirements-resolved.txt') -Encoding utf8
& $python (Join-Path $PSScriptRoot 'setup-chatterbox-model.py') $trialRoot
if($LASTEXITCODE -ne 0) { throw 'Chatterbox trial model verification failed.' }
