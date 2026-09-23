import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { normalizedText } from "./benchmark.ts";
import { sha256, summarize, type Run, type Summary } from "./common.ts";

const scenarios = [
  { entry: "benchmark.ts", mode: "success", status: 0, maxMedian: "100", includeBun: true },
  { entry: "benchmark.ts", mode: "mismatch", status: 1, maxMedian: "100" },
  { entry: "benchmark.ts", mode: "failure", status: 1, maxMedian: "100" },
  { entry: "benchmark.ts", mode: "success", status: 1, maxMedian: "0" },
  { entry: "script-benchmark.ts", mode: "success", status: 0, maxMedian: "100" },
  { entry: "script-benchmark.ts", mode: "failure", status: 1, maxMedian: "100" },
];

describe("benchmark reports", () => {
  test("normalizes JSON3 segments and rejects empty captions", () => {
    expect(normalizedText(JSON.stringify({ events: [
      {}, { segs: [{ utf8: " Hello\n" }, {}, { utf8: "caption\t world " }] },
    ] }))).toEqual("Hello caption world");
    expect(() => normalizedText('{"events": []}')).toThrow("empty caption text");
    expect(() => normalizedText("broken json")).toThrow();
  });

  test("excludes warmups and failed pulls from time and RSS medians", () => {
    const runs: Run[] = [
      { tool: "native", iteration: 0, warmup: true, success: true, wall_s: 100, normalized_sha256: "warmup" },
      { tool: "native", iteration: 1, warmup: false, success: true, wall_s: 1, normalized_sha256: "same", peak_rss_bytes: 10 },
      { tool: "native", iteration: 2, warmup: false, success: false, wall_s: 0.1 },
      { tool: "native", iteration: 3, warmup: false, success: true, wall_s: 3, normalized_sha256: "same", peak_rss_bytes: 30 },
    ];
    expect(summarize(runs, ["native"])).toEqual({
      summary: { native: { successes: 2, attempts: 3, median_wall_s: 2, min_wall_s: 1, max_wall_s: 3, median_peak_rss_bytes: 20 } },
      matching_transcripts: true,
    });
    expect(summarize([], ["native"]).matching_transcripts).toEqual(false);
  });

  for (const entry of ["benchmark.ts", "script-benchmark.ts"]) {
    test(`${entry} rejects invalid CLI arguments`, async () => {
      const script = join(import.meta.dir, entry);
      for (const flags of [[], ["--cookies", "unused", "--runs", "0"], ["--unknown"]]) {
        const result = await $`${process.execPath} ${script} ${flags}`.quiet().nothrow();
        expect(result.exitCode).toEqual(2);
        expect(result.stderr.length).toBeGreaterThan(0);
      }
    });
  }

  for (const scenario of scenarios) {
    test.skipIf(process.platform === "win32").concurrent(`${scenario.entry}: ${scenario.mode}, target ${scenario.maxMedian}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "benchmark space ' quote-"));
      try {
        const cookie = join(root, "cookies.txt");
        await Bun.write(cookie, "original cookie contents\n");
        for (const name of ["yt-dlp", "yt-dlp-explode", ...(scenario.includeBun ? ["yt-dlp-explode-bun"] : [])]) {
          const executable = join(root, name);
          await copyFile(join(import.meta.dir, "fixtures", "caption-cli.ts"), executable);
          await chmod(executable, 0o700);
        }
        const script = join(root, "transcribe.ts");
        await copyFile(join(import.meta.dir, "fixtures", "transcribe.ts"), script);
        await chmod(script, 0o700);
        const output = join(root, "output");
        const flags = [
          "--cookies", cookie, "--binary", join(root, "yt-dlp-explode"), "--runs", "1", "--output", output,
          "--url", "https://example.invalid/watch?value=literal;data",
          ...(scenario.entry === "benchmark.ts"
            ? ["--yt-dlp", join(root, "yt-dlp"), "--cold-cache", "--max-median", scenario.maxMedian,
              ...(scenario.includeBun ? ["--bun-binary", join(root, "yt-dlp-explode-bun")] : [])]
            : ["--script", script]),
        ];
        const result = await $`${process.execPath} ${join(import.meta.dir, scenario.entry)} ${flags}`.env({
          ...process.env,
          PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
          FIXTURE_MODE: scenario.mode,
          YT_DLP_EXPLODE_PROFILE: "must-be-removed-from-direct-runs",
        }).quiet().nothrow();
        expect(result.exitCode).toEqual(scenario.status);
        const report: {
          runs: Run[];
          summary: Record<string, Summary>;
          matching_transcripts: boolean;
          target_met?: boolean;
          executables_unchanged?: boolean;
        } = await Bun.file(join(output, "results.json")).json();
        expect(report.runs.map((run) => [run.tool, run.iteration, run.warmup])).toEqual([
          ["yt-dlp-explode", 0, true], ["yt-dlp", 0, true],
          ...(scenario.includeBun ? [["yt-dlp-explode-bun", 0, true], ["yt-dlp-explode-bun", 1, false]] : []),
          ["yt-dlp", 1, false], ["yt-dlp-explode", 1, false],
        ]);
        expect(report.matching_transcripts).toEqual(scenario.mode === "success");
        for (const summary of Object.values(report.summary)) {
          expect(summary.attempts).toEqual(1);
          expect(summary.successes).toEqual(scenario.mode === "failure" ? 0 : 1);
        }
        if (scenario.entry === "benchmark.ts") {
          expect(report.executables_unchanged).toEqual(true);
          expect(report.runs.every((run) => run.command?.includes("<temporary-cookie-copy>"))).toEqual(true);
          if (scenario.mode === "success") expect(report.target_met).toEqual(scenario.maxMedian !== "0");
        }
        if (scenario.mode === "failure") {
          expect(report.runs.every((run) => run.returncode === 7 && run.error?.includes("process exited 7"))).toEqual(true);
        } else if (scenario.mode === "success") {
          const normalized = scenario.entry === "benchmark.ts" ? "Hello caption world" : "Hello caption world more words";
          expect(report.runs.every((run) => run.normalized_sha256 === sha256(normalized))).toEqual(true);
        }
        expect(await Bun.file(cookie).text()).toEqual("original cookie contents\n");
      } finally {
        await $`rm -rf ${root}`;
      }
    }, 30_000);
  }
});
