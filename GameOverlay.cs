using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using OrbitLauncher.Core;

namespace OrbitLauncher;

/// <summary>
/// Orbit HUD for every Minecraft version without the Orbit mod: a click-through, transparent window on top of the game window.
/// Shown only while Minecraft is in the foreground and the cursor is hidden (= in game, not in a menu).
/// Uses the same orbitclient.json as the launcher and the mod, so toggles/positions apply live.
/// </summary>
public sealed class GameOverlay : Window
{
    private readonly Canvas _c = new() { IsHitTestVisible = false };
    private readonly DispatcherTimer _t = new() { Interval = TimeSpan.FromMilliseconds(33) };
    private Process? _proc;
    private JsonObject _cfg = new();
    private DateTime _start;
    private int _guiScaleOpt;
    private readonly Queue<long> _left = new(), _right = new();
    private IntPtr _hook;
    private LowLevelProc? _hookProc;
    private IntPtr _mcHwnd;

    private static readonly Dictionary<string, (bool def, double w, double h)> Box = new()
    {
        ["keystrokes"] = (true, 70, 108), ["cps"] = (true, 62, 16), ["clock"] = (false, 38, 16),
        ["session"] = (false, 104, 16), ["memory"] = (false, 100, 16), ["crosshair"] = (false, 0, 0),
    };

    public GameOverlay()
    {
        WindowStyle = WindowStyle.None; AllowsTransparency = true; Background = Brushes.Transparent;
        Topmost = true; ShowInTaskbar = false; ShowActivated = false; ResizeMode = ResizeMode.NoResize;
        Focusable = false; IsHitTestVisible = false; Content = _c; Title = "Orbit Overlay";
        _t.Tick += (_, _) => Tick();
        SourceInitialized += (_, _) =>
        {
            var h = new WindowInteropHelper(this).Handle;
            var ex = GetWindowLong(h, -20);
            SetWindowLong(h, -20, ex | 0x20 | 0x80000 | 0x80 | 0x8000000);   // TRANSPARENT | LAYERED | TOOLWINDOW | NOACTIVATE
        };
    }

    public bool Attached => _proc != null;

    public void Attach(Process p, string gameDir, JsonObject? cfg)
    {
        _proc = p; _start = DateTime.Now; _mcHwnd = IntPtr.Zero;
        _cfg = cfg ?? new JsonObject();
        _guiScaleOpt = 0;
        try
        {
            var opt = Path.Combine(gameDir, "options.txt");
            if (File.Exists(opt))
                foreach (var l in File.ReadLines(opt))
                    if (l.StartsWith("guiScale:") && int.TryParse(l[9..], out var g)) _guiScaleOpt = g;
        }
        catch { }
        if (_hook == IntPtr.Zero)
        {
            _hookProc = MouseHook;
            _hook = SetWindowsHookEx(14, _hookProc, GetModuleHandle(null), 0);   // WH_MOUSE_LL – counts every click for CPS
        }
        Show(); Visibility = Visibility.Hidden;
        _t.Start();
    }

    public void SetConfig(JsonObject? cfg) { if (cfg != null) _cfg = cfg; }

    public void Detach()
    {
        _t.Stop(); _proc = null;
        if (_hook != IntPtr.Zero) { UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; }
        Visibility = Visibility.Hidden;
    }

    private IntPtr MouseHook(int code, IntPtr wp, IntPtr lp)
    {
        if (code >= 0 && _mcHwnd != IntPtr.Zero && GetForegroundWindow() == _mcHwnd)
        {
            var now = Environment.TickCount64;
            if (wp == 0x201) lock (_left) _left.Enqueue(now);
            else if (wp == 0x204) lock (_right) _right.Enqueue(now);
        }
        return CallNextHookEx(_hook, code, wp, lp);
    }

    private int Cps(Queue<long> q)
    {
        var now = Environment.TickCount64;
        lock (q) { while (q.Count > 0 && now - q.Peek() > 1000) q.Dequeue(); return q.Count; }
    }

    // ------------------------------------------------------------------ config helpers (same keys as the mod)
    private JsonObject? Mod(string id) => _cfg["modules"]?[id] as JsonObject;
    private bool On(string id) => Mod(id)?["enabled"] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : Box[id].def;
    private string Opt(string id, string key, string def) => Mod(id)?["opts"]?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : def;
    private double Num(string id, string key, double def) => double.TryParse(Opt(id, key, ""), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : def;
    private bool Flag(string id, string key, bool def) => Opt(id, key, def ? "true" : "false") == "true";

    private Color Accent()
    {
        try { return (Color)ColorConverter.ConvertFromString((string?)_cfg["accent"] ?? "#FF7A3D"); } catch { return Color.FromRgb(255, 122, 61); }
    }

    private Color Named(string name, int offset)
    {
        switch (name)
        {
            case "Akzent": return Accent();
            case "Chroma":
                var h = ((Environment.TickCount64 + offset * 40) % 4000) / 4000.0;
                return Hsv(h, 0.6, 1);
            case "Grün": return Color.FromRgb(0x4A, 0xDE, 0x9A);
            case "Rot": return Color.FromRgb(0xF8, 0x71, 0x71);
            case "Blau": return Color.FromRgb(0x60, 0xA5, 0xFA);
            case "Cyan": return Color.FromRgb(0x67, 0xE8, 0xF9);
            case "Gelb": return Color.FromRgb(0xFD, 0xE0, 0x47);
            case "Pink": return Color.FromRgb(0xF4, 0x72, 0xB6);
            default: return Colors.White;
        }
    }

    private static Color Hsv(double h, double s, double v)
    {
        int i = (int)(h * 6) % 6; double f = h * 6 - Math.Floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        var (r, g, b) = i switch { 0 => (v, t, p), 1 => (q, v, p), 2 => (p, v, t), 3 => (p, q, v), 4 => (t, p, v), _ => (v, p, q) };
        return Color.FromRgb((byte)(r * 255), (byte)(g * 255), (byte)(b * 255));
    }

    // ------------------------------------------------------------------ frame
    private void Tick()
    {
        if (_proc == null) return;
        try { if (_proc.HasExited) { Detach(); return; } _proc.Refresh(); _mcHwnd = _proc.MainWindowHandle; } catch { Detach(); return; }
        var ci = new CURSORINFO { cbSize = Marshal.SizeOf<CURSORINFO>() };
        bool inGame = _mcHwnd != IntPtr.Zero && GetForegroundWindow() == _mcHwnd && GetCursorInfo(ref ci) && (ci.flags & 1) == 0;
        if (!inGame) { Visibility = Visibility.Hidden; return; }

        GetClientRect(_mcHwnd, out var rc);
        var pt = new POINT(); ClientToScreen(_mcHwnd, ref pt);
        var dpi = VisualTreeHelper.GetDpi(this).DpiScaleX;
        Left = pt.X / dpi; Top = pt.Y / dpi; Width = Math.Max(1, rc.Right / dpi); Height = Math.Max(1, rc.Bottom / dpi);
        Visibility = Visibility.Visible;

        // Minecraft GUI scale: largest scale with at least 320x240 GUI pixels (capped by the option)
        int pw = rc.Right, ph = rc.Bottom, gs = 1;
        while (gs < 8 && pw / (gs + 1) >= 320 && ph / (gs + 1) >= 240 && (_guiScaleOpt == 0 || gs < _guiScaleOpt)) gs++;
        double unit = gs / dpi, gw = pw / (double)gs, gh = ph / (double)gs;
        Render(unit, gw, gh);
    }

    private void Render(double u, double gw, double gh)
    {
        _c.Children.Clear();
        var accent = Accent();
        // auto layout like the mod: top-left stack, top-right stack, bottom-left upwards
        double tl = 3, tr = 3, bl = gh - 3;
        foreach (var id in new[] { "cps", "clock", "session", "memory", "keystrokes" })
        {
            if (!On(id)) continue;
            double sc = Math.Max(0.5, Num(id, "scale", 1));
            var (_, bw, bh) = Box[id];
            if (id == "keystrokes" && !Flag(id, "mouse", true)) bh -= 24;
            if (id == "keystrokes" && !Flag(id, "space", true)) bh -= 14;
            double w = bw * sc, h = bh * sc, x, y;
            var m = Mod(id);
            if (m?["x"] != null && m["y"] != null) { x = Math.Min(gw - w, (double)m["x"]! * gw); y = Math.Min(gh - h, (double)m["y"]! * gh); }
            else if (id == "keystrokes") { y = bl - h; bl = y - 2; x = 3; }
            else if (id == "cps") { x = 3; y = tl; tl += h + 2; }
            else { x = gw - 3 - w; y = tr; tr += h + 2; }
            var g = new Canvas { Width = bw, Height = bh, RenderTransform = new ScaleTransform(sc * u, sc * u) };
            Canvas.SetLeft(g, x * u); Canvas.SetTop(g, y * u);
            if (id == "keystrokes") Keys(g, accent);
            else
            {
                string text = id switch
                {
                    "cps" => $"{Cps(_left)} | {Cps(_right)} CPS",
                    "clock" => DateTime.Now.ToString(Flag("clock", "seconds", false) ? "HH:mm:ss" : "HH:mm"),
                    "session" => "Sitzung " + (DateTime.Now - _start).ToString(@"h\:mm\:ss"),
                    "memory" => $"RAM {(_proc?.WorkingSet64 ?? 0) / 1073741824.0:0.0} GB",
                    _ => id,
                };
                Label(g, text, 0, 0, bw, bh, Named(Opt(id, "color", "Weiß"), 0), Flag(id, "bg", true), accent, true);
            }
            _c.Children.Add(g);
        }
        if (On("crosshair")) Crosshair(gw, gh, u);
    }

    private static readonly SolidColorBrush Bg = new(Color.FromArgb(0x8C, 10, 10, 11));

    private void Label(Canvas g, string text, double x, double y, double w, double h, Color fg, bool bg, Color accent, bool bar)
    {
        var tb = new TextBlock
        {
            Text = text, Foreground = new SolidColorBrush(fg), FontFamily = new FontFamily("Consolas"), FontSize = 8.5, FontWeight = FontWeights.SemiBold,
            Padding = new Thickness(bar ? 5 : 2, 0, 2, 0), VerticalAlignment = VerticalAlignment.Center,
        };
        var b = new Border { Width = w, Height = h, Child = tb, Background = bg ? Bg : Brushes.Transparent, BorderBrush = new SolidColorBrush(accent), BorderThickness = new Thickness(bar && bg ? 1 : 0, 0, 0, 0) };
        Canvas.SetLeft(b, x); Canvas.SetTop(b, y);
        g.Children.Add(b);
    }

    private static bool Down(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    private void Keys(Canvas g, Color accent)
    {
        const double s = 22, gap = 2;
        var fg = Named(Opt("keystrokes", "color", "Weiß"), 0);
        void Key(string l, double x, double y, double w, double h, bool down)
        {
            var tb = new TextBlock { Text = l, Foreground = new SolidColorBrush(down ? Color.FromRgb(0x1A, 0x0D, 0x05) : fg), FontFamily = new FontFamily("Consolas"), FontSize = 8.5, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var b = new Border { Width = w, Height = h, Child = tb, Background = down ? new SolidColorBrush(Color.FromArgb(0xD0, accent.R, accent.G, accent.B)) : Bg };
            Canvas.SetLeft(b, x); Canvas.SetTop(b, y); g.Children.Add(b);
        }
        Key("W", s + gap, 0, s, s, Down(0x57));
        Key("A", 0, s + gap, s, s, Down(0x41));
        Key("S", s + gap, s + gap, s, s, Down(0x53));
        Key("D", 2 * (s + gap), s + gap, s, s, Down(0x44));
        double y = 2 * (s + gap), full = 3 * s + 2 * gap;
        if (Flag("keystrokes", "mouse", true))
        {
            double w = (full - gap) / 2; bool c = Flag("keystrokes", "cpsInKeys", true);
            Key(c ? "LMB " + Cps(_left) : "LMB", 0, y, w, s, Down(0x01));
            Key(c ? "RMB " + Cps(_right) : "RMB", w + gap, y, full - w - gap, s, Down(0x02));
            y += s + gap;
        }
        if (Flag("keystrokes", "space", true)) Key("▬▬▬", 0, y, full, 12, Down(0x20));
    }

    private void Crosshair(double gw, double gh, double u)
    {
        var col = new SolidColorBrush(Named(Opt("crosshair", "ccolor", "Weiß"), 0));
        var ol = Flag("crosshair", "outline", true);
        int size = (int)Num("crosshair", "size", 5), gap = (int)Num("crosshair", "gap", 2), t = Math.Max(1, (int)Num("crosshair", "thick", 1));
        string style = Opt("crosshair", "style", "Plus");
        double cx = Math.Floor(gw / 2), cy = Math.Floor(gh / 2);
        int h0 = t / 2, h1 = t - h0;
        var root = new Canvas();
        void R(double x0, double y0, double x1, double y1, bool outline)
        {
            if (outline) Add(x0 - 1, y0 - 1, x1 + 1, y1 + 1, new SolidColorBrush(Color.FromArgb(0xC0, 0, 0, 0)));
            Add(x0, y0, x1, y1, col);
        }
        void Add(double x0, double y0, double x1, double y1, Brush b)
        {
            var r = new Border { Width = (x1 - x0) * u, Height = (y1 - y0) * u, Background = b };
            Canvas.SetLeft(r, (cx + x0) * u); Canvas.SetTop(r, (cy + y0) * u); root.Children.Add(r);
        }
        void Plus(bool top)
        {
            R(-gap - size, -h0, -gap, h1, ol); R(gap + 1, -h0, gap + 1 + size, h1, ol);
            if (top) R(-h0, -gap - size, h1, -gap, ol);
            R(-h0, gap + 1, h1, gap + 1 + size, ol);
        }
        switch (style)
        {
            case "Punkt": R(-h0 - 1, -h0 - 1, h1 + 1, h1 + 1, ol); break;
            case "Kreis":
                int rr = gap + size / 2 + 2;
                for (int a = 0; a < 360; a += 6)
                {
                    double rad = a * Math.PI / 180; double x = Math.Round(Math.Cos(rad) * rr), y = Math.Round(Math.Sin(rad) * rr);
                    R(x - h0, y - h0, x + h1, y + h1, false);
                }
                R(-1, -1, 1, 1, ol); break;
            case "X": Plus(true); root.RenderTransform = new RotateTransform(45, cx * u, cy * u); break;
            case "T": Plus(false); break;
            default: Plus(true); if (style == "Plus+Punkt") R(-h0, -h0, h1, h1, ol); break;
        }
        _c.Children.Add(root);
    }

    // ------------------------------------------------------------------ Win32
    private delegate IntPtr LowLevelProc(int code, IntPtr wp, IntPtr lp);
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int id, LowLevelProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr wp, IntPtr lp);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CURSORINFO ci);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr h, int i, int v);
}
