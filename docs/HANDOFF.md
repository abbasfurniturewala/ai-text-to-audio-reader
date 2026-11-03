# Cadence Reader – Handoff log

Shared memory between Antigravity and Codex. Read this before every task and update it after. Keep **Current state** and **Next steps** current. Add session entries at the top of the log (newest first). Do not delete earlier entries.

## Current state (as of 2026-11-03)

**Works**
- Packaged app `release/win-unpacked/Cadence.exe` (v1.0.12) has been updated with all latest changes (UI updates + PDF subheading separation + numbered-heading run-on fix + natural narration pause pacing) and launched. Previous packaged builds retained at `release/previous-build-20261103-190731`, `release/previous-build-20261103-234829`, and `release/previous-build-20261104-004841`. Live library: `%APPDATA%\Cadence`.
- `npm.cmd ci` installs cleanly (461 packages) with bundled Node 22.19.0 / npm 10.9.3.
- `npm.cmd test`: 10 files, **67/67 passing**.
- `npm.cmd run build` (tsc -b + vite build): **passes**.
- PDF subheadings (including numbered headings like `"2. Check the money on three real orders"`), bullet lists, and standalone page numbers (`src/paragraphs.ts`, `src/library.ts`, `src/speechPlan.ts`) are accurately segmented and never merged with the following body paragraph as a run-on sentence; natural narration pacing (`src/narration.ts`, `desktop/speech-input.mjs`) preserves distinct breathing pauses at commas/clauses, end of sentences (~520ms), end of paragraphs (~640ms), and headers/sub-headers (~740ms).
- `node scripts/desktop-qa.mjs` & `node scripts/desktop-qa.mjs --packaged`: **17/17 passing** (verified centered player controls, speed control in player bar, and removal of ElevenLabs UI/IPC).
- ElevenLabs integration completely removed from UI (`src/App.tsx`), types (`src/types.ts`), preload (`desktop/preload.cjs`), and main process (`desktop/main.cjs`); app uses local neural voices exclusively.
- Bottom player controls (`.playback-controls`) are centered across all window/panel modes via a symmetric 3-column grid on `.player-top`, with the narration speed slider + readout (`.player-speed`) placed directly beside the player controls instead of in the narrator sidebar.
- fp32 Kokoro model copied to `.cache/models` (needed for dev/packaging builds).
- Git initialized (branch `main`, remote `origin` → github.com/abbasfurniturewala/ai-text-to-audio-reader), repo-local identity configured (`abbasfurniturewala` / `furniturwewalaabbas@gmail.com`), initial commit created and pushed to `origin/main`.

**Known issues / risks**
- Another copy of the app exists at `C:\Users\Hasan\CadenceReader\release\win-unpacked\Cadence.exe` (created earlier by `MIGRATE-CADENCE.cmd`). The Desktop shortcut `Cadence Reader.lnk` has been repointed to this workspace's `release\win-unpacked\Cadence.exe`.
- No linter/formatter is configured. `tsc` is the only static check.
- `npm audit` reports 26 vulnerabilities (17 moderate, 7 high, 2 critical) in the locked tree. Not addressed: fixing them changes the lockfile and needs user approval.
- `migration/verify-bundle.mjs` / `restore.ps1` now fail in this folder because `AGENTS.md` was edited (expected; the user chose to work in place).
- Minor doc/config drift: README says `npm install` but AGENTS.md says `npm ci`; `package.json` `build.win.target` is `portable` while `npm run package` uses `--dir`. `scripts/desktop-qa.mjs` requires `jszip`, which is only a transitive dependency.
- `src/App.tsx` (~65 KB) and `src/styles.css` (~51 KB) are large single files. Do not split them unless asked.

**In progress**
- Nothing.

## Next steps (prioritized)

1. Run remaining GUI QA suites (`resume-qa.mjs`, `structure-navigation-qa.mjs --synthetic-only`) if needed.
2. Decide with the user whether to review `npm audit` findings (would change the lockfile).

## Session log

### 2026-11-04 – Antigravity (Numbered heading run-on fix & natural narration pause pacing)
- **Changes:**
  - Fixed numbered heading classification in `src/paragraphs.ts` (`isHeading`): stripped leading numbering/bullet/section prefixes (`"2. "`, `"1.2 "`, `"Chapter 1: "`) before checking for internal sentence breaks (`/[.!?]\s+\S/`) so numbered headings like `"2. Check the money on three real orders"` are recognized as `heading: true` instead of failing on `"2. C"`.
  - Updated `src/library.ts` (`loadDocumentText`, `openDocumentText`) to refresh `heading` flags on already-imported documents in IndexedDB (`%APPDATA%\Cadence`) so existing books immediately benefit without re-importing.
  - Hardened `src/speechPlan.ts` (`sentenceRanges`, `speechPlan`) so unpunctuated blocks on the same page are never concatenated into a run-on sentence (`"orders For three recent..."`) unless the next block starts with a lowercase continuation or crosses a page boundary.
  - Restored natural sentence, paragraph, and heading pauses in `src/narration.ts` (`speechBounds`, `BufferedNarrator.fill`): stopped trimming real speech clips down to 180ms total gap (60ms lead + 120ms tail), keeping ~520ms at sentence ends, ~640ms at paragraph ends, and ~740ms after headings/sub-headings while keeping 2-argument `speechBounds` unit test behavior intact.
  - Added `paceAudio` in `desktop/speech-input.mjs` to expand merged `\n\n` heading break valleys to ~580ms, gently pad internal punctuation pause valleys (+90ms up to 460ms), and guarantee >=680ms of trailing silence at the end of generated utterances.
  - Added regression tests in `tests/paragraphs.test.ts` and `tests/speechPlan.test.ts`.
- **Checks:** `npm.cmd test` (67/67 pass), `npm.cmd run build` (passes), packaged app updated.
- **Open issues:** None.

### 2026-11-04 – Antigravity (PDF extraction & Kokoro spoken text normalization)
- **Changes:**
  - Updated `src/paragraphs.ts` (`isHeading`, `isListItem`, `startsBlock`, `pdfParagraphs`): required Unicode letters (`\p{L}`) in `isHeading` (preventing standalone page numbers from being marked as headings), allowed up to 14 words (`< 120` chars) and trailing `?`/`:`, tracked `dominantFont` per line so bold subheadings after mixed-font paragraphs still trigger `fontBreak`, added `listBreak` for bulleted/numbered lists, and made `headingBreak` work both before and after standalone headings.
  - Updated `src/speechPlan.ts` and `desktop/speech-input.mjs` (`contextSplit`) to split oversized clauses on en-dashes (`–`) as well as em-dashes (`—`).
  - Added and exported `normalizeSpeechText` in `desktop/speech-input.mjs` (invoked in `generateComplete` right before `tts.generate`) to convert newlines to `. ` (since Kokoro's tokenizer strips `\n`), de-hyphenate line-wrapped words (`specifi- cation`), replace flow arrows (`→`) with `, `, expand `₹` and `€` currencies, normalize digit-range and parenthetical en-dashes (`–`), strip leading bullet glyphs, and append `.` to unpunctuated standalone headings/bullets.
  - Added unit tests in `tests/paragraphs.test.ts` and `tests/speech-input.test.js`.
- **Checks:** `npm.cmd test` (66/66 pass), `npm.cmd run build` (passes), `node scripts/package-update.mjs` + `scripts/apply-desktop-update.ps1` (applied and launched `release/win-unpacked/Cadence.exe`).
- **Open issues:** Note that existing PDFs already imported into IndexedDB cache their extracted segments in `cadence-text:<id>` (`TEXT_VERSION = 2`), so re-import an already-saved PDF if you want its subheadings/bullets re-extracted with the new `pdfParagraphs` rules.

### 2026-11-03 – Antigravity (PDF subheading breaks & heading narration pause)
- **Changes:**
  - Updated `pdfParagraphs` in `src/paragraphs.ts` to track uniform line `fontName` (`font`), lowered the height `fontBreak` threshold from `0.25` to `0.12` (or uniform font change on standalone headings), and added `headingBreak` so single-line unpunctuated subheadings that stop well short of the right margin (`previous.right < right - previous.height * 3`) break cleanly before a capitalized body paragraph without splitting multi-line paragraphs.
  - Updated `generateComplete` in `desktop/speech-input.mjs` to normalize unpunctuated paragraph/heading breaks (`/(?<![.!?:;…—–-])\n\n+/g` -> `'.\n\n'`) on a local copy of `text` before calling `tts.generate`, preserving `chunk.text` offsets in `src/speechPlan.ts`.
  - Added regression unit tests in `tests/paragraphs.test.ts` and `tests/speech-input.test.js`.
- **Checks:** `npm.cmd test` (65/65 pass), `npm.cmd run build` (passes), `node scripts/package-update.mjs` + `scripts/apply-desktop-update.ps1` (applied and launched `release/win-unpacked/Cadence.exe`).
- **Open issues:** Note that existing PDFs already imported into IndexedDB cache their extracted segments in `cadence-text:<id>` (`TEXT_VERSION = 2`), so re-import an already-saved PDF if you want its subheadings re-extracted with the new `pdfParagraphs` rules.

### 2026-11-03 – Antigravity (Packaged desktop app & Desktop shortcut update)
- **Changes:**
  - Ran `node scripts/package-update.mjs` and applied the staged build to `release/win-unpacked/Cadence.exe` (previous build backed up to `release/previous-build-20261103-190731`).
  - Repointed the Desktop shortcut `Cadence Reader.lnk` from `C:\Users\Hasan\CadenceReader\release\win-unpacked\Cadence.exe` to `C:\Users\Hasan\Documents\Cadence-1.0.12-Migration-2026-11-01-Windows-x64\release\win-unpacked\Cadence.exe`.
  - Closed the old running instance and launched the updated `release/win-unpacked/Cadence.exe`.
- **Checks:** `node scripts/desktop-qa.mjs --packaged` (17/17 pass); verified `release/win-unpacked/Cadence.exe` stays running and Desktop shortcut target is updated.
- **Open issues:** None.

### 2026-11-03 – Antigravity (UI & ElevenLabs removal)
- **Changes:**
  - Centered `.playback-controls` across all window/fullscreen/panel modes in `src/styles.css` and `src/App.tsx` using a symmetric 3-column grid (`.player-top` with `.player-track`, `.playback-controls`, `.player-extras`), removing the `370px` width clamp on `.now-playing` that previously pushed the controls to the left on wide screens.
  - Moved the narration speed slider and readout (`.player-speed`) from the right narrator sidebar (`.voice-panel`) into `.playback-controls` in the bottom player bar (`src/App.tsx`, `src/styles.css`).
  - Completely removed ElevenLabs integration and options from `src/App.tsx` (engine switcher, model selector, settings API-key section, status text), `src/usePlayer.ts`, `src/audio.ts`, `src/types.ts`, `desktop/preload.cjs`, `desktop/main.cjs`, and updated `scripts/desktop-qa.mjs`.
- **Checks:** `npm.cmd test` (63/63 pass), `npm.cmd run build` (passes), `node scripts/desktop-qa.mjs` (17/17 pass).
- **Open issues:** `release/win-unpacked/Cadence.exe` still holds the pre-change packaged build until `package-update.mjs` + `apply-desktop-update.ps1` are run.

### 2026-11-03 – Antigravity
- **Onboarding, no app code changed.** Read AGENTS.md, PROJECT_CONTEXT.md, START_HERE.md, README.md, configs and the source layout. Verified the bundle (2,488 files, 2 books) before any edits.
- **Environment:** installed PortableGit 2.56.0 to `%LOCALAPPDATA%\Programs\PortableGit` (the admin installer could not elevate) and added its `cmd` folder to the user PATH. Ran `git init -b main`, added remote `origin`, set repo-local `user.name`/`user.email`, created the initial commit, and pushed `main` to `origin`. Copied `release/win-unpacked/resources/models` → `.cache/models`. Ran `npm.cmd ci`.
- **Checks:** `npm.cmd test` 63/63 pass; `npm.cmd run build` passes. GUI QA not run.
- **Files:** `AGENTS.md`: added the handoff line at the top plus sections on workspace decision, stack, commands, folders, conventions and agent working rules. Original content kept verbatim. New file `docs/HANDOFF.md` (this log).
- **Open issues:** npm audit findings; GUI QA pending.
