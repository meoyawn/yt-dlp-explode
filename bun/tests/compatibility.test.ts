import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptionInfo, query, videoId, type PlayerResponse } from "../src/caption-info.ts";
import { loadConfiguration, tokenize } from "../src/configuration.ts";
import { createCookieJar } from "../src/cookie-jar.ts";
import { parseOptions } from "../src/options.ts";

const temporary = () => mkdtemp(join(tmpdir(), "explode-bun-tests-"));

describe("C# option and configuration contract", () => {
  test("aliases, toggles, typed paths, repeated extractor args and simulation", () => {
    const options = parseOptions(["--cookies", "x", "--no-cookies", "-J", "--write-auto-sub", "--no-write-auto-subs",
      "--write-srt", "--all-subs", "--no-simulate", "--skip-download", "-Psubtitle:subs", "-o%(id)s.%(ext)s",
      "--extractor-args", "youtube:player_client=web_embedded", "--extractor-args", "youtube:player_client=default,web_embedded", "id"]);
    expect(options.cookies).toEqual(null);
    expect(options.isSimulation).toEqual(false);
    expect(options.writeAutoSubs).toEqual(false);
    expect(options.writeSubs).toEqual(true);
    expect(options.subLanguages).toEqual(["all"]);
    expect(options.paths.get("subtitle")).toEqual("subs");
    expect(options.playerClients).toEqual("default,web_embedded");
    expect(parseOptions(["-J", "id"]).isSimulation).toEqual(true);
    expect(parseOptions(["--list-subs", "--", "-abcdefghij"]).urls).toEqual(["-abcdefghij"]);
    for (const args of [[], ["id"], ["--bogus"], ["--cookies"], ["-J", "--socket-timeout=NaN", "id"],
      ["-J", "--socket-timeout=0", "id"], ["-J", "--extractor-args", "youtube:player_client=web", "id"]])
      expect(() => parseOptions(args)).toThrow();
  });

  test("shell quotes, comments, empty arguments and malformed quoting", () => {
    expect(tokenize(`--cookies 'a b.txt' # comment\n--output "%(title)s \\"quote\\".%(ext)s" --no-warnings`))
      .toEqual(["--cookies", "a b.txt", "--output", '%(title)s "quote".%(ext)s', "--no-warnings"]);
    expect(tokenize(`--output '' --cookies "a\\b"`)).toEqual(["--output", "", "--cookies", "a\\b"]);
    expect(() => tokenize("'open")).toThrow("Unclosed");
    expect(() => tokenize("escape\\")).toThrow("Trailing");
  });

  test("portable > home > user, includes, cycles, reset, stdin and UTF-16 BOM", async () => {
    const root = await temporary();
    try {
      const home = join(root, "home"), executableDirectory = join(root, "portable"), workingDirectory = join(root, "work");
      await Promise.all([mkdir(join(home, ".yt-dlp"), { recursive: true }), mkdir(executableDirectory), mkdir(workingDirectory)]);
      await Bun.write(join(home, ".yt-dlp/config.txt"), "--cookies user.txt\n--sub-langs en");
      await Bun.write(join(workingDirectory, "yt-dlp.conf"), "--cookies home.txt\n--sub-format json3");
      await Bun.write(join(executableDirectory, "yt-dlp.conf"), "--cookies portable.txt");
      const context = { home, executableDirectory, workingDirectory, systemDirectory: join(root, "etc/yt-dlp"), env: {} };
      async function load(args: string[] = []) {
        return parseOptions((await loadConfiguration([...args, "--skip-download", "4Ff0xc9M8kA"], context)).args);
      }
      expect((await load()).cookies).toEqual("portable.txt");
      expect((await load()).subFormat).toEqual("json3");
      expect((await load()).subLanguages).toEqual(["en"]);
      expect((await load(["--cookies", "cli.txt"])).cookies).toEqual("cli.txt");
      expect((await load(["--no-cookies"])).cookies).toEqual(null);
      expect((await load(["--ignore-config"])).cookies).toEqual(null);
      await Bun.write(join(root, "custom.conf"), "--cookies custom.txt\n--config-locations child.conf");
      await Bun.write(join(root, "child.conf"), "--cookies child.txt\n--sub-format vtt\n--config-locations custom.conf");
      const include = ["--ignore-config", "--config-locations", join(root, "custom.conf")];
      expect((await load(include)).cookies).toEqual("custom.txt");
      expect((await load(include)).subFormat).toEqual("vtt");
      expect((await load([...include, "--no-config-locations"])).cookies).toEqual(null);
      await Bun.write(join(executableDirectory, "yt-dlp.conf"), "--ignore-config\n--cookies portable.txt");
      expect((await load()).subFormat).toEqual("best");
      const stdin = await loadConfiguration(["--ignore-config", "--config-locations", "-"], { ...context, stdin: async () => "--cookies stdin.txt" });
      expect(parseOptions(stdin.args, false).cookies).toEqual("stdin.txt");
      await Bun.write(join(root, "utf16.conf"), Buffer.from("\ufeff--cookies unicode.txt", "utf16le"));
      expect((await load(["--ignore-config", "--config-locations", join(root, "utf16.conf")])).cookies).toEqual("unicode.txt");
    } finally { await $`rm -rf ${root}`.quiet(); }
  });
});

describe("Netscape cookie persistence", () => {
  test("scope, HttpOnly, session cookies, expiry, updates, deletions, concurrent saves and permissions", async () => {
    const root = await temporary();
    try {
      const path = join(root, "cookies.txt");
      await Bun.write(path, "# Netscape HTTP Cookie File\n"
        + "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tLOGIN_INFO\tlogin\n"
        + ".youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tsession\n"
        + "example.org\tFALSE\t/\tFALSE\t0\tforeign\tkeep\n"
        + ".youtube.com\tTRUE\t/\tTRUE\t1\texpired\tkeep-expired\n"
        + "www.youtube.com\tFALSE\t/\tTRUE\t\thost\tonly\n"
        + ".youtube.com\tTRUE\t/\tFALSE\t0\t\tnameless\n");
      const jar = await createCookieJar(path);
      expect(jar.cookies("https://www.youtube.com/").map(c => c.name)).toEqual(["LOGIN_INFO", "SAPISID", "host"]);
      expect(jar.cookies("https://sub.www.youtube.com/").map(c => c.name)).toEqual(["LOGIN_INFO", "SAPISID"]);
      expect(jar.header("http://www.youtube.com/")).toEqual("");
      jar.receive("https://www.youtube.com/", new Headers({ "set-cookie": "SAPISID=updated; Domain=.youtube.com; Path=/; Secure; HttpOnly" }));
      await jar.save();
      const saved = await Bun.file(path).text();
      for (const value of ["foreign\tkeep", "expired\tkeep-expired", "\t\tnameless", "#HttpOnly_.youtube.com"])
        expect(saved).toContain(value);
      expect((await createCookieJar(path)).header("https://www.youtube.com/")).toContain("SAPISID=updated");
      const first = await createCookieJar(path), second = await createCookieJar(path);
      first.receive("https://www.youtube.com/", new Headers({ "set-cookie": "first=one; Path=/" }));
      second.receive("https://www.youtube.com/", new Headers({ "set-cookie": "second=two; Path=/" }));
      await Promise.all([first.save(), second.save()]);
      const merged = await createCookieJar(path);
      expect(merged.header("https://www.youtube.com/")).toContain("first=one");
      expect(merged.header("https://www.youtube.com/")).toContain("second=two");
      merged.receive("https://www.youtube.com/", new Headers({ "set-cookie": "SAPISID=; Domain=youtube.com; Path=/; Max-Age=0; Secure" }));
      await merged.save();
      expect((await createCookieJar(path)).header("https://www.youtube.com/")).not.toContain("SAPISID=");
      if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toEqual(0o600);
    } finally { await $`rm -rf ${root}`.quiet(); }
  });

  test("invalid jars remain untouched; no-cookies never writes; request path boundaries and response scope", async () => {
    const root = await temporary();
    try {
      const path = join(root, "invalid.txt");
      await Bun.write(path, "[]");
      await expect(createCookieJar(path)).rejects.toThrow("Netscape");
      expect(await Bun.file(path).text()).toEqual("[]");
      const jar = await createCookieJar(null);
      const url = "https://www.youtube.com/api/player";
      jar.receive(url, new Headers({ "set-cookie": "scoped=value; Secure" }));
      jar.receive(url, new Headers({ "set-cookie": "foreign=value; Domain=example.org" }));
      jar.receive(url, new Headers({ "set-cookie": "suffix=value; Domain=com" }));
      expect(jar.header(url)).toEqual("scoped=value");
      expect(jar.header("https://www.youtube.com/apix")).toEqual("");
      expect(jar.header("https://www.youtube.com/")).toEqual("");
      expect(jar.header("https://example.org/api")).toEqual("");
      await jar.save();
      const fresh = await createCookieJar(join(root, "new.txt"));
      fresh.receive(url, new Headers({ "set-cookie": "new=yes; Path=/" }));
      await fresh.save();
      expect((await createCookieJar(join(root, "new.txt"))).header(url)).toEqual("new=yes");
    } finally { await $`rm -rf ${root}`.quiet(); }
  });
});

describe("caption metadata and selection", () => {
  test("matches C# JSON, manual preference, translations, exclusions, output paths and formats", () => {
    const player: PlayerResponse = { videoDetails: { title: "Example/title", author: "Creator", lengthSeconds: "42" },
      captions: { playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: "https://www.youtube.com/api/timedtext?lang=en&xosf=1", languageCode: "en", name: { simpleText: "English" } },
          { baseUrl: "https://www.youtube.com/api/timedtext?lang=en&kind=asr&xosf=1", languageCode: "en", name: { simpleText: "English auto" }, kind: "asr" },
          { baseUrl: "https://www.youtube.com/api/timedtext?lang=fr", languageCode: "fr", name: { simpleText: "French" } },
        ], translationLanguages: [{ languageCode: "de", languageName: { simpleText: "German" } }],
      } } };
    const opts = parseOptions(["--skip-download", "--write-subs", "--write-auto-subs", "-o", "%(id)s.%(ext)s", "id"]);
    const info = createCaptionInfo("4Ff0xc9M8kA", "original", player, opts);
    info.select(() => undefined);
    expect([...info.selected.keys()]).toEqual(["en"]);
    expect(info.selected.get("en")?.subtitle.automatic).toEqual(false);
    expect(info.filename("en", "vtt")).toEqual(join(process.cwd(), "4Ff0xc9M8kA.en.vtt"));
    expect(info.json()).toMatchObject({ id: "4Ff0xc9M8kA", title: "Example/title", duration: 42, description: null,
      language: "en", requested_subtitles: { en: { ext: "vtt", name: "English" } } });
    expect(info.json().automatic_captions["en-orig"][0].ext).toEqual("json3");
    expect(info.json().subtitles.en[0].url).not.toContain("xosf");
    expect(info.automatic.get("de")?.url).toContain("tlang=de");
    expect(info.automatic.has("de-en")).toEqual(true);
    opts.subLanguages = ["all", "-en.*", "-de.*"];
    opts.subFormat = "unavailable/json3";
    info.select(() => undefined);
    expect([...info.selected.keys()]).toEqual(["fr"]);
    expect(info.json().requested_subtitles?.fr.ext).toEqual("json3");
    opts.subFormat = "unavailable";
    const warnings: string[] = [];
    info.select(message => warnings.push(message));
    expect(warnings).toHaveLength(1);
    opts.templates.set("subtitle", "%(title)s.%(duration)05d.%%.%(ext)s");
    expect(info.filename("fr", "vtt")).toEndWith("Example⧸title.00042.%.fr.vtt");
    opts.templates.set("subtitle", "");
    expect(info.filename("fr", "vtt")).toEqual("");
    opts.extractorArguments.set("skip", "translated_subs");
    expect(createCaptionInfo("id", "url", player, opts).automatic.has("de")).toEqual(false);
    expect(createCaptionInfo("id", "url", {}, opts).json().requested_subtitles).toEqual(null);
  });

  test("URL rewriting preserves signature encoding and video ID formats", () => {
    expect(query("https://www.youtube.com/api/timedtext?sig=a%20b&xosf=1&format=3&fmt=vtt", "fmt", "json3"))
      .toEqual("https://www.youtube.com/api/timedtext?sig=a%20b&fmt=json3");
    for (const url of ["4Ff0xc9M8kA", "https://youtu.be/4Ff0xc9M8kA?x=1", "https://www.youtube.com/watch?v=4Ff0xc9M8kA&list=foo",
      "https://youtube.com/shorts/4Ff0xc9M8kA", "https://youtube.com/live/4Ff0xc9M8kA", "https://youtube.com/embed/4Ff0xc9M8kA"])
      expect(videoId(url)).toEqual("4Ff0xc9M8kA");
    expect(() => videoId("invalid-video-id")).toThrow("Invalid YouTube");
  });
});
