# Profiling the 2.276-second comparison

The old 2.276 s result timed the original native text CLI directly. The later
4.835 s result timed `transcribe.ts`: Node starts a metadata subprocess, then
fetches captions over a separate connection after that subprocess exits.
Those numbers had different boundaries. The new benchmark downloads JSON3
subtitles using each CLI directly, including startup and cookie-file saves.

The compatibility parser was not the source of seconds of overhead. Profiles
showed config parsing around 0.4–2 ms, caption selection around 1–2 ms, player
JSON capture below 1 ms, and cookie load/save around 70–90 ms combined. Cookie
persistence is required for the intended interface and remains enabled.

## Connection setup, not transcript processing

Initial old/new interleaved runs appeared to implicate the new cookie transport.
Further measurements also reproduced the delay in the old CLI. A .NET network
EventListener located the large spikes inside TLS setup, before the first HTTP
response. A representative [slow profile](profiles/slow-handshake.json) spent
4,941 ms in the handshake while DNS and TCP connect each took about 3 ms.

The machine resolved YouTube to a tunnel address and routed through a tunnel
interface. These measurements include that route. They do not prove where
inside the network path the TLS delay originates. The curl control also showed
variable connection establishment. There are no added caption-request retries.

.NET 10 on macOS keeps its old Secure Transport backend by default. Microsoft's
[documentation](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries#tls-13-for-macos-client)
describes the opt-in Network.framework backend supporting TLS 1.3. The CLI opts
in on macOS and prefers HTTP/2, retaining HTTP/1.1 negotiation fallback. TLS
certificate validation remains the platform default. An explicit
`DOTNET_SYSTEM_NET_SECURITY_USENETWORKFRAMEWORK=0` selects the old backend for
diagnostics. Windows and Linux retain their platform TLS backend.

The [TLS backend experiment](profiles/tls-ab.json) records all eight alternating
runs, including slow outliers and the first launch of the newly built binary.
It is an exploratory profile, not the final CLI comparison. Enabling TLS 1.3
alone did not eliminate network spikes. The subsequent [HTTP/2 experiment](profiles/http2-ab.json)
confirmed HTTP/2 negotiation and roughly 0.60–0.63 s TLS handshakes in its fast
runs versus 0.69–0.96 s in the old transport's fast runs. However, new-transport
outliers made its full exploratory median worse (2.351 s versus 1.894 s).
This is not evidence that transport changes remove tail latency; the final
release is measured independently below.

## Avoidable player-script download

The pinned library keeps the player signature timestamp only in memory. Every
new CLI process therefore downloaded the same 1.6 MB versioned script, costing
roughly 0.5 s. YouTube returned `Cache-Control: public, max-age=31536000`.

The CLI now caches the original public script bytes, keyed by full script URL
and Origin. It honors remaining freshness after Date/Age, caps lifetime at
seven days, and stores at most 16 entries of 4 MiB each. Private/no-store/no-cache,
Set-Cookie, partial, stale, and unsupported Vary responses are excluded. Entries
have length/checksum validation and atomic replacement; missing, corrupt,
expired, or inaccessible cache entries fall back to an ordinary request.

A new player version automatically misses the cache. Authenticated bootstrap
metadata, signed caption URLs, cookies, and caption responses are never cached.
A warm pull uses three network requests instead of four. `--cache-dir` and
`--no-cache-dir` now control this behavior using yt-dlp's cache location, with a
separate `yt-dlp-explode-player-v1` namespace.

Caching alone was insufficient: the [first release benchmark](history/cache-only-results.json)
succeeded 5/5 but measured **4.604 s** native median versus **19.956 s** local
yt-dlp median, missing the target. That failed timing result is retained rather
than discarded. See [RESULTS.md](RESULTS.md) for the final transport change's
measurements.

## Reproduce profiling

Phase timing is opt-in and emits paths, timings, and byte counts; it does not
emit cookie values, authorization headers, or signed URL query strings:

```sh
env YT_DLP_EXPLODE_PROFILE="$PWD/artifacts/profile.json" \
  artifacts/osx-arm64/yt-dlp-explode --skip-download --write-auto-subs \
  --sub-langs en --sub-format json3 --cookies /path/to/cookie-copy.txt \
  -P /path/to/fresh-output 4Ff0xc9M8kA
```

To include DNS/connect/TLS start/stop events, publish a separate diagnostic build
with `-p:EventSourceSupport=true`. Ordinary AOT releases leave that support at
the SDK default. Profiling buffers bodies for phase timing; release benchmarks
run with profiling disabled. The benchmark clock is external and includes
process startup and cookie saving, unlike the per-video `--stats` timer.
