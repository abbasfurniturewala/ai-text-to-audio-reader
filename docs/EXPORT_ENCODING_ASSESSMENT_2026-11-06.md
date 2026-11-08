# Audiobook encoding performance assessment – 2026-11-06

## Recommendation

Keep chaptered M4B as the default. First assess a bounded background encoder that compresses already-generated narration while GPU synthesis continues, with durable completed sections and a final stream-copy assembly. Preserve the current AAC quality settings initially. This moves work out of the finishing tail rather than pretending the work disappears. One low-priority encoder is the starting point; additional workers should depend on measured backlog and reader responsiveness.

This is a proposal, not an implemented architecture change. The user asked for an assessment. No application, profile, job schema, dependency, model, packaged build or format default was changed. Existing Antigravity and finishing-fix source changes remain intact. The live library/export profile was never accessed. No audio was played.

## Local method and evidence

- AMD Ryzen 7 3700X, 8 physical/16 logical cores; existing RTX 2070 SUPER. Bundled FFmpeg 9.0 LGPL build; no installation/download or runtime replacement.
- Read only the retained isolated recovery snapshot, not the live job. Copied three 100-second PCM windows starting at 600, 27,000 and 53,000 seconds into a new independent 300-second fixture. PCM is s16le, 24 kHz, mono. Synthetic chapter metadata marks those three windows; no personal book text is included here.
- All single-encoder candidates ran twice, sequentially, reversing order for the second round. Timings include process startup, encoding and muxer closure; probing/decoding are outside those individual times. Every output passed a complete silent decode; all encoded sample outputs except FLAC expose three chapters to FFprobe. This verifies readable audio, not perceptual quality or third-party player compatibility.
- Independent 2-/4-worker AAC chunks were throughput experiments only. They were not assembled, seam-checked or integrated into pause/resume. Their speedup is not an end-to-end guarantee.
- Artifacts/scripts remain ignored in `.cache/encoding-assessment-20261106180526/`, `.cache/encoding-assessment.mjs` and `.cache/remux-assessment.mjs`. Pointer: `.cache/latest-encoding-assessment.txt`. Detailed results: `results.json`, `parallel.json`, `full-book-remux.json` in that artifact directory.

## Measured results

| Candidate | Mean time for 5 minutes | Speed vs current | Important qualification |
| --- | ---: | ---: | --- |
| Current AAC twoloop, requested 96 kbps | 6.44 s | 1.00x | Existing quality/sample rate; actual audio bitrate 93.49 kbps on this fixture |
| Same AAC with threads=8 | 6.33 s | 1.02x | Noise-sized change; decoded audio hashes match default; installed encoder reports no threading |
| AAC fast, requested 96 kbps | 1.45 s | 4.45x | Different encoder decisions; actual 108.81 kbps, file 16% larger on this fixture; no blind quality comparison |
| LAME MP3 96 kbps, algorithm quality 2 | 1.66 s | 3.88x | Same nominal bitrate is not evidence of equal quality across codecs |
| LAME MP3 128 kbps, algorithm quality 2 | 1.74 s | 3.70x | Sample file 36% larger than current AAC; no blind quality comparison |
| Windows AAC at 24 kHz, requested 96 kbps | 1.11 s | Excluded | Actual output only 32.00 kbps; not a valid quality-preserving comparison |
| Windows AAC at 48 kHz, requested 96 kbps | 1.28 s | 5.04x | Actual 96.00 kbps; requires resampling, different codec implementation and duration/priming/quality checks |
| FLAC level 5 | 0.195 s | 33.12x | Decoded PCM exactly equals input; sample file 80% larger than current AAC, no chapters exposed by this command |
| Opus 96 kbps | 1.14 s | 5.64x | Different codec/player ecosystem; no blind quality or audiobook-player compatibility comparison |
| Two independent current-AAC workers | 3.51 s | 1.84x | One throughput run; excludes correct assembly, validation and recovery |
| Four independent current-AAC workers | 1.96 s | 3.29x | One throughput run; higher CPU contention and the same assembly limitations |

Do not mistake the Windows 24 kHz success exit code for equivalent output. FFprobe identified AAC-LC/24 kHz/mono but only 32 kbps, despite the requested 96 kbps. The 48 kHz run honored 96 kbps. Microsoft's documented input rates are 44.1/48 kHz. Upsampling does not restore information absent from Kokoro's 24 kHz source. Default and fast AAC decoded exactly 300 seconds; Windows candidates decoded 300.032 and 300.010667 seconds respectively after conversion back to 24 kHz. These small differences require priming/boundary investigation before segmented use.

### Full-book container assembly

Separately remuxed the already-complete, isolated 14h59m25s AAC file, with all 23 chapters, using `-c:a copy -movflags +faststart -f mp4`. This took **27.728 seconds**, produced **635,943,441 bytes**, retained all chapters/duration and had an identical compressed-audio SHA256 before/after (`a237faecdfcd420f6dbcfa90814d11d143c0f15e47b399bef27e991469f2462f`). This measures packaging of an existing complete stream, not joining independently encoded chunks. It proves the M4B wrapper itself does not require the existing 20-minute compression pass.

The prior complete real-book encoding/index/check/hash measurement was **1,218.317 seconds (20m18s)**. Its separate full silent decode took 16.803 seconds. No repeat full-book lossy encoding was needed for this assessment.

## Estimates for a similar 15-hour book

These are short-fixture ratios anchored to the known 20m18s full-book result, rounded with a margin. They are **not measured full-book candidate runs**. Changing content, concurrent narration, storage/thermal load or codec settings changes the result. They refer to final file work, not speech generation or total export time.

| Approach | Rough final file-stage time | Quality/recovery tradeoff |
| --- | --- | --- |
| Current path | 20m18s measured | Current known AAC settings; incomplete final compression restarts |
| Four independent current-AAC workers | About 6–8 min | Same codec/settings, but joins/priming/chapter alignment must be made correct; more simultaneous CPU work |
| Fast AAC M4B | About 4–6 min | Fast local candidate; no promise of equal perceptual quality; size/bitrate behavior differs |
| Windows AAC M4B at 48 kHz | About 4–6 min | Fast local candidate; resampling, encoder-quality and timing validation needed; no GPU claim |
| MP3 at 128 kbps | About 5–7 min | Fast and broadly playable; larger file here; chapter/quality/player checks required |
| Current-quality AAC encoded during synthesis | Target roughly 1–2 min after speech ends | Design target, not measured; most encoding happens earlier; final assembly/checks and small backlog remain |

The background target is plausible because the current full-book compressor handles about 44 seconds of audio per second and can likely keep up with narration generation in this workload. Actual simultaneous GPU synthesis/CPU encoding/reader performance has not been tested. It does not make Kokoro generate speech faster or guarantee zero extra load. A persistent continuous encoder or a correctly trimmed section design must resolve AAC encoder delay and padding; naive concatenation is insufficient.

## Implementation order if approved

1. Prototype one bounded, low-priority background AAC encoder using existing quality/sample-rate settings and saved PCM as the recovery source. Persist completed compressed sections/validated checkpoints; encode only missing work after restart. Keep legacy jobs/resume identities compatible. This may require an approved job-format/architecture extension.
2. Prove exact content coverage, sample duration, gapless boundaries and chapter positions; test normal close, forced process termination, pause during encoding/assembly, incomplete files, insufficient disk and safe publication. Run a long export while reading/scrolling/narrating to measure contention and load-time effects. Retain raw PCM until completed output validates; use disk-backed bounded buffers.
3. Add 2–4 workers only if a backlog warrants them and responsiveness permits. Do not simply request more FFmpeg threads: this AAC encoder is single-threaded. Each independent encoder consumes an additional core and introduces a boundary to handle.
4. Compare current AAC against fast AAC and Windows AAC in blind listening on varied voices, sibilants, quiet passages and pauses. Check real audiobook players, long duration/chapter alignment and rates. Offer a faster setting only if the result justifies its quality/compatibility tradeoffs. Neither duration checks nor waveform comparison prove perceptual equivalence.
5. Offer optional MP3 (single file with chapter tags, or chapter files) for compatibility, while retaining M4B as the default. Generate alternate formats from retained PCM when available, avoiding an unnecessary AAC→MP3 lossy transcode.

## Format and GPU conclusions

- M4B is an audiobook-oriented MPEG-4 container convention; this app puts AAC audio plus chapters/metadata inside it. Changing only `.m4b` to `.m4a`/`.mp4` does not change the encoder's work or improve sound. M4B's practical benefit is one book file with chapters and audiobook-oriented player treatment. Bookmarks/resume are player features, also possible with MP3; artwork/metadata are not unique to M4B.
- MP3 is a different audio coding format. It supports ID3 CHAP/CTOC chapter tags, but a destination player must implement them. Chapter files offer another compatibility path. The local LAME encoder is much faster than the current native AAC here, not proof that every MP3 implementation or setting is faster. The tested 128 kbps MP3 would project to about 864 MB for this duration versus the actual 636 MB M4B; quality equivalence remains untested.
- FLAC is a good lossless/archive alternative, very fast here and bit-exact against original PCM, but larger and less suitable as the default chaptered-audiobook delivery choice for this application. Opus is another fast candidate; no broad audiobook-player interoperability conclusion was established by this assessment.
- The current setup has no supported GPU AAC/MP3 export path. NVIDIA NVENC provides video encoders (H.264/HEVC/AV1), not an AAC/MP3 encoder. Keep GPU resources for speech generation; a custom GPU audio compressor is a much larger project than overlapping a CPU encoder already fast enough to keep up. Windows Media Foundation AAC is a separate local codec candidate, not evidence of GPU audio encoding.

## Primary sources consulted

- [NVIDIA Video Codec SDK](https://developer.nvidia.com/video-codec-sdk): NVENC video codec scope.
- [Microsoft AAC encoder](https://learn.microsoft.com/en-us/windows/win32/medfound/aac-encoder): documented PCM rates, AAC-LC and supported output bitrates.
- [FFmpeg MOV/MP4 formats](https://www.ffmpeg.org/ffmpeg-formats.html#MOV_002fMPEG_002d4_002fISOMBFF-muxers): chapter tracks, faststart second pass and fragmentation/interruption compatibility tradeoff.
- [FFmpeg codecs](https://www.ffmpeg.org/ffmpeg-codecs.html#libmp3lame): LAME algorithm-quality/speed option. Online documentation is for a moving version; installed encoder help and measured behavior are authoritative for this bundled 9.0 binary (including its default twoloop).
- [ID3 chapter specification](https://id3.org/id3v2-chapters-1.0): CHAP and CTOC frames; MP3 is not inherently chapterless.
- [BookPlayer's own FAQ](https://github.com/TortugaPower/BookPlayer/wiki/FAQ): MP3 support, M4B recommendation, chapters/artwork and player-managed book/volume bookmarks.
- [Library of Congress format description](https://wwws.loc.gov/preservation/digital/formats/fdd/fdd000110.shtml): related AAC/MP4 audio extensions including M4B. Its historical Apple-only compatibility wording is not used as a current compatibility claim.
