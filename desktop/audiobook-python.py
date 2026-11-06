import argparse
import json
import os
import sys
import time
import traceback

output = sys.stdout.buffer
sys.stdout = sys.stderr
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def reply(identity, audio=None, rate=24000, **metadata):
    data = b'' if audio is None else audio.astype('<f4', copy=False).tobytes()
    header = {'id': identity, 'bytes': len(data), 'sampleRate': rate, **metadata}
    output.write(('CADENCE1 ' + json.dumps(header) + '\n').encode())
    if data:
        output.write(data)
    output.flush()


parser = argparse.ArgumentParser()
parser.add_argument('--engine', choices=['kokoro', 'kokoro-cpu', 'qwen'], required=True)
parser.add_argument('--model', required=True)
options = parser.parse_args()
try:
    import numpy as np
    torch = None
    if options.engine != 'kokoro-cpu':
        import torch
        torch.set_num_threads(2)
        if not torch.cuda.is_available():
            raise RuntimeError('NVIDIA CUDA is not available in the local export runtime.')
    began = time.perf_counter()
    if options.engine.startswith('kokoro'):
        import onnxruntime as ort
        if torch is not None:
            ort.preload_dlls()
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = 4 if options.engine == 'kokoro-cpu' else 2
        session_options.inter_op_num_threads = 1
        session_options.enable_mem_pattern = False
        providers = ['CPUExecutionProvider'] if options.engine == 'kokoro-cpu' else [('CUDAExecutionProvider', {'device_id': 0, 'cudnn_conv_algo_search': 'HEURISTIC', 'use_tf32': 0, 'gpu_mem_limit': 5 * 1024**3})]
        network = ort.InferenceSession(options.model, sess_options=session_options, providers=providers)
        if options.engine != 'kokoro-cpu' and network.get_providers()[0] != 'CUDAExecutionProvider':
            raise RuntimeError('The GPU export runtime could not activate CUDA.')
        provider = network.get_providers()
    else:
        from qwen_tts import Qwen3TTSModel
        network = Qwen3TTSModel.from_pretrained(options.model, device_map='cuda:0', dtype=torch.float32, attn_implementation='sdpa', local_files_only=True)
        torch.manual_seed(0)
        provider = ['cuda:0', 'float32', 'sdpa']
    reply(0, ready=True, provider=provider, device=torch.cuda.get_device_name(0) if torch is not None else 'CPU', loadMs=(time.perf_counter() - began) * 1000)
    for line in sys.stdin:
        request = json.loads(line)
        identity = request['id']
        try:
            if request.get('action') == 'shutdown':
                reply(identity, closed=True)
                break
            began = time.perf_counter()
            if options.engine.startswith('kokoro'):
                ids = request['input_ids']
                if not 2 <= len(ids) <= 512 or len(request['style']) != 256:
                    raise ValueError('Invalid Kokoro export input.')
                audio = network.run(None, {'input_ids': np.asarray([ids], dtype=np.int64), 'style': np.asarray([request['style']], dtype=np.float32), 'speed': np.asarray([1.0], dtype=np.float32)})[0].reshape(-1)
                rate = 24000
            else:
                text = request['text']
                if not isinstance(text, str) or not 0 < len(text) <= 1800 or request['voice'] not in ['aiden', 'ryan']:
                    raise ValueError('Invalid Qwen export input.')
                with torch.inference_mode():
                    waves, rate = network.generate_custom_voice(text=text, language='English', speaker=request['voice'], non_streaming_mode=True, max_new_tokens=2048)
                audio = np.asarray(waves[0], dtype=np.float32).reshape(-1)
            if audio.size == 0 or audio.size > rate * 300 or not np.isfinite(audio).all():
                raise RuntimeError('The export model produced invalid audio.')
            reply(identity, audio, rate, generateMs=(time.perf_counter() - began) * 1000)
        except Exception as error:
            traceback.print_exc()
            reply(identity, error=str(error), detail=traceback.format_exc()[-3000:])
    del network
    if torch is not None:
        torch.cuda.empty_cache()
except Exception as error:
    reply(0, error=str(error))
    raise
