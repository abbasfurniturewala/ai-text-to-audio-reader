# Live export completion estimate – 2026-11-07

The Audio exports manager now places an approximate remaining time and **Finish ~time** directly below each active job's percentage. Dates are included when the estimate crosses midnight. The existing slate/blue appearance, progress bar, destinations and export actions remain intact.

## Behavior and limits

- Conversion learns from actual changes in completed characters, generated audio and compressed audio. Narration and compression overlap, so the estimate uses the slower remaining path rather than adding both times. It waits for measurements from both before giving a deadline.
- Timing stays in renderer memory: at most 32 observations over two minutes, coalesced into four-second buckets. Progress events revise the estimate; a two-second timer keeps the countdown current only while the manager has an active export. Leaving the manager releases its timer/history. Pausing, preparation and reopening start fresh measurements; paused time and historical creation dates are not treated as processing time.
- Finishing uses existing measured compression/assembly estimates. Checking, chapter indexing and saving show stage labels instead of guessing a deadline. The former duplicate remaining-time text in file details was moved to the percentage area; duration/elapsed/stall details remain.
- Unknown, expired, invalid or stale estimates show **Estimating…**. Paused jobs say **Paused · ETA on resume**. Completed and failed history has no countdown. No negative time or promised zero-second completion is displayed.
- Estimates are approximate and can move with text complexity, PC load and progress availability. Final checks and saving can add time; the tooltip explains this. This change does not establish a measured accuracy guarantee for every book/device.

The source counters already traveled through the bridge; `ExportJob` only adds their optional TypeScript declarations. There is no new dependency, persisted schema, IPC, model, voice, runtime or export-engine change.

## Validation

- **136/136 unit tests in 20 files**, including seven estimate tests; production type check/build passed.
- **8/8 source and 8/8 packaged ETA checks** using explicit synthetic progress in isolated profiles: measured start, live updates, revised pace, placement below percentage, midnight/date display, compact layout, pause/preparation/resume, compression/assembly, final stage labels, stale/expired values and completed/error history. No renderer errors, automatic narration or external book/audio requests.
- **11/11 packaged audiobook checks** with real offline GPU Kokoro: EPUB M4B completion, protected destinations, PDF scrolling plus real reader narration during export, durable pause/resume, unchanged PCM/compressed prefix, normal-close and forced-stop recovery, manager search/filter/history/compact layout. Voice-comparison checks were intentionally skipped because model/voice code is unchanged.
- **4/4 packaged finishing checks** on a three-hour synthetic PCM fixture: real measured ETA in the new location, pause/restart retaining all samples and compressed sections, resumed M4B completion with correct chapters, and no unintended playback/network requests. Muted Chromium metadata/seek/playback verification also passed.
- Screenshots reviewed at 1000 × 700 and 1100 × 760, including actual native file-creation progress.

All tests used explicit isolated `CADENCE_DATA_DIR` profiles under `test-results/`. No script/test accessed the live library/export folders. Evidence and copied reports: `test-results/export-eta/final/manifest.json`.

## Delivery

The user approved **Update and reopen Cadence**. The exact tested artifact is now installed at `release/win-unpacked`, ASAR SHA256 **C28C2434CEEDC10E735BF91EFEB12A030A41BD1B3F7266CE507F330E85C3A953**. Backup `release/previous-build-20261107-195626` retains Text-reader build **2E7188672E4802E63EDB684A36E1CFAEEF79F0197EFCC36E959D7DBCA9BCEA24**. The updater verified workspace-contained paths, closed only matching app processes and reopened with QA/dev/data overrides cleared. Installed/backup/model hashes match the recorded checks. The same artifact passed all validation above; no repeated suites were necessary.

Normal Windows UI shows **3 books /1bookmark**, The Prince in Reading view at section20of73, independent audio passage1, Echo/Highlight/Follow off and **READY WHEN YOU ARE /Play**. Audio exports retains **0unfinished /2completed**: The Prince, Echo/GPU Kokoro/100%/3h1m56s/33chapters, and Poor Charlie, Sky/GPU Kokoro/100%/14h59m25s/23chapters. Completed rows correctly have no ETA. The live display was validated in isolated active-job tests; no new conversion or narration was started in the real library to demonstrate it. Left the normal export manager open and playback paused. No live-profile scripts, security prompts or data changes.

All **14 packaged desktop modules** match the previous Text-reader build byte for byte. Original fp32 model SHA256 **8FBEA51EA711F2AF382E88C833D9E288C6DC82CE5E98421EA61C058CE21A34CB** and Kokoro export identity **dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04** remain unchanged, preserving existing saved-job compatibility. All prior Antigravity/Codex work is retained. No commit/push.

Suggested commit: `feat: show live audiobook export completion estimates`.
