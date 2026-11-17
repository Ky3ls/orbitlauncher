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
            var last = l.Where(x => x.Uuid == uuid).OrderByDescending(x => x.Last).FirstOrDefault();
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
        var l = History().Where(x => x.Uuid == uuid).OrderByDescending(x => x.Last).ToList();
        return l.Select((x, i) =>
        {
            var f = Path.Combine(HistoryDir, Path.GetFileName(new Uri(x.Url).AbsolutePath) + ".png");
            var url = File.Exists(f) ? "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(f)) : x.Url;
            return (object)new { key = KeyOf(x), url, texture = x.Url, variant = x.Variant, from = x.From, last = x.Last, active = i == 0 };
        }).ToList();
    }

    // the same skin can be worn more than once: the key includes when
    private static string KeyOf(Worn x) => Path.GetFileName(new Uri(x.Url).AbsolutePath) + "_" + x.From.Ticks;

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
