namespace OrbitLauncher.Core;

/// <summary>
/// The player's own Minecraft settings and key bindings (options.txt lines) as a template.
/// Instances that take part get it merged into their options.txt before every start;
/// changes made in the game flow back into the template after the game ends.
/// </summary>
public static class McOptions
{
    /// <summary>Things that belong to one instance or are only bookkeeping of the game.</summary>
    private static readonly HashSet<string> Never = new(StringComparer.Ordinal)
    {
        "version", "resourcePacks", "incompatibleResourcePacks", "lastServer", "tutorialStep", "joinedFirstServer",
        "skipMultiplayerWarning", "skipRealms32bitWarning", "onboardAccessibility", "hideBundleTutorial", "syncChunkWrites",
        "hasShownBundleTutorial", "realmsNotifications",
    };

    public static bool IsKey(string k) => k.StartsWith("key_", StringComparison.Ordinal);

    /// <summary>scope: all | settings | keys</summary>
    public static bool InScope(string k, string scope) => !Never.Contains(k) && scope switch
    {
        "keys" => IsKey(k),
        "settings" => !IsKey(k),
        _ => true,
    };

    public static Dictionary<string, string> Parse(string? text)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in (text ?? "").Split('\n'))
        {
            var l = raw.TrimEnd('\r'); var i = l.IndexOf(':');
            if (i <= 0) continue;
            d[l[..i]] = l[(i + 1)..];
        }
        return d;
    }
    public static string Write(Dictionary<string, string> d) => string.Join("\n", d.Select(x => x.Key + ":" + x.Value)) + (d.Count > 0 ? "\n" : "");

    /// <summary>Minecraft 1.13 and newer (named keys instead of numbers). Old versions are left alone.</summary>
    public static bool Modern(Instance i)
    {
        var v = i.McVersion ?? "";
        if (System.Text.RegularExpressions.Regex.IsMatch(v, @"^\d\dw\d\d")) return true;                  // snapshots like 24w14a
        var m = System.Text.RegularExpressions.Regex.Match(v, @"^1\.(\d+)");
        if (m.Success) return int.Parse(m.Groups[1].Value) >= 13;
        return System.Text.RegularExpressions.Regex.IsMatch(v, @"^\d{2,}\.");                               // 26.x and later
    }

    private static string FileOf(Instance i) => Path.Combine(i.Dir, "options.txt");

    /// <summary>Writes the template into the instance's options.txt; other lines stay as they are.</summary>
    public static bool ApplyTo(Instance i, string? template, string scope)
    {
        if (!Modern(i)) return false;
        var t = Parse(template); if (t.Count == 0) return false;
        var f = FileOf(i);
        var lines = File.Exists(f) ? File.ReadAllLines(f).ToList() : new List<string>();
        var have = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var n = 0; n < lines.Count; n++) { var c = lines[n].IndexOf(':'); if (c > 0) have[lines[n][..c]] = n; }
        var changed = false;
        foreach (var (k, v) in t)
        {
            if (!InScope(k, scope)) continue;
            if (have.TryGetValue(k, out var n)) { if (lines[n] != k + ":" + v) { lines[n] = k + ":" + v; changed = true; } }
            else { lines.Add(k + ":" + v); changed = true; }
        }
        if (!changed) return false;
        Directory.CreateDirectory(i.Dir);
        File.WriteAllLines(f, lines);
        return true;
    }

    /// <summary>Takes the values the player changed in the game back into the template. Returns the new template or null.</summary>
    public static string? Learn(Instance i, string? template, string scope)
    {
        if (!Modern(i) || !File.Exists(FileOf(i))) return null;
        var t = Parse(template); var now = Parse(File.ReadAllText(FileOf(i)));
        var changed = false;
        foreach (var k in t.Keys.Where(Never.Contains).ToList()) { t.Remove(k); changed = true; }
        foreach (var (k, v) in now)
        {
            if (!InScope(k, scope)) continue;
            if (!t.TryGetValue(k, out var old) || old != v) { t[k] = v; changed = true; }
        }
        return changed ? Write(t) : null;
    }

    /// <summary>Everything in scope from an instance's options.txt, to start the template from.</summary>
    public static string? From(Instance i)
    {
        if (!File.Exists(FileOf(i))) return null;
        var d = Parse(File.ReadAllText(FileOf(i)));
        foreach (var k in d.Keys.Where(k => Never.Contains(k)).ToList()) d.Remove(k);
        return d.Count == 0 ? null : Write(d);
    }
}
