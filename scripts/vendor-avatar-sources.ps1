# Vendors the CC0 MakeHuman/MPFB2 base data (via NAVER anny) that the avatar
# baker (scripts/build-avatar-base.mjs) turns into public/models/avatar/base.glb.
#
# Source: https://github.com/naver/anny/tree/main/src/anny/data/mpfb2
# License: CC0 1.0 Universal. LICENSE.md is copied verbatim from that tree.
# The copyright holders who released the assets to CC0 (September 2020):
#   - Data Collection AB (https://www.datacollection.se)
#   - Joel Palmius
#   - Jonas Hauquier  (the MakeHuman project)
#
# Only CC0 files are vendored. The anny repository's Apache-2.0 code is NOT
# copied here (the LICENSE below covers the *data/assets* only).
param(
  [string]$OutDir = "public/models/avatar/source"
)
$ErrorActionPreference = "Stop"
$root = "https://raw.githubusercontent.com/naver/anny/main/src/anny/data/mpfb2"

$files = @(
  "LICENSE.md"
  "3dobjs/base.obj"
  "rigs/standard/rig.mixamo.json"
  "rigs/standard/weights.mixamo.json"

  "targets/macrodetails/universal-male-young-averagemuscle-maxweight.target.gz"
  "targets/macrodetails/universal-male-young-averagemuscle-minweight.target.gz"
  "targets/macrodetails/universal-male-young-maxmuscle-averageweight.target.gz"
  "targets/macrodetails/universal-male-young-minmuscle-averageweight.target.gz"

  "targets/torso/measure-waist-circ-incr.target.gz"
  "targets/torso/measure-waist-circ-decr.target.gz"
  "targets/torso/measure-hips-circ-incr.target.gz"
  "targets/torso/measure-hips-circ-decr.target.gz"
  "targets/torso/measure-shoulder-dist-incr.target.gz"
  "targets/torso/measure-shoulder-dist-decr.target.gz"
  "targets/torso/measure-bust-circ-incr.target.gz"
  "targets/torso/measure-bust-circ-decr.target.gz"
  "targets/torso/torso-scale-horiz-incr.target.gz"
  "targets/torso/torso-scale-horiz-decr.target.gz"
  "targets/torso/torso-scale-depth-incr.target.gz"
  "targets/torso/torso-scale-depth-decr.target.gz"
  "targets/torso/torso-vshape-incr.target.gz"
  "targets/torso/torso-muscle-pectoral-incr.target.gz"

  "targets/stomach/stomach-tone-incr.target.gz"
  "targets/stomach/stomach-tone-decr.target.gz"
  "targets/stomach/stomach-navel-out.target.gz"

  "targets/buttocks/buttocks-volume-incr.target.gz"
  "targets/buttocks/buttocks-volume-decr.target.gz"

  "targets/hip/hip-scale-horiz-incr.target.gz"
  "targets/hip/hip-scale-horiz-decr.target.gz"

  "targets/legs/l-upperleg-fat-incr.target.gz"
  "targets/legs/l-upperleg-fat-decr.target.gz"
  "targets/legs/r-upperleg-fat-incr.target.gz"
  "targets/legs/r-upperleg-fat-decr.target.gz"
  "targets/legs/l-lowerleg-fat-incr.target.gz"
  "targets/legs/l-lowerleg-fat-decr.target.gz"
  "targets/legs/r-lowerleg-fat-incr.target.gz"
  "targets/legs/r-lowerleg-fat-decr.target.gz"
  "targets/legs/l-upperleg-muscle-incr.target.gz"
  "targets/legs/r-upperleg-muscle-incr.target.gz"
  "targets/legs/l-lowerleg-muscle-incr.target.gz"
  "targets/legs/r-lowerleg-muscle-incr.target.gz"

  "targets/arms/l-upperarm-fat-incr.target.gz"
  "targets/arms/l-upperarm-fat-decr.target.gz"
  "targets/arms/r-upperarm-fat-incr.target.gz"
  "targets/arms/r-upperarm-fat-decr.target.gz"
  "targets/arms/l-lowerarm-fat-incr.target.gz"
  "targets/arms/l-lowerarm-fat-decr.target.gz"
  "targets/arms/r-lowerarm-fat-incr.target.gz"
  "targets/arms/r-lowerarm-fat-decr.target.gz"
  "targets/arms/l-upperarm-muscle-incr.target.gz"
  "targets/arms/r-upperarm-muscle-incr.target.gz"

  "targets/neck/neck-scale-horiz-incr.target.gz"
  "targets/neck/neck-scale-horiz-decr.target.gz"

  "targets/chin/chin-width-incr.target.gz"
  "targets/chin/chin-width-decr.target.gz"
)

$rootFolder = Join-Path (Get-Location) $OutDir

function Vendor($rel) {
  $dest = Join-Path $rootFolder ($rel -replace '/', '\')
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  try {
    Invoke-WebRequest -Uri "$root/$rel" -OutFile $dest -Headers @{ "User-Agent" = "fitwear-vendor" }
    $kb = [Math]::Round((Get-Item $dest).Length / 1KB, 1)
    Write-Host "OK  $rel ($kb KB)"
  }
  catch {
    Write-Warning "FAIL $rel : $($_.Exception.Message)"
  }
}

foreach ($f in $files) { Vendor $f }
Write-Host "`nVendored into $rootFolder"