using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>
/// Hands an instance over to the official Minecraft Launcher: copies the version files it needs into .minecraft,
/// writes a profile (game directory = our instance folder) and opens the launcher. Login and start happen there.
/// </summary>
public static class OfficialLauncher
{
    public static string McDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), ".minecraft");

    public static string? FindExe()
    {
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        foreach (var p in new[]
        {
            Path.Combine(pf86, "Minecraft Launcher", "MinecraftLauncher.exe"),
            Path.Combine(pf, "Minecraft Launcher", "MinecraftLauncher.exe"),
            @"C:\XboxGames\Minecraft Launcher\Content\Minecraft.exe",
            Path.Combine(pf, "WindowsApps", "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "Minecraft.exe"),
        })
            if (File.Exists(p)) return p;
        return null;
    }

    /// <summary>Prepares everything (our own download logic) and writes the profile. Returns the profile name.</summary>
    public static async Task<string> Export(Instance inst, Settings set, IProgress<Progress>? p, CancellationToken ct = default)
    {
        await Runner.Prepare(inst, set, p, ct, java: false);
        var id = inst.VersionId ?? inst.McVersion;
        p?.Report(new Progress("Profil für den Minecraft Launcher", 0, 1, inst.Name));

        // version JSON chain (loader profile + vanilla parent)
        var libs = new List<JsonNode>();
        for (string? v = id; v != null;)
        {
            var src = Versions.JsonPath(v);
            if (!File.Exists(src)) break;
            var dstDir = Path.Combine(McDir, "versions", v);
            Directory.CreateDirectory(dstDir);
            File.Copy(src, Path.Combine(dstDir, v + ".json"), true);
            var jar = Versions.JarPath(v);
            if (File.Exists(jar) && !File.Exists(Path.Combine(dstDir, v + ".jar"))) File.Copy(jar, Path.Combine(dstDir, v + ".jar"));
            var j = JsonNode.Parse(await File.ReadAllTextAsync(src, ct))!;
            libs.AddRange(j["libraries"]?.AsArray().Where(x => x != null)!.Cast<JsonNode>() ?? Enumerable.Empty<JsonNode>());
            v = (string?)j["inheritsFrom"];
        }

        // libraries the official launcher can't download itself (e.g. files the Forge installer generated)
        foreach (var l in libs)
        {
            var rel = (string?)l["downloads"]?["artifact"]?["path"] ?? ((string?)l["name"] is string n ? Net.MavenPath(n) : null);
            if (rel == null) continue;
            var ours = Path.Combine(Paths.Libraries, rel.Replace('/', Path.DirectorySeparatorChar));
            var theirs = Path.Combine(McDir, "libraries", rel.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(ours) || File.Exists(theirs)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(theirs)!);
            File.Copy(ours, theirs);
        }

        // profile (newest lastUsed = preselected in the launcher)
        var pf = Path.Combine(McDir, "launcher_profiles.json");
        Directory.CreateDirectory(McDir);
        JsonObject root;
        try { root = File.Exists(pf) ? JsonNode.Parse(await File.ReadAllTextAsync(pf, ct)) as JsonObject ?? new JsonObject() : new JsonObject(); }
        catch { root = new JsonObject(); }
        if (root["profiles"] is not JsonObject profiles) { profiles = new JsonObject(); root["profiles"] = profiles; }
        root["version"] ??= 3; root["settings"] ??= new JsonObject();
        var ram = inst.RamMb > 0 ? inst.RamMb : set.RamMb > 0 ? set.RamMb : 4096;
        var name = "Orbit · " + inst.Name;
        var now = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        var key = "orbit-" + inst.Id;
        var prof = profiles[key] as JsonObject ?? new JsonObject { ["created"] = now };
        prof["name"] = name;
        prof["type"] = "custom";
        prof["lastVersionId"] = id;
        prof["gameDir"] = inst.Dir;
        prof["icon"] = "Grass";
        prof["javaArgs"] = $"-Xmx{ram}M -Xms{Math.Min(ram, 512)}M" + (string.IsNullOrWhiteSpace(inst.JvmArgs ?? set.JvmArgs) ? "" : " " + (inst.JvmArgs ?? set.JvmArgs));
        prof["lastUsed"] = now;
        profiles[key] = prof;
        var tmp = pf + ".orbit.tmp";
        await File.WriteAllTextAsync(tmp, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), ct);
        File.Move(tmp, pf, true);
        return name;
    }

    /// <summary>Opens the official launcher (classic install, Xbox app or Microsoft Store).</summary>
    public static bool Open()
    {
        var exe = FindExe();
        try
        {
            if (exe != null) Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe)! });
            else Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft") { UseShellExecute = true });
            return true;
        }
        catch { return false; }
    }
}
