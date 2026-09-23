import type { CookieJar } from "./cookie-jar.ts";
import { createPlayerCache, publicPlayerScript } from "./player-cache.ts";

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createHttp(jar: CookieJar, socketTimeout: number, cacheDirectory: string | null,
  signal: AbortSignal, fetcher: Fetcher = fetch) {
  const cache = createPlayerCache(cacheDirectory);
  let count = 0;
  let userSessionId: string | undefined;
  function authorization(url: URL) {
    const cookies = new Map(jar.cookies(url).map(cookie => [cookie.name, cookie.value]));
    const timestamp = Math.floor(Date.now() / 1000);
    const tokens: string[] = [];
    for (const [scheme, value] of [["SAPISIDHASH", cookies.get("SAPISID") ?? cookies.get("__Secure-3PAPISID")],
      ["SAPISID1PHASH", cookies.get("__Secure-1PAPISID")], ["SAPISID3PHASH", cookies.get("__Secure-3PAPISID")]]) {
      if (!value) continue;
      const token = (userSessionId ? `${userSessionId} ` : "") + `${timestamp} ${value} ${url.origin}`;
      const hash = new Bun.CryptoHasher("sha1").update(token).digest("hex");
      tokens.push(`${scheme} ${timestamp}_${hash}${userSessionId ? "_u" : ""}`);
    }
    return tokens.join(" ");
  }
  async function request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const initial = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
    const timeout = AbortSignal.timeout(Math.min(2_147_483_647, Math.ceil(socketTimeout * 1000)));
    const combined = AbortSignal.any([signal, initial.signal, timeout]);
    combined.throwIfAborted();
    let url = new URL(initial.url);
    let method = initial.method;
    let body = initial.body === null ? undefined : await initial.arrayBuffer();
    const headers = new Headers(initial.headers);
    const origin = headers.get("origin") ?? "";
    const cacheable = method === "GET" && publicPlayerScript(url);
    if (cacheable) {
      const hit = await cache.read(url, origin);
      if (hit) return hit;
    }
    for (let redirects = 0; ; redirects++) {
      headers.delete("cookie");
      if (cacheable) headers.delete("authorization");
      else {
        const cookie = jar.header(url);
        if (cookie) headers.set("cookie", cookie);
        if (url.origin === "https://www.youtube.com") {
          if (!headers.has("origin")) headers.set("origin", url.origin);
          headers.delete("authorization");
          const auth = authorization(url);
          if (auth) { headers.set("authorization", auth); headers.set("x-origin", url.origin); }
        }
      }
      count++;
      const response = await fetcher(url, { method, headers, body, redirect: "manual", signal: combined });
      jar.receive(url, response.headers);
      const location = response.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(response.status) && location && initial.redirect !== "manual") {
        await response.body?.cancel();
        if (initial.redirect === "error") throw new Error("HTTP redirect is not allowed.");
        if (redirects >= 20) throw new Error("Too many HTTP redirects.");
        const next = new URL(location, url);
        if (!["http:", "https:"].includes(next.protocol)) throw new Error("Unsupported HTTP redirect protocol.");
        if (next.origin !== url.origin) {
          for (const name of ["authorization", "x-origin", "x-goog-authuser", "x-goog-pageid", "x-youtube-bootstrap-logged-in"])
            headers.delete(name);
        }
        if ((response.status === 303 && method !== "HEAD") || ([301, 302].includes(response.status) && method === "POST")) {
          method = "GET"; body = undefined;
          headers.delete("content-type"); headers.delete("content-length");
        }
        url = next; continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      combined.throwIfAborted();
      if (cacheable && url.href === initial.url) await cache.write(url, origin, response, bytes);
      const resultHeaders = new Headers(response.headers);
      resultHeaders.delete("content-encoding"); resultHeaders.delete("content-length");
      return new Response([101, 204, 205, 304].includes(response.status) || method === "HEAD" ? null : bytes,
        { status: response.status, statusText: response.statusText, headers: resultHeaders });
    }
  }
  request.preconnect = fetch.preconnect;
  return { fetch: request, get count() { return count; },
    set userSessionId(value: string | undefined) { userSessionId = value; } };
}
