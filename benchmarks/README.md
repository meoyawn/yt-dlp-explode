# Direct CLI benchmark

See [measured results](RESULTS.md) and the [profiling investigation](PROFILE.md).
The current benchmark invokes **both CLIs directly**, with the same flags, to
write English JSON3 subtitles. It does not invoke Node or the transcript script.

```sh
pkgx dotnet publish src/yt-dlp-explode.csproj \
  -c Release -r osx-arm64 -o artifacts/osx-arm64

python3 benchmarks/benchmark.py \
  --yt-dlp /Users/meoyawn/.local/bin/yt-dlp \
  --cookies /Users/meoyawn/.yt-dlp/cookies.txt \
  --runs 5 --max-median 2.276
```

The selected installed yt-dlp executable runs as-is. Both use normal config
lookup, including `~/.yt-dlp/config.txt`; the measurement used its configured
`youtube:player_client=web_embedded`. The benchmark does not add `default` to
that selection. Each call overrides only the shared action/output options,
cache directory, and cookie path with an independent temporary copy:

```sh
TOOL --skip-download --write-auto-subs --sub-langs en --sub-format json3 \
  --no-warnings --no-playlist --cookies COOKIE_COPY --cache-dir SHARED_CACHE \
  -P FRESH_OUTPUT -o '%(id)s.%(ext)s' -- 'https://www.youtube.com/watch?v=4Ff0xc9M8kA'
```

One excluded warmup for each tool starts with an empty cache directory. Five
measured runs alternate order, with two-second pauses outside timing. Tool
caches persist after warmup; subtitles always go into fresh directories and
are downloaded on every run. Use `--cold-cache` to disable both disk caches.
OS/DNS caches remain warm. The user's original cookie file remains unchanged.

Timing includes process startup, config/cookie load, caption discovery, subtitle
download and output writing, cookie save, and process exit. Builds, cookie
copying, validation, and pauses are excluded. macOS `/usr/bin/time -l` reports
the child process's peak RSS; no Node wrapper is involved.

Success requires five successful, nonempty subtitle files from each tool and
matching normalized text hashes. Errors are recorded as failures and never
counted as fast pulls. `--max-median` additionally requires the native median
not to exceed the given time. Executable versions/hashes are checked before
and after the series to catch concurrent updates. Full reports and logs stay
under ignored `artifacts/benchmarks/`; reviewed reports are copied here.

## Historical script benchmark

`script_benchmark.py` preserves the earlier `transcribe.ts` comparison. Its
boundary includes Node startup and a separate Node caption fetch after the
metadata subprocess exits. Those timings are not direct CLI measurements.

```sh
python3 benchmarks/script_benchmark.py \
  --script /Users/meoyawn/agent/scripts/transcribe.ts \
  --cookies /Users/meoyawn/.yt-dlp/cookies.txt --runs 5
```

See [the historical script results](history/SCRIPT-RESULTS.md) and the other
[historical experiments](history/README.md).
