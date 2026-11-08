# Pasted-text reader – 2026-11-07

The user requested narration of pasted plain text without importing a document. **Menu → Text reader** now opens a focused paste box with an optional title. **Read aloud** saves the text locally, opens it and starts narration from its beginning. **Add to my library** opens it paused. An empty title becomes **Pasted text**.

The existing NOTE document format and reader handle saved text. All 23 English voices, speed, exact-word starts, Reading/Document views, Highlight/Underline, bookmarks, reading-position restoration and audiobook export remain available. A restart restores the last text with narration paused. Closing the dialog retains the unsaved draft during the current session; it is not a crash-persistent draft store. Saved text remains in the local library until the user removes it.

The read request is tied to the new text's ID and waits for that document to load. Another document selection or app shutdown prevents the pending start. Saving disables repeat submissions; a failure leaves the draft and an inline error visible without starting narration. Existing shelf-plus and library paste links use the same dialog. No dependency, stored-data schema, model or narration/export pipeline change was needed.

## Validation

- Unit suite: **129/129 in 19 files**; production type check/build passed.
- New isolated source QA: **9/9**, with real offline CPU narration, exact-word starts, direct Read aloud, bookmarks, injected local-save failure, full restart and a short GPU Kokoro M4B export.
- Packaged candidate: **43/43** checks: Text reader 9, desktop 17, resume 8 and word-start 9. Existing PDF rendering, DOCX/TXT import, voice filtering, WAV export, Unicode glyph offsets, independent browsing/audio and paused restoration passed. Text-reader tests made no external text/audio requests and reported no renderer errors.
- The dialog was visually reviewed at 1000 × 700; its fields and both actions fit. The existing slate/blue styling is retained.
- An early QA assertion incorrectly required every paragraph to have its optional interactive wrapper immediately; bounded reader mounting legitimately uses plain text for other paragraphs. The assertion now checks passage text independently of that optimization. A missing accessible textarea name on reopening a draft was fixed with an explicit label. The first packaging attempt lacked bundled npm on PATH; packaging was retried with `tools/node` prepended before packaged QA. No dependency or runtime downgrade was used.

All profiles/output were isolated under `test-results/`. No test or script accessed either live library location. Evidence and copied final reports: `test-results/text-reader/final/manifest.json`.

## Delivery

The user approved **Update and reopen Cadence**. The exact tested candidate is now installed at `release/win-unpacked`, ASAR SHA256 **2E7188672E4802E63EDB684A36E1CFAEEF79F0197EFCC36E959D7DBCA9BCEA24**. Backup `release/previous-build-20261107-125114` retains **2CD62A32171E8D913B0968F14270CE7FE9383225C0831A5937570A2E6AD2E8B4**. The updater checked workspace-contained paths and reopened with QA/dev/data overrides cleared; installed/backup/model/helper/compression hashes were verified. No additional build or repeated QA was needed for this identical artifact.

Normal Windows UI confirms the existing **2 books /1bookmark**, Poor Charlie Document view at browsing page7/audio page64, Puck voice, Highlight and Follow off. The player says **READY WHEN YOU ARE /Play narration**. Audio exports retains **0unfinished /1completed**, Sky/GPU Kokoro/100%/14h59m25s/23chapters. No narration, conversion, preview or new library item was started. The Menu contains Text reader. A Windows Security firewall prompt for Node.js appeared above Cadence before the final dialog inspection; the user was asked to handle it personally and no security action was automated. A later observation showed the prompt was no longer visible. Menu → Text reader was then opened normally; the empty paste box is focused and blank-input actions are disabled. Left ready for the user without pasting/saving or playing anything. The new dialog also passed source/staged QA.

Original fp32 model SHA256 **8FBEA51EA711F2AF382E88C833D9E288C6DC82CE5E98421EA61C058CE21A34CB**, Kokoro export identity **dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04**, helper **494C6518…** and background compression module **71CA06BD…** are unchanged. The packaged helper, compression and speech modules match source bytes. Prior Chatterbox/background-export work, personal data and backups are preserved. No commit/push.

Suggested commit: `feat: add a discoverable paste-and-read text reader`.
