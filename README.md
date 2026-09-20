# yt-dlp-explode

[![Native AOT](https://github.com/meoyawn/yt-dlp-explode/actions/workflows/native-aot.yml/badge.svg)](https://github.com/meoyawn/yt-dlp-explode/actions/workflows/native-aot.yml)

A native CLI built on YoutubeExplode, with **yt-dlp CLI compatibility as the goal**.
The first milestone is YouTube closed captions: subtitle discovery, downloads,
and the caption metadata consumed by existing transcript scripts.

This is an early implementation, not full yt-dlp parity yet. See
[COMPATIBILITY.md](COMPATIBILITY.md) for supported behavior and remaining work.

## Usage

The familiar yt-dlp arguments are the interface:

```sh
yt-dlp-explode --skip-download --write-auto-subs --sub-langs en \
  --sub-format json3 'https://www.youtube.com/watch?v=4Ff0xc9M8kA'

yt-dlp-explode --skip-download --dump-single-json --no-warnings --no-playlist \
  --extractor-args 'youtube:player_client=default,web_embedded' \
  'https://www.youtube.com/watch?v=4Ff0xc9M8kA'

yt-dlp-explode --list-subs 'https://www.youtube.com/watch?v=4Ff0xc9M8kA'
```

Manual captions use `--write-subs`; automatic captions use `--write-auto-subs`.
`--sub-langs 'en.*,fr,-en-orig'` selects languages by regex and exclusion.
`--sub-format 'json3/vtt/best'` sets format preference. `-o` takes an output
**template**, as in yt-dlp:

```sh
yt-dlp-explode --skip-download --write-auto-subs --sub-langs en \
  -P ./captions -o '%(id)s.%(ext)s' 4Ff0xc9M8kA
# Writes captions/4Ff0xc9M8kA.en.vtt
```

`--dump-single-json` and `--list-subs` imply simulation; use `--no-simulate` with
`--skip-download` to also write requested subtitle files. Existing files are
preserved unless `--force-overwrites` is supplied. Multiple video URLs are
processed sequentially with a reused HTTP client.

## Configuration and cookies

Reads **yt-dlp's config locations**, with command-line options taking precedence:
portable `yt-dlp.conf` beside the executable, home `yt-dlp.conf` in `-P home:` or
the working directory, user config, then system config. User candidates include
`$XDG_CONFIG_HOME/yt-dlp`, `~/.config/yt-dlp`, `%APPDATA%/yt-dlp`, and `~/.yt-dlp`,
with yt-dlp's `yt-dlp.conf`, `config`, and `config.txt` ordering.

`--config-locations` supports repeatable files/directories, nested relative
includes, and stdin (`-`). `--ignore-config` disables automatic discovery while
keeping explicit includes. Options use shell-style quoting and comments.

Your existing configuration can be used unchanged:

```text
--remote-components ejs:github
--cookies ~/.yt-dlp/cookies.txt
--extractor-args youtube:player_client=web_embedded
```

`--cookies FILE` **loads and saves** a Netscape cookie jar, including session and
HttpOnly cookies and response updates/deletions. Other domains and expired file
entries are retained, but only applicable live cookies are sent. Saves use an
atomic replacement, private Unix permissions, and a merge of this process's
changes. `--no-cookies` overrides a configured file. No cookie file is implicitly
selected without a `--cookies` option in config or on the command line.

`--cache-dir DIR` and `--no-cache-dir` control a bounded cache of public,
versioned YouTube player scripts. By default it uses
`$XDG_CACHE_HOME/yt-dlp/yt-dlp-explode-player-v1` (or
`~/.cache/yt-dlp/yt-dlp-explode-player-v1`). Entries honor server freshness,
expire within seven days, and are limited to 16 scripts of at most 4 MiB each.
Caption downloads, signed URLs, and account metadata are always fetched afresh.

EJS/JavaScript runtime settings are accepted for shared config compatibility;
this caption-only path does not execute media JavaScript challenges or download
remote components. No Python, Node, or yt-dlp runtime is needed by the executable.

## Build locally

```sh
git clone --recurse-submodules https://github.com/meoyawn/yt-dlp-explode.git
cd yt-dlp-explode
pkgx dotnet publish src/yt-dlp-explode.csproj \
  -c Release -r osx-arm64 -o artifacts/osx-arm64

./artifacts/osx-arm64/yt-dlp-explode --list-subs 4Ff0xc9M8kA
```

Use `dotnet` directly if the .NET 10 SDK is installed. For an existing checkout,
run `git submodule update --init --recursive` first. The native toolchain is also
required; see Microsoft's [Native AOT prerequisites](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/).

```sh
mkdir -p ~/.local/bin
install -m 755 artifacts/osx-arm64/yt-dlp-explode ~/.local/bin/yt-dlp-explode
```

## Native builds

CI builds and tests executables on their target OS/architecture:

| Target | Runner |
| --- | --- |
| `osx-arm64` | macOS 15 ARM64 |
| `osx-x64` | macOS 15 Intel |
| `linux-x64` | Ubuntu 22.04 |
| `linux-arm64` | Ubuntu 24.04 ARM64 |
| `win-x64` | Windows 2022 |

Download archives from a successful [Actions run](https://github.com/meoyawn/yt-dlp-explode/actions/workflows/native-aot.yml).
Each includes the executable, licenses, and checksums. Unix executables are
packaged in tar archives to preserve permissions. Builds are not signed or
notarized. Linux binaries need the build runner's glibc version or newer.

Native AOT, workstation GC, HTTP compression, HTTP/2 with HTTP/1.1 fallback,
and reuse of the caption-only library path keep startup and memory overhead low.
On macOS, the CLI opts into .NET 10's TLS 1.3-capable Network.framework backend. See [benchmarks](benchmarks/README.md).
The library buffers responses and caption metadata; this is not a streaming API.

Direct CLI subtitle downloads succeeded **5/5** with matching text:
**1.839 s median** for this executable versus **14.477 s** for the
user's local yt-dlp 2026.08.19, using warmed tool caches and fresh captions.
Native median peak RSS was **39.7 MiB**. The requested ≤2.276 s median is met;
network outliers still occur. See [measurement details](benchmarks/RESULTS.md)
and [profiling](benchmarks/PROFILE.md).

## Library dependency

The Git submodule at `external/YoutubeExplode` uses **meoyawn's fork**, pinned to
[`dd8598c`](https://github.com/meoyawn/YoutubeExplode/commit/dd8598cabd87984e23a78f91bd99189240bccca3),
the library fix submitted as [upstream PR #970](https://github.com/Tyrrrz/YoutubeExplode/pull/970).
That PR contains only library changes and regression tests. The CLI lives here.

The pin keeps builds reproducible while the upstream change is pending. Once a
released upstream package contains the fix, it can replace the source dependency.

## Validation

```sh
pkgx dotnet run --project tests/CompatibilityTests.csproj -c Release
python3 scripts/smoke_test.py artifacts/osx-arm64/yt-dlp-explode
```

These checks use synthetic config and cookie files; they do not require YouTube
or a real account. Live script compatibility is measured separately.

MIT; see [LICENSE](LICENSE) and [YoutubeExplode's license](licenses/YoutubeExplode.txt).
