using System.Windows;

namespace OrbitLauncher;

public partial class App : Application
{
    /// <summary>Set while the app shuts down (e.g. for an update).</summary>
    public static bool Quitting { get; set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += (_, ex) =>
        {
            ex.Handled = true;
            if (Quitting) return;   // the WebView is going away, nothing to show
            var msg = string.IsNullOrWhiteSpace(ex.Exception.Message) ? ex.Exception.GetType().Name : ex.Exception.Message;
            MessageBox.Show(msg, "OrbitLauncher", MessageBoxButton.OK, MessageBoxImage.Warning);
        };
        base.OnStartup(e);
    }
}
