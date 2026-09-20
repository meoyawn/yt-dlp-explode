# Original transcript benchmark — 2026-09-20

This records the unmodified upstream behavior. See [RESULTS.md](RESULTS.md)
for the fork's updated authenticated caption implementation.

Video: [4Ff0xc9M8kA](https://www.youtube.com/watch?v=4Ff0xc9M8kA).

Built the local YoutubeExplode source at `5d7f834` using `pkgx dotnet publish`,
.NET SDK 10.0.401, Release/Native AOT, `osx-arm64`. The executable is a native
ARM64 Mach-O file, 7,625,600 bytes (7.27 MiB), on an Apple M1 Pro with macOS 26.4.
The publish completed without warnings or errors. The library itself was not
modified. This predates the standalone CLI now under `YoutubeExplode.Cli`.

Baseline: the unmodified `/Users/meoyawn/agent/scripts/transcribe.ts`, using
yt-dlp 2026.07.04 and Node v26.9.0, with the user's normal configuration and an
independent copy of `/Users/meoyawn/.yt-dlp/cookies.txt` for each attempt.
The script uses `default,web_embedded` clients to discover captions and Node
`fetch` to download JSON3 captions. See [README.md](README.md) for exact commands.

Each variant had one excluded warm-up and five measured attempts. Each process
and transcript cache was fresh; order rotated, with a two-second pause between
attempts. Timings include startup, metadata, download, parsing, and writing.

| Variant | Successful pulls | Successful wall time | Failure wall time |
| --- | ---: | ---: | ---: |
| AOT, no cookies | 0/5 | — | 1.43–2.82 s |
| AOT, supplied cookies | 1/5 | 1.93 s (one sample) | 1.37–6.25 s |
| Existing yt-dlp script | 5/5 | **17.92 s median**, 16.51–21.20 s range | — |

The AOT success was 9.29 times faster than the script's median, but this is one
successful observation among five attempts, not an estimate of a reliable speedup.
Four of its five authenticated attempts failed. Anonymous AOT never retrieved
captions. Failure latencies are not download performance.

All five script results and the single AOT success have identical text after
removing script timestamps and normalizing whitespace: 2,009 words and SHA-256
`a527b16255a497639aa65d6b0a9656a161327d1c8e45aec8defd6faea240bc3a`.
Both outputs contain 300 text lines; the AOT parser groups them into 151 caption
objects. The AOT success identified the English automatic caption track. Its
internal timings were 1,703 ms for the manifest and 190 ms for captions; total
application work was 1,894 ms, versus 1,930 ms measured process wall time.

All AOT failures surfaced as `VideoUnavailableException`. Separate diagnostic
requests, with and without cookies, showed HTTP 200 responses whose player
status was `LOGIN_REQUIRED` and reason was `Sign in to confirm you’re not a bot`
from both the VisionOS client and Android fallback. The error does not mean
the video itself is unavailable.

The saved cookies are usable: the existing script succeeded in all measured
runs. YouTube authentication-cookie expiry dates in the file are in the future.
Some other entries use Chromium timestamps rather than Unix seconds; the AOT
cookie reader handles that export format. The original cookie file and the
existing script were not changed.

Local artifact paths at the time of the baseline run (the executable has since been rebuilt):

- Native executable: `bin/native/youtube-transcript`
- Raw timings, commands, hashes, and stage metrics: `bin/results/script-comparison/results.json`
- Per-attempt stdout, stderr, and successful transcripts: `bin/results/script-comparison/`
- Diagnostic player statuses and build log: the same results directory

The runner exits 1 because some attempts failed; it does not treat missing
captions as success. Smoke checks verified help, missing arguments, and invalid
video IDs. No broader library tests were needed because library code was unchanged.
