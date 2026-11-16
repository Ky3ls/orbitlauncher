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
    }
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

    public record Result(int Pushed, int Pulled, int Created, int Deleted, List<Missing> ToInstall);

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
            var cz = ConfigZip(i);
            if (cz != null) try { await Put("cfg:" + i.Uid, cz, ms, ct); } catch { }
            pushed++;
        }

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
        return new Result(pushed, pulled, created, deleted, missing);
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
