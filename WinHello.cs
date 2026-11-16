using System.Runtime.InteropServices;
using System.Text;

namespace OrbitLauncher;

/// <summary>
/// Passkeys through the native Windows WebAuthn API (webauthn.dll, Windows Hello / security keys).
/// The embedded browser can't reliably start Windows Hello, so the Orbit account uses this directly.
/// The relying party is "orbit.local", the same id the cloud server checks.
/// </summary>
internal static class WinHello
{
    public const string RpId = "orbit.local";
    public const string Origin = "https://orbit.local";

    // ---------- structs from webauthn.h (version 1 of each, which every Windows 10/11 accepts)
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct RpInfo { public uint dwVersion; public string pwszId; public string pwszName; public IntPtr pwszIcon; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct UserInfo { public uint dwVersion; public uint cbId; public IntPtr pbId; public string pwszName; public IntPtr pwszIcon; public string pwszDisplayName; }
    [StructLayout(LayoutKind.Sequential)]
    private struct CoseParam { public uint dwVersion; public IntPtr pwszCredentialType; public int lAlg; }
    [StructLayout(LayoutKind.Sequential)]
    private struct CoseParams { public uint cCredentialParameters; public IntPtr pCredentialParameters; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ClientData { public uint dwVersion; public uint cbClientDataJSON; public IntPtr pbClientDataJSON; public IntPtr pwszHashAlgId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Credential { public uint dwVersion; public uint cbId; public IntPtr pbId; public IntPtr pwszCredentialType; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Credentials { public uint cCredentials; public IntPtr pCredentials; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Extensions { public uint cExtensions; public IntPtr pExtensions; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MakeOptions
    {
        public uint dwVersion; public uint dwTimeoutMilliseconds; public Credentials CredentialList; public Extensions Extensions;
        public uint dwAuthenticatorAttachment; public int bRequireResidentKey; public uint dwUserVerificationRequirement;
        public uint dwAttestationConveyancePreference; public uint dwFlags;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct GetOptions
    {
        public uint dwVersion; public uint dwTimeoutMilliseconds; public Credentials CredentialList; public Extensions Extensions;
        public uint dwAuthenticatorAttachment; public uint dwUserVerificationRequirement; public uint dwFlags;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Attestation
    {
        public uint dwVersion; public IntPtr pwszFormatType; public uint cbAuthenticatorData; public IntPtr pbAuthenticatorData;
        public uint cbAttestation; public IntPtr pbAttestation; public uint dwAttestationDecodeType; public IntPtr pvAttestationDecode;
        public uint cbAttestationObject; public IntPtr pbAttestationObject; public uint cbCredentialId; public IntPtr pbCredentialId;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Assertion
    {
        public uint dwVersion; public uint cbAuthenticatorData; public IntPtr pbAuthenticatorData; public uint cbSignature; public IntPtr pbSignature;
        public Credential Credential; public uint cbUserId; public IntPtr pbUserId;
    }

    [DllImport("webauthn.dll")] private static extern uint WebAuthNGetApiVersionNumber();
    [DllImport("webauthn.dll")] private static extern int WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(out int available);
    [DllImport("webauthn.dll")] private static extern int WebAuthNAuthenticatorMakeCredential(IntPtr hWnd, ref RpInfo rp, ref UserInfo user, ref CoseParams pubKeyCredParams, ref ClientData clientData, ref MakeOptions options, out IntPtr attestation);
    [DllImport("webauthn.dll", CharSet = CharSet.Unicode)] private static extern int WebAuthNAuthenticatorGetAssertion(IntPtr hWnd, string rpId, ref ClientData clientData, ref GetOptions options, out IntPtr assertion);
    [DllImport("webauthn.dll")] private static extern void WebAuthNFreeCredentialAttestation(IntPtr attestation);
    [DllImport("webauthn.dll")] private static extern void WebAuthNFreeAssertion(IntPtr assertion);
    [DllImport("webauthn.dll", CharSet = CharSet.Unicode)] private static extern IntPtr WebAuthNGetErrorName(int hr);

    public static bool Supported
    {
        get { try { return WebAuthNGetApiVersionNumber() >= 1; } catch { return false; } }
    }
    public static bool HelloReady
    {
        get { try { return WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(out var a) == 0 && a != 0; } catch { return false; } }
    }

    public static string B64u(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static byte[] FromB64u(string s) { s = s.Replace('-', '+').Replace('_', '/'); while (s.Length % 4 != 0) s += "="; return Convert.FromBase64String(s); }
    private static byte[] Bytes(IntPtr p, uint n) { var b = new byte[n]; if (n > 0) Marshal.Copy(p, b, 0, (int)n); return b; }

    /// <summary>Browser-compatible clientDataJSON (what the server verifies).</summary>
    public static byte[] ClientJson(string type, string challenge) =>
        Encoding.UTF8.GetBytes($"{{\"type\":\"{type}\",\"challenge\":\"{challenge}\",\"origin\":\"{Origin}\",\"crossOrigin\":false}}");

    private static Exception Fail(int hr)
    {
        string name = "";
        try { name = Marshal.PtrToStringUni(WebAuthNGetErrorName(hr)) ?? ""; } catch { }
        if (name is "NotAllowedError" or "AbortError" || (uint)hr == 0x800704C7) return new OperationCanceledException("Windows Hello wurde abgebrochen.");
        if (name == "InvalidStateError") return new InvalidOperationException("Auf diesem Gerät gibt es schon einen Passkey für dein Konto.");
        return new InvalidOperationException($"Windows Hello hat abgelehnt ({(name.Length > 0 ? name : "0x" + hr.ToString("X8"))}).");
    }

    public record Created(string ClientDataJSON, string AttestationObject);
    public record Signed(string Id, string ClientDataJSON, string AuthenticatorData, string Signature);

    /// <summary>Creates a passkey with Windows Hello (platform authenticator preferred).</summary>
    public static Created Create(IntPtr hwnd, string challenge, byte[] userId, string userName, IEnumerable<byte[]> exclude, uint timeoutMs = 120000)
    {
        var handles = new List<GCHandle>();
        IntPtr Pin(object o) { var h = GCHandle.Alloc(o, GCHandleType.Pinned); handles.Add(h); return h.AddrOfPinnedObject(); }
        var type = Marshal.StringToHGlobalUni("public-key"); var sha = Marshal.StringToHGlobalUni("SHA-256");
        try
        {
            var rp = new RpInfo { dwVersion = 1, pwszId = RpId, pwszName = "OrbitLauncher" };
            var user = new UserInfo { dwVersion = 1, cbId = (uint)userId.Length, pbId = Pin(userId), pwszName = userName, pwszDisplayName = userName };
            var algs = new[] { new CoseParam { dwVersion = 1, pwszCredentialType = type, lAlg = -7 }, new CoseParam { dwVersion = 1, pwszCredentialType = type, lAlg = -257 } };
            var cp = new CoseParams { cCredentialParameters = (uint)algs.Length, pCredentialParameters = Pin(algs) };
            var json = ClientJson("webauthn.create", challenge);
            var cd = new ClientData { dwVersion = 1, cbClientDataJSON = (uint)json.Length, pbClientDataJSON = Pin(json), pwszHashAlgId = sha };
            var ex = exclude.Select(id => new Credential { dwVersion = 1, cbId = (uint)id.Length, pbId = Pin(id), pwszCredentialType = type }).ToArray();
            var opt = new MakeOptions
            {
                dwVersion = 1, dwTimeoutMilliseconds = timeoutMs,
                CredentialList = new Credentials { cCredentials = (uint)ex.Length, pCredentials = ex.Length > 0 ? Pin(ex) : IntPtr.Zero },
                dwAuthenticatorAttachment = HelloReady ? 1u : 0u,   // 1 = platform (Windows Hello)
                bRequireResidentKey = 0, dwUserVerificationRequirement = 2 /* preferred */, dwAttestationConveyancePreference = 1 /* none */,
            };
            var hr = WebAuthNAuthenticatorMakeCredential(hwnd, ref rp, ref user, ref cp, ref cd, ref opt, out var p);
            if (hr != 0 || p == IntPtr.Zero) throw Fail(hr);
            try
            {
                var a = Marshal.PtrToStructure<Attestation>(p);
                var obj = Bytes(a.pbAttestationObject, a.cbAttestationObject);
                return new Created(B64u(json), B64u(obj));
            }
            finally { WebAuthNFreeCredentialAttestation(p); }
        }
        finally { handles.ForEach(h => h.Free()); Marshal.FreeHGlobal(type); Marshal.FreeHGlobal(sha); }
    }

    /// <summary>Signs in with an existing passkey.</summary>
    public static Signed Get(IntPtr hwnd, string challenge, IEnumerable<byte[]> allow, uint timeoutMs = 120000)
    {
        var handles = new List<GCHandle>();
        IntPtr Pin(object o) { var h = GCHandle.Alloc(o, GCHandleType.Pinned); handles.Add(h); return h.AddrOfPinnedObject(); }
        var type = Marshal.StringToHGlobalUni("public-key"); var sha = Marshal.StringToHGlobalUni("SHA-256");
        try
        {
            var json = ClientJson("webauthn.get", challenge);
            var cd = new ClientData { dwVersion = 1, cbClientDataJSON = (uint)json.Length, pbClientDataJSON = Pin(json), pwszHashAlgId = sha };
            var al = allow.Select(id => new Credential { dwVersion = 1, cbId = (uint)id.Length, pbId = Pin(id), pwszCredentialType = type }).ToArray();
            var opt = new GetOptions
            {
                dwVersion = 1, dwTimeoutMilliseconds = timeoutMs,
                CredentialList = new Credentials { cCredentials = (uint)al.Length, pCredentials = al.Length > 0 ? Pin(al) : IntPtr.Zero },
                dwAuthenticatorAttachment = 0, dwUserVerificationRequirement = 2,
            };
            var hr = WebAuthNAuthenticatorGetAssertion(hwnd, RpId, ref cd, ref opt, out var p);
            if (hr != 0 || p == IntPtr.Zero) throw Fail(hr);
            try
            {
                var a = Marshal.PtrToStructure<Assertion>(p);
                return new Signed(B64u(Bytes(a.Credential.pbId, a.Credential.cbId)), B64u(json), B64u(Bytes(a.pbAuthenticatorData, a.cbAuthenticatorData)), B64u(Bytes(a.pbSignature, a.cbSignature)));
            }
            finally { WebAuthNFreeAssertion(p); }
        }
        finally { handles.ForEach(h => h.Free()); Marshal.FreeHGlobal(type); Marshal.FreeHGlobal(sha); }
    }
}
