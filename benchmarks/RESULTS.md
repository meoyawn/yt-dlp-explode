# Direct CLI benchmark — 2026-09-20

**The ≤2.276 s median target is met: 1.839 s.**
Both CLIs succeeded in **5/5** measured attempts on
[4Ff0xc9M8kA](https://www.youtube.com/watch?v=4Ff0xc9M8kA), downloading English
JSON3 subtitles. All normalized text hashes match (2,009 words). Tool caches
were warmed by one excluded invocation; captions were downloaded afresh each
time. No Node script, wrapper CLI, or alternate yt-dlp environment was used.

| CLI | Success | Median wall time | Range | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| yt-dlp-explode 0.1.1 Native AOT | 5/5 | 1.839 s | 1.654–5.860 s | 39.7 MiB |
| Local yt-dlp 2026.08.19 | 5/5 | 14.477 s | 9.200–18.239 s | 339.2 MiB |

The median ratio is **7.87×**. The native median is
19.2% below the requested limit. This is a measured
median, not a maximum-latency guarantee: the 5.860 s native
outlier remains included.

| Attempt | yt-dlp-explode seconds | yt-dlp seconds |
| --- | ---: | ---: |
| 1 | 1.839 | 18.239 |
| 2 | 2.093 | 10.937 |
| 3 | 5.860 | 9.200 |
| 4 | 1.738 | 14.477 |
| 5 | 1.654 | 15.118 |

## What changed

- Corrected the benchmark boundary: complete CLI subtitle downloads for both
  tools. The old 4.835 s measurement included the separate Node workflow and
  its extra caption connection; it was not comparable to the original 2.276 s
  native CLI measurement.
- Cached public, versioned player scripts using server freshness, checksums,
  bounded storage, and atomic writes. Warm pulls use three network requests;
  authenticated bootstrap metadata and captions remain fresh.
- Preferred HTTP/2 with HTTP/1.1 fallback, and opted into .NET 10's supported
  macOS TLS 1.3 backend. Profiling isolated long outliers in TLS setup. Network
  spikes remain possible; no extra caption retries were added.

[PROFILE.md](PROFILE.md) contains timings, evidence, diagnostic commands, and
all exploratory transport results. The [cache-only release trial](history/cache-only-results.json)
missed the target at 4.604 s and is preserved. The older
[script comparison](history/SCRIPT-RESULTS.md) is also retained.

## Environment and method

Apple M1 Pro, macOS 26.4 ARM64; .NET SDK 10.0.401, Native AOT Release.
Executable: 7,954,208 bytes (7.59 MiB).
YoutubeExplode dependency remains pinned to
[`dd8598c`](https://github.com/meoyawn/YoutubeExplode/commit/dd8598cabd87984e23a78f91bd99189240bccca3).

Baseline: `/Users/meoyawn/.local/bin/yt-dlp`, version 2026.08.19,
used as installed. The earlier 2026.07.04/curl_cffi installation aborted during
an exploratory direct download; the user's local install changed to 2026.08.19
before this comparison and all its measured attempts succeeded. No isolated
replacement was used. Both executables' versions and hashes were stable across
the final series.

Normal yt-dlp config discovery remained enabled, including the user's existing
`youtube:player_client=web_embedded` and cookie configuration. Both received
identical subtitle flags, a fresh output directory, an independent cookie-file
copy, and the same initially empty cache directory. Cookie copies were removed
after each run; the original jar was not modified.

The excluded cache-empty warmups took 5.399 s native and
12.824 s yt-dlp. The headline numbers describe subsequent
warm-cache pulls, not first use. Five measured runs alternated order with
two-second pauses outside timing. No builds or tests ran during the measurement.
Profiling was disabled. OS/DNS caches remained warm and the machine's existing
tunnel route remained active.

Wall time includes startup, config/cookie load, extraction, subtitle download
and file writing, cookie save, and exit. Build time, copying cookies, validation,
and pauses are excluded. RSS uses macOS `time -l` child resource accounting,
not summed concurrent process-tree memory.

[results.json](results.json) records every command, timing, executable hash,
output hash, and threshold outcome. Raw artifacts are in local ignored
`artifacts/benchmarks/direct-cli-final/`. See [reproduction instructions](README.md).

## Validation

116 offline config/cookie/subtitle/cache assertions and eight native executable
smoke checks passed. Live pulls matched the same transcript in every measured
attempt. The upstream library PR #970 remains open and unchanged; all CLI
optimizations live in this separate repository.

[Native AOT CI](https://github.com/meoyawn/yt-dlp-explode/actions/runs/35528400527)
passed on all five targets: macOS ARM64/x64, Linux ARM64/x64, and Windows x64.
Each built the native executable, ran compatibility and native smoke checks,
and packaged the executable and documentation.
