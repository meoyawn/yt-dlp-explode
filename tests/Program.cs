using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using YoutubeExplode.Videos.ClosedCaptions;

internal static class CompatibilityTests
{
    private static int _checks;

    private static void Check(bool condition, string message)
    {
        if (!condition)
            throw new Exception(message);
        _checks++;
    }

    public static void Main()
    {
        var directory = Path.Combine(
            Path.GetTempPath(),
            "yt-dlp-explode-tests-" + Guid.NewGuid().ToString("N")
        );
        var oldXdg = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        var oldAppdata = Environment.GetEnvironmentVariable("APPDATA");
        var oldLowerAppdata = Environment.GetEnvironmentVariable("appdata");
        try
        {
            Directory.CreateDirectory(directory);
            Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", Path.Combine(directory, "xdg"));
            Environment.SetEnvironmentVariable("APPDATA", null);
            Environment.SetEnvironmentVariable("appdata", null);
            var home = Path.Combine(directory, "home");
            var portable = Path.Combine(directory, "portable");
            var work = Path.Combine(directory, "work");
            Directory.CreateDirectory(Path.Combine(home, ".yt-dlp"));
            Directory.CreateDirectory(portable);
            Directory.CreateDirectory(work);
            File.WriteAllText(
                Path.Combine(home, ".yt-dlp/config.txt"),
                "--cookies user.txt\n--sub-langs en\n--extractor-args youtube:player_client=web_embedded"
            );
            File.WriteAllText(
                Path.Combine(work, "yt-dlp.conf"),
                "--cookies home.txt\n--sub-format json3"
            );
            File.WriteAllText(Path.Combine(portable, "yt-dlp.conf"), "--cookies portable.txt");
            Options Load(params string[] arguments) =>
                Options.Parse(new Configuration(home, portable, work).Load(arguments));
            var opts = Load("--skip-download", "4Ff0xc9M8kA");
            Check(opts.Cookies == "portable.txt", "portable over home and user");
            Check(
                opts.SubFormat == "json3" && opts.SubLanguages.SequenceEqual(["en"]),
                "lower-precedence options retained"
            );
            Check(
                Load("--cookies", "cli.txt", "--skip-download", "4Ff0xc9M8kA").Cookies == "cli.txt",
                "command-line override"
            );
            Check(
                Load("--no-cookies", "--skip-download", "4Ff0xc9M8kA").Cookies is null,
                "no-cookies override"
            );
            Check(
                Load("--ignore-config", "--skip-download", "4Ff0xc9M8kA").Cookies is null,
                "ignore-config disables defaults"
            );
            var custom = Path.Combine(directory, "custom.conf");
            var child = Path.Combine(directory, "child.conf");
            File.WriteAllText(custom, "--cookies custom.txt\n--config-locations child.conf");
            File.WriteAllText(
                child,
                "--cookies child.txt\n--sub-format vtt\n--config-locations custom.conf"
            );
            opts = Load(
                "--ignore-config",
                "--config-locations",
                custom,
                "--skip-download",
                "4Ff0xc9M8kA"
            );
            Check(
                opts.Cookies == "custom.txt" && opts.SubFormat == "vtt",
                "nested relative configs and recursive cycle"
            );
            Check(
                Load(
                    "--ignore-config",
                    "--config-locations",
                    custom,
                    "--no-config-locations",
                    "--skip-download",
                    "4Ff0xc9M8kA"
                ).Cookies
                    is null,
                "no-config-locations resets includes"
            );
            File.WriteAllText(
                Path.Combine(portable, "yt-dlp.conf"),
                "--ignore-config\n--cookies portable.txt"
            );
            Check(
                Load("--skip-download", "4Ff0xc9M8kA").SubFormat == "best",
                "ignore-config inside portable stops lower layers"
            );
            Check(
                Configuration
                    .Tokenize(
                        "--cookies 'a b.txt' # comment\n--output \"%(title)s \\\"quote\\\".%(ext)s\" --no-warnings"
                    )
                    .SequenceEqual([
                        "--cookies",
                        "a b.txt",
                        "--output",
                        "%(title)s \"quote\".%(ext)s",
                        "--no-warnings",
                    ]),
                "POSIX quoting and comments"
            );
            Check(
                Options.Parse(["--cookies", "x", "--no-cookies", "-J", "id"]).Cookies is null,
                "last cookie toggle wins"
            );
            Check(
                Options.Parse(["-J", "--write-auto-subs", "id"]).IsSimulation,
                "JSON implies simulation"
            );
            Check(
                !Options.Parse(["-J", "--no-simulate", "--skip-download", "id"]).IsSimulation,
                "no-simulate overrides JSON"
            );
            opts = Options.Parse([
                "--extractor-args",
                "youtube:player_client=web_embedded",
                "--extractor-args",
                "youtube:player_client=default,web_embedded",
                "--remote-components",
                "ejs:github",
                "-J",
                "id",
            ]);
            Check(
                opts.PlayerClients == "default,web_embedded",
                "script client setting overrides user config"
            );
            try
            {
                Options.Parse(["--download-archive", "x", "id"]);
                throw new Exception("Unknown option accepted");
            }
            catch (ArgumentException)
            {
                _checks++;
            }
            try
            {
                Options.Parse(["id"]);
                throw new Exception("Media action silently accepted");
            }
            catch (ArgumentException)
            {
                _checks++;
            }

            var cookiePath = Path.Combine(directory, "cookies.txt");
            File.WriteAllText(
                cookiePath,
                "# Netscape HTTP Cookie File\n"
                    + "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tLOGIN_INFO\tlogin\n"
                    + ".youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tsession\n"
                    + "example.org\tFALSE\t/\tFALSE\t0\tforeign\tkeep\n"
                    + ".youtube.com\tTRUE\t/\tTRUE\t1\texpired\tkeep-expired\n"
                    + "www.youtube.com\tFALSE\t/\tTRUE\t\thost\tonly\n"
                    + ".youtube.com\tTRUE\t/\tFALSE\t0\t\tnameless\n"
            );
            var jar = new CookieJar(cookiePath);
            Check(
                jar.YoutubeCookies().Any(c => c.Name == "LOGIN_INFO" && c.HttpOnly),
                "HttpOnly session imports"
            );
            Check(
                !jar.YoutubeCookies().Any(c => c.Name is "foreign" or "expired"),
                "domain and expiry request policy"
            );
            Check(
                jar.Container.GetCookies(new Uri("https://sub.www.youtube.com/"))["host"] is null,
                "host-only cookie domain"
            );
            jar.Container.SetCookies(
                new Uri("https://www.youtube.com/"),
                "SAPISID=updated; Domain=.youtube.com; Path=/; Secure; HttpOnly"
            );
            jar.Container.SetCookies(
                new Uri("https://www.youtube.com/"),
                "new-session=new; Domain=.youtube.com; Path=/; Secure"
            );
            jar.Save();
            var saved = File.ReadAllText(cookiePath);
            Check(
                saved.Contains("foreign\tkeep")
                    && saved.Contains("expired\tkeep-expired")
                    && saved.Contains("\t\tnameless"),
                "preserve unrelated, expired, and nameless entries"
            );
            Check(
                new CookieJar(cookiePath).YoutubeCookies().Single(c => c.Name == "SAPISID").Value
                    == "updated",
                "response update persisted"
            );
            Check(saved.Contains("#HttpOnly_.youtube.com"), "HttpOnly export round trip");
            var first = new CookieJar(cookiePath);
            var second = new CookieJar(cookiePath);
            first.Container.SetCookies(new Uri("https://www.youtube.com/"), "first=one; Path=/");
            second.Container.SetCookies(new Uri("https://www.youtube.com/"), "second=two; Path=/");
            first.Save();
            second.Save();
            var merged = new CookieJar(cookiePath);
            Check(
                merged.YoutubeCookies().Any(c => c.Name == "first")
                    && merged.YoutubeCookies().Any(c => c.Name == "second"),
                "merge concurrent jar changes"
            );
            merged.Container.SetCookies(
                new Uri("https://www.youtube.com/"),
                "SAPISID=; Domain=.youtube.com; Path=/; Max-Age=0"
            );
            merged.Save();
            Check(
                !new CookieJar(cookiePath).YoutubeCookies().Any(c => c.Name == "SAPISID"),
                "response deletion persisted"
            );
            if (!OperatingSystem.IsWindows())
                Check(
                    File.GetUnixFileMode(cookiePath)
                        == (UnixFileMode.UserRead | UnixFileMode.UserWrite),
                    "private cookie-file permissions"
                );
            var invalid = Path.Combine(directory, "invalid.txt");
            File.WriteAllText(invalid, "[]");
            try
            {
                _ = new CookieJar(invalid);
                throw new Exception("JSON jar accepted");
            }
            catch (FormatException)
            {
                _checks++;
            }
            Check(File.ReadAllText(invalid) == "[]", "invalid jar is not overwritten");
            var fresh = Path.Combine(directory, "fresh.txt");
            var empty = new CookieJar(fresh);
            empty.Container.SetCookies(new Uri("https://www.youtube.com/"), "new=x; Path=/");
            empty.Save();
            Check(new CookieJar(fresh).YoutubeCookies().Count == 1, "new jar creation");

            using var player = JsonDocument.Parse(
                """{"videoDetails":{"title":"Example/title", "lengthSeconds":"42","author":"Creator"}}"""
            );
            var manifest = new ClosedCaptionManifest([
                new(
                    "https://www.youtube.com/api/timedtext?lang=en&xosf=1",
                    new Language("en", "English"),
                    false
                ),
                new(
                    "https://www.youtube.com/api/timedtext?lang=en&kind=asr&xosf=1",
                    new Language("en", "English auto"),
                    true
                ),
                new(
                    "https://www.youtube.com/api/timedtext?lang=fr",
                    new Language("fr", "French"),
                    false
                ),
            ]);
            opts = Options.Parse([
                "--skip-download",
                "--write-subs",
                "--write-auto-subs",
                "-o",
                "%(id)s.%(ext)s",
                "-P",
                directory,
                "id",
            ]);
            var info = new CaptionInfo(
                "4Ff0xc9M8kA",
                "original",
                player.RootElement,
                manifest,
                opts
            );
            info.Populate();
            info.Select(_ => { });
            Check(
                info.Selected.Keys.SequenceEqual(["en"]) && !info.Selected["en"].Subtitle.Automatic,
                "manual English preference"
            );
            Check(
                info.Filename("en", "vtt") == Path.Combine(directory, "4Ff0xc9M8kA.en.vtt"),
                "yt-dlp subtitle filename convention"
            );
            opts = Options.Parse([
                "--skip-download",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                "all,-en.*",
                "--sub-format",
                "unavailable/json3",
                "id",
            ]);
            info = new CaptionInfo("4Ff0xc9M8kA", "original", player.RootElement, manifest, opts);
            info.Populate();
            info.Select(_ => { });
            Check(
                info.Selected.Keys.SequenceEqual(["fr"]) && info.Selected["fr"].Format == "json3",
                "language regex exclusions and format preferences"
            );
            using var buffer = new MemoryStream();
            info.WriteJson(buffer);
            using var json = JsonDocument.Parse(buffer.ToArray());
            Check(
                json.RootElement.GetProperty("automatic_captions")
                    .GetProperty("en-orig")[0]
                    .GetProperty("ext")
                    .GetString() == "json3",
                "script-compatible automatic caption JSON"
            );
            Check(
                !json
                    .RootElement.GetProperty("subtitles")
                    .GetProperty("en")[0]
                    .GetProperty("url")
                    .GetString()!
                    .Contains("xosf"),
                "caption URL removes xosf"
            );
            Check(
                json.RootElement.GetProperty("requested_subtitles")
                    .GetProperty("fr")
                    .GetProperty("ext")
                    .GetString() == "json3",
                "selected subtitle JSON"
            );
            PlayerScriptCacheTests.RunAsync(directory, Check).GetAwaiter().GetResult();
            Console.WriteLine($"{_checks} offline compatibility checks passed.");
        }
        finally
        {
            Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", oldXdg);
            Environment.SetEnvironmentVariable("APPDATA", oldAppdata);
            Environment.SetEnvironmentVariable("appdata", oldLowerAppdata);
            Directory.Delete(directory, true);
        }
    }
}
