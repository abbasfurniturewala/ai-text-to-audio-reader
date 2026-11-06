# Document scrolling fix — 4 November 2026

The page loader was interrupting Chromium's native scrolling animation. Measuring a newly loaded page updated its size state even when the placeholder already had the correct aspect ratio. Its layout correction then called `scrollTo` with an unchanged position. A zero-distance instant scroll still cancelled the ongoing animation. Panel/player anchor restoration could make the same redundant call.

The fix reuses unchanged placeholder geometry and applies anchor corrections only when the viewport actually needs to move. Explicit navigation, Go to audio, sentence following, real page-size changes and zoom/layout restoration remain. The app continues to use native scrolling; no wheel interception or custom animation was added. Original PDF rendering, the eight-page bound, exact-word mapping, voice model and stored data are unchanged.

## Reproduction and measurements

Used the original `Downloads/war-peace.pdf` in a dedicated library under `test-results/scroll-performance/`. No test or script targets the live library. Measurements use the same isolated Electron QA rendering mode before/after; frame timings are scoped to that harness. Fixed PCM playback controls audio timing in the scrolling probe; separate desktop QA verifies real Kokoro narration/export.

| Scenario | Installed build before fix | Source fix |
|---|---:|---:|
| Native animated scroll requesting 10,000px | Stops at 1,697px; one redundant reset | Completes 10,000px; zero resets |
| Forward wheel input totalling 10,000px | Seven redundant resets | Zero resets |
| Reverse wheel input | Completes −10,000px | Completes −10,000px |
| Wheel input during playback | Completes 10,000px | Completes 10,000px |

The baseline's frame intervals were already about 16.7ms median / 16.8ms p95 with no observed long tasks over 50ms. The reproduced issue is cancelled motion rather than evidence of a general low frame rate. An experimental suppression of only redundant scroll calls on the old build also completed all 10,000px, confirming the cause before changing source. The actual source fix passes without that experimental suppression. Canvases remain bounded and renderer errors are absent in the recorded runs.

## Verification and delivery

- 90/90 unit tests and production build pass.
- Source passes four real-book scroll scenarios and 48 GUI checks: continuous documents 13, reading space 9, highlighting 9, restart 8 and memory 9.
- The final prepared package passes the same four real-book scroll scenarios and 56 GUI checks: continuous documents 13, reading space 9, highlighting 9, restart 8 and desktop 17, including real offline narration and WAV export. Native scrolling completes all 10,000px with zero unwanted corrections. The fp32 model matches the installed copy.
- After explicit user approval, the updater installed the tested build at `release/win-unpacked` and retained `release/previous-build-20261104-210712`. Installed ASAR SHA256 matches the tested package: `EA3E41D112C7A8FE0A0DD6BA9D48945AAEBB8DB0E00A98AEB63CC512F8BAE4AA`; backup matches the preceding `8DC5F7FBF6BCAC9191AD3EE6C4DA8028FE1B506E1A7D38FD8992B6A811919128` build. Both were reverified on 5 November. Cadence reopened with `war-peace` in original PDF Document view, page 37, Underline and audio paused; no live-reader input was issued during inspection.
- `scripts/scroll-performance-qa.mjs --smooth-only --assert` tests native animation completion. The default run tests forward/reverse/playing wheel input. A synthetic 2,043-page fixture is generated when `--fixture` is omitted; an explicit PDF path can test another book. `--baseline` targets the installed app, `--staged` the prepared build, and `--tag` keeps named reports. `--skip-noops` is a diagnostic intervention used only to confirm the old build's cause.
- Evidence: `test-results/scroll-performance/baseline.json`, `baseline-momentum.json`, `guarded-momentum.json`, `source.json`, `source-momentum.json`, `staged.json`, `staged-momentum.json` and `model-verification.json`.
- No dependency, lockfile, configuration, schema, model, restore, commit or push changes. The approved scrolling update is installed; the existing library was preserved.
- Suggested commit: `fix: preserve native scrolling while document pages load`.
