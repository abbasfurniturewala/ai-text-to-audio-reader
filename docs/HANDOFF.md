# Cadence Reader – Handoff log

Shared memory between Antigravity and Codex. Read this before every task and update it after. Keep **Current state** and **Next steps** current. Add session entries at the top of the log (newest first). Do not delete earlier entries.

## Current state (as of 2026-11-03)

**Works**
- Packaged app `release/win-unpacked/Cadence.exe` (v1.0.12) runs on this PC, per the user. Live library: `%APPDATA%\Cadence`.
- `npm.cmd ci` installs cleanly (461 packages) with bundled Node 22.19.0 / npm 10.9.3.
- `npm.cmd test`: 10 files, **63/63 passing**.
- `npm.cmd run build` (tsc -b + vite build): **passes**. Only Vite's large-chunk size notices (expected, limit raised in `vite.config.ts`).
- fp32 Kokoro model copied to `.cache/models` (needed for dev/packaging builds).
- Git initialized (branch `main`, remote `origin` → github.com/abbasfurniturewala/ai-text-to-audio-reader), repo-local identity configured (`abbasfurniturewala` / `furniturwewalaabbas@gmail.com`), initial commit created and pushed to `origin/main`.

**Not yet verified on this PC**
- GUI QA scripts (`desktop-qa`, `resume-qa`, `structure-navigation-qa --synthetic-only`, …) have not been run here.
- Live ElevenLabs has never been tested with a real key (mock only, from the source PC).

**Known issues / risks**
- No linter/formatter is configured. `tsc` is the only static check.
- `npm audit` reports 26 vulnerabilities (17 moderate, 7 high, 2 critical) in the locked tree. Not addressed: fixing them changes the lockfile and needs user approval.
- `migration/verify-bundle.mjs` / `restore.ps1` now fail in this folder because `AGENTS.md` was edited (expected; the user chose to work in place).
- Minor doc/config drift: README says `npm install` but AGENTS.md says `npm ci`; `package.json` `build.win.target` is `portable` while `npm run package` uses `--dir`. `scripts/desktop-qa.mjs` requires `jszip`, which is only a transitive dependency.
- `src/App.tsx` (~65 KB) and `src/styles.css` (~51 KB) are large single files. Do not split them unless asked.

**In progress**
- Nothing.

## Next steps (prioritized)

1. Run GUI QA on this PC, one at a time: `node scripts/desktop-qa.mjs`, `node scripts/resume-qa.mjs`, `node scripts/structure-navigation-qa.mjs --synthetic-only`.
2. Decide with the user whether to review `npm audit` findings (would change the lockfile).
3. Optional: align README dev instructions (`npm ci`, bundled Node) with AGENTS.md.

## Session log

### 2026-11-03 – Antigravity
- **Onboarding, no app code changed.** Read AGENTS.md, PROJECT_CONTEXT.md, START_HERE.md, README.md, configs and the source layout. Verified the bundle (2,488 files, 2 books) before any edits.
- **Environment:** installed PortableGit 2.56.0 to `%LOCALAPPDATA%\Programs\PortableGit` (the admin installer could not elevate) and added its `cmd` folder to the user PATH. Ran `git init -b main`, added remote `origin`, set repo-local `user.name`/`user.email`, created the initial commit, and pushed `main` to `origin`. Copied `release/win-unpacked/resources/models` → `.cache/models`. Ran `npm.cmd ci`.
- **Checks:** `npm.cmd test` 63/63 pass; `npm.cmd run build` passes. GUI QA not run.
- **Files:** `AGENTS.md`: added the handoff line at the top plus sections on workspace decision, stack, commands, folders, conventions and agent working rules. Original content kept verbatim. New file `docs/HANDOFF.md` (this log).
- **Open issues:** npm audit findings; GUI QA pending.
