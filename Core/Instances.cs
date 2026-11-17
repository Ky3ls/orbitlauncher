using System.Text.RegularExpressions;

namespace OrbitLauncher.Core;

public class Instance
{
    public string Id { get; set; } = "";
    /// <summary>Stable id across PCs (cloud sync).</summary>
    public string Uid { get; set; } = "";
    /// <summary>Last change (UTC), used for cloud sync (last write wins).</summary>
    public DateTime Modified { get; set; } = DateTime.UtcNow;
    public string Name { get; set; } = "";
    public string McVersion { get; set; } = "";
    /// <summary>vanilla | fabric | quilt | forge | neoforge</summary>
    public string Loader { get; set; } = "vanilla";
    public string? LoaderVersion { get; set; }
    /// <summary>Version id that is actually launched (e.g. fabric-loader-0.17.3-1.21.11).</summary>
    public string? VersionId { get; set; }
    /// <summary>custom | orbit | modpack</summary>
    public string Kind { get; set; } = "custom";
    public string Icon { get; set; } = "grass";
    /// <summary>Project icon for modpack instances (Modrinth CDN).</summary>
    public string? IconUrl { get; set; }
    /// <summary>Wide gallery image for the instance header.</summary>
    public string? BannerUrl { get; set; }
    public int RamMb { get; set; } = 0;
    public string? JavaPath { get; set; }
    public string? JvmArgs { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string? Group { get; set; }
    /// <summary>Start the game in fullscreen.</summary>
    public bool Fullscreen { get; set; }
    /// <summary>Server joined right after the start (host[:port]).</summary>
    public string? AutoJoin { get; set; }
    /// <summary>Extra environment variables, one KEY=VALUE per line.</summary>
    public string? EnvVars { get; set; }
    /// <summary>Command run (and waited for) before the game starts.</summary>
    public string? PreLaunch { get; set; }
    /// <summary>Command the game is started through (e.g. prime-run, gamemoderun).</summary>
    public string? Wrapper { get; set; }
    /// <summary>Command run after the game closed.</summary>
    public string? PostExit { get; set; }
    /// <summary>keep | minimize | close; null = global setting.</summary>
    public string? OnLaunch { get; set; }
    /// <summary>Free notes of the player.</summary>
    public string? Notes { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
    public DateTime? LastPlayed { get; set; }
    public long PlaySeconds { get; set; }
    public string? ModpackProject { get; set; }
    public string? ModpackVersion { get; set; }
    /// <summary>Content installed through the launcher (Modrinth), used for updates and removal.</summary>
    public List<InstalledContent> Content { get; set; } = new();
    /// <summary>Files of a CurseForge modpack the authors only allow on curseforge.com: "name|url".</summary>
    public List<string>? ManualDownloads { get; set; }
    /// <summary>Content files already checked against the catalog that are not a project ("type|file").</summary>
    public List<string> CatalogMisses { get; set; } = new();
    /// <summary>Version of the content recognition that produced CatalogMisses (2 = with CurseForge fingerprints).</summary>
    public int CatalogV { get; set; }
    /// <summary>True once we looked the instance up in the catalogs by its name (to link it to its modpack).</summary>
    public bool LinkTried { get; set; }
    /// <summary>Folder of the instance in the launcher it was imported from.</summary>
    public string? ImportedFrom { get; set; }
    /// <summary>The player keeps their own RAM value: do not suggest more before launching.</summary>
    public bool RamNoAsk { get; set; }

    public string Dir => Path.Combine(Paths.Instances, Id);
    public string LaunchId => VersionId ?? McVersion;
}

public class InstalledContent
{
    public string ProjectId { get; set; } = "";
    public string VersionId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Type { get; set; } = "mod";   // mod | resourcepack | shader | datapack
    public string File { get; set; } = "";
    public string? Sha1 { get; set; }
    public string? IconUrl { get; set; }
    public string? VersionNumber { get; set; }
    public bool Dependency { get; set; }
    public bool Enabled { get; set; } = true;
    /// <summary>modrinth | curseforge</summary>
    public string Source { get; set; } = "modrinth";
    /// <summary>client | server | both, from the catalog ("" = catalog has no answer).</summary>
    public string? Env { get; set; }
}

public static class Instances
{
    private static readonly object L = new();
    private static string FileOf(string id) => Path.Combine(Paths.Instances, id, "instance.json");

    public static List<Instance> All()
    {
        var r = new List<Instance>();
        foreach (var d in Directory.GetDirectories(Paths.Instances))
        {
            var i = Net.LoadJson<Instance>(Path.Combine(d, "instance.json"));
            if (i == null) continue;
            i.Id = Path.GetFileName(d);
            if (string.IsNullOrEmpty(i.Uid)) { i.Uid = Guid.NewGuid().ToString("N"); lock (L) Net.SaveJson(Path.Combine(d, "instance.json"), i); }
            r.Add(i);
        }
        return r.OrderByDescending(i => i.LastPlayed ?? i.Created).ToList();
    }

    public static Instance? Get(string id) { var i = Net.LoadJson<Instance>(FileOf(id)); if (i != null) i.Id = id; return i; }

    public static void Save(Instance i, bool touch = true)
    {
        if (string.IsNullOrEmpty(i.Uid)) i.Uid = Guid.NewGuid().ToString("N");
        if (touch) i.Modified = DateTime.UtcNow;
        lock (L) Net.SaveJson(FileOf(i.Id), i);
        Changed?.Invoke(i.Id);
    }
    /// <summary>Raised after an instance was saved or deleted (cloud sync hooks in here).</summary>
    public static event Action<string>? Changed;
    public static event Action<string>? Deleted;

    public static Instance Create(string name, string mc, string loader = "vanilla", string? loaderVersion = null, string kind = "custom")
    {
        var slug = Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length == 0) slug = "instanz";
        var id = slug; int n = 2;
        while (Directory.Exists(Path.Combine(Paths.Instances, id))) id = $"{slug}-{n++}";
        var i = new Instance { Id = id, Name = name, McVersion = mc, Loader = loader, LoaderVersion = loaderVersion, Kind = kind };
        foreach (var sub in new[] { "mods", "resourcepacks", "shaderpacks", "saves", "screenshots" }) Directory.CreateDirectory(Path.Combine(i.Dir, sub));
        Save(i);
        return i;
    }

    public static void Delete(string id)
    {
        var d = Path.Combine(Paths.Instances, id);
        var uid = Get(id)?.Uid;
        if (Directory.Exists(d) && Path.GetFullPath(d).StartsWith(Path.GetFullPath(Paths.Instances))) Directory.Delete(d, true);
        if (!string.IsNullOrEmpty(uid)) Deleted?.Invoke(uid);
    }

    public static string ContentDir(Instance i, string type) => Path.Combine(i.Dir, type switch
    {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => "mods",
    });

    /// <summary>Name without a trailing .disabled, so toggled files keep their identity.</summary>
    public static string EnabledName(string file)
    {
        var fn = Path.GetFileName(file);
        return fn.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase) ? fn[..^".disabled".Length] : fn;
    }

    /// <summary>Drops Minecraft color codes (§6, §l, …) from a display string.</summary>
    public static string StripFmt(string s) => Regex.Replace(s, "§.", "").Trim();

    /// <summary>Readable row title: project name when we have one, otherwise the file name without color codes or container extension.</summary>
    public static string DisplayTitle(string? title, string file)
    {
        var stem = StripFmt(Path.GetFileNameWithoutExtension(EnabledName(file)));
        if (stem.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || stem.EndsWith(".jar", StringComparison.OrdinalIgnoreCase))
            stem = StripFmt(Path.GetFileNameWithoutExtension(stem));
        var raw = string.IsNullOrWhiteSpace(title) ? "" : StripFmt(title);
        if (raw.Length == 0) return stem;
        var full = StripFmt(EnabledName(file));
        if (raw.Equals(full, StringComparison.OrdinalIgnoreCase) || raw.Equals(stem, StringComparison.OrdinalIgnoreCase)
            || raw.Equals(full + ".zip", StringComparison.OrdinalIgnoreCase) || raw.Equals(stem + ".zip", StringComparison.OrdinalIgnoreCase)
            || raw.Equals(stem + ".jar", StringComparison.OrdinalIgnoreCase))
            return stem;
        return raw;
    }

    /// <summary>True for a real mod, resource pack or shader. Sidecars (.rpo), notes (.txt) and half-downloads are not content.</summary>
    public static bool IsListedContent(string type, string path)
    {
        var name = Path.GetFileName(path);
        if (name.Length == 0 || name[0] == '.' || name.EndsWith(".part", StringComparison.OrdinalIgnoreCase)) return false;
        var enabled = EnabledName(name);
        if (IsErrorDump(name)) return false;
        if (Directory.Exists(path))
        {
            if (type == "shader") return Directory.Exists(Path.Combine(path, "shaders"));
            if (type == "resourcepack") return File.Exists(Path.Combine(path, "pack.mcmeta"));
            return false;
        }
        if (type == "mod") return enabled.EndsWith(".jar", StringComparison.OrdinalIgnoreCase);
        if (type is "resourcepack" or "shader") return enabled.EndsWith(".zip", StringComparison.OrdinalIgnoreCase);
        return false;
    }

    /// <summary>Shader error dumps and log leftovers a modpack sometimes leaves next to the real files.</summary>
    private static bool IsErrorDump(string name)
    {
        var n = name.Replace(" ", "").Replace("_", "").Replace("-", "");
        return n.Contains("errorlog", StringComparison.OrdinalIgnoreCase)
            || n.Contains("errorlogs", StringComparison.OrdinalIgnoreCase)
            || n.Contains("errorshader", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Files in mods/resourcepacks/shaderpacks including ones the user copied in by hand.</summary>
    public static List<object> ListFiles(Instance i, string type)
    {
        var dir = ContentDir(i, type);
        Directory.CreateDirectory(dir);
        var known = new Dictionary<string, InstalledContent>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in i.Content)
            if (c.Type == type) known.TryAdd(EnabledName(c.File), c);
        var misses = new HashSet<string>(i.CatalogV >= 2 || !CurseForge.Ready ? i.CatalogMisses ?? new() : new(), StringComparer.OrdinalIgnoreCase);
        var r = new List<object>();
        foreach (var f in Directory.EnumerateFileSystemEntries(dir).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            if (!IsListedContent(type, f)) continue;
            var fn = Path.GetFileName(f);
            var on = !fn.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase);
            var baseName = EnabledName(fn);
            known.TryGetValue(baseName, out var c);
            var projectId = string.IsNullOrEmpty(c?.ProjectId) ? null : c!.ProjectId;
            var source = c != null ? (string.IsNullOrEmpty(c.Source) ? null : c.Source) : misses.Contains(type + "|" + baseName) ? "local" : null;
            r.Add(new
            {
                file = baseName, on, size = File.Exists(f) ? new FileInfo(f).Length : -1L, title = DisplayTitle(c?.Title, baseName),
                projectId, version = c?.VersionNumber, icon = c?.IconUrl, dependency = c?.Dependency ?? false, source,
                env = type == "mod" && !string.IsNullOrEmpty(c?.Env) ? c!.Env : null,
            });
        }
        return r;
    }

    public static void Toggle(Instance i, string type, string file, bool on)
    {
        var dir = ContentDir(i, type);
        var a = Path.Combine(dir, file); var b = a + ".disabled";
        if (on && File.Exists(b)) File.Move(b, a, true);
        if (!on && File.Exists(a)) File.Move(a, b, true);
        var c = i.Content.FirstOrDefault(x => x.Type == type && EnabledName(x.File) == file);
        if (c != null) { c.Enabled = on; Save(i); }
    }

    public static void RemoveFile(Instance i, string type, string file)
    {
        var dir = ContentDir(i, type);
        foreach (var f in new[] { Path.Combine(dir, file), Path.Combine(dir, file + ".disabled") })
        {
            if (!Path.GetFullPath(f).StartsWith(Path.GetFullPath(dir))) continue;
            if (File.Exists(f)) File.Delete(f);
            else if (Directory.Exists(f)) Directory.Delete(f, true);
        }
        i.Content.RemoveAll(x => x.Type == type && EnabledName(x.File) == file);
        i.CatalogMisses?.RemoveAll(x => x.Equals(type + "|" + file, StringComparison.OrdinalIgnoreCase));
        Save(i);
    }
}
