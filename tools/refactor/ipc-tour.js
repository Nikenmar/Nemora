// PLAN/21 protocol: the IPC tour. A fixed walk through the app for the stand to record the
// commands it sends (`shots.mjs --probe tools/refactor/ipc-tour.js --ipc-trace out.json`, read from
// outside over CDP Network); `ipc-diff.mjs` compares two such traces. The Tauri bridge itself is
// frozen (non-writable), so nothing is recorded from inside the page.
const pages = ['Home', 'Songs', 'Artists', 'Albums', 'Playlists', 'Genres', 'Folders', 'Stats', 'Tierlists', 'Settings', 'Lyrics', 'CurrentQueue', 'TasteMap'];
try {
  for (const page of pages) {
    S.go(page);
    await wait(1500);
  }
  S.go('Search', { keyword: 'better men' });
  await wait(1500);
  S.go('Search', { keyword: 'mushku tensei' });
  await wait(1500);
  document.querySelector('.sound-btn')?.click();
  await wait(500);
  document.querySelector('.sound-btn')?.click();
  await wait(300);
  S.go('SmartList', { list: 'mix' });
  await wait(1500);
} finally {
  // Ends where it is and lets the page settle: a navigation here would be half recorded.
  await wait(2000);
}
return 'tour done';
