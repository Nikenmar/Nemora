<#
.SYNOPSIS
    Runs everything that can be checked without a human looking at a screen.

.DESCRIPTION
    The unit suite proves each piece behaves on data written to make it behave.
    This runs the same code against the REAL library and a COPY of the real
    profile, which is where the interesting failures live: a cached song order
    that went stale, a folder tree rebuilt from the wrong list, statistics that
    stopped adding up.

    The profile is copied first and never written to. The music folders are
    only read.

    What it cannot check is on the "check by eye" list it prints at the end.

.PARAMETER Profile
    A Nora/Nemora profile directory. Defaults to %APPDATA%\Nora.

.PARAMETER MusicRoot
    A music folder to walk. Defaults to the first one in the profile.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\verify-release.ps1
#>
[CmdletBinding()]
param(
    [string] $Profile = (Join-Path $env:APPDATA 'Nora'),
    [string] $MusicRoot,
    [string] $WorkDir = (Join-Path $env:TEMP 'nemora-verify')
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$results = [ordered]@{}
function Step {
    param([string] $Name, [scriptblock] $Body)
    Write-Host ''
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        & $Body
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        $results[$Name] = 'PASS'
    } catch {
        $results[$Name] = "FAIL - $($_.Exception.Message)"
    }
}

# --- fixtures -------------------------------------------------------------
if (-not (Test-Path $Profile)) { throw "No profile at $Profile" }

$copy = Join-Path $WorkDir 'profile'
Remove-Item -Recurse -Force $copy -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $copy | Out-Null
Get-ChildItem $Profile -Filter *.json -File | Copy-Item -Destination $copy
Write-Host "profile copied to $copy (read-only from here on)" -ForegroundColor DarkGray

if (-not $MusicRoot) {
    $userData = Get-ChildItem $copy -Filter 'userdata.json' | Select-Object -First 1
    if ($userData) {
        $folders = (Get-Content $userData.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).userData.musicFolders
        if ($folders) { $MusicRoot = @($folders)[0].path }
    }
}
if ($MusicRoot -and (Test-Path $MusicRoot)) {
    Write-Host "music root: $MusicRoot" -ForegroundColor DarkGray
} else {
    Write-Host "music root: none found, the walk comparison will use its synthetic tree" -ForegroundColor Yellow
    $MusicRoot = $null
}

# --- checks ---------------------------------------------------------------
Step 'Unit suite (TypeScript)' { npx jest --silent }

Step 'Rust suite' { cargo test --manifest-path src-tauri/Cargo.toml --quiet }

# The repository carries 16 type errors inherited from the fork, all in
# renderer components and none introduced by the port. Demanding zero would
# make this step permanently red and therefore ignored; what matters is that
# the number has not grown.
$inheritedTypeErrors = 16
Step "Types (no more than $inheritedTypeErrors inherited errors)" {
    $output = npx tsc --noEmit -p tsconfig.web.json --composite false 2>&1
    $count = @($output | Select-String -Pattern 'error TS' -SimpleMatch).Count
    Write-Host "type errors: $count (inherited baseline $inheritedTypeErrors)"
    if ($count -gt $inheritedTypeErrors) {
        $output | Select-String -Pattern 'error TS' -SimpleMatch | Select-Object -First 20
        throw "$count type errors, up from $inheritedTypeErrors"
    }
    $global:LASTEXITCODE = 0
}

Step 'Folder tree: both walks agree on the real library' {
    if ($MusicRoot) { $env:NEMORA_WALK_ROOT = $MusicRoot }
    npx jest walkParity
    Remove-Item Env:\NEMORA_WALK_ROOT -ErrorAction SilentlyContinue
}

Step 'Library and stats on a copy of the real profile' {
    $env:NEMORA_PROFILE_FIXTURE = $copy
    npx jest realProfile.acceptance
    Remove-Item Env:\NEMORA_PROFILE_FIXTURE -ErrorAction SilentlyContinue
}

Step 'Statistics totals against the real profile' {
    $env:NORA_STATS_FIXTURE = $copy
    npx jest realProfileStats
    Remove-Item Env:\NORA_STATS_FIXTURE -ErrorAction SilentlyContinue
}

# --- report ---------------------------------------------------------------
Write-Host ''
Write-Host '================ RESULT ================' -ForegroundColor White
foreach ($name in $results.Keys) {
    $value = $results[$name]
    $colour = if ($value -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host ("{0,-46} {1}" -f $name, $value) -ForegroundColor $colour
}

$failed = @($results.Values | Where-Object { $_ -ne 'PASS' }).Count
Write-Host ''
if ($failed -gt 0) {
    Write-Host "$failed check(s) failed. Scroll up for the output." -ForegroundColor Red
} else {
    Write-Host 'Everything a machine can check is green.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'STILL NEEDS A PAIR OF EYES:' -ForegroundColor Yellow
Write-Host '  1. Dark theme    - delete a test profile, launch: the window must come up dark'
Write-Host '                     with no white flash, and Settings must still offer all three modes.'
Write-Host '  2. Cover quality - open two or three large covers full size. They are encoded'
Write-Host '                     with a faster libwebp setting now; the picture should look'
Write-Host '                     identical, the files are about 3% bigger.'
Write-Host '  3. Tag editor    - change a title and an artist on one song, save, and confirm'
Write-Host '                     the change survives a restart. Never verified since the'
Write-Host '                     native tag writer landed.'
Write-Host '  4. Battery       - unplug and confirm playback and scanning still behave.'
Write-Host '                     Never verified.'
Write-Host ''
if ($failed -gt 0) { exit 1 }
