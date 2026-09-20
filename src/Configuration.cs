using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

internal sealed class Configuration(
    string home,
    string executableDirectory,
    string workingDirectory
)
{
    private readonly HashSet<string> _loaded = new(StringComparer.Ordinal);
    public List<string> Files { get; } = [];

    public static string Expand(string path) =>
        Expand(path, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));

    public static string Expand(string path, string home)
    {
        if (path == "~")
            path = home;
        else if (
            path.StartsWith("~/", StringComparison.Ordinal)
            || path.StartsWith("~\\", StringComparison.Ordinal)
        )
            path = Path.Combine(home, path[2..]);
        path = Regex.Replace(
            path,
            @"\$(?:\{(\w+)\}|(\w+))|%(\w+)%",
            m =>
            {
                var name = m.Groups.Cast<Group>().Skip(1).First(g => g.Success).Value;
                return Environment.GetEnvironmentVariable(name) ?? m.Value;
            }
        );
        return path;
    }

    public string[] Load(string[] commandLine)
    {
        var layers = new List<List<string>> { LoadLayer(commandLine, workingDirectory) };
        bool Ignore() =>
            layers.SelectMany(x => x).Any(x => x is "--ignore-config" or "--no-config");
        void Add(string? path)
        {
            if (path is null || !File.Exists(path))
                return;
            var args = LoadFile(path);
            if (args is not null)
                layers.Add(args);
        }

        if (!Ignore())
            Add(Path.Combine(executableDirectory, "yt-dlp.conf"));
        if (!Ignore())
        {
            var paths = Options
                .Parse(layers.AsEnumerable().Reverse().SelectMany(x => x), validate: false)
                .Paths;
            var directory = paths.GetValueOrDefault("home", workingDirectory);
            Add(Path.Combine(Expand(directory, home), "yt-dlp.conf"));
        }
        List<string>? userLayer = null;
        if (!Ignore())
        {
            var directories = new List<string>
            {
                Path.Combine(
                    Environment.GetEnvironmentVariable("XDG_CONFIG_HOME")
                        ?? Path.Combine(home, ".config"),
                    "yt-dlp"
                ),
            };
            var appdata =
                Environment.GetEnvironmentVariable("APPDATA")
                ?? Environment.GetEnvironmentVariable("appdata");
            if (!string.IsNullOrEmpty(appdata))
                directories.Add(Path.Combine(appdata, "yt-dlp"));
            directories.Add(Path.Combine(home, ".yt-dlp"));
            var before = layers.Count;
            Add(directories.SelectMany(Candidates).FirstOrDefault(File.Exists));
            if (layers.Count > before)
                userLayer = layers[^1];
        }
        if (!Ignore())
        {
            Add(Candidates("/etc/yt-dlp").FirstOrDefault(File.Exists));
            if (Ignore() && userLayer is not null)
                layers.Remove(userLayer);
        }
        return layers.AsEnumerable().Reverse().SelectMany(x => x).ToArray();
    }

    private static IEnumerable<string> Candidates(string directory)
    {
        var parent = Path.GetDirectoryName(directory)!;
        yield return Path.Combine(parent, "yt-dlp.conf");
        if (Path.GetFileName(directory) == ".yt-dlp")
            yield return Path.Combine(parent, "yt-dlp.conf.txt");
        yield return Path.Combine(directory, "config");
        yield return Path.Combine(directory, "config.txt");
    }

    private List<string>? LoadFile(string path)
    {
        path = Path.GetFullPath(path);
        if (!_loaded.Add(path))
            return null;
        Files.Add(path);
        return LoadLayer(Tokenize(File.ReadAllText(path)), Path.GetDirectoryName(path)!);
    }

    private List<string> LoadLayer(IEnumerable<string> arguments, string directory)
    {
        var own = arguments.ToList();
        var includes = new List<string>();
        for (var i = 0; i < own.Count; i++)
        {
            var arg = own[i];
            if (arg == "--no-config-locations")
                includes.Clear();
            else if (arg.StartsWith("--config-locations=", StringComparison.Ordinal))
                includes.Add(arg.Split('=', 2)[1]);
            else if (arg is "--config-locations" or "--config-location")
            {
                if (++i == own.Count)
                    throw new ArgumentException($"Missing value for {arg}.");
                includes.Add(own[i]);
            }
        }
        var children = new List<List<string>>();
        foreach (var include in includes)
        {
            if (include == "-")
            {
                if (_loaded.Add("<stdin>"))
                    children.Add(LoadLayer(Tokenize(Console.In.ReadToEnd()), directory));
                continue;
            }
            var path = Path.GetFullPath(Expand(include, home), directory);
            if (Directory.Exists(path))
                path = Path.Combine(path, "yt-dlp.conf");
            if (!File.Exists(path))
                throw new ArgumentException($"Config location does not exist: {path}");
            if (LoadFile(path) is { } child)
                children.Add(child);
        }
        return children.AsEnumerable().Reverse().SelectMany(x => x).Concat(own).ToList();
    }

    public static string[] Tokenize(string text)
    {
        var words = new List<string>();
        var word = new StringBuilder();
        char quote = '\0';
        var started = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quote == '\0' && c == '#')
            {
                while (i < text.Length && text[i] != '\n')
                    i++;
                if (started)
                {
                    words.Add(word.ToString());
                    word.Clear();
                    started = false;
                }
                continue;
            }
            if (c == '\\' && quote != '\'')
            {
                if (++i == text.Length)
                    throw new ArgumentException("Trailing escape in configuration.");
                c = text[i];
                if (quote == '"' && c is not '"' and not '\\')
                    word.Append('\\');
                word.Append(c);
                started = true;
            }
            else if (quote != '\0')
            {
                if (c == quote)
                    quote = '\0';
                else
                    word.Append(c);
            }
            else if (c is '\'' or '"')
            {
                quote = c;
                started = true;
            }
            else if (char.IsWhiteSpace(c))
            {
                if (started)
                {
                    words.Add(word.ToString());
                    word.Clear();
                    started = false;
                }
            }
            else
            {
                word.Append(c);
                started = true;
            }
        }
        if (quote != '\0')
            throw new ArgumentException("Unclosed quote in configuration.");
        if (started)
            words.Add(word.ToString());
        return words.ToArray();
    }
}
