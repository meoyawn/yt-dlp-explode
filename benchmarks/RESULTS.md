# Direct CLI benchmark — 2026-09-23

The Bun implementation completed **5/5** measured downloads with a **0.885 s
median**. C#, Bun, and the installed yt-dlp all downloaded identical normalized
English JSON3 transcripts (2,009 words) for
[4Ff0xc9M8kA](https://www.youtube.com/watch?v=4Ff0xc9M8kA).

| CLI | Success | Median wall time | Range | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| yt-dlp-explode 0.1.1 Native AOT | 5/5 | 0.928 s | 0.909–1.001 s | 40.1 MiB |
| yt-dlp-explode 0.1.1 Bun / YouTube.js 18.1.0 | 5/5 | 0.885 s | 0.864–1.039 s | 73.5 MiB |
| Local yt-dlp 2026.08.19 | 5/5 | 4.724 s | 4.572–4.765 s | 337.7 MiB |

Bun's median was **5.34× faster than installed yt-dlp** and about **4.7% lower
than C#** in this run. The small Bun/C# difference is not evidence of a stable
performance advantage; these are five network-dependent observations. Bun's
median peak RSS was 1.84× C#'s. Its standalone executable was 67,774,962 bytes
(64.64 MiB), versus C#'s 7,954,208 bytes (7.59 MiB). Bun embeds its runtime.

| Attempt | C# seconds | Bun seconds | yt-dlp seconds |
| --- | ---: | ---: | ---: |
| 1 | 0.999 | 0.885 | 4.706 |
| 2 | 0.909 | 1.010 | 4.572 |
| 3 | 1.001 | 0.880 | 4.760 |
| 4 | 0.928 | 1.039 | 4.765 |
| 5 | 0.927 | 0.864 | 4.724 |

## Environment and method

Apple M1 Pro, macOS 26.4 ARM64 (Darwin 25.4.0). C# was rebuilt from the current
source using .NET SDK 10.0.401, Native AOT Release, and the pinned YoutubeExplode
submodule. Bun 1.4.2 compiled the new TypeScript CLI with YouTube.js 18.1.0,
ESM bytecode, minification, embedded sourcemaps, and preserved function names.
The baseline was `/Users/meoyawn/.local/bin/yt-dlp`, version 2026.08.19, as
installed. Every executable's version and SHA-256 stayed unchanged throughout
the series.

All tools used normal yt-dlp config discovery, including the configured
`youtube:player_client=web_embedded`. Each received identical subtitle/action
flags, a fresh output directory, and an independent private copy of the cookie
jar. Copies were removed after each call; the original jar was never passed to
the measured CLIs. No alternative yt-dlp install or transcript-script wrapper
was used.

One excluded warmup per tool began with an empty shared cache directory, with
independent namespaces for each implementation. Warmups took 1.224 s C#,
1.213 s Bun, and 6.371 s yt-dlp. Five measured iterations alternated forward and
reverse tool order with two-second pauses outside timing. Public player-script
caches remained warm; caption responses and authenticated metadata were fetched
afresh. OS/DNS caches remained warm. No builds or tests ran during measurement.

Wall time includes startup, config and cookie loading, discovery, caption
download, file output, cookie save, and exit. Build, copying cookies, validation,
and pauses are excluded. Peak RSS is macOS `/usr/bin/time -l` child accounting.
Profiling was disabled. No median threshold was supplied for this comparison.

[results.json](results.json) contains all commands, attempts, output hashes,
executable hashes/sizes, and summaries. Raw local artifacts are under ignored
`artifacts/benchmarks/bun-comparison-20260923-full/`.
See [reproduction instructions](README.md).

## Validation

The Bun implementation passed 13 offline tests with 140 assertions covering
config, cookies, concurrent saves, HTTP redirects/authentication/timeouts,
player-script caching, JSON/selection, and complete CLI output workflows.
Both TypeScript projects typechecked. The compiled Bun binary passed the
existing eight executable smoke checks. The benchmark fixture suite also
passed with the optional third implementation, and live anonymous subtitle
listing succeeded separately.

CI is configured to build, test, smoke-test, and package Bun executables on
macOS ARM64/x64, Linux ARM64/x64, and Windows x64; those CI jobs have not been
run as part of this local measurement.

## Previous measurements

The [2026-09-20 C#/yt-dlp report](history/NATIVE-FINAL.md) and its
[raw measurements](history/native-final-results.json) are retained. They measured
1.839 s C# and 14.477 s yt-dlp. Network conditions differ between sessions;
compare the three implementations using the same-session table above.
The [profiling investigation](PROFILE.md),
[cache-only trial](history/cache-only-results.json), and
[historical script comparison](history/SCRIPT-RESULTS.md) remain available.
