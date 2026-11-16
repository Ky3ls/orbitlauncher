using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using OrbitLauncher.Core;

namespace OrbitLauncher;

/// <summary>Official Microsoft sign-in page inside the app. Returns the redirect URL with the auth code,
/// or asks for the browser sign-in (code) when the page can't be shown.</summary>
public sealed class LoginWindow : Window
{
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    private readonly WebView2 _web = new() { Visibility = Visibility.Hidden };
    private readonly TextBlock _host = new() { Foreground = new SolidColorBrush(Color.FromRgb(200, 200, 208)), FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _status = new() { Text = "Microsoft-Anmeldung wird geladen…", Foreground = new SolidColorBrush(Color.FromRgb(160, 160, 170)), FontSize = 14, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Margin = new Thickness(30, 0, 30, 14) };
    private readonly Button _browser = new() { Content = "Stattdessen im Browser anmelden", Padding = new Thickness(16, 8, 16, 8), Visibility = Visibility.Collapsed, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly string _url;
    private readonly CoreWebView2Environment _env;
    public string? Result { get; private set; }
    /// <summary>True when the user chose the browser sign-in (device code) instead.</summary>
    public bool UseBrowser { get; private set; }

    public static void Log(string s) { try { File.AppendAllText(Path.Combine(Paths.Root, "login.log"), $"{DateTime.Now:HH:mm:ss} {s}{Environment.NewLine}"); } catch { } }

    public LoginWindow(Window owner, CoreWebView2Environment env, string url)
    {
        Owner = owner; _env = env; _url = url;
        Title = "Bei Microsoft anmelden · OrbitLauncher";
        var wa = SystemParameters.WorkArea;
        Width = Math.Min(980, wa.Width - 60); Height = Math.Min(740, wa.Height - 60);
        MinWidth = 480; MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ShowInTaskbar = false;
        Background = new SolidColorBrush(Color.FromRgb(17, 17, 20));
        _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 17, 17, 20);
        // dark title bar like the launcher (Windows 10 20H1+ / 11)
        SourceInitialized += (_, _) =>
        {
            var h = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            int dark = 1; DwmSetWindowAttribute(h, 20, ref dark, sizeof(int));
            int cap = 0x00141111; DwmSetWindowAttribute(h, 35, ref cap, sizeof(int));     // caption color (COLORREF, BGR)
            int txt = 0x00F5F4F4; DwmSetWindowAttribute(h, 36, ref txt, sizeof(int));
            int round = 2; DwmSetWindowAttribute(h, 33, ref round, sizeof(int));
        };
        // header: where you are signing in (trust), like an address bar
        _host.Text = "login.microsoftonline.com";
        var lockIcon = new TextBlock { Text = "\uE72E", FontFamily = new FontFamily("Segoe MDL2 Assets"), Foreground = new SolidColorBrush(Color.FromRgb(74, 222, 154)), FontSize = 13, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 1, 8, 0) };
        var bar = new DockPanel { Background = new SolidColorBrush(Color.FromRgb(22, 22, 26)), Height = 44, LastChildFill = true };
        var left = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(18, 0, 0, 0) };
        left.Children.Add(new TextBlock { Text = "Orbit", Foreground = Brushes.White, FontWeight = FontWeights.SemiBold, FontSize = 14 });
        left.Children.Add(new TextBlock { Text = "Launcher", Foreground = new SolidColorBrush(Color.FromRgb(255, 140, 80)), FontWeight = FontWeights.SemiBold, FontSize = 14 });
        DockPanel.SetDock(left, Dock.Left);
        var pill = new Border { CornerRadius = new CornerRadius(14), Background = new SolidColorBrush(Color.FromRgb(30, 30, 36)), BorderBrush = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)), BorderThickness = new Thickness(1), Padding = new Thickness(12, 5, 14, 5), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var pillRow = new StackPanel { Orientation = Orientation.Horizontal };
        pillRow.Children.Add(lockIcon); pillRow.Children.Add(_host);
        pill.Child = pillRow;
        bar.Children.Add(left); bar.Children.Add(pill);
        var info = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        info.Children.Add(_status); info.Children.Add(_browser);
        var body = new Grid();
        body.Children.Add(info); body.Children.Add(_web);
        var root = new DockPanel();
        DockPanel.SetDock(bar, Dock.Top);
        root.Children.Add(bar); root.Children.Add(body);
        Content = root;
        _browser.Click += (_, _) => { UseBrowser = true; DialogResult = false; };
        // if nothing shows up after a while, offer the browser
        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(12) };
        timer.Tick += (_, _) => { timer.Stop(); if (_web.Visibility != Visibility.Visible) Fail("Die Anmeldeseite lädt nicht."); };
        timer.Start();
        Loaded += async (_, _) =>
        {
            try
            {
                await _web.EnsureCoreWebView2Async(_env);
                var c = _web.CoreWebView2;
                c.Settings.AreDevToolsEnabled = false;
                c.Settings.AreDefaultContextMenusEnabled = false;
                // let Edge fill in saved e-mail addresses and passwords, and offer to save them
                c.Settings.IsGeneralAutofillEnabled = true;
                c.Settings.IsPasswordAutosaveEnabled = true;
                c.SourceChanged += (_, _) => { try { _host.Text = new Uri(c.Source).Host; } catch { } };
                c.NavigationStarting += (_, e) =>
                {
                    if (!e.Uri.StartsWith(Auth.RedirectUri, StringComparison.OrdinalIgnoreCase)) return;
                    e.Cancel = true;
                    Log("redirect " + System.Text.RegularExpressions.Regex.Replace(e.Uri, "([?&]code=)[^&]+", "$1***"));
                    Result = e.Uri;
                    DialogResult = true;
                };
                c.NavigationCompleted += (_, e) =>
                {
                    Log($"page {(e.IsSuccess ? "ok" : "error " + e.WebErrorStatus)} {c.Source.Split('?')[0]}");
                    if (e.IsSuccess) { _web.Visibility = Visibility.Visible; _status.Text = ""; }
                    else if (_web.Visibility != Visibility.Visible) Fail("Die Anmeldeseite konnte nicht geladen werden (" + e.WebErrorStatus + ").");
                };
                c.ProcessFailed += (_, e) => { Log("process failed " + e.ProcessFailedKind); Fail("Das Anmeldefenster ist abgestürzt."); };
                c.NewWindowRequested += (_, e) => { e.Handled = true; c.Navigate(e.Uri); };
                c.Navigate(_url);
            }
            catch (Exception ex) { Log("init " + ex.GetType().Name + ": " + ex.Message); Fail("Das Anmeldefenster konnte nicht gestartet werden."); }
        };
    }

    private void Fail(string why)
    {
        _web.Visibility = Visibility.Collapsed;
        _status.Text = why + "\nMelde dich einfach im Browser an, mit einem kurzen Code.";
        _browser.Visibility = Visibility.Visible;
    }
}
