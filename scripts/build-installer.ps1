# Builds build\IncrediboxModLoader-Setup.exe: a single-file installer that embeds
# modloader\*, the sample mod and the Steam launcher (source + prebuilt).
# Needs only the .NET Framework 4 csc.exe that ships with Windows.
param(
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "build" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $Csc)) { $Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $Csc)) { throw ".NET Framework 4 csc.exe not found." }

# Version = LOADER_VERSION in modloader/main.js
$MainJs = Get-Content (Join-Path $RepoRoot "modloader\main.js") -Raw
if ($MainJs -notmatch "LOADER_VERSION\s*=\s*'([0-9]+(\.[0-9]+){1,3})'") { throw "LOADER_VERSION not found in modloader\main.js" }
$Version = $Matches[1]
$NumVersion = ($Version.Split('.') + @('0', '0', '0'))[0..3] -join '.'
Write-Host "ModLoader version: $Version"

# 1) Prebuilt launcher (fallback when the installer cannot compile one with the game icon)
$LauncherExe = Join-Path $OutDir "launcher-prebuilt.exe"
& $Csc -nologo -codepage:65001 -target:winexe -optimize+ -r:System.Windows.Forms.dll "-out:$LauncherExe" (Join-Path $RepoRoot "launcher\IncrediboxLauncher.cs")
if ($LASTEXITCODE -ne 0) { throw "Launcher build failed." }

# 2) Assembly info
$InfoCs = Join-Path $OutDir "InstallerAssemblyInfo.cs"
@"
using System.Reflection;
[assembly: AssemblyTitle("Incredibox ModLoader Installer")]
[assembly: AssemblyProduct("Incredibox ModLoader Installer")]
[assembly: AssemblyDescription("Installs Incredibox ModLoader $Version into the Steam version of Incredibox")]
[assembly: AssemblyVersion("$NumVersion")]
[assembly: AssemblyFileVersion("$NumVersion")]
[assembly: AssemblyInformationalVersion("$Version")]
"@ | Set-Content -Path $InfoCs -Encoding UTF8

# 3) Payload resources
$Res = @()
Get-ChildItem (Join-Path $RepoRoot "modloader") -File | ForEach-Object { $Res += "-resource:$($_.FullName),payload/modloader/$($_.Name)" }
Get-ChildItem (Join-Path $RepoRoot "mods-example\hello-mod") -File | ForEach-Object { $Res += "-resource:$($_.FullName),payload/mods/hello-mod/$($_.Name)" }
$Res += "-resource:$(Join-Path $RepoRoot 'launcher\IncrediboxLauncher.cs'),payload/launcher/IncrediboxLauncher.cs"
$Res += "-resource:$LauncherExe,payload/launcher/Incredibox_steam.exe"

# 4) Installer
$Setup = Join-Path $OutDir "IncrediboxModLoader-Setup.exe"
$CscArgs = @("-nologo", "-codepage:65001", "-target:winexe", "-optimize+",
  "-r:System.Windows.Forms.dll", "-r:System.Drawing.dll", "-r:System.Web.Extensions.dll",
  "-out:$Setup") + $Res + @($InfoCs, (Join-Path $RepoRoot "installer\IncrediboxModLoaderInstaller.cs"))
& $Csc @CscArgs
if ($LASTEXITCODE -ne 0) { throw "Installer build failed." }

Remove-Item -Force $InfoCs, $LauncherExe
Write-Host "Built: $Setup ($([math]::Round((Get-Item $Setup).Length / 1KB)) KB)"
