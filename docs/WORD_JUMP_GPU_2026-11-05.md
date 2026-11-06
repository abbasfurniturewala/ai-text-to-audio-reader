# Word-jump latency and GPU assessment — 5 November 2026

The user wants smooth scrolling while narration is active and after clicking a word on a distant page, with similar or better click-to-audio time. They asked which of the three proposed approaches best fits that goal and whether GPU inference would help or add complexity. This is an assessment; no production behavior was changed.

## Current word-click path

`usePlayer.playFrom` stops the previous narrator, constructs a speech plan from the clicked source word and creates a new audio session. The loaded model remains available. A new phrase's speech request has interactive priority; queued obsolete requests are cancelled. However, native inference already running in the worker cannot necessarily be interrupted before its current call returns. New speech can therefore wait behind the remainder of one previous generation.

The speech cache matches voice and exact requested text. A mid-sentence word click generally requests a different suffix from the prepared full sentence. More preparation along the current route does not automatically cache arbitrary word starts on distant pages.

## Measured baseline

Used the installed build with the existing isolated The Prince EPUB profile under `test-results/startup-lag/profile`, Fenrir at 1× and muted test-window output. Started narration, browsed to section 30 without moving the audio position, clicked a middle word and then clicked that same word again.

| Scenario | Click to first source scheduling | Approximate scheduled audio-clock start |
|---|---:|---:|
| New word suffix at another section, previous generation in flight | 7,237ms | 7,297ms |
| Repeated same word, exact audio already cached | 60ms | 120ms |

For the uncached jump, the new interactive IPC request began about 86ms after the click. A previous 105-character background request completed about 1.286s after the click, leaving approximately 1.2s of queue wait after the new request. Generating the new 293-character suffix took 5.930s; the first source was scheduled at 7.237s. No renderer errors occurred.

These are one-case baseline timings, not averages, guaranteed user timings or measured improvement from a new optimization. Scheduling is not a physical speaker-onset measurement; the test output was muted and the DSP/device can add latency. This was an EPUB section jump, not a measured original-PDF caret hit test.

## Assessment of the three options

1. **Incremental/reused planning and rendering is the best first fit.** Preserve interactive voice-generation priority and existing complete-sentence/exact-word behavior, while reducing synchronous setup on every new word start and first page rendering. This can keep click latency similar or improve its setup portion and reduce UI stalls. It does not remove native generation time or automatically preempt a running job. The measured pre-request setup was only ~86ms in this example; there is no evidence to promise a multi-second saving from that component alone. A new implementation still needs A/B tests.
2. **Blanket CPU throttling risks slower jumps.** Reducing all inference resources can extend both the old in-flight request and the new clicked passage. Any later adaptive policy should distinguish surplus background work from the clicked passage and verify sustained reserve/speed headroom. No quantitative improvement or regression has been benchmarked for a changed thread count.
3. **More advance preparation is a poor match for arbitrary jumps.** It can help the expected reading route, but an unprepared page/new suffix is still a cache miss. More preparation consumes work/memory and can leave an obsolete inference in flight. Caching every word-start variant would conflict with the current small bounded-cache design.

## GPU feasibility and actual result

Read-only hardware inspection found an **NVIDIA GeForce RTX 2070 SUPER**, driver `32.0.16.1088`. The locked `onnxruntime-node` is **1.21.0** and reports bundled `cpu` and `dml` backends. The installed Transformers.js maps DirectML to Windows GPU inference. UI GPU compositing was already enabled in the earlier application tests; moving voice inference to GPU is a separate change.

Ran a standalone CPU/DirectML comparison using the existing offline fp32 model, the actual token guard and `generateVoice` normalization/pacing, Fenrir, and no model/dependency/driver downloads or replacement. CPU generated eight valid clips from four texts over two cycles. Model-session loading took about 1.18s and inference ranged from 0.56s to 3.14s for these short samples. These are direct inference measurements, not application word-click timings; repeated calls here rerun inference rather than use the renderer's audio cache.

DirectML loaded the model in about 2.21s but **failed on the first generation** at `/encoder/F0.1/pool/ConvTranspose`, returning `80070057` (invalid parameter). No valid GPU speech clip or GPU speedup was measured. The required sequential execution and disabled memory-pattern options were already supplied.

This proves the straightforward GPU switch is not currently safe with this model/runtime/driver combination. It does not establish that all GPU approaches are impossible or identify which component causes the error. GPU inference requires separate compatibility investigation, cold/varying-text timing, memory/driver checks, output validation and reliable CPU fallback before use in the reader. It also leaves CPU-side planning/layout work to address.

The [official DirectML guide](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) documents required options and shape-dependent initialization/performance; the [Node backend table](https://onnxruntime.ai/docs/get-started/with-javascript/node.html) documents DirectML Windows support. Backend availability alone does not establish model compatibility.

## Rough option-1 forecast requested before implementation

These are same-case planning estimates/engineering targets, not after-change measurements or guarantees. Baselines come from separate The Prince / Fenrir / 1× tests; they should not all be added together. Speech timings refer to first source scheduling, not physical speaker onset.

| Action or step | Current measured example | Rough option-1 expectation/target |
|---|---|---|
| Launch and restore the saved reader | 5.16s | Around 5s; little change expected |
| Press Play to first scheduled clip in the fresh-process test | 3.62s | Around 3–4s for the same case; mostly unchanged synthesis/preparation |
| Clicked-word setup before the interactive speech request | 86ms | Engineering target 20–60ms; low confidence until implementation/profile |
| Generate the new clicked speech unit in the jump example | 5.93s | Around 6s; unchanged model/inference policy |
| Complete uncached mid-playback jump, including old-job wait | 7.24s | Around 7.2s; no major speedup expected from setup optimization alone |
| Repeat the same word with exact audio cached | 60ms | Roughly 50–100ms; preserve near-immediate scheduling |
| Individual early tasks blocking the UI | 62–120ms | Aim for ~10–20ms pieces for work confirmed to be splittable planning/rendering; other stalls may remain |
| Entire initial lag window | User reports 2–3min; isolated test spikes subsided within ~1min | No defensible duration estimate yet; goal is responsive interaction from the start |

In the busy-jump example, about 1.29s of the old generation remained after the click. Most of the 86ms setup occurred concurrently with that wait. Reducing setup can therefore improve responsiveness without advancing the eventual synthesis start in this case. The substantial benefit sought is smoother UI while preserving existing jump/start times, not a promised large reduction in new-text inference time. The 20–60ms and 10–20ms ranges are engineering budgets, not measurements, confirmed bottleneck savings or accepted implementation guarantees.

## State and evidence

Installed app/model, source behavior, locks, configuration and user library are unchanged. Evidence is under ignored `test-results/gpu-assessment/`: `bench.mjs`, `cpu.json`, `dml.json`, `jump.mjs`, `jump.json`. No new dependency, quantization, architecture change, install, restore, commit or push. Existing fp32 quality and bounded caches remain intact. No full unit/build rerun was needed for diagnostic/docs-only work.
