#!/usr/bin/env bun
import { $ } from "bun";
import { chmod, copyFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import {
  collectRuns, errorMessage, fileHash, measure, normalizeWhitespace, platform,
  prepareRun, printRun, readOptions, sha256, summarize, version, writeReport,
  type Options, type Run,
} from "./common.ts";

async function runOne(tool: string, binary: string, iteration: number, args: Options): Promise<Run> {
  const { runDir, temporary, cookie } = await prepareRun(tool, iteration, args);
  const command = [args.script!, "--file", args.url];
  const record: Run = {
    tool, iteration, warmup: iteration === 0, success: false, wall_s: 0,
    script_command: command, wrapped_executable: binary,
  };
  try {
    const wrapper = join(temporary, "yt-dlp");
    await Bun.write(wrapper, [
      "#!/usr/bin/env bun",
      'import { $ } from "bun";',
      `const binary = ${JSON.stringify(binary)};`,
      `const cookie = ${JSON.stringify(cookie)};`,
      'const result = await $`${binary} ${Bun.argv.slice(2)} --cookies ${cookie}`.nothrow();',
      "process.exitCode = result.exitCode;",
      "",
    ].join("\n"));
    await chmod(wrapper, 0o700);
    const env = {
      ...process.env,
      PATH: `${temporary}${delimiter}${process.env.PATH ?? ""}`,
      TRANSCRIBE_CACHE_DIR: join(temporary, "cache"),
    };
    const stdout = await measure(command, runDir, record, env);
    const source = resolve(stdout.trim());
    if (dirname(source) !== join(temporary, "cache", "youtube-transcripts")) {
      throw new Error("script fell back to audio transcription");
    }
    const text = await Bun.file(source).text();
    await copyFile(source, join(runDir, "transcript.txt"));
    const normalized = normalizeWhitespace(text.replace(/^\[(?:\d+:)?\d{2}:\d{2}\]\s*/gm, ""));
    if (!normalized) throw new Error("empty transcript");
    record.words = normalized.split(" ").length;
    record.normalized_sha256 = sha256(normalized);
    record.success = true;
  } catch (error) {
    record.error = errorMessage(error);
  } finally {
    await $`rm -rf ${temporary}`;
  }
  printRun(record);
  return record;
}

/** Compare an unchanged transcript script with either executable on PATH. */
async function main() {
  const args = await readOptions("script");
  if (!args) return 0;
  const variants: [string, string][] = [["yt-dlp-explode", args.binary], ["yt-dlp", args.ytDlp]];
  const report = {
    date_utc: new Date().toISOString(), platform: platform(), video_url: args.url,
    script: args.script, script_sha256: await fileHash(args.script!),
    binary_sha256: await fileHash(args.binary), binary_bytes: Bun.file(args.binary).size,
    yt_dlp_version: await version(args.ytDlp),
    method: "Same unchanged transcript script, fresh processes/caches/cookie copies; only PATH's yt-dlp executable differs. One excluded warmup, alternating order, two-second pauses outside timing. RSS from macOS time -l is not summed process-tree memory. Each yt-dlp invocation includes a Bun Shell wrapper.",
    runs: [] as Run[],
  };
  await collectRuns(args, report, variants, runOne);
  const result = {
    ...report, ...summarize(report.runs, variants.map(([name]) => name)),
    speed_ratio: undefined as number | undefined,
  };
  const success = result.matching_transcripts && Object.values(result.summary).every((summary) => summary.successes === args.runs);
  if (success) result.speed_ratio = result.summary["yt-dlp"].median_wall_s! / result.summary["yt-dlp-explode"].median_wall_s!;
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
