using System.IO.Compression;

namespace OrbitLauncher.Core;

/// <summary>
/// Block textures for instance icons, read from the user's own Minecraft client jar (nothing is shipped with the launcher).
/// </summary>
public static class BlockTextures
{
    private static string CacheFile => Path.Combine(Paths.Cache, "block-textures.json");

    /// <summary>name → data URL of assets/minecraft/textures/block/{name}.png. Empty when no client jar is on disk yet.</summary>
    public static async Task<Dictionary<string, string>> Get(IEnumerable<string> names, bool download, CancellationToken ct = default)
    {
        var want = names.Where(n => System.Text.RegularExpressions.Regex.IsMatch(n, "^[a-z0-9_]{1,48}$")).Distinct().ToList();
        var cache = Net.LoadJson<Dictionary<string, string>>(CacheFile) ?? new();
        if (want.All(cache.ContainsKey)) return want.ToDictionary(n => n, n => cache[n]);
        var jar = await SkinSources.ClientJar(download, ct);
        if (jar == null) return want.Where(cache.ContainsKey).ToDictionary(n => n, n => cache[n]);
        using (var z = ZipFile.OpenRead(jar))
        {
            foreach (var n in want)
            {
                if (cache.ContainsKey(n)) continue;
                var e = z.GetEntry($"assets/minecraft/textures/block/{n}.png");
                if (e == null) continue;
                using var s = e.Open(); using var ms = new MemoryStream(); await s.CopyToAsync(ms, ct);
                cache[n] = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
            }
        }
        Net.SaveJson(CacheFile, cache);
        return want.Where(cache.ContainsKey).ToDictionary(n => n, n => cache[n]);
    }
}
