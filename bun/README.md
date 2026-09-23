# Bun caption CLI

Clone of the current C# CLI's cookie and transcript interface, built with
[YouTube.js](https://github.com/LuanRT/YouTube.js) 18.1.0 and Bun 1.4.2.
The executable takes the same yt-dlp-style options and emits the same
caption-oriented JSON fields. Media downloading and full yt-dlp parity remain
outside this milestone; see [the shared compatibility scope](../COMPATIBILITY.md).

## Build and run

From this directory:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build

./artifacts/darwin-arm64/yt-dlp-explode --skip-download --write-auto-subs \
  --sub-langs en --sub-format json3 --cookies ~/.yt-dlp/cookies.txt \
  -o '%(id)s.%(ext)s' 4Ff0xc9M8kA

./artifacts/darwin-arm64/yt-dlp-explode --dump-single-json \
  --no-warnings --no-playlist 4Ff0xc9M8kA
```

The default artifact directory is `artifacts/<platform>-<arch>/` (`darwin`,
`linux`, or `win32`). Windows adds `.exe`. Run from source with
`bun run start --list-subs VIDEO`. Cross-compile with
`bun run build bun-linux-x64`; the output then uses the target name as its
directory. The build uses Bun's [standalone executable compiler](https://bun.com/docs/bundler/executables),
ESM bytecode, minification, embedded sourcemaps, and preserved function names.
The executable embeds Bun and all runtime dependencies. It needs no separately
installed Bun, Node, Python, or yt-dlp. Runtime `.env` and `bunfig.toml`
autoloading are disabled in compiled builds.

## Compatibility

- Same flags and aliases as `src/Options.cs`, including simulation, JSON,
  subtitle listing/downloads, language regex/exclusions, format preferences,
  output templates, overwrite policy, multiple URLs, and exit codes 0/1/2/130.
- Same portable, home, user, and system yt-dlp config discovery and precedence;
  explicit relative includes, cycles, stdin, shell quoting, and UTF-8/UTF-16 BOMs.
- Netscape jars preserve foreign-domain, expired, session, and HttpOnly entries.
  Bun's native cookie parser handles response updates. The shared HTTP transport
  applies domain/path/expiry/Secure rules, captures redirect cookies, refreshes
  authentication hashes, and removes credentials on cross-origin redirects.
  Saves merge changes under an exclusive lock, use atomic replacement, and
  create Unix files with mode 0600. `--no-cookies` disables file access.
- JSON includes `subtitles`, `automatic_captions`, `requested_subtitles`,
  original-language aliases, translation URLs, metadata, and written file paths.
  Formats are `json3`, `srv1`, `srv2`, `srv3`, `ttml`, `srt`, and `vtt`.
- YouTube.js constructs sessions and InnerTube requests. Authenticated captions
  bootstrap the embedded player, retaining its current client context, selected
  account, and signature timestamp. Anonymous discovery tries VisionOS, then
  Android on player denial, matching the C# strategy. Caption requests do not
  execute player JavaScript or fetch media manifests.
- `--cache-dir`/`--no-cache-dir` control public versioned player-script caching.
  The isolated namespace is `yt-dlp-explode-bun-player-v1`; its storage format is
  independent of C#. Entries honor server freshness, expire within seven days,
  verify a SHA-256 checksum, and are capped at 16 scripts of 4 MiB each.
  Account metadata, signed URLs, and subtitle responses are never cached.
- `--stats` emits per-video timing and request counts to stderr.
  `YT_DLP_EXPLODE_PROFILE` writes phase timing JSON; .NET network events have no
  Bun equivalent. Bun also provides its own CPU/heap profiling facilities.

The help banner identifies Bun; `--version` retains the C# CLI's `0.1.1` contract.
Regex syntax is JavaScript rather than .NET/Python. Caption availability and
translation lists depend on YouTube's response to the selected client. Shared
EJS/runtime config options are accepted without downloading components or
executing media challenges. Browser cookie extraction is not implemented.

`youtubei.js` is the sole direct runtime dependency. Its three dependencies are
locked in `bun.lock`. Bun supplies HTTP, cryptographic hashes, cookie parsing,
file I/O, the test runner, and Bun Shell for the build script.

## Validation and benchmarks

The offline tests exercise config precedence, cookie persistence and concurrent
saves, authenticated requests, redirects, timeouts, cache bounds/corruption,
caption selection/JSON, and complete simulated/download/overwrite CLI workflows.
From the repository root, smoke-test the compiled executable with:

```sh
bun scripts/smoke-test.ts bun/artifacts/darwin-arm64/yt-dlp-explode
bun benchmarks/benchmark.ts --cookies ~/.yt-dlp/cookies.txt \
  --bun-binary bun/artifacts/darwin-arm64/yt-dlp-explode --runs 5
```

The benchmark includes C# and installed yt-dlp as controls, uses independent
temporary cookie copies, and compares downloaded transcript hashes. See
[measured results](../benchmarks/RESULTS.md).
