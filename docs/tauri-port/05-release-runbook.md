# Nemora first-release runbook

This is the human-operated checklist for the first release of Nemora as a new
application on `Nikenmar/Nemora`. Stop at the first failed verification.
Commands are PowerShell 7 unless a command explicitly names another shell.
Never run these steps against the only copy of a user profile.

There is no upgrade path from the Nora CMR fork: Electron is deleted from the
repository and users download Nemora fresh. The bridge-release design was
dropped with it — the dual `latest.yml`/`latest.json` feed, the final Electron
build handing off to a Tauri installer, AUMID and taskbar-pin preservation,
and the duty to keep publishing a legacy feed. This runbook covers one plain
release of a new app: signing key, build, artifacts, one Published GitHub
release, verification at each step.

Items marked **UNVERIFIED** are release blockers, not optional polish. They
depend on installer or updater behavior that was not available to prove when
this runbook was written.

## 1. Freeze the release identity and inputs

From the repository root, choose the release version:

```powershell
$Version = '1.0.0-stable'
$Tag = "v$Version"
$Repo = 'Nikenmar/Nemora'
$ReleaseRoot = Join-Path $PWD "release\$Tag"
$NativeDir = Join-Path $ReleaseRoot 'native'
New-Item -ItemType Directory -Force $NativeDir | Out-Null

git status --short
git rev-parse HEAD
node -p "require('./package.json').version"
```

Record these invariants in the release ticket before building:

- profile (data root): `%APPDATA%\Nemora`;
- executable: `nemora.exe`;
- identifier / AUMID: `com.cmrdevs.nemora`;
- scheme: `nemora://`;
- repository/tag: `Nikenmar/Nemora`, `v1.0.0-stable`;
- data-import source: `%APPDATA%\Nora`, read-only.

**Verify:** the working tree contains only reviewed release changes, the printed
package version is exactly `$Version`, and `src-tauri/tauri.conf.json` reports
the same version, productName `Nemora`, identifier `com.cmrdevs.nemora`, and the
updater endpoint
`https://github.com/Nikenmar/Nemora/releases/latest/download/latest.json`. If any
identity differs, stop; do not "fix" it during packaging.

## 2. Generate and escrow the updater signing key once

Do this once on an offline administrative machine, not once per release. Choose
a strong password and let the command prompt for it so it never appears in shell
history.

```powershell
$KeyDir = Join-Path $env:USERPROFILE '.tauri\nemora-updater'
$PrivateKey = Join-Path $KeyDir 'nemora-updater.key'
New-Item -ItemType Directory -Force $KeyDir | Out-Null
npm exec tauri -- signer generate -w $PrivateKey
Get-ChildItem -LiteralPath $KeyDir | Select-Object Name, Length, LastWriteTime
```

The generated public-key text belongs in `plugins.updater.pubkey`; the private
key does not. Store the encrypted private key and its password as separate
access-controlled release secrets, with one offline encrypted backup and a
documented recovery owner. The private key must **never** enter this repository,
a GitHub release asset, build logs, chat, a normal `.env`, `%APPDATA%\Nemora`,
or an installer payload.

**UNVERIFIED:** confirm the exact public-key filename emitted by the pinned CLI
before copying it; the CLI help confirms `-w/--write-keys` but does not document
the companion filename. Commit only the public-key contents after two maintainers
compare its fingerprint with the escrow record.

**Verify:** `git status --short` shows no key file, the private key can be
retrieved from both escrow locations, and a throwaway file can be signed without
exposing the secret:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $PrivateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host 'Updater key password'
$Probe = Join-Path $env:TEMP 'nemora-updater-signing-probe.txt'
Set-Content -LiteralPath $Probe -Value 'Nemora updater signing probe' -Encoding utf8NoBOM
npm exec tauri -- signer sign $Probe
Get-Item "$Probe.sig" | Select-Object FullName, Length
Remove-Item -LiteralPath $Probe, "$Probe.sig"
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## 3. Build and verify the signed Tauri NSIS contract

Before running these commands, the reviewed configuration must contain the same
`$Version`, `bundle.createUpdaterArtifacts: true` (the NSIS build must emit
`.exe.sig` per architecture), the escrowed public-key contents, the HTTPS updater
endpoint, and NSIS/current-user bundle settings.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $PrivateKey
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host 'Updater key password'

npm exec tauri -- build --bundles nsis --target x86_64-pc-windows-msvc
npm exec tauri -- build --bundles nsis --target aarch64-pc-windows-msvc

$X64Bundle = 'src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis'
$Arm64Bundle = 'src-tauri\target\aarch64-pc-windows-msvc\release\bundle\nsis'
$X64Candidates = @(Get-ChildItem -LiteralPath $X64Bundle -File -Filter '*.exe')
$Arm64Candidates = @(Get-ChildItem -LiteralPath $Arm64Bundle -File -Filter '*.exe')
if ($X64Candidates.Count -ne 1 -or $Arm64Candidates.Count -ne 1) {
  throw 'Expected exactly one NSIS installer per target; clean stale bundle output and rebuild'
}
$X64Exe = $X64Candidates[0]
$Arm64Exe = $Arm64Candidates[0]
Copy-Item -LiteralPath $X64Exe.FullName (Join-Path $NativeDir "Nemora-v$Version-windows-x86_64.exe")
Copy-Item -LiteralPath "$($X64Exe.FullName).sig" (Join-Path $NativeDir "Nemora-v$Version-windows-x86_64.exe.sig")
Copy-Item -LiteralPath $Arm64Exe.FullName (Join-Path $NativeDir "Nemora-v$Version-windows-aarch64.exe")
Copy-Item -LiteralPath "$($Arm64Exe.FullName).sig" (Join-Path $NativeDir "Nemora-v$Version-windows-aarch64.exe.sig")

Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

**UNVERIFIED:** confirm the two target output directories against the pinned
Tauri CLI before the first release; custom Cargo target-dir settings can move
them. Selecting exactly one `.exe` is intentional and must fail if stale/multiple
installers exist.

**Verify:** there are exactly two architecture-specific NSIS installers and two
nonempty `.sig` files, both installers report `$Version`, and each signature was
created with the escrowed key. The pinned CLI has no `signer verify` subcommand,
so a cryptographic offline verification command or small updater verification
harness is still a **release blocker**; checking that `.sig` merely exists is not
enough. Prove a valid signature is accepted and a one-byte-modified installer and
signature are both rejected before continuing.

## 4. Generate and validate `latest.json`

Create the updater manifest from the actual copied asset names and the
**contents** of each `.sig`. The URLs are immutable same-tag asset URLs, never
`/latest`.

```powershell
$X64Name = "Nemora-v$Version-windows-x86_64.exe"
$Arm64Name = "Nemora-v$Version-windows-aarch64.exe"
$BaseUrl = "https://github.com/$Repo/releases/download/$Tag"
$LatestJson = [ordered]@{
  version = $Version
  notes = (Get-Content -Raw (Join-Path $ReleaseRoot 'release-notes.md'))
  pub_date = (Get-Date).ToUniversalTime().ToString('o')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = (Get-Content -Raw (Join-Path $NativeDir "$X64Name.sig")).Trim()
      url = "$BaseUrl/$X64Name"
    }
    'windows-aarch64' = [ordered]@{
      signature = (Get-Content -Raw (Join-Path $NativeDir "$Arm64Name.sig")).Trim()
      url = "$BaseUrl/$Arm64Name"
    }
  }
}
$LatestJson | ConvertTo-Json -Depth 6 |
  Set-Content -LiteralPath (Join-Path $NativeDir 'latest.json') -Encoding utf8NoBOM
```

```powershell
$Manifest = Get-Content -Raw (Join-Path $NativeDir 'latest.json') | ConvertFrom-Json
if ($Manifest.version -ne $Version) { throw 'latest.json version mismatch' }
foreach ($Platform in 'windows-x86_64', 'windows-aarch64') {
  $Entry = $Manifest.platforms.PSObject.Properties[$Platform].Value
  if (-not $Entry.url.StartsWith("https://github.com/$Repo/releases/download/$Tag/")) {
    throw "Mutable or wrong URL for $Platform"
  }
  if ([string]::IsNullOrWhiteSpace($Entry.signature)) { throw "Missing signature for $Platform" }
}
```

**Verify:** the manifest parses, contains exactly `windows-x86_64` and
`windows-aarch64`, uses `$Version`, each URL names the matching uploaded
installer, and each signature is byte-for-byte the trimmed `.sig` contents. Run
the cryptographic verifier from step 3 over both entries.

## 5. Verify the first-run import and the app end-to-end

On Windows 10 and 11, and on x64 plus real/emulated ARM64 where available:

1. clean install of each architecture;
2. first run against a **disposable copy** of a real `%APPDATA%\Nora` profile:
   identical library counts, listening records, statistics, tierlists, settings,
   and artwork; hash the fixture before the run and assert the sources are
   byte-identical afterwards (import must not modify `%APPDATA%\Nora`);
3. import failure cases: corrupt, busy, or partially copied sources fail closed
   and never become a default/empty install; retry after an interruption is
   idempotent;
4. Tauri-to-Tauri signed update, automatic relaunch, and bad-signature rejection;
5. Unicode/space paths, file associations, `nemora://`, second-instance routing,
   and launches before renderer readiness;
6. tray, titlebar, mini/main geometry, always-on-top, theme/battery handling,
   updater progress/consent, and signed relaunch behavior.

Record OS/architecture, hashes, screenshots, and pass/fail evidence for every
row.

## 6. Publish one GitHub release

The release contains exactly five feed assets: two architecture-specific signed
installers (`.exe` + `.sig` each) and `latest.json`. Create a remote annotated
tag first; `--verify-tag` prevents GitHub CLI from silently tagging the wrong
commit. Do not use `--draft` or `--prerelease`.

```powershell
git tag -a $Tag -m "Nemora $Version"
git push origin $Tag

$Assets = @(
  (Join-Path $NativeDir "Nemora-v$Version-windows-x86_64.exe"),
  (Join-Path $NativeDir "Nemora-v$Version-windows-x86_64.exe.sig"),
  (Join-Path $NativeDir "Nemora-v$Version-windows-aarch64.exe"),
  (Join-Path $NativeDir "Nemora-v$Version-windows-aarch64.exe.sig"),
  (Join-Path $NativeDir 'latest.json')
)
if ($Assets.Count -ne 5 -or ($Assets | Where-Object { -not (Test-Path -LiteralPath $_) })) {
  throw 'Feed asset set is incomplete'
}

gh release create $Tag $Assets --repo $Repo --verify-tag --latest `
  --title "Nemora $Version" --notes-file (Join-Path $ReleaseRoot 'release-notes.md')
```

**Verify:**

```powershell
gh release view $Tag --repo $Repo --json tagName,isDraft,isPrerelease,assets,url |
  Tee-Object -Variable PublishedRelease
$Audit = $PublishedRelease | ConvertFrom-Json
if ($Audit.tagName -ne $Tag -or $Audit.isDraft -or $Audit.isPrerelease -or
    $Audit.assets.Count -ne 5) { throw 'Published release audit failed' }
```

Then fetch every uploaded asset into a new empty audit directory, re-run
SHA-512/signature/manifest checks on the downloaded bytes, and confirm the
`latest.json` URL resolves. The release must be Published and Latest on
`Nikenmar/Nemora` before the in-app updater can see it.
