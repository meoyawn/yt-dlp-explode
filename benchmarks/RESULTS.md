# yt-dlp interface compatibility benchmark — 2026-09-20

The same unmodified `/Users/meoyawn/agent/scripts/transcribe.ts` ran against two
executables, substituted behind the `yt-dlp` command name through a temporary
PATH wrapper. Both variants succeeded in **5/5** measured attempts on
[4Ff0xc9M8kA](https://www.youtube.com/watch?v=4Ff0xc9M8kA). Every normalized
transcript hash matched (2,009 words).

| Script backend | Success | Median wall time | Range | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| yt-dlp-explode Native AOT | 5/5 | 4.835 s | 3.703–10.584 s | 95.9 MiB |
| yt-dlp 2026.07.04 | 5/5 | 18.579 s | 17.327–29.447 s | 337.9 MiB |

The ratio of median times is **3.84×**. These are complete
script workflows, including Node startup, caption fetch/parsing, output writing,
and cookie-jar saves. RSS is macOS `time -l`'s maximum resident set size, not a
sum of concurrent process memory. The native backend row still includes Node
because the transcript script itself uses Node.

| Attempt | yt-dlp-explode seconds | yt-dlp seconds |
| --- | ---: | ---: |
| 1 | 10.584 | 17.767 |
| 2 | 3.703 | 18.579 |
| 3 | 8.220 | 29.447 |
| 4 | 3.740 | 17.327 |
| 5 | 4.835 | 23.012 |

A separate direct-native `--skip-download --write-auto-subs --sub-langs en
--sub-format json3` check matched the same text in four HTTP requests and used
**39.3 MiB peak RSS**. This is one standalone memory observation,
not the script-workflow median. Existing-file preservation skipped the caption
request; `--force-overwrites` fetched it again. Cookie saves and output-template
filenames were verified in both cases.

## Environment and method

Apple M1 Pro, macOS 26.4 ARM64; .NET SDK 10.0.401, Native AOT Release.
The standalone executable is 7,804,992 bytes
(7.44 MiB). Library dependency:
[`dd8598c`](https://github.com/meoyawn/YoutubeExplode/commit/dd8598cabd87984e23a78f91bd99189240bccca3).

One excluded warmup per variant, fresh processes/transcript caches/cookie copies,
alternating order, and two-second pauses outside timing. Normal yt-dlp config
remained active; only the cookie path was overridden with an independent copy.
The user's script and original cookie file were not modified. No local builds
or tests ran during measurement. OS/DNS caches remained warm.

This validates the current caption milestone for this video/account/network/date.
It does not establish complete yt-dlp API parity or general extractor reliability.
[results.json](results.json) records executable/script hashes, all timings,
commands, and output hashes. Raw logs/transcripts remain in ignored local
`artifacts/benchmarks/compatibility/`.

## Other validation

- 33 offline config/cookie/subtitle compatibility checks passed.
- Eight native executable smoke checks passed.
- [Native CI](https://github.com/meoyawn/yt-dlp-explode/actions/runs/35526253771)
  passed on macOS ARM64/x64, Linux ARM64/x64, and Windows x64, including native
  publication, compatibility checks, executable smoke checks, and packaging.
- The upstream library PR remains open and unchanged.

See [reproduction instructions](README.md) and [compatibility scope](../COMPATIBILITY.md).
