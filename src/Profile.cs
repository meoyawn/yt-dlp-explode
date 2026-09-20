using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.Tracing;
using System.IO;
using System.Text.Json;

internal static class Profile
{
    private static readonly string? Output = Environment.GetEnvironmentVariable(
        "YT_DLP_EXPLODE_PROFILE"
    );
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly List<(
        string Name,
        double StartMs,
        double DurationMs,
        long? Bytes
    )> Events = [];
    private static readonly EventListener? Listener = !string.IsNullOrEmpty(Output)
        ? new NetworkListener()
        : null;
    public static bool Enabled => !string.IsNullOrEmpty(Output);
    public static double Now => Clock.Elapsed.TotalMilliseconds;

    public static void Add(string name, double start, long? bytes = null)
    {
        if (Enabled)
            lock (Events)
                Events.Add((name, start, Now - start, bytes));
    }

    public static void Save()
    {
        if (!Enabled)
            return;
        using var file = File.Create(Output!);
        using var json = new Utf8JsonWriter(file);
        json.WriteStartObject();
        json.WriteNumber("process_ms", Now);
        json.WriteStartArray("events");
        (string Name, double StartMs, double DurationMs, long? Bytes)[] events;
        lock (Events)
            events = Events.ToArray();
        foreach (var item in events)
        {
            json.WriteStartObject();
            json.WriteString("name", item.Name);
            json.WriteNumber("start_ms", item.StartMs);
            json.WriteNumber("duration_ms", item.DurationMs);
            if (item.Bytes is { } bytes)
                json.WriteNumber("bytes", bytes);
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteEndObject();
    }

    private sealed class NetworkListener : EventListener
    {
        protected override void OnEventSourceCreated(EventSource source)
        {
            if (
                source.Name
                is "System.Net.NameResolution"
                    or "System.Net.Sockets"
                    or "System.Net.Security"
            )
                EnableEvents(source, EventLevel.Informational);
        }

        protected override void OnEventWritten(EventWrittenEventArgs data)
        {
            lock (Events)
                Events.Add((data.EventSource.Name + "." + data.EventName, Now, 0, null));
        }
    }
}
