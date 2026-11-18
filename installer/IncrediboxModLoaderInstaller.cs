// Incredibox ModLoader Installer (single exe, MelonLoader-style)
//
// Does what scripts/setup-game.ps1 does, without Node.js or Bandizip:
//   1. find the Steam Incredibox folder (registry + libraryfolders.vdf)
//   2. carve app-64.7z out of Incredibox_steam.exe (the NSIS wrapper stores it raw)
//   3. unpack it into <GameDir>\Modded with Windows tar.exe (libarchive, Win11),
//      falling back to 7-Zip or Bandizip when tar cannot read 7z (older Windows 10)
//   4. unpack resources\app.asar -> resources\app (app.asar renamed to app.asar.bak)
//   5. copy the embedded modloader\*.js and point package.json "main" at it
//   6. install the Steam launcher as Incredibox_steam.exe (original kept as .original.exe)
//
// The payload (modloader, sample mod, launcher source + prebuilt launcher) is embedded as
// manifest resources by scripts/build-installer.ps1. Built with the .NET Framework 4 csc.exe
// (C# 5): no string interpolation, no ?. operator.
//
// Command line (for scripting / tests; no window):
//   --install   [--game-dir <dir>] [--target <dir>] [--no-launcher]
//   --uninstall [--game-dir <dir>]
//   --status    [--game-dir <dir>]

using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.CSharp;
using Microsoft.Win32;

static class Program
{
    [DllImport("kernel32.dll")] static extern bool AttachConsole(int pid);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0) return RunCli(args);

        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
        return 0;
    }

    static int RunCli(string[] args)
    {
        IntPtr h = GetStdHandle(-11);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) AttachConsole(-1);

        string mode = null, gameDir = null, target = null;
        bool launcher = true;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--install" || a == "--uninstall" || a == "--status") mode = a.Substring(2);
            else if (a == "--no-launcher") launcher = false;
            else if (a == "--game-dir" && i + 1 < args.Length) gameDir = args[++i];
            else if (a == "--target" && i + 1 < args.Length) target = args[++i];
            else { Console.Error.WriteLine("Unknown argument: " + a); return 2; }
        }
        if (mode == null) { Console.Error.WriteLine("Use --install, --uninstall or --status."); return 2; }

        if (gameDir == null) gameDir = Installer.FindGameDir();
        if (gameDir == null) { Console.Error.WriteLine("Incredibox not found via Steam. Pass --game-dir <dir>."); return 1; }

        Installer inst = new Installer();
        inst.Log = delegate(string s) { Console.WriteLine(s); };
        inst.Progress = delegate(int p) { };
        try
        {
            if (mode == "status") { Console.WriteLine(Installer.DescribeStatus(gameDir)); return 0; }
            if (mode == "uninstall") { inst.Uninstall(gameDir); return 0; }
            inst.Install(gameDir, target, launcher);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ERROR: " + ex.Message);
            return 1;
        }
    }
}

// ----------------------------------------------------------------------------------------------
// Install / uninstall logic (UI-independent)
// ----------------------------------------------------------------------------------------------
class Installer
{
    public const string LauncherProduct = "Incredibox ModLoader Launcher";
    const string ResPrefix = "payload/";

    public Action<string> Log;
    public Action<int> Progress; // 0..100, -1 = indeterminate

    // ---------- discovery ----------

    public static string FindGameDir()
    {
        List<string> libs = new List<string>();
        string steamRoot = null;
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                if (k != null) steamRoot = k.GetValue("SteamPath") as string;
        }
        catch { }
        if (string.IsNullOrEmpty(steamRoot)) return null;
        steamRoot = steamRoot.Replace('/', '\\');
        libs.Add(steamRoot);
        string vdf = Path.Combine(steamRoot, @"steamapps\libraryfolders.vdf");
        if (File.Exists(vdf))
        {
            foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"([^\"]+)\""))
                libs.Add(m.Groups[1].Value.Replace(@"\\", @"\"));
        }
        foreach (string lib in libs)
        {
            string dir = Path.Combine(lib, @"steamapps\common\Incredibox");
            if (IsGameDir(dir))
            {
                string full = Path.GetFullPath(dir);
                if (full.Length > 1 && full[1] == ':') full = char.ToUpperInvariant(full[0]) + full.Substring(1);
                return full;
            }
        }
        return null;
    }

    public static bool IsGameDir(string dir)
    {
        if (string.IsNullOrEmpty(dir)) return false;
        return File.Exists(Path.Combine(dir, "Incredibox_steam.exe")) ||
               File.Exists(Path.Combine(dir, "Incredibox_steam.original.exe"));
    }

    public static bool IsLauncher(string path)
    {
        if (!File.Exists(path)) return false;
        try { return FileVersionInfo.GetVersionInfo(path).ProductName == LauncherProduct; }
        catch { return false; }
    }

    public static string EmbeddedLoaderVersion()
    {
        string js = ReadResourceText(ResPrefix + "modloader/main.js");
        return ParseLoaderVersion(js);
    }

    public static string InstalledLoaderVersion(string targetDir)
    {
        string p = Path.Combine(targetDir, @"resources\app\modloader\main.js");
        if (!File.Exists(p)) return null;
        return ParseLoaderVersion(File.ReadAllText(p));
    }

    static string ParseLoaderVersion(string js)
    {
        if (js == null) return null;
        Match m = Regex.Match(js, "LOADER_VERSION\\s*=\\s*['\"]([^'\"]+)['\"]");
        return m.Success ? m.Groups[1].Value : "?";
    }

    public static string DescribeStatus(string gameDir)
    {
        StringBuilder sb = new StringBuilder();
        string steamExe = Path.Combine(gameDir, "Incredibox_steam.exe");
        string target = Path.Combine(gameDir, "Modded");
        string installed = InstalledLoaderVersion(target);
        sb.AppendLine("게임 폴더: " + gameDir);
        if (IsLauncher(steamExe))
            sb.AppendLine("Steam 실행 파일: ModLoader 런처 (원본은 Incredibox_steam.original.exe)");
        else if (File.Exists(steamExe))
            sb.AppendLine("Steam 실행 파일: 원본 (Steam ▶ 플레이 = 바닐라 게임)");
        else
            sb.AppendLine("Steam 실행 파일: 없음");
        sb.Append("모드 로더: ");
        sb.Append(installed != null ? ("v" + installed + " 설치됨 (" + target + ")") : "설치 안 됨");
        return sb.ToString();
    }

    // ---------- uninstall ----------

    public void Uninstall(string gameDir)
    {
        AssertGameNotRunning(gameDir);
        string steamExe = Path.Combine(gameDir, "Incredibox_steam.exe");
        string original = Path.Combine(gameDir, "Incredibox_steam.original.exe");
        if (IsLauncher(steamExe))
        {
            if (!File.Exists(original))
                throw new InvalidOperationException("원본 백업이 없습니다: " + original +
                    "\nSteam에서 '게임 파일 무결성 검사'로 원본을 복구하세요.");
            File.Delete(steamExe);
            File.Move(original, steamExe);
            Log("원본 Incredibox_steam.exe를 복원했습니다. 이제 Steam ▶ 플레이는 바닐라 게임입니다.");
        }
        else
        {
            Log("Incredibox_steam.exe는 이미 원본입니다. 복원할 것이 없습니다.");
        }
        Log("모드 실행 환경(" + Path.Combine(gameDir, "Modded") + ")은 남겨 두었습니다. " +
            "Mods/ApkMods 저장 데이터가 들어 있으니 필요 없을 때만 직접 지우세요.");
    }

    // ---------- install ----------

    public void Install(string gameDir, string targetDir, bool installLauncher)
    {
        gameDir = Path.GetFullPath(gameDir);
        string defaultTarget = Path.Combine(gameDir, "Modded");
        if (string.IsNullOrEmpty(targetDir)) targetDir = defaultTarget;
        targetDir = Path.GetFullPath(targetDir);

        string steamExe = Path.Combine(gameDir, "Incredibox_steam.exe");
        string originalExe = Path.Combine(gameDir, "Incredibox_steam.original.exe");

        Progress(0);
        Log("[1/6] 게임 확인 중...");
        AssertGameNotRunning(gameDir);
        AssertGameNotRunning(targetDir);

        string sourceExe;
        if (IsLauncher(steamExe))
        {
            if (!File.Exists(originalExe))
                throw new InvalidOperationException("런처는 설치돼 있는데 원본 백업(" + originalExe + ")이 없습니다.\n" +
                    "Steam에서 '게임 파일 무결성 검사'를 한 뒤 다시 설치하세요.");
            sourceExe = originalExe;
        }
        else if (File.Exists(steamExe))
        {
            sourceExe = steamExe; // first install, or Steam updated/verified the game
        }
        else
        {
            throw new FileNotFoundException("Incredibox_steam.exe가 없습니다: " + steamExe);
        }
        Log("  게임 폴더: " + gameDir);
        Log("  설치 위치: " + targetDir);
        Log("  원본 파일: " + sourceExe);

        long[] arc = Find7z(sourceExe);
        if (arc == null)
            throw new InvalidOperationException("게임 실행 파일 안에서 app-64.7z를 찾지 못했습니다. 지원하지 않는 게임 버전일 수 있습니다.");
        Log("  내장 7z: 오프셋 " + arc[0] + ", " + (arc[1] / 1048576) + " MB");

        Directory.CreateDirectory(targetDir);
        string tmpDir = Path.Combine(targetDir, ".installer-tmp");
        DeleteDir(tmpDir);
        Directory.CreateDirectory(tmpDir);
        try
        {
            string archive = Path.Combine(tmpDir, "app-64.7z");
            Log("[2/6] app-64.7z 꺼내는 중...");
            CopyRange(sourceExe, arc[0], arc[1], archive, 2, 20);

            string resources = Path.Combine(targetDir, "resources");
            string asar = Path.Combine(resources, "app.asar");
            string asarBak = Path.Combine(resources, "app.asar.bak");
            string appDir = Path.Combine(resources, "app");
            if (File.Exists(asar)) File.Delete(asar); // leftover of an interrupted run

            Log("[3/6] 게임 런타임 압축 푸는 중 (1~2분 걸릴 수 있습니다)...");
            Progress(-1);
            Extract7z(archive, targetDir);
            if (!File.Exists(Path.Combine(targetDir, "Incredibox.exe")) || !File.Exists(asar))
                throw new InvalidOperationException("압축 해제 결과에 Incredibox.exe 또는 resources\\app.asar가 없습니다.");
            File.Delete(archive);

            Log("[4/6] resources\\app.asar 푸는 중...");
            DeleteDir(appDir);
            int count = ExtractAsar(asar, appDir, 60, 30);
            Log("  " + count + "개 파일");
            if (File.Exists(asarBak)) File.Delete(asarBak);
            File.Move(asar, asarBak);

            Log("[5/6] 모드 로더 설치 중...");
            string loaderDir = Path.Combine(appDir, "modloader");
            DeleteDir(loaderDir);
            int n = WriteResources(ResPrefix + "modloader/", loaderDir, true);
            Log("  modloader\\ " + n + "개 파일 (v" + EmbeddedLoaderVersion() + ")");
            PatchPackageJson(Path.Combine(appDir, "package.json"));
            string mods = Path.Combine(targetDir, "Mods");
            Directory.CreateDirectory(mods);
            Directory.CreateDirectory(Path.Combine(targetDir, "ApkMods"));
            string sample = Path.Combine(mods, "hello-mod");
            if (!Directory.Exists(sample))
            {
                WriteResources(ResPrefix + "mods/hello-mod/", sample, true);
                Log("  예제 모드 Mods\\hello-mod 설치");
            }
            Progress(95);

            if (!installLauncher)
            {
                Log("[6/6] 런처 설치 건너뜀. 실행: " + Path.Combine(targetDir, "Incredibox.exe"));
            }
            else if (!string.Equals(targetDir.TrimEnd('\\'), defaultTarget.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                Log("[6/6] 런처는 <게임 폴더>\\Modded 설치일 때만 지원합니다. 건너뜀. 실행: " +
                    Path.Combine(targetDir, "Incredibox.exe"));
            }
            else
            {
                Log("[6/6] Steam 런처 설치 중 (원본은 Incredibox_steam.original.exe로 보관)...");
                string built = BuildLauncher(tmpDir, Path.Combine(appDir, @"src\favicon.ico"));
                if (!IsLauncher(steamExe))
                {
                    if (File.Exists(originalExe)) File.Delete(originalExe);
                    File.Move(steamExe, originalExe);
                }
                File.Copy(built, steamExe, true);
                Log("  Steam ▶ 플레이 → 모드 로더 실행. Shift를 누른 채 실행하면 원본 게임.");
            }
        }
        finally
        {
            try { DeleteDir(tmpDir); } catch { }
        }
        Progress(100);
        Log("완료! 게임 왼쪽 아래에 'ModLoader v" + EmbeddedLoaderVersion() + " … [F10]' 배지가 보이면 성공입니다.");
    }

    // ---------- helpers: processes ----------

    static void AssertGameNotRunning(string dir)
    {
        string full = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
        foreach (Process p in Process.GetProcesses())
        {
            try
            {
                if (!p.ProcessName.StartsWith("Incredibox", StringComparison.OrdinalIgnoreCase)) continue;
                string path = p.MainModule.FileName;
                if (path != null && path.StartsWith(full, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Incredibox가 실행 중입니다 (" + path + ").\n게임을 닫고 다시 시도하세요.");
            }
            catch (InvalidOperationException) { throw; }
            catch { }
            finally { p.Dispose(); }
        }
    }

    // ---------- helpers: 7z inside the NSIS wrapper ----------

    static readonly byte[] Sig7z = { 0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C };

    // Returns { offset, length } of the first valid 7z archive in the file, or null.
    // electron-builder stores $PLUGINSDIR\app-64.7z uncompressed in the NSIS data block,
    // so the archive bytes appear verbatim. A hit is accepted only if the start-header CRC
    // matches and the archive end fits in the file.
    public static long[] Find7z(string path)
    {
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
        {
            long fileLen = fs.Length;
            byte[] buf = new byte[4 << 20];
            long basePos = 0;
            int carry = 0;
            while (true)
            {
                int read = fs.Read(buf, carry, buf.Length - carry);
                int len = carry + read;
                if (len < 32) return null;
                for (int i = 0; i + 32 <= len; i++)
                {
                    if (buf[i] != 0x37 || buf[i + 1] != 0x7A || buf[i + 2] != 0xBC ||
                        buf[i + 3] != 0xAF || buf[i + 4] != 0x27 || buf[i + 5] != 0x1C) continue;
                    if (buf[i + 6] != 0) continue; // major version 0
                    uint crc = BitConverter.ToUInt32(buf, i + 8);
                    if (Crc32(buf, i + 12, 20) != crc) continue;
                    long nextOff = BitConverter.ToInt64(buf, i + 12);
                    long nextSize = BitConverter.ToInt64(buf, i + 20);
                    long start = basePos + i;
                    long total = 32 + nextOff + nextSize;
                    if (nextOff < 0 || nextSize <= 0 || start + total > fileLen) continue;
                    return new long[] { start, total };
                }
                if (read == 0) return null;
                carry = 31;
                Buffer.BlockCopy(buf, len - carry, buf, 0, carry);
                basePos += len - carry;
            }
        }
    }

    static uint[] crcTable;
    static uint Crc32(byte[] data, int off, int len)
    {
        if (crcTable == null)
        {
            uint[] t = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                uint c = n;
                for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                t[n] = c;
            }
            crcTable = t;
        }
        uint crc = 0xFFFFFFFFu;
        for (int i = off; i < off + len; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
        return crc ^ 0xFFFFFFFFu;
    }

    void CopyRange(string src, long offset, long length, string dest, int pFrom, int pSpan)
    {
        using (FileStream i = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
        using (FileStream o = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
        {
            i.Position = offset;
            byte[] buf = new byte[1 << 20];
            long left = length;
            int lastPct = -1;
            while (left > 0)
            {
                int n = i.Read(buf, 0, (int)Math.Min(buf.Length, left));
                if (n <= 0) throw new EndOfStreamException("게임 실행 파일을 끝까지 읽지 못했습니다.");
                o.Write(buf, 0, n);
                left -= n;
                int pct = pFrom + (int)(pSpan * (length - left) / length);
                if (pct != lastPct) { Progress(pct); lastPct = pct; }
            }
        }
    }

    void Extract7z(string archive, string dest)
    {
        List<string[]> tries = new List<string[]>(); // { label, exe, args }
        string sys = Environment.SystemDirectory;
        string winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string a = Quote(archive), d = Quote(dest);
        foreach (string tar in new string[] { Path.Combine(sys, "tar.exe"), Path.Combine(winDir, @"Sysnative\tar.exe") })
            if (File.Exists(tar)) { tries.Add(new string[] { "Windows tar", tar, "-xf " + a + " -C " + d }); break; }

        List<string> pf = new List<string>();
        foreach (string v in new string[] { Environment.GetEnvironmentVariable("ProgramW6432"),
                                            Environment.GetEnvironmentVariable("ProgramFiles"),
                                            Environment.GetEnvironmentVariable("ProgramFiles(x86)") })
            if (!string.IsNullOrEmpty(v) && !pf.Contains(v)) pf.Add(v);
        foreach (string root in pf)
        {
            string z = Path.Combine(root, @"7-Zip\7z.exe");
            if (File.Exists(z)) { tries.Add(new string[] { "7-Zip", z, "x -y -o" + d + " " + a }); break; }
        }
        string bzEnv = Environment.GetEnvironmentVariable("BANDIZIP");
        List<string> bzs = new List<string>();
        if (!string.IsNullOrEmpty(bzEnv)) bzs.Add(bzEnv);
        foreach (string root in pf) bzs.Add(Path.Combine(root, @"Bandizip\bz.exe"));
        foreach (string bz in bzs)
            if (File.Exists(bz)) { tries.Add(new string[] { "Bandizip", bz, "x -y -o:" + d + " " + a }); break; }

        if (tries.Count == 0)
            throw new InvalidOperationException("7z 압축을 풀 도구가 없습니다. Windows 11의 tar.exe, 7-Zip 또는 Bandizip이 필요합니다.");

        StringBuilder errors = new StringBuilder();
        foreach (string[] t in tries)
        {
            Log("  압축 해제 도구: " + t[0] + " (" + t[1] + ")");
            string output;
            int code = Run(t[1], t[2], out output);
            if (code == 0 && File.Exists(Path.Combine(dest, @"resources\app.asar"))) return;
            string msg = t[0] + " 실패 (종료 코드 " + code + ")" + (output.Length > 0 ? ": " + Trim(output, 400) : "");
            Log("  " + msg);
            errors.AppendLine(msg);
        }
        throw new InvalidOperationException("app-64.7z 압축 해제 실패.\n" + errors +
            "\nWindows 10이라면 7-Zip(https://7-zip.org) 또는 Bandizip을 설치한 뒤 다시 시도하세요.");
    }

    static int Run(string exe, string args, out string output)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exe, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        StringBuilder sb = new StringBuilder();
        object gate = new object();
        using (Process p = new Process())
        {
            p.StartInfo = psi;
            DataReceivedEventHandler h = delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                lock (gate) { if (sb.Length < 8000) sb.AppendLine(e.Data); }
            };
            p.OutputDataReceived += h;
            p.ErrorDataReceived += h;
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            lock (gate) output = sb.ToString().Trim();
            return p.ExitCode;
        }
    }

    // ---------- helpers: ASAR ----------

    // ASAR = Pickle header: uint32 4, uint32 headerSize, uint32 payload, uint32 jsonLen, json.
    // File data starts at 8 + headerSize; node.offset (string) is relative to that.
    int ExtractAsar(string asarPath, string destDir, int pFrom, int pSpan)
    {
        string destFull = Path.GetFullPath(destDir).TrimEnd('\\') + "\\";
        string unpackedRoot = asarPath + ".unpacked";
        using (FileStream fs = new FileStream(asarPath, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
        {
            byte[] head = new byte[16];
            ReadExact(fs, head, 16);
            uint hdrSize = BitConverter.ToUInt32(head, 4);
            int jsonLen = (int)BitConverter.ToUInt32(head, 12);
            long dataBase = 8 + (long)hdrSize;
            byte[] json = new byte[jsonLen];
            ReadExact(fs, json, jsonLen);
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = int.MaxValue;
            js.RecursionLimit = 1000;
            Dictionary<string, object> root = js.DeserializeObject(Encoding.UTF8.GetString(json)) as Dictionary<string, object>;
            if (root == null) throw new InvalidDataException("app.asar 헤더를 읽지 못했습니다.");

            List<KeyValuePair<string, Dictionary<string, object>>> files = new List<KeyValuePair<string, Dictionary<string, object>>>();
            Collect(root, "", files);
            Directory.CreateDirectory(destDir);
            byte[] buf = new byte[1 << 20];
            int done = 0;
            foreach (KeyValuePair<string, Dictionary<string, object>> f in files)
            {
                string rel = f.Key;
                Dictionary<string, object> node = f.Value;
                string outPath = Path.GetFullPath(Path.Combine(destDir, rel));
                if (!outPath.StartsWith(destFull, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("app.asar에 잘못된 경로가 있습니다: " + rel);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath));

                if (node.ContainsKey("link"))
                {
                    Log("  (심볼릭 링크 건너뜀: " + rel + ")");
                }
                else if (node.ContainsKey("unpacked") && Convert.ToBoolean(node["unpacked"]))
                {
                    string src = Path.Combine(unpackedRoot, rel);
                    if (File.Exists(src)) File.Copy(src, outPath, true);
                    else Log("  (unpacked 파일 없음: " + rel + ")");
                }
                else
                {
                    long size = node.ContainsKey("size") ? Convert.ToInt64(node["size"]) : 0;
                    long offset = node.ContainsKey("offset") ? Convert.ToInt64(node["offset"]) : 0;
                    using (FileStream o = new FileStream(outPath, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                    {
                        fs.Position = dataBase + offset;
                        long left = size;
                        while (left > 0)
                        {
                            int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, left));
                            if (n <= 0) throw new EndOfStreamException("app.asar가 잘려 있습니다: " + rel);
                            o.Write(buf, 0, n);
                            left -= n;
                        }
                    }
                }
                done++;
                if ((done & 31) == 0) Progress(pFrom + pSpan * done / files.Count);
            }
            return done;
        }
    }

    static void Collect(Dictionary<string, object> node, string rel, List<KeyValuePair<string, Dictionary<string, object>>> outList)
    {
        Dictionary<string, object> children = node.ContainsKey("files") ? node["files"] as Dictionary<string, object> : null;
        if (children == null)
        {
            outList.Add(new KeyValuePair<string, Dictionary<string, object>>(rel, node));
            return;
        }
        foreach (KeyValuePair<string, object> c in children)
        {
            string name = c.Key;
            if (name.Length == 0 || name == "." || name == ".." || name.IndexOfAny(new char[] { '/', '\\', ':' }) >= 0 ||
                name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new InvalidDataException("app.asar에 잘못된 파일 이름이 있습니다: " + name);
            Dictionary<string, object> child = c.Value as Dictionary<string, object>;
            if (child == null) continue;
            Collect(child, rel.Length == 0 ? name : rel + "\\" + name, outList);
        }
    }

    static void ReadExact(Stream s, byte[] buf, int len)
    {
        int off = 0;
        while (off < len)
        {
            int n = s.Read(buf, off, len - off);
            if (n <= 0) throw new EndOfStreamException();
            off += n;
        }
    }

    // ---------- helpers: payload / package.json / launcher ----------

    static string ReadResourceText(string name)
    {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) return null;
            using (StreamReader r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
        }
    }

    static byte[] ReadResourceBytes(string name)
    {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) return null;
            MemoryStream ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
    }

    static int WriteResources(string prefix, string destDir, bool required)
    {
        int n = 0;
        Directory.CreateDirectory(destDir);
        foreach (string name in Assembly.GetExecutingAssembly().GetManifestResourceNames())
        {
            if (!name.StartsWith(prefix, StringComparison.Ordinal)) continue;
            string rel = name.Substring(prefix.Length).Replace('/', '\\');
            string outPath = Path.Combine(destDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(outPath));
            File.WriteAllBytes(outPath, ReadResourceBytes(name));
            n++;
        }
        if (required && n == 0) throw new InvalidOperationException("설치기에 내장 파일이 없습니다: " + prefix + " (빌드 오류)");
        return n;
    }

    void PatchPackageJson(string path)
    {
        string text = File.ReadAllText(path); // detects/strips BOM
        Regex re = new Regex("\"main\"\\s*:\\s*\"(?:[^\"\\\\]|\\\\.)*\"");
        if (!re.IsMatch(text)) throw new InvalidDataException("package.json에 \"main\" 항목이 없습니다.");
        text = re.Replace(text, "\"main\": \"modloader/main.js\"", 1);
        File.WriteAllText(path, text, new UTF8Encoding(false));
        Log("  package.json main → modloader/main.js");
    }

    // Compile the launcher with the game's own icon when possible (CodeDom -> csc.exe that ships
    // with .NET Framework 4); fall back to the prebuilt launcher embedded in this installer.
    string BuildLauncher(string tmpDir, string icon)
    {
        string outExe = Path.Combine(tmpDir, "Incredibox_steam.exe");
        string source = ReadResourceText(ResPrefix + "launcher/IncrediboxLauncher.cs");
        if (source != null)
        {
            try
            {
                CompilerParameters cp = new CompilerParameters();
                cp.GenerateExecutable = true;
                cp.OutputAssembly = outExe;
                cp.ReferencedAssemblies.Add("System.dll");
                cp.ReferencedAssemblies.Add("System.Windows.Forms.dll");
                cp.CompilerOptions = "/target:winexe /optimize+";
                if (File.Exists(icon)) cp.CompilerOptions += " /win32icon:" + Quote(icon);
                cp.TempFiles = new TempFileCollection(tmpDir, false);
                using (CSharpCodeProvider provider = new CSharpCodeProvider())
                {
                    CompilerResults res = provider.CompileAssemblyFromSource(cp, source);
                    if (!res.Errors.HasErrors && IsLauncher(outExe))
                    {
                        Log("  런처 빌드 완료 (게임 아이콘 적용)");
                        return outExe;
                    }
                    if (res.Errors.Count > 0) Log("  런처 빌드 실패: " + res.Errors[0].ErrorText);
                }
            }
            catch (Exception ex)
            {
                Log("  런처 빌드 실패: " + ex.Message);
            }
        }
        byte[] prebuilt = ReadResourceBytes(ResPrefix + "launcher/Incredibox_steam.exe");
        if (prebuilt == null) throw new InvalidOperationException("내장 런처가 없습니다 (빌드 오류).");
        File.WriteAllBytes(outExe, prebuilt);
        if (!IsLauncher(outExe)) throw new InvalidOperationException("내장 런처가 올바르지 않습니다.");
        Log("  내장 런처 사용 (기본 아이콘)");
        return outExe;
    }

    // ---------- helpers: misc ----------

    static void DeleteDir(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            File.SetAttributes(f, FileAttributes.Normal);
        Directory.Delete(dir, true);
    }

    static string Quote(string s) { return "\"" + s.TrimEnd('\\') + "\""; }

    static string Trim(string s, int max)
    {
        s = s.Replace("\r", "").Replace("\n", " | ");
        return s.Length <= max ? s : s.Substring(0, max) + "…";
    }
}

// ----------------------------------------------------------------------------------------------
// Dark theme
// ----------------------------------------------------------------------------------------------
static class Theme
{
    public static readonly Color Bg = Color.FromArgb(30, 30, 32);
    public static readonly Color Surface = Color.FromArgb(43, 43, 46);
    public static readonly Color Sunken = Color.FromArgb(22, 22, 24);
    public static readonly Color Border = Color.FromArgb(70, 70, 76);
    public static readonly Color Text = Color.FromArgb(232, 232, 236);
    public static readonly Color Muted = Color.FromArgb(150, 150, 158);
    public static readonly Color Accent = Color.FromArgb(56, 132, 244);
    public static readonly Color AccentHover = Color.FromArgb(82, 150, 250);
    public static readonly Color ButtonHover = Color.FromArgb(58, 58, 63);

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr hwnd, string app, string idList);

    // Dark title bar (Windows 10 20H1+ uses attribute 20, older builds 19).
    public static void DarkTitleBar(IntPtr hwnd)
    {
        int on = 1;
        try { if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4); }
        catch { }
    }

    // Dark scrollbars on multiline text boxes.
    public static void DarkScrollbars(Control c)
    {
        try { SetWindowTheme(c.Handle, "DarkMode_Explorer", null); } catch { }
    }

    public static void StyleButton(Button b, bool primary)
    {
        b.FlatStyle = FlatStyle.Flat;
        b.UseVisualStyleBackColor = false;
        b.BackColor = primary ? Accent : Surface;
        b.ForeColor = primary ? Color.White : Text;
        b.FlatAppearance.BorderColor = primary ? Accent : Border;
        b.FlatAppearance.MouseOverBackColor = primary ? AccentHover : ButtonHover;
        b.FlatAppearance.MouseDownBackColor = primary ? Accent : Border;
        b.Cursor = Cursors.Hand;
    }
}

// Flat progress bar (the native one cannot be recoloured). Value -1 = marquee.
class DarkProgress : Control
{
    int value;
    int marqueePos;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();

    public DarkProgress()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        timer.Interval = 30;
        timer.Tick += delegate { marqueePos = (marqueePos + 6) % Math.Max(1, Width + Width / 3); Invalidate(); };
    }

    public int Value
    {
        get { return value; }
        set
        {
            this.value = value;
            if (value < 0) { if (!timer.Enabled) { marqueePos = 0; timer.Start(); } }
            else timer.Stop();
            Invalidate();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        Rectangle r = ClientRectangle;
        using (SolidBrush bg = new SolidBrush(Theme.Sunken)) g.FillRectangle(bg, r);
        using (SolidBrush fill = new SolidBrush(Theme.Accent))
        {
            if (value < 0)
            {
                int w = Math.Max(20, r.Width / 3);
                g.FillRectangle(fill, new Rectangle(marqueePos - w, 0, w, r.Height));
            }
            else if (value > 0)
            {
                g.FillRectangle(fill, new Rectangle(0, 0, r.Width * Math.Min(100, value) / 100, r.Height));
            }
        }
        using (Pen border = new Pen(Theme.Border)) g.DrawRectangle(border, 0, 0, r.Width - 1, r.Height - 1);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) timer.Dispose();
        base.Dispose(disposing);
    }
}

// ----------------------------------------------------------------------------------------------
// Window
// ----------------------------------------------------------------------------------------------
class MainForm : Form
{
    TextBox gameDirBox, logBox;
    Label statusLabel;
    CheckBox launcherCheck;
    Button browseBtn, installBtn, uninstallBtn, modsBtn;
    DarkProgress progress;
    bool busy;

    public MainForm()
    {
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Malgun Gothic", 9F);
        BackColor = Theme.Bg;
        ForeColor = Theme.Text;
        Text = "Incredibox ModLoader 설치기";
        ClientSize = new Size(620, 500);
        MinimumSize = new Size(560, 420);
        StartPosition = FormStartPosition.CenterScreen;

        TableLayoutPanel root = new TableLayoutPanel();
        root.Dock = DockStyle.Fill;
        root.Padding = new Padding(12);
        root.ColumnCount = 1;
        root.RowCount = 7;
        for (int i = 0; i < 6; i++) root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));

        Label title = new Label();
        title.AutoSize = true;
        title.Font = new Font(Font.FontFamily, 13F, FontStyle.Bold);
        title.Text = "Incredibox ModLoader v" + (Installer.EmbeddedLoaderVersion() ?? "?");
        title.Margin = new Padding(0, 0, 0, 2);
        root.Controls.Add(title);

        Label sub = new Label();
        sub.AutoSize = true;
        sub.ForeColor = Theme.Muted;
        sub.Text = "Steam판 Incredibox에 모드 로더를 설치합니다. 게임을 닫은 상태에서 [설치]를 누르세요.";
        sub.Margin = new Padding(0, 0, 0, 10);
        root.Controls.Add(sub);

        TableLayoutPanel row = new TableLayoutPanel();
        row.AutoSize = true;
        row.Dock = DockStyle.Fill;
        row.ColumnCount = 3;
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.Margin = new Padding(0);
        Label gl = new Label();
        gl.Text = "게임 폴더";
        gl.AutoSize = true;
        gl.Anchor = AnchorStyles.Left;
        gameDirBox = new TextBox();
        gameDirBox.ReadOnly = true;
        gameDirBox.Dock = DockStyle.Fill;
        gameDirBox.BorderStyle = BorderStyle.FixedSingle;
        gameDirBox.BackColor = Theme.Surface;
        gameDirBox.ForeColor = Theme.Text;
        gameDirBox.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        browseBtn = MakeButton("찾아보기...", delegate { Browse(); });
        row.Controls.Add(gl, 0, 0);
        row.Controls.Add(gameDirBox, 1, 0);
        row.Controls.Add(browseBtn, 2, 0);
        root.Controls.Add(row);

        statusLabel = new Label();
        statusLabel.AutoSize = true;
        statusLabel.Margin = new Padding(3, 8, 3, 8);
        root.Controls.Add(statusLabel);

        launcherCheck = new CheckBox();
        launcherCheck.AutoSize = true;
        launcherCheck.Checked = true;
        launcherCheck.FlatStyle = FlatStyle.Flat;
        launcherCheck.FlatAppearance.BorderColor = Theme.Border;
        launcherCheck.FlatAppearance.CheckedBackColor = Theme.Accent;
        launcherCheck.BackColor = Theme.Bg;
        launcherCheck.ForeColor = Theme.Text;
        launcherCheck.Text = "Steam ▶ 플레이로 모드 로더 실행 (런처 설치, 권장 — Shift 누르고 실행하면 원본 게임)";
        root.Controls.Add(launcherCheck);

        FlowLayoutPanel buttons = new FlowLayoutPanel();
        buttons.AutoSize = true;
        buttons.Dock = DockStyle.Fill;
        buttons.Margin = new Padding(0, 6, 0, 6);
        installBtn = MakeButton("설치 / 업데이트", delegate { Run(true); });
        installBtn.Font = new Font(Font, FontStyle.Bold);
        Theme.StyleButton(installBtn, true);
        uninstallBtn = MakeButton("제거 (원본 복원)", delegate { Run(false); });
        modsBtn = MakeButton("Mods 폴더 열기", delegate { OpenMods(); });
        buttons.Controls.Add(installBtn);
        buttons.Controls.Add(uninstallBtn);
        buttons.Controls.Add(modsBtn);
        root.Controls.Add(buttons);

        TableLayoutPanel bottom = new TableLayoutPanel();
        bottom.Dock = DockStyle.Fill;
        bottom.ColumnCount = 1;
        bottom.RowCount = 2;
        bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        bottom.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        bottom.Margin = new Padding(0);
        progress = new DarkProgress();
        progress.Dock = DockStyle.Fill;
        progress.Height = 8;
        progress.Margin = new Padding(0, 0, 0, 6);
        logBox = new TextBox();
        logBox.Multiline = true;
        logBox.ReadOnly = true;
        logBox.ScrollBars = ScrollBars.Vertical;
        logBox.Dock = DockStyle.Fill;
        logBox.BorderStyle = BorderStyle.FixedSingle;
        logBox.BackColor = Theme.Sunken;
        logBox.ForeColor = Theme.Text;
        logBox.Font = new Font("Consolas", 9F);
        logBox.HandleCreated += delegate { Theme.DarkScrollbars(logBox); };
        bottom.Controls.Add(progress, 0, 0);
        bottom.Controls.Add(logBox, 0, 1);
        root.Controls.Add(bottom);

        Controls.Add(root);
        ResumeLayout(false);
        PerformLayout();

        string found = Installer.FindGameDir();
        if (found != null) gameDirBox.Text = found;
        RefreshStatus();
        ActiveControl = installBtn;
        if (found == null) AppendLog("Steam 라이브러리에서 Incredibox를 찾지 못했습니다. [찾아보기...]로 게임 폴더를 선택하세요.");
    }

    Button MakeButton(string text, EventHandler onClick)
    {
        Button b = new Button();
        b.Text = text;
        b.AutoSize = true;
        b.Padding = new Padding(8, 3, 8, 3);
        b.Click += onClick;
        Theme.StyleButton(b, false);
        return b;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Theme.DarkTitleBar(Handle);
    }

    void Browse()
    {
        using (FolderBrowserDialog d = new FolderBrowserDialog())
        {
            d.Description = "Incredibox 설치 폴더를 선택하세요 (Incredibox_steam.exe가 있는 폴더).\n" +
                            "Steam 라이브러리 → Incredibox → 관리 → 로컬 파일 보기로 찾을 수 있습니다.";
            d.ShowNewFolderButton = false;
            if (gameDirBox.Text.Length > 0) d.SelectedPath = gameDirBox.Text;
            if (d.ShowDialog(this) != DialogResult.OK) return;
            if (!Installer.IsGameDir(d.SelectedPath))
            {
                MessageBox.Show(this, "이 폴더에 Incredibox_steam.exe가 없습니다.\n" + d.SelectedPath, Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            gameDirBox.Text = d.SelectedPath;
            RefreshStatus();
        }
    }

    void RefreshStatus()
    {
        bool ok = Installer.IsGameDir(gameDirBox.Text);
        statusLabel.Text = ok ? Installer.DescribeStatus(gameDirBox.Text) : "게임 폴더를 선택하세요.";
        installBtn.Enabled = ok && !busy;
        uninstallBtn.Enabled = ok && !busy && Installer.IsLauncher(Path.Combine(gameDirBox.Text, "Incredibox_steam.exe"));
        modsBtn.Enabled = ok && Directory.Exists(Path.Combine(gameDirBox.Text, @"Modded\Mods"));
        browseBtn.Enabled = !busy;
        launcherCheck.Enabled = !busy;
    }

    void OpenMods()
    {
        string mods = Path.Combine(gameDirBox.Text, @"Modded\Mods");
        if (Directory.Exists(mods)) Process.Start("explorer.exe", "\"" + mods + "\"");
    }

    void Run(bool install)
    {
        if (busy) return;
        string gameDir = gameDirBox.Text;
        bool launcher = launcherCheck.Checked;
        if (!install && MessageBox.Show(this,
                "Incredibox_steam.exe를 원본으로 되돌립니다.\nModded 폴더(모드와 APK 저장 데이터)는 그대로 남습니다.\n계속할까요?",
                Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

        busy = true;
        RefreshStatus();
        logBox.Clear();
        SetProgress(0);

        Installer inst = new Installer();
        inst.Log = delegate(string s) { BeginInvoke(new Action<string>(AppendLog), s); };
        inst.Progress = delegate(int p) { BeginInvoke(new Action<int>(SetProgress), p); };

        Thread t = new Thread(delegate()
        {
            Exception error = null;
            try
            {
                if (install) inst.Install(gameDir, null, launcher);
                else inst.Uninstall(gameDir);
            }
            catch (Exception ex) { error = ex; }
            BeginInvoke(new Action(delegate { Finish(install, error); }));
        });
        t.IsBackground = true;
        t.Start();
    }

    void Finish(bool install, Exception error)
    {
        busy = false;
        RefreshStatus();
        if (error != null)
        {
            SetProgress(0);
            string msg = error.Message;
            if (error is UnauthorizedAccessException)
                msg += "\n\n게임 폴더에 쓸 권한이 없습니다. 설치기를 마우스 오른쪽 버튼 → '관리자 권한으로 실행'으로 다시 실행해 보세요.";
            AppendLog("오류: " + msg);
            MessageBox.Show(this, msg, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        SetProgress(100);
        if (install)
            MessageBox.Show(this,
                "설치 완료!\n\nSteam에서 Incredibox를 ▶ 플레이하세요.\n왼쪽 아래에 ModLoader 배지가 보이면 성공입니다 (F10 = 모드 목록).",
                Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    void SetProgress(int p)
    {
        progress.Value = p < 0 ? -1 : Math.Max(0, Math.Min(100, p));
    }

    void AppendLog(string s)
    {
        logBox.AppendText(s.Replace("\n", "\r\n") + "\r\n");
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (busy && e.CloseReason == CloseReason.UserClosing)
        {
            MessageBox.Show(this, "설치가 끝날 때까지 기다려 주세요.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            e.Cancel = true;
            return;
        }
        base.OnFormClosing(e);
    }
}
