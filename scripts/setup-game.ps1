param(
  # Incredibox install dir. Default: auto-detected from Steam libraries.
  [string]$GameDir = "",
  # Where the unpacked, modded runtime goes. Default: <GameDir>\Modded
  [string]$TargetDir = "",
  # Bandizip CLI. Default: $env:BANDIZIP > Program Files > PATH
  [string]$Bandizip = "",
  # Do not replace Incredibox_steam.exe with the ModLoader launcher.
  [switch]$NoLauncher,
  # Restore the original Incredibox_steam.exe (Steam launches vanilla again). Modded\ is kept.
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$LauncherProduct = "Incredibox ModLoader Launcher"

function Find-IncrediboxDir {
  $steamRoot = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
  if (-not $steamRoot) { return $null }
  $libs = @($steamRoot)
  $vdf = Join-Path $steamRoot "steamapps\libraryfolders.vdf"
  if (Test-Path $vdf) {
    foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
      $libs += $m.Groups[1].Value -replace '\\\\', '\'
    }
  }
  foreach ($lib in $libs) {
    $dir = Join-Path $lib "steamapps\common\Incredibox"
    if (Test-Path (Join-Path $dir "Incredibox_steam.exe")) { return [System.IO.Path]::GetFullPath($dir) }
  }
  return $null
}

function Find-Bandizip {
  $candidates = @($env:BANDIZIP)
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles "Bandizip\bz.exe" }
  if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} "Bandizip\bz.exe" }
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  $cmd = Get-Command bz.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Test-IsLauncher([string]$Path) {
  if (-not (Test-Path $Path)) { return $false }
  return (Get-Item $Path).VersionInfo.ProductName -eq $LauncherProduct
}

function Assert-GameNotRunning([string]$Dir) {
  $full = [System.IO.Path]::GetFullPath($Dir).TrimEnd('\') + '\'
  $running = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($full, [System.StringComparison]::OrdinalIgnoreCase)
  }
  if ($running) { throw "Incredibox is running ($($running[0].Path)). Close the game and try again." }
}

if (-not $GameDir) { $GameDir = Find-IncrediboxDir }
if (-not $GameDir) { throw "Incredibox install not found via Steam. Pass -GameDir <path>." }
if (-not $TargetDir) { $TargetDir = Join-Path $GameDir "Modded" }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SteamExe = Join-Path $GameDir "Incredibox_steam.exe"
$OriginalExe = Join-Path $GameDir "Incredibox_steam.original.exe"

Assert-GameNotRunning $GameDir

# ---------- Uninstall: put the original Steam executable back ----------
if ($Uninstall) {
  if (Test-IsLauncher $SteamExe) {
    if (-not (Test-Path $OriginalExe)) {
      throw "Original backup missing: $OriginalExe. Use Steam 'Verify integrity of game files' to restore it."
    }
    Remove-Item -Force $SteamExe
    Move-Item $OriginalExe $SteamExe
    Write-Host "Restored original Incredibox_steam.exe. Steam now launches the vanilla game."
  } else {
    Write-Host "Incredibox_steam.exe is already the original. Nothing to restore."
  }
  Write-Host "The modded runtime is still at $TargetDir (delete it manually if you no longer need it)."
  return
}

if (-not $Bandizip) { $Bandizip = Find-Bandizip }
if (-not $Bandizip) { throw "Bandizip (bz.exe) not found. Install Bandizip or pass -Bandizip <path>." }

# If Incredibox_steam.exe is our launcher, extract from the kept original.
# If it is a real Steam executable (first install, or Steam updated/verified the game), use it.
if (Test-IsLauncher $SteamExe) {
  if (-not (Test-Path $OriginalExe)) {
    throw "Launcher installed but $OriginalExe is missing. Use Steam 'Verify integrity of game files', then re-run."
  }
  $SourceExe = $OriginalExe
} elseif (Test-Path $SteamExe) {
  $SourceExe = $SteamExe
} else {
  throw "Incredibox_steam.exe not found at $SteamExe"
}

Write-Host "GameDir:   $GameDir"
Write-Host "TargetDir: $TargetDir"
Write-Host "Source:    $SourceExe"
Write-Host "Bandizip:  $Bandizip"

Write-Host "[1/6] Extracting app-64.7z from $(Split-Path -Leaf $SourceExe)..."
$TempNsis = Join-Path $env:TEMP "incredibox_nsis_extract"
if (Test-Path $TempNsis) { Remove-Item -Recurse -Force $TempNsis }
& $Bandizip x -y -o:"$TempNsis" "$SourceExe" "`$PLUGINSDIR\app-64.7z" | Out-Null

$AppArchive = Join-Path $TempNsis "`$PLUGINSDIR\app-64.7z"
if (-not (Test-Path $AppArchive)) {
  throw "Failed to extract app-64.7z"
}

Write-Host "[2/6] Unpacking Electron app to $TargetDir..."
if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
}
& $Bandizip x -y -o:"$TargetDir" "$AppArchive" | Out-Null
Remove-Item -Recurse -Force $TempNsis

$ResourcesDir = Join-Path $TargetDir "resources"
$AsarPath = Join-Path $ResourcesDir "app.asar"
$AsarBak = Join-Path $ResourcesDir "app.asar.bak"
$AppDir = Join-Path $ResourcesDir "app"

Write-Host "[3/6] Unpacking resources\app.asar -> resources\app..."
if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
if (Test-Path $AsarPath) {
  node (Join-Path $RepoRoot "scripts\extract-asar.js") $AsarPath $AppDir
  if (Test-Path $AsarBak) { Remove-Item -Force $AsarBak }
  Move-Item $AsarPath $AsarBak
} elseif (Test-Path $AsarBak) {
  node (Join-Path $RepoRoot "scripts\extract-asar.js") $AsarBak $AppDir
} else {
  throw "Neither app.asar nor app.asar.bak found in $ResourcesDir"
}

Write-Host "[4/6] Installing ModLoader bootstrap..."
$LoaderDest = Join-Path $AppDir "modloader"
if (Test-Path $LoaderDest) { Remove-Item -Recurse -Force $LoaderDest }
Copy-Item -Recurse -Force (Join-Path $RepoRoot "modloader") $LoaderDest

$PkgPath = Join-Path $AppDir "package.json"
$Pkg = Get-Content $PkgPath -Raw | ConvertFrom-Json
$Pkg.main = "modloader/main.js"
$Pkg | ConvertTo-Json -Depth 10 | Set-Content -Path $PkgPath -Encoding UTF8

Write-Host "[5/6] Installing sample mod into $TargetDir\Mods..."
$ModsDest = Join-Path $TargetDir "Mods"
New-Item -ItemType Directory -Force -Path $ModsDest | Out-Null
$SampleDest = Join-Path $ModsDest "hello-mod"
if (-not (Test-Path $SampleDest)) {
  Copy-Item -Recurse -Force (Join-Path $RepoRoot "mods-example\hello-mod") $SampleDest
}

# ---------- Launcher: Steam "Play" -> Modded\Incredibox.exe ----------
$DefaultTarget = [System.IO.Path]::GetFullPath((Join-Path $GameDir "Modded"))
if ($NoLauncher) {
  Write-Host "[6/6] Skipping launcher (-NoLauncher). Launch: $TargetDir\Incredibox.exe"
  return
}
if ([System.IO.Path]::GetFullPath($TargetDir) -ne $DefaultTarget) {
  Write-Warning "[6/6] Launcher only supports <GameDir>\Modded. Skipped. Launch: $TargetDir\Incredibox.exe"
  return
}

Write-Host "[6/6] Installing launcher as Incredibox_steam.exe (original kept as Incredibox_steam.original.exe)..."
$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $Csc)) { $Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $Csc)) { throw ".NET Framework 4 csc.exe not found; re-run with -NoLauncher." }

$BuildDir = Join-Path $env:TEMP "incredibox_launcher_build"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
$LauncherBuilt = Join-Path $BuildDir "Incredibox_steam.exe"
$CscArgs = @("-nologo", "-codepage:65001", "-target:winexe", "-optimize+", "-r:System.Windows.Forms.dll", "-out:$LauncherBuilt")
$Icon = Join-Path $AppDir "src\favicon.ico"
if (Test-Path $Icon) { $CscArgs += "-win32icon:$Icon" }
$CscArgs += (Join-Path $RepoRoot "launcher\IncrediboxLauncher.cs")
& $Csc @CscArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-IsLauncher $LauncherBuilt)) { throw "Launcher build failed." }

if (-not (Test-IsLauncher $SteamExe)) {
  # Real Steam executable (first install or after a Steam update): it becomes the new backup.
  if (Test-Path $OriginalExe) { Remove-Item -Force $OriginalExe }
  Move-Item $SteamExe $OriginalExe
}
Copy-Item -Force $LauncherBuilt $SteamExe
Remove-Item -Recurse -Force $BuildDir

Write-Host "Done! Steam 'Play' now starts the ModLoader ($TargetDir\Incredibox.exe)."
Write-Host "Hold Shift while launching for the original game. Undo: setup-game.ps1 -Uninstall"
