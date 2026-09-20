# Native AOT CLI benchmark — 2026-09-20

These measurements were captured before the CLI moved to this standalone
repository. The CLI source and pinned library are unchanged. The recorded
commands and binary hash in `results.json` identify that original build;
reproduction commands below use the current repository layout.

The final personal CLI and the existing yt-dlp script both retrieved the English
transcript for [4Ff0xc9M8kA](https://www.youtube.com/watch?v=4Ff0xc9M8kA) in
**5/5 measured attempts**. All transcripts matched after removing script
timestamps and normalizing whitespace.

| Variant | Successful pulls | Median wall time | Range | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| YoutubeExplode Native AOT CLI, cookies | **5/5** | **2.276 s** | 2.099–7.160 s | **34.3 MiB** |
| Existing yt-dlp transcript script, cookies | **5/5** | **16.332 s** | 11.136–18.981 s | 338.0 MiB |

The ratio of median wall times is **7.18×**. Peak RSS is macOS
`/usr/bin/time -l`'s maximum resident set size, not the sum of concurrent
process-tree memory. The AOT process peaked at 34.7 MiB across the five attempts.
The CLI uses workstation GC, compressed HTTP responses, and buffered incremental
text output; the library still buffers responses and parsed captions.

| Measured attempt | AOT seconds | yt-dlp script seconds |
| --- | ---: | ---: |
| 1 | 2.149 | 16.332 |
| 2 | 2.276 | 13.899 |
| 3 | 7.160 | 11.136 |
| 4 | 5.641 | 18.981 |
| 5 | 2.099 | 17.759 |

The slower AOT attempts spent their additional time in manifest discovery.
Every attempt still made exactly **four HTTP requests**, with no retries:

1. Embedded-player page/configuration.
2. Current player script, to read its signature timestamp without executing it.
3. Embedded-player API response containing the caption manifest.
4. Caption download.

The one-entry timestamp cache was empty in each new process. Reusing a client
skips the script request while the player URL stays the same; inline timestamps
also avoid it. A separate experiment removed the timestamp from a working
yt-dlp request and reproduced `UNPLAYABLE / Video unavailable`, so it is not
omitted or guessed.

## Scope and implementation

The [upstream library PR](https://github.com/Tyrrrz/YoutubeExplode/pull/970)
retains browser cookies, uses the cookie-compatible embedded web player, preserves
encrypted context/host flags, and supplies current session/account headers.
It does not execute JavaScript, decipher media URLs, enumerate media formats,
or fetch media manifests. Denied requests retain the player reason and do not
retry unrelated mobile clients.

The personal CLI and benchmark are separate from the upstream contribution.
The original upstream baseline succeeded in 1/5 authenticated attempts and 0/5
anonymous attempts; see [BASELINE.md](BASELINE.md). The updated anonymous path
was not benchmarked again; its manifest client selection is unchanged.

This compares complete CLI workflows. The ratio includes different network and
extraction work, not just AOT versus JIT. Reliability is demonstrated for this
video/account/network/date, not every restriction supported by yt-dlp.

## Method and environment

Apple M1 Pro, macOS 26.4, ARM64. Published with `pkgx dotnet`, .NET SDK 10.0.401,
Release, Native AOT, `osx-arm64`. The standalone Mach-O executable is
9,165,232 bytes (8.74 MiB).

Baseline: the unmodified `/Users/meoyawn/agent/scripts/transcribe.ts`, yt-dlp
2026.07.04, Node v26.9.0. It uses `default,web_embedded` and Node `fetch`
for captions, with its usual yt-dlp configuration active. Each attempt uses an
independent temporary copy of the same cookie export. The original export and
script remain unchanged.

One excluded warm-up per variant, then five measured attempts in alternating
order. Fresh processes and transcript caches for every attempt; two-second pauses
outside timing. OS/DNS/yt-dlp JavaScript caches remain warm. Wall time includes
startup, discovery, download, parsing, output-file creation, the temporary-cookie
exec wrapper for the script, and `/usr/bin/time` for both commands. Build time,
cookie copying, and post-run validation are excluded. No builds or tests ran
during measurement.

All measured outputs contain the same 2,009 words with normalized SHA-256:

```text
a527b16255a497639aa65d6b0a9656a161327d1c8e45aec8defd6faea240bc3a
```

## Validation and reproduction

- **94 offline library tests passed**, including nine authenticated-caption cases.
- Library builds passed for `netstandard2.0`, `net6.0`, `net7.0`, and `net10.0`,
  with zero warnings/errors. The final CLI Native AOT publish passed.
- Eight CLI argument/cookie failure smoke checks passed without network access.
- Default cookie discovery and clean stdout were separately checked against the
  same transcript hash.
- The benchmark exited zero: all measured pulls succeeded and hashes matched.

```sh
pkgx dotnet publish src/youtube-transcript.csproj \
  -c Release -r osx-arm64 -o artifacts/osx-arm64

python3 benchmarks/benchmark.py \
  --script /Users/meoyawn/agent/scripts/transcribe.ts \
  --cookies /Users/meoyawn/.yt-dlp/cookies.txt \
  --authenticated-only --runs 5
```

[results.json](results.json) contains measured/warm-up durations, commands,
executable/script hashes, peak RSS, and AOT stage timings/request counts.
[baseline-results.json](baseline-results.json) records the original comparison.
Detailed logs/transcripts remain local under `bin/results/personal-cli/` and are
not committed. Cookies are never included in benchmark artifacts.
