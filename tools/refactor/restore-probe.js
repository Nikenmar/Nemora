// PLAN/21 P21.4, the switch on: the core restores the view's state when the webview's storage is
// gone. Run 1 (`--label <x>`) reports each slice; then the run folder's webview storage is deleted;
// run 2 (`--label <x> --reuse`) must report the same slices, restored from the core. Slices the
// stand itself sets at each start (the queue, playback) are reported but not compared.
await wait(5000);
// Run 1 sets a value no default has; run 2 finds it already there only if the core brought it back.
const before = JSON.parse(localStorage.getItem('localStorage') ?? 'null')?.preferences?.tierShuffleIntensity;
const setNow = before !== 0.37;
if (setNow) {
  S.setPreference('tierShuffleIntensity', 0.37);
  await wait(3000);
}
const same = (value) =>
  JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${text.length}:${h.toString(16)}`;
};
const blob = JSON.parse(localStorage.getItem('localStorage') ?? 'null');
const slices = ['preferences', 'ignoredSeparateArtists', 'ignoredSongsWithFeatArtists', 'ignoredDuplicates', 'sortingStates', 'equalizerPreset', 'lyricsEditorSettings', 'duels'];
return {
  slices: Object.fromEntries(slices.map((s) => [s, blob ? hash(same(blob[s])) : null])),
  // A setting no default has, set in run 1, must come back in run 2.
  marker: blob?.preferences?.tierShuffleIntensity ?? null,
  markerWasThere: !setNow,
  shadowLog: JSON.parse(localStorage.getItem('nemora.persist.shadowLog') ?? '[]').map((e) => e.slice + ': ' + e.detail.slice(0, 300))
};
