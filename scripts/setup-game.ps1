param(
  [string]$GameDir = "H:\steam\steamapps\common\Incredibox",
  [string]$TargetDir = "H:\steam\steamapps\common\Incredibox\Modded"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SteamExe = Join-Path $GameDir "Incredibox_steam.exe"
$Bandizip = "C:\Program Files\Bandizip\bz.exe"

if (-not (Test-Path $SteamExe)) {
  throw "Incredibox_steam.exe not found at $SteamExe"
}
if (-not (Test-Path $Bandizip)) {
  throw "Bandizip bz.exe not found at $Bandizip"
}

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
