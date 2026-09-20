#!/usr/bin/env bun
import { $ } from "bun";
import { join } from "node:path";

const result = await $`yt-dlp --dump-single-json ${Bun.argv.at(-1)}`.quiet().nothrow();
if (result.exitCode) {
  process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
const { text } = JSON.parse(result.stdout.toString());
const directory = join(process.env.TRANSCRIBE_CACHE_DIR!, "youtube-transcripts");
await $`mkdir -p ${directory}`;
const path = join(directory, "fixture.txt");
await Bun.write(path, `[01:02] ${text}\n[1:02:03] more words\n`);
console.log(path);
