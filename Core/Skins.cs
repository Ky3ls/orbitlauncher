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
    public static void Validate(byte[] png)
    {
        if (png.Length < 24 || png[0] != 0x89 || png[1] != 'P' || png[2] != 'N' || png[3] != 'G') throw new InvalidOperationException("Das ist keine PNG-Datei.");
        if (png.Length > 1024 * 1024) throw new InvalidOperationException("Die Datei ist zu groß.");
        int w = png[16] << 24 | png[17] << 16 | png[18] << 8 | png[19];
        int h = png[20] << 24 | png[21] << 16 | png[22] << 8 | png[23];
        if (w != 64 || (h != 64 && h != 32)) throw new InvalidOperationException($"Skins müssen 64×64 Pixel groß sein (diese Datei: {w}×{h}).");
    }

    public static Entry Add(byte[] png, string name, string variant)
    {
        Validate(png);
        var l = All();
        var e = new Entry { Id = Guid.NewGuid().ToString("N")[..12], Name = string.IsNullOrWhiteSpace(name) ? "Skin" : name.Trim(), Variant = variant == "slim" ? "slim" : "classic" };
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

    public static Task<JsonNode> Profile(string token, CancellationToken ct = default) => Net.GetAuth(ProfileApi, token, ct);

    /// <summary>Uploads a skin to the account (multipart, like the official launcher).</summary>
    public static async Task<JsonNode> Upload(string token, byte[] png, string variant, CancellationToken ct = default)
    {
        Validate(png);
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
