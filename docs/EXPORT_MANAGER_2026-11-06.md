# Dedicated audio export manager

The user requested one place for previous and ongoing conversions, reliable pause/resume across closing Cadence, and an explanation of the different voice lists.

## Behavior

- Menu → Audio exports now opens its own page instead of the creation dialog. New export opens the existing M4B/WAV creation form. Creating an M4B returns directly to the manager; Back to reading restores the saved browsing location while narration and conversion remain independent.
- All / Unfinished / Completed filters and case-insensitive title/voice search organize the existing job history. Cards show status, progress, saved duration, chapters, voice, GPU/CPU engine, creation date and destination. Pause/resume, retry and Show audiobook in folder are available as appropriate.
- Completed M4B job records remain after temporary source/PCM cleanup. Existing records appear without migration. Saved jobs resume from their private source even when no document is open. Opening the manager never starts narration or a paused job.
- Closing Cadence pauses active work at its last durable phrase. A hard process-tree termination also reopens paused; the unfinished phrase can be regenerated. Completed audio is preserved. No automatic resume, destructive history clearing or new stored-data format was introduced.
- A moved/deleted completed output reports a plain-language error while retaining its history. The manager does not recreate a moved file or claim it can locate an arbitrary external file automatically.
- Legacy short WAV exports remain a separate, non-resumable tool. They were not recorded as durable jobs and cannot be retroactively reconstructed as export history. The form and README now make the distinction explicit. Whole-book M4B is the default and uses this manager.

## Reliability issue found by deeper testing

Repeated conversion/restart testing captured an actual Windows `EPERM` during atomic replacement of job.json. Completed PCM was retained, but this transient lock marked the job as failed. `atomicJson` now retries only EPERM/EACCES/EBUSY with a bounded backoff (up to approximately 1.4 seconds). It never removes the old checkpoint before replacement. Normal successful saves add no delay. A real Windows file-sharing lock test verifies that the old checkpoint stays readable until the new checkpoint can replace it.

The generation pipeline/model files are byte-identical, so existing Kokoro jobs retain identity `dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04`. No voice/model change, dependency, lockfile change, library migration or global installation. Live data remains in the previously approved `%USERPROFILE%\CadenceReaderData`; all tests use isolated folders.

The shared renderer job hook subscribes only while the form/manager is mounted. An initial disk-list response cannot replace a newer progress event. Returning to the window or pressing Refresh reloads saved jobs. Job progress does not add an App-level subscription or extra reading-view rendering work.

## Reader/export voice discrepancy

All 23 English Kokoro voices already worked in both CPU reader and GPU/CPU export. The reader mislabeled its eight-voice curated list “All voices”; its old “Extended voices” filter exposed all 23. This was a presentation/filtering inconsistency, not a model or hardware restriction. “All voices” now shows all 23, “Curated voices” retains the original eight, and accent/gender filters search the full catalog. Settings/README and GUI assertions reflect those counts. Existing voice IDs, blends, saved selections, previews and audio generation are unchanged.

## Verification and delivery

124 unit tests in 18 files pass, including the new real Windows file-lock test. Production TypeScript/Vite build passes. Source export-manager QA passes 11 checks with comparisons skipped; the earlier source iteration had already passed both real GPU/CPU comparison checks. Final staged suites pass 45 checks: audiobook13, desktop17, resume8 and listening7. These include real CPU/GPU comparisons, completed history/filter/search/reveal, missing output, native PDF page return during narration/conversion, all23/curated8 voices, normal close while converting and forced process-tree termination with paused restoration and unchanged PCM prefix. The forced termination intentionally has a nonzero native exit; other test exits are normal. The short simultaneous wheel/reading/export sample had max33.4ms/zero frames over50ms, not a sustained or all-device performance guarantee. Evidence and installation status are in HANDOFF.md and `test-results/export-manager/staged/manifest.json`.

Two diagnostic failures are retained: `ui-source-1793973067619` killed only Chromium's main PID and left renderer processes holding the test profile lock; its verified test remnants were cleaned up, and the crash simulation now stops only the complete isolated test process tree. `ui-source-1793973337159` exposed the real Windows checkpoint-rename error above. Neither failure was hidden or fixed by weakening durability assertions. Passing corrected source run: `ui-source-1793973575531`.

Do not install superseded staged candidates. The final staged candidate at preparation time is ASAR `3781352DD63AAA8EFAC616B4D3DA2B0FBED98DC32AD05D8F932EFB49451B0F29`. Desktop replacement requires the user's final confirmation and retains the previous build. No commit or push.

## Installed delivery

The user subsequently approved installation. The updater installed the tested `3781352D...` build, retained `release/previous-build-20261106-193946` with previous `E6FD4853...`, and reopened with the same stable local data folder and no QA/dev overrides. Installed/backup ASAR and original helper/model hashes verified. Normal UI shows one unfinished job: Poor Charlie / Sky / GPU Kokoro / **45% / 6h47m32s saved / 14 chapters / Paused / Resume export**. Reader is READY WHEN YOU ARE / Play. No narration or production conversion was restarted. The user had progressed the conversion since the earlier8% recovery snapshot; this update retained that current progress. The Desktop shortcut and Start Cadence.cmd open the update. No commit or push.
