import { $ } from "bun";
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import type { PlayerResponse } from "../src/caption-info.ts";

describe("complete CLI workflow with fixture captions", () => {
  test("simulation, JSON stdout, atomic subtitle writes, overwrite policy, sequential URLs and failure codes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bun-cli-flow-"));
    const stdout: string[] = [], stderr: string[] = [], seen: string[] = [];
    const log = spyOn(console, "log").mockImplementation(value => { stdout.push(String(value)); });
    const error = spyOn(console, "error").mockImplementation(value => { stderr.push(String(value)); });
    let downloads = 0;
    const player: PlayerResponse = { videoDetails: { title: "Fixture" }, captions: { playerCaptionsTracklistRenderer: {
      captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?lang=en", languageCode: "en", kind: "asr", name: { simpleText: "English" } }],
    } } };
    function session() {
      return { requestCount: 0,
        async manifest(id: string) { seen.push(id); return player; },
        async download() { downloads++; return new TextEncoder().encode('{"events":[{"segs":[{"utf8":"Fixture text"}]}]}'); } };
    }
    const flags = ["--ignore-config", "--skip-download", "--write-auto-subs", "--sub-langs", "en", "--sub-format", "json3",
      "-P", directory, "-o", "%(id)s.%(ext)s"];
    const path = join(directory, "4Ff0xc9M8kA.en.json3");
    try {
      expect(await main([...flags, "-J", "4Ff0xc9M8kA"], session)).toEqual(0);
      expect(JSON.parse(stdout.pop()!).requested_subtitles.en.filepath).toEqual(undefined);
      expect(await Bun.file(path).exists()).toEqual(false);
      expect(downloads).toEqual(0);
      expect(await main([...flags, "-J", "--no-simulate", "4Ff0xc9M8kA"], session)).toEqual(0);
      expect(JSON.parse(stdout.pop()!).requested_subtitles.en.filepath).toEqual(path);
      expect(downloads).toEqual(1);
      await Bun.write(path, "preserve me");
      expect(await main([...flags, "4Ff0xc9M8kA"], session)).toEqual(0);
      expect(await Bun.file(path).text()).toEqual("preserve me");
      expect(downloads).toEqual(1);
      expect(await main([...flags, "--force-overwrites", "4Ff0xc9M8kA"], session)).toEqual(0);
      expect(await Bun.file(path).text()).toContain("Fixture text");
      expect(downloads).toEqual(2);
      expect((await readdir(directory)).filter(path => path.endsWith(".part"))).toEqual([]);
      expect(await main([...flags, "-J", "-i", "invalid", "abcdefghijk"], session)).toEqual(1);
      expect(JSON.parse(stdout.pop()!).id).toEqual("abcdefghijk");
      expect(seen.at(-1)).toEqual("abcdefghijk");
      expect(stderr.some(line => line.startsWith("ERROR: Invalid YouTube"))).toEqual(true);
      expect(await main(["--ignore-config", "--bogus"], session)).toEqual(2);
      expect(await main([...flags, "--list-subs", "4Ff0xc9M8kA"], session)).toEqual(0);
      expect(stdout.some(line => line.includes("Available automatic captions"))).toEqual(true);
    } finally { log.mockRestore(); error.mockRestore(); await $`rm -rf ${directory}`.quiet(); }
  });
});
