using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using OrbitLauncher.Core;

namespace OrbitLauncher;

/// <summary>Official Microsoft sign-in page inside the app (like the big clients do). Returns the redirect URL with the auth code.</summary>
public sealed class LoginWindow : Window
{
    private readonly WebView2 _web = new();
    private readonly string _url;
    private readonly CoreWebView2Environment _env;
    public string? Result { get; private set; }

    public LoginWindow(Window owner, CoreWebView2Environment env, string url)
    {
        Owner = owner; _env = env; _url = url;
        Title = "Mit Microsoft anmelden";
        Width = 520; Height = 680;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Background = new SolidColorBrush(Color.FromRgb(255, 255, 255));
        Content = _web;
        Loaded += async (_, _) =>
        {
            await _web.EnsureCoreWebView2Async(_env);
            var c = _web.CoreWebView2;
            c.Settings.AreDevToolsEnabled = false;
            c.Settings.AreDefaultContextMenusEnabled = false;
            c.NavigationStarting += (_, e) =>
            {
                if (!e.Uri.StartsWith(Auth.RedirectUri, StringComparison.OrdinalIgnoreCase)) return;
                e.Cancel = true;
                Result = e.Uri;
                DialogResult = true;
            };
            c.NewWindowRequested += (_, e) => { e.Handled = true; c.Navigate(e.Uri); };
            c.Navigate(_url);
        };
    }
}
