using System.Collections.Concurrent;
using System.Diagnostics;

namespace OrbitLauncher.Core;

/// <summary>Installs (if needed) and starts instances, streams the game log and tracks play time.</summary>
public class Runner
{
    public event Action<string, string>? Log;          // instance id, line
    public event Action<string, bool, int?>? State;    // instance id, running, exit code
    private readonly ConcurrentDictionary<string, Process> _running = new();

    public bool IsRunning(string id) => _running.ContainsKey(id);
    public Process? ProcessOf(string id) => _running.TryGetValue(id, out var p) ? p : null;
    public IEnumerable<string> RunningIds => _running.Keys;

    /// <summary>Loader + client + libraries + assets + Java. Safe to call repeatedly (only missing files are fetched).</summary>
    public static async Task<(LaunchPlan plan, string java)> Prepare(Instance inst, Settings set, IProgress<Progress>? p, CancellationToken ct = default, bool java = true)
    {
        if (inst.VersionId == null || !File.Exists(Versions.JsonPath(inst.VersionId)))
        {
            inst.VersionId = await Loaders.Install(inst.Loader, inst.McVersion, inst.LoaderVersion, p, ct);
            Instances.Save(inst);
        }
        OrbitClient.EnsureMod(inst);
        var plan = await GameInstaller.Prepare(inst.VersionId, inst.Dir, p, ct);
        if (!java) return (plan, "");
        var javaExe = !string.IsNullOrWhiteSpace(inst.JavaPath) && File.Exists(inst.JavaPath) ? inst.JavaPath!
                 : !string.IsNullOrWhiteSpace(set.JavaPath) && File.Exists(set.JavaPath) ? set.JavaPath!
                 : await Java.Ensure(plan.JavaMajor, plan.JavaComponent, p, ct);
        return (plan, javaExe);
    }

    public async Task<Process> Launch(Instance inst, Session s, Settings set, IProgress<Progress>? p, CancellationToken ct = default, string? server = null, string? world = null)
    {
        if (_running.ContainsKey(inst.Id)) throw new InvalidOperationException($"„{inst.Name}“ läuft bereits.");
        var (plan, java) = await Prepare(inst, set, p, ct);
        var ram = inst.RamMb > 0 ? inst.RamMb : set.RamMb;
        var extra = inst.Kind == "orbit" ? new[] { "-Dorbit.config=" + OrbitClient.ConfigPath } : null;
        if (server == null && world == null && !string.IsNullOrWhiteSpace(inst.AutoJoin)) server = inst.AutoJoin!.Trim();
        var args = LaunchBuilder.Build(plan, s, inst.Dir, ram, string.IsNullOrWhiteSpace(inst.JvmArgs) ? set.JvmArgs : inst.JvmArgs,
            inst.Width > 0 ? inst.Width : set.Width, inst.Height > 0 ? inst.Height : set.Height, server, extra, world);
        if (inst.Fullscreen) args.Add("--fullscreen");
        var env = Env(inst);
        if (!string.IsNullOrWhiteSpace(inst.PreLaunch))
        {
            p?.Report(new Progress("Vor-Start-Befehl läuft", 0, 1, inst.Name));
            Log?.Invoke(inst.Id, "[OrbitLauncher] Vor dem Start: " + inst.PreLaunch);
            var code = await Hook(inst, inst.PreLaunch!, env, true, ct);
            if (code != 0) throw new InvalidOperationException($"Der Vor-Start-Befehl ist mit Code {code} fehlgeschlagen.");
        }
        p?.Report(new Progress("Minecraft startet", 1, 1, inst.Name));
        Log?.Invoke(inst.Id, "[OrbitLauncher] " + (string.IsNullOrWhiteSpace(inst.Wrapper) ? "" : inst.Wrapper + " ") + LaunchBuilder.Pretty(java, args, s));

        var proc = LaunchBuilder.Start(java, args, inst.Dir, inst.Wrapper, env);
        var started = DateTime.UtcNow;
        _running[inst.Id] = proc;
        proc.EnableRaisingEvents = true;
        var parser = new Log4jParser(l => Log?.Invoke(inst.Id, l.Replace(s.AccessToken, "••••••")));
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) lock (parser) parser.Feed(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) Log?.Invoke(inst.Id, e.Data.Replace(s.AccessToken, "••••••")); };
        proc.Exited += (_, _) =>
        {
            _running.TryRemove(inst.Id, out _);
            int? code = null; try { code = proc.ExitCode; } catch { }
            var fresh = Instances.Get(inst.Id);
            if (fresh != null)
            {
                fresh.PlaySeconds += (long)(DateTime.UtcNow - started).TotalSeconds;
                fresh.LastPlayed = DateTime.UtcNow;
                Instances.Save(fresh);
            }
            // many modpacks end with a non-zero exit code although the player just quit: only a real crash counts
            State?.Invoke(inst.Id, false, code is null or 0 || !Crashed(inst, started) ? 0 : code);
            if (!string.IsNullOrWhiteSpace(inst.PostExit)) _ = Hook(inst, inst.PostExit!, env, false, default);
        };
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        inst.LastPlayed = DateTime.UtcNow;
        Instances.Save(inst);
        State?.Invoke(inst.Id, true, null);
        return proc;
    }

    /// <summary>KEY=VALUE lines of the instance plus INST_* helpers for hooks.</summary>
    private static Dictionary<string, string> Env(Instance inst)
    {
        var d = new Dictionary<string, string> { ["INST_NAME"] = inst.Name, ["INST_ID"] = inst.Id, ["INST_DIR"] = inst.Dir, ["INST_MC_VERSION"] = inst.McVersion, ["INST_LOADER"] = inst.Loader };
        foreach (var line in (inst.EnvVars ?? "").Split('\n'))
        {
            var t = line.Trim(); var eq = t.IndexOf('=');
            if (eq > 0 && !t.StartsWith('#')) d[t[..eq].Trim()] = t[(eq + 1)..].Trim();
        }
        return d;
    }

    /// <summary>Runs a hook command through the shell in the instance folder.</summary>
    private static async Task<int> Hook(Instance inst, string cmd, Dictionary<string, string> env, bool wait, CancellationToken ct)
    {
        var win = OperatingSystem.IsWindows();
        var psi = new ProcessStartInfo(win ? "cmd.exe" : "/bin/sh") { WorkingDirectory = inst.Dir, UseShellExecute = false, CreateNoWindow = true };
        psi.ArgumentList.Add(win ? "/c" : "-c"); psi.ArgumentList.Add(cmd);
        foreach (var (k, v) in env) psi.Environment[k] = v;
        try
        {
            using var pr = Process.Start(psi);
            if (pr == null) return -1;
            if (!wait) return 0;
            await pr.WaitForExitAsync(ct);
            return pr.ExitCode;
        }
        catch (Exception) when (!wait) { return 0; }
    }

    public void Kill(string id) { if (_running.TryGetValue(id, out var p)) try { p.Kill(true); } catch { } }

    /// <summary>Newest crash report of an instance (if the game crashed).</summary>
    /// <summary>True for a real crash: a crash report or JVM error file from this session, or a log that never reached the normal shutdown.</summary>
    public static bool Crashed(Instance inst, DateTime startedUtc)
    {
        try
        {
            var since = startedUtc.AddSeconds(-5);
            var cr = Path.Combine(inst.Dir, "crash-reports");
            if (Directory.Exists(cr) && new DirectoryInfo(cr).GetFiles("*.txt").Any(f => f.LastWriteTimeUtc >= since)) return true;
            if (new DirectoryInfo(inst.Dir).GetFiles("hs_err_pid*.log").Any(f => f.LastWriteTimeUtc >= since)) return true;
            var log = Path.Combine(inst.Dir, "logs", "latest.log");
            if (!File.Exists(log) || File.GetLastWriteTimeUtc(log) < since) return true;
            using var fs = new FileStream(log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            fs.Seek(Math.Max(0, fs.Length - 96 * 1024), SeekOrigin.Begin);
            var tail = new StreamReader(fs).ReadToEnd();
            // vanilla prints "Stopping!" when the player quits; a crash prints the report header instead
            if (tail.Contains("---- Minecraft Crash Report ----") || tail.Contains("Game crashed!")) return true;
            return !tail.Contains("Stopping!");
        }
        catch { return true; }
    }

    public static string? LatestCrash(Instance inst)
    {
        var d = Path.Combine(inst.Dir, "crash-reports");
        if (!Directory.Exists(d)) return null;
        return new DirectoryInfo(d).GetFiles("*.txt").OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault(f => DateTime.UtcNow - f.LastWriteTimeUtc < TimeSpan.FromMinutes(5))?.FullName;
    }
}

/// <summary>Minecraft's log4j config prints XML events on stdout; turn them back into readable lines.</summary>
public class Log4jParser
{
    private readonly Action<string> _emit;
    private bool _in, _cdata;
    private string _head = "";
    private readonly System.Text.StringBuilder _msg = new();
    private static readonly System.Text.RegularExpressions.Regex Attr = new("(\\w+)=\"([^\"]*)\"");
    public Log4jParser(Action<string> emit) => _emit = emit;

    public void Feed(string line)
    {
        var t = line.TrimStart();
        if (!_in && t.StartsWith("<log4j:Event"))
        {
            _in = true; _msg.Clear();
            var a = Attr.Matches(t).ToDictionary(m => m.Groups[1].Value, m => m.Groups[2].Value);
            var time = a.TryGetValue("timestamp", out var ts) && long.TryParse(ts, out var ms) ? DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("HH:mm:ss") : "";
            _head = $"[{time}] [{a.GetValueOrDefault("thread")}/{a.GetValueOrDefault("level")}]: ";
            return;
        }
        if (!_in) { _emit(line); return; }
        if (t.StartsWith("</log4j:Event>"))
        {
            _in = false;
            var text = _msg.ToString().TrimEnd();
            foreach (var (l, i) in text.Split('\n').Select((l, i) => (l.TrimEnd('\r'), i))) _emit(i == 0 ? _head + l : l);
            return;
        }
        var start = line.IndexOf("<![CDATA[", StringComparison.Ordinal);
        if (start >= 0) { _cdata = true; line = line[(start + 9)..]; if (_msg.Length > 0) _msg.Append('\n'); }
        if (!_cdata) return;
        var end = line.IndexOf("]]>", StringComparison.Ordinal);
        if (end >= 0) { _msg.Append(line[..end]); _cdata = false; }
        else _msg.Append(line).Append('\n');
    }
}
