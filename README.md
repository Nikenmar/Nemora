<div align="center">

<img src="resources/banner.png" alt="Nemora Player" width="720">

### A feature-rich music player _(that installs in 30~ MB)_

Built with Rust, Tauri and React / Based on [Nora](https://github.com/Sandakan/Nora)

<a href="https://github.com/Nikenmar/Nemora/releases/latest">
  <img alt="Download Nemora for Windows" src="https://img.shields.io/github/v/release/Nikenmar/Nemora?style=for-the-badge&label=Download%20for%20Windows&labelColor=212226&color=4C8DD9">
</a>

</div>

> [!NOTE]
> New to the player? Nemora keeps Nora's core, so [Nora's page](https://github.com/Sandakan/Nora) covers the basics, what it does and how it feels to use. What follows is what Nemora adds and changes.

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
- **The demuxer fix, the one this all started from.** A picture embedded with an empty MIME type made Chromium throw `DEMUXER_ERROR_COULD_NOT_OPEN` and kill playback, which is how a high-quality FLAC could crash the player outright. Blank MIME types are repaired before playing.
- **History that outlives the library.** Rebuild a library and every song gets a new internal id, which used to detach the listening history from the music it belonged to: a folder removed and added back came home empty. Each play now records what it belongs to, not just an id, so the history finds its tracks again on the next scan, and removing a song no longer erases its listens, its duel rating or its place in a tierlist.
- **Partial Rust integration.** Scanning folders, reading and writing tags, and producing cover art now happen in Rust rather than inside the webview. A 300-track folder is listed before you can watch it happen. Everything above that stayed TypeScript, and every native route keeps the old one as a fallback, so a build without it behaves exactly as before.

## 📊 Benchmark

![Nemora vs Nora benchmark](/resources/features/benchmark.png)

Against [Nora 3.1.0](https://github.com/Sandakan/Nora/releases/tag/v3.1.0-stable), Nemora installs in a twelfth of the space, puts its window on screen five times sooner, holds less than half the memory, costs a ninth of the CPU while a track plays, and builds the same library in less than half the time.

Same machine, same 300-track library, a separate profile copy for each player, median of 5 launches, every process counted. Memory is the private working set, the figure Windows shows in Task Manager. Playback only counts when Windows confirms the app is producing sound, so a silent run is discarded rather than averaged in. Building the library is timed by [its own harness](scripts/bench-scan.mjs). [Raw numbers](docs/tauri-port/benchmark-raw.json), [harness](scripts/benchmark.mjs).

One honest asterisk on the size: Electron ships its own copy of Chromium, Nemora uses the WebView2 runtime already in Windows. That is the whole 382 MB against 33 MB.

---

<div align="center">

Made by nikenmar  
CMR

_All songs, artists, albums, and cover art used in demonstrations are property of their respective owners and used for illustrative purposes only. All copyrights are respected._

</div>

---

## Credits

Built on [Nora](https://github.com/Sandakan/Nora) by [Sandakan Nipunajith](https://github.com/Sandakan) and MIT licensed, which is what made all of this possible. Nora in turn took its cues from [Oto Music for Android](https://play.google.com/store/apps/details?id=com.piyush.music) by Piyush Mamidwar.

Built with [Rust](https://www.rust-lang.org), [Tauri](https://tauri.app) and [React](https://react.dev). Lyrics come from [LRCLIB](https://lrclib.net) and [Musixmatch](https://www.musixmatch.com), artist information from [Deezer](https://www.deezer.com) and [Genius](https://genius.com), and scrobbling from [Last.fm](https://www.last.fm).

The full list of third-party licences ships with the app, under **Settings > About > Open-source licenses**.
