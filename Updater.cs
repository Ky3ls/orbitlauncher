using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

using OrbitLauncher.Core;

namespace OrbitLauncher;

/// <summary>
/// In-app updates: GitHub Releases of a private repository, handed out by the Orbit server only to PCs with access.
/// Release flow: bump &lt;Version&gt; in OrbitLauncher.csproj, build, then create a GitHub release
/// tagged "v&lt;version&gt;" with OrbitLauncher.exe attached. Each bullet line ("- ...") in the
/// release text is shown as a changelog entry in the app.
/// </summary>
internal static class Updater
{
    /// <summary>GitHub repository that hosts the releases.</summary>
    public const string Repo = "Ky3ls/orbitlauncher";

    private static string? _url, _sha;
    private static long _size;
    private static Version? _latest;
    private static string TempFile => Path.Combine(Path.GetTempPath(), "OrbitLauncher-update.exe");
    /// <summary>Next to the running exe when possible: then installing is a rename, not a 90 MB copy that is scanned again.</summary>
    private static string NewFile
    {
        get
        {
            try
            {
                if (Environment.ProcessPath is { } p)
                {
                    var f = p + ".new";
                    using (File.Create(f, 1, FileOptions.DeleteOnClose)) { }
                    return f;
                }
            }
            catch { }
            return TempFile;
        }
    }
    private static string? _file;

    public static Version Current
    {
        get { var v = Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0); return new Version(v.Major, v.Minor, Math.Max(0, v.Build)); }
    }

    public static bool Configured => !Repo.StartsWith("OWNER");

    /// <summary>Removes the previous exe left over from the last update.</summary>
    public static void CleanupOld()
    {
        try { if (Environment.ProcessPath is { } p && File.Exists(p + ".old")) File.Delete(p + ".old"); } catch { }
        try { if (File.Exists(TempFile)) File.Delete(TempFile); } catch { }
        try { if (Environment.ProcessPath is { } p && File.Exists(p + ".new")) File.Delete(p + ".new"); } catch { }
    }

    public static async Task<object> Check()
    {
        var current = Current.ToString(3);
        if (!Configured) return new { configured = false, current, available = false };
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Cloud.Api.TrimEnd('/') + "/v1/app/latest");
            Access.Sign(req);
            using var res = await Net.Http.SendAsync(req);
            if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
                return new { configured = true, current, available = false, noRelease = true };
            res.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            var r = doc.RootElement;
            var tag = (r.GetProperty("tag").GetString() ?? "0.0.0").TrimStart('v', 'V');
            if (!Version.TryParse(tag, out var latest)) latest = new Version(0, 0, 0);
            _latest = new Version(latest.Major, latest.Minor, Math.Max(0, latest.Build));

            _url = null; _sha = null; _size = 0;
            if (r.TryGetProperty("has", out var has) && has.GetBoolean())
            {
                _url = Cloud.Api.TrimEnd('/') + "/v1/app/download";
                _size = r.GetProperty("size").GetInt64();
                if (r.TryGetProperty("digest", out var d) && d.ValueKind == JsonValueKind.String && d.GetString()!.StartsWith("sha256:"))
                    _sha = d.GetString()![7..];
            }

            var body = r.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
            var notes = body.Split('\n').Select(l => l.Trim()).Where(l => l.StartsWith("- ") || l.StartsWith("* "))
                            .Select(l => l[2..].Trim()).Take(12).ToArray();
            var date = r.TryGetProperty("published", out var p) && p.TryGetDateTime(out var dt) ? dt.ToLocalTime().ToString("dd.MM.yyyy") : "";

            return new { configured = true, current, latest = _latest.ToString(3), available = _latest > Current && _url != null, notes, date, size = _size };
        }
        catch (Exception ex) { return new { configured = true, current, available = false, error = ex.Message }; }
    }

    public static async Task Download(Action<int, long, long> progress)
    {
        if (_url == null) throw new InvalidOperationException("Kein Update gefunden – bitte erneut prüfen.");
        _file = NewFile;
        using var http = new HttpClient(new SocketsHttpHandler { MaxConnectionsPerServer = 16, AutomaticDecompression = System.Net.DecompressionMethods.None }) { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("OrbitLauncher/" + Current.ToString(3));
        if (Access.Token() is string acc) http.DefaultRequestHeaders.Add("X-Orbit-Access", acc);
        // GitHub redirects to its file server; resolve once, then fetch several parts at the same time
        using var head = await http.GetAsync(_url, HttpCompletionOption.ResponseHeadersRead);
        head.EnsureSuccessStatusCode();
        var total = head.Content.Headers.ContentLength ?? _size;
        var real = head.RequestMessage?.RequestUri ?? new Uri(_url);
        long done = 0; int lastPct = -1; var gate = new object();
        void Add(int n)
        {
            var d = Interlocked.Add(ref done, n);
            var pct = total > 0 ? (int)(d * 100 / total) : 0;
            lock (gate) if (pct != lastPct) { lastPct = pct; progress(pct, d, total); }
        }
        var parallel = total > 8_000_000 && head.Headers.AcceptRanges.Contains("bytes");
        if (parallel)
        {
            head.Dispose();
            try
            {
                using (var fs = new FileStream(_file, FileMode.Create, FileAccess.Write, FileShare.ReadWrite)) fs.SetLength(total);
                using var h = File.OpenHandle(_file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite, FileOptions.Asynchronous);
                const int parts = 6; var size = (total + parts - 1) / parts;
                await Task.WhenAll(Enumerable.Range(0, parts).Select(async k =>
                {
                    long from = k * size, to = Math.Min(total, from + size) - 1;
                    if (from > to) return;
                    for (var attempt = 0; ; attempt++)
                    {
                        try
                        {
                            using var req = new HttpRequestMessage(HttpMethod.Get, real);
                            req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(from, to);
                            using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                            if (res.StatusCode != System.Net.HttpStatusCode.PartialContent) throw new IOException("Kein Teil-Download");
                            await using var src = await res.Content.ReadAsStreamAsync();
                            var buf = new byte[1 << 17]; int n;
                            while (from <= to && (n = await src.ReadAsync(buf.AsMemory(0, (int)Math.Min(buf.Length, to - from + 1)))) > 0)
                            {
                                await RandomAccess.WriteAsync(h, buf.AsMemory(0, n), from);
                                from += n; Add(n);
                            }
                            if (from <= to) throw new IOException("Verbindung abgebrochen");
                            return;
                        }
                        catch when (attempt < 3) { await Task.Delay(500 * (attempt + 1)); }
                    }
                }));
            }
            catch { parallel = false; Interlocked.Exchange(ref done, 0); }
        }
        if (!parallel)
        {
            using var res = await http.GetAsync(real, HttpCompletionOption.ResponseHeadersRead);
            res.EnsureSuccessStatusCode();
            await using var src = await res.Content.ReadAsStreamAsync();
            await using var dst = File.Create(_file);
            var buf = new byte[1 << 17]; int n;
            while ((n = await src.ReadAsync(buf)) > 0) { await dst.WriteAsync(buf.AsMemory(0, n)); Add(n); }
        }
        if (_sha != null)
        {
            await using var fs = File.OpenRead(_file);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(fs));
            if (!hash.Equals(_sha, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(_file);
                throw new InvalidOperationException("Prüfsumme stimmt nicht – Download beschädigt.");
            }
        }
        if (new FileInfo(_file).Length < 1_000_000) throw new InvalidOperationException("Download unvollständig.");
    }

    /// <summary>Swaps the running exe for the downloaded one and restarts.
    /// Windows allows renaming a running executable, so no helper script is needed.</summary>
    public static Process? Install()
    {
        var cur = Environment.ProcessPath ?? throw new InvalidOperationException("Pfad unbekannt");
        var file = _file ?? TempFile;
        if (!File.Exists(file)) throw new InvalidOperationException("Update wurde nicht heruntergeladen.");
        var old = cur + ".old";
        if (File.Exists(old)) File.Delete(old);
        File.Move(cur, old);
        // same folder: a rename keeps the file Windows already checked during the download
        try { if (file == cur + ".new") File.Move(file, cur); else File.Copy(file, cur); }
        catch { File.Move(old, cur); throw; }
        try { if (File.Exists(file)) File.Delete(file); } catch { }
        return Process.Start(new ProcessStartInfo(cur, "--updated") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(cur)! });
        // the caller shuts the app down after answering the UI (shutting down here kills the WebView mid-call)
    }
}
