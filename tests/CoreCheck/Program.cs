using System.Diagnostics;
using OrbitLauncher.Core;

// Smoke test for the launcher core on any OS:
//   dotnet run -- <root> vanilla <version>       download + launch (fake session, offline test only, never shipped)
//   dotnet run -- <root> fabric <version>        Fabric profile + Modrinth install with dependencies
//   dotnet run -- <root> loader <loader> <mc>    Forge/NeoForge/Quilt installer
//   dotnet run -- <root> search <query>
//   dotnet run -- <root> orbit                   Orbit Client preset
var root = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "orbitlauncher-check");
Paths.Root = root;
var mode = args.ElementAtOrDefault(1) ?? "vanilla";
var prog = new Progress<Progress>(p => Console.WriteLine($"  [{p.Stage}] {p.Pct}% {p.Detail}"));
var sw = Stopwatch.StartNew();
var set = new Settings { RamMb = 2048 };

switch (mode)
{
    case "vanilla":
    {
        var all = await Versions.All();
        Console.WriteLine($"Manifest: {all.Count} Versionen, latest release {Versions.LatestRelease}, snapshot {Versions.LatestSnapshot}");
        foreach (var t in all.GroupBy(v => v.Type)) Console.WriteLine($"  {t.Key}: {t.Count()}");
        var ver = args.ElementAtOrDefault(2) ?? Versions.LatestRelease!;
        var inst = Instances.All().FirstOrDefault(i => i.McVersion == ver && i.Loader == "vanilla") ?? Instances.Create("Vanilla " + ver, ver);
        await Launch(inst);
        break;
    }
    case "fabric":
    {
        var ver = args.ElementAtOrDefault(2) ?? "1.21.11";
        var inst = Instances.All().FirstOrDefault(i => i.McVersion == ver && i.Loader == "fabric") ?? Instances.Create("Fabric " + ver, ver, "fabric");
        var lv = await Loaders.List("fabric", ver);
        Console.WriteLine($"Fabric-Loader für {ver}: {lv.Count}, neuester stabiler {lv.First(l => l.Stable).Version}");
        var r = await Modrinth.Install(inst, "zoomify", "mod", null, prog);
        Console.WriteLine("Installiert: " + string.Join(", ", r.Installed) + (r.Skipped.Count > 0 ? " | übersprungen: " + string.Join(", ", r.Skipped) : ""));
        r = await Modrinth.Install(inst, "sodium", "mod", null, prog);
        Console.WriteLine("Installiert: " + string.Join(", ", r.Installed));
        foreach (var f in Directory.GetFiles(Path.Combine(inst.Dir, "mods"))) Console.WriteLine("  mods/" + Path.GetFileName(f));
        var ups = await Modrinth.CheckUpdates(inst);
        Console.WriteLine($"Updates verfügbar: {ups.Count}");
        await Launch(inst);
        break;
    }
    case "loader":
    {
        var loader = args[2]; var mc = args[3];
        var list = await Loaders.List(loader, mc);
        Console.WriteLine($"{loader} für {mc}: {list.Count} Versionen, z.B. {string.Join(", ", list.Take(3).Select(l => l.Version + (l.Recommended ? "*" : "")))}");
        var inst = Instances.All().FirstOrDefault(i => i.McVersion == mc && i.Loader == loader) ?? Instances.Create($"{loader} {mc}", mc, loader);
        await Launch(inst);
        break;
    }
    case "search":
    {
        var res = await Modrinth.Search(args.ElementAtOrDefault(2), "mod", "1.21.11", "fabric", null, "relevance", 0, 5);
        Console.WriteLine($"Treffer: {res["total_hits"]}");
        foreach (var h in res["hits"]!.AsArray()) Console.WriteLine($"  {h!["title"]} – {h["downloads"]} Downloads – {h["author"]}");
        break;
    }
    case "orbit":
    {
        var best = await OrbitClient.BestVersion();
        Console.WriteLine("Orbit Client Zielversion: " + best);
        var (inst, ok, skipped) = await OrbitClient.Create(null, OrbitClient.Modules.Where(m => m.Default).Select(m => m.Id), 3072, prog);
        Console.WriteLine($"Installiert ({ok.Count}): {string.Join(", ", ok)}");
        Console.WriteLine($"Übersprungen ({skipped.Count}): {string.Join(", ", skipped)}");
        await Launch(inst);
        break;
    }
    case "mrpack":
    {
        var inst = await Modrinth.InstallModpack(args[2], null, prog);
        Console.WriteLine($"Modpack-Instanz {inst.Name}: {inst.McVersion} {inst.Loader} {inst.LoaderVersion}, {Directory.GetFiles(Path.Combine(inst.Dir, "mods")).Length} Mods");
        break;
    }
}
Console.WriteLine($"Fertig in {sw.Elapsed.TotalSeconds:0.0}s");

async Task Launch(Instance inst)
{
    // Offline smoke test only: proves files + command line. The real app always uses a Microsoft session.
    var s = new Session("OrbitTest", "00000000000000000000000000000000", "test-token", "0");
    var runner = new Runner();
    var lines = new List<string>();
    runner.Log += (_, l) => { lock (lines) lines.Add(l); Console.WriteLine("  | " + (l.Length > 220 ? l[..220] + "…" : l)); };
    var exited = new TaskCompletionSource<int?>();
    runner.State += (_, run, code) => { if (!run) exited.TrySetResult(code); };
    var proc = await runner.Launch(inst, s, set, prog);
    Console.WriteLine($"Java gestartet (PID {proc.Id}) nach {sw.Elapsed.TotalSeconds:0.0}s, warte auf Ausgabe…");
    var done = await Task.WhenAny(exited.Task, Task.Delay(TimeSpan.FromSeconds(60)));
    if (done != exited.Task) { Console.WriteLine("Läuft nach 60s noch – beende."); runner.Kill(inst.Id); }
    else Console.WriteLine("Beendet mit Code " + exited.Task.Result);
}
