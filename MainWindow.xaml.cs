using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using OrbitLauncher.Core;

namespace OrbitLauncher;

public partial class MainWindow : Window
{
    private static readonly JsonSerializerOptions J = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly Settings S = Settings.Load();
    private readonly Runner _runner = new();
    private readonly Auth _auth;
    private DeviceCode? _dc;
    private CancellationTokenSource? _dcCts;
    private int _taskSeq;
    private double _zoom = 1;
    private bool _hiddenForGame;

    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wp, IntPtr lp);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);

    public MainWindow()
    {
        Net.AppVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
        _auth = new Auth(S.ClientId);
        InitializeComponent();

        var wa = SystemParameters.WorkArea;
        _zoom = Math.Min(1, Math.Min((wa.Width - 24) / 1280, (wa.Height - 24) / 800));
        if (wa.Width >= 2500 && wa.Height >= 1500) _zoom = 1.25;
        Width = 1280 * _zoom; Height = 800 * _zoom;

        SourceInitialized += (_, _) =>
        {
            var h = new WindowInteropHelper(this).Handle;
            int round = 2; DwmSetWindowAttribute(h, 33, ref round, sizeof(int));   // rounded corners (Windows 11)
            int dark = 1; DwmSetWindowAttribute(h, 20, ref dark, sizeof(int));     // dark title/border
        };
        StateChanged += (_, _) => Root.Margin = WindowState == WindowState.Maximized ? SystemParameters.WindowResizeBorderThickness : new Thickness(0);
        Loaded += async (_, _) => await InitWeb();
        Closing += (_, _) => S.Save();

        _runner.Log += (id, line) => Emit("log", new { id, line });
        _runner.State += (id, running, code) =>
        {
            string? crash = null;
            if (!running && code is not (null or 0)) { var i = Instances.Get(id); if (i != null) crash = Runner.LatestCrash(i); }
            Emit("state", new { id, running, code, crash = crash != null });
            if (!running) Dispatcher.InvokeAsync(() =>
            {
                Emit("instances", Instances.All().Select(Dto).ToList());
                if (_hiddenForGame && !_runner.RunningIds.Any())
                {
                    if (S.OnLaunch == "close") Application.Current.Shutdown();
                    else { Show(); WindowState = WindowState.Normal; Activate(); _hiddenForGame = false; }
                }
            });
        };
    }

    // =====================================================================
    //  WEBVIEW
    // =====================================================================
    private async Task InitWeb()
    {
        try
        {
            var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OrbitLauncher");
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "WebView2"));
            Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 10, 10, 11);
            await Web.EnsureCoreWebView2Async(env);
            var c = Web.CoreWebView2;
            c.Settings.AreDefaultContextMenusEnabled = false;
            c.Settings.IsZoomControlEnabled = false;
            c.Settings.IsStatusBarEnabled = false;
            c.Settings.AreBrowserAcceleratorKeysEnabled = false;
            c.Settings.IsPinchZoomEnabled = false;
#if !DEBUG
            c.Settings.AreDevToolsEnabled = false;
#endif
            c.NewWindowRequested += (_, e) => { e.Handled = true; OpenUrl(e.Uri); };
            c.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("https://orbit.local/")) { e.Cancel = true; OpenUrl(e.Uri); } };
            var webDir = ExtractWeb(Path.Combine(data, "web"));
            c.SetVirtualHostNameToFolderMapping("orbit.local", webDir, CoreWebView2HostResourceAccessKind.Allow);
            c.WebMessageReceived += OnMessage;
            Web.ZoomFactor = _zoom;
            c.Navigate("https://orbit.local/index.html");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Für OrbitLauncher wird die Microsoft Edge WebView2 Runtime benötigt.\nDer Download wird jetzt geöffnet.", "OrbitLauncher", MessageBoxButton.OK, MessageBoxImage.Information);
            OpenUrl("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show("Start fehlgeschlagen: " + ex.Message, "OrbitLauncher", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    private static string ExtractWeb(string dir)
    {
        if (Directory.Exists(dir)) try { Directory.Delete(dir, true); } catch { }
        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in asm.GetManifestResourceNames())
        {
            var n = name.Replace('\\', '/');
            if (!n.StartsWith("web/")) continue;
            var target = Path.Combine(dir, n[4..].Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using var src = asm.GetManifestResourceStream(name)!;
            using var dst = File.Create(target);
            src.CopyTo(dst);
        }
        return dir;
    }

    private void Emit(string ev, object data)
    {
        var json = JsonSerializer.Serialize(new { @event = ev, data }, J);
        Dispatcher.InvokeAsync(() => Web.CoreWebView2?.PostWebMessageAsJson(json));
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            id = root.GetProperty("id").GetInt32();
            var cmd = root.GetProperty("cmd").GetString() ?? "";
            var args = root.TryGetProperty("args", out var a) ? JsonNode.Parse(a.GetRawText()) as JsonObject ?? new JsonObject() : new JsonObject();
            var data = await Handle(cmd, args);
            var payload = data is JsonNode jn ? $"{{\"id\":{id},\"ok\":true,\"data\":{jn.ToJsonString()}}}" : JsonSerializer.Serialize(new { id, ok = true, data }, J);
            Web.CoreWebView2.PostWebMessageAsJson(payload);
        }
        catch (Exception ex)
        {
            var msg = ex is HttpRequestException ? "Netzwerkfehler: " + ex.Message : ex.Message;
            Web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = false, error = msg }, J));
        }
    }

    private static string Str(JsonObject a, string k) => a[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    private static string? StrN(JsonObject a, string k) { var s = Str(a, k); return s.Length == 0 ? null : s; }
    private static int Int(JsonObject a, string k) => a[k] is JsonValue v && v.TryGetValue<double>(out var d) ? (int)Math.Round(d) : 0;
    private static bool Bool(JsonObject a, string k) => a[k] is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    private Instance Inst(JsonObject a) => Instances.Get(Str(a, "id")) ?? throw new InvalidOperationException("Instanz nicht gefunden");

    // ---- progress → UI (throttled), several tasks can run in parallel
    private sealed class Prog(Action<Progress> a) : IProgress<Progress> { public void Report(Progress p) => a(p); }
    private (IProgress<Progress> p, string task) NewTask()
    {
        var task = "t" + Interlocked.Increment(ref _taskSeq);
        var gate = new object(); var last = DateTime.MinValue; string? stage = null;
        return (new Prog(p =>
        {
            lock (gate)
            {
                var now = DateTime.UtcNow;
                if (p.Stage == stage && (now - last).TotalMilliseconds < 90 && p.Done < p.Total) return;
                last = now; stage = p.Stage;
            }
            Emit("progress", new { task, stage = p.Stage, pct = p.Pct, total = p.Total, detail = p.Detail });
        }), task);
    }
    private async Task<T> WithTask<T>(Func<IProgress<Progress>, Task<T>> work)
    {
        var (p, task) = NewTask();
        try { return await Task.Run(() => work(p)); }
        finally { Emit("progress", new { task, done = true }); }
    }

    private object Dto(Instance i)
    {
        int mods = 0;
        try { var d = Path.Combine(i.Dir, "mods"); if (Directory.Exists(d)) mods = Directory.EnumerateFiles(d, "*.jar").Count(); } catch { }
        return new
        {
            i.Id, i.Name, i.McVersion, i.Loader, i.LoaderVersion, i.VersionId, i.Kind, i.Icon, i.RamMb, i.JavaPath, i.JvmArgs, i.Width, i.Height,
            i.PlaySeconds, i.LastPlayed, i.Created, mods, running = _runner.IsRunning(i.Id),
            content = i.Content.Select(c => new { c.ProjectId, c.Type }),
        };
    }

    private object AccountsDto() => new
    {
        accounts = _auth.Accounts.Select(a => new { a.Uuid, a.Name, skin = a.SkinUrl?.Replace("http://", "https://") }),
        active = _auth.Active?.Uuid,
    };

    // =====================================================================
    //  COMMANDS
    // =====================================================================
    private async Task<object?> Handle(string cmd, JsonObject a)
    {
        switch (cmd)
        {
            // ---------------- window
            case "win.drag": ReleaseCapture(); SendMessage(new WindowInteropHelper(this).Handle, 0xA1, (IntPtr)2, IntPtr.Zero); return null;
            case "win.min": WindowState = WindowState.Minimized; return null;
            case "win.max": WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized; return null;
            case "win.close": Close(); return null;

            // ---------------- general
            case "init":
            {
                return new
                {
                    version = Net.AppVersion, root = Paths.Root, settings = S,
                    instances = Instances.All().Select(Dto).ToList(),
                    accounts = _auth.Accounts.Select(x => new { x.Uuid, x.Name, skin = x.SkinUrl?.Replace("http://", "https://") }),
                    active = _auth.Active?.Uuid, running = _runner.RunningIds.ToList(),
                };
            }
            case "settings.set":
            {
                var key = Str(a, "key");
                var prop = typeof(Settings).GetProperties().FirstOrDefault(p => string.Equals(p.Name, key, StringComparison.OrdinalIgnoreCase)) ?? throw new ArgumentException("Unbekannte Einstellung " + key);
                var val = a["value"];
                object? v = val == null ? null : prop.PropertyType == typeof(int) ? (int)val.GetValue<double>() : prop.PropertyType == typeof(bool) ? val.GetValue<bool>() : (object?)(string?)val;
                prop.SetValue(S, v);
                S.Save();
                if (prop.Name == nameof(Settings.ClientId)) _auth.ClientId = S.ClientId;
                return new { };
            }
            case "news": return await News.Latest(6);
            case "open.url":
            {
                var url = Str(a, "url");
                if (Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == "https") OpenUrl(url);
                return null;
            }
            case "folder.open":
            {
                string dir = Paths.Root;
                if (StrN(a, "id") != null) dir = Path.Combine(Inst(a).Dir, Str(a, "what"));
                Directory.CreateDirectory(dir);
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{dir}\"") { UseShellExecute = true });
                return null;
            }

            // ---------------- versions & loaders
            case "versions.list":
            {
                var all = await Versions.All(Bool(a, "refresh"));
                var installed = Directory.GetDirectories(Paths.Versions).Select(Path.GetFileName).Where(n => File.Exists(Versions.JarPath(n!))).ToList();
                return new
                {
                    latest = new { release = Versions.LatestRelease, snapshot = Versions.LatestSnapshot },
                    versions = all.Select(v => new { v.Id, v.Type, released = v.Released }),
                    installed,
                };
            }
            case "loader.versions": return (await Loaders.List(Str(a, "loader"), Str(a, "mc"))).Select(l => new { l.Version, l.Stable, l.Recommended });
            case "loader.games": return (await Loaders.GameVersions(Str(a, "loader"))).ToList();

            // ---------------- instances
            case "instances.list": return Instances.All().Select(Dto).ToList();
            case "instance.create":
            {
                var inst = Instances.Create(Str(a, "name"), Str(a, "mc"), StrN(a, "loader") ?? "vanilla", StrN(a, "loaderVersion"));
                inst.Icon = StrN(a, "icon") ?? "grass";
                inst.RamMb = Int(a, "ramMb");
                Instances.Save(inst);
                // download everything in the background so the first start is instant
                _ = WithTask(async p => { try { await Runner.Prepare(inst, S, p); } catch (Exception e) { Emit("log", new { id = inst.Id, line = "[OrbitLauncher] Vorbereitung fehlgeschlagen: " + e.Message }); } return 0; });
                return Dto(inst);
            }
            case "instance.update":
            {
                var inst = Inst(a);
                if (a["patch"] is JsonObject pt)
                {
                    if (pt["name"] != null) inst.Name = (string?)pt["name"] ?? inst.Name;
                    if (pt["icon"] != null) inst.Icon = (string?)pt["icon"] ?? inst.Icon;
                    if (pt.ContainsKey("ramMb")) inst.RamMb = Int(pt, "ramMb");
                    if (pt.ContainsKey("javaPath")) inst.JavaPath = StrN(pt, "javaPath");
                    if (pt.ContainsKey("jvmArgs")) inst.JvmArgs = StrN(pt, "jvmArgs");
                    if (pt.ContainsKey("width")) inst.Width = Int(pt, "width");
                    if (pt.ContainsKey("height")) inst.Height = Int(pt, "height");
                }
                Instances.Save(inst);
                return Dto(inst);
            }
            case "instance.delete":
            {
                var inst = Inst(a);
                if (_runner.IsRunning(inst.Id)) throw new InvalidOperationException("Die Instanz läuft noch.");
                await Task.Run(() => Instances.Delete(inst.Id));
                return new { };
            }
            case "instance.repair":
            {
                var inst = Inst(a);
                // re-check the version JSON and all files (sizes); missing ones are downloaded again
                return await WithTask(async p => { await Runner.Prepare(inst, S, p); return new { ok = true }; });
            }
            case "instance.content": { var inst = Inst(a); return await Task.Run(() => Instances.ListFiles(inst, Str(a, "type"))); }
            case "content.toggle": Instances.Toggle(Inst(a), Str(a, "type"), Str(a, "file"), Bool(a, "on")); return new { };
            case "content.remove": Instances.RemoveFile(Inst(a), Str(a, "type"), Str(a, "file")); return new { };
            case "content.updates": return await Modrinth.CheckUpdates(Inst(a));
            case "content.updateAll": { var inst = Inst(a); return await WithTask(async p => new { count = await Modrinth.UpdateAll(inst, p) }); }

            // ---------------- launch
            case "launch":
            {
                var inst = Inst(a);
                var acc = _auth.Active ?? throw new InvalidOperationException("Bitte zuerst mit einem Microsoft-Konto anmelden.");
                var session = await _auth.GetSession(acc);
                await WithTask(async p =>
                {
                    if (S.AutoUpdateMods && inst.Content.Count > 0) { try { await Modrinth.UpdateAll(inst, p); } catch { } }
                    await _runner.Launch(inst, session, S, p);
                    return 0;
                });
                if (S.OnLaunch is "minimize" or "close")
                {
                    _hiddenForGame = true;
                    if (S.OnLaunch == "close") Hide(); else WindowState = WindowState.Minimized;
                }
                return new { };
            }
            case "stop": _runner.Kill(Str(a, "id")); return new { };

            // ---------------- modrinth
            case "mr.categories": return await Modrinth.Categories();
            case "mr.search":
            {
                var cats = (a["cats"] as JsonArray)?.Select(x => (string?)x ?? "").Where(x => x.Length > 0).ToList();
                return await Modrinth.Search(StrN(a, "query"), Str(a, "type"), StrN(a, "mc"), StrN(a, "loader"), cats, StrN(a, "sort") ?? "relevance", Int(a, "offset"), Math.Max(1, Int(a, "limit")));
            }
            case "mr.project": return await Modrinth.Project(Str(a, "id"));
            case "mr.install":
            {
                var inst = Inst(a);
                var r = await WithTask(p => Modrinth.Install(inst, Str(a, "project"), Str(a, "type"), StrN(a, "version"), p));
                return new { installed = r.Installed, skipped = r.Skipped };
            }
            case "mr.modpack":
            {
                var inst = await WithTask(p => Modrinth.InstallModpack(Str(a, "project"), StrN(a, "version"), p));
                _ = WithTask(async p => { try { await Runner.Prepare(inst, S, p); } catch { } return 0; });
                return Dto(inst);
            }
            case "pack.import":
            {
                var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "Modrinth-Modpack (*.mrpack)|*.mrpack", Title = "Modpack importieren" };
                if (dlg.ShowDialog(this) != true) return null;
                var inst = await WithTask(p => Modrinth.ImportPack(dlg.FileName, null, p));
                _ = WithTask(async p => { try { await Runner.Prepare(inst, S, p); } catch { } return 0; });
                return Dto(inst);
            }

            // ---------------- orbit client
            case "orbit.info":
            {
                string? best = null;
                try { best = await OrbitClient.BestVersion(); } catch { }
                var releases = (await Versions.All()).Where(v => v.Type == "release").Select(v => v.Id).Take(30).ToList();
                return new
                {
                    best, versions = releases,
                    modules = OrbitClient.Modules.Select(m => new { m.Id, m.Name, m.Desc, m.Icon, @default = m.Default, mods = m.Mods.Length }),
                    existing = Instances.All().Where(i => i.Kind == "orbit").Select(Dto),
                };
            }
            case "orbit.create":
            {
                var mods = (a["modules"] as JsonArray)?.Select(x => (string?)x ?? "").ToList() ?? new();
                var ram = Int(a, "ramMb");
                var r = await WithTask(p => OrbitClient.Create(StrN(a, "mc"), mods, ram > 0 ? ram : 3072, p));
                _ = WithTask(async p => { try { await Runner.Prepare(r.inst, S, p); } catch { } return 0; });
                return new { id = r.inst.Id, installed = r.installed, skipped = r.skipped };
            }

            // ---------------- other clients
            case "clients.detect": return ExternalClients.Detect().Select(f => new { f.Id, f.Name, f.Path });
            case "clients.start":
            {
                var f = ExternalClients.Detect().FirstOrDefault(x => x.Id == Str(a, "id")) ?? throw new InvalidOperationException("Nicht installiert");
                ExternalClients.Start(f.Path);
                return new { };
            }

            // ---------------- java
            case "java.list": return Java.Installed().Select(j => new { j.Path, j.Major, j.Source });
            case "java.pick":
            {
                var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "Java (java.exe;javaw.exe)|java.exe;javaw.exe", Title = "Java auswählen" };
                if (dlg.ShowDialog(this) != true) return null;
                var major = await Java.ProbeMajor(dlg.FileName);
                if (major == 0) throw new InvalidOperationException("Das ist kein funktionierendes Java.");
                return new { path = dlg.FileName, major };
            }

            // ---------------- microsoft account
            case "auth.start":
            {
                _auth.ClientId = S.ClientId;
                _dcCts?.Cancel();
                _dcCts = new CancellationTokenSource();
                _dc = await _auth.StartDeviceCode(_dcCts.Token);
                return new { _dc.UserCode, _dc.VerificationUri };
            }
            case "auth.finish":
            {
                if (_dc == null || _dcCts == null) throw new InvalidOperationException("Keine Anmeldung gestartet.");
                var acc = await _auth.FinishDeviceCode(_dc, _dcCts.Token);
                _dc = null;
                return new { account = new { acc.Uuid, acc.Name }, accounts = _auth.Accounts.Select(x => new { x.Uuid, x.Name, skin = x.SkinUrl?.Replace("http://", "https://") }), active = _auth.Active?.Uuid };
            }
            case "auth.cancel": _dcCts?.Cancel(); _dc = null; return new { };
            case "auth.select": _auth.ActiveUuid = Str(a, "uuid"); _auth.Save(); return AccountsDto();
            case "auth.remove": _auth.Remove(Str(a, "uuid")); return AccountsDto();
        }
        throw new InvalidOperationException("Unbekannter Befehl: " + cmd);
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
}
