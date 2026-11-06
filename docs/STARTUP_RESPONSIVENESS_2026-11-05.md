# Early-playback lag assessment — 5 November 2026

The user reports severe scrolling/navigation lag during the first two to three minutes of narration, followed by smooth navigation. They are unsure whether a brief pause/resume recreates the condition. This is an assessment, not a new application update.

## What was tested

Used the original `Downloads/pg1232-images-3.epub` (The Prince), Fenrir at 1×, Reading view section 18 and an audio start near passage 121. An isolated library was seeded under `test-results/startup-lag/profile`, then its process was closed normally and a fresh installed Cadence process was launched. The probe used real offline synthesis and continuous forward/reverse wheel input for about four minutes. Output was muted through that test window; the normal user library/process was not controlled.

The test is process-cold, not OS-cache-cold: the seed run had already accessed the model/book files. It does not reproduce every condition of the live profile or physical audio-output driver.

## Observations

| Time after Play | Long main-thread tasks over 50ms | Largest frame interval | Voice/main-process average CPU use* |
|---|---:|---:|---:|
| 0–30s | 3 | 125ms | 4.59 |
| 30–60s | 1 | 56ms | 2.46 |
| 60–90s | 0 | 42ms | 4.90 |
| 90–120s | 0 | 14ms | 1.42 |
| 120–150s | 0 | 28ms | 3.23 |
| 150–180s | 0 | 28ms | 3.14 |
| 180–210s | 0 | 42ms | 3.05 |
| 210–240s | 0 | 28ms | 3.07 |

*CPU units are aggregate logical-processor equivalents: 1.0 means one logical processor busy throughout the interval, not 100% of this 16-logical-processor computer. The main process contains the native voice worker as well as browser work; this is not a direct measurement of inference alone.

- Four long tasks occurred at approximately 0.07s (120ms), 5.56s (62ms), 29.30s (81ms) and 31.71s (69ms). There were no further >50ms main-thread tasks in the remaining measured interval. Typical frame intervals remained about 14ms.
- Reader restoration took about 5.2s from launch; the first audio clip was scheduled about 3.6s after Play. Eighteen synthesis requests were recorded, including an in-flight request at measurement end. No renderer errors were observed.
- Main/voice-process working set fell from about 1,466 MiB at the first sample to about 1,190–1,208 MiB afterwards. This is an observation, not proof of a particular allocation/cache mechanism.
- Narration preparation continued throughout the run. Later long phrases still created substantial CPU bursts; a 60–90s interval used more CPU than the first interval while scrolling stayed smoother. Thus CPU average or a claim of continuous model loading for three minutes does not fully explain the pattern.
- The broad early-versus-later difference was reproduced, but this run's conspicuous spikes subsided within the first minute. It did not reproduce two to three minutes of continuously severe lag.

## Code findings and limits of attribution

`desktop/main.cjs` starts model loading alongside the window. `usePlayer.ts` speculatively prepares the first three speech units after opening a document/choosing a voice. `BufferedNarrator.fill` then targets about 20 seconds ahead, bounded at 12 phrases; a complete long phrase can overshoot that time target. The probe recorded a 43-second ready buffer at one sample. Synthesis remains serialized in one worker with up to eight intra-op threads on this machine.

`usePlayer.playFrom` also constructs the remaining document's complete speech plan synchronously. Initial virtualized section/word mounting, layout, runtime initialization and temporary allocations are additional candidates. The 120ms task shortly after Play is consistent with initial planning/setup, but the probe did not collect a stack trace or perform a causal intervention. It must not be described as a proven attribution of every early stall.

The earlier responsiveness benchmark reloaded/warmed the app and prepared audio before its main playing comparison. Its steady-state improvement remains valid, but it did not establish cold-start smoothness.

## Fix options and tradeoffs

1. Profile the early long-task stacks and test incremental/reused planning and rendering first. Removing or spreading unnecessary main-thread setup can improve responsiveness and may reduce time to first speech without reducing voice quality. Success for the whole reported window needs measurement.
2. Compare inference thread counts/scheduling against real-time generation headroom. This can preserve identical model precision/voices, but reducing CPU competition can also make synthesis slower and increase buffering at higher listening speeds. The current app has not been changed. ONNX Runtime documents the speed/resource tradeoff in its [threading guide](https://onnxruntime.ai/docs/performance/tune-performance/threading.html).
3. Prewarming more work before Play moves CPU work earlier and can increase opening-time work. Preparing substantially more audio increases startup delay and/or memory. Neither is automatically a free improvement.

No quantization, voice-quality reduction, new model, enlarged permanent cache, dependency/configuration/schema change or installed-build replacement was made. A zero-impact promise for all loading/performance metrics would be premature. Any implementation should compare first-click latency, the first minute, minutes two through four, continuous scrolling and audio continuity.

Evidence: `test-results/startup-lag/probe.mjs`, `cold-four-minutes.json` and `cold-end.png`. The installed ASAR remains `576BC373520EB8D0D0D3E4B476815AFC157BF048806C0EEF497285B312387C1E`. No unit/build rerun was necessary for this diagnostic-only work.
