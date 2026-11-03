# Cadence Reader

A Windows document reader built around natural, private text-to-speech. Eight free Kokoro neural voices run on your CPU. ElevenLabs is an optional integration, using your own API key.

## Open the reader

Double-click `Start Cadence.cmd` in this project folder, or `release/win-unpacked/Cadence.exe`. This is a self-contained Windows x64 application folder; keep `Cadence.exe` and the other files in `win-unpacked` together. No Node.js installation is required to run the packaged app. The voice model and voice files are included, so local narration works offline from the first launch. The app stores its library and settings in the Windows user's application data, independently of the application folder.

If there is no packaged build, `Start Cadence.cmd` launches the installed Electron runtime and the existing `dist` build.

## Reading and listening

- Import PDF, DOCX, TXT or Markdown files, or paste text into a new document. Drop multiple files anywhere in the app to import them together.
- Choose Heart, Bella, Nicole, Sarah, Michael, Fenrir, Emma or George. Preview a voice before you listen. The local voices support English with American and British accents.
- Play, pause, skip passages, jump 15 seconds, and adjust playback speed from 0.65× to 1.75× with pitch compensation. Quick start plays the first prepared phrase while upcoming speech generates in the background. Clips share one continuous Web Audio clock.
- Click any word in Reading view or the original PDF to begin at that exact word. The selected suffix is synthesized directly; playback does not estimate a word timestamp. Dragging still selects text. Keyboard activation of a passage starts at its beginning.
- Browse freely during narration: scrolling and original PDF page navigation do not change the audio or pull the view back. **Go to audio** returns to the spoken passage or page. **Follow audio** optionally keeps narration in view; scrolling or changing PDF pages turns following off again. Following is off when opening a document.
- **Navigate** opens a document sidebar with page previews, filtering, a browsing highlight and a separate headphones marker for audio position. Reading view preserves original PDF page boundaries, including pages without selectable text. The page jump box and previous/next buttons browse without moving audio. PDFs with embedded page labels show those labels alongside physical PDF page numbers. Switching between Reading view and Original PDF keeps the browsed page. Existing library PDFs gain embedded labels when opened; reimport is unnecessary.
- **Navigate → Contents** preserves the book's hierarchy: parts, chapters and main topics appear first, with subsections behind expand arrows. Opening material is grouped separately. Expanding a branch never moves the reader or audio. Search keeps matching subsections under their parent; the location breadcrumb and explicit locate button help you return to your current chapter without the sidebar scrolling by itself. Browsing and audio have independent markers. Expanded branches are remembered per document.
- PDF bookmarks provide the preferred structure, including named and bare chapter labels. When bookmarks are absent, the app uses chapter labels and font hierarchy, suppressing repeated running headers and contents-page duplicates. Printed contents entries are used only with verified text or page-label destinations; uncertain documents retain page navigation. Reading-view jumps target the heading paragraph when matched, and Original PDF jumps honor the bookmark's position within the page. Multiple headings on one page remain separate. **Pages** is always available, with groups of 40 previews and search across the whole document. Existing saved books rebuild their index on opening without reimport; the refresh button rebuilds it again on demand. This runs locally, with no AI service or document upload.
- The panel icon at the top left independently hides or restores the library toolbar. **Navigate** and the contents panel's close button hide or restore document navigation. Both visibility choices persist across launches. Hiding the panels returns their width to the reader; the original PDF expands to use more of that space.
- Word heading styles and Markdown heading levels retain their hierarchy in Contents. TXT and pasted documents use detected chapter labels or headings. Section navigation remains available, falling back to groups of passages. These formats can reflow and their extracted text does not retain reliable original page boundaries, so the reader does not assign original page numbers to them.
- Follow the passage highlight, search the text, change the typeface or text size, and bookmark passages. PDFs also have an original-page view with page navigation.
- Your library, original PDF, bookmarks and passage position are saved locally in IndexedDB. File imports are limited to 50 MB each.
- Restarting Cadence reopens the last successfully opened book at its browsed PDF page or text paragraph, including Reading view / Original PDF mode. Browsing and audio checkpoints remain separate; narration does not start automatically. Each book keeps a compact location, with at most 64 recent checkpoints in one small local-storage record. No document text, PDF bytes, page images or audio are copied into that record. Original PDF resumes at the top of the saved page; Reading view restores its paragraph. Closing a document or visiting the library keeps the last-book choice for the next launch. Removing a book removes its checkpoint too. Books without a saved browsing checkpoint initially open near their existing audio position.
- **Close document** (× beside the title) stops audio and releases the open reader while keeping the book on your shelf. The trash button beside the title, on the shelf, or on a library card removes the stored document and its bookmarks; the original file on your computer is unchanged. **Cancel import** stops the current import and remaining queued files; documents already added stay on the shelf.
- Export the whole document or the remaining passages to a mono, 24 kHz, 16-bit WAV file. Export uses the voice's native pace (1×), preserving its pitch and quality. Generation can be cancelled; any already-running passage is allowed to finish. Export is limited to two hours of generated audio per file to bound memory usage.
- A sleep timer stops narration after 5, 15, 30 or 60 minutes. Space plays/pauses; arrow keys skip 15 seconds when a form control is not focused.

Reading times, progress and seeking are estimated from the text; highlighting follows passages rather than individual words. PDF narration follows extracted text order, which can differ from visual order in complex multi-column layouts. Scanned PDFs need OCR first. Legacy `.doc`, encrypted PDFs requiring a password, and EPUB files are not supported in this version.

## Reading space and full screen

While reading, the title and document details share a compact top bar. The separate title banner and decorative caption are removed. Long titles stay on one line with the full title available on hover. Reading tools occupy a short row; page navigation and audio-follow controls share another row that wraps on narrow windows. Library and bookmark views retain their own headings. `node scripts/header-qa.mjs` checks long titles, control access, compact-window layout and full-screen behavior; `--baseline` records the current installed build for comparison.

The Voice button in the top bar shows or hides the narrator panel; the panel also has its own close button. Its visibility is remembered. The bottom player uses its original full-size layout, including the waveform, playback controls, progress, sleep timer and export.

Choose Full screen in the top bar, or press F11 while reading. The desktop window fills the screen, the document uses the available space, and a small side strip provides playback, 15-second skips, current page and page stepping, navigation, voice selection, speed, PDF/reading view switching, bookmarks and a return-to-audio button. Voice and navigation panels open as temporary drawers. Esc, F11 or the side-strip exit button restores the normal layout and panel preferences.

In both normal and full-screen reading, the player collapses after 10 seconds without mouse, touch or keyboard activity. Moving the mouse anywhere in the app brings it back. Collapse frees reading space in the normal view; in full screen the player overlays the document without moving it. Keyboard users can Tab to the small Playback handle and then into the player controls. It stays open during keyboard use or while holding a control. Narration and its prepared audio queue continue through layout changes. Original page numbers remain visible in Reading view.

`node scripts/reading-space-qa.mjs` checks panel persistence, both reading views, reading position, uninterrupted playback, hover and keyboard access, full-screen shortcuts, restoration and compact-window layout. Pass `--staged` to check the prepared desktop release.

`node scripts/structure-navigation-qa.mjs --staged` checks hierarchical bookmarks, exact same-page heading jumps in both views, novel chapters without bookmarks, Markdown/Word heading levels, page groups, old-index migration, independent audio/browsing, saved expansion, and compact layouts. It also checks the source Poor Charlie book when present in Downloads. `book-topic-check.mjs` accepts PDF paths for a structure-only check, with regression assertions for the Munger and Varian books.

`node scripts/resume-qa.mjs --staged` closes and relaunches the actual desktop process against one isolated test library. It checks book/page/paragraph restoration, immediate close after a jump, original-PDF mode, separate audio and browsing positions, pending bookmark writes, multiple books, Close document, the library view, blank pages, deletion and small checkpoint storage. On normal exit the desktop waits for pending summary saves and flushes browser storage, with a timeout for an unresponsive renderer. A second launch focuses the existing instance instead of opening competing library writers.

## Memory and document lifetime

The shelf stores compact summaries, with text and original PDF files in separate IndexedDB records. Only the selected document's text is loaded; original PDF bytes are read only for original-page viewing or a one-time navigation metadata upgrade. Position and bookmark saves update summaries without cloning any book contents. Existing libraries migrate in one atomic transaction. An empty library remains empty after restart.

Reading view keeps page landmarks but mounts words only near the viewport, plus explicit navigation and audio targets. Measured placeholders preserve scroll positions. Original PDF view reuses one PDF.js document across page turns, cleans completed page resources, and destroys its worker and canvas when closed. Completed speech clips have a 24 MB / 48-entry LRU ceiling, independent of the rolling playback queue; changing or closing documents drops the previous document's cache. Voice previews release object URLs when stopped.

The full-precision voice model stays loaded to keep playback responsive. ONNX memory-pattern caching is disabled for varying phrase shapes; the CPU memory arena, thread pool, voice quality, and playback lookahead remain enabled. The engine still has a substantial baseline memory cost, and import/rendering can briefly increase memory before runtime garbage collection releases temporary allocations.

`node scripts/memory-qa.mjs` checks migration, bounded page rendering, navigation/playback, metadata-only saving, document switching/removal, import cancellation and PDF worker lifetime. `node scripts/memory-profile.mjs "path-to-book.pdf"` measures process working sets through import, playback, repeated imports and close; pass `--staged` for a staged release. `model-memory-benchmark.mjs` compares ONNX allocation settings against the same phrases.

## Smooth playback

Settings → Smooth playback defaults to **Quick start**, which schedules the first phrase immediately when ready. Optional 3- or 8-second audio reserves remain available for slower computers. The previous 12–60-second startup setting is migrated to Quick start. A rolling queue prepares about 20 seconds ahead, with at most 12 phrases in memory.

The local engine loads in parallel with the app window. Opening a document prepares its first three speech units for the selected local voice, without playing them. Narration now uses complete sentences instead of fixed 110/180-character fragments. Shared in-flight requests, raw PCM playback, and cancellation of obsolete queued work reduce startup and word-jump delays. Natural punctuation and short headings are preserved. The full-precision Kokoro model uses a bounded CPU thread pool; on the development computer it outperformed the smaller dynamically quantized model, without changing voices. The bundled model is about 326 MB.

Reading-view paragraphs have no speech-length cap. PDF extraction uses measured line spacing with a rounding tolerance, plus paragraph gaps, short completed lines, indentation and font changes. Opening an older book conservatively joins unfinished blocks on the same page and atomically remaps saved passage positions and bookmarks; it does not need to load the original PDF. Complete sentences from older imports remain separate display blocks when their original paragraph layout is unknown. Narration can join an unfinished sentence across a page boundary while retaining exact word-click mappings.

The worker checks actual phoneme tokens before inference, disabling Kokoro's silent truncation at its 512-token context limit. Exceptionally long sentences are subdivided at clauses when possible, or at words when there is no suitable clause, and joined with conservative padding trimming. An unusually long first sentence can take longer to synthesize; the reader does not wait for an entire paragraph or book. WAV export uses the same sentence plan without the old extra 180ms silence per display block. `paragraph-qa.mjs` checks old-book repair, marker preservation, exact-word playback and long-paragraph export; `paragraph-voice-check.mjs` checks the captured source-page fixture and actual local speech.

Audio is decoded before it is needed. Each clip is scheduled at the preceding clip's exact end time, and passage highlighting follows the audio clock. Pausing freezes that clock; changing speed reschedules ready clips and uses SoundTouch pitch compensation. Long, near-silent padding at clip edges is trimmed conservatively, retaining breathing room and pauses within sentences.

If sustained generation is slower than the listening speed, buffering can still occur. First launch, an uncached word jump, and heavy CPU load can take longer. Native inference already in progress cannot be interrupted; its result is discarded after cancellation and the latest interactive request runs before queued background work. For a full pre-render, use Export audio. ElevenLabs look-ahead preparation consumes API credits, including prepared phrases you skip; cloud audio is never generated merely by opening a document.

This is phrase-level pipelining: Kokoro returns each phrase after inference completes. It is not a token-streaming speech model and does not reproduce ChatGPT Voice's private infrastructure. OpenAI's public [speech API](https://developers.openai.com/api/docs/guides/text-to-speech) streams audio before a full file is generated, while its [Realtime API](https://developers.openai.com/api/docs/guides/realtime-conversations) supports native speech-to-speech. Those hosted systems and this offline CPU model have different latency limits.

## Optional ElevenLabs

Open Settings and enter a key with Voices read and Text to Speech permissions. Cadence validates the key, fetches the account's voices, and encrypts the key using Electron `safeStorage` and Windows protection. The renderer cannot retrieve the stored key. Disconnect removes the saved key.

Select the ElevenLabs engine in the narrator panel. Multilingual v2 is the default for long-form narration; Eleven v3 is available for expressive delivery. Flash v2.5 and Turbo v2.5 offer faster response options. Your account's credits and provider limits apply. Only phrases requested for narration are sent to ElevenLabs; importing and reading documents stays local. Voice previews also use credits.

Kokoro is its own open-weight neural speech model, with its own sound and capabilities. It does not reproduce ElevenLabs' proprietary model or all of its emotional controls. The optional ElevenLabs connection uses the actual provider API. Live ElevenLabs calls need a real key and were not exercised during the initial build; the integration is kept separate from the tested local narration path.

## Development

Requires Node.js 22 or newer, npm, and Windows x64 for the desktop build.

```powershell
npm install
npm run desktop
```

`npm run dev` serves a browser preview of the interface. Neural speech and secure API-key storage require the desktop app.

```powershell
npm test
npm run build
npm run test:integration
node scripts/voice-check.mjs
npm run package
```

`voice-check.mjs` downloads the roughly 326 MB full-precision Kokoro model to `.cache/models`, generates eight real voice samples and checks their WAV headers. Run it before packaging; `electron-builder` bundles that model directory along with the application, excluding the old quantized model. The model and runtime use native CPU inference inside a worker thread, keeping the interface responsive.

`npm run package` creates the self-contained application folder. An optional `npm run package:portable` command creates a single-file portable wrapper; the initial wrapper build stalled after compression, so the delivered, verified build is the application folder.

The integration suite launches an isolated, hidden Electron instance with a fresh library. It tests voice selection, real neural playback, WAV generation and saving, PDF rendering, DOCX/TXT imports, bookmarks, search and persistence. Test fixtures, screenshots, voice samples and reports are written to `test-results/`. To run against the unpacked release, set `CADENCE_QA_EXECUTABLE` to the absolute path of `release/win-unpacked/Cadence.exe`.

## Sources and licenses

- [Kokoro.js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js) and [Kokoro ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX): Apache 2.0. The packaged model's license is included beside the model files.
- [ElevenLabs speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) and [voice listing API](https://elevenlabs.io/docs/api-reference/voices/search).
- PDF rendering and extraction use PDF.js; DOCX text extraction uses Mammoth. Their notices and licenses are retained in packaged dependencies.
- [SoundTouchJS audio worklet](https://github.com/cutterbl/SoundTouchJS/tree/master/packages/audio-worklet) provides pitch compensation and is licensed under MPL-2.0; its original source is unmodified and included in the dependency distribution.
