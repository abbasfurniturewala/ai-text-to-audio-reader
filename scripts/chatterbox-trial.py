import gc
import json
import os
import sys
import time
from pathlib import Path
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import numpy as np
import soundfile as sf
import torch
import onnxruntime as ort
from transformers import AutoTokenizer

root = Path(sys.argv[1]).resolve()
model = root / 'model'
rate = 24000
text = 'The first light reached the window before the town began to stir. Across the square, a shopkeeper opened the shutters and placed a small wooden chair beside the door.'
reference, reference_rate = sf.read(Path(sys.argv[2]).resolve(), dtype='float32')
if reference_rate != rate or reference.ndim != 1:
    raise RuntimeError('Use the local mono 24kHz synthetic voice reference.')
reference = reference[:rate * 8]
sf.write(root / 'synthetic-heart-reference.wav', reference, rate)
if not torch.cuda.is_available():
    raise RuntimeError('The trial needs the approved NVIDIA GPU runtime.')
torch.set_num_threads(2)
ort.preload_dlls()
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
options.enable_mem_pattern = False
provider = [('CUDAExecutionProvider', {'device_id': 0, 'use_tf32': 0, 'cudnn_conv_algo_search': 'DEFAULT', 'cudnn_conv1d_pad_to_nc1d': 1, 'arena_extend_strategy': 'kSameAsRequested', 'gpu_mem_limit': 5 * 1024**3})]
def session(name, gpu=True):
    result = ort.InferenceSession(str(model / 'onnx' / (name + '.onnx')), sess_options=options, providers=provider if gpu else ['CPUExecutionProvider'])
    result.disable_fallback()
    if gpu and result.get_providers()[0] != 'CUDAExecutionProvider':
        raise RuntimeError('CUDA did not activate for ' + name)
    print(json.dumps({'session': name, 'provider': result.get_providers()}), flush=True)
    return result

began = time.perf_counter()
encoder = session('speech_encoder')
cond, prompt, speaker, features = encoder.run(None, {'audio_values': reference[np.newaxis, :].astype(np.float32)})
del encoder
gc.collect()
embedding = session('embed_tokens', gpu=False)
language = session('language_model')
tokenizer = AutoTokenizer.from_pretrained(str(model), local_files_only=True)
input_ids = tokenizer(text, return_tensors='np')['input_ids'].astype(np.int64)
loaded = time.perf_counter()
generated = np.array([[6561]], dtype=np.int64)
cache = None
for step in range(1024):
    inputs = embedding.run(None, {'input_ids': input_ids})[0]
    if step == 0:
        inputs = np.concatenate((cond, inputs), axis=1)
        batch, length, _ = inputs.shape
        cache = {item.name: np.zeros([batch, 16, 0, 64], dtype=np.float16 if item.type == 'tensor(float16)' else np.float32) for item in language.get_inputs() if 'past_key_values' in item.name}
        mask = np.ones((batch, length), dtype=np.int64)
        positions = np.arange(length, dtype=np.int64).reshape(1, -1).repeat(batch, axis=0)
    logits, *present = language.run(None, {'inputs_embeds': inputs, 'attention_mask': mask, 'position_ids': positions, **cache})
    scores = logits[:, -1, :].copy()
    previous = np.take_along_axis(scores, generated, axis=1)
    np.put_along_axis(scores, generated, np.where(previous < 0, previous * 1.2, previous / 1.2), axis=1)
    input_ids = np.argmax(scores, axis=-1, keepdims=True).astype(np.int64)
    generated = np.concatenate((generated, input_ids), axis=-1)
    if (input_ids.flatten() == 6562).all():
        break
    mask = np.concatenate((mask, np.ones((batch, 1), dtype=np.int64)), axis=1)
    positions = positions[:, -1:] + 1
    cache = dict(zip(cache, present))
    if step % 50 == 0:
        print(json.dumps({'tokens': step + 1, 'elapsedSeconds': time.perf_counter() - loaded}), flush=True)
else:
    raise RuntimeError('The model did not reach its speech end token; the trial was not saved as complete.')
token_time = time.perf_counter()
del language, embedding, cache, present
gc.collect()
decoder = session('conditional_decoder')
decoder_loaded = time.perf_counter()
speech = np.concatenate([prompt, generated[:, 1:-1], np.full((1, 3), 4299, dtype=np.int64)], axis=1)
np.savez(root / 'decoder-inputs.npz', speech_tokens=speech, speaker_embeddings=speaker, speaker_features=features)
wave = decoder.run(None, {'speech_tokens': speech, 'speaker_embeddings': speaker, 'speaker_features': features})[0].reshape(-1)
finished = time.perf_counter()
if not wave.size or not np.isfinite(wave).all():
    raise RuntimeError('The trial returned invalid audio.')
rms = float(np.sqrt(np.mean(wave**2)))
if rms < .001:
    raise RuntimeError('The trial returned silent audio.')
sf.write(root / 'chatterbox-turbo-fp32.wav', wave, rate)
report = {'model': 'ResembleAI/chatterbox-turbo-ONNX', 'revision': 'd21799bd0354adb85e348b8a0442a8405110a2cf', 'device': torch.cuda.get_device_name(0), 'precision': 'fp32', 'text': text, 'reference': 'Eight seconds of locally generated Kokoro Heart, not a real person.', 'tokens': int(generated.shape[1] - 2), 'audioSeconds': len(wave) / rate, 'conditioningAndModelLoadSeconds': loaded - began, 'generationSeconds': token_time - loaded + finished - decoder_loaded, 'decoderLoadSeconds': decoder_loaded - token_time, 'totalSeconds': finished - began, 'rms': rms, 'watermark': 'Official ONNX example default; no existing watermark removed.'}
report['execution'] = {'speechEncoder': 'CUDA', 'languageModel': 'CUDA', 'decoder': decoder.get_providers()[0], 'tokenEmbedding': 'CPU lookup', 'automaticCpuRetry': False, 'cudaOptions': provider[0][1]}
report['watermark'] = 'Not tested; published ONNX graphs without an added postprocessing watermark.'
(root / 'trial-result.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2), flush=True)
