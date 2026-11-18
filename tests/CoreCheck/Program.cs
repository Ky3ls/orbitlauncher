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
var waitSec = 60;

switch (mode)
{
    case "serverpack":
    {
        var inst = Instances.All().First();
        var target = Path.Combine(root, "server.zip");
        ServerPack.Build(inst, target, null, default);
        using var z = System.IO.Compression.ZipFile.OpenRead(target);
        Console.WriteLine(string.Join("\n", z.Entries.Select(e => e.FullName).Where(n => !n.StartsWith("config/"))));
        break;
    }
    case "env":
    {
        foreach (var f in Directory.GetFiles(args[2], "*.jar")) Console.WriteLine($"{ModEnv.Of(f),-7} {Path.GetFileName(f)}");
        break;
    }
    case "worlds":
    {
        var inst = Instances.Get("w1")!;
        for (var k = 0; k < 2; k++) { var t = Stopwatch.StartNew(); var l = Worlds.List(inst); Console.WriteLine($"{l.Count} worlds in {t.ElapsedMilliseconds} ms: {l[0].Name} {l[0].Mode} / {l[^1].Name} {l[^1].Mode}"); }
        break;
    }
    case "import":
    {
        foreach (var f in Transfer.Scan())
            Console.WriteLine($"{f.Launcher} | {f.Name} | {f.Mc} {f.Loader} {f.LoaderVersion} | proj={f.Project} | {System.Text.Json.JsonSerializer.Serialize(f.X)} | mods={Importers.Count(f.Path, "mods", ".jar")}");
        var first = Transfer.Scan().First(f => f.Launcher == "Modrinth App");
        var inst = await Transfer.Import(first, null);
        Console.WriteLine("imported: " + System.Text.Json.JsonSerializer.Serialize(new { inst.Name, inst.Group, inst.PlaySeconds, inst.LastPlayed, inst.Created, inst.RamMb, inst.JvmArgs, inst.EnvVars, inst.Fullscreen, inst.Width, inst.PreLaunch, inst.ImportedFrom, icon = inst.IconUrl?[..30], files = Directory.GetFiles(inst.Dir, "*", SearchOption.AllDirectories).Length }));
        Console.WriteLine("ram: " + Ram.Check(inst, set));
        break;
    }
    case "mcopt":
    {
        Paths.Root = root; Directory.CreateDirectory(root);
        Instances.NewOptSync = () => true;
        var a = Instances.Create("Neu 1.21", "1.21.1", "fabric");
        var old = Instances.Create("PvP", "1.8.9");
        var pack = Instances.Create("Pack", "1.20.1", "forge");
        File.WriteAllText(Path.Combine(pack.Dir, "options.txt"), "version:3465\nrenderDistance:6\nkey_key.jei.showRecipe:key.keyboard.r\nkey_key.jump:key.keyboard.space\nresourcePacks:[\"vanilla\",\"file/x.zip\"]\n");
        var t = "renderDistance:16\nfov:0.25\nkey_key.jump:key.keyboard.v\nresourcePacks:[\"bad\"]\n";
        Console.WriteLine($"optSync neu={a.OptSync} modern: neu={McOptions.Modern(a)} 1.8.9={McOptions.Modern(old)} 26.3={McOptions.Modern(new Instance { McVersion = "26.3" })} 24w14a={McOptions.Modern(new Instance { McVersion = "24w14a" })} b1.7.3={McOptions.Modern(new Instance { McVersion = "b1.7.3" })}");
        McOptions.ApplyTo(a, t, "all"); Console.WriteLine("neu: " + File.ReadAllText(Path.Combine(a.Dir, "options.txt")).Replace("\n", " | "));
        Console.WriteLine("1.8.9 angefasst: " + McOptions.ApplyTo(old, t, "all"));
        McOptions.ApplyTo(pack, t, "keys"); Console.WriteLine("pack nur Tasten: " + File.ReadAllText(Path.Combine(pack.Dir, "options.txt")).Replace("\n", " | "));
        // player changes things in the game
        File.WriteAllText(Path.Combine(a.Dir, "options.txt"), File.ReadAllText(Path.Combine(a.Dir, "options.txt")).Replace("renderDistance:16", "renderDistance:20") + "key_key.sprint:key.keyboard.r\nversion:3953\n");
        Console.WriteLine("gelernt: " + (McOptions.Learn(a, t, "all") ?? "nichts").Replace("\n", " | "));
        Console.WriteLine("nichts geändert: " + (McOptions.Learn(a, McOptions.Learn(a, t, "all"), "all") ?? "null"));
        Console.WriteLine("aus pack: " + McOptions.From(pack)!.Replace("\n", " | "));
        break;
    }
    case "skinold":
    {
        Paths.Root = root; Directory.CreateDirectory(root);
        Skins.Seen("abcd1234", "http://textures.minecraft.net/texture/eeee", "classic");
        Console.WriteLine("importiert: " + Skins.ImportOld("abcd1234"));
        foreach (var o in Skins.HistoryOf("abcd1234")) { var t = System.Text.Json.JsonSerializer.Serialize(o); Console.WriteLine(System.Text.RegularExpressions.Regex.Replace(t, "data:image/png;base64,[^\"]+", "data:…")); }
        break;
    }
    case "skinhist":
    {
        Paths.Root = root; Directory.CreateDirectory(root);
        const string T = "http://textures.minecraft.net/texture/";
        Skins.Seen("u1", T + "aaa", "CLASSIC");
        Skins.Seen("u1", T + "aaa", "CLASSIC");          // same skin again: no new entry
        Skins.Seen("u2", T + "zzz", "CLASSIC");          // other account
        await Task.Delay(20); Skins.Seen(System.Text.Json.Nodes.JsonNode.Parse($"{{\"id\":\"u1\",\"skins\":[{{\"state\":\"ACTIVE\",\"url\":\"{T}bbb\",\"variant\":\"SLIM\"}}]}}"));
        await Task.Delay(20); Skins.Seen("u1", T + "aaa", "classic");  // back to the old one: new entry
        foreach (var o in Skins.HistoryOf("u1")) Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(o));
        Skins.Forget("u1", Skins.History().First(x => x.Url.EndsWith("bbb")) is var w ? "bbb_" + w.From.Ticks : "");
        Console.WriteLine("nach Entfernen: " + Skins.HistoryOf("u1").Count + " / u2: " + Skins.HistoryOf("u2").Count);
        break;
    }
    case "skincheck":
    {
        foreach (var f in args.Skip(2))
        {
            var png = File.ReadAllBytes(f);
            string res; try { Skins.Validate(png, "classic"); res = "ok"; } catch (Exception e) { res = "blockiert: " + e.Message; }
            Console.WriteLine($"{Path.GetFileName(f)} holes={Skins.BaseHoles(png, "classic"):P0} -> {res}");
        }
        break;
    }
    case "skins":
    {
        var pl = System.Text.Json.JsonSerializer.Serialize(await SkinSources.Player(args.ElementAtOrDefault(2) ?? "Notch"));
        Console.WriteLine("player: " + pl[..Math.Min(160, pl.Length)]);
        var d = await SkinSources.Defaults();
        Console.WriteLine("defaults: " + string.Join(", ", d.Select(x => x.Name + "/" + x.Variant)));
        break;
    }
    case "findpack":
    {
        CurseForge.Key = File.ReadAllText(args[2]).Trim();
        foreach (var n in args.Skip(3)) Console.WriteLine($"{n} -> {await Transfer.FindModpack(n) ?? "nicht gefunden"}");
        break;
    }
    case "fp":
    {
        CurseForge.Key = File.ReadAllText(args[2]).Trim();
        var files = Directory.GetFiles(args[3], "*.jar");
        var fps = files.ToDictionary(f => f, f => CurseForge.Fingerprint(f));
        var m = await CurseForge.Match(fps.Values);
        var mods = await CurseForge.Mods(m.Values.Select(v => v.mod));
        foreach (var (f, fp) in fps) Console.WriteLine($"{Path.GetFileName(f)} fp={fp} -> {(m.TryGetValue(fp, out var x) ? (string?)mods.GetValueOrDefault(x.mod)?["name"] + " / " + (string?)x.file["displayName"] : "nicht gefunden")}");
        break;
    }
    case "cf":
    {
        CurseForge.Key = File.ReadAllText(args[2]).Trim();
        System.Text.Json.Nodes.JsonNode first;
        try { var r = await CurseForge.Get("/mods/search?gameId=432&classId=6&searchFilter=waystones&modLoaderType=6&gameVersion=1.21.1&pageSize=3"); first = r["data"]!.AsArray()[0]!; Console.WriteLine("search: " + string.Join(", ", r["data"]!.AsArray().Select(m => (string)m!["name"]!))); }
        catch (Exception e) { Console.WriteLine("search: " + e.Message); first = await CurseForge.Mod(245755); Console.WriteLine("mod: " + (string)first["name"]!); }
        var inst = Instances.Get("neoforge-1-21-1")!;
        var res = await CurseForge.Install(inst, (int)first["id"]!, null, null);
        Console.WriteLine("installed: " + string.Join(", ", res.Installed) + (res.Skipped.Count > 0 ? " | skipped: " + string.Join(", ", res.Skipped) : ""));
        inst = Instances.Get(inst.Id)!;
        Console.WriteLine("mods dir: " + string.Join(", ", Directory.GetFiles(Path.Combine(inst.Dir, "mods")).Select(Path.GetFileName).Where(f => inst.Content.Any(c => c.File == f && c.Source == "curseforge"))));
        var ups = await CurseForge.CheckUpdates(inst);
        Console.WriteLine("updates: " + ups.Count);
        break;
    }
    case "cloudbig":
    {
        Cloud.Api = args[2]; Cloud.Protect = x => x; Cloud.Unprotect = x => x;
        string rootA = Path.Combine(root, "bA"), rootB = Path.Combine(root, "bB");
        void Use(string r) { Paths.Root = r; Directory.CreateDirectory(r); }
        var user = "B_" + Random.Shared.Next(10000, 99999);
        Use(rootA);
        await Cloud.Login(user, "Passwort123", register: true);
        var a = Instances.Create("Legendary Edition", "1.20.1", "forge", "47.4.0");
        var rnd = new Random(3);
        void W(string rel, int kb) { var f = Path.Combine(a.Dir, rel); Directory.CreateDirectory(Path.GetDirectoryName(f)!); var b = new byte[kb * 1024]; rnd.NextBytes(b); File.WriteAllBytes(f, b); }
        for (var n = 0; n < 200; n++) W($"config/m{n}/c.toml", 60);                     // 12 MB of configs
        W("resourcepacks/bottled-dye-e620.zip", 100);
        W("resourcepacks/big-pack.zip", 28000);                                           // 28 MB own pack
        W("mods/own-a.jar", 25000); W("mods/own-b.jar", 20000);                          // 45 MB own mods
        for (var n = 0; n < 300; n++) W($"shaderpacks/MyShader/shaders/f{n}.glsl", 20);  // unpacked shader folder
        W("shaderpacks/MyShader/.gitignore", 1);
        var r1 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A push: pushed={r1.Pushed} tooBig={string.Join("; ", r1.TooBig)}");
        Use(rootB);
        await Cloud.Login(user, "Passwort123", register: false);
        var r2 = await Cloud.Sync(null, null, null);
        var b = Instances.All().Single();
        bool Same(string rel) { var x = Path.Combine(a.Dir, rel); var y = Path.Combine(b.Dir, rel); return File.Exists(y) && File.ReadAllBytes(x).AsSpan().SequenceEqual(File.ReadAllBytes(y)); }
        var shader = Directory.Exists(Path.Combine(b.Dir, "shaderpacks", "MyShader")) ? Directory.GetFiles(Path.Combine(b.Dir, "shaderpacks", "MyShader"), "*", SearchOption.AllDirectories).Length : 0;
        Console.WriteLine($"B pull: pulled={r2.Pulled} bigpack={Same("resourcepacks/big-pack.zip")} dye={Same("resourcepacks/bottled-dye-e620.zip")} modA={Same("mods/own-a.jar")} modB={Same("mods/own-b.jar")} config={Same("config/m77/c.toml")} shaderFiles={shader} gitignore={File.Exists(Path.Combine(b.Dir, "shaderpacks", "MyShader", ".gitignore"))}");
        File.WriteAllText(Path.Combine(b.Dir, "config", "m5", "c.toml"), "from B");
        var r3 = await Cloud.Sync(null, null, null);
        Use(rootA);
        var r4 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"B push={r3.Pushed} -> A pull={r4.Pulled} content={File.ReadAllText(Path.Combine(a.Dir, "config", "m5", "c.toml"))}");
        var r5 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"no echo: pushed={r5.Pushed}");
        break;
    }
    case "cloudfiles":
    {
        Cloud.Api = args[2]; Cloud.Protect = x => x; Cloud.Unprotect = x => x;
        string rootA = Path.Combine(root, "fA"), rootB = Path.Combine(root, "fB");
        void Use(string r) { Paths.Root = r; Directory.CreateDirectory(r); }
        var user = "F_" + Random.Shared.Next(10000, 99999);
        Use(rootA);
        await Cloud.Login(user, "Passwort123", register: true);
        var a = Instances.Create("Big Pack", "1.20.1", "forge", "1.20.1-47.4.22");
        var rnd = new Random(1);
        string W(string rel, int kb, bool text)
        {
            var f = Path.Combine(a.Dir, rel); Directory.CreateDirectory(Path.GetDirectoryName(f)!);
            if (text) File.WriteAllText(f, string.Concat(Enumerable.Range(0, kb * 16).Select(n => $"key{n % 997}={rnd.Next(1000)}\n")));
            else { var b = new byte[kb * 1024]; rnd.NextBytes(b); File.WriteAllBytes(f, b); }
            return f;
        }
        for (var n = 0; n < 300; n++) W($"config/mod{n}/settings.toml", 20, true);        // ~6 MB of configs
        W("kubejs/server_scripts/recipes.js", 200, true);
        W("defaultconfigs/ftbquests.snbt", 300, true);
        W("shaderpacks/Complementary.zip.txt", 2, true);
        W("optionsof.txt", 3, true);
        W("mods/my-own-mod.jar", 3000, false);                                           // not in any catalog
        W("logs/latest.log", 500, true);                                                  // must not travel
        var r1 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A push: pushed={r1.Pushed} tooBig={string.Join("; ", r1.TooBig)}");
        var again = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A again (nothing changed): pushed={again.Pushed}");
        Use(rootB);
        await Cloud.Login(user, "Passwort123", register: false);
        var r2 = await Cloud.Sync(null, null, null);
        var b = Instances.All().Single();
        int Count(string dir) => Directory.Exists(Path.Combine(b.Dir, dir)) ? Directory.GetFiles(Path.Combine(b.Dir, dir), "*", SearchOption.AllDirectories).Length : 0;
        Console.WriteLine($"B pull: created={r2.Created} pulled={r2.Pulled} configs={Count("config")} kubejs={Count("kubejs")} defaultconfigs={Count("defaultconfigs")} shadertxt={File.Exists(Path.Combine(b.Dir, "shaderpacks", "Complementary.zip.txt"))} optionsof={File.Exists(Path.Combine(b.Dir, "optionsof.txt"))} ownmod={File.Exists(Path.Combine(b.Dir, "mods", "my-own-mod.jar")) && new FileInfo(Path.Combine(b.Dir, "mods", "my-own-mod.jar")).Length == 3000 * 1024} logs={Count("logs")}");
        // B changes a config -> A gets it
        File.WriteAllText(Path.Combine(b.Dir, "config", "mod7", "settings.toml"), "changed=on B");
        var r3 = await Cloud.Sync(null, null, null);
        Use(rootA);
        var r4 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"B push={r3.Pushed} -> A pull={r4.Pulled} content={File.ReadAllText(Path.Combine(a.Dir, "config", "mod7", "settings.toml"))}");
        var r5 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A after applying (no echo upload): pushed={r5.Pushed}");
        break;
    }
    case "cloud":
    {
        Cloud.Api = args[2]; Cloud.Protect = x => x; Cloud.Unprotect = x => x;
        string rootA = Path.Combine(root, "pcA"), rootB = Path.Combine(root, "pcB");
        void Use(string r) { Paths.Root = r; Directory.CreateDirectory(r); }
        var user = "E2E_" + Random.Shared.Next(10000, 99999);
        // PC A: register, create a Fabric instance with Sodium, a group and options
        Use(rootA);
        await Cloud.Login(user, "Passwort123", register: true);
        var a = Instances.Create("Cloud Test", "1.21.1", "fabric", null);
        a.Group = "PvP"; a.RamMb = 3072; Instances.Save(a);
        File.WriteAllText(Path.Combine(a.Dir, "options.txt"), "fov:0.75\nrenderDistance:16\n");
        Directory.CreateDirectory(Path.Combine(a.Dir, "config")); File.WriteAllText(Path.Combine(a.Dir, "config", "sodium-options.json"), "{\"quality\":1}");
        await Modrinth.Install(Instances.Get(a.Id)!, "sodium", "mod", null, null);
        var r1 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A push: pushed={r1.Pushed} pulled={r1.Pulled}");
        // PC B: login, sync -> instance appears, mods restored from Modrinth
        Use(rootB);
        await Cloud.Login(user, "Passwort123", register: false);
        var r2 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"B pull: created={r2.Created} pulled={r2.Pulled} toInstall={string.Join(",", r2.ToInstall.Select(m => m.Title))}");
        var res = await Cloud.Restore(r2.ToInstall, null);
        var b = Instances.All().Single();
        Console.WriteLine($"B instance: {b.Name} {b.Loader} {b.McVersion} group={b.Group} ram={b.RamMb} uid={(b.Uid == a.Uid)} mods=[{string.Join(", ", Directory.GetFiles(Path.Combine(b.Dir, "mods")).Select(Path.GetFileName))}] options={File.ReadAllText(Path.Combine(b.Dir, "options.txt")).Replace("\n", " ")} config={File.Exists(Path.Combine(b.Dir, "config", "sodium-options.json"))} restored={res.ok} failed={res.failed.Count}");
        // B renames -> A gets it
        await Task.Delay(1200);
        b = Instances.Get(b.Id)!; b.Name = "Umbenannt auf B"; Instances.Save(b);
        await Cloud.Sync(null, null, null);
        Use(rootA);
        var r3 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A after B rename: pulled={r3.Pulled} name={Instances.All().Single().Name}");
        // A deletes -> B loses it
        Instances.Delete(Instances.All().Single().Id); Cloud.MarkDeleted(a.Uid);
        var r4 = await Cloud.Sync(null, null, null);
        Use(rootB);
        var r5 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"delete: A tombstones={r4.Deleted} B deleted={r5.Deleted} B instances={Instances.All().Count}");
        // and it never comes back on A
        Use(rootA); var r6 = await Cloud.Sync(null, null, null);
        Console.WriteLine($"A again: created={r6.Created} instances={Instances.All().Count}");
        break;
    }
    case "official":
    {
        var inst = Instances.Get(args[2])!;
        var name = await OfficialLauncher.Export(inst, new Settings(), null);
        var pf = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(OfficialLauncher.McDir, "launcher_profiles.json")))!;
        Console.WriteLine($"profile {name}: " + pf["profiles"]!["orbit-" + inst.Id]!.ToJsonString());
        Console.WriteLine("versions: " + string.Join(", ", Directory.GetDirectories(Path.Combine(OfficialLauncher.McDir, "versions")).Select(Path.GetFileName)));
        Console.WriteLine("libraries copied: " + Directory.GetFiles(Path.Combine(OfficialLauncher.McDir, "libraries"), "*.jar", SearchOption.AllDirectories).Length);
        break;
    }
    case "ping":
    {
        foreach (var a in args.Skip(2)) { var st = await ServerPing.Ping(a); Console.WriteLine($"{a}: online={st.Online} {st.Players}/{st.Max} ping={st.Ping} ver={st.Version} motd={st.Motd?.Replace("\n"," | ")} icon={(st.Icon?.Length ?? 0)}"); }
        break;
    }
    case "export":
    {
        var inst = Instances.Get(args[2])!;
        var t = Path.Combine(Paths.Root, "export.mrpack");
        await Transfer.Export(inst, t, "1.0.0", false, null);
        using var z = System.IO.Compression.ZipFile.OpenRead(t);
        Console.WriteLine($"exported {inst.Name}: {z.Entries.Count} entries, index files=" + System.Text.Json.Nodes.JsonNode.Parse(new StreamReader(z.GetEntry("modrinth.index.json")!.Open()).ReadToEnd())!["files"]!.AsArray().Count);
        break;
    }
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
        var jar = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../Assets/orbitclient.jar"));
        OrbitClient.ModJar = () => File.Exists(jar) ? File.OpenRead(jar) : null;
        var (inst, ok, skipped) = await OrbitClient.Create(null, OrbitClient.Packs.Where(m => m.Default).Select(m => m.Id), 3072, "#FF7A3D", prog);
        Console.WriteLine("Orbit-Mod in Instanz: " + File.Exists(Path.Combine(inst.Dir, "mods", OrbitClient.ModFile)));
        Console.WriteLine($"Installiert ({ok.Count}): {string.Join(", ", ok)}");
        Console.WriteLine($"Übersprungen ({skipped.Count}): {string.Join(", ", skipped)}");
        await Launch(inst);
        break;
    }
    case "client":
    {
        // Orbit Client mod in an Orbit instance, with UI autotest (-Dorbit.autotest) for screenshots
        var inst = Instances.All().First(i => i.Kind == "orbit");
        var mods = Path.Combine(inst.Dir, "mods");
        foreach (var f in Directory.GetFiles(mods, "orbitclient*.jar")) File.Delete(f);
        File.Copy(args[2], Path.Combine(mods, Path.GetFileName(args[2])));
        set.JvmArgs = "-Dorbit.autotest=" + (args.ElementAtOrDefault(3) ?? "menu,settings,editor");
        waitSec = 75;
        await Launch(inst);
        break;
    }
    case "ensure":
    {
        // "Spielen" for any version: Orbit instance is created on the fly
        var inst = await OrbitClient.EnsureInstance(args[2], new[] { "perf", "shaders", "qol" }, 3072, "#FF7A3D", prog);
        var mods = Directory.Exists(Path.Combine(inst.Dir, "mods")) ? Directory.GetFiles(Path.Combine(inst.Dir, "mods"), "*.jar").Length : 0;
        Console.WriteLine($"{inst.Name}: Loader {inst.Loader}, {mods} Mods, voller Client: {OrbitClient.HasMod(inst)}");
        var (plan, java) = await Runner.Prepare(inst, set, prog);
        Console.WriteLine($"Startbereit: Java {plan.JavaMajor}, {plan.Classpath.Count} Classpath-Einträge");
        break;
    }
    case "list":
    {
        var inst = Instances.Create("Fresh", "26.3", "fabric", "0.19.5", "modpack");
        var rp = Path.Combine(inst.Dir, "resourcepacks");
        var sp = Path.Combine(inst.Dir, "shaderpacks");
        File.WriteAllText(Path.Combine(rp, "§6Bray's Bow and Arrows v1.2.4.zip"), "pack");
        File.WriteAllText(Path.Combine(rp, "§6Bray's Bow and Arrows v1.2.4.zip.rpo"), "{}");
        File.WriteAllText(Path.Combine(rp, "[HMI] Gous's Hand Poses.zip.rpo"), "{}");
        File.WriteAllText(Path.Combine(sp, "_0EUPHORIA_PATCHES_ERROR_LOGS.txt"), "log");
        File.WriteAllText(Path.Combine(sp, "ComplementaryReimagined_r5.9.3.zip.txt"), "note");
        var err = Path.Combine(sp, "_0EuphoriaPatches_ErrorShader", "shaders");
        Directory.CreateDirectory(err);
        File.WriteAllText(Path.Combine(err, "composite.fsh"), "shadercode");
        File.WriteAllText(Path.Combine(sp, "ComplementaryReimagined_r5.9.3.zip"), "shader");
        string P(object o, string n) => o.GetType().GetProperty(n)!.GetValue(o)?.ToString() ?? "";
        var packs = Instances.ListFiles(inst, "resourcepack");
        var shaders = Instances.ListFiles(inst, "shader");
        Console.WriteLine("packs " + packs.Count + " " + string.Join(" | ", packs.Select(o => P(o, "title") + " / " + P(o, "file"))));
        Console.WriteLine("shaders " + shaders.Count + " " + string.Join(" | ", shaders.Select(o => P(o, "title") + " " + P(o, "size"))));
        if (packs.Count != 1 || P(packs[0], "title") != "Bray's Bow and Arrows v1.2.4") throw new Exception("resource pack row wrong");
        if (shaders.Count != 1 || P(shaders[0], "file") != "ComplementaryReimagined_r5.9.3.zip") throw new Exception("shader rows " + shaders.Count);
        if (shaders.Any(o => P(o, "file").Contains("Error", StringComparison.OrdinalIgnoreCase) || P(o, "file").EndsWith(".txt"))) throw new Exception("note listed");
        Console.WriteLine("list ok");
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
    var done = await Task.WhenAny(exited.Task, Task.Delay(TimeSpan.FromSeconds(waitSec)));
    if (done != exited.Task) { Console.WriteLine($"Läuft nach {waitSec}s noch – beende."); runner.Kill(inst.Id); }
    else Console.WriteLine("Beendet mit Code " + exited.Task.Result);
}
