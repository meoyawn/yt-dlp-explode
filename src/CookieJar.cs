using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;

internal sealed class CookieJar
{
    private sealed record Entry(
        string Domain,
        bool Subdomains,
        string Path,
        bool Secure,
        string Expires,
        string Name,
        string Value,
        bool HttpOnly
    )
    {
        public string Key => Domain + "\t" + Path + "\t" + Name;
        public string Line =>
            (HttpOnly ? "#HttpOnly_" : "")
            + string.Join(
                '\t',
                Domain,
                Subdomains ? "TRUE" : "FALSE",
                Path,
                Secure ? "TRUE" : "FALSE",
                Expires,
                Name,
                Value
            );

        public static Entry FromCookie(Cookie c) =>
            new(
                c.Domain,
                c.Domain.StartsWith('.'),
                c.Path,
                c.Secure,
                c.Expires == DateTime.MinValue
                    ? "0"
                    : new DateTimeOffset(c.Expires.ToUniversalTime())
                        .ToUnixTimeSeconds()
                        .ToString(CultureInfo.InvariantCulture),
                c.Name,
                c.Value,
                c.HttpOnly
            );
    }

    private readonly string? _path;
    private readonly Dictionary<string, Entry> _original;
    private readonly Dictionary<string, Entry> _initialActive;
    public CookieContainer Container { get; } = new(10000, 1000, 65536);

    public CookieJar(string? path, Action<string>? warning = null)
    {
        _path = path is null ? null : System.IO.Path.GetFullPath(path);
        _original = Read(_path, warning);
        foreach (var entry in _original.Values)
        {
            if (string.IsNullOrEmpty(entry.Name))
                continue;
            if (!double.TryParse(entry.Expires, CultureInfo.InvariantCulture, out var expires))
                expires = 0;
            if (expires > 253402300799)
                expires = expires / 1_000_000 - 11_644_473_600;
            if (expires > 0 && expires <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
                continue;
            try
            {
                var cookie = new Cookie(entry.Name, entry.Value, entry.Path)
                {
                    Secure = entry.Secure,
                    HttpOnly = entry.HttpOnly,
                    Expires =
                        expires == 0
                            ? DateTime.MinValue
                            : DateTimeOffset.FromUnixTimeSeconds((long)expires).UtcDateTime,
                };
                if (entry.Subdomains)
                {
                    cookie.Domain = entry.Domain;
                    Container.Add(cookie);
                }
                else
                    Container.Add(
                        new Uri(
                            $"{(entry.Secure ? "https" : "http")}://{entry.Domain.TrimStart('.')}{entry.Path}"
                        ),
                        cookie
                    );
            }
            catch (Exception ex)
                when (ex is CookieException or ArgumentException or UriFormatException)
            {
                warning?.Invoke(
                    "A cookie could not be used by the HTTP client; retaining its file entry."
                );
            }
        }
        _initialActive = Snapshot();
    }

    private Dictionary<string, Entry> Snapshot() =>
        Container.GetAllCookies().Cast<Cookie>().Select(Entry.FromCookie).ToDictionary(x => x.Key);

    public IReadOnlyList<Cookie> YoutubeCookies() =>
        Container.GetCookies(new Uri("https://www.youtube.com/")).Cast<Cookie>().ToArray();

    private static Dictionary<string, Entry> Read(string? path, Action<string>? warning)
    {
        var entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        if (path is null || !File.Exists(path))
            return entries;
        using var reader = new StreamReader(path, Encoding.UTF8, true);
        var header = reader.ReadLine();
        if (
            header is null
            || (
                !header.Contains("Netscape HTTP Cookie File", StringComparison.Ordinal)
                && !header.Contains("HTTP Cookie File", StringComparison.Ordinal)
            )
        )
            throw new FormatException(
                "Cookies file must be Netscape formatted and start with a cookie-file header."
            );
        while (reader.ReadLine() is { } raw)
        {
            var httpOnly = raw.StartsWith("#HttpOnly_", StringComparison.Ordinal);
            var line = httpOnly ? raw[10..] : raw;
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#'))
                continue;
            var f = line.Split('\t');
            if (
                f.Length != 7
                || f[1] is not "TRUE" and not "FALSE"
                || f[3] is not "TRUE" and not "FALSE"
                || (
                    f[4].Length > 0
                    && (
                        !double.TryParse(f[4], CultureInfo.InvariantCulture, out var expiry)
                        || !double.IsFinite(expiry)
                        || expiry < 0
                    )
                )
            )
            {
                warning?.Invoke("Skipping a malformed Netscape cookie entry.");
                continue;
            }
            var entry = new Entry(
                f[0],
                f[1] == "TRUE",
                f[2],
                f[3] == "TRUE",
                f[4].Length == 0 ? "0" : f[4],
                f[5],
                f[6],
                httpOnly
            );
            entries[entry.Key] = entry;
        }
        return entries;
    }

    public void Save()
    {
        if (_path is null)
            return;
        var current = Snapshot();
        // Merge only this process's changes, preserving other domains and concurrent updates.
        using var fileLock = new FileStream(
            _path + ".lock",
            FileMode.OpenOrCreate,
            FileAccess.ReadWrite,
            FileShare.None,
            1,
            FileOptions.DeleteOnClose
        );
        var entries = Read(_path, null);
        foreach (var key in _initialActive.Keys)
            if (!current.ContainsKey(key))
                entries.Remove(key);
        foreach (var pair in current)
            if (!_initialActive.TryGetValue(pair.Key, out var initial) || initial != pair.Value)
                entries[pair.Key] = pair.Value;
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var streamOptions = new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
            };
            if (!OperatingSystem.IsWindows())
                streamOptions.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var stream = new FileStream(temp, streamOptions))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                writer.NewLine = "\n";
                writer.WriteLine("# Netscape HTTP Cookie File");
                writer.WriteLine("# Generated by yt-dlp-explode.\n");
                foreach (var entry in entries.Values)
                    writer.WriteLine(entry.Line);
            }
            File.Move(temp, _path, true);
        }
        finally
        {
            if (File.Exists(temp))
                File.Delete(temp);
        }
    }
}
