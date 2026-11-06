import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
from huggingface_hub import snapshot_download
root = Path(sys.argv[1]).resolve()
revision = 'd21799bd0354adb85e348b8a0442a8405110a2cf'
manifest = root / 'remote-manifest.json'
root.mkdir(parents=True, exist_ok=True)
if not manifest.exists():
    url = 'https://huggingface.co/api/models/ResembleAI/chatterbox-turbo-ONNX/revision/' + revision + '?blobs=true'
    with urllib.request.urlopen(url, timeout=60) as response:
        manifest.write_bytes(response.read())
info = json.loads(manifest.read_text(encoding='utf-8-sig'))
if info['sha'] != revision:
    raise RuntimeError('The trial model revision changed.')
files = [entry for entry in info['siblings'] if not any(marker in entry['rfilename'] for marker in ['_fp16', '_quantized', '_q4', '_q8']) and entry['rfilename'] != '.gitattributes']
destination = root / 'model'
snapshot_download('ResembleAI/chatterbox-turbo-ONNX', revision=revision, local_dir=destination, allow_patterns=[entry['rfilename'] for entry in files], token=False)
verified = []
for entry in files:
    filename = destination / entry['rfilename']
    with filename.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if entry.get('lfs') and digest != entry['lfs']['sha256']:
        raise RuntimeError('Model hash mismatch: ' + entry['rfilename'])
    if filename.stat().st_size != entry['size']:
        raise RuntimeError('Model size mismatch: ' + entry['rfilename'])
    verified.append({'path': entry['rfilename'], 'size': entry['size'], 'sha256': digest})
(root / 'verified-model.json').write_text(json.dumps({'repo': 'ResembleAI/chatterbox-turbo-ONNX', 'revision': revision, 'files': verified}, indent=2))
print(json.dumps({'revision': revision, 'bytes': sum(entry['size'] for entry in files)}), flush=True)
