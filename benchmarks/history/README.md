# Historical measurements

These files record the original YoutubeExplode investigation and the first text
CLI, before its move out of the library and its redesign around yt-dlp's CLI.
Their build paths and commands describe those historical versions; they are
not instructions for the current project. Raw measurement JSON is preserved
without rewriting its commands or executable hashes.

- BASELINE.md: unmodified upstream library, including anonymous failures.
- SOURCE-COMPARISON.md: investigation of yt-dlp's client/session handling.
- RESULTS.md: the initial fixed-library AOT text CLI versus the transcript script.
- SCRIPT-RESULTS.md: the original yt-dlp-compatible CLI through the Node transcript
  script (4.835 s median), with raw measurements in script-results.json.

- cache-only-results.json: first direct CLI trial; cache alone did not meet the
  2.276 s target (4.604 s median).

Use ../README.md to benchmark the current compatibility-oriented executable.
