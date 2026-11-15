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
    private readonly WebView2 _web = new() { Visibility = Visibility.Hidden };
    private readonly TextBlock _status = new() { Text = "Microsoft-Anmeldung wird geladen…", Foreground = new SolidColorBrush(Color.FromRgb(90, 90, 100)), FontSize = 14, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Margin = new Thickness(30, 0, 30, 14) };
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
        Title = "Mit Microsoft anmelden";
        Width = 520; Height = 680;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Background = Brushes.White;
        var info = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        info.Children.Add(_status); info.Children.Add(_browser);
        var grid = new Grid();
        grid.Children.Add(info); grid.Children.Add(_web);
        Content = grid;
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
