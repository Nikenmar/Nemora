// PLAN/21 P21.6: the Smart Shuffle order's shadow in the app, on the stand's copy of the real
// profile. Turns Smart Shuffle on, shuffles the library's queue several times (the view orders it
// and asks the core for the same order) and reports the shadow log: empty when the core's port
// gave the view's order every time.
const LOG = 'nemora.shadow.megaOrder';
localStorage.removeItem(LOG);
// `--probe-widths` 1600 runs with the core's order off, 1601 with it on (nemora.megaOrder.fromCore).
const switchOn = window.innerWidth % 2 === 1;
if (switchOn) localStorage.setItem('nemora.megaOrder.fromCore', '1');
else localStorage.setItem('nemora.megaOrder.fromCore', '0');
const button = document.querySelector('.tier-shuffle-btn');
if (!button) return 'no Smart Shuffle button';
const wasOn = button.className.includes('active') || button.getAttribute('aria-pressed') === 'true';
button.click();
// The weights load for the whole library.
await wait(6000);
const songs = D.queue;
for (let i = 0; i < 8; i++) {
  S.createQueue(songs, 'songs', true, undefined, false);
  await wait(1500);
}
await wait(3000);
const log = JSON.parse(localStorage.getItem(LOG) ?? '[]');
if (!wasOn) button.click();
localStorage.removeItem('nemora.megaOrder.fromCore');
return { switchOn, shuffles: 8, songs: songs.length, shadowLog: log };
