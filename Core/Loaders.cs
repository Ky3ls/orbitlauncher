using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json.Nodes;
using System.Xml.Linq;

namespace OrbitLauncher.Core;

public record LoaderVersion(string Version, bool Stable, bool Recommended = false);

/// <summary>Fabric, Quilt, Forge and NeoForge through their official meta APIs and installers.</summary>
public static class Loaders
{
    public static readonly string[] All = { "vanilla", "fabric", "quilt", "forge", "neoforge" };

    public static async Task<List<LoaderVersion>> List(string loader, string mc, CancellationToken ct = default)
    {
        switch (loader)
        {
            case "fabric":
            {
                var a = await Net.Json($"https://meta.fabricmc.net/v2/versions/loader/{Uri.EscapeDataString(mc)}", ct);
                return Sort(a.AsArray().Select(x => new LoaderVersion((string)x!["loader"]!["version"]!, (bool?)x["loader"]!["stable"] ?? false)));
            }
            case "quilt":
            {
                var a = await Net.Json($"https://meta.quiltmc.org/v3/versions/loader/{Uri.EscapeDataString(mc)}", ct);
                return Sort(a.AsArray().Select(x => (string)x!["loader"]!["version"]!).Select(v => new LoaderVersion(v, !v.Contains('-'))));
            }
            case "forge":
            {
                var xml = XDocument.Parse(await Net.Text("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml", ct));
                string? rec = null, latest = null;
                try
                {
                    var promo = await Net.Json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json", ct);
                    rec = (string?)promo["promos"]?[mc + "-recommended"];
                    latest = (string?)promo["promos"]?[mc + "-latest"];
                }
                catch { }
                return Sort(xml.Descendants("version").Select(e => e.Value)
                    .Where(v => v.StartsWith(mc + "-"))
                    .Select(v => new LoaderVersion(v, true, rec != null && v == $"{mc}-{rec}" || rec == null && latest != null && v == $"{mc}-{latest}")));
            }
            case "neoforge":
            {
                var a = await Net.Json("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge", ct);
                return Sort(a["versions"]!.AsArray().Select(x => (string)x!)
                    .Where(v => NeoForgeMc(v) == mc)
                    .Select(v => new LoaderVersion(v, !v.Contains("beta") && !v.Contains("alpha"))));
            }
        }
        return new();
    }

    private static List<LoaderVersion> Sort(IEnumerable<LoaderVersion> v) => v.OrderByDescending(x => x.Version, VersionOrder.Instance).ToList();

    /// <summary>Which Minecraft versions a loader supports (for the version picker).</summary>
    public static async Task<HashSet<string>> GameVersions(string loader, CancellationToken ct = default)
    {
        switch (loader)
        {
            case "fabric": return (await Net.Json("https://meta.fabricmc.net/v2/versions/game", ct)).AsArray().Select(x => (string)x!["version"]!).ToHashSet();
            case "quilt": return (await Net.Json("https://meta.quiltmc.org/v3/versions/game", ct)).AsArray().Select(x => (string)x!["version"]!).ToHashSet();
            case "forge":
                var xml = XDocument.Parse(await Net.Text("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml", ct));
                return xml.Descendants("version").Select(e => e.Value.Split('-')[0]).ToHashSet();
            case "neoforge":
                var a = await Net.Json("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge", ct);
                return a["versions"]!.AsArray().Select(x => NeoForgeMc((string)x!)).Where(x => x != null).Select(x => x!).ToHashSet();
        }
        return new();
    }

    /// <summary>NeoForge "21.1.77" → 1.21.1, "20.4.3" → 1.20.4, "26.1.2.5" → 26.1.2 (year based versions).</summary>
    public static string? NeoForgeMc(string v)
    {
        var p = v.Split('-')[0].Split('.');
        if (p.Length < 3 || !int.TryParse(p[0], out var a) || !int.TryParse(p[1], out var b)) return null;
        if (a >= 26) return p.Length >= 4 && p[2] != "0" ? $"{a}.{b}.{p[2]}" : $"{a}.{b}";
        return b == 0 ? $"1.{a}" : $"1.{a}.{b}";
    }

    /// <summary>Installs the loader and returns the version id to launch.</summary>
    public static async Task<string> Install(string loader, string mc, string? version, IProgress<Progress>? p, CancellationToken ct = default)
    {
        if (loader == "vanilla") { await Versions.EnsureJson(mc, ct); return mc; }
        if (string.IsNullOrEmpty(version))
        {
            var list = await List(loader, mc, ct);
            version = (list.FirstOrDefault(l => l.Recommended) ?? list.FirstOrDefault(l => l.Stable) ?? list.FirstOrDefault())?.Version
                      ?? throw new InvalidOperationException($"{Name(loader)} gibt es nicht für Minecraft {mc}.");
        }
        p?.Report(new Progress($"{Name(loader)} wird installiert", 0, 1, version));
        switch (loader)
        {
            case "fabric": return await Profile($"https://meta.fabricmc.net/v2/versions/loader/{mc}/{version}/profile/json", ct);
            case "quilt": return await Profile($"https://meta.quiltmc.org/v3/versions/loader/{mc}/{version}/profile/json", ct);
            case "forge": return await RunInstaller(loader, $"https://maven.minecraftforge.net/net/minecraftforge/forge/{version}/forge-{version}-installer.jar", mc, p, ct);
            case "neoforge": return await RunInstaller(loader, $"https://maven.neoforged.net/releases/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar", mc, p, ct);
        }
        throw new ArgumentException("Unbekannter Loader " + loader);
    }

    public static string Name(string loader) => loader switch { "fabric" => "Fabric", "quilt" => "Quilt", "forge" => "Forge", "neoforge" => "NeoForge", _ => "Vanilla" };

    private static async Task<string> Profile(string url, CancellationToken ct)
    {
        var json = await Net.Json(url, ct);
        var id = (string)json["id"]!;
        Net.SaveJson(Versions.JsonPath(id), json);
        await Versions.EnsureJson((string)json["inheritsFrom"]!, ct);
        return id;
    }

    /// <summary>Runs the official (Neo)Forge installer headless. It needs the vanilla version and a launcher_profiles.json in the target folder.</summary>
    private static async Task<string> RunInstaller(string loader, string url, string mc, IProgress<Progress>? p, CancellationToken ct)
    {
        var jar = Path.Combine(Paths.Cache, Path.GetFileName(new Uri(url).LocalPath));
        await Net.Download(new DlItem(url, jar), ct);

        string id;
        using (var z = ZipFile.OpenRead(jar))
        {
            var e = z.GetEntry("install_profile.json") ?? throw new InvalidOperationException("Installer ohne install_profile.json");
            using var s = new StreamReader(e.Open());
            var prof = JsonNode.Parse(await s.ReadToEndAsync(ct))!;
            id = (string?)prof["version"] ?? (string?)prof["install"]?["target"] ?? throw new InvalidOperationException("Versions-ID im Installer fehlt");
        }
        if (File.Exists(Versions.JsonPath(id))) return id;

        // vanilla JSON + client jar first, the installer patches against it
        var vanilla = await Versions.EnsureJson(mc, ct);
        var client = vanilla["downloads"]?["client"];
        if (client != null) await Net.Download(new DlItem((string)client["url"]!, Versions.JarPath(mc), (string?)client["sha1"], (long?)client["size"] ?? 0), ct);
        var lp = Path.Combine(Paths.Root, "launcher_profiles.json");
        if (!File.Exists(lp)) File.WriteAllText(lp, "{\"profiles\":{},\"selectedProfile\":null}");

        var java = await Java.Ensure((int?)vanilla["javaVersion"]?["majorVersion"] ?? 8, (string?)vanilla["javaVersion"]?["component"] ?? "jre-legacy", p, ct);
        p?.Report(new Progress($"{Name(loader)}-Installer läuft", 0, 1, "Das kann ein paar Minuten dauern"));
        var psi = new ProcessStartInfo(java) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = Paths.Cache };
        foreach (var a in new[] { "-jar", jar, "--installClient", Paths.Root }) psi.ArgumentList.Add(a);
        using var pr = Process.Start(psi)!;
        var tail = new Queue<string>();
        var lastReport = DateTime.MinValue;
        void Line(string? l)
        {
            if (string.IsNullOrWhiteSpace(l)) return;
            lock (tail)
            {
                tail.Enqueue(l); if (tail.Count > 12) tail.Dequeue();
                if ((DateTime.UtcNow - lastReport).TotalMilliseconds < 200) return;
                lastReport = DateTime.UtcNow;
            }
            p?.Report(new Progress($"{Name(loader)}-Installer läuft", 0, 1, l.Length > 90 ? l[..90] + "…" : l));
        }
        pr.OutputDataReceived += (_, e) => Line(e.Data);
        pr.ErrorDataReceived += (_, e) => Line(e.Data);
        pr.BeginOutputReadLine(); pr.BeginErrorReadLine();
        using (ct.Register(() => { try { pr.Kill(true); } catch { } })) await pr.WaitForExitAsync(ct);
        if (pr.ExitCode != 0 || !File.Exists(Versions.JsonPath(id)))
            throw new InvalidOperationException($"{Name(loader)}-Installer fehlgeschlagen (Code {pr.ExitCode}): " + string.Join(" | ", tail.TakeLast(3)));
        return id;
    }
}

/// <summary>Natural version order: 0.10.2 &gt; 0.9.1, 47.4.28 &gt; 47.4.5, releases before -beta of the same number.</summary>
public sealed class VersionOrder : IComparer<string>
{
    public static readonly VersionOrder Instance = new();
    public int Compare(string? a, string? b)
    {
        var pa = System.Text.RegularExpressions.Regex.Matches(a ?? "", "\\d+|[a-zA-Z]+").Select(m => m.Value).ToArray();
        var pb = System.Text.RegularExpressions.Regex.Matches(b ?? "", "\\d+|[a-zA-Z]+").Select(m => m.Value).ToArray();
        for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            if (i >= pa.Length) return char.IsLetter(pb[i][0]) ? 1 : -1;   // "1.0" > "1.0-beta"
            if (i >= pb.Length) return char.IsLetter(pa[i][0]) ? -1 : 1;
            bool na = long.TryParse(pa[i], out var x), nb = long.TryParse(pb[i], out var y);
            int c = na && nb ? x.CompareTo(y) : na ? 1 : nb ? -1 : string.CompareOrdinal(pa[i], pb[i]);
            if (c != 0) return c;
        }
        return 0;
    }
}
