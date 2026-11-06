# Slate reader UI changes — 4 November 2026

The user approved all ten recommendations in the UI review and changed the palette to **neutral slate with blue accents**. The implementation preserves Document view for all supported formats, original PDF rendering, exclusive Highlight/Underline cues, independent browsing/audio, exact-word starts, complete-sentence narration, bounded caches and restart checkpoints.

## Changes

1. Slate surfaces, dark ink, blue actions and focus states replace the green/white application palette. Important secondary labels have stronger contrast and larger text. Original PDF canvas colors are unchanged.
2. Library-title search and document search use separate state. Opening a book clears the document filter, including when reopening the same active book.
3. Restored passages and chapter/bookmark jumps leave room for the actual sticky page label. User input cancels pending positioning. Regression checks hit-test the first word, rather than accepting an obscured target.
4. **Bookmark viewed passage** saves the browsing target. The separate headphones action saves the audio position. Bookmark cards reveal their saved passage without starting narration or moving audio within the same book.
5. A mouse word start releases passage-button focus so Space pauses/resumes the selected suffix. Intentional keyboard activation of a focused passage still works.
6. Original PDF pages have real Fit width/50–200% zoom and literal, case-insensitive search, exact-character highlights and previous/next matches. At most 2,000 matches are retained. Full-screen controls include search and PDF zoom. Text font controls appear for reflowed text.
7. Removing a book offers **Undo** for ten seconds. Dismiss, a second removal or normal app close commits the pending removal. Undo retains the existing text/PDF records, bookmarks and reading checkpoint without copying large book contents. An unexpected process crash during the grace period can leave the retained book on the shelf; it does not permanently delete it. No database schema change was made.
8. Validated text size and serif/sans preferences persist across launches.
9. The voice choices and blend form share a scrollable panel body, with a reachable close button. Short windows and 125% renderer scaling retain essential controls and Settings. This is a renderer scaling stress check, not certification of all native Windows DPI settings.
10. Frequently used controls have larger hit areas and clearer labels. The full-screen rail is wider, and decorative header content is reduced. The paste dialog initially focuses its title field.

## Verification and delivery

- Unit tests: **90/90** in 14 files; TypeScript/Vite production build passes.
- The new 14-case UI suite passes on source, including real PDF zoom/word mapping, exact native search, full-screen search, repeated bookmark jumps, Undo/expiry/second removal/close, short panels and font persistence.
- Fifteen source suites pass **133 checks**. Nine final staged suites pass **88 checks**: new UI 14, compact header 5, desktop 17, Document view 10, speech cues 9, exact-word starts 7, restart 8, reading space 9 and memory/library lifetime 9. These include real offline narration and WAV export. The optional real-book fixture was absent; synthetic chapter/navigation fixtures passed.
- Final visual review covers the reader, library, settings/paste dialogs, PDF search and compact/full-screen layouts. The contrast probe sampled 215 text-style instances across four screens with no meaningful below-threshold text; the remaining low-contrast samples were decorative separator dots. **Go to audio** and **Follow audio** measure 5.56:1 at 11px. These are scoped checks, not a blanket accessibility certification.
- After explicit user approval, the prepared build was installed at `release/win-unpacked`. Installed ASAR matches the tested SHA256: `9780E34BE18A9BE30BFA89EE7DBE6D9AC06D639F511E21FB4F9FFEF2E494F9C4`. The previous build is retained at `release/previous-build-20261104-192602`.
- Normal reopened-window inspection confirms the existing four-book library, `war-peace` Document view on PDF/audio page 31, Fenrir, Underline, Fit width and paused/idle playback. Original PDF rendering remains visible. The agent only activated and inspected the window; no Play or live-reader control action was issued.
- The cache, staged and installed fp32 models have identical hashes and 325,532,232-byte size. No native runtime DLL issue appeared in the checks.
- Evidence: `test-results/ui-improvements/` contains the source/staged reports and screenshots, source regression summary, contrast results and model verification. Existing suite reports remain at their usual paths; some are overwritten by the final staged run.
- All QA libraries are isolated under `test-results/`; no script targets `%APPDATA%\Cadence`. No dependencies, lockfiles, configuration, stored-record versions or voice models were changed.
- Changes remain uncommitted. Suggested commit: `feat: refresh slate reader UI and fix navigation, PDF tools and removal recovery`.
