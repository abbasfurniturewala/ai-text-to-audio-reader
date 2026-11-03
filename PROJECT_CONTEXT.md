# Cadence Reader - continuation context

Prepared for migration on 2026-11-01. Current application/source version: **1.0.12**. Target: Windows x64, Intel/AMD CPU. The source PC was Windows; no cloud backend is required.

## User's purpose and established preferences

Build a desktop PDF/document reader centered on expressive text-to-speech. Free local neural voices are the default, with optional real ElevenLabs using the user's own key. Natural phrasing, quick starts, seamless playback, exact-word starts, readable screen space and predictable navigation matter. Do not reintroduce fixed-length half-sentence blocks, long startup reserves, scrolling that follows audio against the user's wishes, or large permanent document/audio caches.

## Working features to preserve

- React 19 + TypeScript + Vite UI in an Electron 38 desktop shell, named Cadence.
- PDF, DOCX, TXT, Markdown and pasted-text imports; 50 MB per-file limit. Scanned PDFs need OCR first; EPUB and legacy DOC are not supported.
- Kokoro-82M-v1.0-ONNX **fp32** CPU model, about 326 MB, with Heart, Bella, Nicole, Sarah, Michael, Fenrir, Emma and George. Model files, tokenizer and licenses are in `release/win-unpacked/resources/models`. For source builds copy these into `.cache/models`.
- Phrase pipelining and a shared Web Audio clock. Quick start defaults to zero reserve, with roughly 20 seconds / at most 12 phrases prepared ahead. SoundTouch compensates pitch for playback speeds 0.65-1.75. Safe padding trimming preserves breaths/pauses inside sentences. No claim of token-streaming inference or reproducing ChatGPT Voice's private infrastructure.
- Display paragraphs are independent of model windows. Narration uses complete sentences, can join unfinished page-boundary sentences, and guards Kokoro's 512-token context limit instead of silently truncating. Very long sentences use clauses/words as a fallback. WAV export follows the same plan without the old artificial gap per display block.
- Click any word in Reading view or the original PDF to start at that exact word, not an estimated timestamp. Dragging selects text without playing.
- Reading and audio positions are independent. Follow audio is off by default and scrolling/page navigation turns it off. Go to audio is explicit.
- Reading view retains original PDF pages and labels. Virtualized sections keep page landmarks and mount words near the viewport plus explicit audio/jump targets. Original PDF reuses one PDF.js worker/document, cleans pages, and destroys the worker/canvas on close.
- Contents preserve parts/chapters/main topics and nested subsections; main topics are shown first, with disclosure arrows. Search preserves ancestors. Multiple headings on one page retain distinct targets. Original PDF jumps honor bookmark coordinates. No automatic sidebar scrolling; Locate is explicit. Page fallback remains available in groups of 40 with search.
- Structure detection prefers publisher bookmarks, then conservative heading/font clues or verified contents-page destinations. Bare Chapter 1, Roman/word chapter numbers, parts, Word heading styles and Markdown levels are supported. Opening material is grouped. Ambiguous PDFs retain pages.
- Regression examples: Poor Charlie's Almanack has four chapters with the eleven talks nested inside Chapter 4 (not eleven root chapters). Varian has 37 chapters and their subsections. These source books are not required to run the synthetic tests on the new PC.
- Library, navigation and voice sidebars collapse independently. Compact header; original full-size bottom player collapses after ten seconds without input and returns on input. F11 / Esc full screen has small side controls. Layout changes preserve reading position and narration.
- Last-book and browsing checkpoints survive full app restarts. Store page / paragraph / mode separately from audio position. At most 64 small checkpoints in `cadence-reader-session-v1`; never copy text/PDF/audio into this state. Original PDF resumes at the top of its saved page. Reading view resumes its paragraph. No autoplay. Close document and Library keep the last-book choice for restart; Delete removes the checkpoint.
- During opening/restoration, an explicit user action cancels automatic restoration. A delayed restore must never pull a new page jump back to an older page.

## Storage and memory design

`src/library.ts` stores summaries in IndexedDB `keyval-store/keyval`, key `cadence-library-index-v2`. Per-book text is `cadence-text:<id>`, PDF Blob is `cadence-file:<id>`. Only the selected book's text is loaded. Position/bookmark saves update small metadata. Legacy v1 library migrates atomically. Text version 2 repairs unfinished legacy blocks and remaps positions/bookmarks atomically. Navigation version 3 refreshes old flat indexes. Preserve these migrations.

Completed speech cache: 24 MB / 48-entry LRU, separate from bounded lookahead. Document switches/closes clear obsolete cached speech. Full neural model remains loaded for responsiveness. ONNX memory-pattern caching is disabled for varying phrase lengths; CPU memory arena remains enabled. Model memory is substantial; do not sacrifice voice quality merely to shrink the baseline.

Profile: `%APPDATA%\Cadence` by default. `CADENCE_DATA_DIR` redirects test profiles. Normal window close asks the renderer to finish summary saves, then flushes browser storage, with a two-second fallback for a hung renderer. Single-instance lock focuses an existing reader rather than creating conflicting writers.

The migration uses portable JSON plus original PDF files, not a raw Chromium profile. It excludes `eleven-key.enc`, cookies, machine encryption keys and caches. On import each new document/text/PDF/index entry commits atomically. Existing destination IDs and reading state win; repeat import is idempotent. This is snapshot transfer, not ongoing OneDrive synchronization.

## Important files

- `src/App.tsx`: reader/library UI, independent browsing/audio, imports, export, navigation and panels.
- `src/usePlayer.ts`, `src/audio.ts`, `src/speechPlan.ts`: audio planning, scheduling, source offsets and caching.
- `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/speech-worker.mjs`, `desktop/speech-input.mjs`: secure desktop bridge, native inference and token guard.
- `src/paragraphs.ts`, `src/documents.ts`: extraction, paragraphs and import metadata.
- `src/structure.ts`, `src/topics.ts`, `src/locations.ts`, `src/DocumentNavigation.tsx`: hierarchy/destinations and sidebar.
- `src/readerSession.ts`, `src/useReaderResume.ts`: bounded checkpoints and restoration/user-interruption guard.
- `src/PdfPage.tsx`, `src/pdfWords.ts`, `src/ReadingSection.tsx`: original PDF rendering/word mapping and virtualized reading.
- `src/styles.css`, `src/FocusControls.tsx`, `src/useIdlePlayer.ts`: reading space, full screen and ten-second player collapse.
- `migration/`: portable library, verification and restore tools, all with machine-independent paths.

## Build and verification

The transfer includes a runnable application folder. It is sufficient to restore and launch that first; do not wait for rebuilding to verify the reader. The portable Node/npm runtime is under `tools/node`. Add that directory to the current shell PATH, run `npm.cmd ci`, `npm.cmd test`, `npm.cmd run build`. The lockfile pins the actual tested dependency graph; package.json ranges are not a reason to update dependencies during restoration.

`node scripts/package-update.mjs` prepares `release/staged-<version>/win-unpacked`. Wait for packaging exit code zero before launching a staged executable. `scripts/apply-desktop-update.ps1` validates workspace paths and retains the old build; on a new workspace with no current build, install/copy the staged app or use the already transferred `release/win-unpacked` first. Avoid relying on the single-file portable wrapper; folder packaging was the verified delivery method.

Last prior verification: 63 unit tests, eight real close/relaunch cases, 17 desktop regression cases (including real neural narration/WAV export), and 12 navigation cases. Current migration verification is recorded in `migration/VALIDATION.json` inside the final bundle. GUI tests use `CADENCE_QA=1`, `CADENCE_QA_OFFLINE=1` and separate temporary `CADENCE_DATA_DIR` folders. Run GUI suites sequentially to bound memory.

Useful checks: `desktop-qa.mjs`, `resume-qa.mjs`, `structure-navigation-qa.mjs`, `reading-space-qa.mjs`, `header-qa.mjs`, `word-start-qa.mjs`, `memory-qa.mjs`. Optional real-book tests must be skipped or given an explicit fixture on a new device. Do not copy the old user's Downloads path into new source.

## Limits and references

No paid provider key was used for live ElevenLabs validation; its API contract was checked with a mock. Reconnect a user-supplied key through Settings. Local Kokoro is a distinct model, not ElevenLabs' proprietary algorithm. For unusually slow CPUs, first inference, a word jump and very long sentences can still take time. No OCR or document classification cloud service has been introduced.

Primary references and license details are in README.md. Kokoro model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX . Kokoro.js: https://github.com/hexgrad/kokoro/tree/main/kokoro.js . Electron: https://www.electronjs.org/docs/latest/ . PDF.js: https://mozilla.github.io/pdf.js/ . Mammoth: https://github.com/mwilliamson/mammoth.js .

`migration/REFERENCE_UI.png` shows the established reading layout and hierarchical chapter navigation. `node scripts/structure-navigation-qa.mjs --synthetic-only` exercises navigation without any source-PC book path. The bundled npm is 10.9.3; use its adjacent Node 22.19.0 runtime instead of a global npm of a different version when reproducing this setup.
