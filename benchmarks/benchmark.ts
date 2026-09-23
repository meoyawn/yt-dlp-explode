#!/usr/bin/env bun
import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  collectRuns, errorMessage, fileHash, measure, normalizeWhitespace, platform,
  prepareRun, printRun, readOptions, sha256, summarize, version, writeReport,
  type Options, type Run,
} from "./common.ts";

/** Flatten JSON3 caption segments into comparable transcript text. */
export function normalizedText(data: string) {
  const document: { events?: { segs?: { utf8?: string }[] }[] } = JSON.parse(data);
  const text = normalizeWhitespace((document.events ?? []).flatMap((event) =>
    (event.segs ?? []).map((segment) => segment.utf8 ?? ""),
  ).join(" "));
  if (!text) throw new Error("empty caption text");
  return text;
}

async function runOne(name: string, binary: string, iteration: number, args: Options): Promise<Run> {
  const { runDir, temporary, cookie } = await prepareRun(name, iteration, args);
  const record: Run = { tool: name, iteration, warmup: iteration === 0, success: false, wall_s: 0 };
  try {
    const flags = [
      "--skip-download", "--write-auto-subs", "--sub-langs", "en", "--sub-format", "json3",
      "--no-warnings", "--no-playlist", "--cookies", cookie,
      "--cache-dir", join(args.output, "cache"), "-P", runDir, "-o", "%(id)s.%(ext)s",
      ...(args.coldCache ? ["--no-cache-dir"] : []),
    ];
    record.command = [binary, ...flags.map((flag) => flag === cookie ? "<temporary-cookie-copy>" : flag), "--", args.url];
    const env = { ...process.env };
    delete env.YT_DLP_EXPLODE_PROFILE;
    await measure([binary, ...flags, "--", args.url], runDir, record, env);
    const subtitles = (await readdir(runDir)).filter((file) => file.endsWith(".en.json3"));
    if (subtitles.length !== 1) throw new Error(`expected one English JSON3 subtitle file, got ${subtitles.length}`);
    const data = await Bun.file(join(runDir, subtitles[0])).bytes();
    const text = normalizedText(new TextDecoder().decode(data));
    record.caption_bytes = data.length;
    record.words = text.split(" ").length;
    record.normalized_sha256 = sha256(text);
    record.subtitle_sha256 = sha256(data);
    record.success = true;
  } catch (error) {
    record.error = errorMessage(error);
  } finally {
    await $`rm -rf ${temporary}`;
  }
  printRun(record);
  return record;
}

/** Measure complete subtitle pulls by the yt-dlp and yt-dlp-explode CLIs. */
async function main() {
  const args = await readOptions("direct");
  if (!args) return 0;
  const variants: [string, string][] = [["yt-dlp-explode", args.binary], ["yt-dlp", args.ytDlp]];
  if (args.bunBinary) variants.push(["yt-dlp-explode-bun", args.bunBinary]);
  const versions: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const [name, binary] of variants) {
    versions[name] = await version(binary);
    hashes[name] = await fileHash(binary);
  }
  const report = {
    date_utc: new Date().toISOString(), platform: platform(), video_url: args.url,
    executables: Object.fromEntries(variants), versions, executable_sha256: hashes,
    binary_bytes: Bun.file(args.binary).size, max_median_s: args.maxMedian,
    executable_bytes: Object.fromEntries(variants.map(([name, binary]) => [name, Bun.file(binary).size])),
    method: "Direct CLIs, identical flags, normal user config discovery, fresh process/output/cookie copy each run. One excluded warmup starting with an empty tool cache, alternating order, two-second pauses outside timing. Wall includes process startup, extraction, subtitle download/write and cookie save. Build, cookie copying and output validation excluded. macOS time -l measures child peak RSS.",
    cache_policy: args.coldCache ? "disabled for all tools" : "same initially empty cache directory, reused after excluded warmup; no caption cache",
    runs: [] as Run[],
  };
  await collectRuns(args, report, variants, runOne);
  const result = {
    ...report, ...summarize(report.runs, variants.map(([name]) => name)),
    executables_unchanged: true, speed_ratio: undefined as number | undefined,
    target_met: undefined as boolean | undefined,
  };
  for (const [name, binary] of variants) {
    if (await fileHash(binary) !== hashes[name] || await version(binary) !== versions[name]) {
      result.executables_unchanged = false;
    }
  }
  let success = result.executables_unchanged && result.matching_transcripts
    && Object.values(result.summary).every((summary) => summary.successes === args.runs);
  if (success) {
    const native = result.summary["yt-dlp-explode"].median_wall_s!;
    result.speed_ratio = result.summary["yt-dlp"].median_wall_s! / native;
    result.target_met = args.maxMedian === null || native <= args.maxMedian;
    success = result.target_met;
  }
  await writeReport(args.output, result);
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(`Matching: ${result.matching_transcripts}; artifacts: ${args.output}`);
  return success ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
