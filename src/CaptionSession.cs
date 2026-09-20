using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using YoutubeExplode;
using YoutubeExplode.Videos.ClosedCaptions;

internal sealed class CaptionSession : IDisposable
{
    private readonly CaptureHandler _handler;
    private readonly HttpClient _http;
    private readonly YoutubeClient _youtube;
    public int RequestCount => _handler.Count;
    public JsonElement Player => _handler.Player;

    public CaptionSession(CookieJar jar, double socketTimeout, string? cacheDirectory)
    {
        _handler = new CaptureHandler(jar.Container, cacheDirectory);
        _http = new HttpClient(_handler) { Timeout = TimeSpan.FromSeconds(socketTimeout) };
        _youtube = new YoutubeClient(_http, jar.YoutubeCookies());
    }

    public async Task<ClosedCaptionManifest> ManifestAsync(string id, CancellationToken token) =>
        await _youtube.Videos.ClosedCaptions.GetManifestAsync(id, token);

    public async Task<byte[]> DownloadAsync(string url, CancellationToken token)
    {
        using var response = await _http.GetAsync(url, token);
        response.EnsureSuccessStatusCode();
        var bytes = await response.Content.ReadAsByteArrayAsync(token);
        if (bytes.Length == 0)
            throw new InvalidOperationException("YouTube returned empty subtitles.");
        return bytes;
    }

    public void Dispose()
    {
        _youtube.Dispose();
        _http.Dispose();
    }

    private sealed class CaptureHandler(CookieContainer cookies, string? cacheDirectory)
        : DelegatingHandler(
            new PlayerScriptCache(
                new HttpClientHandler
                {
                    CookieContainer = cookies,
                    AutomaticDecompression = DecompressionMethods.All,
                },
                cacheDirectory
            )
        )
    {
        public int Count => ((PlayerScriptCache)InnerHandler!).RequestCount;
        public JsonElement Player { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken token
        )
        {
            request.Version = HttpVersion.Version20;
            request.VersionPolicy = HttpVersionPolicy.RequestVersionOrLower;
            // Share one HTTP cookie jar, including cookies received during redirects.
            if (
                request.RequestUri is { } uri
                && request.Headers.TryGetValues("Cookie", out var headers)
            )
            {
                if (cookies.GetCookies(uri)["SOCS"] is null)
                {
                    var consent = headers
                        .SelectMany(x => x.Split(';'))
                        .Select(x => x.Trim())
                        .FirstOrDefault(x => x.StartsWith("SOCS=", StringComparison.Ordinal));
                    if (consent is not null)
                        cookies.SetCookies(uri, consent + "; Path=/");
                }
                request.Headers.Remove("Cookie");
            }
            var response = await base.SendAsync(request, token);
            if (
                request.RequestUri?.AbsolutePath == "/youtubei/v1/player"
                && response.IsSuccessStatusCode
            )
            {
                var parseStart = Profile.Now;
                using var json = JsonDocument.Parse(
                    await response.Content.ReadAsStringAsync(token)
                );
                Player = json.RootElement.Clone();
                Profile.Add("capture_player_json", parseStart);
            }
            return response;
        }
    }
}
