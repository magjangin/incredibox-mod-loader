// Incredibox ModLoader Launcher
//
// Installed by the installer exe (installer/) or scripts/setup-game.ps1 as <GameDir>\Incredibox_steam.exe so that the
// Steam "Play" button starts the modded runtime (<GameDir>\Modded\Incredibox.exe).
// The real Steam executable is kept as Incredibox_steam.original.exe.
//
// - Waits for the game to exit so Steam keeps tracking "running" / playtime.
// - Hold Shift while launching to start the original (vanilla) game instead.
// - If Modded\ is missing, falls back to the original with a notice.
//
// Built with the .NET Framework csc.exe (C# 5): no string interpolation.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Incredibox ModLoader Launcher")]
[assembly: AssemblyProduct("Incredibox ModLoader Launcher")]
[assembly: AssemblyDescription("Starts Modded\\Incredibox.exe instead of the original Steam executable")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program
{
    const string Title = "Incredibox ModLoader";

    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string modded = Path.Combine(Path.Combine(dir, "Modded"), "Incredibox.exe");
        string original = Path.Combine(dir, "Incredibox_steam.original.exe");

        bool wantVanilla = (Control.ModifierKeys & Keys.Shift) == Keys.Shift;
        string target;

        if (wantVanilla && File.Exists(original))
        {
            target = original;
        }
        else if (File.Exists(modded))
        {
            target = modded;
        }
        else if (File.Exists(original))
        {
            MessageBox.Show(
                "ModLoader가 설치되어 있지 않아 원본 게임으로 실행합니다.\n\n" +
                "다시 설치하려면 IncrediboxModLoader-Setup.exe(또는 scripts\\setup-game.ps1)를 실행하세요.\n(" + modded + " 없음)",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            target = original;
        }
        else
        {
            MessageBox.Show(
                "실행할 게임 파일을 찾을 수 없습니다.\n\n" + modded + "\n" + original +
                "\n\nSteam에서 '게임 파일 무결성 검사'로 원본을 복구한 뒤 설치기(IncrediboxModLoader-Setup.exe)를 다시 실행하세요.",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(target, JoinArgs(args));
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Path.GetDirectoryName(target);
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("게임 실행 실패:\n" + target + "\n\n" + ex.Message, Title,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Re-quote arguments per the MSVCRT CommandLineToArgvW rules.
    static string JoinArgs(string[] args)
    {
        StringBuilder sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
            {
                sb.Append(a);
                continue;
            }
            sb.Append('"');
            int slashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') sb.Append('\\', slashes * 2 + 1);
                else sb.Append('\\', slashes);
                slashes = 0;
                sb.Append(c);
            }
            sb.Append('\\', slashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }
}
