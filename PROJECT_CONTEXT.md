# Cadence Reader - continuation context

Prepared for migration on 2026-11-01. Current application/source version: **1.0.12**. Target: Windows x64, Intel/AMD CPU. The source PC was Windows; no cloud backend is required.

## Current development checkpoint (2026-11-06)

- Work **in place** in this extracted workspace. Do not run `migration/restore.ps1` or `MIGRATE-CADENCE.cmd` here. Read `AGENTS.md` and `docs/HANDOFF.md` first; the original migration instructions in START_HERE describe transfer to another PC.
- The installed Desktop shortcut/Start Cadence.cmd opens `release/win-unpacked/Cadence.exe`, ASAR SHA256 `3781352DD63AAA8EFAC616B4D3DA2B0FBED98DC32AD05D8F932EFB49451B0F29`. Backup `release/previous-build-20261106-193946` retains preceding recovery build `E6FD4853...`. Build alone updates dist, not this app. Ask before replacing the packaged app; keep its backup and reopen paused.
- Current behavior includes continuous original-PDF Document view, section-based Document view for other supported formats, exclusive Highlight/Underline sentence cues, slate/blue theme, manual player hiding, a Menu drawer closed on launch, Bookmarks Back, PDF running-margin narration cleanup, native text/ranges, incremental speech planning and bounded memory. Keep independent browsing/audio, exact-word starts, complete-sentence narration and opt-in following intact.
- **Menu → Audio exports** is a dedicated persistent M4B manager with history, search/filter, progress/status/model/voice/date/destination, pause/resume/retry and completed-file reveal. Closing pauses at the last durable phrase; reopening never resumes automatically. Temporary Windows checkpoint locks are retried atomically without removing the prior checkpoint. Completed history remains after temporary PCM/source cleanup. The short WAV tool remains non-resumable and its older files are not retroactively indexed.
- Everyday narration remains CPU Kokoro; offline GPU/CPU M4B export uses a separate portable Python/CUDA process and local FFmpeg. All23 English voices are shared by reader/export; Curated voices preserves the original8. No ElevenLabs integration remains. Qwen options/private model/environment were removed at the user's request. A separate full-precision official Chatterbox Turbo ONNX trial exists in ignored `.cache/chatterbox-trial`; it is not an app export engine. Obtain listening feedback before proposing integration.
- **Live data is `%USERPROFILE%\CadenceReaderData`**, explicitly approved to avoid MSIX-host AppData redirection. Original `%APPDATA%\Cadence`, Codex-private profiles and `.cache/recovery-20261106-184114` snapshots are retained. Never point tests/scripts at any live profile. Last normal-UI observation showed the existing Sky GPU conversion paused at45%,6h47m32s saved,14chapters; this is historical evidence, not permission to restart it or an assumption about its current progress.
- Latest validation: **124 unit tests in18files, production build and45 final staged GUI checks pass** (audiobook13, desktop17, resume8, listening7). Includes real offline synthesis, normal-close/forced-stop export recovery, unchanged PCM prefix, real Windows file-lock retry and original PDF/page/voice restoration. Details: `docs/EXPORT_MANAGER_2026-11-06.md`, `docs/RECOVERY_AND_CHATTERBOX_2026-11-06.md`; local evidence `test-results/export-manager/staged/manifest.json`. Repeat passed checks only for a new change/failure.
- Git contains source, locked Node dependencies, tests, setup/QA scripts and context. Personal books/profiles, models, runtimes, builds, audio and QA/recovery artifacts remain excluded. A source-only clone does not include the migration bundle's runnable app/model files. Use the retained fp32 model from the bundle when preparing a new source checkout; do not quantize or downgrade it.
- `npm test` and `npm run build` regenerate ignored `desktop/export-core.mjs` from `src/exportPlan.ts` using `scripts/build-export.mjs`. GPU setup is `scripts/setup-audiobook.ps1`; prepare this before the separate Chatterbox setup script because it supplies portable uv/Python. No global Node, Python or driver installation is needed on this configured PC.
- Existing Kokoro jobs fingerprint the narration pipeline. Preserve byte identity of `desktop/audiobook-python.py`, `desktop/speech-input.mjs`, `desktop/speech-voice.mjs`, generated export-core and runtime/model files when resuming them; even line-ending changes can affect the hash. Current identity is `dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04`. The tiny unreachable Qwen branch in the helper is retained solely for that compatibility; its model/runtime are gone. Do not remove it casually.

## User's purpose and established preferences

Build a desktop PDF/document reader centered on expressive text-to-speech. Local/offline neural voices are the user's chosen approach; ElevenLabs was removed. Natural phrasing, quick starts, seamless playback, exact-word starts, readable screen space and predictable navigation matter. Do not reintroduce fixed-length half-sentence blocks, long startup reserves, scrolling that follows audio against the user's wishes, or large permanent in-memory document/audio caches. Resumable audiobook exports deliberately keep temporary PCM on disk until completion.

## Working features to preserve

- React 19 + TypeScript + Vite UI in an Electron 38 desktop shell, named Cadence.
- PDF, DOCX, DRM-free EPUB2/3, TXT, Markdown and pasted-text imports; 50 MB per-file limit. Scanned PDFs need OCR first; legacy DOC and encrypted EPUB text are not supported.
- Kokoro-82M-v1.0-ONNX **fp32** CPU model, about326MB, with23 English voices and the original eight curated choices. Model files, tokenizer and licenses are in `release/win-unpacked/resources/models`. For source builds copy these into `.cache/models`. Separate GPU audiobook export reuses this same model.
- Phrase pipelining and a shared Web Audio clock. Quick start defaults to zero reserve, with roughly 20 seconds / at most 12 phrases prepared ahead. SoundTouch compensates pitch for playback speeds 0.65-1.75. Safe padding trimming preserves breaths/pauses inside sentences. No claim of token-streaming inference or reproducing ChatGPT Voice's private infrastructure.
- Display paragraphs are independent of model windows. Narration uses complete sentences, can join unfinished page-boundary sentences, and guards Kokoro's 512-token context limit instead of silently truncating. Very long sentences use clauses/words as a fallback. WAV export follows the same plan without the old artificial gap per display block.
- Click any word in Reading view or the original PDF to start at that exact word, not an estimated timestamp. Dragging selects text without playing.
- Reading and audio positions are independent. Follow audio is off by default and scrolling/page navigation turns it off. Go to audio is explicit.
- Reading view retains original PDF pages and labels. Virtualized sections keep page landmarks and mount words near the viewport plus explicit audio/jump targets. Original PDF reuses one PDF.js worker/document, cleans pages, and destroys the worker/canvas on close.
- Contents preserve parts/chapters/main topics and nested subsections; main topics are shown first, with disclosure arrows. Search preserves ancestors. Multiple headings on one page retain distinct targets. Original PDF jumps honor bookmark coordinates. No automatic sidebar scrolling; Locate is explicit. Page fallback remains available in groups of 40 with search.
- Structure detection prefers publisher bookmarks, then conservative heading/font clues or verified contents-page destinations. Bare Chapter 1, Roman/word chapter numbers, parts, Word heading styles and Markdown levels are supported. Opening material is grouped. Ambiguous PDFs retain pages.
- Regression examples: Poor Charlie's Almanack has four chapters with the eleven talks nested inside Chapter 4 (not eleven root chapters). Varian has 37 chapters and their subsections. These source books are not required to run the synthetic tests on the new PC.
- Menu opens the library toolbar as a temporary drawer, closed on launch. Document navigation and voice panels collapse independently. Compact header; original full-size bottom player automatically collapses after ten seconds and returns on input. Manual Hide ignores movement/scrolling until explicit interaction reveals it. F11 / Esc full screen has small side controls. Layout changes preserve reading position and narration.
- Last-book and browsing checkpoints survive full app restarts. Store page / paragraph / mode separately from audio position. At most 64 small checkpoints in `cadence-reader-session-v1`; never copy text/PDF/audio into this state. Original PDF resumes at the top of its saved page. Reading view resumes its paragraph. No autoplay. Close document and Library keep the last-book choice for restart; Delete removes the checkpoint.
- During opening/restoration, an explicit user action cancels automatic restoration. A delayed restore must never pull a new page jump back to an older page.

## Storage and memory design

`src/library.ts` stores summaries in IndexedDB `keyval-store/keyval`, key `cadence-library-index-v2`. Per-book text is `cadence-text:<id>`, PDF Blob is `cadence-file:<id>`. Only the selected book's text is loaded. Position/bookmark saves update small metadata. Legacy v1 library migrates atomically. Text version 2 repairs unfinished legacy blocks and remaps positions/bookmarks atomically. Navigation version 3 refreshes old flat indexes. Preserve these migrations.

Completed speech cache: 24 MB / 48-entry LRU, separate from bounded lookahead. Document switches/closes clear obsolete cached speech. Full neural model remains loaded for responsiveness. ONNX memory-pattern caching is disabled for varying phrase lengths; CPU memory arena remains enabled. Model memory is substantial; do not sacrifice voice quality merely to shrink the baseline.

Profile: `%USERPROFILE%\CadenceReaderData` by default, as approved on2026-11-06. `CADENCE_DATA_DIR` redirects test/development profiles; QA refuses to start without an explicit isolated folder. Normal window close asks the renderer to finish summary saves, then flushes browser storage, with a two-second fallback for a hung renderer. Export-worker shutdown pauses/commits current jobs. Single-instance lock focuses an existing reader rather than creating conflicting writers.

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
- `src/AudiobookExport.tsx`, `src/ExportJobs.tsx`, `src/useExportJobs.ts`: creation/comparison form and persistent export manager.
- `desktop/audiobook-jobs.mjs`, `desktop/audiobook-worker.mjs`, `desktop/audiobook-backend.mjs`, `desktop/audiobook-python.py`: durable export jobs, worker, separate native inference/encoding and compatibility-sensitive helper.
- `desktop/profile-path.cjs`: stable normal profile and explicit QA isolation.
- `migration/`: portable library, verification and restore tools, all with machine-independent paths.

## Build and verification

The original transfer includes a runnable application folder; the Git source checkout alone excludes that generated app and its models. The configured workspace is already restored in place: do not run restore again. The portable Node/npm runtime is under `tools/node`. Add that directory to the current shell PATH, run `npm.cmd ci` when preparing dependencies, `cmd /c "npm.cmd test 2>&1"` and `cmd /c "npm.cmd run build 2>&1"`. The lockfile pins the actual tested dependency graph; package.json ranges are not a reason to update dependencies.

`node scripts/package-update.mjs` prepares `release/staged-<version>/win-unpacked`. Wait for packaging exit code zero before launching a staged executable. `scripts/apply-desktop-update.ps1` validates workspace paths and retains the old build; on a new workspace with no current build, install/copy the staged app or use the already transferred `release/win-unpacked` first. Avoid relying on the single-file portable wrapper; folder packaging was the verified delivery method.

Current verification is the124unit/45staged checkpoint above; the original migration's63-unit baseline is historical. Original bundle verification remains in `migration/VALIDATION.json`; do not regenerate MIGRATION_BUNDLE.json for this edited workspace. GUI tests use `CADENCE_QA=1`, `CADENCE_QA_OFFLINE=1` and separate temporary `CADENCE_DATA_DIR` folders. Run GUI suites sequentially to bound memory.

Useful checks: `desktop-qa.mjs`, `resume-qa.mjs`, `structure-navigation-qa.mjs`, `reading-space-qa.mjs`, `header-qa.mjs`, `word-start-qa.mjs`, `memory-qa.mjs`. Optional real-book tests must be skipped or given an explicit fixture on a new device. Do not copy the old user's Downloads path into new source.

## Limits and references

ElevenLabs integration was removed; do not reintroduce a key/setup flow from historical migration instructions. For unusually slow CPUs, first inference, a word jump and very long sentences can still take time. No OCR or document classification cloud service has been introduced. Chatterbox is a separate short trial with quality/long-book testing still pending, not a replacement for Kokoro.

Primary references and license details are in README.md. Kokoro model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX . Kokoro.js: https://github.com/hexgrad/kokoro/tree/main/kokoro.js . Electron: https://www.electronjs.org/docs/latest/ . PDF.js: https://mozilla.github.io/pdf.js/ . Mammoth: https://github.com/mwilliamson/mammoth.js .

`migration/REFERENCE_UI.png` shows the established reading layout and hierarchical chapter navigation. `node scripts/structure-navigation-qa.mjs --synthetic-only` exercises navigation without any source-PC book path. The bundled npm is 10.9.3; use its adjacent Node 22.19.0 runtime instead of a global npm of a different version when reproducing this setup.
