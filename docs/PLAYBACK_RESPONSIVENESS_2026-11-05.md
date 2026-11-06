# Playback responsiveness — 5 November 2026

The user reported that scrolling and the rest of Cadence became choppy only while narration was playing. The earlier native-scroll interruption fix remains valid, but its scrolling playback probe used fixed PCM and did not measure real synthesis or all playback-related rendering work. This investigation uses actual offline Kokoro narration, Fenrir, the original 2,043-page War and Peace PDF, a visible Windows Electron window and a separate test library.

## Findings and focused changes

1. `usePlayer` published fractional progress and the changing buffer duration every 40ms. That rendered the whole App roughly 25 times per second, even when its sentence and document state were unchanged. The estimated timeline now publishes at most five times per second, with immediate source-position changes, completion and pause snapshots. Buffer duration publishes only when its displayed whole second changes. The narrator's 40ms audio-clock tick, scheduling, exact-word offsets and sentence/phrase cues are unchanged.
2. Reading view recreated thousands of section elements on progress updates, and an inline rebuild handler defeated navigation memoization. The section array and callback now reuse unchanged values. No new storage, permanent document cache, component split or architecture change.
3. The decorative twelve-bar CSS waveform was responsible for much of the remaining rendering work. Disabling only that animation in the test process reduced renderer work from about 265ms/s to 99ms/s while narration continued. Forcing compositor promotion did not remove the cost; narrowing highlight selectors helped partly, and neither experiment was applied to production. The same small moving bars now draw into a tiny canvas, without per-frame React state or CSS animation changes. It respects device pixel density, cancels its animation/listener on cleanup and stops when the player collapses. The preview's small meter remains available. PDF canvases/rendering are unchanged.

The voice engine, fp32 weights, thread pool, natural sentence boundaries, pitch compensation, lookahead, caches, persistence and dependency locks are unchanged. Browsing stays independent from narration and following stays opt-in.

## Measurements

Same original book, page 37, Fenrir at 1×, forward/reverse wheel input and real offline narration. Values normalize by measured duration; these are renderer metrics, not whole-machine CPU percentages.

| During narration | Installed build before this update | Tested packaged update |
|---|---:|---:|
| UI commits per second (including scrolling) | 26.8 | 7.8 |
| Renderer task time per second | 399.7ms | 120.5ms |
| Script time per second | 63.5ms | 27.0ms |
| Style recalculation per second | 54.0ms | 3.3ms |
| 95th-percentile delay of a 50ms timer | 9.6ms | 3.1ms |

This is about 70% less renderer task time, 71% fewer UI commits and 94% less style recalculation in this comparison. Frame intervals were already usually about 13.9ms in the visible-window harness; occasional longer frames remain. The final packaged Document-view playing phase had no frames over 50ms. The large-book Reading-view stress test at 1.5× still recorded two long tasks and a few frames up to about 70ms; its p95 frame interval was about 14.3ms. This does not establish a guaranteed frame rate or the complete absence of device-specific stutter. Test-driver wheel acknowledgements also affect scenario duration, so duration alone is not a responsiveness score.

The original engine handler runs unchanged; the probe only records synthesis timing. It verifies nonempty real speech, separate paused/playing clocks, seamless scheduled clip handoffs, substantial scroll movement, bounded original-page canvases and the absence of renderer errors. The optional fixture is unnecessary: synthetic navigation pages are generated when no path is supplied.

## Verification and delivery

- 90/90 unit tests and production build pass. Eight source GUI suites pass 82 checks: desktop 17, continuous documents 13, reading space 9, highlighting 9, word starts 7, restart 8, memory 9 and all-format Document view 10.
- The final packaged build passes 58 GUI checks: desktop 17, continuous documents 13, reading space 9, highlighting 9 and all-format Document view 10. Includes real offline narration/WAV export, original rendering, full screen, exact starts, independent following, cleanup and restoration.
- Real-book performance checks pass on source and the package in Document view at 1×, plus source Reading view at 1.5×. The paused clock stays exactly unchanged within its measured interval, prepared clip handoffs are seamless, the meter animates while playing and stays still when paused, and its raster scale matches the tested device pixel ratio (1×). Code handles resize/DPI changes, but this is not certification of every Windows scaling setting.
- `scripts/playback-performance-qa.mjs` supports baseline/source/staged builds, visible/offscreen windows, Reading view, playback speed and optional original PDFs. It records per-phase CPU profiles, UI commits, frame/timer distributions, renderer work, actual inference and audio-clock scheduling. Profiles remain under `test-results/playback-performance/` and never target the live library.
- Evidence: `baseline-body.json`, `source-final.json` (timeline optimization only), `source-animation.json` (CSS-meter freeze), `source-promoted.json`, `source-scoped.json`, `source-meter.json`, `source-reading-final.json`, `source-reading-layer.json`, `staged-real.json`, CPU profiles and `artifact-verification.json` under `test-results/playback-performance/`. Visual review of the staged reader screenshot confirms original pages and the slate/blue meter remain intact.
- Probe corrections: initial clock assertions included time between phases (another playing phase, or profiling/meter-audit time). The final assertion measures the clock strictly inside the paused interval. The all-format staged suite also exposed an existing race: forcing a renderer reload within the 400ms summary-save debounce can reopen the previous audio passage. That test now waits for the actual persisted position before forcing reload and retains its restoration assertions. Immediate normal desktop close/restart continues to pass without such a wait; the app's persistence behavior was not changed.
- After explicit user approval, the updater installed the tested build at `release/win-unpacked` and retained `release/previous-build-20261105-134514`. Installed ASAR SHA256 matches tested `576BC373520EB8D0D0D3E4B476815AFC157BF048806C0EEF497285B312387C1E`; backup matches the prior `EA3E41D112C7A8FE0A0DD6BA9D48945AAEBB8DB0E00A98AEB63CC512F8BAE4AA` build. Both fp32 model copies match `8FBEA51EA711F2AF382E88C833D9E288C6DC82CE5E98421EA61C058CE21A34CB`. Normal-window inspection shows The Prince in Reading view, section 18, four library books, Underline, Fenrir and paused narration. The agent issued no reader/library action during inspection. No redundant tests were run on the installed/live profile.
- No dependency/configuration/schema/model changes, live-library tests, restore, commit or push. Suggested commit: `fix: reduce playback UI work and isolate waveform animation`.

Chromium describes its separate compositor animation engine in its [animation implementation notes](https://chromium.googlesource.com/chromium/src/+/master/third_party/blink/renderer/core/animation/README.md). The choice here is based on the application's before/after measurements; no generic claim that every CSS transform animation is expensive is intended.
