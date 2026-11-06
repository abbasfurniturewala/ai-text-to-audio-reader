# Library/export recovery and separate Chatterbox trial

## Confirmed cause of the missing shelf and job

Windows redirected Cadence's AppData when it was launched from the MSIX-packaged Codex host. A desktop launch saw a different library. Setting the APPDATA environment variable during the previous update did not bypass this redirection. The earlier handoff's statements that this guaranteed the normal profile were incorrect.

The populated profile was found under `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Cadence`. Its originals were retained, copied to `.cache/recovery-20261106-184114/codex-profile-snapshot`, then recovered to the user-approved `C:\Users\Hasan\CadenceReaderData`. No existing destination was replaced. Tests inspect separate copies, never the live recovered database.

The recovered shelf has two entries: the welcome note and Poor Charlie's Almanack, with one bookmark. The PDF blob renders correctly. Normal UI shows Document view, browsing page 59/618 and separate audio page 62, Heart, 1x, Highlight and Follow unchecked. Narration remains idle. This verifies the recovered profile; it does not establish that historical books removed from this profile should be reimported.

The GPU Kokoro/Sky export retains 567 completed phrases, 104,697,302 samples at 24kHz (1h12m42s), seven chapter markers and 209,394,604 bytes of PCM: about 8% through the plan. Its original Downloads M4B destination is retained. The UI shows Resume export; production generation has not been restarted.

A separate copy of that actual export was resumed, forcibly terminated after committing phrase 568, reopened, and paused after phrase 570. Its entire original audio prefix is unchanged. Original and recovered jobs remain at phrase 567. Evidence: `.cache/recovery-20261106-184114/resume-validation.json`.

The app now sets its normal profile explicitly to `%USERPROFILE%\CadenceReaderData` before acquiring its single-instance lock. QA requires an explicit isolated CADENCE_DATA_DIR. Start Cadence.cmd clears development/test overrides for normal use. No IndexedDB schema, library migration, speech source indices or restart format changes were needed.

The reason the running process stopped is not proven. No matching Windows Application Error record was found. The timing is consistent with its Codex parent updating, but this is not evidence of a GPU/native crash. The confirmed defect is the split profile, which made durable data appear absent. Abrupt termination can still require resuming an export and regenerating its unfinished phrase.

Microsoft documents this redirection and merged AppData view in [MSIX AppData behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes#appdata-operations-on-windows-10-version-1903-and-later). OneDrive is not synchronizing the live Cadence database; the migration bundle remains a snapshot.

## Qwen removal

Qwen was removed from renderer choices, bridge types, export validation, backend/runtime capabilities, setup and benchmark paths. Deleted its private model/environment, Qwen-only dependency lock/setup files, generated samples and Qwen-only package-cache entries. Old build backups, historical reports and original profiles are retained.

Deleted directories had 9.024GB of logical file sizes, but shared CUDA/Torch files were hard links. Measured free-space gain for those directories was 2.487GB; cleaning 57 Qwen-only cached packages removed a further 468.3MiB. Thus approximately 3GB was reclaimed, not 15GB. The original 15GB figure was the allowance for the whole GPU/export setup. Shared files required by Kokoro and the approved Chatterbox trial remain. The new Chatterbox model itself occupies 3.323GB.

The byte-identical Python synthesis helper retains an unreachable legacy Qwen branch solely because existing Kokoro jobs fingerprint that file. The public/backend validators reject Qwen, its environment/model are gone, and no Qwen code is loaded for Kokoro. Keeping those helper bytes preserves the interrupted job's exact pipeline identity `dab25b70815439c6aa92aa53ee501538f6a8a5c3d9dba06a162f6e5450427a04`.

## Chatterbox trial, separate from Cadence

User approved a separate offline trial before integration. Uses the [official Resemble AI Turbo ONNX model](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX), revision `d21799bd0354adb85e348b8a0442a8405110a2cf`, full-precision weights, 14 verified files / 3,322,690,260 bytes. The environment is isolated in `.cache/chatterbox-trial`; existing Kokoro/Node dependencies and model are unchanged. No global runtime, driver or cloud service was installed.

Reference is eight seconds of locally generated Kokoro Heart, not a person's recording. Both samples speak the same original test passage:

> The first light reached the window before the town began to stir. Across the square, a shopkeeper opened the shutters and placed a small wooden chair beside the door.

Measurements on this RTX 2070 SUPER:

| Measurement | GPU Kokoro Heart | Chatterbox Turbo ONNX fp32 |
|---|---:|---:|
| Produced audio | 10.28s | 8.80s |
| First generation, excluding loading | 1.61s | 6.02s |
| Repeat Kokoro generation | 0.64s | Not measured |
| Model/conditioning initialization | 6.13s | 14.82s, split across components |
| First sample including initialization | 7.74s | 20.83s |

This is a short sample, not a whole-book throughput or pronunciation-quality guarantee. Both WAVs are finite/non-silent. Chatterbox reached its speech-end token; word-for-word content and long-book consistency have not been certified. Its sample has a different speaking duration, so compare generation per audio second as well as elapsed time.

The first attempt silently retried the decoder on CPU after a cuDNN convolution failure. That result is superseded. The trial now disables automatic CPU retry and uses documented CUDA convolution algorithm/padding options. Encoder, language model and decoder sessions then completed with CUDA; the cheap token-embedding lookup and some shape/control operations still use CPU. No weights were quantized. See [ONNX Runtime CUDA options](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#convolution-input-padding). Published graphs were used without an added postprocessing watermark; watermark behavior was not tested.

Listen to `.cache/chatterbox-trial/chatterbox-turbo-fp32.wav` and `kokoro-heart-matched.wav`. Reports: `trial-result.json`, `kokoro-result.json`, `verified-model.json`. Chatterbox has not been added to Cadence's export list. Consider a longer quality trial only if the user prefers this sample; GPU Kokoro remains the faster measured option.

## Validation and prepared desktop build

- 123/123 unit tests in 18 files; TypeScript/production build pass.
- Final staged GUI: 34 checks pass across desktop (17), restart/session restoration (8), export (9). Includes real offline WAV/M4B, GPU/CPU comparisons without Qwen, PDF scrolling/narration during GPU export, safe output handling, pause/reopen/resume and retained PCM prefix. No renderer errors or external book/audio requests.
- Separate actual recovered-job copy passes forced-termination/resume validation described above.
- Trial scripts compile; benchmark JavaScript syntax and Git whitespace checks pass.
- Staged ASAR: `E6FD4853C3C075227CFF24D7A633CD675AA6849CA7535AD9366BAE9D2876D1F8`.
- Helper: `494C6518F3CC95339E3F5D20D35875082C61B8E7AADC9A01B57F553013981044`; original fp32 Kokoro: `8FBEA51EA711F2AF382E88C833D9E288C6DC82CE5E98421EA61C058CE21A34CB`.

At preparation time the installed ASAR is still `4E1E3AD7...`; it was temporarily reopened with the approved explicit recovered-folder override. Final replacement confirmation is required before installing the stable-default/Qwen-free package. Retain the old build, reopen paused and verify through normal UI after installation. No commit or push.

## Installed delivery

The user subsequently approved replacement. Installed ASAR now matches the tested `E6FD4853...`; `release/previous-build-20261106-190852` retains `4E1E3AD7...`. Helper and original fp32 hashes remain unchanged. Normal launch used no QA/dev/data-folder override. Observed the recovered original PDF/page, 2 shelf entries, 1 bookmark and idle narration, then opened Audio exports and verified the saved Sky job at 8% / 1h12m42s / 7 chapters with Resume export available. Left that dialog open, without starting production generation. The normal Desktop shortcut now uses the stable local folder by default. Removed obsolete Qwen runtime path strings. No commit or push.
