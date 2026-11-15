using System.Text.RegularExpressions;

namespace OrbitLauncher.Core;

public class Instance
{
    public string Id { get; set; } = "";
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
    public int RamMb { get; set; } = 0;
    public string? JavaPath { get; set; }
    public string? JvmArgs { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string? Group { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
    public DateTime? LastPlayed { get; set; }
    public long PlaySeconds { get; set; }
    public string? ModpackProject { get; set; }
    public string? ModpackVersion { get; set; }
    /// <summary>Content installed through the launcher (Modrinth), used for updates and removal.</summary>
    public List<InstalledContent> Content { get; set; } = new();
    /// <summary>Files of a CurseForge modpack the authors only allow on curseforge.com: "name|url".</summary>
    public List<string>? ManualDownloads { get; set; }

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
            r.Add(i);
        }
        return r.OrderByDescending(i => i.LastPlayed ?? i.Created).ToList();
    }

    public static Instance? Get(string id) { var i = Net.LoadJson<Instance>(FileOf(id)); if (i != null) i.Id = id; return i; }

    public static void Save(Instance i) { lock (L) Net.SaveJson(FileOf(i.Id), i); }

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
        if (Directory.Exists(d) && Path.GetFullPath(d).StartsWith(Path.GetFullPath(Paths.Instances))) Directory.Delete(d, true);
    }

    public static string ContentDir(Instance i, string type) => Path.Combine(i.Dir, type switch
    {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => "mods",
    });

    /// <summary>Files in mods/resourcepacks/shaderpacks including ones the user copied in by hand.</summary>
    public static List<object> ListFiles(Instance i, string type)
    {
        var dir = ContentDir(i, type);
        Directory.CreateDirectory(dir);
        var known = i.Content.Where(c => c.Type == type).ToDictionary(c => c.File.Replace(".disabled", ""), c => c, StringComparer.OrdinalIgnoreCase);
        var r = new List<object>();
        foreach (var f in Directory.EnumerateFileSystemEntries(dir).OrderBy(x => x))
        {
            var fn = Path.GetFileName(f);
            if (fn.EndsWith(".part") || fn.StartsWith('.')) continue;
            var on = !fn.EndsWith(".disabled");
            var baseName = fn.Replace(".disabled", "");
            known.TryGetValue(baseName, out var c);
            long size = File.Exists(f) ? new FileInfo(f).Length : 0;
            r.Add(new { file = baseName, on, size, title = c?.Title ?? Path.GetFileNameWithoutExtension(baseName), projectId = c?.ProjectId, version = c?.VersionNumber, icon = c?.IconUrl, dependency = c?.Dependency ?? false });
        }
        return r;
    }

    public static void Toggle(Instance i, string type, string file, bool on)
    {
        var dir = ContentDir(i, type);
        var a = Path.Combine(dir, file); var b = a + ".disabled";
        if (on && File.Exists(b)) File.Move(b, a, true);
        if (!on && File.Exists(a)) File.Move(a, b, true);
        var c = i.Content.FirstOrDefault(x => x.Type == type && x.File == file);
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
        i.Content.RemoveAll(x => x.Type == type && x.File == file);
        Save(i);
    }
}
