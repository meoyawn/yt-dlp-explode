import { homedir } from "node:os";
import { join } from "node:path";

export function expandPath(path: string, home = homedir(), env = process.env): string {
  if (path === "~") path = home;
  else if (/^~[/\\]/.test(path)) path = join(home, path.slice(2));
  return path.replace(/\$(?:\{(\w+)\}|(\w+))|%(\w+)%/g,
    (match, braces, plain, windows) => env[braces ?? plain ?? windows] ?? match);
}

export function parseOptions(args: string[], validate = true) {
  const o = {
    urls: [] as string[],
    cacheDirectory: join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "yt-dlp") as string | null,
    cookies: null as string | null,
    help: false, version: false, dumpJson: false, listSubs: false,
    writeSubs: false, writeAutoSubs: false, skipDownload: false,
    simulate: null as boolean | null,
    quiet: false, noWarnings: false, verbose: false, forceOverwrite: false,
    ignoreErrors: false, stats: false, socketTimeout: 60, subFormat: "best",
    subLanguages: [] as string[],
    paths: new Map<string, string>(),
    templates: new Map<string, string>([["default", "%(title)s [%(id)s].%(ext)s"]]),
    extractorArguments: new Map<string, string>(),
    get playerClients() { return this.extractorArguments.get("player_client") ?? "default"; },
    get isSimulation() { return this.simulate ?? (this.dumpJson || this.listSubs); },
  };
  let positional = false;
  let allSubs = false;
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg === "--" && !positional) { positional = true; continue; }
    if (positional || !arg.startsWith("-") || arg === "-") { o.urls.push(arg); continue; }
    let inline: string | undefined;
    if (arg.startsWith("--") && arg.includes("=")) {
      inline = arg.slice(arg.indexOf("=") + 1);
      arg = arg.slice(0, arg.indexOf("="));
    } else if (/^-[oP].+/.test(arg)) { inline = arg.slice(2); arg = arg.slice(0, 2); }
    function value() {
      if (inline !== undefined) return inline;
      if (++i >= args.length) throw new Error(`Missing value for ${arg}.`);
      return args[i];
    }
    switch (arg) {
      case "-h": case "--help": o.help = true; break;
      case "--version": o.version = true; break;
      case "--cookies": o.cookies = expandPath(value()); break;
      case "--no-cookies": o.cookies = null; break;
      case "-j": case "-J": case "--dump-json": case "--dump-single-json": o.dumpJson = true; break;
      case "--list-subs": o.listSubs = true; break;
      case "--write-subs": case "--write-sub": case "--write-srt": o.writeSubs = true; break;
      case "--no-write-subs": case "--no-write-sub": case "--no-write-srt": o.writeSubs = false; break;
      case "--write-auto-subs": case "--write-auto-sub": case "--write-automatic-subs": o.writeAutoSubs = true; break;
      case "--no-write-auto-subs": case "--no-write-auto-sub": case "--no-write-automatic-subs": o.writeAutoSubs = false; break;
      case "--all-subs": allSubs = true; break;
      case "--sub-langs": case "--srt-langs": o.subLanguages.push(...value().split(",").map(x => x.trim())); break;
      case "--sub-format": o.subFormat = value(); break;
      case "--skip-download": case "--no-download": o.skipDownload = true; break;
      case "-s": case "--simulate": o.simulate = true; break;
      case "--no-simulate": o.simulate = false; break;
      case "-q": case "--quiet": o.quiet = true; break;
      case "--no-quiet": o.quiet = false; break;
      case "--no-warnings": o.noWarnings = true; break;
      case "-v": case "--verbose": o.verbose = true; break;
      case "--no-progress": case "--progress": case "--no-colors": case "--no-playlist": break;
      case "--force-overwrites": o.forceOverwrite = true; break;
      case "--no-overwrites": case "--no-force-overwrites": case "-w": o.forceOverwrite = false; break;
      case "-i": case "--ignore-errors": o.ignoreErrors = true; break;
      case "--no-ignore-errors": case "--abort-on-error": o.ignoreErrors = false; break;
      case "--stats": o.stats = true; break;
      case "--socket-timeout": o.socketTimeout = Number(value()); break;
      case "-o": case "--output": setTyped(o.templates, value(), "default", ["default", "subtitle"]); break;
      case "-P": case "--paths": setTyped(o.paths, expandPath(value()), "home", ["home", "subtitle", "temp"]); break;
      case "--extractor-args": {
        const input = value();
        const colon = input.indexOf(":");
        if (colon < 0 || input.slice(0, colon).toLowerCase() !== "youtube")
          throw new Error("Only youtube extractor arguments are supported in the caption milestone.");
        for (const item of input.slice(colon + 1).split(";").filter(Boolean)) {
          const equals = item.indexOf("=");
          if (equals < 0) throw new Error("Invalid youtube extractor argument.");
          o.extractorArguments.set(item.slice(0, equals).toLowerCase(), item.slice(equals + 1));
        }
        break;
      }
      case "--remote-components":
        if (value().split(",").some(x => !["ejs:github", "ejs:npm"].includes(x)))
          throw new Error("Unknown remote component source.");
        break;
      case "--no-remote-components": case "--no-js-runtimes": break;
      case "--no-cache-dir": o.cacheDirectory = null; break;
      case "--cache-dir": o.cacheDirectory = expandPath(value()); break;
      case "--js-runtimes": case "--config-locations": case "--config-location": value(); break;
      case "--ignore-config": case "--no-config": case "--no-config-locations": break;
      default: throw new Error(`Unsupported option in the caption milestone: ${arg}. See --help and COMPATIBILITY.md.`);
    }
  }
  if (allSubs) { o.subLanguages = ["all"]; if (!o.writeAutoSubs) o.writeSubs = true; }
  if (validate && !o.help && !o.version) {
    if (!o.urls.length) throw new Error("You must provide at least one YouTube video URL.");
    if (!o.skipDownload && !o.isSimulation)
      throw new Error("Media downloads are not implemented yet. Use --skip-download for subtitles, or --dump-single-json/--list-subs.");
    if (!Number.isFinite(o.socketTimeout) || o.socketTimeout <= 0)
      throw new Error("--socket-timeout must be positive.");
    for (const [key, value] of o.extractorArguments) {
      if (key === "player_client" && value.split(",").every(x => ["default", "web_embedded"].includes(x))) continue;
      if (key === "skip" && value === "translated_subs") continue;
      throw new Error(`Unsupported youtube extractor argument: ${key}.`);
    }
  }
  return o;
}

function setTyped(map: Map<string, string>, value: string, fallback: string, types: string[]) {
  const colon = value.indexOf(":");
  if (colon >= 0 && types.includes(value.slice(0, colon))) map.set(value.slice(0, colon), value.slice(colon + 1));
  else map.set(fallback, value);
}

export type Options = ReturnType<typeof parseOptions>;
