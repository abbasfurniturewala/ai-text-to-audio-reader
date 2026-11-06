**Cadence listening and reader review — 4 November 2026**

Reviewed the six supplied proposals against `main` at `e553ee1` in this workspace. Recommendation: prioritize PDF narration cleanup and export memory/pacing, add only the missing and safe normalization changes, and fix the reproduced reader/cancellation defects. Extra curated voices are a useful optional addition. Scroll pre-warming offers a narrower benefit than claimed; defer voice blending and treat EPUB as a separate feature.

This was an assessment and test task. Application source, dependency files, packaged release, and the live `%APPDATA%\Cadence` library were not changed. All GUI experiments used isolated profiles under `test-results`. No restore/import into the live library, deployment, commit, or push was performed.

**Assessment of the six proposals**

| Proposal | Verdict | Evidence and required adjustments |
|---|---|---|
| 1. Suppress PDF running headers, footers and page numbers | High value; do early | A three-page synthetic PDF text fixture narrates repeated `BOOK TITLE` and page numbers between body fragments. Suppression must use margin geometry, repeated-page evidence and printed labels, and preserve source positions and saved markers. |
| 2. More voices and blending | Split into two tasks | All 15 proposed extra voices generated real offline speech with the supplied fp32 model. An opt-in extended list is practical. Blending is a separate experimental feature with validation, phonemization and quality questions. |
| 3. Scroll pre-warming | Conditional value; benchmark before broadening | Current caching gave a 24 ms prepared phrase start versus 972 ms for an uncached middle-word start in one real run. A whole phrase and its clicked-word suffix have different cache keys, so whole-phrase warming does not remove that suffix synthesis. |
| 4. Export trimming and Int16 chunks | High value; revise the trimming design | The current exporter retains Float32 chunks, a merged Float32 array and a WAV. Int16 chunks reduce this burden. However, calling two-argument `speechBounds` would shorten the new live pauses instead of reproducing them. |
| 5. Spoken normalization | Mostly already present; extend carefully | Newline handling, wrapped-word repair, arrows, rupees/euros, en-dashes, bullets and final punctuation already exist. Citation suppression and the listed abbreviation expansions are absent. Blind numeric-bracket deletion can remove meaningful mathematical content. |
| 6. EPUB import | Useful if EPUB books are part of the intended workflow; separate phase | The Electron renderer supports `DecompressionStream('deflate-raw')` and `DOMParser`. The primitives are available, but robust ZIP/EPUB processing, navigation, bounds and failure handling are substantial work. |

For **PDF artifact suppression**, avoid deleting every Roman-looking edge string: the suggested regex also matches words such as `mix` and `civil`. The first occurrence of a genuine chapter title should not disappear simply because it is repeated later as a running header. Match physical margin zones using the page dimensions and rotation, normalize variable page numbers conservatively, and keep body text, real headings, numbered lists and tables intact. Existing books need a deliberate compatibility strategy; deleting stored segments would shift bookmark, narration and restart indices. Prefer preserving the extracted source and its index mapping while suppressing confirmed artifacts from narration, or explicitly design and approve a migration before changing stored text.

The PDF word-map warning is valid. With a source body containing a later digit `2`, an omitted PDF run `2` currently maps to that body digit and advances the cursor; the following body run becomes unmappable. A short-run distance guard helps, but the proposed `40`-character limit is a heuristic, not a complete alignment policy. Include repeated short labels, split runs, ligatures, columns and exact-word starts in the regression cases. Locations: `src/paragraphs.ts:26`, `src/documents.ts:35`, `src/pdfWords.ts:18`, `src/speechPlan.ts:24`.

For **additional voices**, the tested IDs are `af_kore`, `af_nova`, `af_aoede`, `af_alloy`, `af_sky`, `am_puck`, `am_onyx`, `am_liam`, `am_echo`, `bf_isabella`, `bf_lily`, `bf_alice`, `bm_fable`, `bm_daniel`, and `bm_lewis`. Each voice asset is already present at 522,240 bytes. Generation took approximately 581–821 ms for the short test sentence after model load. Keep the current eight as the default and the British default filter count at two. Include persistence/restart of an extended selection, previews, export and full-screen voice controls in testing. Successful generation does not establish which voices sound best; that needs listening comparisons.

For **blending**, wrapping the model alone is insufficient. The worker currently rejects unknown voice IDs, and Kokoro.js independently validates voices before inference. Its style selection is a 256-float slice indexed by token length; it is not one fixed 256-float vector per voice. A correct blend must select both length-specific slices, validate both supported IDs and a bounded ratio, define which accent controls phonemization, preserve cancellation/cache behavior, and handle previews/export. An underscore identifier passes the IPC character regex but does not solve those other checks. Interpolation is technically feasible; better sound is unproven. Inspect the installed `node_modules/kokoro-js/dist/kokoro.js` and the [upstream implementation](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/kokoro.js).

For **pre-warming**, `src/usePlayer.ts:60` already prepares the opening three chunks when the document or voice changes. The cache in `src/audio.ts:13` includes the exact request text. Scroll warming can help starting at the beginning of a newly browsed passage, but arbitrary word starts must still synthesize their exact suffix. Test both idle and paused browsing, Original PDF page changes, rapid scrolling, document switches, voice changes, and CPU contention. Cancel obsolete queued work, retain the bounded cache, and keep playback requests ahead of speculation. Cancellation cannot interrupt an ONNX inference already executing. One real benchmark measured 2,059 ms from initial click to first scheduled clip, 24 ms for a prepared start, 972 ms for an uncached word start, and zero scheduled gaps between the measured clips. These are single-run measurements on this PC, not latency guarantees.

For **export**, `src/App.tsx:435` retains Float32 chunks and `src/App.tsx:449` makes a full merged copy before WAV conversion. At the two-hour/24 kHz limit, those two float representations plus the PCM WAV require about **1.728 GB** of sample buffers before additional copies, model memory and other app state. Int16 chunks plus the final WAV reduce that sample-buffer subtotal to about **691 MB**. These are calculated allocation sizes, not measured process working sets; Blob creation, Save WAV reads and IPC may add further copies. Remove avoidable copies, retain the two-step Create/Save flow, and consider validated main-process streaming to a temporary file if truly bounded long exports become necessary. Streaming would require a separate design decision under the project rules.

Share a single sentence/paragraph/heading pacing policy between export and `BufferedNarrator.fill`, rather than using `speechBounds(samples, rate)` defaults of 60 ms lead and 120 ms tail. Current live calls use 100 ms lead and 420/540/640 ms tails. With real Kokoro samples:

| Clip | Current untrimmed export | Current live duration | Proposed default-trim duration |
|---|---:|---:|---:|
| Sentence | 4.795 s | 4.335 s | 3.995 s |
| Paragraph end | 3.370 s | 3.110 s | 2.650 s |
| Heading | 1.750 s | 1.500 s | 0.970 s |

The exporter also says to choose a smaller section after exceeding its limit, but the UI only offers the entire document or the remainder. Chapter/section export would make that advice actionable. Preserve native 1× WAV generation and the existing Save WAV/toast contract. Locations: `src/narration.ts:43`, `src/narration.ts:184`, `src/App.tsx:429`, `src/audio.ts:60`.

For **normalization**, extend the existing helper in `desktop/speech-input.mjs:27` instead of replacing it wholesale. Keep source text and word offsets unchanged. Citation suppression should be optional or sufficiently contextual to preserve numeric arrays/ranges such as `[1, 3–5]`. Abbreviation handling should be checked together with renderer sentence segmentation and Kokoro's own normalization. Existing code also changes `well- known` into `wellknown`, `long- term` into `longterm`, and `₹1.1` / `€1.1` into singular `1.1 rupee` / `1.1 euro`. Those are concrete normalization edge cases to fix and test.

For **EPUB**, start with DRM-free, reflowable EPUB 2/3. Define handling for namespaces, spine order, non-linear entries, nested TOCs, relative paths and fragment targets, nested blocks without duplicated text, malformed archives, and unsupported encrypted content. Enforce decompressed-size and entry-count bounds as well as the current compressed file-size limit. Extract inert text; do not run embedded scripts or fetch remote book resources. Keep EPUB navigation based on sections rather than inventing physical PDF pages. Test renderer primitives in Electron instead of introducing a Node fallback into production renderer code. The [EPUB specification](https://www.w3.org/TR/epub-33/) and [reading-system requirements](https://www.w3.org/TR/epub-rs-33/) are the relevant primary references.

**Additional findings from the tests**

1. **Cancel stopped voice previews at the synthesis layer.** A controlled Electron probe stopped a preview while its request was pending; no cancellation IPC was sent. `stopPreview` invalidates its result and stops media playback but leaves generation alive. Rapid previews or a switch to narration can therefore retain obsolete work. Give previews an AbortController and cancel on Stop, voice/document change and playback start. Locations: `src/App.tsx:356`, `src/App.tsx:410`. Evidence: `gui-probes.json`, `cancel-preview-synthesis`.
2. **Preserve explicit paragraph semantics during heading refresh.** A stored DOCX paragraph `Why did you leave?` with `heading:false` renders as a heading after opening. `refreshHeadings` currently applies a generic short-text heuristic even when the importer supplied explicit paragraph semantics. This changes visual treatment and speech pacing. Retain semantic Word/Markdown heading evidence and distinguish inferred PDF headings from ordinary questions and sentence fragments. Locations: `src/library.ts:84`, `src/paragraphs.ts:7`. Evidence: `gui-probes.json`, `saved-docx-paragraph-reclassification`.
3. **Make “Go to audio” and the page/checkpoint indicator agree.** On a synthetic 806-page book, returning to audio page 500 centers its correct passage but leaves the viewing indicator at page 499, consistently after 50/300/1,000 ms waits. The active passage begins 176 px below the reader top, while location tracking probes near its top. Clamp return positioning to the target page boundary or otherwise reconcile the explicit target with visible-location tracking. Narration itself remains on page 500. Locations: `src/App.tsx:195`, `src/App.tsx:326`. Evidence: `gui-probes.json`, `go-to-audio-virtualized-page`, and `go-to-audio.png`.
4. **Refresh missing page labels independently of navigation version.** With `navigationVersion:3` and missing `pageLabels`, opening the saved PDF does not reload its labels. An isolated fixture originally labeled `i`, `ii`, `1`, `2`, `3` remains unlabeled after reopening. Check metadata completeness as well as version; distinguish absent labels from a legitimate empty label array. Location: `src/App.tsx:186`. Evidence: original `navigation.log` and focused `missing-page-label-upgrade` probe.
5. **Avoid assigning heading pauses to the first convenient quiet valley.** A waveform probe with an early 200 ms comma pause and a later 300 ms heading/body break pads the comma to 580 ms while the actual heading break becomes only 390 ms. `paceAudio` identifies the first eligible valley, not the boundary's text position. Preserve the recent breathing room while making boundary placement explicit or documenting the heuristic. Location: `desktop/speech-input.mjs:66`. Evidence: `logic-probes.json`, `heading-pause-placement`.
6. **Maintain the deeper QA scripts.** Playback and latency tests wait for visible player buttons after the intended ten-second collapse. Reading-space tests issue fullscreen toggles before Windows transitions settle. Keep tests aware of collapsed controls and wait for actual transition completion; retain dedicated collapse assertions. Ordinary spaced F11/Escape checks passed. The evidence does not establish a general fullscreen shortcut defect.

**Verification record**

Bundled Node 22.19.0 / npm 10.9.3 were used. Unit tests: **67/67 in 10 files passed**. TypeScript/Vite build: **passed**. GUI suites ran sequentially and originally produced these results:

| Existing suite | Result | Passed checks before completion/failure |
|---|---|---:|
| desktop | Passed | 17 |
| desktop --packaged | Passed | 17 |
| resume | Passed | 8 |
| structure-navigation --synthetic-only | Passed | 11 |
| word-start | Passed | 7 |
| paragraph | Passed | 4 |
| playback | Failed: hidden player control | 1 |
| browse | Passed | 8 |
| navigation | Failed: page-label recovery | 8 |
| memory | Failed: Go to audio page indicator | 2 |
| reading-space | Failed: rapid fullscreen transition | 6 |
| header | Passed | 5 |
| latency | Failed: hidden player control after measurement | Benchmark; no PASS counter |

Thus **8 of 13 unmodified suites completed successfully**; failures must not be reported as a wholly green GUI run. Diagnostic copies preserved the existing assertions: playback passed all five checks with periodic activity keeping the player visible; latency completed with the same visibility accommodation; reading-space passed all nine checks with a 350 ms transition-settling wait. The navigation and memory failures were independently reproduced as app issues. Original QA scripts were not modified.

Further probes covered the PDF artifact/word-map cases, normalization edge cases, waveform padding, saved DOCX heading semantics, preview cancellation, page labels, 806-page return navigation, renderer decompression support and all 15 extra voices. A 1,121-character long input generated 73.25 seconds of audio offline in about 24.27 seconds through the existing token-guarded worker. Audio checks verified non-silent samples and valid WAV output, not subjective pronunciation quality or a transcript of the long sample.

Local evidence and reproducible investigation scripts are in `test-results/listening-review-2026-11-04/`: `suite-results.json`, individual suite logs, `diagnostic-suites.json`, `logic-probes.json`, `gui-probes.json`, `voice-probes.json`, and `go-to-audio.png`. Real timing detail is also in `test-results/latency-updated.json`. This evidence is generated/ignored by Git; the assessment and handoff are the durable documentation changes.

**Recommended implementation order**

First fix preview cancellation, explicit heading semantics, page-label recovery and the Go to audio indicator, while updating the stale QA waits. Then implement careful PDF artifact suppression and export PCM/pacing improvements. Extend normalization with guarded regression cases. Add an opt-in extended voice list if desired. Use the measured latency results to decide whether narrowly bounded viewport warming is worthwhile. Treat blending as experimental and EPUB as a separately scoped feature. Preserve the current live library, default UI, exact-word starts, complete sentences, bounded caches and independent reading/audio positions throughout.
