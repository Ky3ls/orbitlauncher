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
    private readonly GameOverlay _overlay = new();
    private string? _overlayFor;
    private FileSystemWatcher? _cfgWatch;
    private string _cfgLast = "";
    private DateTime _cfgDue;
    private readonly DiscordRpc _rpc = new("1571553631818219580");
    private List<Transfer.Found> _found = new();
    private int _syncing; private CancellationTokenSource? _syncDue;
    private static readonly string[] SyncedSettings = { "Accent", "RamMb", "JvmArgs", "Width", "Height", "OnLaunch", "AutoUpdateMods", "ShowSnapshots", "DiscordRpc", "OrbitPacks", "PlayMode", "Fx", "Mode" };

    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wp, IntPtr lp);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);

    public MainWindow()
    {
        Net.AppVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
        _auth = new Auth(ClientIdFor(S));
        Updater.CleanupOld();
        if (!string.IsNullOrWhiteSpace(S.CloudApi)) Cloud.Api = S.CloudApi!;
        Instances.Deleted += uid => { if (Cloud.LoggedIn) Cloud.MarkDeleted(uid); };
        Instances.Changed += _ => ScheduleSync();
        if (Cloud.LoggedIn) _ = Task.Delay(3000).ContinueWith(_ => RunSync(false));
        CurseForge.Key = string.IsNullOrWhiteSpace(S.CurseForgeKey) ? CurseForge.BuiltInKey : S.CurseForgeKey!;
        OrbitClient.ModJar = () => Assembly.GetExecutingAssembly().GetManifestResourceStream("mod/orbitclient.jar");
        InitializeComponent();

        var wa = SystemParameters.WorkArea;
        _zoom = Math.Min(1, Math.Min((wa.Width - 24) / 1280, (wa.Height - 24) / 800));
        if (wa.Width >= 2500 && wa.Height >= 1500) _zoom = 1.25;
        MinWidth = Math.Min(1000 * _zoom, wa.Width - 24); MinHeight = Math.Min(640 * _zoom, wa.Height - 24);
        // bigger by default; the last size and position are remembered
        Width = Math.Min(wa.Width - 40, 1520 * _zoom); Height = Math.Min(wa.Height - 40, 940 * _zoom);
        if (S.WinW >= MinWidth && S.WinH >= MinHeight && S.WinW <= wa.Width + 16 && S.WinH <= wa.Height + 16)
        {
            Width = S.WinW; Height = S.WinH;
            if (S.WinX > wa.Left - 100 && S.WinX < wa.Right - 200 && S.WinY >= wa.Top - 10 && S.WinY < wa.Bottom - 100)
            { WindowStartupLocation = WindowStartupLocation.Manual; Left = S.WinX; Top = S.WinY; }
        }
        if (S.WinMax) Loaded += (_, _) => WindowState = WindowState.Maximized;

        SourceInitialized += (_, _) =>
        {
            var h = new WindowInteropHelper(this).Handle;
            int round = 2; DwmSetWindowAttribute(h, 33, ref round, sizeof(int));   // rounded corners (Windows 11)
            int dark = 1; DwmSetWindowAttribute(h, 20, ref dark, sizeof(int));     // dark title/border
        };
        StateChanged += (_, _) => Root.Margin = WindowState == WindowState.Maximized ? SystemParameters.WindowResizeBorderThickness : new Thickness(0);
        // minimized: let the web view drop caches and run with as little memory as possible
        StateChanged += (_, _) =>
        {
            try { if (Web.CoreWebView2 != null) Web.CoreWebView2.MemoryUsageTargetLevel = WindowState == WindowState.Minimized ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal; } catch { }
        };
        Loaded += async (_, _) => await InitWeb();
        Closing += (_, _) => { _rpc.Dispose(); SaveBounds(); S.Save(); _overlay.Detach(); _overlay.Close(); };
        WatchConfig();

        _runner.Log += (id, line) => Emit("log", new { id, line });
        _runner.State += (id, running, code) =>
        {
            if (S.DiscordRpc) Task.Run(() =>
            {
                var ri = Instances.All().FirstOrDefault(x => _runner.IsRunning(x.Id));
                if (ri == null) _rpc.Set(null, null, null);
                else _rpc.Set("Spielt " + ri.Name, $"Minecraft {ri.McVersion} · {Loaders.Name(ri.Loader)}", DateTime.Now);
            });
            Dispatcher.InvokeAsync(() =>
            {
                var oi = Instances.Get(id);
                if (running && oi != null && oi.Kind == "orbit" && !OrbitClient.HasMod(oi) && _runner.ProcessOf(id) is Process gp)
                { _overlay.Attach(gp, oi.Dir, OrbitClient.ReadConfig()); _overlayFor = id; }
                else if (!running && _overlayFor == id) { _overlay.Detach(); _overlayFor = null; }
            });
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
            c.SetVirtualHostNameToFolderMapping("shots.orbit", Paths.Instances, CoreWebView2HostResourceAccessKind.Allow);
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
        Dispatcher.InvokeAsync(() => Post(json));
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
            // leave the WebView2 event first: dialogs (Microsoft sign-in window, file pickers) must not run a
            // nested message loop inside WebMessageReceived, otherwise a second WebView never finishes loading
            if (!cmd.StartsWith("win.")) await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Input);
            var data = await Handle(cmd, args);
            var payload = data is JsonNode jn ? $"{{\"id\":{id},\"ok\":true,\"data\":{jn.ToJsonString()}}}" : JsonSerializer.Serialize(new { id, ok = true, data }, J);
            Post(payload);
        }
        catch (Exception ex)
        {
            var msg = ex is HttpRequestException ? "Netzwerkfehler: " + ex.Message : ex.Message;
            Post(JsonSerializer.Serialize(new { id, ok = false, error = msg }, J));
        }
    }

    /// <summary>Answers the UI; ignored when the WebView is already gone (app closing / updating).</summary>
    private void Post(string json)
    {
        try { if (!App.Quitting) Web.CoreWebView2?.PostWebMessageAsJson(json); } catch { }
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

    private bool _argsUsed;
    private object Dto(Instance i)
    {
        int mods = 0;
        try { var d = Path.Combine(i.Dir, "mods"); if (Directory.Exists(d)) mods = Directory.EnumerateFiles(d, "*.jar").Count(); } catch { }
        return new
        {
            i.Id, i.Name, i.McVersion, i.Loader, i.LoaderVersion, i.VersionId, i.Kind, i.Icon, i.IconUrl, i.BannerUrl, i.RamMb, i.JavaPath, i.JvmArgs, i.Width, i.Height,
            i.PlaySeconds, i.LastPlayed, i.Created, i.Group, i.ModpackProject, i.ManualDownloads, mods, running = _runner.IsRunning(i.Id),
            i.Fullscreen, i.AutoJoin, i.EnvVars, i.PreLaunch, i.Wrapper, i.PostExit, i.OnLaunch, i.Notes,
            content = i.Content.Select(c => new { c.ProjectId, c.Type, c.Source }),
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
            case "win.resize":
            {
                if (WindowState == WindowState.Maximized) return null;
                var ht = Str(a, "edge") switch { "w" => 10, "e" => 11, "n" => 12, "nw" => 13, "ne" => 14, "s" => 15, "sw" => 16, "se" => 17, _ => 0 };
                if (ht == 0) return null;
                ReleaseCapture(); SendMessage(new WindowInteropHelper(this).Handle, 0xA1, (IntPtr)ht, IntPtr.Zero);
                return null;
            }

            // ---------------- general
            case "init":
            {
                return new
                {
                    needAppId = string.IsNullOrWhiteSpace(ClientIdFor(S)), cfReady = CurseForge.Ready,
                    version = Net.AppVersion, root = Paths.Root, settings = S, user = Environment.UserName,
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
                if (SyncedSettings.Contains(prop.Name)) { S.SyncAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); ScheduleSync(); }
                S.Save();
                if (prop.Name == nameof(Settings.ClientId)) _auth.ClientId = ClientIdFor(S);
                if (prop.Name == nameof(Settings.CurseForgeKey)) CurseForge.Key = string.IsNullOrWhiteSpace(S.CurseForgeKey) ? CurseForge.BuiltInKey : S.CurseForgeKey!;
                if (prop.Name == nameof(Settings.DiscordRpc) && !S.DiscordRpc) _ = Task.Run(() => _rpc.Set(null, null, null));
                if (prop.Name == nameof(Settings.Accent))
                {
                    var cfg = OrbitClient.ReadConfig() ?? new JsonObject();
                    cfg["accent"] = AccentHex(S.Accent);
                    _cfgLast = cfg.ToJsonString();
                    OrbitClient.WriteConfig(cfg); _overlay.SetConfig(cfg);
                }
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
                inst.IconUrl = StrN(a, "iconUrl");
                inst.Group = StrN(a, "group");
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
                    if (pt["bannerUrl"] != null) inst.BannerUrl = StrN(pt, "bannerUrl");
                    if (pt.ContainsKey("iconUrl")) { var iu = StrN(pt, "iconUrl"); if (iu == null || iu.StartsWith("data:image/") || iu.StartsWith("https://")) inst.IconUrl = iu; }
                    if (pt.ContainsKey("ramMb")) inst.RamMb = Int(pt, "ramMb");
                    if (pt.ContainsKey("javaPath")) inst.JavaPath = StrN(pt, "javaPath");
                    if (pt.ContainsKey("jvmArgs")) inst.JvmArgs = StrN(pt, "jvmArgs");
                    if (pt.ContainsKey("width")) inst.Width = Int(pt, "width");
                    if (pt.ContainsKey("height")) inst.Height = Int(pt, "height");
                    if (pt.ContainsKey("group")) inst.Group = StrN(pt, "group");
                    if (pt.ContainsKey("fullscreen")) inst.Fullscreen = Bool(pt, "fullscreen");
                    if (pt.ContainsKey("autoJoin")) inst.AutoJoin = StrN(pt, "autoJoin");
                    if (pt.ContainsKey("envVars")) inst.EnvVars = StrN(pt, "envVars");
                    if (pt.ContainsKey("preLaunch")) inst.PreLaunch = StrN(pt, "preLaunch");
                    if (pt.ContainsKey("wrapper")) inst.Wrapper = StrN(pt, "wrapper");
                    if (pt.ContainsKey("postExit")) inst.PostExit = StrN(pt, "postExit");
                    if (pt.ContainsKey("onLaunch")) inst.OnLaunch = StrN(pt, "onLaunch");
                    if (pt.ContainsKey("notes")) inst.Notes = StrN(pt, "notes");
                    if (pt.ContainsKey("modpackProject")) inst.ModpackProject = StrN(pt, "modpackProject");
                    var mc = StrN(pt, "mc"); var ld = StrN(pt, "loader"); var lv = pt.ContainsKey("loaderVersion") ? StrN(pt, "loaderVersion") : inst.LoaderVersion;
                    if ((mc != null && mc != inst.McVersion) || (ld != null && ld != inst.Loader) || lv != inst.LoaderVersion)
                    {
                        if (_runner.IsRunning(inst.Id)) throw new InvalidOperationException("Die Instanz läuft noch.");
                        inst.McVersion = mc ?? inst.McVersion; inst.Loader = ld ?? inst.Loader; inst.LoaderVersion = inst.Loader == "vanilla" ? null : lv;
                        inst.VersionId = null;   // installed again on the next start / repair
                    }
                }
                Instances.Save(inst);
                return Dto(inst);
            }
            case "library.stats":
                return await Task.Run(() =>
                {
                    long size = 0; int worlds = 0, shots = 0, shaders = 0, rps = 0;
                    foreach (var inst in Instances.All())
                    {
                        try
                        {
                            size += DirSize(inst.Dir);
                            int Dirs(string sub) { var d = Path.Combine(inst.Dir, sub); return Directory.Exists(d) ? Directory.EnumerateDirectories(d).Count() : 0; }
                            int Files(string sub, string pat) { var d = Path.Combine(inst.Dir, sub); return Directory.Exists(d) ? Directory.EnumerateFiles(d, pat).Count() : 0; }
                            worlds += Dirs("saves"); shots += Files("screenshots", "*.png");
                            shaders += Files("shaderpacks", "*.zip") + Dirs("shaderpacks"); rps += Files("resourcepacks", "*.zip") + Dirs("resourcepacks");
                        }
                        catch { }
                    }
                    return new { size, worlds, screenshots = shots, shaders, resourcepacks = rps };
                });
            case "instance.stats":
            {
                var inst = Inst(a);
                return await Task.Run(() =>
                {
                    int Count(string sub, params string[] pat) { var d = Path.Combine(inst.Dir, sub); if (!Directory.Exists(d)) return 0; return pat.Sum(x => Directory.EnumerateFiles(d, x).Count()); }
                    int Dirs(string sub) { var d = Path.Combine(inst.Dir, sub); return Directory.Exists(d) ? Directory.EnumerateDirectories(d).Count() : 0; }
                    return new
                    {
                        size = DirSize(inst.Dir), mods = Count("mods", "*.jar", "*.jar.disabled"), resourcepacks = Count("resourcepacks", "*.zip") + Dirs("resourcepacks"),
                        shaders = Count("shaderpacks", "*.zip") + Dirs("shaderpacks"), worlds = Dirs("saves"), screenshots = Count("screenshots", "*.png"),
                        updates = inst.Content.Count, path = inst.Dir,
                    };
                });
            }
            case "instance.shortcut":
            {
                var inst = Inst(a);
                var exe = Environment.ProcessPath ?? throw new InvalidOperationException("Programmpfad unbekannt");
                var desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                var safe = string.Concat(inst.Name.Split(Path.GetInvalidFileNameChars()));
                var lnk = Path.Combine(desk, safe + ".lnk");
                var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Verknüpfungen werden nicht unterstützt");
                dynamic shell = Activator.CreateInstance(shellType)!;
                dynamic sc = shell.CreateShortcut(lnk);
                sc.TargetPath = exe; sc.Arguments = "--launch \"" + inst.Id + "\""; sc.WorkingDirectory = Path.GetDirectoryName(exe); sc.IconLocation = exe + ",0";
                sc.Description = "Minecraft: " + inst.Name; sc.Save();
                return new { path = lnk };
            }
            case "app.args":
            {
                var cl = Environment.GetCommandLineArgs(); var ix = Array.IndexOf(cl, "--launch");
                var id = ix >= 0 && ix + 1 < cl.Length && !_argsUsed ? cl[ix + 1] : null; _argsUsed = true;
                return new { launch = id };
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
            case "instance.content":
            {
                var inst = Inst(a);
                return Instances.ListFiles(inst, Str(a, "type"));
            }
            case "instance.brand":
            {
                var inst = Inst(a);
                if (await Transfer.Enrich(inst)) Instances.Save(inst);
                return new { inst.IconUrl, inst.BannerUrl, inst.ModpackProject, inst.Kind };
            }
            case "content.resolve":
            {
                var inst = Inst(a);
                var changed = await Modrinth.AttachCatalog(inst);
                return new { changed };
            }
            case "content.toggle": Instances.Toggle(Inst(a), Str(a, "type"), Str(a, "file"), Bool(a, "on")); return new { };
            case "content.remove": Instances.RemoveFile(Inst(a), Str(a, "type"), Str(a, "file")); return new { };
            case "content.updates":
            {
                var inst = Inst(a);
                var ups = await Modrinth.CheckUpdates(inst);
                ups.AddRange(await CurseForge.CheckUpdates(inst));
                return ups;
            }
            case "content.updateAll": { var inst = Inst(a); return await WithTask(async p => new { count = await Modrinth.UpdateAll(inst, p) }); }
            case "content.versions":
            {
                var inst = Inst(a);
                var pid = Str(a, "projectId");
                var c = inst.Content.FirstOrDefault(x => x.ProjectId == pid) ?? throw new InvalidOperationException("Inhalt nicht gefunden.");
                if (c.Source == "curseforge" || pid.StartsWith("cf:", StringComparison.Ordinal)) return await CurseForge.Versions(inst, c);
                return await Modrinth.Versions(inst, c);
            }
            case "content.setVersion":
            {
                var inst = Inst(a);
                if (_runner.IsRunning(inst.Id)) throw new InvalidOperationException("Beende das Spiel, bevor du Versionen wechselst.");
                var pid = Str(a, "projectId");
                var vid = StrN(a, "versionId") ?? throw new InvalidOperationException("Keine Version gewählt.");
                return await WithTask(async p =>
                {
                    var c = inst.Content.FirstOrDefault(x => x.ProjectId == pid) ?? throw new InvalidOperationException("Inhalt nicht gefunden.");
                    var dir = Instances.ContentDir(inst, c.Type);
                    var wasOff = !File.Exists(Path.Combine(dir, c.File)) && File.Exists(Path.Combine(dir, c.File + ".disabled"));
                    if (c.Source == "curseforge" || pid.StartsWith("cf:", StringComparison.Ordinal)) await CurseForge.Install(inst, int.Parse(pid[3..]), int.Parse(vid), p);
                    else await Modrinth.Install(inst, pid, c.Type, vid, p);
                    if (wasOff)
                    {
                        var now = inst.Content.FirstOrDefault(x => x.ProjectId == pid);
                        if (now != null) Instances.Toggle(inst, now.Type, now.File, false);
                    }
                    return new { count = 1 };
                });
            }

            case "instance.duplicate":
            {
                var src = Inst(a);
                var copy = await Task.Run(() =>
                {
                    var c = Instances.Create(src.Name + " (Kopie)", src.McVersion, src.Loader, src.LoaderVersion, src.Kind);
                    foreach (var f in Directory.EnumerateFiles(src.Dir, "*", SearchOption.AllDirectories))
                    {
                        var rel = Path.GetRelativePath(src.Dir, f);
                        if (rel == "instance.json" || rel.StartsWith("logs") || rel.StartsWith("crash-reports")) continue;
                        var t = Path.Combine(c.Dir, rel);
                        Directory.CreateDirectory(Path.GetDirectoryName(t)!);
                        File.Copy(f, t, true);
                    }
                    c.VersionId = src.VersionId; c.Icon = src.Icon; c.RamMb = src.RamMb; c.JavaPath = src.JavaPath; c.JvmArgs = src.JvmArgs;
                    c.Width = src.Width; c.Height = src.Height; c.Group = src.Group; c.Content = src.Content; c.ModpackProject = src.ModpackProject; c.ModpackVersion = src.ModpackVersion;
                    Instances.Save(c);
                    return c;
                });
                return Dto(copy);
            }
            case "instance.worlds":
            {
                var inst = Inst(a);
                return await Task.Run(() => new
                {
                    worlds = Worlds.List(inst).Select(w => new { w.Folder, w.Name, w.LastPlayed, w.Mode, w.Hardcore, icon = w.Icon ? $"https://shots.orbit/{Uri.EscapeDataString(inst.Id)}/saves/{Uri.EscapeDataString(w.Folder)}/icon.png" : null }),
                    servers = Worlds.Servers(inst).Select(sv => new { sv.Name, sv.Ip, icon = sv.Icon ? "data:image/png;base64," + Worlds.ServerIcon(inst, sv.Ip) : null }),
                });
            }
            case "worlds.recent":
                return await Task.Run(() => Instances.All().SelectMany(i => { try { return Worlds.List(i).Take(4).Select(w => (i, w)); } catch { return Enumerable.Empty<(Instance, Worlds.World)>(); } })
                    .OrderByDescending(x => x.Item2.LastPlayed).Take(8)
                    .Select(x => new { id = x.Item1.Id, instance = x.Item1.Name, x.Item1.McVersion, x.Item2.Folder, x.Item2.Name, x.Item2.LastPlayed, x.Item2.Mode,
                        icon = x.Item2.Icon ? $"https://shots.orbit/{Uri.EscapeDataString(x.Item1.Id)}/saves/{Uri.EscapeDataString(x.Item2.Folder)}/icon.png" : null }).ToList());
            case "world.open":
            {
                var d = Worlds.WorldDir(Inst(a), Str(a, "folder"));
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{d}\"") { UseShellExecute = true });
                return null;
            }
            case "world.delete":
            {
                var inst = Inst(a);
                if (_runner.IsRunning(inst.Id)) throw new InvalidOperationException("Die Instanz läuft noch.");
                var d = Worlds.WorldDir(inst, Str(a, "folder"));
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(d, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                return new { };
            }
            case "instance.logs": return Worlds.Logs(Inst(a));
            case "instance.log": { var inst = Inst(a); return new { text = await Task.Run(() => Worlds.ReadLog(inst, Str(a, "name"))) }; }
            case "content.addFile":
            {
                var inst = Inst(a); var type = Str(a, "type");
                var dlg = new Microsoft.Win32.OpenFileDialog { Multiselect = true, Title = "Dateien hinzufügen",
                    Filter = type == "mod" ? "Mods (*.jar)|*.jar" : "Pakete (*.zip)|*.zip" };
                if (dlg.ShowDialog(this) != true) return new { count = 0 };
                var dir = Instances.ContentDir(inst, type); Directory.CreateDirectory(dir);
                foreach (var f in dlg.FileNames) File.Copy(f, Path.Combine(dir, Path.GetFileName(f)), true);
                return new { count = dlg.FileNames.Length };
            }
            case "storage.info":
                return await Task.Run(() => new[] { "instances", "versions", "libraries", "assets", "runtime", "cache" }
                    .Select(n => new { name = n, size = DirSize(Path.Combine(Paths.Root, n)) }).ToList());
            case "cache.clear":
                await Task.Run(() => { try { Directory.Delete(Paths.Cache, true); } catch { } });
                return new { };

            // ---------------- launch
            case "launch":
            {
                var inst = Inst(a);
                var acc = _auth.Active ?? throw new InvalidOperationException("Bitte zuerst mit einem Microsoft-Konto anmelden.");
                var session = await _auth.GetSession(acc);
                await WithTask(async p =>
                {
                    if (S.AutoUpdateMods && inst.Content.Count > 0) { try { await Modrinth.UpdateAll(inst, p); } catch { } }
                    await _runner.Launch(inst, session, S, p, default, StrN(a, "server"), StrN(a, "world"));
                    return 0;
                });
                var onl = inst.OnLaunch ?? S.OnLaunch;
                if (onl is "minimize" or "close")
                {
                    _hiddenForGame = true;
                    if (onl == "close") Hide(); else WindowState = WindowState.Minimized;
                }
                return new { };
            }
            case "launch.official":
            {
                var inst = Inst(a);
                var name = await WithTask(p => OfficialLauncher.Export(inst, S, p));
                var opened = OfficialLauncher.Open();
                return new { profile = name, opened, found = OfficialLauncher.FindExe() != null };
            }
            case "stop": _runner.Kill(Str(a, "id")); return new { };

            // ---------------- modrinth
            case "mr.get":
            {
                // read-only proxy for the Modrinth API (proper user agent, no CORS); only relative API paths
                var path = Str(a, "path");
                if (!path.StartsWith('/') || path.Contains("://") || path.Contains("..") || path.Contains('\\')) throw new ArgumentException("Ungültiger Pfad");
                return await Net.Json("https://api.modrinth.com/v2" + path);
            }
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
                var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "Modpacks (*.mrpack;*.zip)|*.mrpack;*.zip", Title = "Modpack importieren" };
                if (dlg.ShowDialog(this) != true) return null;
                var file = dlg.FileName;
                var inst = await WithTask(p => file.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && CurseForge.IsCfPack(file) ? CurseForge.ImportPack(file, null, p) : Modrinth.ImportPack(file, null, p));
                _ = WithTask(async p => { try { await Runner.Prepare(inst, S, p); } catch { } return 0; });
                return Dto(inst);
            }

            // ---------------- orbit client
            case "orbit.info":
            {
                var all = await Versions.All();
                return new
                {
                    best = OrbitClient.Supported[0], supported = OrbitClient.Supported, overlay = OrbitClient.OverlayModules,
                    last = S.OrbitVersion ?? OrbitClient.Supported[0],
                    versions = all.Select(v => new { v.Id, v.Type }),
                    packs = OrbitClient.Packs.Select(m => new { m.Id, m.Name, m.Desc, m.Icon, @default = m.Default, mods = m.Mods.Length }),
                    selPacks = S.OrbitPacks,
                    existing = Instances.All().Where(i => i.Kind == "orbit").Select(Dto),
                };
            }
            case "orbit.play":
            {
                // one click: create the Orbit instance for this version if needed, download everything and start
                var mc = Str(a, "mc");
                if (string.IsNullOrEmpty(mc)) mc = S.OrbitVersion ?? OrbitClient.Supported[0];
                var acc = _auth.Active ?? throw new InvalidOperationException("Bitte zuerst mit einem Microsoft-Konto anmelden.");
                var session = await _auth.GetSession(acc);
                S.OrbitVersion = mc; S.Save();
                var packs = (S.OrbitPacks ?? "perf,shaders,qol").Split(',', StringSplitOptions.RemoveEmptyEntries);
                var accent = AccentHex(S.Accent);
                var inst = await WithTask(async p =>
                {
                    var i = await OrbitClient.EnsureInstance(mc, packs, S.RamMb > 0 ? Math.Min(S.RamMb, 4096) : 3072, accent, p);
                    var cfg = OrbitClient.ReadConfig() ?? new JsonObject();
                    if ((string?)cfg["accent"] != accent) { cfg["accent"] = accent; OrbitClient.WriteConfig(cfg); }
                    await _runner.Launch(i, session, S, p);
                    return i;
                });
                if (S.OnLaunch is "minimize" or "close") { _hiddenForGame = true; if (S.OnLaunch == "close") Hide(); else WindowState = WindowState.Minimized; }
                return new { id = inst.Id, mod = OrbitClient.HasMod(inst) };
            }
            case "orbit.create":
            {
                var packs = (a["packs"] as JsonArray)?.Select(x => (string?)x ?? "").ToList() ?? new();
                var ram = Int(a, "ramMb");
                var r = await WithTask(p => OrbitClient.Create(StrN(a, "mc"), packs, ram > 0 ? ram : 3072, AccentHex(S.Accent), p));
                _ = WithTask(async p => { try { await Runner.Prepare(r.inst, S, p); } catch { } return 0; });
                return new { id = r.inst.Id, installed = r.installed, skipped = r.skipped };
            }
            case "orbit.config.get": return OrbitClient.ReadConfig() ?? new JsonObject { ["modules"] = new JsonObject() };
            case "orbit.config.set":
            {
                var cfg = (a["config"] as JsonObject)?.DeepClone() as JsonObject ?? new JsonObject();
                cfg["accent"] = AccentHex(S.Accent);
                _cfgLast = cfg.ToJsonString();
                OrbitClient.WriteConfig(cfg);
                _overlay.SetConfig(cfg);
                return new { };
            }

            // ---------------- screenshots
            case "screenshots.list":
                return await Task.Run(() => Instances.All().SelectMany(i =>
                {
                    var d = Path.Combine(i.Dir, "screenshots");
                    if (!Directory.Exists(d)) return Enumerable.Empty<object>();
                    return new DirectoryInfo(d).GetFiles("*.png").Select(f => (object)new
                    {
                        id = i.Id, version = i.McVersion, file = f.Name, date = f.LastWriteTimeUtc, size = f.Length,
                        url = $"https://shots.orbit/{Uri.EscapeDataString(i.Id)}/screenshots/{Uri.EscapeDataString(f.Name)}",
                    });
                }).OrderByDescending(x => ((dynamic)x).date).Take(300).ToList());
            case "screenshots.open":
            {
                var f = ShotPath(a);
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{f}\"") { UseShellExecute = true });
                return null;
            }
            case "screenshots.delete": { var f = ShotPath(a); File.Delete(f); return new { }; }

            // ---------------- launcher updates (GitHub Releases of Ky3ls/orbitlauncher)
            case "update.check": return await Updater.Check();
            case "update.download":
                await Updater.Download((pct, done, total) => Emit("update", new { pct, done, total }));
                return new { ok = true };
            case "update.install":
                if (_runner.RunningIds.Any()) throw new InvalidOperationException("Erst Minecraft beenden, dann wird das Update installiert.");
                Updater.Install();
                App.Quitting = true;
                _ = Dispatcher.InvokeAsync(async () => { await Task.Delay(400); Application.Current.Shutdown(); });
                return new { ok = true };

            // ---------------- orbit account + cloud sync
            case "cloud.status": return new { loggedIn = Cloud.LoggedIn, name = Cloud.Name, lastSync = Cloud.LastSync, syncing = _syncing > 0 };
            case "cloud.login":
            {
                var r = await Cloud.Login(Str(a, "name"), Str(a, "password"), Bool(a, "register"));
                if (r.Need == null) _ = RunSync(true);
                return new { name = r.Name, need = r.Need, ticket = r.Ticket };
            }
            case "cloud.totp":
            {
                var name = await Cloud.LoginTotp(Str(a, "ticket"), Str(a, "code"));
                _ = RunSync(true);
                return new { name };
            }
            case "cloud.totp.start": return await Cloud.TotpStart();
            case "cloud.totp.confirm": return await Cloud.TotpConfirm(Str(a, "code"));
            case "cloud.totp.disable": await Cloud.TotpDisable(Str(a, "password"), Str(a, "code")); return new { };
            case "cloud.passkey.begin": return await Cloud.PasskeyBegin(StrN(a, "name"));
            case "cloud.passkey.finish":
            {
                var name = await Cloud.PasskeyFinish(Str(a, "id"), Str(a, "clientDataJSON"), Str(a, "authenticatorData"), Str(a, "signature"));
                _ = RunSync(true);
                return new { name };
            }
            case "cloud.passkey.add.begin": return await Cloud.PasskeyAddBegin();
            case "cloud.passkey.add.finish": return await Cloud.PasskeyAddFinish(Str(a, "clientDataJSON"), Str(a, "attestationObject"), StrN(a, "name"));
            // passkeys through native Windows Hello (the embedded browser can't start it reliably)
            case "cloud.passkey.native": return new { available = WinHello.Supported, hello = WinHello.HelloReady };
            case "cloud.passkey.add.native":
            {
                var o = await Cloud.PasskeyAddBegin();
                var hwnd = new WindowInteropHelper(this).Handle;
                var exclude = (o["excludeCredentials"]?.AsArray() ?? new JsonArray()).Select(c => WinHello.FromB64u((string)c!["id"]!)).ToList();
                var made = await Task.Run(() => WinHello.Create(hwnd, (string)o["challenge"]!, WinHello.FromB64u((string)o["user"]!["id"]!), (string?)o["user"]!["name"] ?? "Orbit", exclude));
                return await Cloud.PasskeyAddFinish(made.ClientDataJSON, made.AttestationObject, StrN(a, "name") ?? Environment.MachineName);
            }
            case "cloud.passkey.login.native":
            {
                var o = await Cloud.PasskeyBegin(StrN(a, "name"));
                var hwnd = new WindowInteropHelper(this).Handle;
                var allow = (o["allowCredentials"]?.AsArray() ?? new JsonArray()).Select(c => WinHello.FromB64u((string)c!["id"]!)).ToList();
                if (allow.Count == 0) throw new InvalidOperationException("Für diesen Namen gibt es keinen Passkey. Melde dich mit Passwort an und leg in den Einstellungen einen an.");
                var sig = await Task.Run(() => WinHello.Get(hwnd, (string)o["challenge"]!, allow));
                var name = await Cloud.PasskeyFinish(sig.Id, sig.ClientDataJSON, sig.AuthenticatorData, sig.Signature);
                _ = RunSync(true);
                return new { name };
            }
            case "cloud.passkey.remove": await Cloud.PasskeyRemove(Str(a, "id")); return new { };
            case "cloud.logout": await Cloud.Logout(); return new { };
            case "cloud.sync": return await RunSync(true);
            case "cloud.me": return await Cloud.Me();
            case "cloud.password": await Cloud.ChangePassword(Str(a, "old"), Str(a, "password")); return new { };
            case "cloud.delete": await Cloud.DeleteAccount(Str(a, "password")); return new { };

            // ---------------- curseforge
            case "cf.status": return new { ready = CurseForge.Ready, own = !string.IsNullOrWhiteSpace(S.CurseForgeKey) };
            case "cf.get":
            {
                var path = Str(a, "path");
                if (!path.StartsWith('/') || path.Contains("://") || path.Contains("..") || path.Contains('\\')) throw new ArgumentException("Ungültiger Pfad");
                return await CurseForge.Get(path);
            }
            case "cf.install":
            {
                var inst = Inst(a); var fid = Int(a, "file");
                var r = await WithTask(p => CurseForge.Install(inst, Int(a, "project"), fid > 0 ? fid : null, p));
                return new { installed = r.Installed, skipped = r.Skipped };
            }
            case "cf.modpack":
            {
                var fid = Int(a, "file");
                var inst = await WithTask(p => CurseForge.InstallModpack(Int(a, "project"), fid > 0 ? fid : null, p));
                _ = WithTask(async p => { try { await Runner.Prepare(inst, S, p); } catch { } return 0; });
                return Dto(inst);
            }

            // ---------------- servers, backups, export, import
            case "server.ping": return await ServerPing.Ping(Str(a, "address"));
            case "backup.list": return Backups.List(Inst(a));
            case "backup.create": { var inst = Inst(a); var f = Str(a, "folder"); return await WithTask(p => { p.Report(new Progress("Backup wird erstellt", 0, 1, f)); return Task.FromResult(Backups.Create(inst, f)); }); }
            case "backup.delete": Backups.Delete(Inst(a), Str(a, "file")); return new { };
            case "backup.restore": { var inst = Inst(a); var f = Str(a, "file"); return new { world = await Task.Run(() => Backups.Restore(inst, f)) }; }
            case "backup.folder": { var d = Paths.Dir(Path.Combine("backups", Inst(a).Id)); Process.Start(new ProcessStartInfo("explorer.exe", $"\"{d}\"") { UseShellExecute = true }); return null; }
            case "instance.export":
            {
                var inst = Inst(a);
                var dlg = new Microsoft.Win32.SaveFileDialog { Filter = "Modpack (*.mrpack)|*.mrpack", FileName = $"{inst.Name} {StrN(a, "version") ?? "1.0.0"}.mrpack", Title = "Als Modpack exportieren" };
                if (dlg.ShowDialog(this) != true) return null;
                var target = dlg.FileName;
                await WithTask(async p => { await Transfer.Export(inst, target, StrN(a, "version") ?? "1.0.0", Bool(a, "worlds"), p); return 0; });
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{target}\"") { UseShellExecute = true });
                return new { path = target };
            }
            case "import.scan": _found = await Task.Run(Transfer.Scan); return _found.Select((f, i) => new { i, f.Launcher, f.Name, f.Mc, f.Loader });
            case "import.run":
            {
                var f = _found.ElementAtOrDefault(Int(a, "i")) ?? throw new InvalidOperationException("Nicht gefunden");
                var inst = await WithTask(p => Transfer.Import(f, p));
                _ = WithTask(async p => { try { await Runner.Prepare(inst, S, p); } catch { } return 0; });
                return Dto(inst);
            }

            // ---------------- skins
            case "skins.list": return Skins.All().Where(x => File.Exists(Skins.FileOf(x.Id))).Select(x => new { x.Id, x.Name, x.Variant, x.Added, url = Skins.DataUrl(x.Id) });
            case "skins.add":
            {
                byte[] png; string name = StrN(a, "name") ?? "Skin";
                if (StrN(a, "data") is string b64) png = Convert.FromBase64String(b64[(b64.IndexOf(',') + 1)..]);
                else if (StrN(a, "url") is string url) png = await Skins.Texture(url);
                else
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "Skin (*.png)|*.png", Title = "Skin hinzufügen" };
                    if (dlg.ShowDialog(this) != true) return null;
                    png = await File.ReadAllBytesAsync(dlg.FileName); name = Path.GetFileNameWithoutExtension(dlg.FileName);
                }
                var e = Skins.Add(png, name, Str(a, "variant"));
                return new { e.Id, e.Name, e.Variant, e.Added, url = Skins.DataUrl(e.Id) };
            }
            case "skins.defaults": return await WithTask(async p => { p.Report(new Progress("Standard-Skins werden geladen", 0, 1, "")); return await SkinSources.Defaults(); });
            case "skins.player": return await SkinSources.Player(Str(a, "name"));
            case "skins.link": return new { data = await SkinSources.FromLink(Str(a, "url")) };
            case "skins.save":
            {
                // editor: overwrite an existing skin or add a new one
                var b64 = Str(a, "data"); var png = Convert.FromBase64String(b64[(b64.IndexOf(',') + 1)..]);
                var id = StrN(a, "id"); var name = StrN(a, "name") ?? "Skin"; var variant = StrN(a, "variant") ?? "classic";
                Skins.Entry e;
                if (id != null && Skins.All().FirstOrDefault(x => x.Id == id) is { } old)
                {
                    Skins.Validate(png); File.WriteAllBytes(Skins.FileOf(id), png); Skins.Update(id, name, variant);
                    e = Skins.All().First(x => x.Id == id);
                }
                else e = Skins.Add(png, name, variant);
                return new { e.Id, e.Name, e.Variant, e.Added, url = Skins.DataUrl(e.Id) };
            }
            case "skins.update": Skins.Update(Str(a, "id"), StrN(a, "name"), StrN(a, "variant")); return new { };
            case "skins.remove": Skins.Remove(Str(a, "id")); return new { };
            case "skin.profile":
            {
                var acc = _auth.Active ?? throw new InvalidOperationException("Bitte zuerst anmelden.");
                var ses = await _auth.GetSession(acc);
                return await Skins.Profile(ses.AccessToken);
            }
            case "skin.apply":
            {
                var acc = _auth.Active ?? throw new InvalidOperationException("Bitte zuerst anmelden.");
                var ses = await _auth.GetSession(acc);
                var e = Skins.All().FirstOrDefault(x => x.Id == Str(a, "id")) ?? throw new InvalidOperationException("Skin nicht gefunden");
                var variant = StrN(a, "variant") ?? e.Variant;
                var prof = await Skins.Upload(ses.AccessToken, await File.ReadAllBytesAsync(Skins.FileOf(e.Id)), variant);
                acc.SkinUrl = (string?)prof["skins"]?.AsArray().FirstOrDefault(x => (string?)x!["state"] == "ACTIVE")?["url"] ?? acc.SkinUrl;
                _auth.Save();
                return prof;
            }
            case "skin.cape":
            {
                var acc = _auth.Active ?? throw new InvalidOperationException("Bitte zuerst anmelden.");
                var ses = await _auth.GetSession(acc);
                return await Skins.SetCape(ses.AccessToken, StrN(a, "id"));
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
                _auth.ClientId = ClientIdFor(S);
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
            case "auth.login":
            {
                // Microsoft sign-in window inside the app → auth code (PKCE) → Xbox → Minecraft
                _auth.ClientId = ClientIdFor(S);
                var req = _auth.StartLogin(true);   // shows the account picker when Microsoft remembers you
                var env = Web.CoreWebView2.Environment;
                var win = new LoginWindow(this, env, req.Url);
                var ok = win.ShowDialog() == true;
                if (win.UseBrowser) return new { fallback = "device" };
                if (!ok || win.Result == null) return null;
                var acc = await _auth.FinishLogin(req, win.Result);
                return new { account = new { acc.Uuid, acc.Name }, accounts = _auth.Accounts.Select(x => new { x.Uuid, x.Name, skin = x.SkinUrl?.Replace("http://", "https://") }), active = _auth.Active?.Uuid };
            }
            case "auth.appid":
            {
                // one-time developer setup when the exe was built without -p:OrbitClientId
                var id = Str(a, "id").Trim();
                if (!Guid.TryParse(id, out _)) throw new InvalidOperationException("Das ist keine gültige App-ID (Format 00000000-0000-0000-0000-000000000000).");
                S.ClientId = id; S.Save(); _auth.ClientId = id;
                return new { ok = true };
            }
            case "auth.cancel": _dcCts?.Cancel(); _dc = null; return new { };
            case "auth.select": _auth.ActiveUuid = Str(a, "uuid"); _auth.Save(); return AccountsDto();
            case "auth.remove": _auth.Remove(Str(a, "uuid")); return AccountsDto();
        }
        throw new InvalidOperationException("Unbekannter Befehl: " + cmd);
    }

    /// <summary>Live sync: when the game (mod) writes orbitclient.json, the launcher UI and the overlay update immediately.</summary>
    private void WatchConfig()
    {
        try
        {
            _cfgWatch = new FileSystemWatcher(Paths.Root, "orbitclient.json") { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
            FileSystemEventHandler h = (_, _) => ConfigChanged();
            _cfgWatch.Changed += h; _cfgWatch.Created += h;
            _cfgWatch.Renamed += (_, _) => ConfigChanged();
            _cfgWatch.EnableRaisingEvents = true;
        }
        catch { }
    }

    private void ConfigChanged()
    {
        _cfgDue = DateTime.UtcNow.AddMilliseconds(120);
        Task.Delay(150).ContinueWith(_ =>
        {
            if (DateTime.UtcNow < _cfgDue) return;
            var cfg = OrbitClient.ReadConfig();
            if (cfg == null) return;
            var json = cfg.ToJsonString();
            if (json == _cfgLast) return;      // our own write
            _cfgLast = json;
            Dispatcher.InvokeAsync(() => _overlay.SetConfig(cfg));
            Emit("orbitcfg", JsonNode.Parse(json)!);
        });
    }

    private string ShotPath(JsonObject a)
    {
        var inst = Inst(a);
        var dir = Path.GetFullPath(Path.Combine(inst.Dir, "screenshots"));
        var f = Path.GetFullPath(Path.Combine(dir, Path.GetFileName(Str(a, "file"))));
        if (!f.StartsWith(dir) || !File.Exists(f)) throw new InvalidOperationException("Screenshot nicht gefunden");
        return f;
    }

    /// <summary>Built-in app id from the build; settings.json may override it for development.</summary>
    private static string ClientIdFor(Settings s) => string.IsNullOrWhiteSpace(s.ClientId) ? Auth.BuiltInClientId : s.ClientId;

    /// <summary>Launcher accent theme → hex, so the in-game menu uses the same color.</summary>
    private static string AccentHex(string theme) => theme switch
    {
        "gold" => "#F5B53D", "lime" => "#9BDB24", "forest" => "#22C55E", "mint" => "#2DD4A0", "teal" => "#14B8A6", "aqua" => "#22D3EE",
        "sky" => "#38BDF8", "ocean" => "#3D7BFF", "indigo" => "#6366F1", "violet" => "#8B7BFF", "grape" => "#A855F7", "magenta" => "#E040FB",
        "rose" => "#FF5C8A", "crimson" => "#FF3B4E", "ice" => "#93C5FD", "sand" => "#D6BC8C", "slate" => "#94A3B8", "mono" => "#E8E8EC",
        "cherry" => "#E11D74", _ => "#FF7A3D",
    };

    // ---- Orbit cloud sync: debounced after changes, plus on start and on demand
    private void ScheduleSync()
    {
        if (!Cloud.LoggedIn || _syncing > 0) return;
        _syncDue?.Cancel();
        var cts = _syncDue = new CancellationTokenSource();
        _ = Task.Delay(6000, cts.Token).ContinueWith(t => { if (!t.IsCanceled) _ = RunSync(false); });
    }

    private async Task<object> RunSync(bool manual)
    {
        if (Interlocked.Increment(ref _syncing) > 1) { Interlocked.Decrement(ref _syncing); return new { busy = true }; }
        Emit("cloud", new { state = "sync" });
        try
        {
            var r = await WithTask(p => Cloud.Sync(SyncDoc, ApplySync, p));
            if (r.Created + r.Pulled + r.Deleted > 0) Emit("instances", Instances.All().Select(Dto).ToList());
            Emit("cloud", new { state = "done", r.Pushed, r.Pulled, r.Created, r.Deleted, restore = r.ToInstall.Count, at = DateTime.UtcNow });
            if (r.ToInstall.Count > 0)
            {
                var (ok, failed) = await WithTask(p => Cloud.Restore(r.ToInstall, p));
                Emit("instances", Instances.All().Select(Dto).ToList());
                Emit("cloud", new { state = "restored", ok, failed });
            }
            return new { r.Pushed, r.Pulled, r.Created, r.Deleted, restore = r.ToInstall.Count };
        }
        catch (Exception e)
        {
            Emit("cloud", new { state = "error", error = e.Message });
            if (manual) throw;
            return new { error = e.Message };
        }
        finally { Interlocked.Decrement(ref _syncing); }
    }

    private JsonObject SyncDoc(string key)
    {
        long Mtime(string f) => File.Exists(f) ? new DateTimeOffset(File.GetLastWriteTimeUtc(f)).ToUnixTimeMilliseconds() : 0;
        switch (key)
        {
            case "settings":
            {
                var o = new JsonObject();
                foreach (var n in SyncedSettings) { var pr = typeof(Settings).GetProperty(n)!; o[n] = JsonSerializer.SerializeToNode(pr.GetValue(S)); }
                o["_at"] = S.SyncAt; return o;
            }
            case "orbitcfg": { var c = OrbitClient.ReadConfig() ?? new JsonObject(); var o = (JsonObject)c.DeepClone(); o["_at"] = c.Count == 0 ? 0 : Mtime(OrbitClient.ConfigPath); return o; }
            default:
            {
                var list = new JsonArray(Skins.All().Take(40).Where(x => File.Exists(Skins.FileOf(x.Id))).Select(x => (JsonNode)new JsonObject { ["id"] = x.Id, ["name"] = x.Name, ["variant"] = x.Variant, ["png"] = Convert.ToBase64String(File.ReadAllBytes(Skins.FileOf(x.Id))) }).ToArray());
                return new JsonObject { ["list"] = list, ["_at"] = list.Count == 0 ? 0 : Mtime(Path.Combine(Paths.Root, "skins", "index.json")) };
            }
        }
    }

    private void ApplySync(JsonObject o)
    {
        var key = (string?)o["_key"]; o.Remove("_key"); var at = (long?)o["_at"] ?? 0; o.Remove("_at");
        Dispatcher.Invoke(() =>
        {
            if (key == "settings")
            {
                foreach (var n in SyncedSettings)
                {
                    if (o[n] is not JsonNode v) continue;
                    var pr = typeof(Settings).GetProperty(n)!;
                    try { pr.SetValue(S, v.Deserialize(pr.PropertyType)); } catch { }
                }
                S.SyncAt = at; S.Save();
                Emit("settings", S);
            }
            else if (key == "orbitcfg") { _cfgLast = o.ToJsonString(); OrbitClient.WriteConfig(o); _overlay.SetConfig(o); Emit("orbitcfg", o); }
            else if (key == "skins")
            {
                var have = Skins.All().Select(x => x.Id).ToHashSet();
                foreach (var s in o["list"]?.AsArray() ?? new JsonArray())
                    if (!have.Contains((string)s!["id"]!)) try { Skins.Add(Convert.FromBase64String((string)s["png"]!), (string?)s["name"] ?? "Skin", (string?)s["variant"] ?? "classic", (string?)s["id"]); } catch { }
            }
        });
    }

    private void SaveBounds()
    {
        S.WinMax = WindowState == WindowState.Maximized;
        var b = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        if (b.Width > 0 && b.Height > 0) { S.WinX = (int)b.Left; S.WinY = (int)b.Top; S.WinW = (int)b.Width; S.WinH = (int)b.Height; }
    }

    private static long DirSize(string d)
    {
        try { return Directory.Exists(d) ? new DirectoryInfo(d).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => { try { return f.Length; } catch { return 0L; } }) : 0; }
        catch { return 0; }
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
}
