Before starting any task, read docs/HANDOFF.md. After finishing any task, update it.

# Cadence Reader project handoff

Read `PROJECT_CONTEXT.md`, `START_HERE.md`, and `README.md` before changing behavior.

- This is an existing Windows x64 Electron/React desktop application, not a new website. Preserve its current functionality and visual design unless the user requests a change.
- The migration bundle contains a runnable app in `release/win-unpacked`, source, a portable Node/npm runtime in `tools/node`, and a portable saved library in `migration/library`.
- When asked to restore this bundle, run `migration/restore.ps1` first. It verifies the transfer, preserves existing destination books and uses a local working folder outside OneDrive. The OneDrive ZIP is a transfer/backup, not a live synchronized app database.
- Use current machine paths and environment variables. No source-PC username or absolute Downloads path is required.
- For rebuilding, prepend `tools/node` to this shell's PATH, copy `release/win-unpacked/resources/models` into `.cache/models` if missing, run `tools/node/npm.cmd ci`, `npm.cmd test`, and `npm.cmd run build`. The existing fp32 model is already supplied; do not replace it with quantized weights or download another model unnecessarily.
- Keep browsing separate from narration, exact-word playback, paragraph/sentence boundaries, bounded caches, metadata-only saves, the 10-second player collapse, and restart checkpoints intact.
- Test GUI changes with the existing isolated Electron QA scripts. Keep test profiles separate from `%APPDATA%/Cadence`. Do not erase a library to make tests pass.
- The source repository had no commits at export time. The archive contains the complete source tree; there is no missing commit history.

## Workspace decision (2026-11-03)

- The user chose to work **in place** in this extracted folder (`Documents\Cadence-1.0.12-Migration-...`). No restore/copy to `%USERPROFILE%\CadenceReader`. Do not run `migration/restore.ps1` or `MIGRATE-CADENCE.cmd` unless the user asks.
- Because tracked files are now edited, `migration/verify-bundle.mjs` will report "File is incomplete or changed" and `restore.ps1` will refuse to run from here. That is expected. Do not regenerate `MIGRATION_BUNDLE.json` unless asked.
- Git was initialized here on 2026-11-03, branch `main`, remote `origin` = https://github.com/abbasfurniturewala/ai-text-to-audio-reader. Git is PortableGit at `%LOCALAPPDATA%\Programs\PortableGit\cmd` (on the user PATH for new shells).
- The user's live library is `%APPDATA%\Cadence` (IndexedDB). Never point tests or scripts at it.

## Tech stack

Electron 38 (main: `desktop/main.cjs`) + React 19 + TypeScript 5.9 (strict) + Vite 7; Vitest 3 unit tests; Playwright `_electron` GUI QA. PDF.js, Mammoth (DOCX), kokoro-js + onnxruntime-node (local Kokoro-82M fp32 voices in a worker thread), SoundTouch audio worklet, idb-keyval, lucide-react. Optional ElevenLabs via the main process. Node 22.19.0 / npm 10.9.3 bundled in `tools/node`.

## Commands (PowerShell, project root)

```powershell
$env:PATH = "$PWD\tools\node;$env:PATH"   # once per shell
npm.cmd ci                                # locked deps (needs internet); never `npm install`/`npm update` without asking
npm.cmd test                              # Vitest unit tests (63 as of 2026-11-03)
npm.cmd run build                         # tsc -b (type check) + vite build -> dist/
npm.cmd run desktop                       # dev: Vite server + Electron
npm.cmd run dev                           # browser preview only (no speech/key storage)
node scripts/desktop-qa.mjs               # GUI integration QA (isolated profile in test-results/)
node scripts/package-update.mjs           # stage packaged app -> release/staged-<version>/win-unpacked
```

- **Lint/format:** none configured (no ESLint/Prettier). `tsc -b` inside `npm run build` is the static check.
- npm writes warnings to stderr, so PowerShell may show exit code 1 on success. Use `cmd /c "npm.cmd test 2>&1"` to get the real exit code.
- Other GUI QA scripts: `resume-qa`, `structure-navigation-qa --synthetic-only`, `reading-space-qa`, `header-qa`, `word-start-qa`, `memory-qa`, `paragraph-qa`, `playback-qa`, `navigation-qa`, `browse-qa`. Run them one at a time. `--staged` targets the staged build, `--packaged` targets `release/win-unpacked`.
- The user runs the packaged app (`Start Cadence.cmd` -> `release/win-unpacked/Cadence.exe`). `npm run build` does **not** update it. Replacing it means `package-update.mjs` followed by `scripts/apply-desktop-update.ps1` (keeps the old build in `release/previous-build-*`). Ask before doing this.

## Folder structure

- `src/` – renderer (React). `App.tsx` is the main UI/state container; `use*.ts` are hooks; plain `.ts` modules hold logic (`speechPlan`, `narration`, `audio`, `structure`, `topics`, `locations`, `paragraphs`, `documents`, `library`, `readerSession`); `types.ts` holds shared types incl. the `window.cadence` bridge; `styles.css` is the single global stylesheet.
- `desktop/` – Electron main/preload (CommonJS `.cjs`) and speech worker (`.mjs`).
- `tests/` – Vitest unit tests (`*.test.ts|js`), importing from `../src`.
- `scripts/` – GUI QA, benchmarks, packaging and update helpers (`.mjs`/`.ps1`).
- `migration/` – transfer/restore tools; `migration/library/` holds the user's personal books (git-ignored, never commit).
- `build/` – app icon. Generated / ignored: `node_modules/`, `dist/`, `release/`, `.cache/models/`, `test-results/`, `tools/node/`.
- `docs/HANDOFF.md` – shared running log for Antigravity and Codex.

## Conventions and architecture

- Match the existing dense style: compact lines, several short statements per line, single quotes, semicolons, 2-space indent, named exports for modules, default export for components. Short descriptive names. Comments are rare and explain *why*.
- State: React `useState`/`useRef`/`useCallback` only (no state library). Preferences use `localStorage` keys prefixed `cadence-`. Library data uses IndexedDB through `src/library.ts` (summaries are separate from text and PDF blobs). Keep the versioned migrations (`cadence-library-index-v2`, text v2, navigation v3, `cadence-reader-session-v1`).
- Renderer has no Node access. Everything native goes through `desktop/preload.cjs` -> `ipcMain.handle` with `assertSender` and input validation in `main.cjs`. The ElevenLabs key stays in the main process (`safeStorage`).
- Styling: plain CSS classes in `src/styles.css`. Icons come from `lucide-react`.
- Tests: pure-logic tests in `tests/`; UI behavior is verified with Playwright QA scripts using `CADENCE_QA=1`, `CADENCE_QA_OFFLINE=1` and a temporary `CADENCE_DATA_DIR`.

## Working rules for AI agents (Antigravity and Codex)

- Start of every task: read `docs/HANDOFF.md`, run `git status`, and assume files changed since you last saw them. Read a file before editing it.
- Make focused, minimal changes. Do not refactor, rename, reformat or restructure unless asked.
- Match existing style and patterns. There is no linter/formatter, so copy the surrounding code.
- Ask before adding dependencies, changing architecture, changing stored-data schemas/migrations, or touching config/env/build files (`package.json`, lockfile, `tsconfig`, `vite`/`vitest` config, `.gitignore`, electron-builder config).
- Do not modify or delete tool-specific files/folders (`.codex/`, `.agents/`, `.gemini/`, editor settings) unless asked. Never delete content written by the user or another agent in `AGENTS.md`/`docs/HANDOFF.md`; add or correct it instead.
- After changes: run `npm.cmd test` and `npm.cmd run build` (plus relevant QA scripts for GUI changes) and report results honestly.
- End of every task: update `docs/HANDOFF.md` (current state, next steps, a newest-first session log entry) and suggest a commit message. Do not commit or push unless the user says so.
- Never write secrets, API keys or `.env` values into any file. Never commit `migration/library/` or anything from `%APPDATA%\Cadence`.
