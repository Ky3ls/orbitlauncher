using System.IO.Compression;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>
/// Orbit account + cloud sync. Instances (version, loader, mod list, options, servers, small config folders),
/// launcher settings, Orbit Client settings and the skin library are stored on the account, so they show up on
/// every PC. Mods themselves are not uploaded: they are re-downloaded from Modrinth / CurseForge by exact version.
/// </summary>
public static class Cloud
{
    public const string DefaultApi = "https://orbitlauncher-api.orbittweak.workers.dev";
    public static string Api { get; set; } = DefaultApi;
    /// <summary>Token protection (DPAPI in the app, identity in tests).</summary>
    public static Func<string, string> Protect { get; set; } = Dpapi.Protect;
    public static Func<string, string> Unprotect { get; set; } = Dpapi.Unprotect;

    private class Store
    {
        public string? Name { get; set; }
        public string? Token { get; set; }
        /// <summary>Instance uids deleted on this PC that still need a tombstone in the cloud.</summary>
        public List<string> PendingDeletes { get; set; } = new();
        /// <summary>Uids this PC has seen as deleted (never re-created from the cloud).</summary>
        public List<string> Tombstones { get; set; } = new();
        public DateTime? LastSync { get; set; }
        public long SettingsAt { get; set; }
        /// <summary>Per instance uid: which file bundle this PC has (uploaded or applied) and the local file signature at that moment.</summary>
        public Dictionary<string, BundleState> Bundles { get; set; } = new();
    }
    public class BundleState { public string Id { get; set; } = ""; public string Sig { get; set; } = ""; }
    private static readonly object L = new();
    private static string FilePath => Path.Combine(Paths.Root, "cloud.json");
    private static Store Load() => Net.LoadJson<Store>(FilePath) ?? new Store();
    private static void Save(Store s) => Net.SaveJson(FilePath, s);

    public static string? Name => Load().Name;
    public static bool LoggedIn => Load().Token != null;
    public static DateTime? LastSync => Load().LastSync;

    private static string? Token()
    {
        var t = Load().Token;
        if (t == null) return null;
        try { return Unprotect(t); } catch { return null; }
    }

    /// <summary>Same as the server expects: PBKDF2-SHA256(password, "orbitlauncher:" + lowercase name, 150000).</summary>
    public static string ClientHash(string name, string password) =>
        Convert.ToHexString(Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), Encoding.UTF8.GetBytes("orbitlauncher:" + name.ToLowerInvariant()), 150000, HashAlgorithmName.SHA256, 32)).ToLowerInvariant();

    private static async Task<JsonNode> Call(HttpMethod m, string path, object? body, CancellationToken ct, bool auth = true)
    {
        using var req = new HttpRequestMessage(m, Api.TrimEnd('/') + path);
        if (body != null) req.Content = new StringContent(body is string s ? s : JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        if (auth) { var t = Token() ?? throw new InvalidOperationException("Nicht bei Orbit angemeldet."); req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t); }
        Access.Sign(req);
        using var r = await Net.Http.SendAsync(req, ct);
        var txt = await r.Content.ReadAsStringAsync(ct);
        JsonNode? j = null; try { j = JsonNode.Parse(txt); } catch { }
        if ((int)r.StatusCode == 401 && auth) { lock (L) { var st = Load(); st.Token = null; Save(st); } throw new InvalidOperationException("Orbit-Anmeldung abgelaufen, bitte neu anmelden."); }
        if ((int)r.StatusCode == 409) return j ?? new JsonObject();
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException((string?)j?["error"] ?? $"Orbit-Cloud nicht erreichbar ({(int)r.StatusCode})");
        return j ?? new JsonObject();
    }

    public sealed record SessionStart(string? Name, string? Need, string? Ticket);

    private static void StoreSession(JsonNode r, string name)
    {
        lock (L) { var st = Load(); st.Name = (string?)r["name"] ?? name; st.Token = Protect((string)r["token"]!); st.SettingsAt = 0; Save(st); }
    }

    public static async Task<SessionStart> Login(string name, string password, bool register, CancellationToken ct = default)
    {
        name = name.Trim();
        var r = await Call(HttpMethod.Post, register ? "/v1/register" : "/v1/login", new { name, ph = ClientHash(name, password), device = Environment.MachineName }, ct, false);
        if ((string?)r["token"] != null) StoreSession(r, name);
        return new SessionStart((string?)r["name"] ?? name, (string?)r["need"], (string?)r["ticket"]);
    }

    public static async Task<string> LoginTotp(string ticket, string code, CancellationToken ct = default)
    {
        var r = await Call(HttpMethod.Post, "/v1/login/totp", new { ticket, code, device = Environment.MachineName }, ct, false);
        StoreSession(r, (string?)r["name"] ?? "");
        return Name!;
    }

    public static Task<JsonNode> TotpStart(CancellationToken ct = default) => Call(HttpMethod.Post, "/v1/totp/start", new { }, ct);
    public static Task<JsonNode> TotpConfirm(string code, CancellationToken ct = default) => Call(HttpMethod.Post, "/v1/totp/confirm", new { code }, ct);
    public static Task<JsonNode> TotpDisable(string password, string code, CancellationToken ct = default)
        => Call(HttpMethod.Delete, "/v1/totp", new { ph = ClientHash(Name ?? "", password), code }, ct);

    public static Task<JsonNode> PasskeyBegin(string? name, CancellationToken ct = default)
        => Call(HttpMethod.Post, "/v1/passkey/begin", new { name, device = Environment.MachineName }, ct, false);
    public static async Task<string> PasskeyFinish(string id, string clientData, string authenticatorData, string signature, CancellationToken ct = default)
    {
        var r = await Call(HttpMethod.Post, "/v1/passkey/finish", new { id, clientDataJSON = clientData, authenticatorData, signature, device = Environment.MachineName }, ct, false);
        StoreSession(r, (string?)r["name"] ?? "");
        return Name!;
    }
    public static Task<JsonNode> PasskeyAddBegin(CancellationToken ct = default) => Call(HttpMethod.Post, "/v1/passkey/add/begin", new { }, ct);
    public static Task<JsonNode> PasskeyAddFinish(string clientData, string attestationObject, string? name, CancellationToken ct = default)
        => Call(HttpMethod.Post, "/v1/passkey/add/finish", new { clientDataJSON = clientData, attestationObject, name }, ct);
    public static Task<JsonNode> PasskeyRemove(string id, CancellationToken ct = default)
        => Call(HttpMethod.Delete, "/v1/passkey?id=" + Uri.EscapeDataString(id), null, ct);

    public static async Task Logout(CancellationToken ct = default)
    {
        try { if (LoggedIn) await Call(HttpMethod.Post, "/v1/logout", new { }, ct); } catch { }
        lock (L) { var st = Load(); st.Token = null; st.Name = null; Save(st); }
    }

    public static Task<JsonNode> Me(CancellationToken ct = default) => Call(HttpMethod.Get, "/v1/me", null, ct);
    public static Task<JsonNode> ChangePassword(string oldPw, string newPw, CancellationToken ct = default)
    { var n = Name ?? ""; return Call(HttpMethod.Post, "/v1/password", new { old = ClientHash(n, oldPw), ph = ClientHash(n, newPw) }, ct); }
    public static async Task DeleteAccount(string pw, CancellationToken ct = default)
    {
        await Call(HttpMethod.Delete, "/v1/account", new { ph = ClientHash(Name ?? "", pw) }, ct);
        lock (L) Save(new Store());
    }

    public static void MarkDeleted(string uid)
    {
        lock (L) { var st = Load(); if (!st.PendingDeletes.Contains(uid)) st.PendingDeletes.Add(uid); if (!st.Tombstones.Contains(uid)) st.Tombstones.Add(uid); Save(st); }
    }

    private static long Ms(DateTime d) => new DateTimeOffset(DateTime.SpecifyKind(d, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    // ===================================================================== documents

    private static JsonObject InstDoc(Instance i)
    {
        string? Read(string f, int max) { var p = Path.Combine(i.Dir, f); return File.Exists(p) && new FileInfo(p).Length <= max ? File.ReadAllText(p) : null; }
        string? Bin(string f, int max) { var p = Path.Combine(i.Dir, f); return File.Exists(p) && new FileInfo(p).Length <= max ? Convert.ToBase64String(File.ReadAllBytes(p)) : null; }
        var o = JsonSerializer.SerializeToNode(new
        {
            i.Uid, i.Name, i.McVersion, i.Loader, i.LoaderVersion, i.Kind, i.Icon, i.IconUrl, i.BannerUrl, i.Group, i.RamMb, i.JvmArgs, i.Width, i.Height,
            i.PlaySeconds, i.LastPlayed, i.Created, i.ModpackProject, i.ModpackVersion,
            Content = i.Content.Where(c => !string.IsNullOrEmpty(c.ProjectId)).Select(c => new { c.ProjectId, c.VersionId, c.Title, c.Type, c.File, c.IconUrl, c.VersionNumber, c.Dependency, c.Enabled, c.Source }),
        }, Net.J)!.AsObject();
        o["options"] = Read("options.txt", 128_000);
        o["servers"] = Bin("servers.dat", 96_000);
        return o;
    }

    /// <summary>config/ folder as zip (only when small; most mod configs are a few KB).</summary>
    private static string? ConfigZip(Instance i)
    {
        var d = Path.Combine(i.Dir, "config");
        if (!Directory.Exists(d)) return null;
        var files = Directory.GetFiles(d, "*", SearchOption.AllDirectories).Where(f => new FileInfo(f).Length < 256_000).ToList();
        if (files.Count == 0 || files.Sum(f => new FileInfo(f).Length) > 4_000_000) return null;
        using var ms = new MemoryStream();
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, true))
            foreach (var f in files)
            {
                var e = z.CreateEntry(Path.GetRelativePath(d, f).Replace('\\', '/'), CompressionLevel.SmallestSize);
                using var es = e.Open(); using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); fs.CopyTo(es);
            }
        var b64 = Convert.ToBase64String(ms.ToArray());
        return b64.Length < 900_000 ? b64 : null;
    }

    private static void ApplyMeta(Instance i, JsonNode d)
    {
        i.Name = (string?)d["name"] ?? i.Name; i.Icon = (string?)d["icon"] ?? i.Icon; i.IconUrl = (string?)d["iconUrl"]; if (d["bannerUrl"] != null) i.BannerUrl = (string?)d["bannerUrl"]; i.Group = (string?)d["group"];
        i.RamMb = (int?)d["ramMb"] ?? i.RamMb; i.JvmArgs = (string?)d["jvmArgs"]; i.Width = (int?)d["width"] ?? 0; i.Height = (int?)d["height"] ?? 0;
        i.PlaySeconds = Math.Max(i.PlaySeconds, (long?)d["playSeconds"] ?? 0);
        if (d["lastPlayed"] != null && DateTime.TryParse((string?)d["lastPlayed"], null, System.Globalization.DateTimeStyles.RoundtripKind, out var lp) && (i.LastPlayed == null || lp > i.LastPlayed)) i.LastPlayed = lp.ToUniversalTime();
        i.ModpackProject = (string?)d["modpackProject"]; i.ModpackVersion = (string?)d["modpackVersion"];
        var mc = (string?)d["mcVersion"]; var ld = (string?)d["loader"]; var lv = (string?)d["loaderVersion"];
        if (mc != null && (mc != i.McVersion || ld != i.Loader || lv != i.LoaderVersion)) { i.McVersion = mc; i.Loader = ld ?? "vanilla"; i.LoaderVersion = lv; i.VersionId = null; }
        if ((string?)d["options"] is string opt) File.WriteAllText(Path.Combine(i.Dir, "options.txt"), opt);
        if ((string?)d["servers"] is string sv) File.WriteAllBytes(Path.Combine(i.Dir, "servers.dat"), Convert.FromBase64String(sv));
    }

    private static void ApplyConfig(Instance i, string b64)
    {
        var root = Path.GetFullPath(Path.Combine(i.Dir, "config"));
        using var z = new ZipArchive(new MemoryStream(Convert.FromBase64String(b64)));
        foreach (var e in z.Entries)
        {
            if (e.FullName.EndsWith('/')) continue;
            var dst = Path.GetFullPath(Path.Combine(root, e.FullName));
            if (!dst.StartsWith(root + Path.DirectorySeparatorChar)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            e.ExtractToFile(dst, true);
        }
    }

    /// <summary>Content of the cloud copy that is missing or older locally (to download from Modrinth / CurseForge).</summary>
    public record Missing(string Uid, string ProjectId, string VersionId, string Type, string Source, bool Enabled, string Title);

    public record Result(int Pushed, int Pulled, int Created, int Deleted, List<Missing> ToInstall)
    {
        /// <summary>Files that did not fit into the cloud (name and size), shown once in the UI.</summary>
        public List<string> TooBig { get; init; } = new();
    }

    /// <summary>Two-way sync. Newer side wins per instance; content that exists in the cloud copy but not here is returned for download.</summary>
    public static async Task<Result> Sync(Func<string, JsonObject>? settingsDoc, Action<JsonObject>? applySettings, IProgress<Progress>? p, CancellationToken ct = default)
    {
        if (!LoggedIn) throw new InvalidOperationException("Nicht bei Orbit angemeldet.");
        p?.Report(new Progress("Orbit-Cloud wird abgeglichen", 0, 1, Name));
        var idx = (await Call(HttpMethod.Get, "/v1/sync", null, ct))["items"]!.AsArray().ToDictionary(x => (string)x!["k"]!, x => (long)x!["updated"]!);
        int pushed = 0, pulled = 0, created = 0, deleted = 0; var missing = new List<Missing>();
        Store st; lock (L) st = Load();

        // tombstones from this PC
        foreach (var uid in st.PendingDeletes.ToList())
        {
            await Put("inst:" + uid, new JsonObject { ["uid"] = uid, ["deleted"] = true }.ToJsonString(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ct);
            try { await Call(HttpMethod.Delete, "/v1/sync?k=cfg:" + uid, null, ct); } catch { }
            // and its files, so they do not use up the account's space
            foreach (var fk in idx.Keys.Where(x => x == "fbm:" + uid || x.StartsWith($"fbp:{uid}_")).ToList())
                try { await Call(HttpMethod.Delete, "/v1/sync?k=" + fk, null, ct); } catch { }
            try
            {
                foreach (var f in (await Call(HttpMethod.Get, "/v1/files", null, ct))["files"]!.AsArray().Select(x => (string)x!["name"]!).Where(n => n.StartsWith($"fb-{uid}-")))
                    try { await Call(HttpMethod.Delete, "/v1/files/" + f, null, ct); } catch { }
            }
            catch { }
            lock (L) { var s3 = Load(); s3.Bundles.Remove(uid); Save(s3); }
            lock (L) { st = Load(); st.PendingDeletes.Remove(uid); Save(st); }
            deleted++;
        }

        var local = Instances.All().ToDictionary(i => i.Uid);
        // remote docs we need: new instances, newer copies
        var want = idx.Keys.Where(k => k.StartsWith("inst:")).Where(k =>
        {
            var uid = k[5..];
            return local.TryGetValue(uid, out var li) ? idx[k] > Ms(li.Modified) : !st.Tombstones.Contains(uid);
        }).ToList();
        foreach (var chunk in want.Chunk(40))
        {
            var docs = (await Call(HttpMethod.Post, "/v1/sync/get", new { keys = chunk.Concat(chunk.Select(k => "cfg:" + k[5..])).ToArray() }, ct))["items"]!.AsArray();
            var byKey = docs.ToDictionary(d => (string)d!["k"]!, d => d!);
            foreach (var k in chunk)
            {
                if (!byKey.TryGetValue(k, out var row)) continue;
                var d = JsonNode.Parse((string)row["v"]!)!; var uid = k[5..]; var upd = (long)row["updated"]!;
                if ((bool?)d["deleted"] == true)
                {
                    if (local.TryGetValue(uid, out var gone)) { Instances.Delete(gone.Id); lock (L) { st = Load(); st.PendingDeletes.Remove(uid); Save(st); } deleted++; }
                    lock (L) { st = Load(); if (!st.Tombstones.Contains(uid)) st.Tombstones.Add(uid); Save(st); }
                    continue;
                }
                if (!local.TryGetValue(uid, out var inst))
                {
                    inst = Instances.Create((string?)d["name"] ?? "Instanz", (string)d["mcVersion"]!, (string?)d["loader"] ?? "vanilla", (string?)d["loaderVersion"], (string?)d["kind"] ?? "custom");
                    inst.Uid = uid; created++;
                    if (DateTime.TryParse((string?)d["created"], null, System.Globalization.DateTimeStyles.RoundtripKind, out var cr)) inst.Created = cr.ToUniversalTime();
                }
                ApplyMeta(inst, d);
                if (byKey.TryGetValue("cfg:" + uid, out var cfg)) try { ApplyConfig(inst, (string)cfg["v"]!); } catch { }
                foreach (var c in d["content"]?.AsArray() ?? new JsonArray())
                {
                    if (c == null) continue;
                    var pid = (string?)c["projectId"]; if (string.IsNullOrEmpty(pid)) continue;
                    var vid = (string?)c["versionId"] ?? ""; var have = inst.Content.FirstOrDefault(x => x.ProjectId == pid);
                    if (have != null && have.VersionId == vid && File.Exists(Path.Combine(Instances.ContentDir(inst, have.Type), have.File + (have.Enabled ? "" : ".disabled")))) continue;
                    missing.Add(new Missing(uid, pid, vid, (string?)c["type"] ?? "mod", (string?)c["source"] ?? "modrinth", (bool?)c["enabled"] ?? true, (string?)c["title"] ?? pid));
                }
                inst.Modified = DateTimeOffset.FromUnixTimeMilliseconds(upd).UtcDateTime;
                Instances.Save(inst, touch: false);
                pulled++;
            }
        }

        // push local instances that are newer than the cloud copy
        foreach (var i in Instances.All())
        {
            ct.ThrowIfCancellationRequested();
            var k = "inst:" + i.Uid; var ms = Ms(i.Modified);
            if (idx.TryGetValue(k, out var ru) && ru >= ms) continue;
            if (missing.Any(m => m.Uid == i.Uid)) continue;   // still being restored here
            await Put(k, InstDoc(i).ToJsonString(), ms, ct);
            pushed++;
        }

        // ---- files: configs, scripts, shader settings, own mods and packs (everything the catalogs cannot restore)
        var tooBig = new List<string>();
        try { (int up, int down) = await SyncBundles(idx, missing, tooBig, p, ct); pushed += up; pulled += down; }
        catch (OperationCanceledException) { throw; }
        catch (Exception e) { tooBig.Add("Dateien: " + e.Message); }

        // launcher settings + Orbit Client config + skins: newer side wins
        foreach (var (key, local2) in new[] { ("settings", settingsDoc?.Invoke("settings")), ("orbitcfg", settingsDoc?.Invoke("orbitcfg")), ("skins", settingsDoc?.Invoke("skins")) })
        {
            if (local2 == null) continue;
            var lt = (long?)local2["_at"] ?? 0;
            if (idx.TryGetValue(key, out var rt) && rt > lt)
            {
                var row = (await Call(HttpMethod.Post, "/v1/sync/get", new { keys = new[] { key } }, ct))["items"]!.AsArray().FirstOrDefault();
                if (row != null && JsonNode.Parse((string)row["v"]!) is JsonObject o) { o["_key"] = key; o["_at"] = rt; applySettings?.Invoke(o); pulled++; }
            }
            else if (!idx.ContainsKey(key) || lt > idx[key]) { local2.Remove("_at"); await Put(key, local2.ToJsonString(), Math.Max(lt, 1), ct); pushed++; }
        }

        lock (L) { st = Load(); st.LastSync = DateTime.UtcNow; Save(st); }
        return new Result(pushed, pulled, created, deleted, missing) { TooBig = tooBig };
    }

    // ===================================================================== file bundles
    // One zip per instance with everything the catalogs cannot bring back. Stored in ~950 KB parts
    // ("fbp:<uid>_<n>") plus a manifest ("fbm:<uid>"). Only uploaded when the files changed.

    private const int PartChars = 950_000;
    private const long AccountBytes = 39_000_000;       // item store (small values); bundles go to the file store (R2) when the server has one
    private static readonly string[] TreeDirs = { "config", "defaultconfigs", "kubejs", "scripts", "global_packs", "datapacks", "patchouli_books", "openloader", "paxi", "resources" };
    private static readonly HashSet<string> JunkFiles = new(StringComparer.OrdinalIgnoreCase) { ".gitignore", ".gitattributes", ".gitmodules", ".DS_Store", "Thumbs.db", "desktop.ini", ".editorconfig" };
    private static readonly HashSet<string> RootSkip = new(StringComparer.OrdinalIgnoreCase) { "instance.json", "usercache.json", "usernamecache.json", "options.txt", "servers.dat", "launcher_profiles.json", "minecraftinstance.json", "profile.json" };

    /// <summary>Files of the bundle: (relative path, full path, size, must = settings/scripts, false = own mods/packs).</summary>
    private static List<(string rel, string full, long size, bool must)> BundleFiles(Instance i)
    {
        var r = new List<(string, string, long, bool)>();
        void Add(string full, bool must)
        {
            var fi = new FileInfo(full);
            if (!fi.Exists) return;
            var rel = Path.GetRelativePath(i.Dir, full).Replace('\\', '/');
            if (rel.Contains("/.cache/") || rel.Contains("/cache/") || rel.StartsWith("kubejs/exported/") || rel.EndsWith(".log") || rel.EndsWith(".lock")) return;
            var fn = Path.GetFileName(rel);
            if (JunkFiles.Contains(fn) || rel.Contains("/.git/") || rel.Contains("/.github/") || rel.Contains("/__MACOSX/")) return;
            if (fi.Length > (must ? 8_000_000 : 30_000_000)) return;
            r.Add((rel, full, fi.Length, must));
        }
        foreach (var d in TreeDirs)
        {
            var dir = Path.Combine(i.Dir, d);
            if (Directory.Exists(dir)) foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)) Add(f, true);
        }
        // small settings files in the instance root (optionsof.txt, optionsshaders.txt, mod configs some packs keep there)
        foreach (var f in Directory.EnumerateFiles(i.Dir))
        {
            var n = Path.GetFileName(f);
            if (RootSkip.Contains(n) || n.StartsWith("hs_err") || new FileInfo(f).Length > 512_000) continue;
            if (n.EndsWith(".txt") || n.EndsWith(".json") || n.EndsWith(".json5") || n.EndsWith(".properties") || n.EndsWith(".toml") || n.EndsWith(".cfg")) Add(f, true);
        }
        // shader settings next to the shader packs
        var sp = Path.Combine(i.Dir, "shaderpacks");
        if (Directory.Exists(sp)) foreach (var f in Directory.EnumerateFiles(sp, "*.txt")) Add(f, true);
        // own mods / packs: everything not restorable from Modrinth or CurseForge
        var known = new HashSet<string>(i.Content.Where(c => !string.IsNullOrEmpty(c.ProjectId)).Select(c => Instances.EnabledName(c.File)), StringComparer.OrdinalIgnoreCase);
        foreach (var (type, sub) in new[] { ("mod", "mods"), ("resourcepack", "resourcepacks"), ("shader", "shaderpacks") })
        {
            var dir = Path.Combine(i.Dir, sub);
            if (!Directory.Exists(dir)) continue;
            foreach (var e in Directory.EnumerateFileSystemEntries(dir))
            {
                if (!Instances.IsListedContent(type, e) || known.Contains(Instances.EnabledName(e))) continue;
                if (Directory.Exists(e)) { foreach (var f in Directory.EnumerateFiles(e, "*", SearchOption.AllDirectories)) Add(f, false); }
                else Add(e, false);
            }
        }
        return r.OrderBy(x => x.Item1, StringComparer.Ordinal).ToList();
    }

    private static string Signature(IEnumerable<(string rel, string full, long size, bool must)> files)
    {
        var sb = new StringBuilder();
        foreach (var f in files) sb.Append(f.rel).Append('|').Append(f.size).Append('|').Append(File.GetLastWriteTimeUtc(f.full).Ticks).Append('\n');
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())))[..32].ToLowerInvariant();
    }

    private static byte[] Zip(IEnumerable<(string rel, string full, long size, bool must)> files)
    {
        using var ms = new MemoryStream();
        ZipTo(ms, files);
        return ms.ToArray();
    }
    private static void ZipTo(Stream ms, IEnumerable<(string rel, string full, long size, bool must)> files)
    {
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, true))
            foreach (var f in files)
            {
                try
                {
                    var ext = Path.GetExtension(f.rel).ToLowerInvariant();
                    var e = z.CreateEntry(f.rel, ext is ".jar" or ".zip" or ".png" or ".ogg" ? CompressionLevel.NoCompression : CompressionLevel.SmallestSize);
                    e.LastWriteTime = File.GetLastWriteTime(f.full);
                    using var es = e.Open(); using var fs = new FileStream(f.full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); fs.CopyTo(es);
                }
                catch (IOException) { }
            }
    }

    // ---------------- file store (R2): bundles as zip parts "fb-<uid>-<n>.zip"
    private const int FilePart = 40_000_000;
    private static string FileName(string uid, int n) => $"fb-{uid}-{n}.zip";
    private static async Task<HttpResponseMessage> Raw(HttpMethod m, string path, HttpContent? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(m, Api.TrimEnd('/') + path) { Content = body };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token() ?? throw new InvalidOperationException("Nicht bei Orbit angemeldet."));
        Access.Sign(req);
        var r = await Net.Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!r.IsSuccessStatusCode)
        {
            JsonNode? j = null; try { j = JsonNode.Parse(await r.Content.ReadAsStringAsync(ct)); } catch { }
            r.Dispose();
            throw new InvalidOperationException((string?)j?["error"] ?? $"Orbit-Cloud nicht erreichbar ({(int)r.StatusCode})");
        }
        return r;
    }

    private static async Task<(int up, int down)> SyncBundles(Dictionary<string, long> idx, List<Missing> restoring, List<string> tooBig, IProgress<Progress>? p, CancellationToken ct)
    {
        int up = 0, down = 0;
        Store st; lock (L) st = Load();
        var sizes = (await Call(HttpMethod.Get, "/v1/sync", null, ct))["items"]!.AsArray().ToDictionary(x => (string)x!["k"]!, x => (long?)x!["size"] ?? 0);
        // the big file store (R2); older servers have none, then bundles go into the small item store as before
        long fileMax = 0; var fsizes = new Dictionary<string, long>();
        try
        {
            var fl = await Call(HttpMethod.Get, "/v1/files", null, ct);
            fileMax = (long?)fl["max"] ?? 0;
            foreach (var f in fl["files"]!.AsArray()) fsizes[(string)f!["name"]!] = (long?)f["size"] ?? 0;
        }
        catch { }
        foreach (var i in Instances.All())
        {
            ct.ThrowIfCancellationRequested();
            var files = await Task.Run(() => BundleFiles(i), ct);
            var sig = Signature(files);
            st.Bundles.TryGetValue(i.Uid, out var have);
            JsonNode? man = null;
            if (idx.ContainsKey("fbm:" + i.Uid))
            {
                var row = (await Call(HttpMethod.Post, "/v1/sync/get", new { keys = new[] { "fbm:" + i.Uid } }, ct))["items"]!.AsArray().FirstOrDefault();
                if (row != null) man = JsonNode.Parse((string)row["v"]!);
            }
            var remoteId = (string?)man?["id"];
            var localChanged = have == null ? man == null && files.Count > 0 : have.Sig != sig;

            // pull: the cloud has a newer bundle and nothing changed here since the last sync
            if (!localChanged && remoteId != null && remoteId != have?.Id)
            {
                p?.Report(new Progress("Dateien werden geladen", 0, 1, i.Name));
                var parts = (int?)man!["parts"] ?? 0;
                if ((string?)man["store"] == "files")
                {
                    var tmp = Path.Combine(Paths.Cache, $"fb-{i.Uid}.zip");
                    Directory.CreateDirectory(Paths.Cache);
                    try
                    {
                        await using (var o = File.Create(tmp))
                            for (var n = 0; n < parts; n++)
                            {
                                p?.Report(new Progress("Dateien werden geladen", n, parts, i.Name));
                                using var r = await Raw(HttpMethod.Get, "/v1/files/" + FileName(i.Uid, n), null, ct);
                                await (await r.Content.ReadAsStreamAsync(ct)).CopyToAsync(o, ct);
                            }
                        string h; await using (var fs = File.OpenRead(tmp)) h = Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(fs, ct));
                        if ((string?)man["hash"] == h)
                        {
                            await Task.Run(() => { using var fs = File.OpenRead(tmp); Extract(i, fs); }, ct);
                            st.Bundles[i.Uid] = new BundleState { Id = remoteId, Sig = Signature(BundleFiles(i)) };
                            lock (L) { var s2 = Load(); s2.Bundles = st.Bundles; Save(s2); }
                            down++;
                        }
                    }
                    finally { try { File.Delete(tmp); } catch { } }
                    continue;
                }
                var sb = new StringBuilder();
                var keys = Enumerable.Range(0, parts).Select(n => $"fbp:{i.Uid}_{n}").ToList();
                var got = new Dictionary<string, string>();
                foreach (var chunk in keys.Chunk(6))
                    foreach (var row in (await Call(HttpMethod.Post, "/v1/sync/get", new { keys = chunk }, ct))["items"]!.AsArray())
                        got[(string)row!["k"]!] = (string)row["v"]!;
                if (keys.All(got.ContainsKey))
                {
                    foreach (var k in keys) sb.Append(got[k]);
                    var zip = Convert.FromBase64String(sb.ToString());
                    if ((string?)man["hash"] == Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(zip)))
                    {
                        await Task.Run(() => Extract(i, zip), ct);
                        st.Bundles[i.Uid] = new BundleState { Id = remoteId, Sig = Signature(BundleFiles(i)) };
                        lock (L) { var s2 = Load(); s2.Bundles = st.Bundles; Save(s2); }
                        down++;
                    }
                }
                continue;
            }
            if (!localChanged || restoring.Any(m => m.Uid == i.Uid)) continue;

            // push: everything that fits into the account; own mods/packs only while there is room
            p?.Report(new Progress("Dateien werden gesichert", 0, 1, i.Name));
            if (fileMax > 0)
            {
                var mineF = fsizes.Where(x => x.Key.StartsWith($"fb-{i.Uid}-")).Sum(x => x.Value);
                var roomF = fileMax - (fsizes.Values.Sum() - mineF);
                var pickF = files.Where(f => f.must).ToList();
                static string UnitF(string rel) { var parts = rel.Split('/'); return parts.Length > 2 ? parts[0] + "/" + parts[1] : rel; }
                foreach (var u in files.Where(f => !f.must).GroupBy(f => UnitF(f.rel)).Select(g => (key: g.Key, files: g.ToList(), size: g.Sum(x => x.size))).OrderBy(u => u.size))
                {
                    if (pickF.Sum(x => x.size) + u.size + 2_000_000 < roomF) { pickF.AddRange(u.files); continue; }
                    var kind = u.key.StartsWith("shaderpacks/") ? "Shader" : u.key.StartsWith("resourcepacks/") ? "Ressourcenpaket" : "Mod";
                    tooBig.Add($"{i.Name}: {kind} „{Path.GetFileName(u.key)}“ ({u.size / 1048576.0:0.#} MB)");
                }
                var tmp = Path.Combine(Paths.Cache, $"fb-{i.Uid}-up.zip");
                Directory.CreateDirectory(Paths.Cache);
                try
                {
                    await Task.Run(() => { using var o = File.Create(tmp); ZipTo(o, pickF); }, ct);
                    var len = new FileInfo(tmp).Length;
                    if (len + 1_000_000 > roomF) { tooBig.Add($"{i.Name}: Configs und Skripte ({len / 1048576.0:0.#} MB)"); continue; }
                    var cnt = (int)((len + FilePart - 1) / FilePart);
                    var buf = new byte[(int)Math.Min(FilePart, Math.Max(1, len))];
                    await using (var fs = File.OpenRead(tmp))
                        for (var n = 0; n < cnt; n++)
                        {
                            ct.ThrowIfCancellationRequested();
                            p?.Report(new Progress("Dateien werden gesichert", n, cnt, i.Name));
                            var got = 0; int r0;
                            while (got < buf.Length && (r0 = await fs.ReadAsync(buf.AsMemory(got, buf.Length - got), ct)) > 0) got += r0;
                            using var res = await Raw(HttpMethod.Put, "/v1/files/" + FileName(i.Uid, n), new ByteArrayContent(buf, 0, got), ct);
                            fsizes[FileName(i.Uid, n)] = got;
                        }
                    // leftovers: parts of an older, bigger bundle and the old copy in the small store
                    foreach (var old in fsizes.Keys.Where(k => k.StartsWith($"fb-{i.Uid}-") && int.TryParse(k[(k.LastIndexOf('-') + 1)..^4], out var n) && n >= cnt).ToList())
                    { try { await Call(HttpMethod.Delete, "/v1/files/" + old, null, ct); } catch { } fsizes.Remove(old); }
                    foreach (var old in sizes.Keys.Where(k => k.StartsWith($"fbp:{i.Uid}_")).ToList())
                    { try { await Call(HttpMethod.Delete, "/v1/sync?k=" + old, null, ct); } catch { } sizes.Remove(old); }
                    string hashF; await using (var fs = File.OpenRead(tmp)) hashF = Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(fs, ct));
                    var atF = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    await Put("fbm:" + i.Uid, new JsonObject { ["id"] = sig, ["store"] = "files", ["parts"] = cnt, ["hash"] = hashF, ["size"] = len, ["files"] = pickF.Count, ["at"] = atF }.ToJsonString(), atF, ct);
                    st.Bundles[i.Uid] = new BundleState { Id = sig, Sig = sig };
                    lock (L) { var s2 = Load(); s2.Bundles = st.Bundles; Save(s2); }
                    up++;
                }
                finally { try { File.Delete(tmp); } catch { } }
                continue;
            }
            var mine = sizes.Where(x => x.Key.StartsWith($"fbp:{i.Uid}_") || x.Key == "fbm:" + i.Uid).Sum(x => x.Value);
            var room = AccountBytes - (sizes.Values.Sum() - mine);
            var pick = files.Where(f => f.must).ToList();
            // a folder pack (e.g. an unpacked shader) only works complete: treat it as one unit
            static string Unit(string rel) { var parts = rel.Split('/'); return parts.Length > 2 ? parts[0] + "/" + parts[1] : rel; }
            var units = files.Where(f => !f.must).GroupBy(f => Unit(f.rel)).Select(g => (key: g.Key, files: g.ToList(), size: g.Sum(x => x.size))).OrderBy(u => u.size);
            foreach (var u in units)
            {
                if ((pick.Sum(x => x.size) + u.size) * 4 / 3 + 200_000 < room) { pick.AddRange(u.files); continue; }
                var kind = u.key.StartsWith("shaderpacks/") ? "Shader" : u.key.StartsWith("resourcepacks/") ? "Ressourcenpaket" : "Mod";
                tooBig.Add($"{i.Name}: {kind} „{Path.GetFileName(u.key)}“ ({u.size / 1048576.0:0.#} MB)");
            }
            var data = await Task.Run(() => Zip(pick), ct);
            var b64 = Convert.ToBase64String(data);
            if (b64.Length + 100_000 > room) { tooBig.Add($"{i.Name}: Configs und Skripte ({data.Length / 1048576.0:0.#} MB)"); continue; }
            var count = (b64.Length + PartChars - 1) / PartChars;
            var at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            for (var n = 0; n < count; n++)
            {
                ct.ThrowIfCancellationRequested();
                await Put($"fbp:{i.Uid}_{n}", b64.Substring(n * PartChars, Math.Min(PartChars, b64.Length - n * PartChars)), at, ct);
            }
            // parts of an older, bigger bundle
            foreach (var old in sizes.Keys.Where(k => k.StartsWith($"fbp:{i.Uid}_") && int.TryParse(k[(k.LastIndexOf('_') + 1)..], out var n) && n >= count).ToList())
                try { await Call(HttpMethod.Delete, "/v1/sync?k=" + old, null, ct); } catch { }
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(data));
            var id = sig;
            await Put("fbm:" + i.Uid, new JsonObject { ["id"] = id, ["parts"] = count, ["hash"] = hash, ["size"] = data.Length, ["files"] = pick.Count, ["at"] = at }.ToJsonString(), at, ct);
            st.Bundles[i.Uid] = new BundleState { Id = id, Sig = sig };
            lock (L) { var s2 = Load(); s2.Bundles = st.Bundles; Save(s2); }
            up++;
        }
        return (up, down);
    }

    private static void Extract(Instance i, byte[] zip) => Extract(i, new MemoryStream(zip));
    private static void Extract(Instance i, Stream zip)
    {
        var root = Path.GetFullPath(i.Dir);
        using var z = new ZipArchive(zip);
        foreach (var e in z.Entries)
        {
            if (e.FullName.EndsWith('/')) continue;
            var dst = Path.GetFullPath(Path.Combine(root, e.FullName));
            if (!dst.StartsWith(root + Path.DirectorySeparatorChar) || RootSkip.Contains(Path.GetFileName(dst)) && Path.GetDirectoryName(dst) == root) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            try { e.ExtractToFile(dst, true); File.SetLastWriteTime(dst, e.LastWriteTime.DateTime); } catch (IOException) { }
        }
    }

    private static async Task Put(string k, string v, long updated, CancellationToken ct)
    {
        if (v.Length > 1_000_000) return;
        await Call(HttpMethod.Put, "/v1/sync", new { k, v, updated }, ct);
    }

    /// <summary>Downloads content the cloud copy has (exact versions) into the local instance.</summary>
    public static async Task<(int ok, List<string> failed)> Restore(List<Missing> list, IProgress<Progress>? p, CancellationToken ct = default)
    {
        int ok = 0; var failed = new List<string>();
        foreach (var g in list.GroupBy(m => m.Uid))
        {
            var inst = Instances.All().FirstOrDefault(i => i.Uid == g.Key); if (inst == null) continue;
            int n = 0;
            foreach (var m in g)
            {
                p?.Report(new Progress("Cloud: " + inst.Name, ++n, g.Count(), m.Title));
                try
                {
                    inst = Instances.Get(inst.Id)!;
                    if (m.Source == "curseforge" || m.ProjectId.StartsWith("cf:")) await CurseForge.Install(inst, int.Parse(m.ProjectId[3..]), int.TryParse(m.VersionId, out var f) ? f : null, p, ct);
                    else await Modrinth.Install(inst, m.ProjectId, m.Type, string.IsNullOrEmpty(m.VersionId) ? null : m.VersionId, p, ct);
                    if (!m.Enabled) { inst = Instances.Get(inst.Id)!; var c = inst.Content.FirstOrDefault(x => x.ProjectId == m.ProjectId); if (c != null) Instances.Toggle(inst, c.Type, c.File, false); }
                    ok++;
                }
                catch (Exception e) when (e is not OperationCanceledException) { failed.Add(m.Title); }
            }
        }
        return (ok, failed);
    }
}
