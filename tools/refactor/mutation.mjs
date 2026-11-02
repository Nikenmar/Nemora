// PLAN/21 protocol, step 1: a characterisation test that cannot fail protects nothing. Each
// mutation below breaks one tested function on purpose; the renderer tests must fail with it in
// place. The file is always restored, also on error.
//
//   node tools/refactor/mutation.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const desktop = resolve(import.meta.dirname, '../../apps/desktop');
const src = (p) => resolve(desktop, 'src/renderer/src', p);

const mutations = [
  ['megaShuffleQueue: best key last', 'other/megaShuffleQueue.ts', 'right.key - left.key', 'left.key - right.key'],
  ['megaShuffleQueue: held songs first', 'other/megaShuffleQueue.ts', 'Number(left.held) - Number(right.held)', 'Number(right.held) - Number(left.held)'],
  ['session: seeks before the first play count', 'other/listeningDataSession.ts', "if (this.facts.some((f) => f.kind === 'play'))", 'if (true)'],
  ['session: the end at the player position on finish', 'other/listeningDataSession.ts', "reason === 'finished' ? ms(this.duration)", "reason === 'finished' ? ms(this.player.currentTime)"],
  ['reducer: the song position ignored', 'other/appReducer.tsx', 'songPosition: action.data ?? state.player.songPosition', 'songPosition: state.player.songPosition'],
  ['localStorage: the blob never written', 'utils/localStorage.ts', "    localStorage.setItem('localStorage', updatedStorageString);", '    void updatedStorageString;'],
  ['smartShuffle: not-now songs first', 'other/smartShuffle.ts', '...shuffledQueue.filter((id) => !notNow.has(id)),\n    ...shuffledQueue.filter((id) => notNow.has(id))', '...shuffledQueue.filter((id) => notNow.has(id)),\n    ...shuffledQueue.filter((id) => !notNow.has(id))'],
  ['smartShuffle: skip-aware option inverted', 'other/smartShuffle.ts', 'skipAware: !p.isSkipAwareDisabled', 'skipAware: !!p.isSkipAwareDisabled']
];

let caught = 0;
for (const [name, file, from, to] of mutations) {
  const path = src(file);
  const original = readFileSync(path, 'utf8');
  const normalized = original.replace(/\r\n/g, '\n');
  if (!normalized.includes(from)) {
    console.log(`MISSING  ${name}: the text to mutate is not in ${file}`);
    process.exitCode = 1;
    continue;
  }
  try {
    writeFileSync(path, normalized.replace(from, to));
    let failed = false;
    try {
      execSync('npx vitest run', { cwd: desktop, stdio: 'pipe' });
    } catch {
      failed = true;
    }
    console.log(`${failed ? 'CAUGHT  ' : 'MISSED  '} ${name}`);
    if (failed) caught += 1;
    else process.exitCode = 1;
  } finally {
    writeFileSync(path, original);
  }
}
console.log(`MUTATION ${caught} of ${mutations.length} caught`);
