<div align="center">

<img src="resources/readme/hero.webp" alt="Nemora. Your library, heard properly." width="100%">

<h3>A music player for your local library on Windows</h3>

Its own Rust audio engine plays every file bit-perfect and gapless.<br>
Smart Shuffle learns how you listen and tells you why each song comes next.

<br>

<a href="https://github.com/Nikenmar/Nemora/releases/latest/download/Nemora_x64-setup.exe"><img alt="Download for Windows" src="https://img.shields.io/github/v/release/Nikenmar/Nemora?style=for-the-badge&label=Download%20for%20Windows&labelColor=0b1640&color=1d4094"></a>&nbsp;
<a href="CHANGELOG.md"><img alt="What's new" src="https://img.shields.io/badge/What's%20new-0b1640?style=for-the-badge"></a>

<br>

[Why Nemora](#why-nemora) · [Features](#features) · [Download](#download) · [Building](#building) · [Credits](#credits)

<img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-1d4094?style=flat-square&labelColor=0b1640">
<img alt="13 languages" src="https://img.shields.io/badge/languages-13-1d4094?style=flat-square&labelColor=0b1640">
<img alt="License" src="https://img.shields.io/github/license/Nikenmar/Nemora?style=flat-square&labelColor=0b1640&color=1d4094">

</div>

<br>

## Why Nemora

- **Its own audio engine.** Written in Rust, it decodes every file itself. At full volume with the equalizer flat, a file reaches Windows sample for sample. One track runs into the next without a gap.
- **It learns how you listen.** Every play, skip, replay, tier and duel shapes Smart Shuffle, which picks what comes next and tells you why. Your listening also becomes statistics, a map of your taste and daily mixes.
- **Songs sound the way you want.** Slow a song down, speed it up or add reverb, and keep that version.
- **Songs keep their history.** A song is recognised by its audio, not by its path or tags, so renaming, retagging or moving a file keeps every listen, rating and tier.
- **Private by design.** No telemetry, no analytics, no account. Settings › About › Privacy lists every request Nemora makes and when.

## Features

<img src="resources/readme/tierlists.webp" alt="Rank your music in tierlists" width="100%">

<img src="resources/readme/sound.webp" alt="Slowed and reverb" width="100%">

<img src="resources/readme/shuffle.webp" alt="Smart Shuffle that explains itself" width="100%">

<img src="resources/readme/stats.webp" alt="Statistics and insights" width="100%">

<img src="resources/readme/search.webp" alt="Search" width="100%">

<img src="resources/readme/duels.webp" alt="Duels and Song Guessr" width="100%">

<img src="resources/readme/tastemap.webp" alt="The taste map" width="100%">

<img src="resources/readme/fullscreen.webp" alt="The full-screen player" width="100%">

<img src="resources/readme/agents.webp" alt="AI agents over MCP" width="100%">

<img src="resources/readme/yours.webp" alt="Themes, accent colours and languages" width="100%">

### And more

- **For you.** The mix of the day, Rediscover (songs you love but have not heard in a while), On repeat, Never heard, each one a click from a playlist.
- **Lyrics.** Synced lyrics from your files or LRCLIB, fetched for the whole library in the background if you want. Search by a line, share a line as a card, translate.
- **Tournaments.** Seed 8, 16 or 32 songs and play the bracket down to one winner.
- **Versions.** Keep a slowed, sped-up or reverb sound as its own row, or save it as a WAV with the song's tags and cover.
- **Headphone correction.** Pick your headphones from the AutoEQ list, or import a profile, on top of the equalizer.
- **Smooth volume.** A perceptual curve like the Windows mixer, not a linear slider.
- **Import from Spotify.** Paste a public playlist link and its tracks are matched against your library.
- **Discord status.** The song you play shows on your Discord profile.
- **OBS widget.** A transparent now-playing overlay.
- **Mini player, tag editor, drag a song out** into Explorer, a DAW or a chat.

## Download

Get the installer from [Releases](https://github.com/Nikenmar/Nemora/releases/latest). Windows 10 and 11, x64. Nemora checks for updates and installs one only when you agree.

## Building

```
cargo test
cd apps/desktop && npm install && npm run tauri dev
```

Development builds keep their data in `%APPDATA%\Nemora-dev`, and `NEMORA_PROFILE_DIR` overrides it. The README pictures are made from real shots of the app by `tools/readme/compose.py`.

## Credits

Made with [Rust](https://www.rust-lang.org), [Tauri](https://tauri.app) and [React](https://react.dev). Audio by [Symphonia](https://github.com/pdeljanov/Symphonia) and [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch). Lyrics from [LRCLIB](https://lrclib.net), artist and album info from [Deezer](https://www.deezer.com) and [Last.fm](https://www.last.fm), headphone profiles from [AutoEQ](https://github.com/jaakkopasanen/AutoEq). Every third-party licence is listed in **Settings › About › Open-source licenses**.

---

<div align="center">

Made by nikenmar

<sub>All songs, artists, albums and cover art shown are the property of their respective owners and appear for illustration only.</sub>

</div>