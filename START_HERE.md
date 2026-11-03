# Move Cadence to your new Windows PC

This bundle is for Windows with an Intel/AMD 64-bit processor. It contains the working app, full source, the exact current voice model, Node/npm tools, saved books, bookmarks, and reading positions. You do not need to recreate the app from this chat.

## On the new device

1. Let the ZIP finish syncing through your own OneDrive. Download it completely and use **Extract all**. Do not run files from inside the ZIP.
2. Open the extracted folder in Codex and paste `CODEX_SETUP_PROMPT.txt`. Alternatively, double-click `MIGRATE-CADENCE.cmd`.
3. The restore copies the workspace to `%USERPROFILE%\CadenceReader` by default, restores the library, creates a desktop shortcut, and opens Cadence. It preserves existing destination books. If that folder already contains unrelated work, choose another destination instead of overwriting it.

The packaged app works without installing Node or npm dependencies. Preparing the source for development uses the included Node/npm runtime; `npm ci` needs internet access for dependencies. The full neural voice model is already in the bundle and does not need to be downloaded again.

## What transfers

- Source, configuration, locked dependency versions, tests and project context.
- Ready-to-run Cadence 1.0.12, all eight local voices, model/tokenizer files, and dependency licenses.
- Library text, imported original PDF files, bookmarks, audio positions, browsing checkpoints and saved preferences.
- The complete original DOCX/TXT file is not stored by Cadence; its extracted text transfers. The app's stored original PDFs transfer in full.

The ElevenLabs API key is deliberately excluded. Reconnect ElevenLabs in Settings on the new device. Windows encrypted credentials are tied to the original device/account. No browser cookies, credentials, old test profiles, logs, or obsolete builds are bundled.

## OneDrive usage

Use OneDrive to carry the ZIP and future backups. Keep the running app, working dependencies, and `%APPDATA%\Cadence` database local. This transfer does not implement live two-device library synchronization; reading on one PC will not automatically update the other PC's position. Keep the old installation until you have checked the new one.

## Manual or repeat restore

From PowerShell in the extracted folder:

```powershell
& .\migration\restore.ps1 -Destination (Join-Path $env:USERPROFILE 'CadenceReader') -PrepareBuild
```

Use `-NoLaunch -NoShortcut` for verification without opening a visible app. A test can supply `-ProfileDirectory` to isolate its library. Re-importing the same backup skips matching book IDs; it does not replace their newer destination positions or bookmarks.

`MIGRATION_BUNDLE.json` lists SHA-256 hashes of all transferred files. The restore verifies it before copying or importing. The ZIP's separate `.sha256` file also lets Codex check that the download matches the export. This is an integrity check, not a digital signature.
