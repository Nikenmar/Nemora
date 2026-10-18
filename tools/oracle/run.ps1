# Regenerates the oracle outputs from the 1.1.9 code.
#   tools/oracle/run.ps1 [-Old E:\tmp\nemora-hotfix] [-Name search]
# Needs a 1.1.9 checkout with node_modules installed. Outputs go to fixtures/synthetic/oracle/.
param(
  [string]$Old = 'E:\tmp\nemora-hotfix',
  [string]$Name = 'search'
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out = Join-Path $root 'target\oracle'
New-Item -ItemType Directory -Force $out | Out-Null
$esbuild = Join-Path $Old 'node_modules\esbuild\bin\esbuild'
node $esbuild (Join-Path $PSScriptRoot "$Name.ts") --bundle --platform=node --format=cjs --log-level=warning `
  "--alias:@old=$Old\src" "--outfile=$out\$Name.cjs"
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }
$fixtures = Join-Path $root 'fixtures\synthetic\oracle'
$json = node "$out\$Name.cjs" (Join-Path $fixtures "$Name-corpus.json")
if ($LASTEXITCODE -ne 0) { throw "oracle failed" }
[System.IO.File]::WriteAllText((Join-Path $fixtures "$Name-expected.json"), ($json -join "`n"), (New-Object System.Text.UTF8Encoding $false))
Write-Output "wrote fixtures/synthetic/oracle/$Name-expected.json"
