import { open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { readText } from "./configuration.ts";

export interface CookieEntry {
  domain: string;
  subdomains: boolean;
  path: string;
  secure: boolean;
  expires: string;
  name: string;
  value: string;
  httpOnly: boolean;
}

const key = (entry: CookieEntry) => `${entry.domain.replace(/^\./, "").toLowerCase()}\t${entry.path}\t${entry.name}`;
const line = (entry: CookieEntry) => (entry.httpOnly ? "#HttpOnly_" : "") + [entry.domain,
  entry.subdomains ? "TRUE" : "FALSE", entry.path, entry.secure ? "TRUE" : "FALSE",
  entry.expires, entry.name, entry.value].join("\t");
function silent(_message: string): void {}

function expiry(entry: CookieEntry): number {
  const value = Number(entry.expires);
  return value > 253402300799 ? value / 1_000_000 - 11_644_473_600 : value;
}

async function readEntries(path: string | null, warning = silent) {
  const entries = new Map<string, CookieEntry>();
  if (!path || !await Bun.file(path).exists()) return entries;
  const lines = (await readText(path)).split(/\r?\n/);
  if (!lines.shift()?.includes("HTTP Cookie File"))
    throw new Error("Cookies file must be Netscape formatted and start with a cookie-file header.");
  for (const raw of lines) {
    const httpOnly = raw.startsWith("#HttpOnly_");
    const text = httpOnly ? raw.slice(10) : raw;
    if (!text.trim() || text.startsWith("#")) continue;
    const f = text.split("\t");
    if (f.length !== 7 || !["TRUE", "FALSE"].includes(f[1]) || !["TRUE", "FALSE"].includes(f[3])
      || !Number.isFinite(Number(f[4])) || Number(f[4]) < 0) {
      warning("Skipping a malformed Netscape cookie entry."); continue;
    }
    const entry: CookieEntry = { domain: f[0], subdomains: f[1] === "TRUE", path: f[2],
      secure: f[3] === "TRUE", expires: f[4] || "0", name: f[5], value: f[6], httpOnly };
    entries.set(key(entry), entry);
  }
  return entries;
}

export async function createCookieJar(filename: string | null, warning = silent) {
  const path = filename === null ? null : resolve(filename);
  const entries = await readEntries(path, warning);
  const changes = new Map<string, CookieEntry | null>();
  function cookies(url: URL | string): CookieEntry[] {
    const target = new URL(url);
    return [...entries.values()].filter(entry => {
      const domain = entry.domain.replace(/^\./, "").toLowerCase();
      const expires = expiry(entry);
      return entry.name && !/[\x00-\x20;=,]/.test(entry.name) && !/[\r\n;]/.test(entry.value)
        && (expires === 0 || expires > Date.now() / 1000)
        && (!entry.secure || target.protocol === "https:")
        && (target.hostname === domain || (entry.subdomains && target.hostname.endsWith(`.${domain}`)))
        && (target.pathname === entry.path || (target.pathname.startsWith(entry.path)
          && (entry.path.endsWith("/") || target.pathname[entry.path.length] === "/")));
    }).sort((a, b) => b.path.length - a.path.length);
  }
  function header(url: URL | string) {
    return cookies(url).map(entry => `${entry.name}=${entry.value}`).join("; ");
  }
  function receive(url: URL | string, headers: Headers) {
    const target = new URL(url);
    for (const raw of headers.getSetCookie()) {
      const cookie = Bun.Cookie.parse(raw);
      if (!cookie || !cookie.name || /[\x00-\x20;=,]/.test(cookie.name) || /[\r\n;]/.test(cookie.value)) continue;
      const domainAttribute = /(?:^|;)\s*domain\s*=/i.test(raw);
      const domain = (cookie.domain || target.hostname).replace(/^\./, "").toLowerCase();
      if (target.hostname !== domain && !target.hostname.endsWith(`.${domain}`)) continue;
      // Responses may not create parent public-suffix cookies or overwrite Secure cookies over HTTP.
      if (domainAttribute && (!domain.includes(".") || /^(?:co|com|org|net)\.[a-z]{2}$/.test(domain))) continue;
      if (cookie.secure && target.protocol !== "https:") continue;
      const explicitPath = raw.match(/(?:^|;)\s*path\s*=\s*([^;]*)/i)?.[1];
      const cookiePath = explicitPath?.startsWith("/") ? explicitPath
        : target.pathname.slice(0, target.pathname.lastIndexOf("/")) || "/";
      if (cookie.name.startsWith("__Secure-") && !cookie.secure) continue;
      if (cookie.name.startsWith("__Host-") && (!cookie.secure || domainAttribute || cookiePath !== "/")) continue;
      const maxAge = raw.match(/(?:^|;)\s*max-age\s*=\s*(-?\d+)\s*(?:;|$)/i)?.[1];
      const expires = maxAge !== undefined ? Date.now() / 1000 + Number(maxAge)
        : cookie.expires ? cookie.expires.getTime() / 1000 : 0;
      const entry: CookieEntry = { domain: domainAttribute ? `.${domain}` : domain,
        subdomains: domainAttribute, path: cookiePath, secure: cookie.secure,
        expires: String(Math.floor(expires)), name: cookie.name, value: cookie.value, httpOnly: cookie.httpOnly };
      const id = key(entry);
      if (target.protocol !== "https:" && entries.get(id)?.secure) continue;
      if ((maxAge !== undefined && Number(maxAge) <= 0) || (expires !== 0 && expires <= Date.now() / 1000)) {
        entries.delete(id); changes.set(id, null);
      } else { entries.set(id, entry); changes.set(id, entry); }
    }
  }
  async function save() {
    if (path === null) return;
    const lockPath = `${path}.lock`;
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    const deadline = Date.now() + 5000;
    while (!lock) {
      try { lock = await open(lockPath, "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
        await Bun.sleep(25);
      }
    }
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      const merged = await readEntries(path);
      for (const [id, entry] of changes) {
        if (entry === null) merged.delete(id); else merged.set(id, entry);
      }
      const output = "# Netscape HTTP Cookie File\n# Generated by yt-dlp-explode.\n\n"
        + [...merged.values()].map(line).join("\n") + (merged.size ? "\n" : "");
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(output); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(lockPath);
    }
  }
  return { cookies, header, receive, save };
}

export type CookieJar = Awaited<ReturnType<typeof createCookieJar>>;
