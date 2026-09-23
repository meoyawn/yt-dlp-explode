import { resolve } from "node:path";
import { expandPath, type Options } from "./options.ts";

export const formats = ["json3", "srv1", "srv2", "srv3", "ttml", "srt", "vtt"];

export interface YoutubeText { simpleText?: string; runs?: { text: string }[] }
export interface PlayerResponse {
  videoDetails?: { title?: string; author?: string; channelId?: string; shortDescription?: string;
    lengthSeconds?: string; viewCount?: string };
  playabilityStatus?: { status?: string; reason?: string; messages?: string[] };
  captions?: { playerCaptionsTracklistRenderer?: {
    captionTracks?: { baseUrl: string; languageCode: string; name: YoutubeText; kind?: string }[];
    translationLanguages?: { languageCode: string; languageName: YoutubeText }[];
  } };
}
export interface Subtitle { language: string; name: string; automatic: boolean; url: string }
export interface SelectedSubtitle { subtitle: Subtitle; format: string; file?: string }

export function query(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  // Preserve signed query encoding and parameter order.
  const parts = parsed.search.slice(1).split("&").filter(part => part && !["xosf", "format", key].includes(part.split("=", 1)[0]));
  parsed.search = [...parts, `${encodeURIComponent(key)}=${encodeURIComponent(value)}`].join("&");
  return parsed.href;
}

const text = (value: YoutubeText | undefined, fallback: string) => value?.simpleText ?? value?.runs?.map(run => run.text).join("") ?? fallback;
const sanitize = (value: string) => value.replaceAll("/", "⧸").replaceAll("\\", "⧹").replace(/[\x00-\x1f<>:"|?*]/g, "_");
const formatJson = (sub: Subtitle, format: string, file?: string) => ({ ext: format, url: query(sub.url, "fmt", format), name: sub.name, ...(file === undefined ? {} : { filepath: file }) });
const mapJson = (map: Map<string, Subtitle>) => Object.fromEntries([...map].map(([key, sub]) => [key, formats.map(format => formatJson(sub, format))]));

export function createCaptionInfo(id: string, originalUrl: string, player: PlayerResponse, options: Options) {
  const details = player.videoDetails ?? {};
  const title = details.title ?? id;
  const renderer = player.captions?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks ?? [];
  const manual = new Map<string, Subtitle>();
  const automatic = new Map<string, Subtitle>();
  const selected = new Map<string, SelectedSubtitle>();
  for (const track of tracks) {
    const sub: Subtitle = { language: track.languageCode, name: text(track.name, track.languageCode),
      automatic: track.kind === "asr", url: track.baseUrl };
    if (!sub.automatic) { if (!manual.has(sub.language)) manual.set(sub.language, sub); }
    else {
      if (!automatic.has(sub.language + "-orig")) automatic.set(sub.language + "-orig", {
        ...sub, language: sub.language + "-orig", name: sub.name + " (Original)",
      });
      if (!automatic.has(sub.language)) automatic.set(sub.language, sub);
    }
  }
  if ((options.writeAutoSubs || options.listSubs) && options.extractorArguments.get("skip") !== "translated_subs") {
    for (const track of tracks) for (const language of renderer?.translationLanguages ?? []) {
      if (language.languageCode === track.languageCode) continue;
      const key = track.kind === "asr" ? language.languageCode : `${language.languageCode}-${track.languageCode}`;
      if (!automatic.has(key)) automatic.set(key, { language: key, name: text(language.languageName, language.languageCode),
        automatic: true, url: query(track.baseUrl, "tlang", language.languageCode) });
    }
  }
  function select(warning: (message: string) => void) {
    selected.clear();
    const available = new Map<string, Subtitle>();
    if (options.writeSubs) for (const [key, sub] of manual) available.set(key, sub);
    if (options.writeAutoSubs) for (const [key, sub] of automatic) if (!available.has(key)) available.set(key, sub);
    if (!available.size) return;
    let requested: string[] = [];
    if (!options.subLanguages.length) {
      const manualKeys = [...available.values()].filter(sub => !sub.automatic).map(sub => sub.language);
      const all = [...available.keys()];
      requested.push(manualKeys.find(x => x === "en") ?? manualKeys.find(x => x.startsWith("en"))
        ?? all.find(x => x === "en") ?? all.find(x => x.startsWith("en")) ?? manualKeys[0] ?? all[0]);
    } else for (const pattern of options.subLanguages) {
      const exclude = pattern.startsWith("-");
      const expression = exclude ? pattern.slice(1) : pattern;
      const regex = expression === "all" ? null : new RegExp(`^(?:${expression})$`, "u");
      const matches = [...available.keys()].filter(key => regex === null || regex.test(key));
      if (exclude) requested = requested.filter(key => !matches.includes(key));
      else for (const language of matches) if (!requested.includes(language)) requested.push(language);
    }
    for (const language of requested) {
      let format = options.subFormat.split("/").find(x => x === "best" || formats.includes(x));
      if (!format) { warning(`No subtitle format matched '${options.subFormat}'; using vtt.`); format = "vtt"; }
      selected.set(language, { subtitle: available.get(language)!, format: format === "best" ? "vtt" : format });
    }
  }
  function filename(language: string, format: string) {
    const template = options.templates.get("subtitle") ?? options.templates.get("default")!;
    if (!template) return "";
    let name = template.replace(/%%|%\(([^)]+)\)([0-9]*[sd])/g, (match, field: string, conversion: string) => {
      if (match === "%%") return "%";
      const values: Record<string, string> = { id, title, ext: format, uploader: details.author ?? "NA",
        channel: details.author ?? "NA", channel_id: details.channelId ?? "NA", duration: details.lengthSeconds ?? "NA" };
      if (!Object.hasOwn(values, field)) throw new Error(`Output template field is not implemented: ${field}`);
      let value = values[field];
      if (conversion.endsWith("d") && conversion.length > 1) value = value.padStart(Number(conversion.slice(0, -1)), "0");
      return sanitize(value);
    });
    if (name.includes("%(")) throw new Error("Unsupported output template expression.");
    const suffix = `.${format}`;
    name = (name.endsWith(suffix) ? name.slice(0, -suffix.length) : name) + `.${sanitize(language)}${suffix}`;
    return resolve(expandPath(options.paths.get("home") ?? "."), expandPath(options.paths.get("subtitle") ?? ""), name);
  }
  function json() {
    return { id, title, webpage_url: `https://www.youtube.com/watch?v=${id}`, original_url: originalUrl,
      extractor: "youtube", extractor_key: "Youtube", description: details.shortDescription ?? null,
      uploader: details.author ?? null, channel: details.author ?? null, channel_id: details.channelId ?? null,
      ...(details.lengthSeconds && /^\d+$/.test(details.lengthSeconds) ? { duration: Number(details.lengthSeconds) } : {}),
      ...(details.viewCount && /^\d+$/.test(details.viewCount) ? { view_count: Number(details.viewCount) } : {}),
      language: tracks.find(track => track.kind === "asr")?.languageCode ?? null,
      subtitles: mapJson(manual), automatic_captions: mapJson(automatic),
      requested_subtitles: selected.size ? Object.fromEntries([...selected].map(([key, sub]) => [key, formatJson(sub.subtitle, sub.format, sub.file)])) : null };
  }
  return { title, manual, automatic, selected, select, filename, json };
}

export function videoId(input: string): string {
  if (/^[\p{L}\p{N}_-]{11}$/u.test(input)) return input;
  const patterns = [/youtube\..+?\/watch.*?v=(.*?)(?:&|\/|$)/, /youtu\.be\/watch.*?v=(.*?)(?:\?|&|\/|$)/,
    /youtu\.be\/(.*?)(?:\?|&|\/|$)/, /youtube\..+?\/(?:embed|shorts|live)\/(.*?)(?:\?|&|\/|$)/];
  for (const pattern of patterns) {
    const match = pattern.exec(input)?.[1];
    if (match) {
      const id = decodeURIComponent(match.replaceAll("+", " "));
      if (/^[\p{L}\p{N}_-]{11}$/u.test(id)) return id;
    }
  }
  throw new Error(`Invalid YouTube video ID or URL '${input}'.`);
}
