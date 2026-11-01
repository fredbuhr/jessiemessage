# 128 MiB original streaming — current backend milestone

Supersedes the 32 MiB transport described in `backend-implementation.md`; that file and its logs remain historical.

The authenticated `/prepare` request is now passed as a Readable to `service.prepareStream`. The HTTP handler validates canonical declared length (<=134217728 bytes) and optional `X-Image-Format` before admission. The hint is only an enum (`dng`, `nef`, `arw`, `cr2`, `cr3`, `raf`, `rw2`, `orf`, `pef`, `srw`); no filename/path is transmitted.

`createImagePreparer` forks a dedicated one-job child with stdin. The parent counts original bytes, forwards each socket Buffer directly via `stdin.write`, pauses on backpressure and resumes on drain. It never concatenates, clones or IPC-serializes the original. Known length allocates the exact target only inside the child. Chunked originals accumulate only inside the child before a bounded concat. No plaintext temporary file is used.

Body deadline is 120 s. At EOF, exact length/nonempty validation precedes a separate 30 s conversion timer. Declared/measured over-cap returns 413, body deadline408, malformed/aborted input400, child/decode failures503. Kill, listener cleanup, stdout/stderr suppression, result validation and a single preparation place remain active until child exit. Global per-account admission and SQL rate budgets remain before the body; final current-session authorization still precedes returning JPEG. Binary output shares existing eight-response/15s guard. Asset10MiB input, original asset queue and video300s timeout are unchanged.

HEIC currently routes only through root's pinned `decodeHeicOriginal` libheif1.23.7 adapter; returned bounded RGBA goes through the common Sharp raw/rotation/flatten/sRGB/JPEG/thumbnail pipeline. Sharp HeifBuffer stays blocked. JPEG/PNG/WebP/TIFF/GIF/APNG continue through explicit native loaders. BMP/JXL/RAW extra module is connected and its new real-stdin test passes; RAW large-image memory bound is still being finalized by its owner. AVIF alternative probes are documented in `avif-alternatives.md`; safe codec remains under root arbitration; it is not enabled through Sharp/libheif1.23.5.

Evidence (all synthetic, no host/SQL/customer account/real upload):
- `backend-stream-first.log`:100 tests,100 pass,0 failures (new streaming lifecycle + updated HTTP/service).
- `backend-stream-http-cancel.log`:2 new tests,2 pass (declared length/status and real-child open-body cancellation).
- `backend-stream-mp4.log`:1 new test,1 pass (real MP4 is MEDIA_FORMAT without media-store/storage work).
- `backend-stream-source-validation.log`:1 targeted updated test,1 pass (already ended/destroyed/aborted source, malformed API).
- `backend-raw-hints.log`:2 new tests,2 pass (enum and configuration forwarding).
- `backend-stream-extra-final.log`: 1 new test, 1 pass (BMP/JXL/LibRaw DNG to common JPEG, incorrect TIFF hint fallback). Original failed fixture expectation retained in `backend-stream-extra.log`.
- `backend-stream-heic.log`:1 new test,1 pass (standard and rotated HEIC in actual stdin child with96MiB V8 heap).

Memory experiment: `stream-memory.mjs`/`stream-memory-worker.mjs` wrap the real worker for resourceUsage reporting only, with 75 MiB original size (valid synthetic JPEG or PNG plus synthetic trailing padding). No original-sized allocation occurs in the parent. `stream-memory.json` contains full measurements:

| Source | Parent peak RSS KiB | Worker peak RSS KiB | Elapsed ms |
|---|---:|---:|---:|
| jpeg-known | 43416 | 170376 | 230 |
| jpeg-chunked | 43100 | 201184 | 214 |
| png-known | 44608 | 351572 | 823 |
| png-chunked | 43844 | 383440 | 806 |

The PNG source is 48 MP interlaced. These successful synthetic measurements confirm the parent transport behavior, not a worst-case RAW/HEIC/WASM memory guarantee. One global heavy preparation and the 64 MP/native codec guards remain necessary.

The first instrumentation attempts failed because `process.memoryUsage()` requires `/proc`, absent in this executor (`ENOENT uv_resident_set_memory`). Those failures are retained in `stream-memory-first-failed.json` and `stream-memory-second-failed.json`; only the probe was corrected to use `process.resourceUsage().maxRSS`. No production transport failure was established by those attempts.

Current hashes (extra codec integration still pending):
- `server/media/http.mjs`: `419f2838d34835050a23bcfb9bec8f747dccd99d390b98fc0a57842f01a9eeec`
- `server/media/image.mjs`: `4275422b6fa971edcd5de26eef994d630b5072705a99e462127b66fc31ae5826`
- `server/media/image-worker.mjs`: `02636929780806508d359ff456e8c86cc69f28a8a440edc288d225dbba49e9c9`
- `server/media/service.mjs`: `330533b17ab4b92673637f5311e74e16354b7f6781d2437a5057c15c807fa8a5`
- `tests/media-preparation-stream.test.mjs`: `985cf2c8b0b735f5d47f713d40b21f9096c7a7b7e4eb6fe540b986df3725073d`
- `tests/media-http.test.mjs`: `49d301bf11371cfea04f8a785a8a80bd5cd45554b9f23397ff8f0e05fcdf2107`
- `tests/media-service.test.mjs`: `d7ad7b06e9ab93f2f53baa7d985ba4fe35c5883ec6f45c7fc84257dea6f2cc1b`
