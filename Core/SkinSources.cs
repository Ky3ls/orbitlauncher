using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>
/// Extra places a skin can come from: the default skins inside the user's own Minecraft client jar,
/// a player's public skin (official Mojang API) or a direct PNG link the user pastes.
/// </summary>
public static class SkinSources
{
    public record Item(string Name, string Variant, string Data);

    private static string CacheFile => Path.Combine(Paths.Cache, "default-skins.json");

    /// <summary>Default skins (Steve, Alex and the others) read from a client jar; downloads the latest client if none is there.</summary>
    public static async Task<List<Item>> Defaults(CancellationToken ct = default)
    {
        var cached = Net.LoadJson<List<Item>>(CacheFile);
        if (cached is { Count: > 0 }) return cached;
        string? jar = null;
        if (Directory.Exists(Paths.Versions))
            jar = Directory.GetDirectories(Paths.Versions)
                .Select(d => Path.Combine(d, Path.GetFileName(d) + ".jar"))
                .Where(File.Exists).OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault(HasSkins);
        if (jar == null)
        {
            await Versions.All(false);
            var id = Versions.LatestRelease ?? throw new InvalidOperationException("Keine Minecraft-Version gefunden.");
            var v = await Versions.EnsureJson(id, ct);
            var c = v["downloads"]?["client"] ?? throw new InvalidOperationException("Client-Download fehlt.");
            await Net.Download(new DlItem((string)c["url"]!, Versions.JarPath(id), (string?)c["sha1"], (long?)c["size"] ?? 0), ct);
            jar = Versions.JarPath(id);
        }
        var list = new List<Item>();
        using (var z = ZipFile.OpenRead(jar))
        {
            foreach (var e in z.Entries)
            {
                var m = System.Text.RegularExpressions.Regex.Match(e.FullName, @"^assets/minecraft/textures/entity/player/(wide|slim)/([a-z_]+)\.png$");
                if (!m.Success) continue;
                using var s = e.Open(); using var ms = new MemoryStream(); await s.CopyToAsync(ms, ct);
                var name = string.Concat(m.Groups[2].Value.Split('_').Select(w => w.Length > 0 ? char.ToUpper(w[0]) + w[1..] : w));
                list.Add(new Item(name, m.Groups[1].Value == "slim" ? "slim" : "classic", "data:image/png;base64," + Convert.ToBase64String(ms.ToArray())));
            }
        }
        list = list.OrderBy(x => x.Name).ThenBy(x => x.Variant).ToList();
        if (list.Count > 0) Net.SaveJson(CacheFile, list);
        return list;
    }

    private static bool HasSkins(string jar)
    {
        try { using var z = ZipFile.OpenRead(jar); return z.GetEntry("assets/minecraft/textures/entity/player/wide/steve.png") != null; }
        catch { return false; }
    }

    /// <summary>Public skin (and cape) of a player, through Mojang's official profile API.</summary>
    public static async Task<object> Player(string name, CancellationToken ct = default)
    {
        name = name.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[A-Za-z0-9_]{2,16}$")) throw new InvalidOperationException("Ungültiger Spielername.");
        JsonNode id;
        try { id = await Net.Json("https://api.mojang.com/users/profiles/minecraft/" + name, ct); }
        catch { throw new InvalidOperationException($"Spieler „{name}“ nicht gefunden."); }
        var prof = await Net.Json("https://sessionserver.mojang.com/session/minecraft/profile/" + (string)id["id"]!, ct);
        var b64 = (string?)prof["properties"]?.AsArray().FirstOrDefault(p => (string?)p?["name"] == "textures")?["value"] ?? throw new InvalidOperationException("Kein Skin gefunden.");
        var tex = JsonNode.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(b64)))!["textures"];
        var skinUrl = (string?)tex?["SKIN"]?["url"] ?? throw new InvalidOperationException("Dieser Spieler nutzt den Standard-Skin.");
        var slim = (string?)tex?["SKIN"]?["metadata"]?["model"] == "slim";
        var png = await Skins.Texture(skinUrl, ct);
        string? cape = null;
        if ((string?)tex?["CAPE"]?["url"] is string cu) { try { cape = "data:image/png;base64," + Convert.ToBase64String(await Skins.Texture(cu, ct)); } catch { } }
        return new { name = (string?)prof["name"] ?? name, variant = slim ? "slim" : "classic", data = "data:image/png;base64," + Convert.ToBase64String(png), cape };
    }

    /// <summary>A skin PNG from a link the user pasted (https only, must be a valid 64×64 skin).</summary>
    public static async Task<string> FromLink(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) || u.Scheme != "https") throw new InvalidOperationException("Bitte einen https-Link zu einer PNG-Datei einfügen.");
        using var r = await Net.Http.GetAsync(u, HttpCompletionOption.ResponseHeadersRead, ct);
        r.EnsureSuccessStatusCode();
        if (r.Content.Headers.ContentLength > 1024 * 1024) throw new InvalidOperationException("Die Datei ist zu groß.");
        var png = await r.Content.ReadAsByteArrayAsync(ct);
        Skins.Validate(png);
        return "data:image/png;base64," + Convert.ToBase64String(png);
    }
}
