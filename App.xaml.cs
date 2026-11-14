using System.Windows;

namespace OrbitLauncher;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += (_, ex) =>
        {
            MessageBox.Show(ex.Exception.Message, "OrbitLauncher", MessageBoxButton.OK, MessageBoxImage.Warning);
            ex.Handled = true;
        };
        base.OnStartup(e);
    }
}
