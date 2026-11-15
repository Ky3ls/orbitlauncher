using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>Public Modrinth API (labrinth v2): search, versions, one-click install with dependencies, updates and .mrpack modpacks.</summary>
public static class Modrinth
{
    public const string Api = "https://api.modrinth.com/v2";

    public static string ProjectType(string type) => type switch { "shader" => "shader", "resourcepack" => "resourcepack", "modpack" => "modpack", "datapack" => "datapack", _ => "mod" };

    /// <summary>Loader tags a version must have to fit an instance.</summary>
    public static string[] LoadersFor(string type, string instLoader) => type switch
    {
        "resourcepack" => new[] { "minecraft" },
        "shader" => new[] { "iris", "optifine", "canvas", "vanilla" },
        "datapack" => new[] { "datapack" },
        _ => instLoader switch
        {
            "quilt" => new[] { "quilt", "fabric" },
            "neoforge" => new[] { "neoforge" },
            "forge" => new[] { "forge" },
            "fabric" => new[] { "fabric" },
            _ => Array.Empty<string>(),
        },
    };

    public static async Task<JsonNode> Search(string? query, string type, string? mc, string? loader, IEnumerable<string>? cats, string sort, int offset, int limit, CancellationToken ct = default)
    {
        var facets = new List<string[]> { new[] { "project_type:" + ProjectType(type) } };
        if (!string.IsNullOrEmpty(mc)) facets.Add(new[] { "versions:" + mc });
        if (!string.IsNullOrEmpty(loader) && loader != "vanilla" && type is "mod" or "modpack")
            facets.Add(loader == "quilt" && type == "mod" ? new[] { "categories:quilt", "categories:fabric" } : new[] { "categories:" + loader });
        foreach (var c in cats ?? Enumerable.Empty<string>()) facets.Add(new[] { "categories:" + c });
        var url = $"{Api}/search?limit={Math.Clamp(limit, 1, 100)}&offset={Math.Max(0, offset)}&index={(sort is "relevance" or "downloads" or "follows" or "newest" or "updated" ? sort : "relevance")}" +
                  $"&facets={Uri.EscapeDataString(JsonSerializer.Serialize(facets))}";
        if (!string.IsNullOrWhiteSpace(query)) url += "&query=" + Uri.EscapeDataString(query.Trim());
        return await Net.Json(url, ct);
    }

    public static Task<JsonNode> Project(string idOrSlug, CancellationToken ct = default) => Net.Json($"{Api}/project/{Uri.EscapeDataString(idOrSlug)}", ct);

    public static async Task<JsonArray> ProjectVersions(string idOrSlug, string[]? loaders, string? mc, CancellationToken ct = default)
    {
        var url = $"{Api}/project/{Uri.EscapeDataString(idOrSlug)}/version?include_changelog=false";
        if (loaders is { Length: > 0 }) url += "&loaders=" + Uri.EscapeDataString(JsonSerializer.Serialize(loaders));
        if (!string.IsNullOrEmpty(mc)) url += "&game_versions=" + Uri.EscapeDataString(JsonSerializer.Serialize(new[] { mc }));
        return (await Net.Json(url, ct)).AsArray();
    }

    public static Task<JsonNode> Version(string id, CancellationToken ct = default) => Net.Json($"{Api}/version/{id}", ct);

    public static Task<JsonNode> Categories(CancellationToken ct = default) => Net.Json($"{Api}/tag/category", ct);

    /// <summary>Newest fitting version, releases before betas/alphas.</summary>
    public static JsonNode? Best(JsonArray versions)
    {
        int Rank(JsonNode v) => (string?)v["version_type"] switch { "release" => 0, "beta" => 1, _ => 2 };
        return versions.Where(v => v != null).OrderBy(v => Rank(v!)).ThenByDescending(v => (string?)v!["date_published"]).FirstOrDefault();
    }

    private static string[] Filter(string type, Instance inst) => LoadersFor(type, inst.Loader);

    public record InstallResult(List<string> Installed, List<string> Skipped);

    /// <summary>Installs a project (or exact version) into an instance, including required dependencies.</summary>
    public static async Task<InstallResult> Install(Instance inst, string project, string type, string? versionId, IProgress<Progress>? p, CancellationToken ct = default)
    {
        if (type == "modpack") throw new InvalidOperationException("Modpacks werden als neue Instanz installiert.");
        if (type == "mod" && inst.Loader == "vanilla") throw new InvalidOperationException("Für Mods braucht die Instanz einen Mod-Loader (Fabric, Quilt, Forge oder NeoForge).");
        var res = new InstallResult(new(), new());
        var visiting = new HashSet<string>();
        await InstallOne(inst, project, type, versionId, false, res, visiting, p, ct);
        Instances.Save(inst);
        return res;
    }

    private static async Task InstallOne(Instance inst, string project, string type, string? versionId, bool dep, InstallResult res, HashSet<string> visiting, IProgress<Progress>? p, CancellationToken ct)
    {
        JsonNode? ver;
        if (versionId != null) ver = await Version(versionId, ct);
        else ver = Best(await ProjectVersions(project, Filter(type, inst), inst.McVersion, ct));
        if (ver == null)
        {
            string title = project;
            try { title = (string?)(await Project(project, ct))["title"] ?? project; } catch { }
            if (dep) { res.Skipped.Add(title); return; }
            throw new InvalidOperationException($"„{title}“ gibt es nicht für {inst.McVersion} / {Loaders.Name(inst.Loader)}.");
        }
        var pid = (string)ver["project_id"]!;
        if (!visiting.Add(pid)) return;
        var existing = inst.Content.FirstOrDefault(c => c.ProjectId == pid);
        if (existing != null && dep) return;          // dependency already there
        if (existing != null && existing.VersionId == (string)ver["id"]! && File.Exists(Path.Combine(Instances.ContentDir(inst, existing.Type), existing.File))) { res.Installed.Add(existing.Title); return; }

        var proj = await Project(pid, ct);
        var ptype = (string?)proj["project_type"] ?? type;
        var ctype = ptype == "mod" ? "mod" : ptype == "shader" ? "shader" : ptype == "resourcepack" ? "resourcepack" : type;
        var title2 = (string?)proj["title"] ?? pid;
        p?.Report(new Progress("Installiere " + title2, 0, 1, (string?)ver["version_number"]));

        var files = ver["files"]!.AsArray();
        var file = files.FirstOrDefault(f => (bool?)f!["primary"] == true) ?? files.FirstOrDefault() ?? throw new InvalidOperationException("Version ohne Datei");
        var fname = Path.GetFileName((string)file!["filename"]!);
        var dir = Instances.ContentDir(inst, ctype);
        await Net.Download(new DlItem((string)file["url"]!, Path.Combine(dir, fname), (string?)file["hashes"]?["sha1"], (long?)file["size"] ?? 0), ct);

        // replace an older file of the same project
        if (existing != null && existing.File != fname)
            foreach (var old in new[] { Path.Combine(Instances.ContentDir(inst, existing.Type), existing.File), Path.Combine(Instances.ContentDir(inst, existing.Type), existing.File + ".disabled") })
                if (File.Exists(old)) File.Delete(old);
        inst.Content.RemoveAll(c => c.ProjectId == pid);
        inst.Content.Add(new InstalledContent
        {
            ProjectId = pid, VersionId = (string)ver["id"]!, Title = title2, Type = ctype, File = fname,
            Sha1 = (string?)file["hashes"]?["sha1"], IconUrl = (string?)proj["icon_url"], VersionNumber = (string?)ver["version_number"],
            Dependency = dep && existing == null,
        });
        res.Installed.Add(title2);

        foreach (var d in ver["dependencies"]?.AsArray() ?? new JsonArray())
        {
            if ((string?)d?["dependency_type"] != "required") continue;
            var dv = (string?)d["version_id"]; var dp = (string?)d["project_id"];
            if (dp == null && dv != null) dp = (string?)(await Version(dv, ct))["project_id"];
            if (dp == null || inst.Content.Any(c => c.ProjectId == dp)) continue;
            // pinned versions of dependencies are often for another loader/version; only use them when they fit
            await InstallOne(inst, dp, "mod", null, true, res, visiting, p, ct);
        }
    }

    public record UpdateInfo(string ProjectId, string Title, string From, string To, string VersionId);

    public static async Task<List<UpdateInfo>> CheckUpdates(Instance inst, CancellationToken ct = default)
    {
        var r = new List<UpdateInfo>();
        foreach (var group in inst.Content.Where(c => c.Sha1 != null && c.Source != "curseforge").GroupBy(c => c.Type))
        {
            var body = new JsonObject
            {
                ["hashes"] = new JsonArray(group.Select(c => (JsonNode)c.Sha1!).ToArray()),
                ["algorithm"] = "sha1",
                ["loaders"] = new JsonArray(LoadersFor(group.Key, inst.Loader).Select(x => (JsonNode)x).ToArray()),
                ["game_versions"] = new JsonArray(inst.McVersion),
            };
            var res = await Net.Post($"{Api}/version_files/update", body.ToJsonString(), null, ct);
            foreach (var c in group)
            {
                var v = res[c.Sha1!];
                if (v == null || (string?)v["id"] == c.VersionId) continue;
                r.Add(new UpdateInfo(c.ProjectId, c.Title, c.VersionNumber ?? "?", (string?)v["version_number"] ?? "?", (string)v["id"]!));
            }
        }
        return r;
    }

    public static async Task<int> UpdateAll(Instance inst, IProgress<Progress>? p, CancellationToken ct = default)
    {
        var ups = await CheckUpdates(inst, ct);
        ups.AddRange(await CurseForge.CheckUpdates(inst, ct));
        foreach (var u in ups)
        {
            var c = inst.Content.First(x => x.ProjectId == u.ProjectId);
            if (c.Source == "curseforge") await CurseForge.Install(inst, int.Parse(u.ProjectId[3..]), int.Parse(u.VersionId), p, ct);
            else await Install(inst, u.ProjectId, c.Type, u.VersionId, p, ct);
        }
        return ups.Count;
    }

    // ===================================================================== MRPACK

    public record PackInfo(string Name, string Mc, string Loader, string? LoaderVersion, int Files);

    /// <summary>Reads modrinth.index.json of an .mrpack.</summary>
    public static PackInfo ReadPack(string mrpack)
    {
        using var z = ZipFile.OpenRead(mrpack);
        var idx = ReadIndex(z);
        var deps = idx["dependencies"]!.AsObject();
        var mc = (string?)deps["minecraft"] ?? throw new InvalidOperationException("Modpack ohne Minecraft-Version");
        var (loader, lv) = deps.ContainsKey("fabric-loader") ? ("fabric", (string?)deps["fabric-loader"])
            : deps.ContainsKey("quilt-loader") ? ("quilt", (string?)deps["quilt-loader"])
            : deps.ContainsKey("neoforge") ? ("neoforge", (string?)deps["neoforge"])
            : deps.ContainsKey("forge") ? ("forge", (string?)deps["forge"])
            : ("vanilla", null);
        if (loader == "forge" && lv != null && !lv.StartsWith(mc + "-")) lv = mc + "-" + lv;
        return new PackInfo((string?)idx["name"] ?? Path.GetFileNameWithoutExtension(mrpack), mc, loader, lv, idx["files"]?.AsArray().Count ?? 0);
    }

    private static JsonNode ReadIndex(ZipArchive z)
    {
        var e = z.GetEntry("modrinth.index.json") ?? throw new InvalidOperationException("Keine gültige .mrpack-Datei");
        using var s = new StreamReader(e.Open());
        return JsonNode.Parse(s.ReadToEnd())!;
    }

    /// <summary>Creates a new instance from an .mrpack: downloads all files (hash checked) and copies overrides.</summary>
    public static async Task<Instance> ImportPack(string mrpack, string? name, IProgress<Progress>? p, CancellationToken ct = default, string? projectId = null, string? versionId = null)
    {
        var info = ReadPack(mrpack);
        var inst = Instances.Create(name ?? info.Name, info.Mc, info.Loader, info.LoaderVersion, "modpack");
        inst.ModpackProject = projectId; inst.ModpackVersion = versionId; inst.Icon = "box";
        var root = Path.GetFullPath(inst.Dir);
        using (var z = ZipFile.OpenRead(mrpack))
        {
            var idx = ReadIndex(z);
            var items = new List<DlItem>();
            foreach (var f in idx["files"]?.AsArray() ?? new JsonArray())
            {
                if ((string?)f!["env"]?["client"] == "unsupported") continue;
                var rel = (string)f["path"]!;
                var dst = Path.GetFullPath(Path.Combine(root, rel));
                if (!dst.StartsWith(root + Path.DirectorySeparatorChar)) continue; // no path traversal
                var url = f["downloads"]!.AsArray().Select(x => (string?)x).FirstOrDefault(u => u != null && u.StartsWith("https://"));
                if (url == null) continue;
                items.Add(new DlItem(url, dst, (string?)f["hashes"]?["sha1"], (long?)f["fileSize"] ?? 0));
            }
            await Net.DownloadAll(items, "Modpack-Dateien", p, ct, 8);
            foreach (var e in z.Entries)
            {
                string? rel = e.FullName.StartsWith("overrides/") ? e.FullName[10..] : e.FullName.StartsWith("client-overrides/") ? e.FullName[17..] : null;
                if (string.IsNullOrEmpty(rel) || rel.EndsWith('/')) continue;
                var dst = Path.GetFullPath(Path.Combine(root, rel));
                if (!dst.StartsWith(root + Path.DirectorySeparatorChar)) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
                e.ExtractToFile(dst, true);
            }
        }
        Instances.Save(inst);
        return inst;
    }

    /// <summary>Modpack straight from Modrinth: picks the best version, downloads the .mrpack and imports it.</summary>
    public static async Task<Instance> InstallModpack(string project, string? versionId, IProgress<Progress>? p, CancellationToken ct = default)
    {
        var ver = versionId != null ? await Version(versionId, ct) : Best(await ProjectVersions(project, null, null, ct)) ?? throw new InvalidOperationException("Keine Modpack-Version gefunden");
        var proj = await Project((string)ver["project_id"]!, ct);
        var file = ver["files"]!.AsArray().FirstOrDefault(f => ((string?)f!["filename"])?.EndsWith(".mrpack") == true) ?? throw new InvalidOperationException("Keine .mrpack-Datei");
        var tmp = Path.Combine(Paths.Cache, (string)file!["filename"]!);
        p?.Report(new Progress("Modpack wird geladen", 0, 1, (string?)proj["title"]));
        await Net.Download(new DlItem((string)file["url"]!, tmp, (string?)file["hashes"]?["sha1"], (long?)file["size"] ?? 0), ct);
        var inst = await ImportPack(tmp, (string?)proj["title"], p, ct, (string)ver["project_id"]!, (string)ver["id"]!);
        inst.IconUrl = (string?)proj["icon_url"]; Instances.Save(inst);
        try { File.Delete(tmp); } catch { }
        return inst;
    }
}
