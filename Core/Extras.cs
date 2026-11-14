using System.Diagnostics;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

public class Settings
{
    public string Accent { get; set; } = "ember";
    public int RamMb { get; set; } = 4096;
    public string? JavaPath { get; set; }
    public string? JvmArgs { get; set; }
    public int Width { get; set; } = 0;
    public int Height { get; set; } = 0;
    /// <summary>keep | minimize | close</summary>
    public string OnLaunch { get; set; } = "minimize";
    public bool ShowSnapshots { get; set; }
    public bool ShowOld { get; set; }
    /// <summary>Azure app (client) id approved for the Minecraft API. Users register their own app.</summary>
    public string ClientId { get; set; } = "";
    public string? LastInstance { get; set; }
    public bool FirstRun { get; set; } = true;
    public bool AutoUpdateMods { get; set; }

    private static string FilePath => Path.Combine(Paths.Root, "settings.json");
    public static Settings Load() => Net.LoadJson<Settings>(FilePath) ?? new Settings();
    public void Save() => Net.SaveJson(FilePath, this);
}

/// <summary>
/// Orbit Client = OrbitLauncher's own client: our Fabric mod (HUD, keystrokes, CPS, zoom, freelook, fullbright,
/// crosshair, mod menu on Right Shift) plus optional performance/QoL packs downloaded from Modrinth.
/// </summary>
public static class OrbitClient
{
    public record Pack(string Id, string Name, string Desc, string Icon, bool Default, string[] Mods);

    /// <summary>Minecraft versions the Orbit Client mod is built for.</summary>
    public static readonly string[] Supported = { "26.3" };
    public const string ModFile = "orbitclient.jar";
    /// <summary>Provides the bundled mod jar (embedded resource in the app, a file in tests).</summary>
    public static Func<Stream?>? ModJar { get; set; }

    public static readonly Pack[] Packs =
    {
        new("perf", "FPS-Boost", "Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast, Dynamic FPS", "zap", true,
            new[] { "sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "dynamic-fps", "sodium-extra", "reeses-sodium-options" }),
        new("shaders", "Shader-Support", "Iris für Shaderpacks wie Complementary oder BSL", "sun", true, new[] { "iris" }),
        new("qol", "Komfort", "AppleSkin, Mouse Tweaks, BetterF3, No Chat Reports", "sparkle", true,
            new[] { "appleskin", "mouse-tweaks", "betterf3", "no-chat-reports" }),
        new("visual", "Optik", "Dynamische Lichter, Connected Textures, 3D-Skin-Layer", "layers", false, new[] { "lambdynamiclights", "continuity", "3dskinlayers" }),
    };

    public static Task<string> BestVersion(CancellationToken ct = default) => Task.FromResult(Supported[0]);

    public static async Task<(Instance inst, List<string> installed, List<string> skipped)> Create(string? mc, IEnumerable<string> packs, int ramMb, string accent, IProgress<Progress>? p, CancellationToken ct = default)
    {
        mc = mc != null && Supported.Contains(mc) ? mc : Supported[0];
        p?.Report(new Progress("Orbit Client wird eingerichtet", 0, 1, "Minecraft " + mc));
        var inst = Instances.Create("Orbit Client", mc, "fabric", null, "orbit");
        inst.Icon = "orbit"; inst.RamMb = ramMb;
        inst.VersionId = await Loaders.Install("fabric", mc, null, p, ct);
        inst.LoaderVersion = inst.VersionId.Split('-').ElementAtOrDefault(2);
        Instances.Save(inst);

        var installed = new List<string>(); var skipped = new List<string>();
        var slugs = new List<string> { "fabric-api", "modmenu" };
        var set = packs.ToHashSet();
        slugs.AddRange(Packs.Where(m => set.Contains(m.Id)).SelectMany(m => m.Mods));
        int i = 0;
        foreach (var slug in slugs.Distinct())
        {
            i++;
            p?.Report(new Progress("Orbit Client: Pakete", i, slugs.Count, slug));
            try
            {
                var r = await Modrinth.Install(inst, slug, "mod", null, null, ct);
                installed.AddRange(r.Installed); skipped.AddRange(r.Skipped);
            }
            catch (Exception e) when (e is not OperationCanceledException) { skipped.Add(slug); }
        }
        EnsureMod(inst);
        installed.Insert(0, "Orbit Client");
        var cfg = ReadConfig(inst) ?? new JsonObject();
        cfg["accent"] = accent;
        WriteConfig(inst, cfg);
        WriteDefaults(inst);
        return (inst, installed.Distinct().ToList(), skipped.Distinct().ToList());
    }

    /// <summary>Puts the current Orbit Client mod into the instance (also updates it after launcher updates).</summary>
    public static void EnsureMod(Instance inst)
    {
        if (inst.Kind != "orbit" || !Supported.Contains(inst.McVersion)) return;
        using var src = ModJar?.Invoke();
        if (src == null) return;
        using var ms = new MemoryStream(); src.CopyTo(ms);
        var bytes = ms.ToArray();
        var mods = Path.Combine(inst.Dir, "mods");
        Directory.CreateDirectory(mods);
        var target = Path.Combine(mods, ModFile);
        if (File.Exists(target + ".disabled")) return;   // user turned it off on purpose
        if (File.Exists(target) && File.ReadAllBytes(target).AsSpan().SequenceEqual(bytes)) return;
        File.WriteAllBytes(target, bytes);
    }

    public static string ConfigPath(Instance inst) => Path.Combine(inst.Dir, "config", "orbitclient.json");
    public static JsonObject? ReadConfig(Instance inst)
    {
        try { var f = ConfigPath(inst); return File.Exists(f) ? JsonNode.Parse(File.ReadAllText(f)) as JsonObject : null; } catch { return null; }
    }
    /// <summary>The mod watches this file and reloads it while the game runs.</summary>
    public static void WriteConfig(Instance inst, JsonObject cfg) => Net.SaveJson(ConfigPath(inst), cfg);

    /// <summary>Sensible vanilla options for PvP (only written once, never overwrites user settings).</summary>
    private static void WriteDefaults(Instance inst)
    {
        var f = Path.Combine(inst.Dir, "options.txt");
        if (File.Exists(f)) return;
        File.WriteAllLines(f, new[]
        {
            "renderDistance:12", "simulationDistance:8", "maxFps:260", "enableVsync:false", "graphicsMode:1",
            "entityShadows:false", "renderClouds:\"false\"", "particles:1", "fovEffectScale:0.0", "screenEffectScale:0.0",
            "bobView:false", "autoJump:false", "toggleSprint:true", "rawMouseInput:true", "soundCategory_music:0.0", "lang:de_de",
        });
    }
}

/// <summary>Official Java Edition patch notes (same feed the Mojang launcher shows).</summary>
public static class News
{
    public static async Task<List<object>> Latest(int n, CancellationToken ct = default)
    {
        var j = await Net.Json("https://launchercontent.mojang.com/v2/javaPatchNotes.json", ct);
        return j["entries"]!.AsArray().Take(n).Select(e => (object)new
        {
            title = (string?)e!["title"],
            version = (string?)e["version"],
            type = (string?)e["type"],
            date = (string?)e["date"],
            text = (string?)e["shortText"],
            image = e["image"]?["url"] is JsonNode u ? "https://launchercontent.mojang.com" + (string?)u : null,
        }).ToList();
    }
}
