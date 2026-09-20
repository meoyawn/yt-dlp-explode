#!/usr/bin/env bun
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

const args = Bun.argv.slice(2);
if (args.includes("--version")) {
  console.log("fixture-1.0");
  process.exit(0);
}

function option(name: string) {
  const index = args.lastIndexOf(name);
  assert.ok(index >= 0, `Missing ${name}`);
  return args[index + 1];
}

const cookie = option("--cookies");
assert.equal(await Bun.file(cookie).text(), "original cookie contents\n");
assert.equal((await stat(cookie)).mode & 0o777, 0o600);
await Bun.write(cookie, "modified temporary cookie\n");

if (process.env.FIXTURE_MODE === "failure") {
  console.error("fixture failed");
  process.exit(7);
}

const text = process.env.FIXTURE_MODE === "mismatch" && basename(Bun.argv[1]) === "yt-dlp"
  ? "different transcript" : "Hello caption world";
if (args.includes("--dump-single-json")) {
  assert.ok(args.includes("https://example.invalid/watch?value=literal;data"));
  console.log(JSON.stringify({ text }));
} else {
  assert.equal(process.env.YT_DLP_EXPLODE_PROFILE, undefined);
  assert.ok(args.includes("--no-cache-dir"));
  assert.ok(args.includes("--"));
  assert.equal(option("--sub-format"), "json3");
  assert.equal(option("--sub-langs"), "en");
  await Bun.write(join(option("-P"), "fixture.en.json3"), JSON.stringify({
    events: [{ segs: [{ utf8: text }] }],
  }));
  console.log("fixture stdout");
  console.error("fixture stderr");
}
