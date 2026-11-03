// PLAN/21 P21.3: render counts. A fixed walk that changes preferences and does ordinary things,
// counting React component renders after each step (`shots.mjs --probe tools/refactor/render-tour.js
// --render-count`). The same tour on the build before and after a change shows what it saved.
const R = window.__renders;
if (!R) return 'no render counter: run with --render-count';
const out = {};
const step = async (name, act, settle = 900) => {
  await wait(600);
  R.reset();
  await act();
  await wait(settle);
  out[name] = R.total;
};
const pages = ['Songs', 'Home', 'Settings', 'Lyrics'];
for (const page of pages) {
  S.go(page);
  await wait(1500);
  // Preferences most components never read: each change counts the components that re-render.
  await step(`${page}: shuffle intensity`, () => S.setPreference('tierShuffleIntensity', 0.3));
  await step(`${page}: shuffle intensity back`, () => S.setPreference('tierShuffleIntensity', 0.6));
  await step(`${page}: track numbers`, () => S.setPreference('showTrackNumberAsSongIndex', true));
  await step(`${page}: track numbers back`, () => S.setPreference('showTrackNumberAsSongIndex', false));
  await step(`${page}: remaining time`, () => S.setPreference('showSongRemainingTime', true));
  await step(`${page}: remaining time back`, () => S.setPreference('showSongRemainingTime', false));
}
// Ordinary use, which no preference narrowing should change.
S.go('Songs');
await wait(1500);
await step('seek', () => S.updateSongPosition(30));
await step('play', () => S.togglePlay(true), 2000);
await step('pause', () => S.togglePlay(false));
return out;
