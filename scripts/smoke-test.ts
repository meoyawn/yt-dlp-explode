#!/usr/bin/env bun
import { $ } from "bun";
import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithTimeout } from "./process.ts";

/** Exercise the published native entry point without YouTube or real cookies. */
async function main() {
  if (Bun.argv.length !== 3 || ["-h", "--help"].includes(Bun.argv[2])) {
    console.log("Usage: bun scripts/smoke-test.ts <published-executable>");
    return Bun.argv.length === 3 ? 0 : 2;
  }
  const binary = await realpath(Bun.argv[2]);
  const cases: [string[], number][] = [
    [[], 2],
    [["--bogus"], 2],
    [["--skip-download", "invalid-video-id"], 1],
    [["--skip-download", "4Ff0xc9M8kA", "--sub-langs"], 2],
    [["--cookies", "missing", "--no-cookies", "--skip-download", "invalid-video-id"], 1],
    [["--help"], 0],
    [["--version"], 0],
  ];
  for (const [args, expected] of cases) {
    const result = await runWithTimeout([binary, "--ignore-config", ...args], 15_000);
    assert.equal(result.exitCode, expected, `${JSON.stringify(args)}: ${result.stderr}`);
    if (expected) {
      assert.equal(result.stdout.length, 0, JSON.stringify(args));
    } else {
      assert.ok(result.stdout.length > 0);
      assert.equal(result.stderr.length, 0);
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "explode-smoke-"));
  try {
    const cookie = join(directory, "cookies.txt");
    await Bun.write(cookie, "[]");
    const result = await runWithTimeout([
      binary, "--ignore-config", "--cookies", cookie, "--skip-download", "4Ff0xc9M8kA",
    ], 15_000);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.equal(await Bun.file(cookie).text(), "[]");
  } finally {
    await $`rm -rf ${directory}`;
  }
  console.log("8 native CLI smoke checks passed.");
  return 0;
}

if (import.meta.main) process.exitCode = await main();
