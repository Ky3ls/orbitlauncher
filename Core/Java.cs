using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

public record JavaInfo(string Path, int Major, string Source);

/// <summary>Finds or downloads the right Java runtime: Mojang's official runtime manifest first, Eclipse Adoptium (Temurin) as fallback.</summary>
public static class Java
{
    private const string MojangAll = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
    private static readonly SemaphoreSlim Lock = new(1, 1);

    private static string Platform => (Rules.Os, Rules.Arch) switch
    {
        ("windows", "arm64") => "windows-arm64",
        ("windows", "x86") => "windows-x86",
        ("windows", _) => "windows-x64",
        ("osx", "arm64") => "mac-os-arm64",
        ("osx", _) => "mac-os",
        ("linux", "x86") => "linux-i386",
        _ => "linux",
    };

    private static string Exe(string home)
    {
        var bin = Path.Combine(home, "bin");
        if (OperatingSystem.IsWindows()) return Path.Combine(bin, "java.exe");
        if (OperatingSystem.IsMacOS() && Directory.Exists(Path.Combine(home, "jre.bundle"))) return Path.Combine(home, "jre.bundle", "Contents", "Home", "bin", "java");
        return Path.Combine(bin, "java");
    }

    /// <summary>All runtimes managed by OrbitLauncher.</summary>
    public static List<JavaInfo> Installed()
    {
        var r = new List<JavaInfo>();
        foreach (var d in Directory.GetDirectories(Paths.Runtime))
        {
            var exe = Exe(d);
            if (!File.Exists(exe)) continue;
            var name = Path.GetFileName(d);
            var marker = Path.Combine(d, ".orbit-major");
            int major = File.Exists(marker) && int.TryParse(File.ReadAllText(marker), out var m) ? m : 0;
            r.Add(new JavaInfo(exe, major, name.StartsWith("temurin") ? "Adoptium" : "Mojang"));
        }
        return r;
    }

    public static async Task<string> Ensure(int major, string component, IProgress<Progress>? p, CancellationToken ct = default)
    {
        await Lock.WaitAsync(ct);
        try
        {
            var mojangHome = Path.Combine(Paths.Runtime, component);
            if (File.Exists(Path.Combine(mojangHome, ".orbit-ok")) && File.Exists(Exe(mojangHome))) return Exe(mojangHome);
            var temurinHome = Path.Combine(Paths.Runtime, "temurin-" + major);
            if (File.Exists(Path.Combine(temurinHome, ".orbit-ok")) && File.Exists(Exe(temurinHome))) return Exe(temurinHome);

            try { return await Mojang(component, major, mojangHome, p, ct); }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                p?.Report(new Progress("Java (Adoptium)", 0, 1, "Mojang-Runtime nicht verfügbar, nutze Temurin"));
                return await Adoptium(major, temurinHome, p, ct);
            }
        }
        finally { Lock.Release(); }
    }

    private static async Task<string> Mojang(string component, int major, string home, IProgress<Progress>? p, CancellationToken ct)
    {
        var all = await Net.Json(MojangAll, ct);
        var entry = all[Platform]?[component]?.AsArray().FirstOrDefault() ?? throw new InvalidOperationException("Keine Mojang-Runtime für " + component);
        var manifest = await Net.Json((string)entry["manifest"]!["url"]!, ct);
        var files = manifest["files"]!.AsObject();
        var dl = new List<DlItem>();
        var exec = new List<string>();
        foreach (var (rel, f) in files)
        {
            var path = Path.Combine(home, rel.Replace('/', Path.DirectorySeparatorChar));
            switch ((string?)f!["type"])
            {
                case "directory": Directory.CreateDirectory(path); break;
                case "file":
                    var raw = f["downloads"]!["raw"]!;
                    dl.Add(new DlItem((string)raw["url"]!, path, (string?)raw["sha1"], (long?)raw["size"] ?? 0));
                    if ((bool?)f["executable"] == true) exec.Add(path);
                    break;
            }
        }
        await Net.DownloadAll(dl, $"Java {major} (Mojang)", p, ct);
        foreach (var (rel, f) in files)
            if ((string?)f!["type"] == "link" && !OperatingSystem.IsWindows())
            {
                var path = Path.Combine(home, rel);
                try { if (!File.Exists(path)) File.CreateSymbolicLink(path, (string)f["target"]!); } catch { }
            }
        if (!OperatingSystem.IsWindows())
            foreach (var e in exec) try { File.SetUnixFileMode(e, (UnixFileMode)0b111_101_101); } catch { }
        File.WriteAllText(Path.Combine(home, ".orbit-major"), major.ToString());
        File.WriteAllText(Path.Combine(home, ".orbit-ok"), (string?)entry["version"]?["name"] ?? "");
        return Exe(home);
    }

    private static async Task<string> Adoptium(int major, string home, IProgress<Progress>? p, CancellationToken ct)
    {
        // Temurin has no 16 GA JRE for every platform anymore; 17 runs 1.17 fine
        var feature = major == 16 ? 17 : major;
        var os = Rules.Os == "osx" ? "mac" : Rules.Os;
        var arch = Rules.Arch == "arm64" ? "aarch64" : Rules.Arch == "x86" ? "x32" : "x64";
        var ext = OperatingSystem.IsWindows() ? "zip" : "tar.gz";
        var url = $"https://api.adoptium.net/v3/binary/latest/{feature}/ga/{os}/{arch}/jre/hotspot/normal/eclipse";
        var tmp = Path.Combine(Paths.Cache, $"temurin-{feature}.{ext}");
        p?.Report(new Progress($"Java {feature} (Adoptium)", 0, 1, "Download"));
        long got = 0;
        try { File.Delete(tmp); } catch { }
        await Net.Download(new DlItem(url, tmp), ct, n => { got += n; p?.Report(new Progress($"Java {feature} (Adoptium)", 0, 1, $"{got / 1048576.0:0.0} MB")); });
        if (Directory.Exists(home)) Directory.Delete(home, true);
        var unpack = home + ".unpack";
        if (Directory.Exists(unpack)) Directory.Delete(unpack, true);
        Directory.CreateDirectory(unpack);
        if (ext == "zip") ZipFile.ExtractToDirectory(tmp, unpack);
        else
        {
            using var t = Process.Start(new ProcessStartInfo("tar", $"-xzf \"{tmp}\" -C \"{unpack}\"") { UseShellExecute = false })!;
            await t.WaitForExitAsync(ct);
        }
        // archive contains one top folder (jdk-21.0.x+y-jre)
        var top = Directory.GetDirectories(unpack).FirstOrDefault() ?? unpack;
        Directory.Move(top, home);
        try { Directory.Delete(unpack, true); File.Delete(tmp); } catch { }
        File.WriteAllText(Path.Combine(home, ".orbit-major"), feature.ToString());
        File.WriteAllText(Path.Combine(home, ".orbit-ok"), "temurin");
        return Exe(home);
    }

    /// <summary>Reads "java -version" of a custom path; returns major or 0.</summary>
    public static async Task<int> ProbeMajor(string exe)
    {
        try
        {
            var psi = new ProcessStartInfo(exe, "-version") { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var pr = Process.Start(psi)!;
            var txt = await pr.StandardError.ReadToEndAsync() + await pr.StandardOutput.ReadToEndAsync();
            await pr.WaitForExitAsync();
            var m = System.Text.RegularExpressions.Regex.Match(txt, "version \"(\\d+)(?:\\.(\\d+))?");
            if (!m.Success) return 0;
            var a = int.Parse(m.Groups[1].Value);
            return a == 1 && m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : a;
        }
        catch { return 0; }
    }
}
