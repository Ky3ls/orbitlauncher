using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>
/// Skin library (local PNGs) plus the official Minecraft Services profile API to apply skins and capes.
/// Only the account's own token is used; nothing goes anywhere except api.minecraftservices.com.
/// </summary>
public static class Skins
{
    public class Entry
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        /// <summary>classic | slim</summary>
        public string Variant { get; set; } = "classic";
        public DateTime Added { get; set; } = DateTime.UtcNow;
    }

    private const string ProfileApi = "https://api.minecraftservices.com/minecraft/profile";
    private static string Dir => Paths.Dir("skins");
    private static string IndexFile => Path.Combine(Dir, "index.json");

    public static List<Entry> All() => Net.LoadJson<List<Entry>>(IndexFile) ?? new();
    private static void SaveAll(List<Entry> l) => Net.SaveJson(IndexFile, l);
    public static string FileOf(string id) => Path.Combine(Dir, Path.GetFileName(id) + ".png");
    public static string DataUrl(string id) => "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(FileOf(id)));

    /// <summary>Checks the PNG header and size (64×64 or legacy 64×32).</summary>
    public static void Validate(byte[] png, string? variant = null)
    {
        if (png.Length < 24 || png[0] != 0x89 || png[1] != 'P' || png[2] != 'N' || png[3] != 'G') throw new InvalidOperationException("Das ist keine PNG-Datei.");
        if (png.Length > 1024 * 1024) throw new InvalidOperationException("Die Datei ist zu groß.");
        int w = png[16] << 24 | png[17] << 16 | png[18] << 8 | png[19];
        int h = png[20] << 24 | png[21] << 16 | png[22] << 8 | png[23];
        if (w != 64 || (h != 64 && h != 32)) throw new InvalidOperationException($"Skins müssen 64×64 Pixel groß sein (diese Datei: {w}×{h}).");
        // the base layer is the body itself: it may not be see-through (an invisible player is not allowed)
        var holes = BaseHoles(png, variant);
        if (holes > 0.05) throw new InvalidOperationException(holes > 0.9
            ? "Dieser Skin ist unsichtbar. Die Basis-Schicht muss komplett ausgemalt sein."
            : $"Die Basis-Schicht ist zu {Math.Round(holes * 100)} % durchsichtig. Sie muss komplett ausgemalt sein, nur der Überzug darf Lücken haben.");
    }

    /// <summary>Faces of the base layer the game draws ([x, y, w, h] in the texture). Arms only when the variant is known.</summary>
    public static IEnumerable<(int x, int y, int w, int h)> BaseFaces(bool legacy, string? variant)
    {
        var parts = new List<(int u, int v, int w, int h, int d)> { (0, 0, 8, 8, 8), (16, 16, 8, 12, 4), (0, 16, 4, 12, 4) };
        if (!legacy) parts.Add((16, 48, 4, 12, 4));
        if (variant is "classic" or "slim")
        {
            var aw = variant == "slim" ? 3 : 4;
            parts.Add((40, 16, aw, 12, 4));
            if (!legacy) parts.Add((32, 48, aw, 12, 4));
        }
        foreach (var (u, v, w, h, d) in parts)
        {
            yield return (u + d, v, w, d); yield return (u + d + w, v, w, d);
            yield return (u, v + d, d, h); yield return (u + d, v + d, w, h); yield return (u + d + w, v + d, d, h); yield return (u + 2 * d + w, v + d, w, h);
        }
    }

    /// <summary>Share (0..1) of base layer pixels that are fully transparent. 0 when the PNG cannot be read here.</summary>
    public static double BaseHoles(byte[] png, string? variant)
    {
        var a = Alpha(png); if (a == null) return 0;
        var (alpha, h) = a.Value; int total = 0, holes = 0;
        foreach (var (x, y, w, fh) in BaseFaces(h == 32, variant))
            for (var j = y; j < y + fh; j++) for (var i = x; i < x + w; i++) { total++; if (alpha[j * 64 + i] == 0) holes++; }
        return total == 0 ? 0 : (double)holes / total;
    }

    /// <summary>Alpha of every pixel of a 64-wide 8-bit PNG (null for formats this small reader does not handle).</summary>
    private static (byte[] alpha, int h)? Alpha(byte[] png)
    {
        try
        {
            int W = 64, H = png[20] << 24 | png[21] << 16 | png[22] << 8 | png[23];
            int depth = png[24], type = png[25], interlace = png[28];
            if (depth != 8 || interlace != 0) return null;
            int ch = type switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => 0 }; if (ch == 0) return null;
            byte[]? trns = null; using var idat = new MemoryStream();
            for (var p = 8; p + 8 <= png.Length;)
            {
                int len = png[p] << 24 | png[p + 1] << 16 | png[p + 2] << 8 | png[p + 3];
                var t = System.Text.Encoding.ASCII.GetString(png, p + 4, 4);
                if (len < 0 || p + 12 + len > png.Length) break;
                if (t == "IDAT") idat.Write(png, p + 8, len);
                else if (t == "tRNS") trns = png[(p + 8)..(p + 8 + len)];
                else if (t == "IEND") break;
                p += 12 + len;
            }
            idat.Position = 0;
            using var z = new System.IO.Compression.ZLibStream(idat, System.IO.Compression.CompressionMode.Decompress);
            int stride = W * ch; var raw = new byte[(stride + 1) * H]; int read = 0, n;
            while (read < raw.Length && (n = z.Read(raw, read, raw.Length - read)) > 0) read += n;
            if (read < raw.Length) return null;
            var cur = new byte[stride]; var prev = new byte[stride]; var alpha = new byte[W * H];
            for (var y = 0; y < H; y++)
            {
                int f = raw[y * (stride + 1)], o = y * (stride + 1) + 1;
                for (var i = 0; i < stride; i++)
                {
                    int x = raw[o + i], l = i >= ch ? cur[i - ch] : 0, up = prev[i], ul = i >= ch ? prev[i - ch] : 0;
                    cur[i] = (byte)(f switch
                    {
                        1 => x + l, 2 => x + up, 3 => x + ((l + up) >> 1),
                        4 => x + Paeth(l, up, ul), _ => x,
                    });
                }
                for (var i = 0; i < W; i++)
                    alpha[y * W + i] = type switch
                    {
                        6 => cur[i * 4 + 3], 4 => cur[i * 2 + 1],
                        3 => trns != null && cur[i] < trns.Length ? trns[cur[i]] : (byte)255,
                        _ => 255,
                    };
                (prev, cur) = (cur, prev);
            }
            return (alpha, H);
        }
        catch { return null; }
    }
    private static int Paeth(int a, int b, int c) { int p = a + b - c, pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

    public static Entry Add(byte[] png, string name, string variant, string? id = null)
    {
        Validate(png, variant);
        var l = All();
        var e = new Entry { Id = id != null && System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-z0-9]{6,32}$") ? id : Guid.NewGuid().ToString("N")[..12], Name = string.IsNullOrWhiteSpace(name) ? "Skin" : name.Trim(), Variant = variant == "slim" ? "slim" : "classic" };
        File.WriteAllBytes(FileOf(e.Id), png);
        l.Insert(0, e);
        SaveAll(l);
        return e;
    }

    public static void Update(string id, string? name, string? variant)
    {
        var l = All();
        var e = l.FirstOrDefault(x => x.Id == id) ?? throw new InvalidOperationException("Skin nicht gefunden");
        if (!string.IsNullOrWhiteSpace(name)) e.Name = name.Trim();
        if (variant is "classic" or "slim") e.Variant = variant;
        SaveAll(l);
    }

    public static void Remove(string id)
    {
        var l = All();
        l.RemoveAll(x => x.Id == id);
        SaveAll(l);
        try { File.Delete(FileOf(id)); } catch { }
    }

    /// <summary>Downloads a texture from Mojang's texture server (only that host is allowed).</summary>
    public static async Task<byte[]> Texture(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url.Replace("http://", "https://"), UriKind.Absolute, out var u) || u.Host != "textures.minecraft.net") throw new InvalidOperationException("Ungültige Textur-Adresse");
        return await Net.Http.GetByteArrayAsync(u, ct);
    }

    public static async Task<JsonNode> Profile(string token, CancellationToken ct = default)
    {
        var p = await Net.GetAuth(ProfileApi, token, ct);
        Seen(p);
        return p;
    }

    // ---------------- history: every skin the launcher saw active on an account (Mojang keeps no history itself)
    public class Worn
    {
        public string Uuid { get; set; } = "";
        public string Url { get; set; } = "";
        /// <summary>classic | slim</summary>
        public string Variant { get; set; } = "classic";
        public DateTime From { get; set; } = DateTime.UtcNow;
        public DateTime Last { get; set; } = DateTime.UtcNow;
        /// <summary>Other launcher it was found in (null: seen on the account by OrbitLauncher).</summary>
        public string? Source { get; set; }
        public string? Name { get; set; }
    }
    private static readonly object HL = new();
    private static string HistoryFile => Path.Combine(Dir, "history.json");
    private static string HistoryDir => Paths.Dir(Path.Combine("skins", "history"));
    public static List<Worn> History() { lock (HL) return Net.LoadJson<List<Worn>>(HistoryFile) ?? new(); }

    /// <summary>Notes the active skin of a profile answer ({id, skins[]}).</summary>
    public static void Seen(JsonNode? profile)
    {
        try
        {
            var s = profile?["skins"]?.AsArray().FirstOrDefault(x => (string?)x!["state"] == "ACTIVE");
            Seen((string?)profile?["id"], (string?)s?["url"], (string?)s?["variant"]);
        }
        catch { }
    }
    public static void Seen(string? uuid, string? url, string? variant)
    {
        if (string.IsNullOrEmpty(uuid) || string.IsNullOrEmpty(url)) return;
        url = url.Replace("http://", "https://");
        var v = string.Equals(variant, "slim", StringComparison.OrdinalIgnoreCase) ? "slim" : "classic";
        lock (HL)
        {
            var l = Net.LoadJson<List<Worn>>(HistoryFile) ?? new();
            var last = l.Where(x => x.Uuid == uuid && x.Source == null).OrderByDescending(x => x.Last).FirstOrDefault();
            if (last != null && last.Url == url) { last.Last = DateTime.UtcNow; last.Variant = v; }
            else l.Add(new Worn { Uuid = uuid, Url = url, Variant = v });
            Net.SaveJson(HistoryFile, l);
        }
        _ = KeepTexture(url);
    }

    /// <summary>Keeps a copy of the texture, so old skins still show if the address stops working.</summary>
    private static async Task KeepTexture(string url)
    {
        try
        {
            var f = Path.Combine(HistoryDir, Path.GetFileName(new Uri(url).AbsolutePath) + ".png");
            if (File.Exists(f)) return;
            var png = await Texture(url);
            Validate(png);
            await File.WriteAllBytesAsync(f, png);
        }
        catch { }
    }

    /// <summary>The history of one account, newest first, with a local copy of each texture when there is one.</summary>
    public static List<object> HistoryOf(string uuid)
    {
        // own sightings first (newest on top), then what other launchers had
        var l = History().Where(x => x.Uuid == uuid).OrderBy(x => x.Source == null ? 0 : 1).ThenByDescending(x => x.Last).ToList();
        return l.Select((x, i) =>
        {
            var f = Path.Combine(HistoryDir, HashOf(x.Url) + ".png");
            var url = File.Exists(f) ? "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(f)) : x.Url;
            return (object)new { key = KeyOf(x), url, texture = x.Url.StartsWith("local:") ? null : x.Url, variant = x.Variant, from = x.From, last = x.Last, active = i == 0 && x.Source == null, source = x.Source, name = x.Name };
        }).ToList();
    }

    // the same skin can be worn more than once: the key includes when
    private static string KeyOf(Worn x) => HashOf(x.Url) + "_" + x.From.Ticks;
    private static string HashOf(string url) => url.StartsWith("local:") ? url[6..] : Path.GetFileName(new Uri(url).AbsolutePath);

    // ---------------- older skins from other launchers on this PC (Mojang has no history API)
    private static string ImportedFile => Path.Combine(Dir, "history-imported.json");

    /// <summary>Adds skins from the Minecraft Launcher's skin library and the Modrinth App to the account's history.
    /// Every skin is taken once; removed ones do not come back.</summary>
    private static readonly HashSet<string> ImportRan = new();
    public static int ImportOld(string uuid)
    {
        lock (ImportRan) if (!ImportRan.Add(uuid)) return 0;   // once per start: the Modrinth database can be large
        var done = Net.LoadJson<HashSet<string>>(ImportedFile) ?? new();
        var found = new List<(string hash, byte[] png, string variant, DateTime when, string source, string? name, string? texture)>();
        try { found.AddRange(FromOfficial()); } catch { }
        try { found.AddRange(FromModrinth(uuid)); } catch { }
        var n = 0;
        lock (HL)
        {
            var l = Net.LoadJson<List<Worn>>(HistoryFile) ?? new();
            foreach (var f in found)
            {
                if (!done.Add(uuid + "|" + f.hash)) continue;
                if (l.Any(x => x.Uuid == uuid && HashOf(x.Url) == f.hash)) continue;
                try { Validate(f.png, f.variant); } catch { continue; }
                try { var file = Path.Combine(HistoryDir, f.hash + ".png"); if (!File.Exists(file)) File.WriteAllBytes(file, f.png); } catch { continue; }
                l.Add(new Worn { Uuid = uuid, Url = f.texture ?? "local:" + f.hash, Variant = f.variant, From = f.when, Last = f.when, Source = f.source, Name = f.name });
                n++;
            }
            Net.SaveJson(HistoryFile, l);
        }
        Net.SaveJson(ImportedFile, done);
        return n;
    }

    private static string Sha(byte[] b) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(b))[..40].ToLowerInvariant();

    /// <summary>launcher_custom_skins.json of the official launcher (normal and Microsoft Store install).</summary>
    private static IEnumerable<(string, byte[], string, DateTime, string, string?, string?)> FromOfficial()
    {
        var dirs = new[]
        {
            OfficialLauncher.McDir,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages", "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "LocalCache", "Roaming", ".minecraft"),
        };
        foreach (var d in dirs)
        {
            var f = Path.Combine(d, "launcher_custom_skins.json");
            if (!File.Exists(f)) continue;
            JsonNode? j; try { j = JsonNode.Parse(File.ReadAllText(f)); } catch { continue; }
            if (j?["customSkins"] is not JsonObject all) continue;
            foreach (var (_, s) in all)
            {
                var img = (string?)s?["skinImage"]; if (img == null || !img.Contains(',')) continue;
                byte[] png; try { png = Convert.FromBase64String(img[(img.IndexOf(',') + 1)..]); } catch { continue; }
                var tex = (string?)s!["textureId"];
                var when = DateTime.TryParse((string?)s["updated"] ?? (string?)s["created"], null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var t) ? t : File.GetLastWriteTimeUtc(f);
                var hash = !string.IsNullOrEmpty(tex) && System.Text.RegularExpressions.Regex.IsMatch(tex, "^[0-9a-f]{20,80}$") ? tex : Sha(png);
                yield return (hash, png, s["slim"]?.GetValue<bool>() == true ? "slim" : "classic", when, "Minecraft Launcher", (string?)s["name"],
                    hash == tex ? "https://textures.minecraft.net/texture/" + tex : null);
            }
        }
    }

    /// <summary>Skin library of the Modrinth App (app.db), read from a private copy.</summary>
    private static List<(string, byte[], string, DateTime, string, string?, string?)> FromModrinth(string uuid)
    {
        var r = new List<(string, byte[], string, DateTime, string, string?, string?)>();
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var db = new[] { "ModrinthApp", "com.modrinth.theseus", "com.modrinth.app" }.Select(x => Path.Combine(roaming, x, "app.db")).FirstOrDefault(File.Exists);
        if (db == null) return r;
        var tmp = Path.Combine(Paths.Cache, "import-mr-skins"); Directory.CreateDirectory(tmp);
        foreach (var ext in new[] { "", "-wal", "-shm" })
        {
            var dst = Path.Combine(tmp, "app.db" + ext);
            try { File.Delete(dst); } catch { }
            if (!File.Exists(db + ext)) continue;
            using var src = new FileStream(db + ext, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var o = File.Create(dst); src.CopyTo(o);
        }
        SQLitePCL.Batteries.Init();
        using var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(tmp, "app.db")};Pooling=False");
        c.Open();
        var when = DateTime.MinValue;   // the app keeps no date: shown without one
        var id = uuid.Replace("-", "").ToLowerInvariant();
        foreach (var row in Importers.Rows(c, "SELECT s.minecraft_user_uuid AS u, s.texture_key AS k, s.variant AS v, t.texture AS png FROM custom_minecraft_skins s JOIN custom_minecraft_skin_textures t ON t.texture_key = s.texture_key"))
        {
            if (((row.GetValueOrDefault("u") as string) ?? "").Replace("-", "").ToLowerInvariant() is { Length: > 0 } u && u != id) continue;
            if (row.GetValueOrDefault("png") is not byte[] png) continue;
            var k = row.GetValueOrDefault("k") as string;
            var hash = k != null && System.Text.RegularExpressions.Regex.IsMatch(k, "^[0-9a-f]{20,80}$") ? k : Sha(png);
            r.Add((hash, png, string.Equals(row.GetValueOrDefault("v") as string, "slim", StringComparison.OrdinalIgnoreCase) ? "slim" : "classic", when, "Modrinth App", null, null));
        }
        return r;
    }

    /// <summary>Removes one entry from the history.</summary>
    public static void Forget(string uuid, string key)
    {
        lock (HL)
        {
            var l = Net.LoadJson<List<Worn>>(HistoryFile) ?? new();
            l.RemoveAll(x => x.Uuid == uuid && KeyOf(x) == key);
            Net.SaveJson(HistoryFile, l);
        }
    }

    /// <summary>Uploads a skin to the account (multipart, like the official launcher).</summary>
    public static async Task<JsonNode> Upload(string token, byte[] png, string variant, CancellationToken ct = default)
    {
        Validate(png, variant);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(variant == "slim" ? "slim" : "classic"), "variant");
        var file = new ByteArrayContent(png);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(file, "file", "skin.png");
        return await Send(HttpMethod.Post, ProfileApi + "/skins", token, form, ct);
    }

    public static Task<JsonNode> SetCape(string token, string? capeId, CancellationToken ct = default) =>
        string.IsNullOrEmpty(capeId)
            ? Send(HttpMethod.Delete, ProfileApi + "/capes/active", token, null, ct)
            : Send(HttpMethod.Put, ProfileApi + "/capes/active", token, new StringContent($"{{\"capeId\":\"{capeId.Replace("\"", "")}\"}}", System.Text.Encoding.UTF8, "application/json"), ct);

    private static async Task<JsonNode> Send(HttpMethod m, string url, string token, HttpContent? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(m, url) { Content = body };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var r = await Net.Http.SendAsync(req, ct);
        var txt = await r.Content.ReadAsStringAsync(ct);
        if ((int)r.StatusCode == 429) throw new InvalidOperationException("Zu viele Skin-Änderungen. Bitte kurz warten.");
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException($"Mojang hat abgelehnt ({(int)r.StatusCode}).");
        return string.IsNullOrWhiteSpace(txt) ? new JsonObject() : JsonNode.Parse(txt)!;
    }
}
