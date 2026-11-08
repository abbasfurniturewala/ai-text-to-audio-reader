# Chatterbox removal and disk cleanup – 2026-11-07

The user explicitly requested removal of both Chatterbox Turbo and Standard from the project/device to recover storage. Both model directories, their dedicated environment, setup/trial scripts and application integration have been removed. Kokoro CPU/GPU, all 23 English voices, the reader, resumable M4B manager, background compression and live ETA remain.

## Disk cleanup completed

Deleted only these verified, workspace-contained directories:

- `.cache/chatterbox-trial`: 9,752,565,521 logical bytes, 20,527 files, including Turbo's 3,322,691,905-byte model and separate environment.
- `.cache/chatterbox-standard`: 3,275,288,988 logical bytes, 31 files, including Standard's 3,275,281,396-byte model.

The directory total was **13.03 GB** in file lengths. Most of the 6.42 GB environment used hardlinks to the same CUDA/PyTorch files required by Kokoro. `fsutil hardlink list` confirmed the trial, Kokoro environment and local package cache share `torch_cuda.dll`; deleting a second name does not free that shared data. Those Kokoro files were intentionally retained.

The local package manager removed **2,802 files /73.1 MiB** of cached packages used only by Chatterbox. The cleanup compared the trial's resolved packages with Kokoro's `ort-resolved.txt`, protected every Kokoro package and scoped the offline command to `.cache/audiobook/uv-cache`. No global cache purge or dependency installation occurred.

Windows reported **6,744,215,552 additional free bytes**, about **6.74 GB /6.28 GiB**, during cleanup. This is the measured cleanup delta, before subsequent build/QA output. Both model directories are absent after testing. No matching external Hugging Face Chatterbox model directory was found in the checked standard cache locations.

Five reference WAVs (6,933,108 bytes) were copied to ignored `.cache/retained-voice-references-20261107-201106` before deleting the trial folder. Original recordings, personal books, live profiles, completed audiobooks, recovery snapshots and prior app backups were not removed. Trial-generated comparison/cache audio inside the deleted trial folder was removed with it.

Cleanup verified absolute paths stayed inside this workspace, rejected redirected/linked deletion trees and checked that no trial Python process was running. Only native PowerShell file operations were used for recursive deletion. Auditable inventory/result/script copies are in ignored `test-results/chatterbox-removal/final/` (originals `.cache/chatterbox-removal/`).

## Application changes

- Removed both model choices, custom-reference voice controls, reference-file IPC/preload/types, worker capability detection, backend reference generation/normalization and Chatterbox inference/fingerprinting.
- Deleted `desktop/audiobook-chatterbox.py` and the four dedicated setup/trial scripts. No Chatterbox helper is present in the new archive or its unpacked resources. The supplied Kokoro helper remains byte-identical; its older unreachable Qwen branch is retained solely for existing Kokoro fingerprint compatibility.
- New requests support only `kokoro-cuda` and `kokoro-cpu`; custom-reference requests and removed engines are rejected. Existing completed history can still reveal its file. Legacy unfinished removed-model jobs retain their saved audio/history, show **Model removed** and have resume disabled. They are never silently resumed with Kokoro. No stored schema or migration changed.
- Updated README/current context. Earlier Chatterbox reports and handoff entries are historical; their old setup instructions no longer apply. All other prior Antigravity/Codex changes remain intact.

## Validation and delivery

- **137/137 unit tests in 20 files**; production type check/build passed. Added removed-model history/prefix preservation coverage and adjusted request validation tests.
- **9/9 source manager checks** and **39/39 packaged checks**: manager/ETA/legacy history 9, complete real audiobook suite 13, desktop 17.
- CPU/GPU Kokoro passage comparisons generated real, playable offline audio after cleanup. EPUB M4B completion, PDF reading plus narration during export, durable pause/resume, unchanged PCM/compressed prefixes, normal-close/forced-stop recovery, all23voices, original PDF/DOCX/TXT import, bookmarks, WAV export and compact layout passed. No renderer errors, unintended narration or external text/audio requests.
- Tests used explicit isolated profiles under `test-results/`. No test/script accessed either live library location.
- Original fp32 model SHA256 **8FBEA51EA711F2AF382E88C833D9E288C6DC82CE5E98421EA61C058CE21A34CB**, helper **494C6518F3CC95339E3F5D20D35875082C61B8E7AADC9A01B57F553013981044**, and Kokoro export identity **dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04** are unchanged. Existing saved Kokoro jobs retain their identity.

The user approved **Update and reopen Cadence**. Exact tested ASAR **3AE0FBC72A8420F952031E78EB47C6A76AACA95857EE72428B0A46AE52D743C8** is now installed at `release/win-unpacked`. Backup `release/previous-build-20261107-203705` retains **C28C2434CEEDC10E735BF91EFEB12A030A41BD1B3F7266CE507F330E85C3A953**. The guarded updater checked workspace-contained paths, closed matching app processes and reopened with QA/dev/data/Node overrides cleared. Installed/backup/original fp32 hashes were verified. Deleted model directories remain absent; the app backup did not restore them.

Normal Windows UI confirms **4 books /1bookmark**, The Hobbit restored in Reading view at section1of46/audio passage1, Echo/Highlight/Follow off and **READY WHEN YOU ARE /Play**. Export history has **1unfinished /2completed**. The existing Hobbit Echo/GPU Kokoro export is **Paused3%,18m40s saved,6chapters,17m24s compressed and saved**, with Resume available. Both completed audiobooks remain. Opened New export only to inspect the model dropdown: exactly **Kokoro · NVIDIA GPU · faster** and **Kokoro · CPU**, with no reference controls. Closed it without choosing a model, comparison, narration, Resume or new export. Left the manager visible with audio/conversions paused. No test/script targeted live data, and the exact installed artifact retains the137unit/build/9source/39staged results above; no repeated suites. Final manifest/installation JSON and handoff/context updated. No commit/push.

Suggested commit: `chore: remove Chatterbox engines and model setup`.
