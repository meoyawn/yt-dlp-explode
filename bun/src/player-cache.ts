import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const maxBytes = 4 * 1024 * 1024;
const digest = (bytes: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function publicPlayerScript(url: URL): boolean {
  return url.origin === "https://www.youtube.com" && (!url.search || /^\?hl=[a-zA-Z_-]+$/.test(url.search))
    && /^\/s\/player\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+\/base\.js$/.test(url.pathname);
}

export function createPlayerCache(directory: string | null) {
  const root = directory === null ? null : join(directory, "yt-dlp-explode-bun-player-v1");
  function pathFor(url: URL, origin: string) {
    return root !== null && publicPlayerScript(url) ? join(root, `${digest(url.href + "\n" + origin)}.cache`) : null;
  }
  async function read(url: URL, origin: string): Promise<Response | null> {
    const path = pathFor(url, origin);
    if (!path) return null;
    try {
      const file = Bun.file(path);
      if (file.size > maxBytes * 2) return null;
      const data = await file.json();
      if (data.version !== 1 || !Number.isFinite(data.expires) || data.expires <= Date.now()
        || data.expires > Date.now() + 7 * 86400_000 || typeof data.body !== "string") return null;
      const bytes = Buffer.from(data.body, "base64");
      if (!bytes.length || bytes.length > maxBytes || digest(bytes) !== data.sha256) return null;
      return new Response(bytes, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    } catch { return null; }
  }
  async function write(url: URL, origin: string, response: Response, bytes: Uint8Array) {
    const path = pathFor(url, origin);
    if (!path || !root || response.status !== 200 || !bytes.length || bytes.length > maxBytes) return;
    const control = response.headers.get("cache-control") ?? "";
    if (!/(?:^|,)\s*public\s*(?:,|$)/i.test(control) || /(?:^|,)\s*(?:private|no-cache|no-store)\b/i.test(control)
      || response.headers.has("set-cookie")
      || (response.headers.get("vary") ?? "").split(",").some(x => x.trim() && !["accept-encoding", "origin"].includes(x.trim().toLowerCase()))) return;
    const maxAge = Number(control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i)?.[1]);
    const date = Date.parse(response.headers.get("date") ?? "");
    const age = Math.max(0, Number(response.headers.get("age") ?? 0), Number.isFinite(date) ? (Date.now() - date) / 1000 : 0);
    const lifetime = Math.min(maxAge - age, 7 * 86400);
    if (!Number.isFinite(lifetime) || lifetime <= 0) return;
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      await mkdir(root, { recursive: true });
      await Bun.write(temporary, JSON.stringify({ version: 1, expires: Date.now() + lifetime * 1000,
        sha256: digest(bytes), body: Buffer.from(bytes).toString("base64") }));
      await rename(temporary, path);
      const files = await Promise.all((await readdir(root)).filter(x => x.endsWith(".cache")).map(async name => {
        const path = join(root, name);
        return { path, mtime: (await stat(path).catch(() => null))?.mtimeMs ?? 0 };
      }));
      await Promise.all(files.sort((a, b) => b.mtime - a.mtime).slice(16).map(file => unlink(file.path).catch(() => undefined)));
    } catch {
      // Cache failures must not prevent fetching captions.
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  return { read, write };
}
