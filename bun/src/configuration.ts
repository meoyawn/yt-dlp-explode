import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expandPath, parseOptions } from "./options.ts";

export function tokenize(text: string): string[] {
  const words: string[] = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (!quote && c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      if (started) { words.push(word); word = ""; started = false; }
      continue;
    }
    if (c === "\\" && quote !== "'") {
      if (++i === text.length) throw new Error("Trailing escape in configuration.");
      c = text[i];
      if (quote === '"' && c !== '"' && c !== "\\") word += "\\";
      word += c; started = true;
    } else if (quote) {
      if (c === quote) quote = ""; else word += c;
    } else if (c === "'" || c === '"') { quote = c; started = true; }
    else if (/\s/.test(c)) {
      if (started) { words.push(word); word = ""; started = false; }
    } else { word += c; started = true; }
  }
  if (quote) throw new Error("Unclosed quote in configuration.");
  if (started) words.push(word);
  return words;
}

export async function readText(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes();
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder().decode(bytes);
}

export async function loadConfiguration(commandLine: string[], {
  home = homedir(), executableDirectory = dirname(process.execPath),
  workingDirectory = process.cwd(), systemDirectory = "/etc/yt-dlp", env = process.env,
  stdin = () => Bun.stdin.text(),
} = {}) {
  const loaded = new Set<string>();
  const files: string[] = [];
  async function loadFile(path: string): Promise<string[] | null> {
    path = resolve(path);
    if (loaded.has(path)) return null;
    loaded.add(path); files.push(path);
    return loadLayer(tokenize(await readText(path)), dirname(path));
  }
  async function loadLayer(own: string[], directory: string): Promise<string[]> {
    let includes: string[] = [];
    for (let i = 0; i < own.length; i++) {
      const arg = own[i];
      if (arg === "--no-config-locations") includes = [];
      else if (arg.startsWith("--config-locations=")) includes.push(arg.slice(arg.indexOf("=") + 1));
      else if (arg === "--config-locations" || arg === "--config-location") {
        if (++i === own.length) throw new Error(`Missing value for ${arg}.`);
        includes.push(own[i]);
      }
    }
    const children: string[][] = [];
    for (const include of includes) {
      if (include === "-") {
        if (!loaded.has("<stdin>")) {
          loaded.add("<stdin>"); children.push(await loadLayer(tokenize(await stdin()), directory));
        }
        continue;
      }
      let path = resolve(directory, expandPath(include, home, env));
      if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, "yt-dlp.conf");
      if (!await Bun.file(path).exists()) throw new Error(`Config location does not exist: ${path}`);
      const child = await loadFile(path);
      if (child) children.push(child);
    }
    return [...children.reverse().flat(), ...own];
  }
  const layers = [await loadLayer(commandLine, workingDirectory)];
  function ignore() { return layers.flat().some(x => x === "--ignore-config" || x === "--no-config"); }
  async function add(path: string | undefined) {
    if (!path || !await Bun.file(path).exists()) return;
    const args = await loadFile(path);
    if (args) layers.push(args);
  }
  async function firstExisting(paths: string[]) {
    for (const path of paths) if (await Bun.file(path).exists()) return path;
  }
  if (!ignore()) await add(join(executableDirectory, "yt-dlp.conf"));
  if (!ignore()) {
    const paths = parseOptions(layers.toReversed().flat(), false).paths;
    await add(join(expandPath(paths.get("home") ?? workingDirectory, home, env), "yt-dlp.conf"));
  }
  let userLayer: string[] | undefined;
  if (!ignore()) {
    const directories = [join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "yt-dlp")];
    const appdata = env.APPDATA ?? env.appdata;
    if (appdata) directories.push(join(appdata, "yt-dlp"));
    directories.push(join(home, ".yt-dlp"));
    const before = layers.length;
    await add(await firstExisting(directories.flatMap(candidates)));
    if (layers.length > before) userLayer = layers.at(-1);
  }
  if (!ignore()) {
    await add(await firstExisting(candidates(systemDirectory)));
    if (ignore() && userLayer) layers.splice(layers.indexOf(userLayer), 1);
  }
  return { args: layers.reverse().flat(), files };
}

function candidates(directory: string): string[] {
  return [join(dirname(directory), "yt-dlp.conf"),
    ...(basename(directory) === ".yt-dlp" ? [join(dirname(directory), "yt-dlp.conf.txt")] : []),
    join(directory, "config"), join(directory, "config.txt")];
}
