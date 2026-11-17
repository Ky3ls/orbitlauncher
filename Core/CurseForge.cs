using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>
/// CurseForge through the official CurseForge Core API (api.curseforge.com, needs an API key from console.curseforge.com).
/// Mods whose authors disabled third-party downloads (no downloadUrl) are never fetched – the user gets the website link instead.
/// </summary>
public static class CurseForge
{
    public const string Api = "https://api.curseforge.com/v1";
    public const int Game = 432;
    public const int ClassMods = 6, ClassModpacks = 4471, ClassResourcepacks = 12, ClassShaders = 6552;

    /// <summary>Key built into the exe (-p:CurseForgeKey=…) or set in settings.</summary>
    public static string Key { get; set; } = "";
    public static string BuiltInKey =>
        System.Reflection.Assembly.GetEntryAssembly()?.GetCustomAttributes(typeof(System.Reflection.AssemblyMetadataAttribute), false)
            .OfType<System.Reflection.AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "CatalogKey")?.Value ?? "";
    public static bool Ready => !string.IsNullOrWhiteSpace(Key);

    public static int ClassOf(string type) => type switch { "modpack" => ClassModpacks, "resourcepack" => ClassResourcepacks, "shader" => ClassShaders, _ => ClassMods };
    public static string TypeOf(int cls) => cls switch { ClassModpacks => "modpack", ClassResourcepacks => "resourcepack", ClassShaders => "shader", _ => "mod" };
    /// <summary>CurseForge modLoaderType: 1 Forge, 4 Fabric, 5 Quilt, 6 NeoForge.</summary>
    public static int LoaderType(string loader) => loader switch { "forge" => 1, "fabric" => 4, "quilt" => 5, "neoforge" => 6, _ => 0 };

    private static async Task<JsonNode> Send(HttpMethod m, string path, JsonNode? body, CancellationToken ct)
    {
        if (!Ready) throw new InvalidOperationException("NO_CF_KEY");
        using var req = new HttpRequestMessage(m, Api + path);
        req.Headers.TryAddWithoutValidation("x-api-key", Key);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body != null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var r = await Net.Http.SendAsync(req, ct);
        var txt = await r.Content.ReadAsStringAsync(ct);
        if ((int)r.StatusCode == 403) throw new InvalidOperationException(path.StartsWith("/mods/search") ? "Die Suche im erweiterten Katalog ist für diesen Schlüssel noch nicht freigeschaltet." : "Der erweiterte Katalog hat den API-Schlüssel abgelehnt.");
        if (!r.IsSuccessStatusCode) throw new HttpRequestException($"Katalog-Fehler {(int)r.StatusCode}");
        return JsonNode.Parse(txt)!;
    }
    public static Task<JsonNode> Get(string path, CancellationToken ct = default) => Send(HttpMethod.Get, path, null, ct);
    public static Task<JsonNode> Post(string path, JsonNode body, CancellationToken ct = default) => Send(HttpMethod.Post, path, body, ct);

    public static async Task<JsonNode> Mod(int id, CancellationToken ct = default) => (await Get($"/mods/{id}", ct))["data"]!;

    /// <summary>Newest fitting file: release before beta before alpha, newest first.</summary>
    public static async Task<JsonNode?> BestFile(int modId, string? mc, string? loader, CancellationToken ct = default)
    {
        var q = $"/mods/{modId}/files?pageSize=50" + (mc != null ? "&gameVersion=" + Uri.EscapeDataString(mc) : "");
        var lt = loader != null ? LoaderType(loader) : 0;
        if (lt != 0) q += "&modLoaderType=" + lt;
        var files = (await Get(q, ct))["data"]!.AsArray();
        if (files.Count == 0 && loader == "quilt") return await BestFile(modId, mc, "fabric", ct);
        return files.Where(f => f != null && (bool?)f["isServerPack"] != true)
            .OrderBy(f => (int?)f!["releaseType"] ?? 3).ThenByDescending(f => (string?)f!["fileDate"]).FirstOrDefault();
    }

    private static string? Sha1(JsonNode f) => (string?)f["hashes"]?.AsArray().FirstOrDefault(h => (int?)h!["algo"] == 1)?["value"];

    /// <summary>Installs a CurseForge project into an instance including required dependencies (relationType 3).</summary>
    public static async Task<Modrinth.InstallResult> Install(Instance inst, int modId, int? fileId, IProgress<Progress>? p, CancellationToken ct = default)
    {
        var res = new Modrinth.InstallResult(new(), new());
        await InstallOne(inst, modId, fileId, false, res, new HashSet<int>(), p, ct);
        Instances.Save(inst);
        return res;
    }

    private static async Task InstallOne(Instance inst, int modId, int? fileId, bool dep, Modrinth.InstallResult res, HashSet<int> seen, IProgress<Progress>? p, CancellationToken ct)
    {
        if (!seen.Add(modId)) return;
        var mod = await Mod(modId, ct);
        var title = (string?)mod["name"] ?? modId.ToString();
        var type = TypeOf((int?)mod["classId"] ?? ClassMods);
        if (type == "modpack") throw new InvalidOperationException("Modpacks werden als neue Instanz installiert.");
        if (type == "mod" && inst.Loader == "vanilla") throw new InvalidOperationException("Für Mods braucht die Instanz einen Mod-Loader.");
        var pid = "cf:" + modId;
        var existing = inst.Content.FirstOrDefault(c => c.ProjectId == pid);
        if (existing != null && dep) return;
        JsonNode? file = fileId != null ? (await Get($"/mods/{modId}/files/{fileId}", ct))["data"] : await BestFile(modId, inst.McVersion, type == "mod" ? inst.Loader : null, ct);
        if (file == null)
        {
            if (dep) { res.Skipped.Add(title); return; }
            throw new InvalidOperationException($"„{title}“ gibt es im Katalog nicht für {inst.McVersion} / {Loaders.Name(inst.Loader)}.");
        }
        var url = (string?)file["downloadUrl"];
        if (string.IsNullOrEmpty(url))
        {
            // the author does not allow third-party downloads from CurseForge – respect that,
            // but take the same project from Modrinth when the author publishes it there too
            try
            {
                if (await OnModrinth(mod, type, ct) is string mr)
                {
                    var r2 = await Modrinth.Install(inst, mr, type, null, p, ct);
                    res.Installed.AddRange(r2.Installed); res.Skipped.AddRange(r2.Skipped);
                    return;
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { }
            res.Skipped.Add(title + " (nur direkt auf curseforge.com)");
            return;
        }
        p?.Report(new Progress("Installiere " + title, 0, 1, (string?)file["displayName"]));
        var fname = Path.GetFileName((string)file["fileName"]!);
        var dir = Instances.ContentDir(inst, type);
        await Net.Download(new DlItem(url, Path.Combine(dir, fname), Sha1(file), (long?)file["fileLength"] ?? 0), ct);
        if (existing != null && existing.File != fname)
            foreach (var old in new[] { Path.Combine(dir, existing.File), Path.Combine(dir, existing.File + ".disabled") }) if (File.Exists(old)) File.Delete(old);
        inst.Content.RemoveAll(c => c.ProjectId == pid);
        inst.Content.Add(new InstalledContent
        {
            ProjectId = pid, VersionId = ((int)file["id"]!).ToString(), Title = title, Type = type, File = fname, Sha1 = Sha1(file),
            IconUrl = (string?)mod["logo"]?["thumbnailUrl"], VersionNumber = (string?)file["displayName"], Dependency = dep && existing == null, Source = "curseforge",
        });
        res.Installed.Add(title);
        foreach (var d in file["dependencies"]?.AsArray() ?? new JsonArray())
            if ((int?)d?["relationType"] == 3 && (int?)d["modId"] is int dm && !inst.Content.Any(c => c.ProjectId == "cf:" + dm))
                await InstallOne(inst, dm, null, true, res, seen, p, ct);
    }

    public static async Task<List<Modrinth.VersionChoice>> Versions(Instance inst, InstalledContent c, CancellationToken ct = default)
    {
        var id = int.Parse(c.ProjectId[3..]);
        var q = $"/mods/{id}/files?pageSize=40&gameVersion=" + Uri.EscapeDataString(inst.McVersion);
        var lt = c.Type == "mod" ? LoaderType(inst.Loader) : 0;
        if (lt != 0) q += "&modLoaderType=" + lt;
        var files = (await Get(q, ct))["data"]!.AsArray();
        return files.Where(f => f != null && (bool?)f["isServerPack"] != true && !string.IsNullOrEmpty((string?)f["downloadUrl"]))
            .Select(f => new Modrinth.VersionChoice(
                ((int)f!["id"]!).ToString(),
                (string?)f["displayName"] ?? "",
                (string?)f["fileName"] ?? "",
                (int?)f["releaseType"] switch { 2 => "beta", 3 => "alpha", _ => "release" },
                (string?)f["fileDate"],
                ((int)f["id"]!).ToString() == c.VersionId)).ToList();
    }

    public static async Task<List<Modrinth.UpdateInfo>> CheckUpdates(Instance inst, CancellationToken ct = default)
    {
        var r = new List<Modrinth.UpdateInfo>();
        if (!Ready) return r;
        foreach (var c in inst.Content.Where(c => c.Source == "curseforge"))
        {
            try
            {
                var f = await BestFile(int.Parse(c.ProjectId[3..]), inst.McVersion, c.Type == "mod" ? inst.Loader : null, ct);
                if (f != null && ((int)f["id"]!).ToString() != c.VersionId && !string.IsNullOrEmpty((string?)f["downloadUrl"]))
                    r.Add(new Modrinth.UpdateInfo(c.ProjectId, c.Title, c.VersionNumber ?? "?", (string?)f["displayName"] ?? "?", ((int)f["id"]!).ToString()));
            }
            catch (Exception e) when (e is not OperationCanceledException) { }
        }
        return r;
    }

    /// <summary>CurseForge file fingerprint: MurmurHash2 (seed 1) over the file without the bytes 9, 10, 13 and 32.</summary>
    public static uint Fingerprint(string path)
    {
        var raw = File.ReadAllBytes(path);
        var buf = new byte[raw.Length]; int n = 0;
        foreach (var b in raw) if (b is not (9 or 10 or 13 or 32)) buf[n++] = b;
        const uint m = 0x5bd1e995; const int r = 24;
        uint h = 1 ^ (uint)n; int i = 0;
        while (n - i >= 4)
        {
            uint k = (uint)(buf[i] | buf[i + 1] << 8 | buf[i + 2] << 16 | buf[i + 3] << 24);
            k *= m; k ^= k >> r; k *= m; h *= m; h ^= k; i += 4;
        }
        switch (n - i)
        {
            case 3: h ^= (uint)buf[i + 2] << 16; goto case 2;
            case 2: h ^= (uint)buf[i + 1] << 8; goto case 1;
            case 1: h ^= buf[i]; h *= m; break;
        }
        h ^= h >> 13; h *= m; h ^= h >> 15;
        return h;
    }

    /// <summary>Exact fingerprint matches: fingerprint → (mod id, file).</summary>
    public static async Task<Dictionary<uint, (int mod, JsonNode file)>> Match(IEnumerable<uint> fingerprints, CancellationToken ct = default)
    {
        var r = new Dictionary<uint, (int, JsonNode)>();
        foreach (var chunk in fingerprints.Distinct().Chunk(400))
        {
            var res = await Post($"/fingerprints/{Game}", new JsonObject { ["fingerprints"] = new JsonArray(chunk.Select(f => (JsonNode)f).ToArray()) }, ct);
            foreach (var mt in res["data"]?["exactMatches"]?.AsArray() ?? new JsonArray())
            {
                var file = mt?["file"]; if (file == null) continue;
                var fp = (uint?)(long?)file["fileFingerprint"]; if (fp == null) continue;
                r[fp.Value] = ((int)mt!["id"]!, file);
            }
        }
        return r;
    }

    /// <summary>Several projects at once (name, logo, class).</summary>
    public static async Task<Dictionary<int, JsonNode>> Mods(IEnumerable<int> ids, CancellationToken ct = default)
    {
        var r = new Dictionary<int, JsonNode>();
        foreach (var chunk in ids.Distinct().Chunk(200))
        {
            var res = await Post("/mods", new JsonObject { ["modIds"] = new JsonArray(chunk.Select(i => (JsonNode)i).ToArray()) }, ct);
            foreach (var m in res["data"]?.AsArray() ?? new JsonArray()) if (m != null) r[(int)m["id"]!] = m;
        }
        return r;
    }

    // ===================================================================== MODPACKS (CurseForge zip with manifest.json)

    public static bool IsCfPack(string zip)
    {
        try { using var z = ZipFile.OpenRead(zip); return z.GetEntry("manifest.json") != null; } catch { return false; }
    }

    public static async Task<Instance> ImportPack(string zip, string? name, IProgress<Progress>? p, CancellationToken ct = default, int? projectId = null, string? iconUrl = null)
    {
        using var z = ZipFile.OpenRead(zip);
        JsonNode man;
        using (var s = new StreamReader((z.GetEntry("manifest.json") ?? throw new InvalidOperationException("Kein gültiges Modpack")).Open())) man = JsonNode.Parse(s.ReadToEnd())!;
        var mc = (string?)man["minecraft"]?["version"] ?? throw new InvalidOperationException("Modpack ohne Minecraft-Version");
        var primary = man["minecraft"]?["modLoaders"]?.AsArray().FirstOrDefault(l => (bool?)l!["primary"] == true) ?? man["minecraft"]?["modLoaders"]?.AsArray().FirstOrDefault();
        string loader = "vanilla"; string? lv = null;
        if ((string?)primary?["id"] is string lid)
        {
            var dash = lid.IndexOf('-');
            loader = lid[..dash]; lv = lid[(dash + 1)..];
            if (loader == "forge" && !lv.StartsWith(mc + "-")) lv = mc + "-" + lv;
            if (loader == "neoforge" && lv.StartsWith(mc + "-")) lv = lv[(mc.Length + 1)..];
        }
        var inst = Instances.Create(name ?? (string?)man["name"] ?? Path.GetFileNameWithoutExtension(zip), mc, loader, lv, "modpack");
        inst.Icon = "box"; inst.IconUrl = iconUrl; inst.ModpackProject = projectId != null ? "cf:" + projectId : null;
        Instances.Save(inst);

        var entries = man["files"]?.AsArray().Where(f => f != null && (bool?)f["required"] != false).ToList() ?? new();
        var manual = new List<string>();
        var blocked = new List<(JsonNode? mod, string type)>();
        if (entries.Count > 0)
        {
            if (!Ready) throw new InvalidOperationException("NO_CF_KEY");
            p?.Report(new Progress("Modpack-Dateien werden aufgelöst", 0, 1, entries.Count + " Dateien"));
            var files = new List<JsonNode>(); var mods = new Dictionary<int, JsonNode>();
            foreach (var chunk in entries.Chunk(200))
            {
                var fr = await Post("/mods/files", new JsonObject { ["fileIds"] = new JsonArray(chunk.Select(f => (JsonNode)(int)f!["fileID"]!).ToArray()) }, ct);
                files.AddRange(fr["data"]!.AsArray().Where(x => x != null)!);
                var mr = await Post("/mods", new JsonObject { ["modIds"] = new JsonArray(chunk.Select(f => (JsonNode)(int)f!["projectID"]!).ToArray()) }, ct);
                foreach (var m in mr["data"]!.AsArray()) mods[(int)m!["id"]!] = m;
            }
            var items = new List<DlItem>();
            foreach (var f in files)
            {
                var modId = (int)f["modId"]!; mods.TryGetValue(modId, out var m);
                var type = TypeOf((int?)m?["classId"] ?? ClassMods);
                var url = (string?)f["downloadUrl"];
                var fname = Path.GetFileName((string)f["fileName"]!);
                if (string.IsNullOrEmpty(url)) { blocked.Add((m, type)); manual.Add($"{(string?)m?["name"] ?? fname}|{(string?)m?["links"]?["websiteUrl"]}/files/{(int)f["id"]!}"); continue; }
                items.Add(new DlItem(url, Path.Combine(Instances.ContentDir(inst, type), fname), Sha1(f), (long?)f["fileLength"] ?? 0));
                inst.Content.Add(new InstalledContent { ProjectId = "cf:" + modId, VersionId = ((int)f["id"]!).ToString(), Title = (string?)m?["name"] ?? fname, Type = type, File = fname, Sha1 = Sha1(f), IconUrl = (string?)m?["logo"]?["thumbnailUrl"], VersionNumber = (string?)f["displayName"], Source = "curseforge" });
            }
            await Net.DownloadAll(items, "Modpack-Dateien", p, ct, 8);
        }
        var ov = ((string?)man["overrides"] ?? "overrides").TrimEnd('/') + "/";
        var root = Path.GetFullPath(inst.Dir);
        foreach (var e in z.Entries)
        {
            if (!e.FullName.StartsWith(ov) || e.FullName.EndsWith('/')) continue;
            var dst = Path.GetFullPath(Path.Combine(root, e.FullName[ov.Length..]));
            if (!dst.StartsWith(root + Path.DirectorySeparatorChar)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            e.ExtractToFile(dst, true);
        }
        // files CurseForge may not hand out: the same project on Modrinth, if the author publishes it there
        foreach (var (bm, bt) in blocked)
        {
            try
            {
                if (await OnModrinth(bm, bt, ct) is not string mr) continue;
                await Modrinth.Install(inst, mr, bt, null, p, ct);
                var bname = (string?)bm?["name"];
                manual.RemoveAll(x => bname != null && x.StartsWith(bname + "|"));
            }
            catch (OperationCanceledException) { throw; }
            catch { }
        }
        inst.ManualDownloads = manual;
        Instances.Save(inst);
        p?.Report(new Progress("Inhalte werden erkannt", 0, 1));
        await Modrinth.AttachCatalog(inst, ct);
        return inst;
    }

    public static async Task<Instance> InstallModpack(int modId, int? fileId, IProgress<Progress>? p, CancellationToken ct = default)
    {
        var mod = await Mod(modId, ct);
        var file = fileId != null ? (await Get($"/mods/{modId}/files/{fileId}", ct))["data"]! : await BestFile(modId, null, null, ct) ?? throw new InvalidOperationException("Keine Modpack-Datei gefunden");
        var url = (string?)file["downloadUrl"];
        if (string.IsNullOrEmpty(url))
        {
            if (await OnModrinth(mod, "modpack", ct) is string mrPack) return await Modrinth.InstallModpack(mrPack, null, p, ct);
            throw new InvalidOperationException("Der Autor erlaubt den Download dieses Modpacks nur direkt auf curseforge.com.");
        }
        var tmp = Path.Combine(Paths.Cache, "cf-" + Path.GetFileName((string)file["fileName"]!));
        p?.Report(new Progress("Modpack wird geladen", 0, 1, (string?)mod["name"]));
        await Net.Download(new DlItem(url, tmp, Sha1(file), (long?)file["fileLength"] ?? 0), ct);
        try { return await ImportPack(tmp, (string?)mod["name"], p, ct, modId, (string?)mod["logo"]?["thumbnailUrl"]); }
        finally { try { File.Delete(tmp); } catch { } }
    }

    private static string NormName(string s) => new string(s.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    /// <summary>The same project on Modrinth (exact name or slug), or null.</summary>
    public static async Task<string?> OnModrinth(JsonNode? mod, string type, CancellationToken ct = default)
    {
        var name = (string?)mod?["name"]; var slug = (string?)mod?["slug"];
        if (string.IsNullOrWhiteSpace(name)) return null;
        var n = NormName(name);
        var facets = Uri.EscapeDataString($"[[\"project_type:{type}\"]]");
        var r = await Net.Json($"{Modrinth.Api}/search?limit=10&query={Uri.EscapeDataString(name)}&facets={facets}", ct);
        var hit = r["hits"]?.AsArray().FirstOrDefault(h => NormName((string?)h?["title"] ?? "") == n)
            ?? r["hits"]?.AsArray().FirstOrDefault(h => slug != null && (string?)h?["slug"] == slug && NormName((string?)h?["title"] ?? "").Length > 0);
        return (string?)hit?["project_id"];
    }
}
