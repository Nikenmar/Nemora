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

- **Bit-perfect at full volume.** The engine decodes every file itself. At full volume with the equalizer flat, a file at the device's sample rate reaches Windows sample for sample, a file at another rate goes through Nemora's own high-quality resampler rather than Windows'.
- **Gapless.** One track runs into the next without a gap, so live albums and mixes play the way they were cut.
- **Songs keep their history.** A song is recognised by its audio, not by its file path or its tags, so editing tags, renaming the file or moving it to another folder keeps every listen, rating and tierlist place.

The first start of 2.0 imports the library and statistics of a 1.x install. The 1.x files are left untouched, but going back to 1.x afterwards is not supported.

## ✨ Features

### Tierlists

![Tierlist editor](/resources/features/tierlists.webp)

Drag songs into tiers, then play a tierlist like a playlist. Your rankings feed the smart shuffle.

### Statistics

![Statistics tab](/resources/features/statistics.webp)

Listens, skips, hours, streaks, a heatmap of every day you listened, and the hours and weekdays you play music, for any year or all time.

Your history exports to a single file, and importing it twice never doubles a listen.

### Duels & SongGuessr

![Duels and SongGuessr](/resources/features/duels-songguessr.webp)

The most fun part!

- **Duels.** Which of these two do you like more? Every answer moves an ELO rating, so your library sorts itself by what you actually pick, not by what you claim to like.
- **Tournaments.** Seed 8, 16 or 32 tracks and play the bracket down to one winner.
- **SongGuessr.** Songless on your own library: name the track from a tenth of a second, or skip for a longer clip, up to 12 seconds. Six tries, a streak counter, and your whole library or a single artist or album.

### Smart Shuffle

A second shuffle that leans toward what you rate: higher tiers, ranked artists and frequent plays come up more, recent plays less. It leans, it doesn't rig, and only the tierlists you choose count.

### Search

Any word order, typos forgiven, and text nobody can type: "hikari" finds `ひかり`, "oneheart" finds `Øneheart`, "little dark age" finds `𝓛𝓲𝓽𝓽𝓵𝓮 𝓓𝓪𝓻𝓴 𝓐𝓰𝓮`. Forgot to switch layouts? "negfz Lbfyf" still finds `тупая диана`.

### Also

- **Rediscover:** a self-refreshing playlist of songs you love but haven't heard in a while.
- **Smooth volume:** a perceptual dB curve, like the Windows mixer, instead of a linear slider.
- **Sticky selection:** multi-select survives switching tabs.
- **OBS widget:** a transparent now-playing overlay, served only on your computer.
- **Drag a song out** into Explorer, a DAW or a chat.

## 📊 Benchmark

![Nemora vs Nora benchmark](/resources/features/benchmark.png)

Against [Nora 3.1.0](https://github.com/Sandakan/Nora/releases/tag/v3.1.0-stable): a 1775-track library builds 17× faster with 45× less written to disk, memory drops to a third, CPU during playback to under a quarter, and songs run into each other with no gap where Nora leaves 35 ms of silence.

Nemora is not ahead everywhere: it writes more in its first minute (13 MB against 3 MB) and idles slightly higher (1.0 % of a core against 0.6 %).

Same machine, both players offline in separate profiles, every process counted, medians of 2 to 5 launches. [Full report](docs/benchmark.md) · [harness](tools/bench)

## 🛠 Building

```
cargo test
cd apps/desktop && npm install && npm run tauri dev
```

Development builds keep their data in `%APPDATA%\Nemora-dev`; `NEMORA_PROFILE_DIR` overrides it.

---

<div align="center">

Made by nikenmar, CMR

_All songs, artists, albums, and cover art used in demonstrations are property of their respective owners and used for illustrative purposes only. All copyrights are respected._

</div>

---

## Credits

Built on [Nora](https://github.com/Sandakan/Nora) by [Sandakan Nipunajith](https://github.com/Sandakan) (MIT), which made all of this possible.

Made with [Rust](https://www.rust-lang.org), [Tauri](https://tauri.app) and [React](https://react.dev). audio by [Symphonia](https://github.com/pdeljanov/Symphonia) and [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch). lyrics from [LRCLIB](https://lrclib.net) and [Musixmatch](https://www.musixmatch.com). artist info from [Deezer](https://www.deezer.com) and [Genius](https://genius.com). scrobbling via [Last.fm](https://www.last.fm). Every third-party licence is listed in **Settings > About > Open-source licenses**.
