# Compatibility scope

The long-term contract is yt-dlp's CLI: option names, config discovery and
precedence, cookie behavior, metadata, output naming, and exit behavior. The
initial milestone implements YouTube captions. Full compatibility has **not**
been reached, and the executable never delegates unsupported work to yt-dlp.

## Implemented in this milestone

- Portable/home/user/system config lookup, one file per default config group,
  command-line precedence, quoted arguments/comments, nested explicit includes,
  `--config-locations`, `--no-config-locations`, and `--ignore-config`.
- Netscape jars via `--cookies`/`--no-cookies`: existing or new files, empty/zero
  session expiries, HttpOnly imports/exports, Chromium microsecond expiry imports,
  domain/path/secure/expiry request policy, response cookies including redirects,
  updates/deletions, atomic saves, and preservation of unrelated cookie entries.
- `--skip-download`, `--dump-json`/`-j`, `--dump-single-json`/`-J`, `--list-subs`,
  `--simulate`/`-s`, and `--no-simulate` for individual YouTube videos.
- `--write-subs`, `--write-auto-subs`, their negative forms and common aliases,
  `--all-subs`, language regex/exclusions, manual-over-automatic selection,
  format preference, and `.LANG.FORMAT` subtitle filenames.
- JSON caption maps (`subtitles`, `automatic_captions`, `requested_subtitles`),
  original automatic-language aliases such as `en-orig`, signed format URLs,
  and available core video fields. Translations are listed when the selected
  player exposes translation languages.
- `-o`/`--output` with `default:`/`subtitle:` templates; `-P`/`--paths` with
  `home:`/`subtitle:` directories; existing-file preservation and forced overwrite.
- `--no-playlist`, quiet/warning/verbose toggles, `--ignore-errors`,
  `--socket-timeout`, cancellation, and multiple sequential video URLs.
- `--cache-dir`/`--no-cache-dir`: bounded public player-script caching under
  yt-dlp's XDG cache directory, isolated in `yt-dlp-explode-player-v1`.
- The exact shared config and JSON command used by the existing `transcribe.ts`
  workflow. Caption JSON remains on stdout; diagnostics remain on stderr.

## Current limits and differences

- Media downloads, non-YouTube extractors, playlist traversal, browser/keychain
  cookie extraction, postprocessors, plugins, authentication via passwords,
  proxy/impersonation options, and most other yt-dlp options are future work.
  Unknown options and media-download requests fail explicitly.
- JSON contains caption-oriented metadata, not a complete media-format info
  dictionary. No claim is made that every yt-dlp JSON consumer works yet.
- The pinned library supports `player_client=default`, `web_embedded`, or their
  combination. A forced `web_embedded` request currently needs login cookies.
  Other client selections are rejected. `youtube:skip=translated_subs` is supported.
- `--remote-components ejs:github/ejs:npm` and `--js-runtimes` are accepted as
  inactive media-challenge settings. They do not trigger component downloads or
  JavaScript execution. Only public versioned player scripts are cached; caption
  responses and authenticated bootstrap metadata are always fetched afresh.
  `--rm-cache-dir` is not implemented yet.
- Output templates currently support `id`, `title`, `ext`, `uploader`, `channel`,
  `channel_id`, and `duration`, with string/integer conversion and `%%`. Advanced
  template expressions and exact filename sanitization parity remain future work.
- Config text supports Unicode BOMs, not arbitrary coding declarations. Regex
  matching uses .NET syntax; common patterns work, but Python-specific constructs
  are not guaranteed. Short-option clusters and all long-option abbreviations
  are not implemented.
- `-P temp:` is accepted, but subtitle atomic temporary files are placed beside
  the destination. Retries are not added around deterministic player denials.
- `--stats` is an extension: JSON timing/request counts on stderr. It is separate
  from yt-dlp-compatible stdout metadata. Missing/invalid arguments return 2;
  operation failures return 1; Ctrl-C returns 130.

## Next milestones

1. Expand differential caption/config/cookie tests against yt-dlp, including
   translated captions, template expressions, authentication variants, and errors.
2. Fill out video metadata and format selection, followed by media downloading.
3. Add playlists, additional extractors, postprocessing, and remaining CLI options.

Reference implementation inspected: local yt-dlp source at
[`c7fb478`](https://github.com/yt-dlp/yt-dlp/tree/c7fb478d21e9e59524befbe23f7801bb267fb880).
Local yt-dlp used for the current direct CLI comparison: 2026.08.19.
Historical script comparisons used 2026.07.04.
