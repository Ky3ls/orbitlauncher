using System.IO.Compression;
using System.Text;

namespace OrbitLauncher.Core;

/// <summary>Worlds (saves), servers (servers.dat) and log files of an instance.</summary>
public static class Worlds
{
    public record World(string Folder, string Name, DateTime LastPlayed, bool Icon, string? Mode, bool Hardcore);
    public record Server(string Name, string Ip, string? Icon);
    public record LogFile(string Name, long Size, DateTime Date);

    // level.dat is only parsed again when it changed (modded worlds can have multi-MB level.dat files)
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime at, long len, World w)> Cache = new(StringComparer.OrdinalIgnoreCase);

    public static List<World> List(Instance inst)
    {
        var d = Path.Combine(inst.Dir, "saves");
        if (!Directory.Exists(d)) return new();
        var dirs = new DirectoryInfo(d).GetDirectories();
        var r = new World?[dirs.Length];
        Parallel.For(0, dirs.Length, new ParallelOptions { MaxDegreeOfParallelism = Math.Min(4, Environment.ProcessorCount) }, k => r[k] = Read(dirs[k]));
        return r.Where(w => w != null).Select(w => w!).OrderByDescending(w => w.LastPlayed).ToList();
    }

    private static World? Read(DirectoryInfo w)
    {
        var lf = new FileInfo(Path.Combine(w.FullName, "level.dat"));
        if (!lf.Exists) return null;
        var icon = File.Exists(Path.Combine(w.FullName, "icon.png"));
        if (Cache.TryGetValue(w.FullName, out var c) && c.at == lf.LastWriteTimeUtc && c.len == lf.Length) return c.w with { Icon = icon };
        string name = w.Name; string? mode = null; bool hc = false; DateTime last = lf.LastWriteTimeUtc;
        try
        {
            using var fs = new FileStream(lf.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16);
            using var gz = new GZipStream(fs, CompressionMode.Decompress);
            using var bs = new BufferedStream(gz, 1 << 16);
            var root = Nbt.Read(bs);
            if (root.TryGetValue("Data", out var dataObj) && dataObj is Dictionary<string, object> data)
            {
                if (data.TryGetValue("LevelName", out var n) && n is string s && s.Length > 0) name = s;
                if (data.TryGetValue("GameType", out var g) && g is int gt) mode = gt switch { 0 => "Überleben", 1 => "Kreativ", 2 => "Abenteuer", 3 => "Zuschauer", _ => null };
                if (data.TryGetValue("hardcore", out var h) && h is sbyte hb) hc = hb != 0;
                if (data.TryGetValue("LastPlayed", out var lp) && lp is long ms && ms > 0) last = DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
            }
        }
        catch { }
        var world = new World(w.Name, name, last, icon, hc ? "Hardcore" : mode, hc);
        Cache[w.FullName] = (lf.LastWriteTimeUtc, lf.Length, world);
        return world;
    }

    /// <summary>Saved servers with their icons, servers.dat read once.</summary>
    public static List<Server> Servers(Instance inst)
    {
        var f = Path.Combine(inst.Dir, "servers.dat");
        if (!File.Exists(f)) return new();
        try
        {
            using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16);
            var root = Nbt.Read(fs);
            if (root.TryGetValue("servers", out var l) && l is List<object> list)
                return list.OfType<Dictionary<string, object>>().Select(s => new Server(
                    s.TryGetValue("name", out var n) ? n as string ?? "Server" : "Server",
                    s.TryGetValue("ip", out var ip) ? ip as string ?? "" : "",
                    s.TryGetValue("icon", out var ic) && ic is string b64 && b64.Length > 0 ? "data:image/png;base64," + b64 : null)).Where(s => s.Ip.Length > 0).ToList();
        }
        catch { }
        return new();
    }

    public static string WorldDir(Instance inst, string folder)
    {
        var root = Path.GetFullPath(Path.Combine(inst.Dir, "saves"));
        var d = Path.GetFullPath(Path.Combine(root, Path.GetFileName(folder)));
        if (!d.StartsWith(root) || !Directory.Exists(d)) throw new InvalidOperationException("Welt nicht gefunden");
        return d;
    }

    public static List<LogFile> Logs(Instance inst)
    {
        var r = new List<LogFile>();
        foreach (var sub in new[] { "logs", "crash-reports" })
        {
            var d = Path.Combine(inst.Dir, sub);
            if (!Directory.Exists(d)) continue;
            r.AddRange(new DirectoryInfo(d).GetFiles().Where(f => f.Name.EndsWith(".log") || f.Name.EndsWith(".log.gz") || f.Name.EndsWith(".txt"))
                .Select(f => new LogFile(sub + "/" + f.Name, f.Length, f.LastWriteTimeUtc)));
        }
        return r.OrderByDescending(f => f.Date).Take(200).ToList();
    }

    public static string ReadLog(Instance inst, string name)
    {
        var parts = name.Split('/');
        if (parts.Length != 2 || parts[0] is not ("logs" or "crash-reports")) throw new InvalidOperationException("Ungültige Log-Datei");
        var dir = Path.GetFullPath(Path.Combine(inst.Dir, parts[0]));
        var f = Path.GetFullPath(Path.Combine(dir, Path.GetFileName(parts[1])));
        if (!f.StartsWith(dir) || !File.Exists(f)) throw new InvalidOperationException("Log nicht gefunden");
        using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        Stream s = f.EndsWith(".gz") ? new GZipStream(fs, CompressionMode.Decompress) : fs;
        using var rd = new StreamReader(s, Encoding.UTF8);
        var text = rd.ReadToEnd();
        return text.Length > 2_000_000 ? text[^2_000_000..] : text;
    }
}

/// <summary>Minimal reader for Minecraft's NBT format (big endian). Returns the root compound.</summary>
public static class Nbt
{
    public static Dictionary<string, object> Read(Stream s)
    {
        var r = new BinaryReader(s);
        if (r.ReadByte() != 10) throw new InvalidDataException("Kein NBT");
        ReadString(r);
        return (Dictionary<string, object>)Payload(r, 10, 0);
    }

    private static short I16(BinaryReader r) => System.Buffers.Binary.BinaryPrimitives.ReverseEndianness(r.ReadInt16());
    private static int I32(BinaryReader r) => System.Buffers.Binary.BinaryPrimitives.ReverseEndianness(r.ReadInt32());
    private static long I64(BinaryReader r) => (long)(uint)I32(r) << 32 | (uint)I32(r);
    private static string ReadString(BinaryReader r) { int n = (ushort)I16(r); return Encoding.UTF8.GetString(r.ReadBytes(n)); }

    private static readonly byte[] Junk = new byte[1 << 14];
    private static void Skip(BinaryReader r, long n) { while (n > 0) { var k = r.BaseStream.Read(Junk, 0, (int)Math.Min(n, Junk.Length)); if (k <= 0) throw new EndOfStreamException(); n -= k; } }

    private static object Payload(BinaryReader r, byte t, int depth)
    {
        if (depth > 64) throw new InvalidDataException("NBT zu tief");
        switch (t)
        {
            case 1: return (sbyte)r.ReadByte();
            case 2: return I16(r);
            case 3: return I32(r);
            case 4: return I64(r);
            case 5: return BitConverter.Int32BitsToSingle(I32(r));
            case 6: return BitConverter.Int64BitsToDouble(I64(r));
            case 7: { int n = I32(r); Skip(r, n); return Array.Empty<byte>(); }
            case 8: return ReadString(r);
            case 9:
            {
                byte et = r.ReadByte(); int n = I32(r);
                var l = new List<object>(Math.Max(0, Math.Min(n, 4096)));
                for (int i = 0; i < n; i++) l.Add(Payload(r, et, depth + 1));
                return l;
            }
            case 10:
            {
                var d = new Dictionary<string, object>();
                while (true)
                {
                    byte ct = r.ReadByte();
                    if (ct == 0) return d;
                    var name = ReadString(r);
                    d[name] = Payload(r, ct, depth + 1);
                }
            }
            case 11: { int n = I32(r); Skip(r, n * 4L); return Array.Empty<int>(); }
            case 12: { int n = I32(r); Skip(r, n * 8L); return Array.Empty<long>(); }
        }
        throw new InvalidDataException("Unbekannter NBT-Typ " + t);
    }
}
