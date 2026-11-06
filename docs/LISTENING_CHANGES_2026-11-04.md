**Listening and reader improvements — 4 November 2026**

Implemented the requested proposals 1, 2, 4 and 6, plus the five follow-up fixes, in the recommended order. The initial assessment remains in `LISTENING_REVIEW_2026-11-04.md` as a historical record.

**Reader and cancellation fixes**

- Voice previews use cancellable synthesis requests. Stop, voice/document changes and starting narration cancel the obsolete request; an already executing native inference finishes and its result is discarded.
- Explicit DOCX/EPUB paragraph semantics survive opening. Ordinary questions such as “Why did you leave?” remain paragraphs. PDF-only heading inference still refreshes older PDF headings.
- Go to audio clamps the centered passage to its own page boundary, so returning to audio page 500 also shows page 500. Short documents retain the explicitly selected section when the whole document fits on screen.
- Missing PDF page labels trigger metadata recovery even when the navigation version is current. A genuine empty label array does not cause repeated PDF reads.
- Normalization preserves spaced compound words such as `well- known` and `long- term`; soft-wrap repair still handles `specifi- cation`. Decimal currency amounts use plural units correctly.
- Heading/paragraph breaks inside a combined speech request are synthesized at their known source boundaries, then joined with breathing room. An earlier comma is no longer mistaken for the heading/body boundary. Renderer sentence plans and source word offsets remain intact.

**PDF cleanup**

New PDF imports use page geometry, font size, repeated margin text and page labels/numbers to remove confirmed running headers/footers. Actual page landmarks remain available. The original PDF is retained.

Previously saved PDFs retain their stored text, indices, bookmarks, audio positions and checkpoints. Their narration conservatively skips repeated edge passages and matching page numbers without rewriting stored segments; the first repeated title is retained when original geometry is unavailable. Ambiguous material is preserved. Original-PDF word mapping skips omitted short runs instead of consuming matching digits in body text; lookahead alignment uses bounded linear-size bookkeeping.

**Voice choices**

The default list remains eight curated voices and the default British filter remains two. In the Voice panel, choose **Extended voices** to show all 23 English voices. The existing voice preference stores an extended selection across restarts.

Open **Blend voices · experimental**, choose the first and second voice, set the first voice percentage, and press **Use blend**. Preview, listening and export share that selection. Blending interpolates the correct length-dependent style slices from existing bundled files. Pronunciation follows the first voice; 0% and 100% use the corresponding original voice. Style caching is limited to four additional voice buffers. No new voice/model download or paid service is used.

**WAV export**

Export converts each prepared clip directly into 16-bit PCM chunks and writes one WAV buffer, eliminating the whole-document Float32 merge. Live playback and export call the same sentence/paragraph/heading bounds helper. The Create audio file → Save WAV → saved-message flow, native 1× pace and two-hour limit remain.

At the limit, the two principal sample buffers are approximately 691 MB rather than the former 1.728 GB Float32-chunk/merge/WAV subtotal. These are calculated sample-buffer sizes; model memory, Blob creation and saving/IPC still add memory, so this is not a streaming export.

**EPUB import**

DRM-free EPUB 2/3 imports now read ZIP/container/package metadata, spine order, XHTML blocks, heading levels and hierarchical EPUB navigation or NCX contents. Nested blocks are extracted once. UTF-8 and UTF-16 text are supported, with section navigation rather than invented physical PDF pages. Book text and metadata use the existing library records; no database-version migration was introduced.

The parser uses browser primitives with no new application dependency. It checks archive structure, resource paths, CRC integrity, entry counts, cancellation and expansion bounds (20 MB per entry, 128 MB total, plus the existing 50 MB input limit). Book scripts and remote resources are not run or fetched. Font-only obfuscation does not prevent text extraction; encrypted book content, image-only content without OCR, unsupported ZIP formats and fixed-layout presentation are outside this text-import feature.

**Verification**

- 84/84 unit tests across 13 files pass; TypeScript/Vite build passes.
- Twelve existing source QA suites pass: desktop 17, resume 8, synthetic structure/navigation 11, word-start 7, paragraph 4, playback 5, browse 8, navigation 10, memory 9, reading-space 9, header 5, and the real latency benchmark. Navigation/memory were rerun after correcting stale fixture/mode/settling assumptions; all original behavior assertions remain.
- New `scripts/listening-qa.mjs`: seven end-to-end checks pass, including compressed EPUB extraction, extended and blended selection, stopped-preview cancellation, WAV export, PDF cleanup/word clicks, missing-label recovery and full restart persistence. Real offline speech is generated through the desktop bridge for extended voices and 0/65/100% blends.
- The completed staged package passes desktop 17, new listening 7, word-start 7 and resume 8 checks: 39 checks, all using isolated profiles.
- Live library, application dependencies, lockfile and fp32 model were preserved. No restore, commit or push was performed.

Evidence: `test-results/listening-implementation-2026-11-04/`, `test-results/listening-improvements/`, and the usual per-suite result JSON files. The source QA runner's initial failures are retained in its log; the final navigation and memory results are in `test-results/navigation-results.json` and `test-results/memory-qa-results.json`.

The user explicitly approved “Update and reopen Cadence”. The updater installed the tested package into the shortcut's `release/win-unpacked` target and retained the previous build at `release/previous-build-20261104-144342`. The installed ASAR SHA256 matches the tested package: `B7DA0B1E5051C1772B8B479D55D8315C775484FD4F83692CA4CB09643256B87E`.

The normal app window was verified after reopening: two library books, “The art of paying attention” restored at section 4, Michael selected, and playback paused. Continue opening Cadence with the existing Desktop shortcut or `Start Cadence.cmd`. The library stays local in `%APPDATA%\Cadence`; this remains a snapshot migration, with no OneDrive synchronization of the live database.
