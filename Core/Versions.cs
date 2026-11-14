using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace OrbitLauncher.Core;

public record McVersion(string Id, string Type, string Url, DateTime Released, string Sha1);

/// <summary>Mojang's official version manifest (piston-meta) and version JSON handling.</summary>
public static class Versions
{
    public const string ManifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    private static List<McVersion>? _all;
    private static DateTime _at;
    public static string? LatestRelease { get; private set; }
    public static string? LatestSnapshot { get; private set; }

    public static async Task<List<McVersion>> All(bool refresh = false, CancellationToken ct = default)
    {
        if (_all != null && !refresh && DateTime.UtcNow - _at < TimeSpan.FromMinutes(30)) return _all;
        var cache = Path.Combine(Paths.Cache, "version_manifest_v2.json");
        JsonNode m;
        try { var t = await Net.Text(ManifestUrl, ct); File.WriteAllText(cache, t); m = JsonNode.Parse(t)!; }
        catch when (File.Exists(cache)) { m = JsonNode.Parse(File.ReadAllText(cache))!; }
        LatestRelease = (string?)m["latest"]?["release"];
        LatestSnapshot = (string?)m["latest"]?["snapshot"];
        _all = m["versions"]!.AsArray().Select(v => new McVersion(
            (string)v!["id"]!, (string)v["type"]!, (string)v["url"]!,
            DateTime.TryParse((string?)v["releaseTime"], out var d) ? d : DateTime.MinValue, (string?)v["sha1"] ?? "")).ToList();
        _at = DateTime.UtcNow;
        return _all;
    }

    public static string JsonPath(string id) => Path.Combine(Paths.Versions, id, id + ".json");
    public static string JarPath(string id) => Path.Combine(Paths.Versions, id, id + ".jar");

    private static async Task<List<McVersion>> SafeAll(CancellationToken ct)
    {
        try { return await All(false, ct); } catch { return new(); }
    }

    /// <summary>Makes sure versions/&lt;id&gt;/&lt;id&gt;.json exists. Vanilla JSONs come from Mojang (SHA-1 checked),
    /// loader profiles (Fabric/Quilt/Forge/NeoForge) were written there by their installers.</summary>
    public static async Task<JsonObject> EnsureJson(string id, CancellationToken ct = default)
    {
        var path = JsonPath(id);
        var mv = (await SafeAll(ct)).FirstOrDefault(v => v.Id == id);
        if (mv != null && !(File.Exists(path) && (string.IsNullOrEmpty(mv.Sha1) || Net.Sha1(path) == mv.Sha1)))
        {
            try { File.Delete(path); } catch { }
            await Net.Download(new DlItem(mv.Url, path, string.IsNullOrEmpty(mv.Sha1) ? null : mv.Sha1), ct);
        }
        if (!File.Exists(path)) throw new InvalidOperationException($"Version {id} ist unbekannt.");
        return JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    }

    /// <summary>Loads a version and merges its inheritsFrom chain (Fabric/Quilt/Forge profiles inherit vanilla).</summary>
    public static async Task<JsonObject> Resolve(string id, CancellationToken ct = default, int depth = 0)
    {
        if (depth > 5) throw new InvalidOperationException("inheritsFrom-Kette zu lang");
        var self = await EnsureJson(id, ct);
        var parentId = (string?)self["inheritsFrom"];
        if (parentId == null) { self["jar"] ??= id; return self; }
        var parent = await Resolve(parentId, ct, depth + 1);
        return Merge(parent, self);
    }

    public static JsonObject Merge(JsonObject parent, JsonObject child)
    {
        var r = (JsonObject)parent.DeepClone();
        foreach (var (k, v) in child)
        {
            if (v == null) continue;
            switch (k)
            {
                case "libraries":
                    // child libraries win; drop parent entries with the same group:artifact(:classifier)
                    var keys = v.AsArray().Select(l => LibKey((string?)l?["name"])).ToHashSet();
                    var merged = new JsonArray();
                    foreach (var l in v.AsArray()) merged.Add(l!.DeepClone());
                    foreach (var l in parent["libraries"]?.AsArray() ?? new JsonArray())
                        if (!keys.Contains(LibKey((string?)l?["name"]))) merged.Add(l!.DeepClone());
                    r["libraries"] = merged;
                    break;
                case "arguments":
                    var pa = (JsonObject?)r["arguments"]?.DeepClone() ?? new JsonObject();
                    foreach (var (ak, av) in v.AsObject())
                    {
                        var arr = pa[ak]?.AsArray() ?? new JsonArray();
                        foreach (var x in av!.AsArray()) arr.Add(x?.DeepClone());
                        pa[ak] = arr;
                    }
                    r["arguments"] = pa;
                    break;
                case "inheritsFrom": break;
                default: r[k] = v.DeepClone(); break;
            }
        }
        r["id"] = child["id"]?.DeepClone();
        r.Remove("inheritsFrom");
        // the client jar always comes from the vanilla base
        r["jar"] = (string?)child["jar"] ?? (string?)parent["jar"] ?? (string?)parent["id"];
        return r;
    }

    private static string LibKey(string? name)
    {
        if (name == null) return Guid.NewGuid().ToString();
        var p = name.Split(':');
        return p.Length >= 4 ? $"{p[0]}:{p[1]}:{p[3]}" : p.Length >= 2 ? $"{p[0]}:{p[1]}" : name;
    }
}

/// <summary>Evaluates Mojang "rules" (os / arch / version / features).</summary>
public static class Rules
{
    public static string Os => OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsMacOS() ? "osx" : "linux";
    public static string Arch => RuntimeInformation.OSArchitecture switch { Architecture.Arm64 => "arm64", Architecture.X86 => "x86", _ => "x64" };
    public static string OsVersion => Environment.OSVersion.Version.ToString();

    public static bool Allowed(JsonNode? rules, IReadOnlyDictionary<string, bool>? features = null)
    {
        if (rules is not JsonArray arr || arr.Count == 0) return true;
        bool allowed = false;
        foreach (var r in arr)
        {
            if (r == null) continue;
            if (!Matches(r, features)) continue;
            allowed = (string?)r["action"] == "allow";
        }
        return allowed;
    }

    private static bool Matches(JsonNode r, IReadOnlyDictionary<string, bool>? features)
    {
        if (r["os"] is JsonObject os)
        {
            if (os["name"] is JsonNode n && (string?)n != Os) return false;
            if (os["arch"] is JsonNode a)
            {
                var want = (string?)a;
                if (want == "x86" && Arch != "x86") return false;
                if (want == "arm64" && Arch != "arm64") return false;
                if (want == "x64" && Arch != "x64") return false;
            }
            if (os["version"] is JsonNode v)
                try { if (!Regex.IsMatch(OsVersion, (string?)v ?? "")) return false; } catch { }
            if (os["versionRange"] is JsonObject vr && Version.TryParse(OsVersion, out var cur))
            {
                if (Version.TryParse((string?)vr["min"], out var min) && cur < min) return false;
                if (Version.TryParse((string?)vr["max"], out var max) && cur >= max) return false;
            }
        }
        if (r["features"] is JsonObject f)
        {
            foreach (var (k, v) in f)
            {
                var have = features != null && features.TryGetValue(k, out var b) && b;
                if (have != (v?.GetValue<bool>() ?? false)) return false;
            }
        }
        return true;
    }
}
