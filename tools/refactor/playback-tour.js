// PLAN/21 P21.5: a playback walk for the IPC trace (`--probe tools/refactor/playback-tour.js
// --ipc-trace out.json`): play from the queue, skip forward and back with the app's shortcuts,
// pause, play a song by id, so moving the playback controller and the player listeners can be
// compared call for call. Muted by the stand.
const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true }));
S.createQueue(D.queue, 'songs', false, undefined, true);
await wait(3000);
key('ArrowRight');
await wait(2500);
key('ArrowRight');
await wait(2500);
key('ArrowLeft');
await wait(2500);
S.togglePlay(false);
await wait(1000);
S.playSong(D.queue[5], true);
await wait(3000);
S.togglePlay(false);
await wait(1500);
return 'playback tour done';
