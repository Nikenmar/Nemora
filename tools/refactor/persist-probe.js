// PLAN/21 P21.4: the persistence shadow across app restarts, on the stand's copy of the real
// profile. Run the stand three times on one run folder (`--label persist`, then `--reuse` twice);
// each run takes the next step and reports what it found.
//   1. The view's blob and the core's copy (written by the dual-write) agree, slice for slice.
//   2. After a restart, the start's shadow comparison logged nothing; the copy still agrees.
//      Then the switch is turned on for the next start.
//   3. After a restart with the switch on, the state the view runs on (read from the core) is
//      the blob of before, slice for slice. The switch is turned off again.
const STEP_KEY = 'nemora.persistProbe.step';
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args ?? {});
// As other/persistShadow.ts compares: JSON with object keys sorted.
const same = (value) =>
  JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const slices = ['preferences', 'playback', 'queue', 'ignoredSeparateArtists', 'ignoredSongsWithFeatArtists', 'ignoredDuplicates', 'sortingStates', 'equalizerPreset', 'lyricsEditorSettings', 'duels'];
const diff = (a, b) => slices.filter((s) => same(a?.[s]) !== same(b?.[s]));
const shadowLog = () => JSON.parse(localStorage.getItem('nemora.persist.shadowLog') ?? '[]');
const flagKey = 'nemora.persist.readFromCore';

// The dual-write lands a moment after the last change.
await wait(4000);
const blob = JSON.parse(localStorage.getItem('localStorage'));
const persisted = await invoke('persist_read');
const core = Object.fromEntries(Object.entries(persisted.slices).map(([slice, text]) => [slice, JSON.parse(text)]));
core.coreQueue = persisted.coreQueue;
const step = Number(localStorage.getItem(STEP_KEY) ?? '1');
const out = { step, slicesInCore: slices.filter((s) => s in core).length, differing: diff(blob, core), coreQueueSongs: core.coreQueue?.songIds.length ?? 0, blobQueueSongs: blob.queue?.queue?.length ?? 0 };
if (step === 1) {
  out.shadowLog = shadowLog();
  localStorage.setItem(STEP_KEY, '2');
  localStorage.setItem('nemora.persistProbe.blob', JSON.stringify(blob));
} else if (step === 2) {
  out.shadowLog = shadowLog();
  localStorage.setItem(flagKey, '1');
  localStorage.setItem(STEP_KEY, '3');
  localStorage.setItem('nemora.persistProbe.blob', JSON.stringify(blob));
} else {
  // The state the view started from this time came from the core; the stand's own actions since
  // (its queue, its position) changed the blob again, so the comparison is with the core now and
  // with the blob saved at the end of the run before, for the slices the stand does not touch.
  const before = JSON.parse(localStorage.getItem('nemora.persistProbe.blob'));
  const untouched = slices.filter((s) => !['queue', 'playback'].includes(s));
  out.restoredDiffering = untouched.filter((s) => same(before?.[s]) !== same(blob?.[s]));
  out.shadowLog = shadowLog();
  out.switchWasOn = localStorage.getItem(flagKey) === '1';
  localStorage.removeItem(flagKey);
  localStorage.removeItem(STEP_KEY);
}
return out;
