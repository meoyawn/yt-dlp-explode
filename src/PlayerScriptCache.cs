using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

// A narrow HTTP cache for public, versioned player scripts. Bootstrap responses,
// player metadata, signed URLs, captions, and cookies are never cached here.
internal sealed class PlayerScriptCache(HttpMessageHandler inner, string? directory)
    : DelegatingHandler(inner)
{
    private const long Magic = 0x3153434558504459;
    private const int HeaderLength = 56;
    private const int MaxBytes = 4 * 1024 * 1024;
    private const int MaxEntries = 16;
    public int RequestCount { get; private set; }

    private string? CachePath(HttpRequestMessage request)
    {
        if (
            directory is null
            || request.Method != HttpMethod.Get
            || request.RequestUri is not { Scheme: "https", Host: "www.youtube.com", Port: 443 } uri
            || (uri.Query.Length != 0 && !Regex.IsMatch(uri.Query, @"^\?hl=[a-zA-Z_-]+$"))
            || !Regex.IsMatch(
                uri.AbsolutePath,
                @"^/s/player/[a-zA-Z0-9_-]+/[a-zA-Z0-9_./-]+/base\.js$"
            )
        )
            return null;

        var origin = request.Headers.TryGetValues("Origin", out var values)
            ? string.Join(",", values)
            : "";
        var key = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(uri.AbsoluteUri + "\n" + origin))
        );
        return Path.Combine(directory, "yt-dlp-explode-player-v1", key + ".cache");
    }

    private static HttpResponseMessage? Read(string path, HttpRequestMessage request)
    {
        FileStream? stream = null;
        try
        {
            stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read | FileShare.Delete
            );
            using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
            var magic = reader.ReadInt64();
            var expires = reader.ReadInt64();
            var length = reader.ReadInt64();
            if (
                magic != Magic
                || expires <= DateTime.UtcNow.Ticks
                || length is <= 0 or > MaxBytes
                || stream.Length != HeaderLength + length
            )
                return null;

            var checksum = reader.ReadBytes(32);
            if (!SHA256.HashData(stream).AsSpan().SequenceEqual(checksum))
                return null;
            stream.Position = HeaderLength;
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                RequestMessage = request,
                Content = new StreamContent(stream),
            };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue("text/javascript")
            {
                CharSet = "utf-8",
            };
            response.Content.Headers.ContentLength = length;
            stream = null; // Response owns the open file.
            return response;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
        finally
        {
            stream?.Dispose();
        }
    }

    private static TimeSpan? Freshness(HttpResponseMessage response)
    {
        if (
            response.StatusCode != HttpStatusCode.OK
            || response.Headers.CacheControl
                is not {
                    Public: true,
                    NoStore: false,
                    NoCache: false,
                    Private: false,
                    MaxAge: { } maxAge
                }
            || response.Headers.Contains("Set-Cookie")
            || response.Headers.Vary.Any(x =>
                !x.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase)
                && !x.Equals("Origin", StringComparison.OrdinalIgnoreCase)
            )
        )
            return null;
        var age = response.Headers.Age ?? TimeSpan.Zero;
        if (response.Headers.Date is { } date && DateTimeOffset.UtcNow - date > age)
            age = DateTimeOffset.UtcNow - date;
        var remaining = maxAge - age;
        return remaining > TimeSpan.Zero
            ? TimeSpan.FromSeconds(Math.Min(remaining.TotalSeconds, 7 * 86400))
            : null;
    }

    private static void Write(string path, byte[] data, TimeSpan lifetime)
    {
        string? temporary = null;
        try
        {
            var directory = Path.GetDirectoryName(path)!;
            Directory.CreateDirectory(directory);
            temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            using (
                var stream = new FileStream(
                    temporary,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None
                )
            )
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(Magic);
                writer.Write(DateTime.UtcNow.Add(lifetime).Ticks);
                writer.Write((long)data.Length);
                writer.Write(SHA256.HashData(data));
                writer.Write(data);
            }
            File.Move(temporary, path, overwrite: true);
            foreach (
                var file in new DirectoryInfo(directory)
                    .EnumerateFiles("*.cache")
                    .OrderByDescending(x => x.LastWriteTimeUtc)
                    .Skip(MaxEntries)
            )
                file.Delete();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Cache permissions, corruption, or concurrent eviction must not prevent a pull.
        }
        finally
        {
            if (temporary is not null)
            {
                try
                {
                    File.Delete(temporary);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken token
    )
    {
        var start = Profile.Now;
        var path = CachePath(request);
        if (path is not null && Read(path, request) is { } cached)
        {
            Profile.Add("player_script_cache_hit", start);
            return cached;
        }
        RequestCount++;
        var httpStart = Profile.Now;
        var response = await base.SendAsync(request, token);
        Profile.Add(
            "http_headers " + request.RequestUri?.AbsolutePath + " HTTP/" + response.Version,
            httpStart
        );
        if (Profile.Enabled)
        {
            var bodyStart = Profile.Now;
            await response.Content.LoadIntoBufferAsync(token);
            Profile.Add(
                "http_body " + request.RequestUri?.AbsolutePath,
                bodyStart,
                response.Content.Headers.ContentLength
            );
        }
        if (
            path is not null
            && Freshness(response) is { } lifetime
            && response.Content.Headers.ContentLength is not > MaxBytes
        )
        {
            var data = await response.Content.ReadAsByteArrayAsync(token);
            if (data.Length is > 0 and <= MaxBytes)
                Write(path, data, lifetime);
        }
        return response;
    }
}
