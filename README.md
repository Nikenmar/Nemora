<div align="center">

<img src="resources/banner.png" alt="Nemora Player" width="720">

### A feature-rich music player

Built with Rust, Tauri and React / Based on [Nora](https://github.com/Sandakan/Nora)

<a href="https://github.com/Nikenmar/Nemora/releases/latest">
  <img alt="Download Nemora for Windows" src="https://img.shields.io/github/v/release/Nikenmar/Nemora?style=for-the-badge&label=Download%20for%20Windows&labelColor=212226&color=4C8DD9">
</a>

</div>

> [!NOTE]
> New to the player? Nemora keeps Nora's core, so [Nora's page](https://github.com/Sandakan/Nora) covers the basics, what it does and how it feels to use. What follows is what Nemora adds and changes.

## 🆕 Nemora 2.0

Nemora 2.0 is a rewrite underneath the same player. Your library, listening history, tierlists and duel ratings now live in one database kept by a Rust core, and music plays through Nemora's own audio engine instead of the webview's.

- **Bit-perfect at full volume.** The engine decodes every file itself. At full volume with the equalizer flat, a file at the device's sample rate reaches Windows sample for sample; a file at another rate goes through Nemora's own high-quality resampler rather than Windows'. It plays in shared mode, so other apps keep their sound.
- **Gapless.** One track runs into the next without a gap, so live albums and mixes play the way they were cut.
- **Speed that keeps the pitch.** Slow a track down or speed it up and it stays in key, and the change applies at once.
- **Seeking lands on the exact moment you pick.**
- **Songs keep their history.** A song is recognised by its audio, not by its file path or its tags, so editing tags, renaming the file or moving it to another folder keeps every listen, rating and tierlist place.

The first start of 2.0 imports the library and statistics of a 1.x install. The 1.x files are left untouched, but going back to 1.x afterwards is not supported.

## ✨ Features

### Tierlists

![Tierlist editor](/resources/features/tierlists.webp)

A built-in tierlist editor: drag your songs into tiers, then play a tierlist the same way you'd play a playlist. Your rankings also feed the smart shuffle, so the music you rated highest comes around more often.

### Statistics

![Statistics tab](/resources/features/statistics.webp)

A statistics tab that actually goes deep: listens, skips, hours played, month-by-month activity, listening streaks, and a heatmap of every day you've listened. Pick a year and the page follows it, while the figures that are all-time by nature say so instead of pretending. Two more charts read the shape of your listening rather than its size: which hours of the day you play music, and which days of the week.

**Recap** turns a year or a month into a short slideshow: what you played most, the artist you kept returning to, the day you played more than any other, something you discovered and then wore out. It skips whatever it has nothing to say about.

And it exports. Your whole history travels to another machine in a single file, and importing the same file twice cannot double a single listen.

### Duels & SongGuessr

![Duels and SongGuessr](/resources/features/duels-songguessr.webp)

The most fun part!

**Duels** ask one question at a time: which of these two do you like more? Every answer moves an ELO rating, the same system chess uses, so your library slowly sorts itself by what you actually pick rather than by what you claim to like. Those ratings feed the smart shuffle too.

**Tournaments** take the same question and give it stakes: seed 8, 16 or 32 tracks by their current rating and play the bracket down to one winner. The matches are ordinary duels, so a tournament moves the same ratings everything else reads, and the bracket remembers who beat whom.

**SongGuessr** is Songless in your player, played on your own library. A track opens with a tenth of a second. Name it, or skip for a longer clip: 0.1s, 0.5s, 1s, 3s, 6s, 12s, six tries in all, with a streak counting how many you've landed in a row. Play it across everything you own, or narrow it to one artist or one album.

### Smart Shuffle

A second shuffle, next to the normal one, weighted toward music you actually rate. Higher tiers come up more, artists get a boost from how much of their work you've ranked, play counts nudge it, and recently played tracks are pushed back. It leans, it doesn't rig: only tierlists you mark as influencing count, and it won't turn on if there are none.

### Search

Type a title, an artist, or both in any order, and typos are forgiven. The part it was built for is text nobody can type as written: "hikari" finds `ひかり`, "tupaya diana" finds `тупая диана`, "oneheart" finds `Øneheart`, "little dark age" finds `𝓛𝓲𝓽𝓽𝓵𝓮 𝓓𝓪𝓻𝓴 𝓐𝓰𝓮`. Forgot to switch layouts? "negfz Lbfyf" finds `тупая диана` too.

### Rediscover

A system playlist beside History and Favorites. It gathers tracks you clearly love, high in your tierlists, winning duels, or played through often, that you haven't heard in a while. Every refresh regenerates it, so it stays a rotating snapshot rather than a collection.

### Smaller things

- **Volume that actually sounds smooth.** The stock slider was linear, so nearly all the audible change was crammed into the bottom and the top half sounded the same. It now follows a perceptual dB curve, the taper the Windows mixer uses, so loudness rises evenly the whole way across.
- **Sticky selection.** Multi-select survives switching tabs and finishing an action. Select songs, wander around, then do the thing. Esc or the Unselect button clears it, and it never mixes songs with playlists.
- **A now-playing widget for OBS.** A transparent overlay with the current track, switched on in Settings and served only on this computer.
- **Drag a song out.** Its file goes straight from the context menu into Explorer, a DAW or a chat window.

## 📊 Benchmark

![Nemora vs Nora benchmark](/resources/features/benchmark.png)

Against [Nora 3.1.0](https://github.com/Sandakan/Nora/releases/tag/v3.1.0-stable), Nemora 2.0 builds a 1775-track library 17 times faster and writes 45 times less to disk doing it, holds a third of the memory, costs under a quarter of the CPU while a track plays, and puts its window on screen in less than half the time. Where Nora leaves 35 ms of silence between two songs, Nemora leaves none.

Same machine, both players offline and each in its own profile folder, launched in turn, every process counted. Libraries of 400 and 1775 tracks from the same collection, medians of 2 to 5 launches. Memory is the private working set, the figure Windows shows in Task Manager. Playback only counts when Windows confirms the app is producing sound, and the silence between songs is measured on what the sound device actually played. [Full report](docs/benchmark.md), [harness](tools/bench).

It is not ahead everywhere. Nemora writes more to disk in its first minute after starting (13 MB to Nora's 3 MB) and idles slightly higher (1.0 % of one core to 0.6 %), and opening a page takes the same time in both, since the pages are the same code.

One honest asterisk on the size: Electron ships its own copy of Chromium, Nemora uses the WebView2 runtime already in Windows. That is most of the 382 MB against 56 MB.

## 🛠 Building

```
cargo test
cd apps/desktop && npm install && npm run tauri dev
```

`crates/nemora-core` is the shared Rust core and the only code that reads or writes the library database; `crates/nemora-audio` is the audio engine; `apps/desktop` is the Windows app. Development builds keep their data in `%APPDATA%\Nemora-dev`, never in the profile of an installed Nemora; `NEMORA_PROFILE_DIR` overrides the location.

---

<div align="center">

Made by nikenmar  
CMR

_All songs, artists, albums, and cover art used in demonstrations are property of their respective owners and used for illustrative purposes only. All copyrights are respected._

</div>

---

## Credits

Built on [Nora](https://github.com/Sandakan/Nora) by [Sandakan Nipunajith](https://github.com/Sandakan) and MIT licensed, which is what made all of this possible. Nora in turn took its cues from [Oto Music for Android](https://play.google.com/store/apps/details?id=com.piyush.music) by Piyush Mamidwar.

Built with [Rust](https://www.rust-lang.org), [Tauri](https://tauri.app) and [React](https://react.dev). Audio is decoded by [Symphonia](https://github.com/pdeljanov/Symphonia) and time-stretched by [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch). Lyrics come from [LRCLIB](https://lrclib.net) and [Musixmatch](https://www.musixmatch.com), artist information from [Deezer](https://www.deezer.com) and [Genius](https://genius.com), and scrobbling from [Last.fm](https://www.last.fm).

The full list of third-party licences ships with the app, under **Settings > About > Open-source licenses**.
