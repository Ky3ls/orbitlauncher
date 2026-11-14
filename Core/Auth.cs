using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace OrbitLauncher.Core;

public class Account
{
    public string Uuid { get; set; } = "";
    public string Name { get; set; } = "";
    public string? SkinUrl { get; set; }
    public string? CapeUrl { get; set; }
    public string Xuid { get; set; } = "";
    /// <summary>Microsoft refresh token, DPAPI encrypted (base64). Passwords are never seen or stored.</summary>
    public string RefreshProtected { get; set; } = "";
    public DateTime Added { get; set; } = DateTime.UtcNow;
    // runtime only
    [System.Text.Json.Serialization.JsonIgnore] public string? McToken { get; set; }
    [System.Text.Json.Serialization.JsonIgnore] public DateTime McTokenExpires { get; set; }
}

public record DeviceCode(string UserCode, string VerificationUri, string DeviceCodeValue, int Interval, int ExpiresIn, string Message);

/// <summary>
/// Microsoft account login with the official OAuth 2.0 device code flow (Microsoft identity platform):
/// MSA → Xbox Live → XSTS → Minecraft services. Needs an Azure app id that Mojang has approved for the Minecraft API.
/// </summary>
public class Auth
{
    private const string Tenant = "consumers";
    private const string Scope = "XboxLive.signin offline_access";
    public string ClientId { get; set; }
    private readonly string _file = Path.Combine(Paths.Root, "accounts.json");
    public List<Account> Accounts { get; private set; } = new();
    public string? ActiveUuid { get; set; }

    public Auth(string clientId)
    {
        ClientId = clientId;
        var s = Net.LoadJson<Store>(_file);
        if (s != null) { Accounts = s.Accounts; ActiveUuid = s.Active; }
    }

    private class Store { public List<Account> Accounts { get; set; } = new(); public string? Active { get; set; } }
    public void Save() => Net.SaveJson(_file, new Store { Accounts = Accounts, Active = ActiveUuid });
    public Account? Active => Accounts.FirstOrDefault(a => a.Uuid == ActiveUuid) ?? Accounts.FirstOrDefault();

    private void NeedClient()
    {
        if (string.IsNullOrWhiteSpace(ClientId))
            throw new InvalidOperationException("Keine Azure-App-ID hinterlegt. Trage in den Einstellungen unter „Konto“ die Client-ID deiner für Minecraft freigeschalteten Azure-App ein.");
    }

    public async Task<DeviceCode> StartDeviceCode(CancellationToken ct = default)
    {
        NeedClient();
        var r = await Net.PostForm($"https://login.microsoftonline.com/{Tenant}/oauth2/v2.0/devicecode", new() { ["client_id"] = ClientId, ["scope"] = Scope }, ct);
        if (r["error"] != null) throw new InvalidOperationException((string?)r["error_description"] ?? (string?)r["error"]);
        return new DeviceCode((string)r["user_code"]!, (string)r["verification_uri"]!, (string)r["device_code"]!, (int?)r["interval"] ?? 5, (int?)r["expires_in"] ?? 900, (string?)r["message"] ?? "");
    }

    /// <summary>Polls until the user confirmed the code in the browser, then signs in to Minecraft.</summary>
    public async Task<Account> FinishDeviceCode(DeviceCode dc, CancellationToken ct = default)
    {
        var until = DateTime.UtcNow.AddSeconds(dc.ExpiresIn);
        var interval = dc.Interval;
        while (DateTime.UtcNow < until)
        {
            await Task.Delay(TimeSpan.FromSeconds(interval), ct);
            var r = await Net.PostForm($"https://login.microsoftonline.com/{Tenant}/oauth2/v2.0/token", new()
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                ["client_id"] = ClientId,
                ["device_code"] = dc.DeviceCodeValue,
            }, ct);
            var err = (string?)r["error"];
            if (err == "authorization_pending") continue;
            if (err == "slow_down") { interval += 5; continue; }
            if (err != null) throw new InvalidOperationException(err == "expired_token" ? "Der Code ist abgelaufen." : err == "authorization_declined" ? "Anmeldung abgelehnt." : (string?)r["error_description"] ?? err);
            return await FromMsa((string)r["access_token"]!, (string)r["refresh_token"]!, ct);
        }
        throw new TimeoutException("Der Code ist abgelaufen.");
    }

    private async Task<Account> FromMsa(string msToken, string refresh, CancellationToken ct)
    {
        var xbl = await Net.Post("https://user.auth.xboxlive.com/user/authenticate", new
        {
            Properties = new { AuthMethod = "RPS", SiteName = "user.auth.xboxlive.com", RpsTicket = "d=" + msToken },
            RelyingParty = "http://auth.xboxlive.com",
            TokenType = "JWT",
        }, null, ct);
        var xblToken = (string)xbl["Token"]!;
        var uhs = (string)xbl["DisplayClaims"]!["xui"]![0]!["uhs"]!;

        JsonNode xsts;
        try
        {
            xsts = await Net.Post("https://xsts.auth.xboxlive.com/xsts/authorize", new
            {
                Properties = new { SandboxId = "RETAIL", UserTokens = new[] { xblToken } },
                RelyingParty = "rp://api.minecraftservices.com/",
                TokenType = "JWT",
            }, null, ct);
        }
        catch (HttpRequestException e) when (e.Message.Contains("2148916233")) { throw new InvalidOperationException("Dieses Microsoft-Konto hat kein Xbox-Profil. Melde dich einmal auf xbox.com an."); }
        catch (HttpRequestException e) when (e.Message.Contains("2148916238")) { throw new InvalidOperationException("Kinderkonto: Ein Erwachsener muss das Konto zu einer Microsoft-Familie hinzufügen."); }
        catch (HttpRequestException e) when (e.Message.Contains("2148916235")) { throw new InvalidOperationException("Xbox Live ist in deinem Land nicht verfügbar."); }

        var xstsToken = (string)xsts["Token"]!;
        var xuid = (string?)xsts["DisplayClaims"]?["xui"]?[0]?["xid"] ?? "";
        var mc = await Net.Post("https://api.minecraftservices.com/authentication/login_with_xbox", new { identityToken = $"XBL3.0 x={uhs};{xstsToken}" }, null, ct);
        var mcToken = (string)mc["access_token"]!;
        var exp = DateTime.UtcNow.AddSeconds(((int?)mc["expires_in"] ?? 86400) - 120);

        JsonNode profile;
        try { profile = await Net.GetAuth("https://api.minecraftservices.com/minecraft/profile", mcToken, ct); }
        catch (HttpRequestException e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        { throw new InvalidOperationException("Dieses Konto besitzt Minecraft: Java Edition nicht (oder hat noch keinen Spielernamen)."); }

        var acc = Accounts.FirstOrDefault(a => a.Uuid == (string)profile["id"]!) ?? new Account();
        acc.Uuid = (string)profile["id"]!;
        acc.Name = (string)profile["name"]!;
        acc.SkinUrl = (string?)profile["skins"]?.AsArray().FirstOrDefault(s => (string?)s!["state"] == "ACTIVE")?["url"];
        acc.CapeUrl = (string?)profile["capes"]?.AsArray().FirstOrDefault(s => (string?)s!["state"] == "ACTIVE")?["url"];
        acc.Xuid = xuid;
        acc.RefreshProtected = Dpapi.Protect(refresh);
        acc.McToken = mcToken; acc.McTokenExpires = exp;
        if (!Accounts.Contains(acc)) Accounts.Add(acc);
        ActiveUuid = acc.Uuid;
        Save();
        return acc;
    }

    /// <summary>Fresh Minecraft session for launching (refreshes through the stored refresh token).</summary>
    public async Task<Session> GetSession(Account acc, CancellationToken ct = default)
    {
        if (acc.McToken == null || DateTime.UtcNow >= acc.McTokenExpires)
        {
            NeedClient();
            var refresh = Dpapi.Unprotect(acc.RefreshProtected);
            var r = await Net.PostForm($"https://login.microsoftonline.com/{Tenant}/oauth2/v2.0/token", new()
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = ClientId,
                ["refresh_token"] = refresh,
                ["scope"] = Scope,
            }, ct);
            if (r["error"] != null) throw new InvalidOperationException("Anmeldung abgelaufen, bitte das Konto neu hinzufügen.");
            var fresh = await FromMsa((string)r["access_token"]!, (string?)r["refresh_token"] ?? refresh, ct);
            acc = fresh;
        }
        return new Session(acc.Name, acc.Uuid, acc.McToken!, acc.Xuid);
    }

    public void Remove(string uuid)
    {
        Accounts.RemoveAll(a => a.Uuid == uuid);
        if (ActiveUuid == uuid) ActiveUuid = Accounts.FirstOrDefault()?.Uuid;
        Save();
    }
}

/// <summary>Windows DPAPI (CurrentUser) via crypt32 – the refresh token can only be read by this Windows user.</summary>
public static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Size; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(ref Blob input, string? desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob output);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref Blob input, IntPtr desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr h);
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("OrbitLauncher.v1");

    public static string Protect(string plain) => Convert.ToBase64String(Run(Encoding.UTF8.GetBytes(plain), true));
    public static string Unprotect(string b64) => Encoding.UTF8.GetString(Run(Convert.FromBase64String(b64), false));

    private static byte[] Run(byte[] data, bool protect)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("DPAPI gibt es nur unter Windows.");
        var inH = GCHandle.Alloc(data, GCHandleType.Pinned);
        var entH = GCHandle.Alloc(Entropy, GCHandleType.Pinned);
        var ent = new Blob { Size = Entropy.Length, Data = entH.AddrOfPinnedObject() };
        var entPtr = Marshal.AllocHGlobal(Marshal.SizeOf<Blob>());
        try
        {
            Marshal.StructureToPtr(ent, entPtr, false);
            var input = new Blob { Size = data.Length, Data = inH.AddrOfPinnedObject() };
            var output = new Blob();
            const int UiForbidden = 0x1;
            var ok = protect
                ? CryptProtectData(ref input, "OrbitLauncher", entPtr, IntPtr.Zero, IntPtr.Zero, UiForbidden, ref output)
                : CryptUnprotectData(ref input, IntPtr.Zero, entPtr, IntPtr.Zero, IntPtr.Zero, UiForbidden, ref output);
            if (!ok) throw new InvalidOperationException("DPAPI-Fehler " + Marshal.GetLastWin32Error());
            var r = new byte[output.Size];
            Marshal.Copy(output.Data, r, 0, output.Size);
            LocalFree(output.Data);
            return r;
        }
        finally { inH.Free(); entH.Free(); Marshal.FreeHGlobal(entPtr); }
    }
}
