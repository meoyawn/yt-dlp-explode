using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

internal static class PlayerScriptCacheTests
{
    private const string Url =
        "https://www.youtube.com/s/player/abcd1234/player_embed_es6.vflset/en_US/base.js?hl=en";
    private const string Body = "var config = {signatureTimestamp: 20712};";

    private sealed class Server(Action<HttpResponseMessage>? configure = null) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken token
        )
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                RequestMessage = request,
                Content = new StringContent(Body),
            };
            response.Headers.CacheControl = new CacheControlHeaderValue
            {
                Public = true,
                MaxAge = TimeSpan.FromHours(1),
            };
            response.Headers.Vary.Add("Origin");
            response.Headers.Vary.Add("Accept-Encoding");
            configure?.Invoke(response);
            return Task.FromResult(response);
        }
    }

    public static async Task RunAsync(string root, Action<bool, string> check)
    {
        var cache = Path.Combine(root, "player-cache");
        async Task<int> Pull(
            string? directory,
            string url = Url,
            string origin = "https://www.youtube.com",
            Action<HttpResponseMessage>? configure = null
        )
        {
            using var handler = new PlayerScriptCache(new Server(configure), directory);
            using var client = new HttpClient(handler);
            client.DefaultRequestHeaders.Add("Origin", origin);
            check(
                await client.GetStringAsync(url) == Body,
                "cached script preserves original bytes"
            );
            return handler.RequestCount;
        }

        check(
            await Pull(cache) == 1 && await Pull(cache) == 0,
            "public script reused across new client instances"
        );
        check(
            await Pull(cache, Url.Replace("abcd1234", "new12345")) == 1,
            "player version changes miss cache"
        );
        check(
            await Pull(cache, origin: "https://www.google.com") == 1,
            "Origin varies the cache key"
        );
        check(
            await Pull(cache, Url.Replace("hl=en", "hl=fr")) == 1,
            "query remains part of cache key"
        );
        check(await Pull(null) == 1 && await Pull(null) == 1, "disabled cache always uses network");

        foreach (
            var url in new[]
            {
                "https://www.youtube.com/embed/video",
                "https://www.youtube.com/api/timedtext",
                "https://other.example/s/player/abcd/player/en/base.js",
            }
        )
            check(
                await Pull(cache, url) == 1 && await Pull(cache, url) == 1,
                "only YouTube player scripts can be cached"
            );

        Action<HttpResponseMessage>[] uncacheable =
        [
            r => r.Headers.CacheControl!.NoStore = true,
            r => r.Headers.CacheControl!.NoCache = true,
            r => r.Headers.CacheControl!.Private = true,
            r => r.Headers.CacheControl!.Public = false,
            r => r.Headers.CacheControl!.MaxAge = TimeSpan.Zero,
            r => r.Headers.Age = TimeSpan.FromHours(2),
            r => r.Headers.Date = DateTimeOffset.UtcNow.AddHours(-2),
            r => r.Headers.Vary.Add("Cookie"),
            r => r.Headers.Add("Set-Cookie", "session=synthetic; Path=/"),
            r => r.StatusCode = HttpStatusCode.PartialContent,
        ];
        foreach (var configure in uncacheable)
        {
            var directory = Path.Combine(root, Guid.NewGuid().ToString("N"));
            check(
                await Pull(directory, configure: configure) == 1
                    && await Pull(directory, configure: configure) == 1,
                "non-public, stale, personalized, and partial responses are not cached"
            );
        }

        var recovery = Path.Combine(root, "cache-recovery");
        await Pull(recovery);
        var entry = Directory.GetFiles(recovery, "*.cache", SearchOption.AllDirectories).Single();
        File.WriteAllText(entry, "truncated");
        check(
            await Pull(recovery) == 1 && await Pull(recovery) == 0,
            "truncated cache is replaced from network"
        );
        using (var stream = File.OpenWrite(entry))
        using (var writer = new BinaryWriter(stream))
        {
            stream.Position = 8;
            writer.Write(DateTime.UtcNow.AddDays(-1).Ticks);
        }
        check(await Pull(recovery) == 1, "expired cache entry fetches a fresh script");
        using (var stream = File.OpenWrite(entry))
        {
            stream.Position = stream.Length - 1;
            stream.WriteByte(0);
        }
        check(await Pull(recovery) == 1, "corrupted script bytes are rejected by checksum");
        var blocked = Path.Combine(root, "cache-is-a-file");
        File.WriteAllText(blocked, "occupied");
        check(await Pull(blocked) == 1, "unavailable cache does not break retrieval");
        for (var i = 0; i < 18; i++)
            await Pull(recovery, Url.Replace("abcd1234", "version" + i));
        check(
            Directory.GetFiles(recovery, "*.cache", SearchOption.AllDirectories).Length == 16,
            "cache size is bounded"
        );

        check(
            Options.Parse(["--cache-dir", root, "--no-cache-dir", "-J", "id"]).CacheDirectory
                is null,
            "no-cache-dir overrides configured cache"
        );
        check(
            Options.Parse(["--no-cache-dir", "--cache-dir", root, "-J", "id"]).CacheDirectory
                == root,
            "cache-dir can re-enable caching"
        );
        var oldXdg = Environment.GetEnvironmentVariable("XDG_CACHE_HOME");
        try
        {
            Environment.SetEnvironmentVariable("XDG_CACHE_HOME", root);
            check(
                Options.Parse(["-J", "id"]).CacheDirectory == Path.Combine(root, "yt-dlp"),
                "yt-dlp XDG cache location"
            );
        }
        finally
        {
            Environment.SetEnvironmentVariable("XDG_CACHE_HOME", oldXdg);
        }
    }
}
