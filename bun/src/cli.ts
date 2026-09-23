#!/usr/bin/env bun
import { link, mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import help from "./help.txt" with { type: "text" };
import { version } from "../package.json";
import { createCaptionInfo, formats, query, videoId } from "./caption-info.ts";
import { createCaptionSession } from "./caption-session.ts";
import { loadConfiguration } from "./configuration.ts";
import { createCookieJar, type CookieJar } from "./cookie-jar.ts";
import { parseOptions, type Options } from "./options.ts";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function main(args: string[], sessionFactory = createCaptionSession) {
  const started = performance.now();
  const events: { name: string; start_ms: number; duration_ms: number }[] = [];
  function profile(name: string, start: number) {
    if (process.env.YT_DLP_EXPLODE_PROFILE) events.push({ name, start_ms: start - started, duration_ms: performance.now() - start });
  }
  let options: Options;
  try {
    const configuration = await loadConfiguration(args);
    options = parseOptions(configuration.args);
    profile("config", started);
    if (options.help) { console.log(help.trimEnd()); return 0; }
    if (options.version) { console.log(version); return 0; }
    if (options.verbose) for (const file of configuration.files) console.error(`[debug] Config: ${file}`);
  } catch (error) { console.error(`ERROR: ${message(error)}`); return 2; }
  function warning(message: string) { if (!options.noWarnings) console.error(`WARNING: ${message}`); }
  function info(message: string) { if (!options.quiet && !options.dumpJson) console.error(`[info] ${message}`); }
  const cancellation = new AbortController();
  function cancel() { cancellation.abort(); }
  process.on("SIGINT", cancel);
  let exitCode = 0;
  let jar: CookieJar | undefined;
  try {
    const cookieStart = performance.now();
    jar = await createCookieJar(options.cookies, warning);
    profile("cookie_load", cookieStart);
    if (options.playerClients === "web_embedded" && !jar.cookies("https://www.youtube.com/").some(c => c.name === "LOGIN_INFO"))
      throw new Error("The pinned library currently requires a logged-in cookie jar for forced web_embedded captions; use player_client=default for anonymous access.");
    const session = sessionFactory(jar, options, cancellation.signal);
    for (const url of options.urls) {
      try {
        cancellation.signal.throwIfAborted();
        const timer = performance.now();
        const requestsBefore = session.requestCount;
        const id = videoId(url);
        const player = await session.manifest(id);
        profile("manifest", timer);
        const manifestMs = performance.now() - timer;
        const captions = createCaptionInfo(id, url, player, options);
        captions.select(warning);
        if (options.listSubs) {
          for (const [name, map] of [["automatic captions", captions.automatic], ["subtitles", captions.manual]] as const) {
            console.log(`[info] Available ${name} for ${id}:`);
            for (const sub of map.values()) console.log(`${sub.language}\t${sub.name}\t${formats.toReversed().join(", ")}`);
          }
        }
        if (!options.isSimulation && (options.writeSubs || options.writeAutoSubs)) {
          if (!captions.selected.size) info("There are no subtitles for the requested languages");
          for (const [language, selected] of captions.selected) {
            const file = captions.filename(language, selected.format);
            if (!file) continue;
            if (!options.forceOverwrite && await Bun.file(file).exists()) info(`Video subtitle ${language}.${selected.format} is already present`);
            else {
              const bytes = await session.download(query(selected.subtitle.url, "fmt", selected.format));
              await mkdir(dirname(file), { recursive: true });
              const temporary = `${file}.${crypto.randomUUID()}.part`;
              try {
                await Bun.write(temporary, bytes);
                cancellation.signal.throwIfAborted();
                if (options.forceOverwrite) await rename(temporary, file);
                else await link(temporary, file);
              } finally { await unlink(temporary).catch(() => undefined); }
              info(`Writing video subtitles to: ${file}`);
            }
            selected.file = file;
          }
        }
        if (options.dumpJson) console.log(JSON.stringify(captions.json()));
        if (options.verbose) console.error(`[debug] ${session.requestCount - requestsBefore} HTTP requests for ${id}`);
        if (options.stats) console.error(JSON.stringify({ video_id: id, http_requests: session.requestCount - requestsBefore,
          manifest_ms: manifestMs, total_ms: performance.now() - timer }));
      } catch (error) {
        if (!options.ignoreErrors || cancellation.signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) throw error;
        console.error(`ERROR: ${message(error)}`); exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`ERROR: ${cancellation.signal.aborted ? "Interrupted" : error instanceof DOMException && error.name === "TimeoutError" ? "HTTP request timed out" : message(error)}`);
    exitCode = cancellation.signal.aborted ? 130 : 1;
  } finally {
    process.off("SIGINT", cancel);
    try {
      const saveStart = performance.now();
      await jar?.save(); profile("cookie_save", saveStart);
    } catch (error) { console.error(`ERROR: Could not save cookies: ${message(error)}`); exitCode = 1; }
  }
  if (process.env.YT_DLP_EXPLODE_PROFILE) {
    try { await Bun.write(process.env.YT_DLP_EXPLODE_PROFILE, JSON.stringify({ process_ms: performance.now() - started, events })); }
    catch (error) { console.error(`ERROR: Could not save profile: ${message(error)}`); exitCode = 1; }
  }
  return exitCode;
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
