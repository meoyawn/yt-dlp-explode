import { $ } from "bun";
import { chmod, copyFile, mkdir, mkdtemp, realpath } from "node:fs/promises";
import { homedir, release, tmpdir, type } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runWithTimeout } from "../scripts/process.ts";

export interface Options {
  cookies: string;
  binary: string;
  ytDlp: string;
  bunBinary?: string;
  url: string;
  runs: number;
  output: string;
  script?: string;
  coldCache: boolean;
  maxMedian: number | null;
}

export interface Run {
  tool: string;
  iteration: number;
  warmup: boolean;
  success: boolean;
  wall_s: number;
  returncode?: number;
  error?: string;
  command?: string[];
  script_command?: string[];
  wrapped_executable?: string;
  caption_bytes?: number;
  words?: number;
  normalized_sha256?: string;
  subtitle_sha256?: string;
  peak_rss_bytes?: number;
}

export interface Summary {
  successes: number;
  attempts: number;
  median_wall_s?: number;
  min_wall_s?: number;
  max_wall_s?: number;
  median_peak_rss_bytes?: number;
}

export const sha256 = (data: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
export const fileHash = async (path: string) => sha256(await Bun.file(path).bytes());
export const version = async (binary: string) => (await $`${binary} --version`.text()).trim();
export const platform = () => `${type()}-${release()}-${process.arch}`;
export const normalizeWhitespace = (text: string) => text.replace(/\s+/gu, " ").trim();
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const absolutePath = (path: string) => resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

function timestamp() {
  const date = new Date();
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"));
  return `${parts.slice(0, 3).join("")}-${parts.slice(3).join("")}`;
}

export async function readOptions(mode: "direct" | "script"): Promise<Options | undefined> {
  let values;
  try {
    ({ values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        cookies: { type: "string" },
        binary: { type: "string", default: resolve(import.meta.dir, "../artifacts/osx-arm64/yt-dlp-explode") },
        url: { type: "string", default: "https://www.youtube.com/watch?v=4Ff0xc9M8kA" },
        runs: { type: "string", default: "5" },
        output: { type: "string" },
        help: { type: "boolean", short: "h" },
        "yt-dlp": { type: "string" },
        "bun-binary": { type: "string" },
        "cold-cache": { type: "boolean" },
        "max-median": { type: "string" },
        script: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
    for (const option of mode === "direct" ? ["script"] as const : ["yt-dlp", "bun-binary", "cold-cache", "max-median"] as const) {
      if (values[option] !== undefined) throw new Error(`Unknown option --${option}`);
    }
    if (values.help) {
      console.log(`Usage: bun benchmarks/${mode === "direct" ? "benchmark" : "script-benchmark"}.ts --cookies FILE${mode === "script" ? " --script FILE" : ""}
  --binary FILE     Native executable (default: artifacts/osx-arm64/yt-dlp-explode)
  --url URL         Video URL (default: https://www.youtube.com/watch?v=4Ff0xc9M8kA)
  --runs COUNT      Measured runs per tool (default: 5), plus one excluded warmup
  --output DIR      New output directory (default: artifacts/benchmarks/TIMESTAMP)
${mode === "direct" ? `  --yt-dlp FILE     Baseline executable (default: yt-dlp on PATH)
  --bun-binary FILE Include the compiled Bun CLI as a third implementation
  --cold-cache      Disable all tools' disk caches for every invocation
  --max-median SEC  Fail if the native median exceeds this many seconds` : "  --script FILE     Unchanged transcript script; baseline yt-dlp must be on PATH"}`);
      return;
    }
    if (!values.cookies) throw new Error("--cookies is required");
    if (mode === "script" && !values.script) throw new Error("--script is required");
    if (!/^[0-9]+$/.test(values.runs) || !Number.isSafeInteger(Number(values.runs)) || Number(values.runs) < 1) {
      throw new Error("--runs must be positive");
    }
    if (values["max-median"] !== undefined && !Number.isFinite(Number(values["max-median"]))) {
      throw new Error("--max-median must be a finite number");
    }
    if (!values["yt-dlp"] && !Bun.which("yt-dlp")) {
      throw new Error(`yt-dlp is required on PATH${mode === "direct" ? " or via --yt-dlp" : " for the baseline"}`);
    }
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(2);
  }
  const output = absolutePath(values.output ?? resolve(import.meta.dir, "../artifacts/benchmarks", timestamp()));
  const options: Options = {
    cookies: await realpath(absolutePath(values.cookies!)),
    binary: absolutePath(values.binary),
    ytDlp: absolutePath(values["yt-dlp"] ?? Bun.which("yt-dlp")!),
    bunBinary: values["bun-binary"] ? absolutePath(values["bun-binary"]) : undefined,
    url: values.url,
    runs: Number(values.runs),
    output,
    script: values.script ? await realpath(absolutePath(values.script)) : undefined,
    coldCache: values["cold-cache"] ?? false,
    maxMedian: values["max-median"] === undefined ? null : Number(values["max-median"]),
  };
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  return options;
}

export async function prepareRun(name: string, iteration: number, args: Options) {
  const runDir = join(args.output, `${String(iteration).padStart(2, "0")}-${name}`);
  await mkdir(runDir);
  const temporary = await mkdtemp(join(tmpdir(), "caption-benchmark-"));
  try {
    const cookie = join(temporary, "cookies.txt");
    await copyFile(args.cookies, cookie);
    await chmod(cookie, 0o600);
    return { runDir, temporary, cookie };
  } catch (error) {
    await $`rm -rf ${temporary}`;
    throw error;
  }
}

export async function measure(command: string[], runDir: string, record: Run, env = process.env) {
  const resources = join(runDir, "resources.log");
  const measured = process.platform === "darwin" ? ["/usr/bin/time", "-l", "-o", resources, ...command] : command;
  const start = performance.now();
  try {
    const result = await runWithTimeout(measured, 120_000, env);
    record.wall_s = (performance.now() - start) / 1000;
    record.returncode = result.exitCode;
    await Bun.write(join(runDir, "stderr.log"), result.stderr);
    await Bun.write(join(runDir, "stdout.log"), result.stdout);
    if (result.exitCode) throw new Error(`process exited ${result.exitCode}`);
    if (await Bun.file(resources).exists()) {
      const match = /(\d+)\s+maximum resident set size/.exec(await Bun.file(resources).text());
      if (match) record.peak_rss_bytes = Number(match[1]);
    }
    return result.stdout.toString();
  } catch (error) {
    record.wall_s = (performance.now() - start) / 1000;
    throw error;
  }
}

export const printRun = (record: Run) => console.log(`${record.tool.padEnd(16)} ${record.iteration}: ${record.wall_s.toFixed(3)}s ${record.success ? "OK" : record.error}`);

export function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(runs: Run[], tools: string[]) {
  const summary: Record<string, Summary> = {};
  for (const tool of tools) {
    const measured = runs.filter((run) => run.tool === tool && !run.warmup);
    const successful = measured.filter((run) => run.success);
    const result: Summary = { successes: successful.length, attempts: measured.length };
    if (successful.length) {
      const times = successful.map((run) => run.wall_s);
      result.median_wall_s = median(times);
      result.min_wall_s = Math.min(...times);
      result.max_wall_s = Math.max(...times);
      if (successful.every((run) => run.peak_rss_bytes !== undefined)) {
        result.median_peak_rss_bytes = median(successful.map((run) => run.peak_rss_bytes!));
      }
    }
    summary[tool] = result;
  }
  const hashes = new Set(runs.filter((run) => run.success && !run.warmup).map((run) => run.normalized_sha256));
  return { summary, matching_transcripts: hashes.size === 1 };
}

export const writeReport = (output: string, report: object) => Bun.write(join(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`);

export async function collectRuns(
  args: Options,
  report: { runs: Run[] },
  variants: [string, string][],
  runOne: (name: string, binary: string, iteration: number, args: Options) => Promise<Run>,
) {
  for (let iteration = 0; iteration <= args.runs; iteration++) {
    for (const [name, binary] of iteration % 2 ? variants.toReversed() : variants) {
      report.runs.push(await runOne(name, binary, iteration, args));
      await writeReport(args.output, report);
      await Bun.sleep(2_000);
    }
  }
}
