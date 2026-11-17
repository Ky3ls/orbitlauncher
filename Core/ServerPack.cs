using System.IO.Compression;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace OrbitLauncher.Core;

/// <summary>Where a mod runs: "client", "server" or "both", read from the mod's own metadata (cached).</summary>
public static class ModEnv
{
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (long len, DateTime at, string? env)> Cache = new(StringComparer.OrdinalIgnoreCase);

    public static string? Of(string jar)
    {
        try
        {
            var fi = new FileInfo(jar);
            if (Cache.TryGetValue(jar, out var c) && c.len == fi.Length && c.at == fi.LastWriteTimeUtc) return c.env;
            var env = Read(jar);
            Cache[jar] = (fi.Length, fi.LastWriteTimeUtc, env);
            return env;
        }
        catch { return null; }
    }

    private static string? Read(string jar)
    {
        using var z = ZipFile.OpenRead(jar);
        string? Text(string name) { var e = z.GetEntry(name); if (e == null || e.Length > 512 * 1024) return null; using var r = new StreamReader(e.Open()); return r.ReadToEnd(); }
        // Fabric
        if (Text("fabric.mod.json") is string fj)
        {
            try
            {
                var env = (string?)JsonNode.Parse(fj, documentOptions: new System.Text.Json.JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = System.Text.Json.JsonCommentHandling.Skip })?["environment"];
                return env switch { "client" => "client", "server" => "server", _ => "both" };
            }
            catch { return null; }
        }
        // Quilt
        if (Text("quilt.mod.json") is string qj)
        {
            try { var env = (string?)JsonNode.Parse(qj)?["minecraft"]?["environment"]; return env switch { "client" => "client", "dedicated_server" => "server", _ => "both" }; }
            catch { return null; }
        }
        // Forge / NeoForge
        var toml = Text("META-INF/neoforge.mods.toml") ?? Text("META-INF/mods.toml");
        if (toml != null)
        {
            if (Regex.IsMatch(toml, @"(?m)^\s*clientSideOnly\s*=\s*true")) return "client";
            var dt = Regex.Match(toml, @"(?m)^\s*displayTest\s*=\s*""(\w+)""");
            if (dt.Success && dt.Groups[1].Value == "IGNORE_SERVER_VERSION") return "server";
            return null;   // Forge metadata rarely says it; the catalog knows better
        }
        return null;
    }
}

/// <summary>Fills InstalledContent.Env from Modrinth (client_side/server_side) and CurseForge (Client/Server file tags).</summary>
public static class CatalogEnv
{
    public static string FromModrinth(string? client, string? server)
    {
        if (server == "unsupported") return "client";
        if (client == "unsupported") return "server";
        if (client == "required" && server == "optional") return "client";
        if (server == "required" && client == "optional") return "server";
        return "both";
    }

    public static async Task<bool> Fill(Instance inst, CancellationToken ct = default)
    {
        var todo = inst.Content.Where(c => c.Type == "mod" && c.Env == null && !string.IsNullOrEmpty(c.ProjectId)).ToList();
        if (todo.Count == 0) return false;
        var mr = todo.Where(c => !c.ProjectId.StartsWith("cf:")).ToList();
        foreach (var chunk in mr.Select(c => c.ProjectId).Distinct().Chunk(100))
        {
            try
            {
                var ids = Uri.EscapeDataString(System.Text.Json.JsonSerializer.Serialize(chunk));
                var arr = await Net.Json($"{Modrinth.Api}/projects?ids={ids}", ct);
                foreach (var p in arr.AsArray())
                {
                    var env = FromModrinth((string?)p?["client_side"], (string?)p?["server_side"]);
                    foreach (var c in mr.Where(c => c.ProjectId == (string?)p?["id"])) c.Env = env;
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { }
        }
        var cf = todo.Where(c => c.ProjectId.StartsWith("cf:") && int.TryParse(c.VersionId, out _)).ToList();
        if (cf.Count > 0 && CurseForge.Ready)
            foreach (var chunk in cf.Chunk(200))
            {
                try
                {
                    var r = await CurseForge.Post("/mods/files", new JsonObject { ["fileIds"] = new JsonArray(chunk.Select(c => (JsonNode)int.Parse(c.VersionId)).ToArray()) }, ct);
                    foreach (var f in r["data"]?.AsArray() ?? new JsonArray())
                    {
                        var gv = f?["gameVersions"]?.AsArray().Select(x => (string?)x).ToList() ?? new();
                        bool cl = gv.Contains("Client"), sv = gv.Contains("Server");
                        var env = cl && sv ? "both" : cl ? "client" : sv ? "server" : "";
                        foreach (var c in chunk.Where(c => c.VersionId == ((int?)f?["id"])?.ToString())) c.Env = env;
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch { }
            }
        // no answer from the catalogs: remember that, so we do not ask again on every visit
        foreach (var c in todo) c.Env ??= "";
        return true;
    }
}

/// <summary>Server version of a modpack: the official server pack from CurseForge, or one built from the instance.</summary>
public static class ServerPack
{
    public record Result(string Kind, string? Path, string? Url);

    /// <summary>Official server pack of the CurseForge modpack, when its authors publish one. Null when there is none.</summary>
    public static async Task<JsonNode?> Official(Instance inst, CancellationToken ct = default)
    {
        if (!CurseForge.Ready || inst.ModpackProject is not string mp || !mp.StartsWith("cf:") || !int.TryParse(mp[3..], out var modId)) return null;
        JsonNode? file = null;
        if (int.TryParse(inst.ModpackVersion, out var fid)) { try { file = (await CurseForge.Get($"/mods/{modId}/files/{fid}", ct))["data"]; } catch { } }
        if (file == null)
        {
            // version unknown (older install): the newest pack file for this Minecraft version
            var r = await CurseForge.Get($"/mods/{modId}/files?gameVersion={Uri.EscapeDataString(inst.McVersion)}&pageSize=20", ct);
            file = r["data"]?.AsArray().FirstOrDefault(f => (int?)f?["serverPackFileId"] > 0);
        }
        var sid = (int?)file?["serverPackFileId"];
        if (sid is not > 0) return null;
        return (await CurseForge.Get($"/mods/{modId}/files/{sid}", ct))["data"];
    }

    public static async Task<Result> Create(Instance inst, string target, IProgress<Progress>? p, CancellationToken ct = default)
    {
        p?.Report(new Progress("Server-Paket wird gesucht", 0, 1, inst.Name));
        JsonNode? off = null;
        try { off = await Official(inst, ct); } catch (OperationCanceledException) { throw; } catch { }
        if (off != null)
        {
            var url = (string?)off["downloadUrl"];
            if (string.IsNullOrEmpty(url))
            {
                // the authors only allow it on curseforge.com
                var page = inst.ModpackProject is string mp ? $"https://www.curseforge.com/minecraft/modpacks/{await Slug(int.Parse(mp[3..]), ct)}/files/{(int)off["id"]!}" : null;
                return new Result("website", null, page);
            }
            p?.Report(new Progress("Server-Paket wird geladen", 0, 1, (string?)off["fileName"]));
            await Net.Download(new DlItem(url, target, null, (long?)off["fileLength"] ?? 0), ct);
            return new Result("official", target, null);
        }
        // ask the catalogs which mods are client-only before leaving them out
        p?.Report(new Progress("Mods werden geprüft", 0, 1, inst.Name));
        try { if (await CatalogEnv.Fill(inst, ct)) Instances.Save(inst, false); } catch (OperationCanceledException) { throw; } catch { }
        await Task.Run(() => Build(inst, target, p, ct), ct);
        return new Result("built", target, null);
    }

    private static async Task<string> Slug(int id, CancellationToken ct) { try { return (string?)(await CurseForge.Mod(id, ct))["slug"] ?? id.ToString(); } catch { return id.ToString(); } }

    /// <summary>Own server pack: every mod that is not client-only, plus configs and scripts.</summary>
    public static void Build(Instance inst, string target, IProgress<Progress>? p, CancellationToken ct)
    {
        if (File.Exists(target)) File.Delete(target);
        var files = new List<(string src, string entry)>();
        int skipped = 0;
        var mods = Path.Combine(inst.Dir, "mods");
        if (Directory.Exists(mods))
            foreach (var f in Directory.GetFiles(mods, "*.jar"))
            {
                var known = inst.Content.FirstOrDefault(c => c.Type == "mod" && Instances.EnabledName(c.File).Equals(Path.GetFileName(f), StringComparison.OrdinalIgnoreCase))?.Env;
                if ((string.IsNullOrEmpty(known) ? ModEnv.Of(f) : known) == "client") { skipped++; continue; }
                files.Add((f, "mods/" + Path.GetFileName(f)));
            }
        foreach (var d in new[] { "config", "defaultconfigs", "kubejs", "scripts", "global_packs", "datapacks" })
        {
            var dir = Path.Combine(inst.Dir, d);
            if (!Directory.Exists(dir)) continue;
            foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                files.Add((f, Path.GetRelativePath(inst.Dir, f).Replace('\\', '/')));
        }
        using var z = ZipFile.Open(target, ZipArchiveMode.Create);
        int i = 0;
        foreach (var (src, entry) in files)
        {
            ct.ThrowIfCancellationRequested();
            if (++i % 20 == 0) p?.Report(new Progress("Server-Paket wird gepackt", i, files.Count, entry));
            try
            {
                var e = z.CreateEntry(entry, CompressionLevel.Fastest);
                using var es = e.Open(); using var fs = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); fs.CopyTo(es);
            }
            catch (IOException) { }
        }
        var loader = inst.Loader switch
        {
            "fabric" => $"Fabric Server: https://fabricmc.net/use/server/ (Minecraft {inst.McVersion}, Loader {inst.LoaderVersion})",
            "quilt" => $"Quilt Server: https://quiltmc.org/en/install/server/ (Minecraft {inst.McVersion}, Loader {inst.LoaderVersion})",
            "forge" => $"Forge Installer: https://files.minecraftforge.net/net/minecraftforge/forge/index_{inst.McVersion}.html (Version {inst.LoaderVersion}), dort \"Install server\" wählen",
            "neoforge" => $"NeoForge Installer: https://neoforged.net/ (Version {inst.LoaderVersion}), dort \"Install server\" wählen",
            _ => $"Vanilla Server: https://www.minecraft.net/download/server (Minecraft {inst.McVersion})",
        };
        using (var w = new StreamWriter(z.CreateEntry("LIESMICH.txt").Open()))
            w.Write($"Server-Paket für {inst.Name} (Minecraft {inst.McVersion})\r\nErstellt mit OrbitLauncher.\r\n\r\n" +
                    $"1. Server-Software installieren:\r\n   {loader}\r\n2. Den Inhalt dieser Zip in den Server-Ordner kopieren.\r\n3. Server starten und die eula.txt akzeptieren.\r\n\r\n" +
                    $"{skipped} reine Client-Mods (z. B. Shader, Minimaps, HUDs) wurden weggelassen.\r\n");
    }
}
