using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace OrbitLauncher.Core;

/// <summary>Everything needed to start a resolved version.</summary>
public class LaunchPlan
{
    public required JsonObject Version { get; init; }
    public List<string> Classpath { get; } = new();
    public required string NativesDir { get; init; }
    public required string AssetsRoot { get; init; }
    public string AssetIndex { get; set; } = "legacy";
    public string? GameAssets { get; set; }
    public string? LoggingArg { get; set; }
    public int JavaMajor { get; set; } = 8;
    public string JavaComponent { get; set; } = "jre-legacy";
}

public record Session(string Name, string Uuid, string AccessToken, string Xuid, string UserType = "msa");

/// <summary>Downloads client, libraries, natives and assets for a version (vanilla layout).</summary>
public static class GameInstaller
{
    public const string LibBase = "https://libraries.minecraft.net/";
    public const string ResBase = "https://resources.download.minecraft.net/";

    public static async Task<LaunchPlan> Prepare(string versionId, string gameDir, IProgress<Progress>? p, CancellationToken ct = default)
    {
        p?.Report(new Progress("Version wird geladen", 0, 1, versionId));
        var v = await Versions.Resolve(versionId, ct);
        var jarId = (string?)v["jar"] ?? versionId;

        var plan = new LaunchPlan
        {
            Version = v,
            NativesDir = Path.Combine(Paths.Natives, versionId),
            AssetsRoot = Paths.Assets,
            JavaMajor = (int?)v["javaVersion"]?["majorVersion"] ?? 8,
            JavaComponent = (string?)v["javaVersion"]?["component"] ?? "jre-legacy",
        };

        // ---- libraries + client jar
        var dl = new List<DlItem>();
        var natives = new List<(string jar, JsonNode? extract)>();
        var seen = new HashSet<string>();
        foreach (var lib in v["libraries"]?.AsArray() ?? new JsonArray())
        {
            if (lib == null || !Rules.Allowed(lib["rules"])) continue;
            var name = (string?)lib["name"] ?? "";
            var art = lib["downloads"]?["artifact"];
            string? path = null;
            if (art != null && art["path"] != null)
            {
                path = Path.Combine(Paths.Libraries, ((string)art["path"]!).Replace('/', Path.DirectorySeparatorChar));
                var url = (string?)art["url"];
                if (!string.IsNullOrEmpty(url)) dl.Add(new DlItem(url, path, (string?)art["sha1"], (long?)art["size"] ?? 0));
            }
            else if (lib["downloads"] == null && name.Length > 0 && lib["natives"] == null)
            {
                var rel = Net.MavenPath(name);
                path = Path.Combine(Paths.Libraries, rel);
                var baseUrl = ((string?)lib["url"] ?? LibBase).TrimEnd('/') + "/";
                dl.Add(new DlItem(baseUrl + Net.MavenUrlPath(name), path, (string?)lib["sha1"], (long?)lib["size"] ?? 0));
            }

            // old style natives (LWJGL 2 / early LWJGL 3): separate classifier jar that must be extracted
            var nat = (string?)lib["natives"]?[Rules.Os];
            if (nat != null)
            {
                nat = nat.Replace("${arch}", Rules.Arch == "x86" ? "32" : "64");
                var c = lib["downloads"]?["classifiers"]?[nat];
                if (c != null)
                {
                    var np = Path.Combine(Paths.Libraries, ((string)c["path"]!).Replace('/', Path.DirectorySeparatorChar));
                    dl.Add(new DlItem((string)c["url"]!, np, (string?)c["sha1"], (long?)c["size"] ?? 0));
                    natives.Add((np, lib["extract"]));
                }
            }
            // new style natives (":natives-windows" artifacts) stay on the classpath, LWJGL extracts them itself

            if (path != null && seen.Add(path)) plan.Classpath.Add(path);
        }

        var client = v["downloads"]?["client"];
        var jarPath = Versions.JarPath(jarId);
        if (client != null) dl.Add(new DlItem((string)client["url"]!, jarPath, (string?)client["sha1"], (long?)client["size"] ?? 0));
        plan.Classpath.Add(jarPath);

        // ---- logging config
        var log = v["logging"]?["client"];
        if (log?["file"] is JsonNode lf)
        {
            var lp = Path.Combine(Paths.Assets, "log_configs", (string)lf["id"]!);
            dl.Add(new DlItem((string)lf["url"]!, lp, (string?)lf["sha1"], (long?)lf["size"] ?? 0));
            plan.LoggingArg = ((string?)log["argument"] ?? "").Replace("${path}", lp);
        }

        await Net.DownloadAll(dl, "Bibliotheken", p, ct);

        // ---- natives
        Directory.CreateDirectory(plan.NativesDir);
        foreach (var (jar, extract) in natives) ExtractNatives(jar, plan.NativesDir, extract);

        // ---- assets
        await Assets(v, gameDir, plan, p, ct);
        return plan;
    }

    private static void ExtractNatives(string jar, string dir, JsonNode? extract)
    {
        if (!File.Exists(jar)) return;
        var exclude = extract?["exclude"]?.AsArray().Select(x => (string?)x ?? "").Where(x => x.Length > 0).ToList() ?? new();
        exclude.Add("META-INF/");
        using var z = ZipFile.OpenRead(jar);
        foreach (var e in z.Entries)
        {
            if (e.FullName.EndsWith('/') || exclude.Any(x => e.FullName.StartsWith(x))) continue;
            // new natives jars carry the binary in folders (e.g. windows/x64/org/lwjgl/lwjgl.dll) – keep only file names
            var ext = Path.GetExtension(e.Name).ToLowerInvariant();
            if (ext is not (".dll" or ".so" or ".dylib" or ".jnilib")) continue;
            var target = Path.Combine(dir, e.Name);
            try { if (!File.Exists(target) || new FileInfo(target).Length != e.Length) e.ExtractToFile(target, true); } catch (IOException) { /* in use by a running game */ }
        }
    }

    private static async Task Assets(JsonObject v, string gameDir, LaunchPlan plan, IProgress<Progress>? p, CancellationToken ct)
    {
        var ai = v["assetIndex"];
        if (ai == null) return;
        var id = (string)ai["id"]!;
        plan.AssetIndex = id;
        var idxPath = Path.Combine(Paths.Assets, "indexes", id + ".json");
        var item = new DlItem((string)ai["url"]!, idxPath, (string?)ai["sha1"], (long?)ai["size"] ?? 0);
        if (File.Exists(idxPath) && item.Sha1 != null && Net.Sha1(idxPath) != item.Sha1) File.Delete(idxPath);
        await Net.Download(item, ct);
        var idx = JsonNode.Parse(await File.ReadAllTextAsync(idxPath, ct))!;
        bool virt = (bool?)idx["virtual"] ?? false, mapRes = (bool?)idx["map_to_resources"] ?? false;
        var objs = idx["objects"]!.AsObject().Select(kv => (name: kv.Key, hash: (string)kv.Value!["hash"]!, size: (long)kv.Value!["size"]!)).ToList();
        var items = objs.Select(o => new DlItem(ResBase + o.hash[..2] + "/" + o.hash, Path.Combine(Paths.Assets, "objects", o.hash[..2], o.hash), o.hash, o.size)).ToList();
        await Net.DownloadAll(items, "Assets", p, ct, 24);

        if (virt || mapRes)
        {
            var target = mapRes ? Path.Combine(gameDir, "resources") : Path.Combine(Paths.Assets, "virtual", id);
            foreach (var o in objs)
            {
                var dst = Path.Combine(target, o.name.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(dst) && new FileInfo(dst).Length == o.size) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
                File.Copy(Path.Combine(Paths.Assets, "objects", o.hash[..2], o.hash), dst, true);
            }
            plan.GameAssets = target;
        }
    }
}

/// <summary>Turns a LaunchPlan into a java command line, exactly like the official launcher does.</summary>
public static class LaunchBuilder
{
    public static List<string> Build(LaunchPlan plan, Session s, string gameDir, int ramMb, string? extraJvm, int width = 0, int height = 0, string? quickPlayServer = null, IEnumerable<string>? launcherJvm = null, string? quickPlayWorld = null)
    {
        var v = plan.Version;
        var sep = OperatingSystem.IsWindows() ? ";" : ":";
        var features = new Dictionary<string, bool>
        {
            ["has_custom_resolution"] = width > 0 && height > 0,
            ["is_demo_user"] = false,
            ["is_quick_play_multiplayer"] = !string.IsNullOrEmpty(quickPlayServer),
            ["is_quick_play_singleplayer"] = !string.IsNullOrEmpty(quickPlayWorld),
        };
        var vars = new Dictionary<string, string>
        {
            ["auth_player_name"] = s.Name,
            ["version_name"] = (string?)v["id"] ?? "",
            ["game_directory"] = gameDir,
            ["assets_root"] = plan.AssetsRoot,
            ["game_assets"] = plan.GameAssets ?? plan.AssetsRoot,
            ["assets_index_name"] = plan.AssetIndex,
            ["auth_uuid"] = s.Uuid,
            ["auth_access_token"] = s.AccessToken,
            ["auth_session"] = $"token:{s.AccessToken}:{s.Uuid}",
            ["auth_xuid"] = s.Xuid,
            ["clientid"] = "",
            ["user_type"] = s.UserType,
            ["user_properties"] = "{}",
            ["version_type"] = (string?)v["type"] ?? "release",
            ["natives_directory"] = plan.NativesDir,
            ["launcher_name"] = "OrbitLauncher",
            ["launcher_version"] = Net.AppVersion,
            ["classpath"] = string.Join(sep, plan.Classpath),
            ["classpath_separator"] = sep,
            ["library_directory"] = Paths.Libraries,
            ["resolution_width"] = width.ToString(),
            ["resolution_height"] = height.ToString(),
            ["quickPlayMultiplayer"] = quickPlayServer ?? "",
            ["quickPlaySingleplayer"] = quickPlayWorld ?? "",
            ["quickPlayPath"] = Path.Combine(gameDir, "quickPlay", "log.json"),
        };

        var jvm = new List<string> { $"-Xmx{ramMb}M", $"-Xms{Math.Min(ramMb, 512)}M" };
        var args = v["arguments"] as JsonObject;

        // Mojang's recommended GC flags (new versions), minus the heap size we set ourselves
        if (string.IsNullOrWhiteSpace(extraJvm) && args?["default-user-jvm"] is JsonArray duj)
            jvm.AddRange(Expand(duj, features, vars).Where(a => !a.StartsWith("-Xmx") && !a.StartsWith("-Xms")));
        if (!string.IsNullOrWhiteSpace(extraJvm)) jvm.AddRange(SplitArgs(extraJvm));
        if (launcherJvm != null) jvm.AddRange(launcherJvm);

        if (args?["jvm"] is JsonArray ja) jvm.AddRange(Expand(ja, features, vars));
        else
        {
            if (OperatingSystem.IsWindows()) jvm.Add("-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump");
            jvm.Add("-Djava.library.path=" + plan.NativesDir);
            jvm.Add("-Dminecraft.launcher.brand=OrbitLauncher");
            jvm.Add("-Dminecraft.launcher.version=" + Net.AppVersion);
            jvm.Add("-cp"); jvm.Add(vars["classpath"]);
        }
        if (plan.LoggingArg != null) jvm.Add(plan.LoggingArg);

        var game = new List<string>();
        if (args?["game"] is JsonArray ga)
        {
            game.AddRange(Expand(ga, features, vars));
            // 1.13–1.19 have no quick play: join the server the classic way
            if (!string.IsNullOrEmpty(quickPlayServer) && !ga.ToJsonString().Contains("quickPlayMultiplayer"))
            { var hp = quickPlayServer.Split(':'); game.AddRange(new[] { "--server", hp[0], "--port", hp.Length > 1 ? hp[1] : "25565" }); }
        }
        else if ((string?)v["minecraftArguments"] is string ma)
        {
            game.AddRange(SplitArgs(ma).Select(a => Sub(a, vars)));
            if (features["has_custom_resolution"]) game.AddRange(new[] { "--width", vars["resolution_width"], "--height", vars["resolution_height"] });
            if (!string.IsNullOrEmpty(quickPlayServer)) { var hp = quickPlayServer.Split(':'); game.AddRange(new[] { "--server", hp[0], "--port", hp.Length > 1 ? hp[1] : "25565" }); }
        }

        var all = new List<string>();
        all.AddRange(jvm);
        all.Add((string)v["mainClass"]!);
        all.AddRange(game);
        return all;
    }

    private static IEnumerable<string> Expand(JsonArray arr, Dictionary<string, bool> features, Dictionary<string, string> vars)
    {
        foreach (var a in arr)
        {
            if (a is JsonValue jv && jv.TryGetValue<string>(out var str)) { yield return Sub(str, vars); continue; }
            if (a is not JsonObject o || !Rules.Allowed(o["rules"], features)) continue;
            var val = o["value"];
            if (val is JsonArray va) foreach (var x in va) yield return Sub((string?)x ?? "", vars);
            else if (val != null) yield return Sub((string?)val ?? "", vars);
        }
    }

    private static readonly Regex VarRx = new(@"\$\{([a-zA-Z_]+)\}");
    private static string Sub(string s, Dictionary<string, string> vars) => VarRx.Replace(s, m => vars.TryGetValue(m.Groups[1].Value, out var r) ? r : m.Value);

    public static List<string> SplitArgs(string s)
    {
        var r = new List<string>(); var cur = new StringBuilder(); bool q = false;
        foreach (var c in s)
        {
            if (c == '"') { q = !q; continue; }
            if (char.IsWhiteSpace(c) && !q) { if (cur.Length > 0) { r.Add(cur.ToString()); cur.Clear(); } continue; }
            cur.Append(c);
        }
        if (cur.Length > 0) r.Add(cur.ToString());
        return r;
    }

    /// <summary>Command line for logs, with the access token masked.</summary>
    public static string Pretty(string java, IEnumerable<string> args, Session s) =>
        java + " " + string.Join(' ', args.Select(a => a.Contains(' ') ? $"\"{a}\"" : a)).Replace(s.AccessToken, "••••••");

    public static Process Start(string java, List<string> args, string gameDir)
    {
        Directory.CreateDirectory(gameDir);
        var psi = new ProcessStartInfo(java)
        {
            WorkingDirectory = gameDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        return Process.Start(psi) ?? throw new InvalidOperationException("Java konnte nicht gestartet werden.");
    }
}
