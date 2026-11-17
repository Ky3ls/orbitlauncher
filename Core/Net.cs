using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>Root folders of the launcher. Versions, libraries, assets and Java runtimes are shared, every instance gets its own game directory.</summary>
public static class Paths
{
    public static string Root { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "OrbitLauncher");
    public static string Versions => Dir("versions");
    public static string Libraries => Dir("libraries");
    public static string Assets => Dir("assets");
    public static string Runtime => Dir("runtime");
    public static string Instances => Dir("instances");
    public static string Cache => Dir("cache");
    public static string Natives => Dir("natives");
    public static string Dir(string name) { var d = Path.Combine(Root, name); Directory.CreateDirectory(d); return d; }
}

public record Progress(string Stage, long Done, long Total, string? Detail = null)
{
    public int Pct => Total <= 0 ? 0 : (int)Math.Clamp(Done * 100 / Total, 0, 100);
}

public record DlItem(string Url, string Path, string? Sha1 = null, long Size = 0);

public static class Net
{
    public static string AppVersion { get; set; } = "0.1.0";
    public static readonly HttpClient Http;
    public static readonly JsonSerializerOptions J = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, WriteIndented = true };

    static Net()
    {
        var h = new SocketsHttpHandler
        {
            MaxConnectionsPerServer = 16,
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            ConnectTimeout = TimeSpan.FromSeconds(15),
        };
        Http = new HttpClient(h) { Timeout = TimeSpan.FromMinutes(10) };
        // Modrinth asks for a descriptive user agent with a contact point
        Http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", $"Ky3ls/OrbitLauncher/{AppVersion} (github.com/Ky3ls)");
    }

    public static async Task<string> Text(string url, CancellationToken ct = default)
    {
        for (int i = 0; ; i++)
        {
            try
            {
                using var r = await Http.GetAsync(url, ct);
                if ((int)r.StatusCode == 429 && i < 3) { await Task.Delay(1500 * (i + 1), ct); continue; }
                r.EnsureSuccessStatusCode();
                return await r.Content.ReadAsStringAsync(ct);
            }
            catch (HttpRequestException) when (i < 2) { await Task.Delay(700 * (i + 1), ct); }
        }
    }

    public static async Task<JsonNode> Json(string url, CancellationToken ct = default) => JsonNode.Parse(await Text(url, ct))!;
    public static async Task<T> Json<T>(string url, CancellationToken ct = default) => JsonSerializer.Deserialize<T>(await Text(url, ct), J)!;

    /// <summary>Sends a request again after 429 (rate limit) or a 5xx hiccup, honouring Retry-After (max ~12 s in total).</summary>
    private static async Task<HttpResponseMessage> SendRetry(Func<HttpRequestMessage> make, CancellationToken ct)
    {
        for (var i = 0; ; i++)
        {
            var r = await Http.SendAsync(make(), ct);
            var code = (int)r.StatusCode;
            if (i >= 3 || (code != 429 && code < 500)) return r;
            var wait = r.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1.5 * (i + 1));
            if (wait > TimeSpan.FromSeconds(6)) wait = TimeSpan.FromSeconds(6);
            r.Dispose();
            await Task.Delay(wait, ct);
        }
    }

    public static async Task<JsonNode> Post(string url, object body, string? bearer = null, CancellationToken ct = default)
    {
        var json = body is string s ? s : JsonSerializer.Serialize(body);
        HttpRequestMessage Make()
        {
            var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (bearer != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            return req;
        }
        using var r = await SendRetry(Make, ct);
        var txt = await r.Content.ReadAsStringAsync(ct);
        if (!r.IsSuccessStatusCode) throw new HttpRequestException($"{(int)r.StatusCode} {url}: {Trim(txt)}", null, r.StatusCode);
        return string.IsNullOrWhiteSpace(txt) ? new JsonObject() : JsonNode.Parse(txt)!;
    }

    public static async Task<JsonNode> PostForm(string url, Dictionary<string, string> form, CancellationToken ct = default)
    {
        using var r = await Http.PostAsync(url, new FormUrlEncodedContent(form), ct);
        var txt = await r.Content.ReadAsStringAsync(ct);
        var node = string.IsNullOrWhiteSpace(txt) ? new JsonObject() : JsonNode.Parse(txt)!;
        if (!r.IsSuccessStatusCode && node["error"] == null) throw new HttpRequestException($"{(int)r.StatusCode}: {Trim(txt)}");
        return node;
    }

    public static async Task<JsonNode> GetAuth(string url, string bearer, CancellationToken ct = default)
    {
        HttpRequestMessage Make() { var req = new HttpRequestMessage(HttpMethod.Get, url); req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer); return req; }
        using var r = await SendRetry(Make, ct);
        var txt = await r.Content.ReadAsStringAsync(ct);
        if (!r.IsSuccessStatusCode) throw new HttpRequestException($"{(int)r.StatusCode} {url}: {Trim(txt)}", null, r.StatusCode);
        return JsonNode.Parse(txt)!;
    }

    private static string Trim(string s) => s.Length > 300 ? s[..300] : s;

    /// <summary>Downloads one file atomically (.part + move), verifies SHA-1 when known. Existing files with the right size are kept.</summary>
    public static async Task Download(DlItem it, CancellationToken ct = default, Action<long>? onBytes = null)
    {
        if (IsPresent(it)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(it.Path)!);
        var part = it.Path + ".part";
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                using (var r = await Http.GetAsync(it.Url, HttpCompletionOption.ResponseHeadersRead, ct))
                {
                    r.EnsureSuccessStatusCode();
                    await using var src = await r.Content.ReadAsStreamAsync(ct);
                    await using var dst = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                    var buf = new byte[81920]; int n;
                    while ((n = await src.ReadAsync(buf, ct)) > 0) { await dst.WriteAsync(buf.AsMemory(0, n), ct); onBytes?.Invoke(n); }
                }
                if (it.Sha1 != null && !string.Equals(Sha1(part), it.Sha1, StringComparison.OrdinalIgnoreCase))
                    throw new IOException($"Prüfsumme falsch: {Path.GetFileName(it.Path)}");
                File.Move(part, it.Path, true);
                return;
            }
            catch (Exception) when (attempt < 3 && !ct.IsCancellationRequested)
            {
                try { File.Delete(part); } catch { }
                await Task.Delay(600 * (attempt + 1), ct);
            }
        }
    }

    public static bool IsPresent(DlItem it)
    {
        var fi = new FileInfo(it.Path);
        if (!fi.Exists) return false;
        if (it.Size > 0) return fi.Length == it.Size;
        return fi.Length > 0;
    }

    /// <summary>Parallel download with progress (counts files, reports bytes in the detail).</summary>
    public static async Task DownloadAll(IReadOnlyCollection<DlItem> items, string stage, IProgress<Progress>? p, CancellationToken ct = default, int parallel = 16)
    {
        var todo = items.Where(i => !IsPresent(i)).GroupBy(i => i.Path).Select(g => g.First()).ToList();
        if (todo.Count == 0) { p?.Report(new Progress(stage, 1, 1)); return; }
        long done = 0, bytes = 0, total = todo.Count;
        var last = DateTime.MinValue;
        p?.Report(new Progress(stage, 0, total));
        await Parallel.ForEachAsync(todo, new ParallelOptions { MaxDegreeOfParallelism = parallel, CancellationToken = ct }, async (it, c) =>
        {
            await Download(it, c, n => Interlocked.Add(ref bytes, n));
            var d = Interlocked.Increment(ref done);
            if (d == total || (DateTime.UtcNow - last).TotalMilliseconds > 120)
            {
                last = DateTime.UtcNow;
                p?.Report(new Progress(stage, d, total, $"{d}/{total} · {Interlocked.Read(ref bytes) / 1048576.0:0.0} MB"));
            }
        });
    }

    public static string Sha1(string path)
    {
        using var f = File.OpenRead(path);
        return Convert.ToHexString(SHA1.HashData(f)).ToLowerInvariant();
    }

    public static string Sha512(string path)
    {
        using var f = File.OpenRead(path);
        return Convert.ToHexString(SHA512.HashData(f)).ToLowerInvariant();
    }

    public static void SaveJson(string path, object o)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, o is JsonNode n ? n.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) : JsonSerializer.Serialize(o, J));
        File.Move(tmp, path, true);
    }

    public static T? LoadJson<T>(string path) where T : class
    {
        try { return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), J) : null; } catch { return null; }
    }

    /// <summary>Maven coordinate "group:artifact:version[:classifier][@ext]" to a relative path.</summary>
    public static string MavenPath(string name)
    {
        var ext = "jar";
        var at = name.IndexOf('@');
        if (at >= 0) { ext = name[(at + 1)..]; name = name[..at]; }
        var p = name.Split(':');
        var file = p.Length > 3 ? $"{p[1]}-{p[2]}-{p[3]}.{ext}" : $"{p[1]}-{p[2]}.{ext}";
        return Path.Combine(p[0].Replace('.', Path.DirectorySeparatorChar), p[1], p[2], file);
    }

    public static string MavenUrlPath(string name) => MavenPath(name).Replace('\\', '/');
}
