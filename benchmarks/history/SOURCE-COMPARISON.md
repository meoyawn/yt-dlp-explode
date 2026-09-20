# Why yt-dlp is more reliable in this test

This is the pre-change audit. The authenticated caption implementation now
addresses the cookie, client, session, and bootstrap issues below. See
[RESULTS.md](RESULTS.md) for the post-change benchmark.

Inspected `/Users/meoyawn/Developer/github/yt-dlp` at `c7fb478` (2026-09-16)
and the YoutubeExplode checkout at `5d7f834`. The inspected yt-dlp checkout is
newer than the installed 2026.07.04 executable used in the benchmark. Important
shared mechanisms were also checked in the installed Python source; default
client lists differ between these revisions.

## Confirmed for this video

A fresh metadata extraction using the exact script arguments identified both
English JSON3 tracks (`en`, `en-orig`) as coming from **`web_embedded`**. Neither
track URL had a `pot` token or a translation parameter. The safe metadata summary
is saved in `bin/results/script-comparison/caption-client.json`; no signed URL
or cookie value is included.

This makes the missing embedded-web client the strongest source-level explanation
for the reliability difference. It does not prove that changing only the client
name will fix every failure.

## 1. Authentication-aware client selection

- yt-dlp `_video.py:2973` selects different defaults for authenticated sessions,
  then `_video.py:3009` removes clients whose `SUPPORTS_COOKIES` flag is false.
- `_base.py:123` declares `web_embedded` as `WEB_EMBEDDED_PLAYER` with cookie
  support. VisionOS and Android lack that flag, which defaults to false at
  `_base.py:426`.
- The current checkout's authenticated defaults include `web_embedded` first
  (`_video.py:145`). The installed July version uses `tv_downgraded,web_safari`
  by default; the user's script explicitly adds `web_embedded`.
- YoutubeExplode `Videos/VideoController.cs:280` always tries VisionOS, then
  Android, including when cookies were supplied. The caption call passes no
  signature timestamp, so the TV branch at line 270 is never used for this path.
  That TV client is also a different identity from `WEB_EMBEDDED_PLAYER`.

## 2. A concrete cookie-capacity problem

YoutubeExplode creates a default `CookieContainer` in `YoutubeHttpHandler.cs:19`.
An offline .NET 10 reproduction using the same domain/name/path/expiry insertion
order, with dummy cookie values and no network requests, reports a default
per-domain capacity of **20**. The supplied file has **27** live YouTube entries.
The reproduction evicts `LOGIN_INFO`, among other cookies, before any request.
Both `SAPISID` and `__Secure-3PAPISID` remain in that reproduction.

yt-dlp considers `LOGIN_INFO` plus session cookies when deciding authentication
state (`_base.py:812`). Losing it is a real fidelity problem, though this audit
has not isolated its contribution to YouTube's rejection. Increasing cookie
capacity should be checked before attributing every authenticated failure to
the remote client alone. The original cookie file has not been altered.

## 3. More complete authentication and session context

yt-dlp's `_base.py:745` and `_base.py:781` generate the available `SAPISIDHASH`,
`SAPISID1PHASH`, and `SAPISID3PHASH` schemes, optionally including the user session
ID. It prefers SAPISID for the first scheme, falling back to the third-party
cookie when missing. It formats SHA-1 as lowercase hexadecimal.

`_base.py:940` additionally sets account/page identity headers when available,
including `X-Goog-AuthUser`, `X-Goog-PageId`, `X-Origin`, and the logged-in bootstrap
flag. `_base.py:960` sets consistent numeric client name, client version, visitor
ID, user agent, and origin headers.

Explode's `YoutubeHttpHandler.cs:48` emits only `SAPISIDHASH`, prefers the third-party
cookie first, does not include a user-session component, and uses uppercase
`Convert.ToHexString`. Its request construction lacks the additional identity
headers. These are verified differences, not individually proven causes of the
bot checks.

## 4. Current embedded-player configuration

yt-dlp downloads `/embed/VIDEO_ID?html5=1` and reads `ytcfg` (`_base.py:993`). It
preserves current client/session configuration, supplies a non-YouTube embed
origin (`_base.py:406`), and forwards `encryptedHostFlags` when present
(`_video.py:2948`). The inspected checkout also adds a Safari user agent for
this client; that is its latest commit, and should not be credited for the
earlier installed version's successful benchmark.

Explode's caption path gets visitor data from `sw.js_data`, then sends hardcoded
VisionOS/Android request templates. A web-embedded fallback needs the relevant
bootstrap/session handling, not merely a different string in `clientName`.

## 5. Caption-specific token policy and merging

yt-dlp examines caption tracks from multiple player responses. At `_video.py:4264`
it detects subtitle token requirements, including `exp=xpe/xpv`, obtains a
subtitle PO token through its provider infrastructure when available, and appends
`pot`, `potc`, and `c`. When a required token is unavailable it skips that client's
tracks and can obtain captions from another response. It also removes `xosf`
from caption URLs (`_video.py:4207`).

Explode's `Videos/ClosedCaptions/ClosedCaptionController.cs:17` only sets the
requested XML format and downloads the track URL. It has no equivalent token
policy/provider path or caption-specific retry across clients. Token support is
a broader robustness gap, but the confirmed successful embedded-web track for
this video did **not** need a PO token.

## Performance implication and implementation priority

The observed 1.93-second AOT success versus the script's 17.92-second median does
not isolate Native AOT's effect. yt-dlp performs full video metadata and format
extraction before the script chooses captions; the code includes media signature
and `n` challenge solving, manifest processing, and multiple client requests
(`_video.py:3304`, `_video.py:3876`). Explode's caption path requests much less.

The first implementation experiment should retain all cookies and add a
caption-focused authenticated `WEB_EMBEDDED_PLAYER` path with correct session
headers and embedded configuration. Preserve the existing anonymous fast path
as a fallback where it works, and surface the actual playability reason instead
of the generic unavailable error. Repeat the same benchmark after each isolated
change. Add token-provider support if the selected caption endpoint actually
requires it. Library behavior has not been changed by this investigation.
