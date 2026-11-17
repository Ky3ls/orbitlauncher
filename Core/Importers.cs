using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace OrbitLauncher.Core;

/// <summary>
/// Reads instances of other launchers on this PC (Modrinth App, CurseForge app, Prism/MultiMC/PolyMC)
/// with their settings, play time and dates. Nothing in the other launcher is changed.
/// </summary>
public static class Importers
{
    /// <summary>Settings and stats that come along with an instance.</summary>
    public class Extra
    {
        public long PlaySeconds { get; set; }
        public DateTime? LastPlayed { get; set; }
        public DateTime? Created { get; set; }
        public string? Group { get; set; }
        public int RamMb { get; set; }
        public string? JvmArgs { get; set; }
        public string? JavaPath { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public bool Fullscreen { get; set; }
        public string? EnvVars { get; set; }
        public string? PreLaunch { get; set; }
        public string? Wrapper { get; set; }
        public string? PostExit { get; set; }
        /// <summary>Local picture of the instance in the other launcher.</summary>
        public string? IconFile { get; set; }
    }

    private static string Roaming => Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    private static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private static string Docs => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

    // ------------------------------------------------------------------ Modrinth App
    public static List<(Transfer.Found f, Extra x)> Modrinth()
    {
        var r = new List<(Transfer.Found, Extra)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var baseDir in new[] { Path.Combine(Roaming, "ModrinthApp"), Path.Combine(Roaming, "com.modrinth.theseus"), Path.Combine(Roaming, "com.modrinth.app") })
        {
            if (!Directory.Exists(baseDir)) continue;
            var db = Path.Combine(baseDir, "app.db");
            if (File.Exists(db)) { try { foreach (var it in ModrinthDb(baseDir, db)) if (seen.Add(it.Item1.Path)) r.Add(it); } catch { } }
            // very old app versions kept a profile.json in every instance folder
            var profiles = Path.Combine(baseDir, "profiles");
            if (!Directory.Exists(profiles)) continue;
            foreach (var d in Directory.GetDirectories(profiles))
            {
                try
                {
                    if (seen.Contains(d)) continue;
                    var pf = Path.Combine(d, "profile.json"); if (!File.Exists(pf)) continue;
                    var j = JsonNode.Parse(File.ReadAllText(pf))!;
                    var meta = j["metadata"] ?? j;
                    var mc = Str(meta["game_version"]) ?? "";
                    var loader = Loader(Str(meta["loader"]) ?? Str(meta["mod_loader"]));
                    var lv = ForgeLv(loader, mc, Str(meta["loader_version"]?["id"]) ?? Str(meta["loader_version"]) ?? Str(meta["mod_loader_version"]));
                    if (mc.Length == 0) continue;
                    seen.Add(d);
                    r.Add((new Transfer.Found("Modrinth App", Str(meta["name"]) ?? Path.GetFileName(d), d, mc, loader, lv, Str(meta["linked_data"]?["project_id"]), null),
                        new Extra { IconFile = Str(meta["icon"]), Group = "Modrinth App" }));
                }
                catch { }
            }
        }
        return r;
    }

    private static List<(Transfer.Found, Extra)> ModrinthDb(string baseDir, string db)
    {
        var r = new List<(Transfer.Found, Extra)>();
        // the app keeps the database open (WAL): read a private copy so nothing of theirs is touched or locked
        var tmp = Path.Combine(Paths.Cache, "import-mr");
        Directory.CreateDirectory(tmp);
        foreach (var ext in new[] { "", "-wal", "-shm" })
        {
            var dst = Path.Combine(tmp, "app.db" + ext);
            try { File.Delete(dst); } catch { }
            if (!File.Exists(db + ext)) continue;
            using var src = new FileStream(db + ext, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var o = File.Create(dst); src.CopyTo(o);
        }
        SQLitePCL.Batteries.Init();
        using var c = new SqliteConnection($"Data Source={Path.Combine(tmp, "app.db")};Pooling=False");
        c.Open();
        try
        {
            var tables = Rows(c, "SELECT name FROM sqlite_master WHERE type='table'").Select(x => (string?)x["name"]).ToHashSet();
            var set = Rows(c, "SELECT * FROM settings LIMIT 1").FirstOrDefault() ?? new();
            var root = (set.GetValueOrDefault("custom_dir") as string) is { Length: > 0 } cd && Directory.Exists(cd) ? cd : baseDir;
            var globalRam = Long(set.GetValueOrDefault("mc_memory_max"));
            var globalArgs = Args(JsonCol(c, "SELECT json(extra_launch_args) AS j FROM settings LIMIT 1"));

            if (tables.Contains("instances"))
            {
                var rows = Rows(c, @"SELECT i.id, i.path, i.name, i.icon_path, i.created, i.last_played, i.submitted_time_played, i.recent_time_played,
                        cs.game_version, cs.loader, cs.loader_version, l.modrinth_project_id
                    FROM instances i
                    LEFT JOIN instance_content_sets cs ON cs.id = COALESCE(i.applied_content_set_id, (SELECT id FROM instance_content_sets WHERE instance_id = i.id ORDER BY modified DESC LIMIT 1))
                    LEFT JOIN instance_links l ON l.instance_id = i.id");
                foreach (var row in rows)
                {
                    var id = row["id"] as string ?? "";
                    var groups = Rows(c, "SELECT g.name AS n FROM instance_group_memberships m JOIN instance_groups g ON g.id = m.group_id WHERE m.instance_id = $id", id);
                    if (groups.Count == 0) groups = Rows(c, "SELECT group_name AS n FROM instance_groups WHERE instance_id = $id", id);
                    var ov = JsonCol(c, "SELECT json(overrides) AS j FROM instance_launch_overrides WHERE instance_id = $id", id);
                    var it = MrItem(root, row, "game_version", "loader", "loader_version", row["modrinth_project_id"] as string, groups.Select(g => g["n"] as string).FirstOrDefault(g => !string.IsNullOrWhiteSpace(g)), globalRam, globalArgs);
                    if (it == null) continue;
                    ApplyOverrides(it.Value.Item2, ov);
                    r.Add(it.Value);
                }
            }
            else if (tables.Contains("profiles"))
            {
                foreach (var row in Rows(c, "SELECT *, json(groups) AS groups_j, json(override_extra_launch_args) AS args_j, json(override_custom_env_vars) AS env_j FROM profiles"))
                {
                    string? group = null;
                    try { group = JsonNode.Parse(row["groups_j"] as string ?? "[]")?.AsArray().Select(Str).FirstOrDefault(g => !string.IsNullOrWhiteSpace(g)); } catch { }
                    var linkedVersion = row.GetValueOrDefault("linked_version_id") as string;
                    var it = MrItem(root, row, "game_version", "mod_loader", "mod_loader_version", string.IsNullOrEmpty(linkedVersion) ? null : row.GetValueOrDefault("linked_project_id") as string, group, globalRam, globalArgs);
                    if (it == null) continue;
                    var x = it.Value.Item2;
                    if (row.GetValueOrDefault("override_java_path") is string jp && jp.Length > 0) x.JavaPath = jp;
                    if (Args(Parse(row.GetValueOrDefault("args_j") as string)) is string a) x.JvmArgs = a;
                    if (Env(Parse(row.GetValueOrDefault("env_j") as string)) is string e) x.EnvVars = e;
                    if (Long(row.GetValueOrDefault("override_mc_memory_max")) is long m && m > 0) x.RamMb = (int)m;
                    if (Long(row.GetValueOrDefault("override_mc_force_fullscreen")) is long fs) x.Fullscreen = fs != 0;
                    if (Long(row.GetValueOrDefault("override_mc_game_resolution_x")) is long w && Long(row.GetValueOrDefault("override_mc_game_resolution_y")) is long h) { x.Width = (int)w; x.Height = (int)h; }
                    x.PreLaunch = NonEmpty(row.GetValueOrDefault("override_hook_pre_launch") as string);
                    x.Wrapper = NonEmpty(row.GetValueOrDefault("override_hook_wrapper") as string);
                    x.PostExit = NonEmpty(row.GetValueOrDefault("override_hook_post_exit") as string);
                    r.Add(it.Value);
                }
            }
        }
        finally { c.Close(); }
        return r;
    }

    private static (Transfer.Found, Extra)? MrItem(string root, Dictionary<string, object?> row, string mcCol, string loaderCol, string lvCol, string? project, string? group, long? globalRam, string? globalArgs)
    {
        var path = row.GetValueOrDefault("path") as string;
        if (string.IsNullOrWhiteSpace(path)) return null;
        var dir = Path.IsPathRooted(path) ? path : Path.Combine(root, "profiles", path);
        if (!Directory.Exists(dir)) return null;
        var mc = row.GetValueOrDefault(mcCol) as string ?? "";
        if (mc.Length == 0) return null;
        var loader = Loader(row.GetValueOrDefault(loaderCol) as string);
        var lv = ForgeLv(loader, mc, row.GetValueOrDefault(lvCol) as string);
        var x = new Extra
        {
            PlaySeconds = Math.Max(0, (Long(row.GetValueOrDefault("submitted_time_played")) ?? 0) + (Long(row.GetValueOrDefault("recent_time_played")) ?? 0)),
            LastPlayed = Unix(row.GetValueOrDefault("last_played")),
            Created = Unix(row.GetValueOrDefault("created")),
            Group = group,
            IconFile = row.GetValueOrDefault("icon_path") as string,
            // the instance had no own value: keep what the Modrinth App used for it globally
            RamMb = globalRam is > 0 and not 2048 ? (int)globalRam : 0,
            JvmArgs = globalArgs,
        };
        return (new Transfer.Found("Modrinth App", row.GetValueOrDefault("name") as string ?? Path.GetFileName(dir), dir, mc, loader, lv, NonEmpty(project), null), x);
    }

    private static void ApplyOverrides(Extra x, JsonNode? o)
    {
        if (o == null) return;
        if (Str(o["java_path"]) is string jp) x.JavaPath = jp;
        if (Args(o["extra_launch_args"]) is string a) x.JvmArgs = a;
        if (Env(o["custom_env_vars"]) is string e) x.EnvVars = e;
        if (Long(o["memory"]?["maximum"]) is long m && m > 0) x.RamMb = (int)m;
        if (o["force_fullscreen"] is JsonValue fv && fv.TryGetValue<bool>(out var fs)) x.Fullscreen = fs;
        if (o["game_resolution"] is JsonArray res && res.Count == 2 && Long(res[0]) is long w && Long(res[1]) is long h) { x.Width = (int)w; x.Height = (int)h; }
        x.PreLaunch = NonEmpty(Str(o["hooks"]?["pre_launch"])) ?? x.PreLaunch;
        x.Wrapper = NonEmpty(Str(o["hooks"]?["wrapper"])) ?? x.Wrapper;
        x.PostExit = NonEmpty(Str(o["hooks"]?["post_exit"])) ?? x.PostExit;
    }

    // ------------------------------------------------------------------ CurseForge app
    public static List<(Transfer.Found f, Extra x)> CurseForgeApp()
    {
        var r = new List<(Transfer.Found, Extra)>();
        var roots = new[] { Path.Combine(Home, "curseforge", "minecraft", "Instances"), Path.Combine(Docs, "curseforge", "minecraft", "Instances") }
            .Where(Directory.Exists).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots)
            foreach (var d in Directory.GetDirectories(root))
            {
                try
                {
                    var f = Path.Combine(d, "minecraftinstance.json"); if (!File.Exists(f)) continue;
                    var j = JsonNode.Parse(File.ReadAllText(f))!;
                    var b = j["baseModLoader"];
                    var mc = Str(j["gameVersion"]) ?? Str(b?["minecraftVersion"]) ?? "";
                    if (mc.Length == 0) continue;
                    var lname = (Str(b?["name"]) ?? "").Trim();
                    var lower = lname.ToLowerInvariant();
                    var loader = Long(b?["type"]) switch
                    {
                        1 => "forge", 4 => "fabric", 5 => "quilt", 6 => "neoforge",
                        _ => lower.StartsWith("neoforge") ? "neoforge" : lower.StartsWith("forge") ? "forge" : lower.StartsWith("fabric") ? "fabric" : lower.StartsWith("quilt") ? "quilt" : "vanilla",
                    };
                    string? lv = null;
                    if (loader != "vanilla")
                    {
                        lv = lname.Contains('-') ? lname[(lname.IndexOf('-') + 1)..] : Str(b?["forgeVersion"]);
                        if (lv != null && loader is "fabric" or "quilt" && lv.EndsWith("-" + mc)) lv = lv[..^(mc.Length + 1)];
                        lv = ForgeLv(loader, mc, lv);
                    }
                    var pack = j["installedModpack"];
                    var pid = Long(j["projectID"]) ?? Long(pack?["addonID"]) ?? Long(pack?["modId"]);
                    var x = new Extra
                    {
                        LastPlayed = Date(j["lastPlayed"]),
                        Created = Date(j["dateCreated"]) ?? Date(j["installDate"]),
                        Group = "CurseForge",
                        RamMb = j["isMemoryOverride"] is JsonValue mo && mo.TryGetValue<bool>(out var o) && o && Long(j["allocatedMemory"]) is long mem && mem >= 512 ? (int)mem : 0,
                        JvmArgs = NonEmpty(Str(j["javaArgsOverride"])),
                        IconFile = Str(j["profileImagePath"]),
                    };
                    var icon = Str(pack?["thumbnailUrl"]) ?? Str(j["thumbnailUrl"]);
                    r.Add((new Transfer.Found("CurseForge", Str(j["name"]) ?? Path.GetFileName(d), d, mc, loader, lv, pid is > 0 ? "cf:" + pid : null,
                        icon != null && icon.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? icon : null), x));
                }
                catch { }
            }
        return r;
    }

    // ------------------------------------------------------------------ helpers
    public static string? IconData(string? file)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(file) || !File.Exists(file) || new FileInfo(file).Length > 1024 * 1024) return null;
            var ext = Path.GetExtension(file).ToLowerInvariant();
            var mime = ext switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif", ".webp" => "image/webp", _ => null };
            return mime == null ? null : $"data:{mime};base64," + Convert.ToBase64String(File.ReadAllBytes(file));
        }
        catch { return null; }
    }

    /// <summary>Number of entries in a sub folder of the game dir (mods, saves …).</summary>
    public static int Count(string dir, string sub, string? pattern = null)
    {
        try
        {
            var p = Path.Combine(dir, sub);
            if (!Directory.Exists(p)) return 0;
            return pattern == null ? Directory.GetDirectories(p).Length : Directory.GetFiles(p).Count(f => pattern.Split('|').Any(e => f.EndsWith(e, StringComparison.OrdinalIgnoreCase)));
        }
        catch { return 0; }
    }

    private static string Loader(string? s)
    {
        var l = (s ?? "vanilla").Trim().ToLowerInvariant();
        return l is "fabric" or "quilt" or "forge" or "neoforge" ? l : "vanilla";
    }
    private static string? ForgeLv(string loader, string mc, string? lv)
    {
        if (string.IsNullOrWhiteSpace(lv) || loader == "vanilla") return null;
        return loader == "forge" && !lv.StartsWith(mc + "-") ? mc + "-" + lv : lv;
    }
    private static string? NonEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
    private static JsonNode? Parse(string? s) { try { return s == null ? null : JsonNode.Parse(s); } catch { return null; } }
    private static long? Long(object? o) => o switch
    {
        long l => l, int i => i, double d => (long)d, string s when long.TryParse(s, out var p) => p,
        JsonValue v when v.TryGetValue<long>(out var l2) => l2,
        JsonValue v when v.TryGetValue<double>(out var d2) => (long)d2,
        JsonValue v when v.TryGetValue<string>(out var s2) && long.TryParse(s2, out var p2) => p2,
        _ => null,
    };
    private static DateTime? Unix(object? o)
    {
        if (Long(o) is not long t || t <= 0) return null;
        return (t > 100_000_000_000 ? DateTimeOffset.FromUnixTimeMilliseconds(t) : DateTimeOffset.FromUnixTimeSeconds(t)).UtcDateTime;
    }
    private static DateTime? Date(JsonNode? n) => Str(n) is string s && DateTime.TryParse(s, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d) && d.Year > 2000 ? d : null;
    private static string? Args(JsonNode? n) => n is JsonArray a && a.Count > 0 ? NonEmpty(string.Join(" ", a.Select(Str).Where(x => x != null))) : null;
    private static string? Env(JsonNode? n) => n is JsonArray a && a.Count > 0
        ? NonEmpty(string.Join("\n", a.Select(p => p is JsonArray kv && kv.Count == 2 ? $"{Str(kv[0])}={Str(kv[1])}" : null).Where(x => x != null))) : null;

    private static List<Dictionary<string, object?>> Rows(SqliteConnection c, string sql, string? id = null)
    {
        var r = new List<Dictionary<string, object?>>();
        try
        {
            using var cmd = c.CreateCommand(); cmd.CommandText = sql;
            if (id != null) cmd.Parameters.AddWithValue("$id", id);
            using var rd = cmd.ExecuteReader();
            while (rd.Read())
            {
                var d = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < rd.FieldCount; i++) d[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
                r.Add(d);
            }
        }
        catch { }
        return r;
    }
    private static JsonNode? JsonCol(SqliteConnection c, string sql, string? id = null) => Parse(Rows(c, sql, id).FirstOrDefault()?.GetValueOrDefault("j") as string);
}

/// <summary>How much memory an instance should get, from its mod count, shaders and the RAM of this PC.</summary>
public static class Ram
{
    public static long TotalMb => Math.Max(0, GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / 1024 / 1024);

    public record Advice(int Mods, bool Shaders, int Rec, int Cur, bool Custom, long Total, bool Capped, bool NoAsk);

    public static Advice Check(Instance inst, Settings s)
    {
        var mods = 0;
        try { var d = Path.Combine(inst.Dir, "mods"); if (Directory.Exists(d)) mods = Directory.EnumerateFiles(d, "*.jar").Count(); } catch { }
        var shaders = false;
        try { var d = Path.Combine(inst.Dir, "shaderpacks"); shaders = Directory.Exists(d) && Directory.EnumerateFileSystemEntries(d).Any(f => !f.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)); } catch { }
        int want = mods switch { 0 => 2048, <= 20 => 3072, <= 60 => 4096, <= 120 => 6144, <= 200 => 8192, _ => 10240 };
        if (shaders) want += 1024;
        var total = TotalMb;
        var capped = false;
        if (total > 0)
        {
            // leave Windows and the browser room: at least 4 GB, and never more than 75 % of the PC
            var safe = (int)Math.Max(2048, Math.Min(total - 4096, total * 3 / 4)) / 512 * 512;
            if (want > safe) { want = safe; capped = true; }
        }
        var cur = inst.RamMb > 0 ? inst.RamMb : s.RamMb > 0 ? s.RamMb : 4096;
        return new Advice(mods, shaders, want, cur, inst.RamMb > 0, total, capped, inst.RamNoAsk);
    }
}
