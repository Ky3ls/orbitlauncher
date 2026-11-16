using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using OrbitLauncher.Core;

namespace OrbitLauncher;

/// <summary>
/// Skin sites (e.g. minecraftskins.com, laby.net) in a normal browser window, exactly as the site is.
/// When the user presses the site's own download button, the PNG is checked and added to the skin library.
/// </summary>
public sealed class SkinBrowserWindow : Window
{
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    public static readonly (string Name, string Url)[] Sites = { ("Skindex", "https://www.minecraftskins.com/"), ("LabyMod", "https://laby.net/de/skins"), ("NameMC", "https://namemc.com/minecraft-skins") };
    private readonly WebView2 _web = new();
    private readonly TextBlock _host = new() { Foreground = new SolidColorBrush(Color.FromRgb(200, 200, 208)), FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _note = new() { Foreground = new SolidColorBrush(Color.FromRgb(160, 160, 170)), FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14, 0, 14, 0), Text = "Auf der Seite „Download“ drücken – der Skin landet automatisch in deiner Bibliothek." };
    private readonly CoreWebView2Environment _env;
    private readonly string _start;
    /// <summary>Called on the UI thread with each skin that was added.</summary>
    public event Action<Skins.Entry>? Added;

    public SkinBrowserWindow(Window owner, CoreWebView2Environment env, string url)
    {
        Owner = owner; _env = env; _start = url;
        Title = "Skins finden · OrbitLauncher";
        var wa = SystemParameters.WorkArea;
        Width = Math.Min(1280, wa.Width - 60); Height = Math.Min(860, wa.Height - 60);
        MinWidth = 640; MinHeight = 480;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Background = new SolidColorBrush(Color.FromRgb(17, 17, 20));
        _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 17, 17, 20);
        SourceInitialized += (_, _) =>
        {
            var h = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            int dark = 1; DwmSetWindowAttribute(h, 20, ref dark, sizeof(int));
            int cap = 0x00141111; DwmSetWindowAttribute(h, 35, ref cap, sizeof(int));
            int txt = 0x00F5F4F4; DwmSetWindowAttribute(h, 36, ref txt, sizeof(int));
        };
        Button Btn(string glyph, string tip, Action a)
        {
            var b = new Button { Content = new TextBlock { Text = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 13 }, ToolTip = tip, Width = 34, Height = 30, Margin = new Thickness(2, 0, 2, 0), Foreground = Brushes.White, Background = new SolidColorBrush(Color.FromRgb(30, 30, 36)), BorderThickness = new Thickness(0) };
            b.Click += (_, _) => a(); return b;
        }
        var bar = new DockPanel { Background = new SolidColorBrush(Color.FromRgb(22, 22, 26)), Height = 48, LastChildFill = true };
        var nav = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(10, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
        nav.Children.Add(Btn("", "Zurück", () => { if (_web.CoreWebView2?.CanGoBack == true) _web.CoreWebView2.GoBack(); }));
        nav.Children.Add(Btn("", "Vor", () => { if (_web.CoreWebView2?.CanGoForward == true) _web.CoreWebView2.GoForward(); }));
        nav.Children.Add(Btn("", "Neu laden", () => _web.CoreWebView2?.Reload()));
        foreach (var (n, u) in Sites)
        {
            var b = new Button { Content = n, Padding = new Thickness(12, 4, 12, 4), Margin = new Thickness(4, 0, 0, 0), Foreground = Brushes.White, Background = new SolidColorBrush(Color.FromRgb(36, 36, 44)), BorderThickness = new Thickness(0) };
            b.Click += (_, _) => _web.CoreWebView2?.Navigate(u);
            nav.Children.Add(b);
        }
        DockPanel.SetDock(nav, Dock.Left); bar.Children.Add(nav);
        var pill = new Border { CornerRadius = new CornerRadius(14), Background = new SolidColorBrush(Color.FromRgb(30, 30, 36)), Padding = new Thickness(12, 5, 14, 5), VerticalAlignment = VerticalAlignment.Center, Child = _host, Margin = new Thickness(8, 0, 0, 0) };
        DockPanel.SetDock(pill, Dock.Left); bar.Children.Add(pill);
        bar.Children.Add(_note);
        var root = new DockPanel();
        DockPanel.SetDock(bar, Dock.Top);
        root.Children.Add(bar); root.Children.Add(_web);
        Content = root;
        Loaded += async (_, _) =>
        {
            try
            {
                await _web.EnsureCoreWebView2Async(_env);
                var c = _web.CoreWebView2;
                c.Settings.AreDevToolsEnabled = false;
                c.SourceChanged += (_, _) => { try { _host.Text = new Uri(c.Source).Host; } catch { } };
                // pop-ups open in the same window
                c.NewWindowRequested += (_, e) => { e.Handled = true; if (e.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) c.Navigate(e.Uri); };
                c.DownloadStarting += OnDownload;
                c.Navigate(_start);
            }
            catch (Exception ex) { _note.Text = "Die Seite konnte nicht geladen werden: " + ex.Message; }
        };
    }

    public void Navigate(string url) => _web.CoreWebView2?.Navigate(url);

    private void OnDownload(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var tmp = Path.Combine(Paths.Cache, "skin-dl-" + Guid.NewGuid().ToString("N")[..8] + ".png");
        Directory.CreateDirectory(Paths.Cache);
        var suggested = Path.GetFileNameWithoutExtension(e.ResultFilePath);
        e.ResultFilePath = tmp;
        e.Handled = true;   // no download bar
        var op = e.DownloadOperation;
        op.StateChanged += (_, _) =>
        {
            if (op.State == CoreWebView2DownloadState.InProgress) return;
            Dispatcher.Invoke(() =>
            {
                try
                {
                    if (op.State != CoreWebView2DownloadState.Completed) throw new InvalidOperationException("Download abgebrochen.");
                    var png = File.ReadAllBytes(tmp);
                    Skins.Validate(png);
                    var name = string.IsNullOrWhiteSpace(suggested) ? "Skin" : suggested.Replace('_', ' ').Replace('-', ' ').Trim();
                    if (name.Length > 40) name = name[..40];
                    var entry = Skins.Add(png, name, IsSlim(png) ? "slim" : "classic");
                    _note.Text = $"„{entry.Name}“ ist jetzt in deiner Bibliothek.";
                    _note.Foreground = new SolidColorBrush(Color.FromRgb(74, 222, 154));
                    Added?.Invoke(entry);
                }
                catch (Exception ex)
                {
                    _note.Text = "Kein Skin: " + ex.Message;
                    _note.Foreground = new SolidColorBrush(Color.FromRgb(248, 113, 113));
                }
                finally { try { File.Delete(tmp); } catch { } }
            });
        };
    }

    /// <summary>Slim (3 px arms) skins leave column 54–55 of the right arm empty.</summary>
    private static bool IsSlim(byte[] png)
    {
        try
        {
            var dec = BitmapDecoder.Create(new MemoryStream(png), BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
            var bmp = new FormatConvertedBitmap(dec.Frames[0], PixelFormats.Bgra32, null, 0);
            if (bmp.PixelHeight < 64) return false;
            var px = new byte[4 * 2 * 12];
            bmp.CopyPixels(new Int32Rect(54, 20, 2, 12), px, 8, 0);
            for (int i = 3; i < px.Length; i += 4) if (px[i] != 0) return false;
            return true;
        }
        catch { return false; }
    }
}
