using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

/// <summary>
/// Private access: the launcher only works with a code from the owner. A code is activated once per PC
/// (bound to that PC); the server can revoke it any time. Offline the last confirmed access counts for a while.
/// </summary>
public static class Access
{
    public class Store
    {
        public string? Token { get; set; }
        public bool Admin { get; set; }
        public DateTime LastOk { get; set; }
    }
    /// <summary>How long the launcher keeps working without reaching the server.</summary>
    public static readonly TimeSpan Offline = TimeSpan.FromDays(14);
    private static readonly object L = new();
    private static string FilePath => Path.Combine(Paths.Root, "access.json");
    private static Store Load() { lock (L) return Net.LoadJson<Store>(FilePath) ?? new(); }
    private static void Save(Store s) { lock (L) Net.SaveJson(FilePath, s); }

    /// <summary>The device's access token (plain), or null.</summary>
    public static string? Token()
    {
        var t = Load().Token;
        if (string.IsNullOrEmpty(t)) return null;
        try { return Cloud.Unprotect(t); } catch { return null; }
    }
    public static bool Admin => Load().Admin;

    /// <summary>Anonymous id of this PC (hash of the Windows installation id).</summary>
    public static string Hwid()
    {
        string id = "";
        try
        {
            if (OperatingSystem.IsWindows())
                id = Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography", "MachineGuid", "") as string ?? "";
        }
        catch { }
        if (string.IsNullOrEmpty(id)) id = Environment.MachineName + "|" + Environment.UserName;
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes("orbitlauncher|" + id))).ToLowerInvariant();
    }

    private static async Task<(int status, JsonNode? body)> Send(HttpMethod m, string path, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(m, Cloud.Api.TrimEnd('/') + path);
        if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var t = Token(); if (t != null) req.Headers.Add("X-Orbit-Access", t);
        using var r = await Net.Http.SendAsync(req, ct);
        JsonNode? j = null; try { j = JsonNode.Parse(await r.Content.ReadAsStringAsync(ct)); } catch { }
        return ((int)r.StatusCode, j);
    }

    public sealed record State(bool Ok, bool Admin, bool Offline, string? Error);

    /// <summary>Is this PC allowed? Asks the server; without connection the last confirmation counts for 14 days.</summary>
    public static async Task<State> Check(CancellationToken ct = default)
    {
        var st = Load();
        if (string.IsNullOrEmpty(st.Token)) return new(false, false, false, null);
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(TimeSpan.FromSeconds(8));
            var (code, j) = await Send(HttpMethod.Post, "/v1/access/check", new { }, cts.Token);
            if (code == 200) { st.LastOk = DateTime.UtcNow; st.Admin = (bool?)j?["admin"] ?? false; Save(st); return new(true, st.Admin, false, null); }
            if (code == 403) { st.Token = null; st.Admin = false; Save(st); return new(false, false, false, "Dein Zugang wurde gesperrt oder ist abgelaufen."); }
        }
        catch { }
        // server not reachable: the last confirmation counts for a while
        var ok = DateTime.UtcNow - st.LastOk < Offline;
        return new(ok, ok && st.Admin, true, ok ? null : "Der Zugang konnte nicht bestätigt werden. Verbinde dich mit dem Internet.");
    }

    public static async Task<State> Activate(string code, CancellationToken ct = default)
    {
        code = new string(code.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (code.Length == 12) code = $"{code[..4]}-{code[4..8]}-{code[8..]}";
        var (status, j) = await Send(HttpMethod.Post, "/v1/access/activate", new { code, hwid = Hwid(), device = Environment.MachineName }, ct);
        if (status != 200 || (string?)j?["token"] is not string t)
            throw new InvalidOperationException((string?)j?["error"] ?? $"Orbit-Server nicht erreichbar ({status}).");
        var st = new Store { Token = Cloud.Protect(t), Admin = (bool?)j!["admin"] ?? false, LastOk = DateTime.UtcNow };
        Save(st);
        return new(true, st.Admin, false, null);
    }

    public static void Forget() => Save(new Store());

    /// <summary>Admin calls (manage codes).</summary>
    public static async Task<JsonNode> AdminCall(HttpMethod m, string path, object? body, CancellationToken ct = default)
    {
        var (status, j) = await Send(m, "/v1/admin/" + path, body, ct);
        if (status != 200) throw new InvalidOperationException((string?)j?["error"] ?? $"Orbit-Server nicht erreichbar ({status}).");
        return j ?? new JsonObject();
    }

    /// <summary>Adds the access header to a request (cloud, updates).</summary>
    public static void Sign(HttpRequestMessage req) { var t = Token(); if (t != null) req.Headers.Add("X-Orbit-Access", t); }
}
