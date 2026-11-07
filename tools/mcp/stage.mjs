// Puts nemora-mcp.exe where the installer build takes it from (PLAN/22 P22.5): builds it in
// release and copies it to apps/desktop/src-tauri/binaries/nemora-mcp-<target triple>.exe, the
// name tauri's bundle.externalBin expects. The installer then ships it beside nemora.exe as
// nemora-mcp.exe. Only installer builds use it (src-tauri/tauri.mcp.json); a plain build does not
// need the file, because tauri-build checks externalBin on every Rust build.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

const host = /^host:\s*(\S+)/m.exec(run('rustc', ['-vV']))?.[1];
if (!host) throw new Error('rustc -vV printed no host triple');
const ext = process.platform === 'win32' ? '.exe' : '';

execFileSync('cargo', ['build', '--release', '--locked', '-p', 'nemora-mcp'], { cwd: root, stdio: 'inherit' });

const built = join(root, 'target', 'release', `nemora-mcp${ext}`);
const dir = join(root, 'apps', 'desktop', 'src-tauri', 'binaries');
const staged = join(dir, `nemora-mcp-${host}${ext}`);
mkdirSync(dir, { recursive: true });
copyFileSync(built, staged);
console.log(`[stage:mcp] ${staged} (${Math.round(statSync(staged).size / 1024)} KiB)`);
