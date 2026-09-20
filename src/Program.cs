using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using YoutubeExplode.Videos;

internal static class Program
{
    private const string Help = """
        Usage: yt-dlp-explode [OPTIONS] URL [URL...]

        Native AOT CLI targeting yt-dlp compatibility. Current milestone: YouTube captions.

          --skip-download              Retrieve metadata/subtitles without media
          -J, --dump-single-json       Print caption metadata JSON; implies simulation
          -j, --dump-json              Print one JSON object per video
          --list-subs                  List manual and automatic subtitle tracks
          --write-subs                 Write manual subtitles
          --write-auto-subs            Write automatic subtitles
          --sub-langs LANGS            Comma-separated codes/regex, all, and -exclusions
          --sub-format FORMAT          Format preference, e.g. json3/vtt/best
          -o, --output TEMPLATE        yt-dlp filename template, optionally subtitle:...
          -P, --paths PATH             Output directory, optionally home:/subtitle:
          --cookies FILE              Read AND save a Netscape cookie jar
          --no-cookies                Disable cookie-file load/save
          --cache-dir DIR             Cache public player scripts (yt-dlp cache location)
          --no-cache-dir              Disable reading and writing that cache
          --config-locations PATH      Additional config file/directory; repeatable
          --ignore-config             Disable automatic config discovery
          -s, --simulate               Retrieve metadata without writing subtitles
          --no-simulate               Allow writes with JSON/listing options
          --no-playlist               Handle the video in a video/playlist URL
          --force-overwrites          Replace existing subtitle files
          -q, --quiet                 Suppress progress messages
          --no-warnings               Suppress warnings
          -v, --verbose               Report loaded config paths and request counts
          --socket-timeout SECONDS    HTTP timeout (default: 60)
          --stats                     Additional timing/request JSON on stderr
          --version                   Print version
          -h, --help                  Show this help

        Reads yt-dlp's portable, home, user, and system config locations.
        Full compatibility is the project goal. Media downloading and other
        extractors are not implemented; see COMPATIBILITY.md for the current scope.
        """;

    public static async Task<int> Main(string[] args)
    {
        // .NET 10 keeps the TLS 1.3-capable macOS backend opt-in. Leave an
        // explicit runtime environment setting available for diagnostics.
        if (
            OperatingSystem.IsMacOS()
            && Environment.GetEnvironmentVariable("DOTNET_SYSTEM_NET_SECURITY_USENETWORKFRAMEWORK")
                is null
        )
            AppContext.SetSwitch("System.Net.Security.UseNetworkFramework", true);
        var configStart = Profile.Now;
        Options options;
        try
        {
            var configuration = new Configuration(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                AppContext.BaseDirectory,
                Environment.CurrentDirectory
            );
            options = Options.Parse(configuration.Load(args));
            Profile.Add("config", configStart);
            if (options.Help)
            {
                Console.WriteLine(Help);
                return 0;
            }
            if (options.Version)
            {
                Console.WriteLine("0.1.1");
                return 0;
            }
            if (options.Verbose)
                foreach (var file in configuration.Files)
                    Console.Error.WriteLine($"[debug] Config: {file}");
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or IOException)
        {
            Console.Error.WriteLine($"ERROR: {ex.Message}");
            return 2;
        }

        void Warning(string message)
        {
            if (!options.NoWarnings)
                Console.Error.WriteLine($"WARNING: {message}");
        }
        void Info(string message)
        {
            if (!options.Quiet && !options.DumpJson)
                Console.Error.WriteLine($"[info] {message}");
        }
        var exitCode = 0;
        CookieJar? jar = null;
        using var cancellation = new CancellationTokenSource();
        ConsoleCancelEventHandler cancel = (_, e) =>
        {
            e.Cancel = true;
            cancellation.Cancel();
        };
        Console.CancelKeyPress += cancel;
        try
        {
            var jarStart = Profile.Now;
            jar = new CookieJar(options.Cookies, Warning);
            Profile.Add("cookie_load", jarStart);
            if (
                options.PlayerClients == "web_embedded"
                && !jar.YoutubeCookies().Any(x => x.Name == "LOGIN_INFO")
            )
                throw new ArgumentException(
                    "The pinned library currently requires a logged-in cookie jar for forced web_embedded captions; use player_client=default for anonymous access."
                );
            var sessionStart = Profile.Now;
            using var session = new CaptionSession(
                jar,
                options.SocketTimeout,
                options.CacheDirectory
            );
            Profile.Add("client_setup", sessionStart);
            foreach (var url in options.Urls)
            {
                try
                {
                    var timer = Stopwatch.StartNew();
                    var requestsBefore = session.RequestCount;
                    var id = VideoId.Parse(url).ToString();
                    var manifestStart = Profile.Now;
                    var manifest = await session.ManifestAsync(id, cancellation.Token);
                    Profile.Add("manifest", manifestStart);
                    var manifestMs = timer.Elapsed.TotalMilliseconds;
                    var selectionStart = Profile.Now;
                    var info = new CaptionInfo(id, url, session.Player, manifest, options);
                    info.Populate();
                    info.Select(Warning);
                    Profile.Add("caption_selection", selectionStart);
                    if (options.ListSubs)
                    {
                        foreach (
                            var (name, map) in new[]
                            {
                                ("automatic captions", info.Automatic),
                                ("subtitles", info.Manual),
                            }
                        )
                        {
                            Console.WriteLine($"[info] Available {name} for {id}:");
                            foreach (var sub in map.Values)
                                Console.WriteLine(
                                    $"{sub.Language}\t{sub.Name}\t{string.Join(", ", Subtitle.Formats.Reverse())}"
                                );
                        }
                    }
                    if (!options.IsSimulation && (options.WriteSubs || options.WriteAutoSubs))
                    {
                        if (info.Selected.Count == 0)
                            Info("There are no subtitles for the requested languages");
                        foreach (var pair in info.Selected.ToArray())
                        {
                            var (sub, format, _) = pair.Value;
                            var file = info.Filename(pair.Key, format);
                            if (file.Length == 0)
                                continue;
                            if (!options.ForceOverwrite && File.Exists(file))
                                Info($"Video subtitle {pair.Key}.{format} is already present");
                            else
                            {
                                var data = await session.DownloadAsync(
                                    sub.FormatUrl(format),
                                    cancellation.Token
                                );
                                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                                var temp = file + "." + Guid.NewGuid().ToString("N") + ".part";
                                try
                                {
                                    await File.WriteAllBytesAsync(temp, data, cancellation.Token);
                                    File.Move(temp, file, options.ForceOverwrite);
                                }
                                finally
                                {
                                    if (File.Exists(temp))
                                        File.Delete(temp);
                                }
                                Info($"Writing video subtitles to: {file}");
                            }
                            info.Selected[pair.Key] = (sub, format, file);
                        }
                    }
                    var outputStart = Profile.Now;
                    if (options.DumpJson)
                        info.WriteJson(Console.OpenStandardOutput());
                    Profile.Add("json_output", outputStart);
                    if (options.Verbose)
                        Console.Error.WriteLine(
                            $"[debug] {session.RequestCount - requestsBefore} HTTP requests for {id}"
                        );
                    if (options.Stats)
                    {
                        using var json = new Utf8JsonWriter(Console.OpenStandardError());
                        json.WriteStartObject();
                        json.WriteString("video_id", id);
                        json.WriteNumber("http_requests", session.RequestCount - requestsBefore);
                        json.WriteNumber("manifest_ms", manifestMs);
                        json.WriteNumber("total_ms", timer.Elapsed.TotalMilliseconds);
                        json.WriteEndObject();
                        json.Flush();
                        Console.Error.WriteLine();
                    }
                }
                catch (Exception ex)
                    when (options.IgnoreErrors && ex is not OperationCanceledException)
                {
                    Console.Error.WriteLine($"ERROR: {ex.Message}");
                    exitCode = 1;
                }
            }
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine(
                cancellation.IsCancellationRequested
                    ? "ERROR: Interrupted"
                    : "ERROR: HTTP request timed out"
            );
            exitCode = cancellation.IsCancellationRequested ? 130 : 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR: {ex.Message}");
            exitCode = 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
            try
            {
                var saveStart = Profile.Now;
                jar?.Save();
                Profile.Add("cookie_save", saveStart);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"ERROR: Could not save cookies: {ex.Message}");
                exitCode = 1;
            }
        }
        Profile.Save();
        return exitCode;
    }
}
