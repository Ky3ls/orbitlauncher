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

/// <summary>The "Orbit Client": a curated, open Fabric setup from Modrinth (performance, shaders, HUD, zoom, QoL).
/// Nothing is bundled – every mod is downloaded from Modrinth under its own license.</summary>
public static class OrbitClient
{
    public record Module(string Id, string Name, string Desc, string Icon, bool Default, string[] Mods);

    public static readonly Module[] Modules =
    {
        new("perf", "FPS-Boost", "Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast und Dynamic FPS", "zap", true,
            new[] { "sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "dynamic-fps", "sodium-extra", "reeses-sodium-options" }),
        new("shaders", "Shader-Support", "Iris für Shaderpacks wie Complementary oder BSL", "sun", true, new[] { "iris" }),
        new("hud", "PvP-HUD", "AxolotlClient: Keystrokes, CPS, FPS, Rüstung, Koordinaten, Crosshair", "keyboard", true, new[] { "axolotlclient" }),
        new("zoom", "Zoom", "Zoomify – flüssiger Zoom mit Mausrad", "search", true, new[] { "zoomify" }),
        new("look", "Freelook", "Kamera frei drehen, ohne die Laufrichtung zu ändern", "eye", false, new[] { "freelook" }),
        new("qol", "Komfort", "Toggle Sprint, AppleSkin, Mouse Tweaks, BetterF3, No Chat Reports", "sparkle", true,
            new[] { "toggle-sprint-display", "appleskin", "mouse-tweaks", "betterf3", "no-chat-reports" }),
        new("visual", "Optik", "Dynamische Lichter, Connected Textures, 3D-Skin-Layer", "layers", false, new[] { "lambdynamiclights", "continuity", "3dskinlayers" }),
    };

    /// <summary>Newest release for which the core mods (Fabric API, Sodium, Iris) are out.</summary>
    public static async Task<string> BestVersion(CancellationToken ct = default)
    {
        var releases = (await Versions.All(false, ct)).Where(v => v.Type == "release").Select(v => v.Id).ToList();
        HashSet<string>? common = null;
        foreach (var slug in new[] { "fabric-api", "sodium", "iris" })
        {
            var vs = await Modrinth.ProjectVersions(slug, new[] { "fabric" }, null, ct);
            var gv = vs.SelectMany(v => v!["game_versions"]!.AsArray().Select(x => (string)x!)).ToHashSet();
            common = common == null ? gv : common.Intersect(gv).ToHashSet();
        }
        return releases.FirstOrDefault(r => common!.Contains(r)) ?? releases.First();
    }

    public static async Task<(Instance inst, List<string> installed, List<string> skipped)> Create(string? mc, IEnumerable<string> modules, int ramMb, IProgress<Progress>? p, CancellationToken ct = default)
    {
        mc ??= await BestVersion(ct);
        p?.Report(new Progress("Orbit Client wird eingerichtet", 0, 1, "Minecraft " + mc));
        var inst = Instances.Create("Orbit Client " + mc, mc, "fabric", null, "orbit");
        inst.Icon = "orbit"; inst.RamMb = ramMb;
        inst.VersionId = await Loaders.Install("fabric", mc, null, p, ct);
        inst.LoaderVersion = inst.VersionId.Split('-').ElementAtOrDefault(2);
        Instances.Save(inst);

        var installed = new List<string>(); var skipped = new List<string>();
        var slugs = new List<string> { "fabric-api", "modmenu" };
        var set = modules.ToHashSet();
        slugs.AddRange(Modules.Where(m => set.Contains(m.Id)).SelectMany(m => m.Mods));
        int i = 0;
        foreach (var slug in slugs.Distinct())
        {
            i++;
            p?.Report(new Progress("Orbit Client: Mods", i, slugs.Count, slug));
            try
            {
                var r = await Modrinth.Install(inst, slug, "mod", null, null, ct);
                installed.AddRange(r.Installed); skipped.AddRange(r.Skipped);
            }
            catch (Exception e) when (e is not OperationCanceledException) { skipped.Add(slug); }
        }
        WriteDefaults(inst);
        return (inst, installed.Distinct().ToList(), skipped.Distinct().ToList());
    }

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

/// <summary>Detects other installed launchers/clients so they can be started from here (no assets or code are used).</summary>
public static class ExternalClients
{
    public record Found(string Id, string Name, string Path);

    public static List<Found> Detect()
    {
        var r = new List<Found>();
        if (!OperatingSystem.IsWindows()) return r;
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var candidates = new (string id, string name, string[] paths, string reg)[]
        {
            ("lunar", "Lunar Client", new[] { $@"{local}\Programs\lunarclient\Lunar Client.exe", $@"{local}\Programs\launcher\Lunar Client.exe" }, "Lunar Client"),
            ("labymod", "LabyMod", new[] { $@"{local}\Programs\LabyMod Launcher\LabyMod Launcher.exe", $@"{local}\Programs\labymodlauncher\LabyModLauncher.exe", $@"{local}\Programs\labymod-launcher\LabyMod Launcher.exe" }, "LabyMod"),
            ("badlion", "Badlion Client", new[] { $@"{pf}\Badlion Client\Badlion Client.exe", $@"{local}\Programs\Badlion Client\Badlion Client.exe" }, "Badlion Client"),
            ("feather", "Feather Client", new[] { $@"{local}\Programs\feather-launcher\Feather Launcher.exe" }, "Feather"),
            ("mojang", "Minecraft Launcher", new[] { $@"{pf86}\Minecraft Launcher\MinecraftLauncher.exe", $@"{pf}\Minecraft Launcher\MinecraftLauncher.exe" }, "Minecraft Launcher"),
        };
        var reg = RegistryApps();
        foreach (var c in candidates)
        {
            var path = c.paths.FirstOrDefault(File.Exists)
                ?? reg.FirstOrDefault(x => x.name.StartsWith(c.reg, StringComparison.OrdinalIgnoreCase) && File.Exists(x.exe)).exe;
            if (path != null) r.Add(new Found(c.id, c.name, path));
        }
        return r;
    }

    private static List<(string name, string exe)> RegistryApps()
    {
        var r = new List<(string, string)>();
        if (!OperatingSystem.IsWindows()) return r;
        try
        {
            foreach (var hive in new[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine })
            {
                using var k = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
                if (k == null) continue;
                foreach (var sub in k.GetSubKeyNames())
                {
                    using var s = k.OpenSubKey(sub);
                    var name = s?.GetValue("DisplayName") as string;
                    var icon = (s?.GetValue("DisplayIcon") as string)?.Split(',')[0].Trim('"');
                    if (name != null && icon != null && icon.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) r.Add((name, icon));
                }
            }
        }
        catch { }
        return r;
    }

    public static void Start(string path) => Process.Start(new ProcessStartInfo(path) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(path) });
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
