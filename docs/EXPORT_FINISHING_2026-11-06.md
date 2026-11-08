# Audiobook finishing at 99%

## Findings

The reported Poor Charlie GPU Kokoro/Sky job had finished all7689 speech units:14h59m25s of narration,1,295,169,830 samples /2,590,339,660 PCM bytes and23 chapter markers. Its saved next-unit position has no remaining speech. A read-only snapshot of the paused job was copied to `.cache/finishing-recovery-20261106-225132`; all diagnostic encoding uses this copy, not the live profile.

The original259MB `finished.m4b` is an interrupted MP4 without its final moov index. The completed PCM is intact. There was no encoder running when inspected because the job was paused. The screenshot alone cannot establish a deadlock in the earlier attempt.

The interface capped narration progress at99% and provided no progress throughout AAC encoding, indexing, verification, hashing and publication. A15-hour book has substantial final encoding work after GPU narration completes. The one-minute real-audio sample encoded in1.13s (~53x realtime, ~17-minute projection); the full recording is being verified separately to avoid treating that short projection as a completion guarantee. Pausing/relaunching during incomplete AAC creation restarts this file stage, which can extend the apparent wait across attempts. Narration is not regenerated.

## Changes

- FFmpeg's documented `-progress pipe:1` reports encoded audio time once per second. Manager shows a separate **% file** bar, encoded/total duration, elapsed time and approximate remaining time. It shows explicit chapter-index, checking and saving stages instead of a static99% bar.
- Repeated heartbeat records do not reset the last-forward-progress timestamp. After90s without new encoded audio, the manager explains that progress has stopped reporting and offers the existing Pause/Resume recovery. It does not automatically kill legitimate long file/index operations.
- Pause can stop FFmpeg or its validation probe. A pause message explicitly explains that incomplete final encoding restarts, while narration remains saved.
- If a complete private `finished.m4b` already exists after a pause/verification/publication interruption, the app validates and reuses it rather than re-encoding. It checks AAC,24kHz mono, duration, chapter titles/count/times and any existing finished hash. Source/settings/model compatibility is still checked first. Output publication still refuses to overwrite an existing audiobook.
- Finalization progress is transient worker/renderer metadata, not a new job.json schema or migration. No extra disk writes occur for its one-second reports. Only the mounted export manager updates its elapsed-time display.
- AAC bitrate96kbps, normal M4B/faststart format, original PCM/narration, fp32 model, voices, sentence planning and bounded speech caches are unchanged. This update makes finishing visible and avoids unnecessary repeat encoding; it does not replace AAC with a lower-quality encoder mode.

Primary references: [FFmpeg program-friendly progress](https://ffmpeg.org/ffmpeg-all.html), [MP4 indexing/faststart](https://ffmpeg.org/ffmpeg-formats.html). A normally muxed MP4 is not playable until its metadata/index has been finalized; fragmented output has different compatibility and was not introduced.

## Validation

-127unit tests in19files and production build pass. Unit cases cover chunked/invalid progress records, bounded parser buffering, ETA/phase transitions and genuine advancement versus heartbeat.
- Five native export checks pass: actual CPU/GPU M4Bs,125-minute synthetic duration/progress/bounded-memory case, pause after encoding with valid-file reuse and no synthesis/encoder execution, and post-publication recovery.
- New `scripts/export-finishing-qa.mjs` passes four source and four staged GUI checks using an isolated three-hour synthetic job: measured file progress/ETA, pause/restart with every saved sample retained, completed AAC/chapters without loading a speech model, no automatic narration or external requests.
- Final staged reader/export regression results and the full real-book recovery result are recorded in HANDOFF.md and `test-results/export-finishing/` after completion. Original Kokoro job identity remains `dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04`.

Prepared candidate ASAR: `CF51C8FFE8EBEE393CC312B5AE00C1DD05BC154EA8C004B00D4D54A19C99C5DF`. Installed app at preparation is the later Antigravity Chatterbox build `87E7676D...`. Preserve its Turbo/Standard500M/custom-reference changes, all already-uncommitted source changes and its backups. Required desktop replacement/recovery confirmation is pending; no commit or push.

## Full real-book result

The entire recovered recording completed AAC encoding/index/validation/hash in **1218.32seconds (20min18s)**. Output is635,943,441bytes, duration53,965.41s (14h59m25s), with all23chapter titles retained. SHA256 `bcc6dd05537eb65d5253518cbdc0b946cea77d2699444547c344213cf6e85bdf`. A subsequent full silent decode read all53,965.409583seconds with zero errors in16.80seconds. Nothing was played. This measured run demonstrates a substantial but progressing final-encoding phase; it does not retroactively prove that the user's earlier attempt could not have stalled.

Validated file and reports are under `.cache/finishing-recovery-20261106-225132/full-encoding/`. Original snapshot remains untouched. Final staged42 checks (finishing4+audiobook13+desktop17+resume8), native5 and127unit tests/build all pass. Pending approval, a guarded recovery procedure will close the app, compare the known job's source/model/counters against the snapshot, retain the old partial file, copy in the validated complete file without editing job metadata, and install the tested candidate. Normal UI Resume can then verify/publish the cached completed file without another speech or AAC pass. No destination file will be overwritten.

## Installed and completed

User approved installation/recovery. InstalledCF51C8FF..., backup `release/previous-build-20261106-231929` retains87E7676D... . Guarded production repair matched the paused job's source/model/counters, backed up the interrupted file and copied in the validated completed file, without manually changing job metadata. Normal UI Resume reused/published it immediately. Manager now shows **Completed100%**,14h59m25s and23chapters. The file in the original Downloads destination matches the recovered SHA256/size above. Original snapshot and interrupted-file backup remain. READY WHEN YOU ARE /Play confirms narration paused. No additional speech or AAC encoding, library test, dependency/model/schema change, commit or push.
