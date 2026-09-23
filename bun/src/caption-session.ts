import { Innertube, Log, type Context } from "youtubei.js";
import type { PlayerResponse } from "./caption-info.ts";
import type { CookieJar } from "./cookie-jar.ts";
import { createHttp, type Fetcher } from "./http.ts";
import type { Options } from "./options.ts";

interface EmbedConfig {
  INNERTUBE_CONTEXT: Context;
  STS?: number;
  PLAYER_JS_URL?: string;
  USER_SESSION_ID?: string;
  DATASYNC_ID?: string;
  DELEGATED_SESSION_ID?: string;
  SESSION_INDEX?: number;
  LOGGED_IN?: boolean;
  WEB_PLAYER_CONTEXT_CONFIGS?: Record<string, { jsUrl?: string; encryptedHostFlags?: string }>;
}

export function embeddedConfig(html: string): EmbedConfig {
  for (const match of html.matchAll(/ytcfg\.set\s*\(\s*(\{)/g)) {
    const start = match.index! + match[0].lastIndexOf("{");
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < html.length; end++) {
      const char = html[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          const value = JSON.parse(html.slice(start, end + 1));
          if (value.INNERTUBE_CONTEXT?.client) return value;
        } catch { /* Continue to the next config block. */ }
        break;
      }
    }
  }
  throw new Error("Failed to extract embedded player configuration.");
}

const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15";

export function createCaptionSession(jar: CookieJar, options: Options, signal: AbortSignal, fetcher?: Fetcher) {
  const http = createHttp(jar, options.socketTimeout, options.cacheDirectory, signal, fetcher);
  const timestamps = new Map<string, number>();
  let youtube: Innertube | undefined;
  async function client() {
    if (!youtube) {
      Log.setLevel(Log.Level.NONE);
      youtube = await Innertube.create({ fetch: http.fetch, cookie: jar.header("https://www.youtube.com/"),
        generate_session_locally: true, retrieve_player: false, retrieve_innertube_config: false,
        enable_session_cache: false, lang: "en", timezone: "UTC", user_agent: userAgent });
    }
    return youtube;
  }
  async function getText(url: string, headers?: Record<string, string>) {
    const response = await http.fetch(url, { headers: { "user-agent": userAgent, ...headers } });
    if (!response.ok) throw new Error(`HTTP request failed with status ${response.status}.`);
    return response.text();
  }
  async function manifest(id: string): Promise<PlayerResponse> {
    const cookies = jar.cookies("https://www.youtube.com/");
    const loggedIn = cookies.some(c => c.name === "LOGIN_INFO")
      && cookies.some(c => ["SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID"].includes(c.name));
    const yt = await client();
    let player: PlayerResponse;
    if (loggedIn || options.playerClients === "web_embedded") {
      http.userSessionId = undefined;
      const config = embeddedConfig(await getText(`https://www.youtube.com/embed/${id}?html5=1`, { referer: "https://www.google.com/" }));
      const embedded = config.WEB_PLAYER_CONTEXT_CONFIGS?.WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER;
      let timestamp = config.STS;
      if (timestamp === undefined) {
        const source = config.PLAYER_JS_URL ?? embedded?.jsUrl;
        if (!source) throw new Error("Missing embedded player script URL.");
        const url = new URL(source, "https://www.youtube.com");
        if (!publicScriptUrl(url)) throw new Error("Unexpected embedded player script URL.");
        timestamp = timestamps.get(url.href);
        if (timestamp === undefined) {
          const script = await getText(url.href);
          const match = script.match(/signatureTimestamp\s*[:=]\s*(\d+)/);
          if (!match) throw new Error("Failed to extract embedded player signature timestamp.");
          timestamp = Number(match[1]); timestamps.set(url.href, timestamp);
        }
      }
      yt.session.context = { ...config.INNERTUBE_CONTEXT,
        client: { ...config.INNERTUBE_CONTEXT.client, hl: "en", timeZone: "UTC", utcOffsetMinutes: 0 },
        user: config.INNERTUBE_CONTEXT.user ?? { enableSafetyMode: false, lockedSafetyMode: false },
        thirdParty: { ...config.INNERTUBE_CONTEXT.thirdParty, embedUrl: "https://www.google.com/" } };
      const sync = config.DATASYNC_ID?.split("||");
      http.userSessionId = config.USER_SESSION_ID ?? (sync?.[1] || sync?.[0]);
      const delegated = config.DELEGATED_SESSION_ID ?? (sync?.[1] ? sync[0] : undefined);
      yt.session.account_index = Number(config.SESSION_INDEX ?? 0);
      if (delegated) yt.session.context.user.onBehalfOfUser = delegated;
      const headers = new Headers({ "content-type": "application/json" });
      if (config.SESSION_INDEX !== undefined || delegated) headers.set("x-goog-authuser", String(config.SESSION_INDEX ?? 0));
      if (delegated) headers.set("x-goog-pageid", delegated);
      if (config.LOGGED_IN) headers.set("x-youtube-bootstrap-logged-in", "true");
      // YouTube.js supplies the fresh embedded client context and API headers.
      const response = await yt.session.http.fetch("/player", { method: "POST", headers,
        body: JSON.stringify({ videoId: id, contentCheckOk: true, racyCheckOk: true,
          playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS",
            signatureTimestamp: timestamp, encryptedHostFlags: embedded?.encryptedHostFlags } } }) });
      player = await response.json() as PlayerResponse;
      http.userSessionId = undefined;
    } else {
      player = (await yt.actions.execute("/player", { videoId: id, client: "VISIONOS",
        contentCheckOk: true, racyCheckOk: true })).data as PlayerResponse;
      if (player.playabilityStatus?.status !== "OK") {
        player = (await yt.actions.execute("/player", { videoId: id, client: "ANDROID",
          contentCheckOk: true, racyCheckOk: true })).data as PlayerResponse;
      }
    }
    if (player.playabilityStatus?.status !== "OK") {
      const reason = player.playabilityStatus?.reason ?? player.playabilityStatus?.messages?.join(" ") ?? "player rejected the request";
      throw new Error(`Video '${id}' captions could not be accessed: ${reason}.`);
    }
    return player;
  }
  async function download(url: string) {
    const response = await http.fetch(url, { headers: { "user-agent": userAgent } });
    if (!response.ok) throw new Error(`HTTP request failed with status ${response.status}.`);
    const bytes = await response.bytes();
    if (!bytes.length) throw new Error("YouTube returned empty subtitles.");
    return bytes;
  }
  return { manifest, download, get requestCount() { return http.count; } };
}

const publicScriptUrl = (url: URL) => url.origin === "https://www.youtube.com" && url.pathname.startsWith("/s/player/");
export type CaptionSession = ReturnType<typeof createCaptionSession>;
