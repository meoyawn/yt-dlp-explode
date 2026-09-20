# Caption compatibility benchmark

See [measured results](RESULTS.md) for the five-run comparison.

Runs the user's existing transcript script unchanged, comparing installed yt-dlp
with the native `yt-dlp-explode` binary behind the same `yt-dlp` command name.
The script's metadata flags, language selection, JSON3 fetch, parsing, and output
are identical in both variants.

```sh
pkgx dotnet publish src/yt-dlp-explode.csproj \
  -c Release -r osx-arm64 -o artifacts/osx-arm64

python3 benchmarks/benchmark.py \
  --script /Users/meoyawn/agent/scripts/transcribe.ts \
  --cookies /Users/meoyawn/.yt-dlp/cookies.txt \
  --runs 5
```

Each invocation gets a fresh transcript cache, process, and independent copy of
the cookie file. The source cookie file and script remain unchanged. A small
Python exec wrapper supplies the selected executable and temporary cookie path;
its overhead is included for both tools. Other yt-dlp config remains active.

One warmup per variant is excluded, then five measured runs alternate order,
with two-second pauses outside timing. Script startup, native/Python extraction,
Node caption fetch, parsing, output writing, and cookie-jar saves are included.
Builds, cookie copying, pauses, and output validation are excluded. OS/DNS caches
remain warm. On macOS `/usr/bin/time -l` reports maximum resident set size; this
is not summed concurrent process-tree memory, and the native variant includes
Node because both variants run the same transcript script.

Success requires all measured runs to return nonempty captions without falling
back to audio transcription. Text hashes must match after stripping timestamps
and normalizing whitespace. Failed attempts are reported as failures, not speed.
Logs and transcripts stay under ignored `artifacts/benchmarks/` directories.
No cookie values or signed caption URLs are stored in the report.

The [history](history/README.md) directory preserves earlier experiments with the
initial standalone text CLI, before adopting yt-dlp's command-line interface.
