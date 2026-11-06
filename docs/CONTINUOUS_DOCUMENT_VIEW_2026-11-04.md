# Continuous Document view — 4 November 2026

PDF Document view now scrolls vertically through original pages. The page indicator, page list and Contents browsing marker follow the viewport. Browsing never moves narration. Blank pages, different page sizes, original rendering, exact-word starts, drag selection, zoom/search and exclusive Highlight/Underline cues are retained.

**Go to audio** reveals the current spoken sentence/phrase once, including while paused. **Follow audio** moves with the existing narration checkpoints within and across pages when enabled. It stays opt-in; scrolling or page navigation turns it off. Full screen has the same Follow audio choice. For a sentence spanning pages, Go to audio uses the part on the indicated audio page, so the two page indicators agree. This does not add individual word timestamps.

EPUB, DOCX, TXT, Markdown and pasted notes retain continuous sections in Document view. Their existing Go to audio/Follow audio controls share the same behavior. Source QA explicitly verifies a non-PDF document following across a section boundary.

The PDF viewer reuses one PDF.js document/worker and mounts at most eight nearby canvas/text layers. Other pages keep lightweight placeholders and numeric aspect ratios. Evicted pages cancel rendering and release canvas stores, text layers, mapped highlights and page resources. The renderer is memoized to avoid rebuilding a large page list on each audio-clock tick. No page-image cache, new dependency, voice-model change, library schema change or migration is introduced.

Navigation remains available above the pages in a sticky bar, including Listen from this page. Explicit navigation cancels stale layout anchors, so waking the collapsed player cannot undo a jump. Typed page numbers are protected from background browsing updates. Restart keeps the existing compact, page-only PDF checkpoint and reanchors to the top of that page after rendering, with no autoplay. User input cancels pending restoration.

## Verification and delivery

- 90/90 unit tests in 14 files and the TypeScript/Vite production build pass.
- Fourteen source GUI suites pass 135 checks, including real offline speech/WAV export, independent browsing/audio, paragraph/word starts, highlights, hierarchy, search/zoom, bookmarks/Undo, all input formats, full-screen/compact controls, complete restarts and memory lifetime.
- New `scripts/continuous-pdf-qa.mjs` passes 13 source cases: vertical wheel navigation, exact-word/Space, paused Go to audio, following across a page boundary, manual cancellation, search/zoom, a 200-page rendering bound/one worker, full-screen following, idle-player jump priority/restarts, mixed page sizes/blank pages, cleanup and non-PDF section following.
- Existing tests now inspect the current page's canvas/ranges and actual visible destinations. They retain the original behavioral assertions while replacing single-page assumptions such as global `scrollTop === 0`.
- Nine final staged suites pass **93 checks**: continuous PDF 13, structure/navigation 11, restart 8, highlighting 9, memory 9, reading space 9, Document view 10, exact-word starts 7 and desktop 17. These include real offline narration and WAV export. The optional real-book fixture is absent; synthetic navigation fixtures passed.
- After explicit user approval, the tested build was installed at `release/win-unpacked` and reopened. Installed ASAR matches `8DC5F7FBF6BCAC9191AD3EE6C4DA8028FE1B506E1A7D38FD8992B6A811919128`. Previous build retained at `release/previous-build-20261104-202446`.
- Normal-window inspection confirms original adjacent pages in continuous Document view with Fenrir, Underline and Fit width. The initial accessibility observation showed paused/idle playback; by the later screenshot it was active. The agent issued no Play or reader-control action and left the active controls alone.
- Cache, staged and installed fp32 models have identical hashes. No native runtime DLL issue appeared. Visual review confirms continuous original pages, the sticky navigation bar and slate controls; staged evidence is `test-results/continuous-pdf/staged-continuous-pages.png`.
- All profiles/fixtures are isolated under `test-results/`; no script targets `%APPDATA%\Cadence`. Evidence is under `test-results/continuous-pdf/`, with the existing suite reports in their usual locations.
- Suggested commit: `feat: add continuous PDF scrolling and sentence following`.
