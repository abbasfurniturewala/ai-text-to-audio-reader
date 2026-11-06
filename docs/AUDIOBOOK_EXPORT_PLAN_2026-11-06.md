# Local GPU audiobook export — assessment and proposed implementation

The user requested much faster whole-PDF/EPUB audiobook export and a Qwen model comparison. They selected **local/offline models only** and **one chaptered M4B audiobook**. On 6 November they explicitly approved the offline GPU/M4B upgrade, including portable Python/CUDA/FFmpeg tools, model downloads and the ~15GB setup allowance. Implementation and verification are in progress; the installed app remains unchanged pending final desktop-replacement confirmation.

## Measured current export

`scripts/export-benchmark.mjs` runs the installed package with isolated profiles, real fp32 Kokoro speech and an original 198-word / 1,232-character fixture. It captures the actual export IPC generation timings and verifies the saved WAV. No test accesses the live library.

| Voice / cache condition | Generated audio | Create time | Model generation | Save time | Throughput | Projected minutes per audio hour |
|---|---:|---:|---:|---:|---:|---:|
| Heart, normal reader preload | 77.18s | 18.52s | 17.80s | 0.134s | 4.17x | 14.40 |
| Fenrir, normal reader preload | 76.94s | 18.68s | 18.09s | 0.129s | 4.12x | 14.56 |
| Heart, uncached export | 77.18s | 24.15s | 23.49s | 0.146s | 3.20x | 18.77 |
| Fenrir, uncached export | 76.94s | 24.79s | 23.48s | 0.127s | 3.10x | 19.33 |

The uncached runs disable only the reader's background preload in the isolated test handler; actual export requests and model inference remain real. Each uncached run synthesizes all 15 speech units. Normal-reader runs synthesize 12 because the first three are already cached. Speech generation accounts for about **95–97%** of uncached creation time. The residual includes communication, conversion, final WAV assembly, UI automation and scheduling; it is not a separate codec microbenchmark.

For the same workload, a ten-hour audiobook would extrapolate to about 3h08–3h13 of CPU creation time. These are short-sample projections under this machine's current workload, not a completed long-book benchmark or guaranteed timings.

Reports and WAVs: `test-results/export-benchmark/{installed,uncached}-{heart,fenrir}.{json,wav}`. The initial `installed-cpu.wav` was produced before the probe separated prewarm cancellation records; it is not a valid timing report.

## Existing structural limits

- `src/App.tsx` calls `documentSpeechPlan` for the entire range, requests clips serially through the playback synthesis API, then keeps every Int16 clip until the whole export finishes.
- It throws after **two hours of generated audio**, after already spending the time to synthesize that audio. The job has no durable partial result or restart checkpoint.
- The worker sends both a WAV and Float32 PCM for each clip; the renderer also creates/copies Web Audio buffers, converts to Int16, assembles a final WAV/Blob, and sends the whole file through IPC when saving.
- The current save handler accepts at most 1 GiB. Standard RIFF/WAV fields also cannot describe arbitrarily large books. At the current mono 24kHz/16-bit format, raw PCM is 172.8 MB per hour; a 60-hour book would be about 10.37 GB before compression.

Changing UI progress or the file extension cannot yield a large synthesis speedup. Disk streaming fixes length/memory/recovery; GPU inference is the candidate for throughput.

## This PC and runtime feasibility

Read-only inspection on 6 November 2026: **RTX 2070 SUPER, 8,192 MiB VRAM, compute capability 7.5, driver 610.88; 16 logical CPU processors; about 96 GB free on C:**. Python on PATH is only the Windows Store alias; no usable Python/uv/conda/FFmpeg was found by the targeted checks.

The installed `onnxruntime-node` 1.21.0 exposes CPU and DirectML. The earlier real fp32 DirectML experiment failed on first synthesis at ConvTranspose with `80070057`; no GPU speedup was measured. The [official Node provider table](https://onnxruntime.ai/docs/get-started/with-javascript/node.html) does not provide Windows CUDA in its prebuilt Node package. A separate local CUDA helper avoids replacing the reader's existing working runtime. [ONNX Runtime's CUDA guide](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html) documents the Python GPU package and CUDA/cuDNN DLL loading.

For the first alternate model, use **Qwen3-TTS-12Hz-0.6B-CustomVoice**, with an English preset such as Aiden or Ryan. Its [official repository files](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice/tree/main) total about **2.5 GB**, including the speech tokenizer. The [1.7B variant](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/tree/main) totals about **4.52 GB** and should wait until the smaller model's actual VRAM use and throughput are known. File size does not establish peak VRAM requirements.

The [Qwen implementation](https://github.com/QwenLM/Qwen3-TTS) supports local generation and batches. Its common BF16/FlashAttention-2 example is unsuitable as-is for this Turing GPU: [FlashAttention's supported-hardware documentation](https://github.com/Dao-AILab/flash-attention#nvidia-cuda-support) restricts its standard CUDA path to newer GPU families and notes BF16 requirements. Start with FP16 plus a compatible PyTorch attention fallback; validate it rather than building unverified attention kernels. Keep the existing Kokoro fp32 weights intact. Qwen is an additional voice/quality option, not an assumed speed improvement over GPU Kokoro. Published first-packet latency is not audiobook throughput on this PC.

## Approved implementation plan

1. **GPU feasibility gate:** Add isolated portable runtimes below the already-ignored workspace `.cache/` directory. Test the existing fp32 Kokoro ONNX model through CUDA, and Qwen 0.6B through its supported local Python implementation. Use separate environments if required to avoid the Qwen CPU `onnxruntime` dependency conflicting with `onnxruntime-gpu`. Pin the resolved package versions/model revisions and verify downloads. No global Python, driver replacement, cloud service or API key is needed. Reserve roughly **15 GB disk** for runtime/model installation and caches; this is a planning allowance, not a measured download total.
2. **Durable export job:** Move bulk export into a dedicated local process/worker and write completed audio incrementally to a user-chosen job/output folder. Use a bounded working queue and a small atomic checkpoint, retaining completed work across Pause, cancellation, helper errors and app restart. Validate source/voice/model/settings before resuming. Existing book records, source indices and reader checkpoints stay intact.
3. **Chaptered M4B:** Reuse imported EPUB/PDF hierarchy for chapter boundaries and the shared cleaned speech plan for spoken text. Encode/mux locally with a pinned FFmpeg build, preserving chapter names/order. Do not hold the whole audiobook in renderer RAM or retain the two-hour M4B cap. Keep existing WAV functionality available. Intermediate audio can consume substantial local disk space; report that before starting and clean only job-owned temporary files after successful finalization.
4. **Export model choice and comparison:** Offer tested GPU Kokoro, CPU fallback and optional Qwen 0.6B. Compare the same short passage before a whole-book job, showing actual generation time/audio duration and offering both samples for listening. Load one export GPU model at a time. Keep everyday reader narration on its current backend and preserve natural complete-sentence boundaries, pauses and PDF cleanup.
5. **Validation and delivery:** Verify multi-hour output structure, chapter metadata, bounded memory, cancel/resume/restart, partial-file safety, disk-full/helper failures, offline operation and native model shutdown. Measure matched uncached throughput/VRAM/quality before claiming a speedup. Run reader regressions and UI responsiveness checks during export. Build/stage the app, then obtain the separate confirmation required before replacing the installed desktop build.

Acceptance is a valid complete chaptered M4B that can resume without repeating or losing text, plus honest measured GPU/model comparisons. No specific GPU multiplier or Qwen quality win is promised before those tests.

## Approval boundary

[AGENTS.md](../AGENTS.md) says: “Ask before adding dependencies, changing architecture, changing stored-data schemas/migrations”. The portable CUDA/Python/model/FFmpeg setup and durable export-job design cross that boundary. The user explicitly approved these components and the export-engine changes on 6 November. The assessment above records the pre-implementation baseline. Final desktop replacement remains a separate confirmation after the staged artifact passes validation.
