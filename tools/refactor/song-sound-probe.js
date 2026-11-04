// Switch version's sound in the library and the file (2026-11-03): on the stand the library takes
// it and the user's own music files are never written (a bench run). Run with --probe.
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args ?? {});
const song = D.queue[2].split(':')[0];
const sound = { semitones: -3, keepPitch: false, reverb: 0.4, size: 'vast' };
const before = await invoke('song_sounds');
const saved = await invoke('song_sound_set', { songId: song, sound, writeFile: true });
const after = await invoke('song_sounds');
const removed = await invoke('song_sound_set', { songId: song, sound: null, writeFile: true });
const end = await invoke('song_sounds');
return {
  before: Object.keys(before).length,
  saved,
  kept: JSON.stringify(after[song]) === JSON.stringify(sound),
  removed,
  afterRemove: song in end
};
