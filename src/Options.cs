using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

internal sealed class Options
{
    public List<string> Urls { get; } = [];
    public string? CacheDirectory { get; private set; } =
        System.IO.Path.Combine(
            Environment.GetEnvironmentVariable("XDG_CACHE_HOME")
                ?? System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".cache"
                ),
            "yt-dlp"
        );
    public string? Cookies { get; private set; }
    public bool Help { get; private set; }
    public bool Version { get; private set; }
    public bool DumpJson { get; private set; }
    public bool ListSubs { get; private set; }
    public bool WriteSubs { get; private set; }
    public bool WriteAutoSubs { get; private set; }
    public bool SkipDownload { get; private set; }
    public bool? Simulate { get; private set; }
    public bool Quiet { get; private set; }
    public bool NoWarnings { get; private set; }
    public bool Verbose { get; private set; }
    public bool ForceOverwrite { get; private set; }
    public bool IgnoreErrors { get; private set; }
    public bool Stats { get; private set; }
    public double SocketTimeout { get; private set; } = 60;
    public string SubFormat { get; private set; } = "best";
    public List<string> SubLanguages { get; } = [];
    public Dictionary<string, string> Paths { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> Templates { get; } =
        new(StringComparer.Ordinal) { ["default"] = "%(title)s [%(id)s].%(ext)s" };
    public Dictionary<string, string> ExtractorArguments { get; } = new(StringComparer.Ordinal);
    public string PlayerClients => ExtractorArguments.GetValueOrDefault("player_client", "default");
    public bool IsSimulation => Simulate ?? (DumpJson || ListSubs);

    public static Options Parse(IEnumerable<string> arguments, bool validate = true)
    {
        var args = arguments.ToArray();
        var o = new Options();
        var positional = false;
        var allSubs = false;
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg == "--" && !positional)
            {
                positional = true;
                continue;
            }
            if (positional || !arg.StartsWith('-') || arg == "-")
            {
                o.Urls.Add(arg);
                continue;
            }
            string? inline = null;
            if (arg.StartsWith("--", StringComparison.Ordinal) && arg.Contains('='))
            {
                var split = arg.Split('=', 2);
                arg = split[0];
                inline = split[1];
            }
            else if (arg.Length > 2 && arg[0] == '-' && arg[1] is 'o' or 'P')
            {
                inline = arg[2..];
                arg = arg[..2];
            }
            string Value() =>
                inline
                ?? (
                    ++i < args.Length
                        ? args[i]
                        : throw new ArgumentException($"Missing value for {arg}.")
                );
            switch (arg)
            {
                case "-h":
                case "--help":
                    o.Help = true;
                    break;
                case "--version":
                    o.Version = true;
                    break;
                case "--cookies":
                    o.Cookies = Configuration.Expand(Value());
                    break;
                case "--no-cookies":
                    o.Cookies = null;
                    break;
                case "-j":
                case "--dump-json":
                case "-J":
                case "--dump-single-json":
                    o.DumpJson = true;
                    break;
                case "--list-subs":
                    o.ListSubs = true;
                    break;
                case "--write-subs":
                case "--write-sub":
                case "--write-srt":
                    o.WriteSubs = true;
                    break;
                case "--no-write-subs":
                case "--no-write-sub":
                case "--no-write-srt":
                    o.WriteSubs = false;
                    break;
                case "--write-auto-subs":
                case "--write-auto-sub":
                case "--write-automatic-subs":
                    o.WriteAutoSubs = true;
                    break;
                case "--no-write-auto-subs":
                case "--no-write-auto-sub":
                case "--no-write-automatic-subs":
                    o.WriteAutoSubs = false;
                    break;
                case "--all-subs":
                    allSubs = true;
                    break;
                case "--sub-langs":
                case "--srt-langs":
                    o.SubLanguages.AddRange(Value().Split(',').Select(x => x.Trim()));
                    break;
                case "--sub-format":
                    o.SubFormat = Value();
                    break;
                case "--skip-download":
                case "--no-download":
                    o.SkipDownload = true;
                    break;
                case "-s":
                case "--simulate":
                    o.Simulate = true;
                    break;
                case "--no-simulate":
                    o.Simulate = false;
                    break;
                case "-q":
                case "--quiet":
                    o.Quiet = true;
                    break;
                case "--no-quiet":
                    o.Quiet = false;
                    break;
                case "--no-warnings":
                    o.NoWarnings = true;
                    break;
                case "-v":
                case "--verbose":
                    o.Verbose = true;
                    break;
                case "--no-progress":
                case "--progress":
                case "--no-colors":
                case "--no-playlist":
                    break;
                case "--force-overwrites":
                    o.ForceOverwrite = true;
                    break;
                case "--no-overwrites":
                case "--no-force-overwrites":
                case "-w":
                    o.ForceOverwrite = false;
                    break;
                case "-i":
                case "--ignore-errors":
                    o.IgnoreErrors = true;
                    break;
                case "--no-ignore-errors":
                case "--abort-on-error":
                    o.IgnoreErrors = false;
                    break;
                case "--stats":
                    o.Stats = true;
                    break;
                case "--socket-timeout":
                    o.SocketTimeout = double.Parse(Value(), CultureInfo.InvariantCulture);
                    break;
                case "-o":
                case "--output":
                    SetTyped(o.Templates, Value(), "default", ["default", "subtitle"]);
                    break;
                case "-P":
                case "--paths":
                    SetTyped(
                        o.Paths,
                        Configuration.Expand(Value()),
                        "home",
                        ["home", "subtitle", "temp"]
                    );
                    break;
                case "--extractor-args":
                    var value = Value().Split(':', 2);
                    if (value.Length != 2 || value[0].ToLowerInvariant() != "youtube")
                        throw new ArgumentException(
                            "Only youtube extractor arguments are supported in the caption milestone."
                        );
                    foreach (var item in value[1].Split(';', StringSplitOptions.RemoveEmptyEntries))
                    {
                        var pair = item.Split('=', 2);
                        if (pair.Length != 2)
                            throw new ArgumentException("Invalid youtube extractor argument.");
                        o.ExtractorArguments[pair[0].ToLowerInvariant()] = pair[1];
                    }
                    break;
                case "--remote-components":
                    if (Value().Split(',').Any(x => x is not "ejs:github" and not "ejs:npm"))
                        throw new ArgumentException("Unknown remote component source.");
                    break; // Native caption requests do not execute media JavaScript challenges.
                case "--no-remote-components":
                case "--no-js-runtimes":
                    break;
                case "--no-cache-dir":
                    o.CacheDirectory = null;
                    break;
                case "--cache-dir":
                    o.CacheDirectory = Configuration.Expand(Value());
                    break;
                case "--js-runtimes":
                    _ = Value();
                    break;
                case "--ignore-config":
                case "--no-config":
                case "--no-config-locations":
                    break;
                case "--config-locations":
                case "--config-location":
                    _ = Value();
                    break;
                default:
                    throw new ArgumentException(
                        $"Unsupported option in the caption milestone: {arg}. See --help and COMPATIBILITY.md."
                    );
            }
        }
        if (allSubs)
        {
            o.SubLanguages.Clear();
            o.SubLanguages.Add("all");
            if (!o.WriteAutoSubs)
                o.WriteSubs = true;
        }
        if (validate && !o.Help && !o.Version)
        {
            if (o.Urls.Count == 0)
                throw new ArgumentException("You must provide at least one YouTube video URL.");
            if (!o.SkipDownload && !o.IsSimulation)
                throw new ArgumentException(
                    "Media downloads are not implemented yet. Use --skip-download for subtitles, or --dump-single-json/--list-subs."
                );
            if (!double.IsFinite(o.SocketTimeout) || o.SocketTimeout <= 0)
                throw new ArgumentException("--socket-timeout must be positive.");
            foreach (var pair in o.ExtractorArguments)
            {
                if (
                    pair.Key == "player_client"
                    && pair.Value.Split(',').All(x => x is "default" or "web_embedded")
                )
                    continue;
                if (pair.Key == "skip" && pair.Value == "translated_subs")
                    continue;
                throw new ArgumentException($"Unsupported youtube extractor argument: {pair.Key}.");
            }
        }
        return o;
    }

    private static void SetTyped(
        Dictionary<string, string> map,
        string value,
        string fallback,
        string[] types
    )
    {
        var parts = value.Split(':', 2);
        if (parts.Length == 2 && types.Contains(parts[0]))
            map[parts[0]] = parts[1];
        else
            map[fallback] = value;
    }
}
