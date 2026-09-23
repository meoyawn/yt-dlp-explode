import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptionSession, embeddedConfig } from "../src/caption-session.ts";
import { createCookieJar } from "../src/cookie-jar.ts";
import { createHttp } from "../src/http.ts";
import { parseOptions } from "../src/options.ts";
import { createPlayerCache } from "../src/player-cache.ts";

describe("cookie-aware HTTP transport", () => {
  test("captures redirect cookies, replaces stale auth and strips credentials across origins", async () => {
    const jar = await createCookieJar(null);
    jar.receive("https://www.youtube.com/", new Headers({ "set-cookie": "SAPISID=original; Domain=.youtube.com; Secure; Path=/" }));
    const requests: { url: string; headers: Headers; method?: string }[] = [];
    const http = createHttp(jar, 1, null, new AbortController().signal, async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers), method: init?.method });
      if (requests.length === 1) return new Response(null, { status: 302, headers: { location: "/next", "set-cookie": "SAPISID=rotated; Domain=.youtube.com; Secure; Path=/" } });
      if (requests.length === 2) return new Response(null, { status: 302, headers: { location: "https://example.org/end" } });
      return new Response("done");
    });
    expect(await (await http.fetch("https://www.youtube.com/start", { method: "POST", body: "{}",
      headers: { cookie: "stale=leak", authorization: "stale", "x-goog-authuser": "0" } })).text()).toEqual("done");
    expect(requests[0].headers.get("origin")).toEqual("https://www.youtube.com");
    expect(requests[0].headers.get("authorization")).toStartWith("SAPISIDHASH ");
    expect(requests[1].headers.get("cookie")).toEqual("SAPISID=rotated");
    expect(requests[1].headers.get("authorization")).not.toEqual(requests[0].headers.get("authorization"));
    expect(requests[1].method).toEqual("GET");
    expect(requests[2].headers.has("cookie")).toEqual(false);
    expect(requests[2].headers.has("authorization")).toEqual(false);
    expect(requests[2].headers.has("x-goog-authuser")).toEqual(false);
    expect(http.count).toEqual(3);
  });

  test("timeout covers delayed response bodies and cancellation aborts requests", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("partial")); },
    })) });
    try {
      const jar = await createCookieJar(null);
      const cancellation = new AbortController();
      const http = createHttp(jar, 0.03, null, cancellation.signal);
      await expect(http.fetch(server.url)).rejects.toThrow();
      cancellation.abort();
      await expect(http.fetch(server.url)).rejects.toThrow();
      expect(http.count).toEqual(1);
    } finally { server.stop(true); }
  });
});

describe("public player cache", () => {
  test("freshness, checksum, origin partition, no-cache, privacy rules and bounded eviction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bun-player-cache-"));
    try {
      const cache = createPlayerCache(directory);
      const url = new URL("https://www.youtube.com/s/player/test/player_ias.vflset/en_US/base.js");
      const bytes = new TextEncoder().encode("signatureTimestamp:12345");
      function response(extra: Record<string, string> = {}) {
        return new Response(bytes, { headers: { "cache-control": "public, max-age=3600", ...extra } });
      }
      await cache.write(url, "a", response(), bytes);
      expect(await (await cache.read(url, "a"))?.text()).toEqual("signatureTimestamp:12345");
      expect(await cache.read(url, "b")).toEqual(null);
      expect(await createPlayerCache(null).read(url, "a")).toEqual(null);
      const forbiddenHeaders: Record<string, string>[] = [{ "cache-control": "private, max-age=3600" }, { "cache-control": "public, no-store, max-age=3600" },
        { "cache-control": "public, no-cache, max-age=3600" }, { "set-cookie": "secret=value" }, { vary: "Cookie" }, { age: "3601" }];
      for (const headers of forbiddenHeaders) {
        await cache.write(url, "forbidden", response(headers), bytes);
        expect(await cache.read(url, "forbidden")).toEqual(null);
      }
      const signed = new URL(url); signed.search = "?token=secret";
      await cache.write(signed, "a", response(), bytes);
      expect(await cache.read(signed, "a")).toEqual(null);
      const root = join(directory, "yt-dlp-explode-bun-player-v1");
      const path = join(root, (await readdir(root))[0]);
      const data = await Bun.file(path).json();
      await Bun.write(path, JSON.stringify({ ...data, sha256: "bad" }));
      expect(await cache.read(url, "a")).toEqual(null);
      await Bun.write(path, JSON.stringify({ ...data, expires: 1 }));
      expect(await cache.read(url, "a")).toEqual(null);
      for (let i = 0; i < 20; i++) await cache.write(url, String(i), response(), bytes);
      expect((await readdir(root)).filter(x => x.endsWith(".cache")).length).toEqual(16);
    } finally { await $`rm -rf ${directory}`.quiet(); }
  });
});

describe("YouTube.js caption session", () => {
  test("uses authenticated embed context, timestamp cache, rotated cookies and fresh captions", async () => {
    const jar = await createCookieJar(null);
    jar.receive("https://www.youtube.com/", new Headers({ "set-cookie": "LOGIN_INFO=login; Secure; Path=/" }));
    jar.receive("https://www.youtube.com/", new Headers({ "set-cookie": "SAPISID=session; Secure; Path=/" }));
    const payloads: Record<string, any>[] = [];
    const paths: string[] = [];
    const config = { INNERTUBE_CONTEXT: { client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "test-version",
      userAgent: "test-agent", visitorData: "visitor" }, user: {} }, USER_SESSION_ID: "user-session", SESSION_INDEX: 2,
      LOGGED_IN: true, PLAYER_JS_URL: "/s/player/test/player_embed.vflset/en_US/base.js" };
    const session = createCaptionSession(jar, parseOptions(["--skip-download", "--no-cache-dir", "id"]), new AbortController().signal,
      async (input, init) => {
        const path = new URL(String(input)).pathname; paths.push(path);
        const headers = new Headers(init?.headers);
        if (path.startsWith("/embed/")) return new Response(`<script>ytcfg.set({"other":"brace }"});ytcfg.set(${JSON.stringify(config)});</script>`);
        if (path.endsWith("base.js")) {
          expect(headers.has("cookie")).toEqual(false);
          expect(headers.has("authorization")).toEqual(false);
          return new Response("signatureTimestamp:12345");
        }
        if (path === "/youtubei/v1/player") {
          payloads.push(JSON.parse(new TextDecoder().decode(init?.body as ArrayBuffer)));
          expect(headers.get("x-youtube-client-version")).toEqual("test-version");
          expect(headers.get("authorization")).toEndWith("_u");
          expect(headers.get("x-goog-authuser")).toEqual("2");
          return Response.json({ playabilityStatus: { status: "OK" }, videoDetails: { title: "Example" },
            captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", kind: "asr",
              baseUrl: "https://www.youtube.com/api/timedtext?lang=en", name: { simpleText: "English" } }] } } },
          { headers: { "set-cookie": "fresh=received; Secure; Path=/" } });
        }
        expect(headers.get("cookie")).toContain("fresh=received");
        return new Response('{"events":[{"segs":[{"utf8":"Hello"}]}]}');
      });
    expect((await session.manifest("4Ff0xc9M8kA")).videoDetails?.title).toEqual("Example");
    await session.download("https://www.youtube.com/api/timedtext?lang=en");
    await session.manifest("4Ff0xc9M8kA");
    expect(paths.filter(path => path.endsWith("base.js"))).toHaveLength(1);
    expect(paths.filter(path => path.startsWith("/embed/"))).toHaveLength(2);
    expect(payloads[0].context.thirdParty.embedUrl).toEqual("https://www.google.com/");
    expect(payloads[0].playbackContext.contentPlaybackContext.signatureTimestamp).toEqual(12345);
    expect(payloads[0].context.client.hl).toEqual("en");
  });

  test("anonymous fallback and explicit denial/empty subtitle errors", async () => {
    const clients: string[] = [];
    const jar = await createCookieJar(null);
    const session = createCaptionSession(jar, parseOptions(["--skip-download", "id"]), new AbortController().signal,
      async (_input, init) => {
        if (init?.body) {
          clients.push(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer)).context.client.clientName);
          return Response.json({ playabilityStatus: { status: "ERROR", reason: "Unavailable" } });
        }
        return new Response("");
      });
    await expect(session.manifest("4Ff0xc9M8kA")).rejects.toThrow("Unavailable");
    expect(clients).toEqual(["VISIONOS", "ANDROID"]);
    await expect(session.download("https://www.youtube.com/api/timedtext")).rejects.toThrow("empty subtitles");
    expect(() => embeddedConfig("no config")).toThrow("configuration");
  });
});
