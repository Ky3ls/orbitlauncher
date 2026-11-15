using System.Diagnostics;
using System.IO.Compression;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>Minecraft Server List Ping (the same status request the multiplayer screen sends).</summary>
public static class ServerPing
{
    public record Status(bool Online, int Players, int Max, string? Motd, string? Version, int Ping, string? Icon);

    public static async Task<Status> Ping(string address, int timeoutMs = 3500)
    {
        var (host, port) = Split(address);
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            // SRV record (_minecraft._tcp) is not resolved here; most servers also answer on the A record.
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(host, port, cts.Token);
            using var s = tcp.GetStream();
            var hs = new MemoryStream();
            VarInt(hs, 0x00); VarInt(hs, 767); Str(hs, host); hs.WriteByte((byte)(port >> 8)); hs.WriteByte((byte)port); VarInt(hs, 1);
            await Packet(s, hs.ToArray(), cts.Token);
            await Packet(s, new byte[] { 0x00 }, cts.Token);
            await ReadVarInt(s, cts.Token);                         // length
            if (await ReadVarInt(s, cts.Token) != 0) throw new IOException();
            int len = await ReadVarInt(s, cts.Token);
            if (len <= 0 || len > 1 << 21) throw new IOException();
            var buf = new byte[len]; int got = 0;
            while (got < len) { int n = await s.ReadAsync(buf.AsMemory(got), cts.Token); if (n <= 0) throw new IOException(); got += n; }
            var j = JsonNode.Parse(Encoding.UTF8.GetString(buf))!;
            var sw = Stopwatch.StartNew();
            var pp = new MemoryStream(); pp.WriteByte(0x01); pp.Write(BitConverter.GetBytes(DateTime.UtcNow.Ticks));
            await Packet(s, pp.ToArray(), cts.Token);
            try { await ReadVarInt(s, cts.Token); } catch { }
            int ping = (int)sw.ElapsedMilliseconds;
            return new Status(true, (int?)j["players"]?["online"] ?? 0, (int?)j["players"]?["max"] ?? 0, MotdText(j["description"]), (string?)j["version"]?["name"], ping, (string?)j["favicon"]);
        }
        catch { return new Status(false, 0, 0, null, null, -1, null); }
    }

    private static (string, int) Split(string a)
    {
        var i = a.LastIndexOf(':');
        return i > 0 && int.TryParse(a[(i + 1)..], out var p) ? (a[..i], p) : (a, 25565);
    }
    private static string MotdText(JsonNode? d)
    {
        if (d == null) return "";
        if (d is JsonValue v) return Strip((string?)v ?? "");
        var sb = new StringBuilder((string?)d["text"] ?? "");
        foreach (var e in d["extra"]?.AsArray() ?? new JsonArray()) sb.Append(MotdText(e));
        return Strip(sb.ToString());
    }
    private static string Strip(string s) => System.Text.RegularExpressions.Regex.Replace(s, "§.", "").Trim();
    private static void VarInt(Stream s, int v) { uint u = (uint)v; do { byte b = (byte)(u & 0x7F); u >>= 7; if (u != 0) b |= 0x80; s.WriteByte(b); } while (u != 0); }
    private static void Str(Stream s, string v) { var b = Encoding.UTF8.GetBytes(v); VarInt(s, b.Length); s.Write(b); }
    private static async Task Packet(Stream s, byte[] data, CancellationToken ct) { var m = new MemoryStream(); VarInt(m, data.Length); m.Write(data); await s.WriteAsync(m.ToArray(), ct); }
    private static async Task<int> ReadVarInt(Stream s, CancellationToken ct)
    {
        int r = 0, shift = 0; var one = new byte[1];
        while (true)
        {
            if (await s.ReadAsync(one, ct) <= 0) throw new IOException();
            r |= (one[0] & 0x7F) << shift;
            if ((one[0] & 0x80) == 0) return r;
            shift += 7; if (shift > 35) throw new IOException();
        }
    }
}

/// <summary>World backups as zip files in %APPDATA%\OrbitLauncher\backups\&lt;instance&gt;.</summary>
public static class Backups
{
    public record Entry(string File, string World, DateTime Date, long Size);
    private static string Dir(Instance i) => Paths.Dir(Path.Combine("backups", i.Id));

    public static Entry Create(Instance inst, string folder)
    {
        var src = Worlds.WorldDir(inst, folder);
        var name = $"{Path.GetFileName(src)}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.zip";
        var dst = Path.Combine(Dir(inst), name);
        using (var z = ZipFile.Open(dst, ZipArchiveMode.Create))
            foreach (var f in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
            {
                if (Path.GetFileName(f) == "session.lock") continue;
                using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                var e = z.CreateEntry(Path.GetFileName(src) + "/" + Path.GetRelativePath(src, f).Replace('\\', '/'), CompressionLevel.Fastest);
                using var es = e.Open(); fs.CopyTo(es);
            }
        var fi = new FileInfo(dst);
        return new Entry(name, Path.GetFileName(src), fi.LastWriteTimeUtc, fi.Length);
    }

    public static List<Entry> List(Instance inst) =>
        new DirectoryInfo(Dir(inst)).GetFiles("*.zip").OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => new Entry(f.Name, f.Name.Length > 24 ? f.Name[..^24] : f.Name, f.LastWriteTimeUtc, f.Length)).ToList();

    private static string FileOf(Instance inst, string file)
    {
        var d = Path.GetFullPath(Dir(inst)); var f = Path.GetFullPath(Path.Combine(d, Path.GetFileName(file)));
        if (!f.StartsWith(d) || !File.Exists(f)) throw new InvalidOperationException("Backup nicht gefunden");
        return f;
    }
    public static void Delete(Instance inst, string file) => File.Delete(FileOf(inst, file));

    /// <summary>Restores as a new world folder (never overwrites the current one).</summary>
    public static string Restore(Instance inst, string file)
    {
        var f = FileOf(inst, file);
        var saves = Path.GetFullPath(Path.Combine(inst.Dir, "saves")); Directory.CreateDirectory(saves);
        using var z = ZipFile.OpenRead(f);
        var top = z.Entries.FirstOrDefault()?.FullName.Split('/')[0] ?? "Welt";
        var target = top + " (Backup " + DateTime.Now.ToString("dd.MM HH-mm") + ")";
        foreach (var e in z.Entries)
        {
            if (e.FullName.EndsWith('/')) continue;
            var rel = e.FullName.Contains('/') ? e.FullName[(e.FullName.IndexOf('/') + 1)..] : e.FullName;
            var dst = Path.GetFullPath(Path.Combine(saves, target, rel));
            if (!dst.StartsWith(saves + Path.DirectorySeparatorChar)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            e.ExtractToFile(dst, true);
        }
        return target;
    }
}

/// <summary>Exports an instance as Modrinth modpack (.mrpack) and imports instances from other launchers.</summary>
public static class Transfer
{
    public static async Task Export(Instance inst, string target, string version, bool includeWorlds, IProgress<Progress>? p, CancellationToken ct = default)
    {
        var files = new JsonArray();
        var linked = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // files that exist on Modrinth are referenced by URL, everything else goes into overrides
        var all = new[] { "mod", "resourcepack", "shader" }.SelectMany(t => Directory.Exists(Instances.ContentDir(inst, t)) ? Directory.GetFiles(Instances.ContentDir(inst, t)).Select(f => (t, f)) : Enumerable.Empty<(string, string)>())
            .Where(x => !x.Item2.EndsWith(".disabled")).ToList();
        if (all.Count > 0)
        {
            p?.Report(new Progress("Dateien werden im Katalog gesucht", 0, 1, all.Count + " Dateien"));
            var hashes = all.ToDictionary(x => x.Item2, x => Net.Sha1(x.Item2));
            var body = new JsonObject { ["hashes"] = new JsonArray(hashes.Values.Distinct().Select(h => (JsonNode)h).ToArray()), ["algorithm"] = "sha1" };
            JsonNode found;
            try { found = await Net.Post($"{Modrinth.Api}/version_files", body.ToJsonString(), null, ct); } catch { found = new JsonObject(); }
            foreach (var (t, f) in all)
            {
                var v = found[hashes[f]]; if (v == null) continue;
                var file = v["files"]!.AsArray().FirstOrDefault(x => (string?)x!["hashes"]?["sha1"] == hashes[f]); if (file == null) continue;
                var rel = Path.GetRelativePath(inst.Dir, f).Replace('\\', '/');
                files.Add(new JsonObject
                {
                    ["path"] = rel, ["hashes"] = new JsonObject { ["sha1"] = hashes[f], ["sha512"] = (string?)file["hashes"]?["sha512"] ?? Net.Sha512(f) },
                    ["env"] = new JsonObject { ["client"] = "required", ["server"] = t == "mod" ? "required" : "unsupported" },
                    ["downloads"] = new JsonArray((string)file["url"]!), ["fileSize"] = new FileInfo(f).Length,
                });
                linked.Add(f);
            }
        }
        var deps = new JsonObject { ["minecraft"] = inst.McVersion };
        if (inst.Loader != "vanilla" && inst.LoaderVersion != null)
            deps[inst.Loader switch { "fabric" => "fabric-loader", "quilt" => "quilt-loader", _ => inst.Loader }] = inst.Loader == "forge" && inst.LoaderVersion.StartsWith(inst.McVersion + "-") ? inst.LoaderVersion[(inst.McVersion.Length + 1)..] : inst.LoaderVersion;
        var index = new JsonObject { ["formatVersion"] = 1, ["game"] = "minecraft", ["versionId"] = version, ["name"] = inst.Name, ["files"] = files, ["dependencies"] = deps };
        p?.Report(new Progress("Modpack wird gepackt", 0, 1, Path.GetFileName(target)));
        await Task.Run(() =>
        {
            if (File.Exists(target)) File.Delete(target);
            using var z = ZipFile.Open(target, ZipArchiveMode.Create);
            using (var w = new StreamWriter(z.CreateEntry("modrinth.index.json").Open())) w.Write(index.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            var keep = new[] { "mods", "resourcepacks", "shaderpacks", "config", "defaultconfigs", "kubejs", "options.txt", "servers.dat" }.ToList();
            if (includeWorlds) keep.Add("saves");
            foreach (var k in keep)
            {
                var path = Path.Combine(inst.Dir, k);
                var list = File.Exists(path) ? new[] { path } : Directory.Exists(path) ? Directory.GetFiles(path, "*", SearchOption.AllDirectories) : Array.Empty<string>();
                foreach (var f in list)
                {
                    if (linked.Contains(f) || f.EndsWith(".disabled") || Path.GetFileName(f) == "session.lock") continue;
                    var e = z.CreateEntry("overrides/" + Path.GetRelativePath(inst.Dir, f).Replace('\\', '/'), CompressionLevel.Optimal);
                    using var es = e.Open(); using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); fs.CopyTo(es);
                }
            }
        }, ct);
    }

    public record Found(string Launcher, string Name, string Path, string Mc, string Loader, string? LoaderVersion);

    /// <summary>Instances of Prism Launcher / MultiMC and the CurseForge app on this PC.</summary>
    public static List<Found> Scan()
    {
        var r = new List<Found>();
        var appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var (name, dir) in new[] { ("Prism Launcher", Path.Combine(appdata, "PrismLauncher", "instances")), ("MultiMC", Path.Combine(home, "MultiMC", "instances")), ("PolyMC", Path.Combine(appdata, "PolyMC", "instances")) })
        {
            if (!Directory.Exists(dir)) continue;
            foreach (var d in Directory.GetDirectories(dir))
            {
                try
                {
                    var pack = Path.Combine(d, "mmc-pack.json"); if (!File.Exists(pack)) continue;
                    var j = JsonNode.Parse(File.ReadAllText(pack))!;
                    string mc = "", loader = "vanilla"; string? lv = null;
                    foreach (var c in j["components"]!.AsArray())
                    {
                        var uid = (string?)c!["uid"]; var v = (string?)c["version"];
                        if (uid == "net.minecraft") mc = v ?? "";
                        else if (uid == "net.fabricmc.fabric-loader") { loader = "fabric"; lv = v; }
                        else if (uid == "org.quiltmc.quilt-loader") { loader = "quilt"; lv = v; }
                        else if (uid == "net.minecraftforge") { loader = "forge"; lv = v; }
                        else if (uid == "net.neoforged") { loader = "neoforge"; lv = v; }
                    }
                    var title = File.ReadLines(Path.Combine(d, "instance.cfg")).FirstOrDefault(l => l.StartsWith("name="))?[5..] ?? Path.GetFileName(d);
                    var mcDir = Directory.Exists(Path.Combine(d, ".minecraft")) ? Path.Combine(d, ".minecraft") : Path.Combine(d, "minecraft");
                    if (mc.Length > 0) r.Add(new Found(name, title, mcDir, mc, loader, loader == "forge" && lv != null ? mc + "-" + lv : lv));
                }
                catch { }
            }
        }
        var cf = Path.Combine(home, "curseforge", "minecraft", "Instances");
        if (Directory.Exists(cf))
            foreach (var d in Directory.GetDirectories(cf))
            {
                try
                {
                    var f = Path.Combine(d, "minecraftinstance.json"); if (!File.Exists(f)) continue;
                    var j = JsonNode.Parse(File.ReadAllText(f))!;
                    var mc = (string?)j["gameVersion"] ?? "";
                    var lid = (string?)j["baseModLoader"]?["name"] ?? "";
                    string loader = "vanilla"; string? lv = null;
                    if (lid.Contains('-')) { loader = lid[..lid.IndexOf('-')]; lv = lid[(lid.IndexOf('-') + 1)..]; if (loader == "forge") lv = mc + "-" + lv; }
                    if (mc.Length > 0) r.Add(new Found("Mod-Launcher", (string?)j["name"] ?? Path.GetFileName(d), d, mc, loader, lv));
                }
                catch { }
            }
        return r;
    }

    public static async Task<Instance> Import(Found f, IProgress<Progress>? p, CancellationToken ct = default)
    {
        var inst = Instances.Create(f.Name, f.Mc, f.Loader, f.LoaderVersion);
        inst.Group = f.Launcher; inst.Icon = "wood";
        Instances.Save(inst);
        var list = Directory.GetFiles(f.Path, "*", SearchOption.AllDirectories)
            .Where(x => { var rel = Path.GetRelativePath(f.Path, x); return !rel.StartsWith("logs") && !rel.StartsWith("crash-reports") && !rel.StartsWith(".fabric") && Path.GetFileName(x) != "minecraftinstance.json"; }).ToList();
        int i = 0;
        await Task.Run(() =>
        {
            foreach (var x in list)
            {
                if (++i % 25 == 0) p?.Report(new Progress("Import aus " + f.Launcher, i, list.Count, f.Name));
                var dst = Path.Combine(inst.Dir, Path.GetRelativePath(f.Path, x));
                Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
                File.Copy(x, dst, true);
            }
        }, ct);
        return inst;
    }
}

/// <summary>Discord Rich Presence over the local Discord IPC pipe (no SDK, no network).</summary>
public sealed class DiscordRpc : IDisposable
{
    private readonly string _appId;
    private NamedPipeClientStream? _pipe;
    public DiscordRpc(string appId) { _appId = appId; }

    private bool Connect()
    {
        if (_pipe is { IsConnected: true }) return true;
        for (int i = 0; i < 10; i++)
        {
            try
            {
                var p = new NamedPipeClientStream(".", "discord-ipc-" + i, PipeDirection.InOut, PipeOptions.Asynchronous);
                p.Connect(150);
                _pipe = p;
                Write(0, new { v = 1, client_id = _appId });
                Read();
                return true;
            }
            catch { }
        }
        return false;
    }

    private void Write(int op, object payload)
    {
        var json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        var buf = new byte[8 + json.Length];
        BitConverter.GetBytes(op).CopyTo(buf, 0); BitConverter.GetBytes(json.Length).CopyTo(buf, 4); json.CopyTo(buf, 8);
        _pipe!.Write(buf); _pipe.Flush();
    }
    private void Read()
    {
        var head = new byte[8]; if (_pipe!.Read(head, 0, 8) < 8) return;
        var len = BitConverter.ToInt32(head, 4); var body = new byte[len]; int got = 0;
        while (got < len) { var n = _pipe.Read(body, got, len - got); if (n <= 0) break; got += n; }
    }

    public void Set(string? details, string? state, DateTime? start)
    {
        lock (this) SetLocked(details, state, start);
    }
    private void SetLocked(string? details, string? state, DateTime? start)
    {
        try
        {
            if (!Connect()) return;
            object? activity = details == null ? null : new
            {
                details, state,
                timestamps = start != null ? new { start = new DateTimeOffset(start.Value).ToUnixTimeSeconds() } : null,
                assets = new { large_image = "orbit", large_text = "OrbitLauncher" },
                instance = false,
            };
            Write(1, new { cmd = "SET_ACTIVITY", args = new { pid = Environment.ProcessId, activity }, nonce = Guid.NewGuid().ToString() });
            Read();
        }
        catch { try { _pipe?.Dispose(); } catch { } _pipe = null; }
    }

    public void Dispose() { try { _pipe?.Dispose(); } catch { } }
}
