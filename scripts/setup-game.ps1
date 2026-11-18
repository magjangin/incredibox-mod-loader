param(
  # Incredibox install dir. Default: auto-detected from Steam libraries.
  [string]$GameDir = "",
  # Where the unpacked, modded runtime goes. Default: <GameDir>\Modded
  [string]$TargetDir = "",
  # Bandizip CLI. Default: $env:BANDIZIP > Program Files > PATH
  [string]$Bandizip = ""
)

$ErrorActionPreference = "Stop"

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

if (-not $GameDir) { $GameDir = Find-IncrediboxDir }
if (-not $GameDir) { throw "Incredibox install not found via Steam. Pass -GameDir <path>." }
if (-not $TargetDir) { $TargetDir = Join-Path $GameDir "Modded" }
if (-not $Bandizip) { $Bandizip = Find-Bandizip }
if (-not $Bandizip) { throw "Bandizip (bz.exe) not found. Install Bandizip or pass -Bandizip <path>." }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SteamExe = Join-Path $GameDir "Incredibox_steam.exe"

if (-not (Test-Path $SteamExe)) {
  throw "Incredibox_steam.exe not found at $SteamExe"
}
Write-Host "GameDir:   $GameDir"
Write-Host "TargetDir: $TargetDir"
Write-Host "Bandizip:  $Bandizip"

Write-Host "[1/5] Extracting app-64.7z from Incredibox_steam.exe..."
$TempNsis = Join-Path $env:TEMP "incredibox_nsis_extract"
if (Test-Path $TempNsis) { Remove-Item -Recurse -Force $TempNsis }
& $Bandizip x -y -o:"$TempNsis" "$SteamExe" "`$PLUGINSDIR\app-64.7z" | Out-Null

$AppArchive = Join-Path $TempNsis "`$PLUGINSDIR\app-64.7z"
if (-not (Test-Path $AppArchive)) {
  throw "Failed to extract app-64.7z"
}

Write-Host "[2/5] Unpacking Electron app to $TargetDir..."
if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
}
& $Bandizip x -y -o:"$TargetDir" "$AppArchive" | Out-Null
Remove-Item -Recurse -Force $TempNsis

$ResourcesDir = Join-Path $TargetDir "resources"
$AsarPath = Join-Path $ResourcesDir "app.asar"
$AsarBak = Join-Path $ResourcesDir "app.asar.bak"
$AppDir = Join-Path $ResourcesDir "app"

Write-Host "[3/5] Unpacking resources\app.asar -> resources\app..."
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

Write-Host "[4/5] Installing ModLoader bootstrap..."
$LoaderDest = Join-Path $AppDir "modloader"
if (Test-Path $LoaderDest) { Remove-Item -Recurse -Force $LoaderDest }
Copy-Item -Recurse -Force (Join-Path $RepoRoot "modloader") $LoaderDest

$PkgPath = Join-Path $AppDir "package.json"
$Pkg = Get-Content $PkgPath -Raw | ConvertFrom-Json
$Pkg.main = "modloader/main.js"
$Pkg | ConvertTo-Json -Depth 10 | Set-Content -Path $PkgPath -Encoding UTF8

Write-Host "[5/5] Installing sample mod into $TargetDir\Mods..."
$ModsDest = Join-Path $TargetDir "Mods"
New-Item -ItemType Directory -Force -Path $ModsDest | Out-Null
$SampleDest = Join-Path $ModsDest "hello-mod"
if (-not (Test-Path $SampleDest)) {
  Copy-Item -Recurse -Force (Join-Path $RepoRoot "mods-example\hello-mod") $SampleDest
}

Write-Host "Done! Launch: $TargetDir\Incredibox.exe"
