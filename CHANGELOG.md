# Changelog

What changed in each Nemora release. The newest is first. Nemora shows the short version of these notes in Settings › About › What's new.

## 3.0.0 · 2026-11-13

- A new look with dark and light themes, eight accent colours and motion throughout
- Smart Shuffle tells you why each song comes next, learns how you listen and can be steered
- Slowed & reverb, versions you keep, and headphone correction
- The taste map, For you mixes and Insights in Stats
- Lyrics for the whole library, search by a lyric line, Japanese titles found from their readings
- AI agents over MCP, Import from Spotify and 13 languages

3.0 is the largest update since Nemora got its own engine. Everything below is new or changed since 2.0.1.

### Look and feel

- **A new design.** The library sits in a calm rounded panel inside a darker frame, in a dark theme and a light one. The font is Geologica and the icons are outline icons.
- **Accent colours.** Blue stays the default, with violet, pink, red, orange, green, teal and graphite to pick in Settings › Appearance.
- **Frame shades.** In the dark theme the frame (title bar, sidebar and player) can be black, charcoal, graphite, grey or light grey.
- **Cover light.** The colours of the playing song's cover tint the window around it.
- **Top bar and sidebar.** Search lives in the top bar (Ctrl+K). The sidebar is grouped, with pinned playlists and the games.
- **Player bar.** Three controls on each side of play, the heart beside the song's title, and a cover, title and heart that hand over smoothly when the song changes. The playing song's row shows bouncing equalizer bars.
- **Motion.** Pages slide in the direction you go, covers fly from the tile you clicked into the page header and from the player into full screen, hearts pop, Add to queue flies to the queue button, page titles shrink as you scroll. Reduce motion keeps all of it still.
- **Visuals** in Settings › Appearance: a cover light that breathes with the music, a live equalizer in the playing row, an ambient full screen after a minute without input, and bars under the full-screen cover. All of them are off until you turn them on.
- **Settings** in two columns with a panel for each section, and theme previews drawn from the real colours.
- **Full screen.** The cover and lyrics are centred together, and the lyrics button (Ctrl+L) takes you back to the page you came from.
- **A new logo.** Nemora has its own mark: an N of three layers in the brand blue, in the title bar, the taskbar, the installer and file icons.

### Smart Shuffle

- **It explains itself.** Each coming song in the queue and in Up next shows a short reason. Click it, or pick Why this song? in a song's menu, to see every part of the choice as a bar.
- **Steer it for the session.** Less of this artist, More like this and Not now in any song's menu. Each one shows as a chip you can remove.
- **It learns how you listen.** Picking a song yourself, replaying it, rewinding to a moment and going back to the start count for it. Skipping after scrubbing and early skips count against it. A skip inside an album or a playlist counts half, and old evidence fades over about two months.
- **Browsing is not skipping.** Flicking through songs to find one teaches it nothing. Skips are weighed by what kind they are and what you were doing.
- **Skip-aware.** A song you skip early twice comes up less often for a while.
- **Fairer rotation.** A song heard yesterday waits longer than one heard last week. Every song in a tier gets its turn, not the same few. Songs by the same artist are spread out in the queue.
- **Forgotten favourites.** Songs you love but have not heard for two months, or did not recognise in Song Guessr, come up more.
- **Favourite moments.** Optional marks on the seek bar where you keep coming back to in a song, and an option to start songs there.
- **Modes and options.** Classic, Comfort, Discovery, Rediscover and Flow modes, Lean to a tierlist, night shuffle (what you play at this time of day), energy flow (no jarring jumps in loudness or brightness), follow the taste map and artist fatigue. The settings are grouped, with Classic and Recommended presets.
- **Duels that teach it.** Some duels pick the songs Smart Shuffle is least sure about, so each answer helps it most. Duels weigh more as a song plays more of them.
- **Tierlists nudge it.** Songs can be kept out of Smart Shuffle while they stay in the tierlist, playlists and queue.
- **Fixed:** Smart Shuffle over the whole library had fallen back to plain random. It leans on your tiers and artists again.

### Taste map

- A new page under Stats lays your library out as islands of songs you listen to together, with names, sizes from how much you play them and the links between them.
- Zoom and pan, colour the map by cover, island, tier, last heard, energy or what Smart Shuffle wants now, open an island's panel, follow the live trail of what is playing.
- Select an area and play it with Smart Shuffle, start a radio from an island, or take a journey from one place on the map to another.

### Sound

- **Slowed & reverb.** A panel over the player bar slows a song down or speeds it up, with the pitch going with the speed or kept, and adds reverb on top. It has presets, and a peak lamp.
- **Versions.** Keep a sound as a song of its own row (for example "Little Dark Age - Slowed + Reverb"), shown in lists, playlists, search and the player. Make version is in the song's menu and in the player bar's menu.
- **Switch version.** Give a song a version's sound in place, without a second row, and go back to the original at any time. The choice is kept in the song's file as a Nemora tag, written through a verified copy and never in place, so it travels with the file.
- **Save as WAV.** Save a version, or the panel's current sound, as a WAV file with the song's tags and cover.
- **Headphone correction.** Pick your headphones from the AutoEQ list or import a profile. It runs on top of the equalizer, and its curve is drawn.
- **A clipper at full scale.** When the sound is processed (a speed, reverb, the equalizer, a fade), a sample past 0 dBFS is held at it and the peak lamp lights yellow. Nothing below full scale changes, and untouched playback stays bit-perfect.

### For you and lyrics

- **Today** on Home: the Mix of the day and Continue, with For you right under them.
- **For you lists:** Rediscover, On repeat, Caught you, This hour, Energetic, Calm and Never heard. Each one opens as a list and saves as a playlist in a click.
- **Lyrics for the whole library**, fetched in the background if you turn it on. Your files come first, then LRCLIB. A song with no lyrics found is tried again after 30 days, and lyrics you wrote yourself are never replaced.
- **Search by a line of lyrics.** Search shows In lyrics results, and Play from this line starts the song there.
- **The moment card.** Share a lyrics line as a picture, to the clipboard or a file.

### Search

- Japanese titles are found from their readings, typed in Latin letters, even with a typo (yoru ni kakeru finds 夜に駆ける).
- A reading typed with the words together or apart finds the same song (risagainai or risa ga inai), and so do loan words written the way they sound.
- Did you mean offers a spelling when nothing matches well.

### Stats

- **Insights** on top: this week against the last, songs on the rise, songs out of rotation, islands of this month and the hours you listen.
- The taste map has its own place in the sidebar under Stats.

### Tierlists, duels and Song Guessr

- Song Guessr and Duels are redesigned, in a shared game window.
- **Duels by keyboard:** Left and Right pick, Down skips, Space previews the other song, Enter and Esc. A duel can be played as a series of 10, and a song can move tier when a duel earns it.
- **Tier suggestions** on the Tierlists page: songs whose duels rate them like the tier above or below. Apply them one by one or dismiss them for good. Nothing moves on its own.
- The tierlist editor works by keyboard (arrows, 1 to 9, 0, Shift with arrows), and the image export opens a Save dialog.
- Song Guessr can quiz you on the songs Smart Shuffle knows least.

### Library and songs

- **The song page** shows year and publisher in the header, and publisher, composer, copyright, ISRC, BPM, disc, format, bit depth, sample rate, bitrate, channels and file size in the details.
- **Resume after a restart.** The song you were playing starts again where it stopped.
- **Import from Spotify.** Paste a public playlist's link (no account needed, up to its first 100 tracks). Its songs are matched against your library by title, artists and length, a slowed, sped-up, remix or live version never stands in for another, doubtful matches are shown to check, and missing ones are listed to copy. The playlist gets Spotify's cover.
- **OBS widget.** The now-playing text reads over any stream footage, and songs change smoothly.

### AI agents

- `nemora-mcp` is installed beside Nemora. It is a local MCP server that lets AI agents (Claude Code, Claude Desktop, Codex, Cursor, VS Code, Gemini CLI and others) read your library and statistics, play music, run the queue and keep your playlists, favourites, lyrics and versions.
- **You choose what they may do** in Settings › AI agents: Off, Read, Control or Full. Only Full allows tag edits and moving files to the Recycle Bin. One click sets it up in each agent.
- Every change an agent makes shows a notice with its name and goes into Nemora's agent log. Playlist and favourite changes can be undone.
- Agents talk to Nemora only on your computer, through a local pipe.

### Languages, privacy and updates

- **13 languages:** English, Russian, Ukrainian, German, Spanish, Portuguese, Italian, French, Japanese, Simplified Chinese, Korean, Arabic and Hindi. A new profile follows the system language (Same as system). A profile you already have keeps its language.
- **Privacy** in Settings › About lists every online request Nemora makes, when it makes it and what it sends.
- **Updates** come in Nemora's own card with the version, its date and what is new. Nothing is downloaded until you press Update now.
- About is rewritten, and the open-source licences list credits what Nemora takes from Nora.

### Fixed

- The seek bar starts at 0 on a new song instead of showing the last song's position.
- The heart fills when you like the playing song from the player bar, full screen, its row or its card.
- The main window no longer grows a little at every start.
- A dropdown or right-click menu closes when the page scrolls or the window resizes, as Windows menus do.
- Drag the file out starts on a real drag and works from the player bar too.
- A song copied into a music folder shows at once on an open Songs page.
- Edit song tags from the player bar opens the song's own file.
- Windows media controls keep working after a song without a title or cover.

### Removed

- **Musixmatch.** Its lyrics, its tag search and its settings are gone. Lyrics you already have stay, and new ones come from your files and LRCLIB.
- **Last.fm scrobbling and accounts.** Artist and album descriptions, similar artists and the tag search still use Last.fm, without an account.
- **Genius** in the tag search.
- **Turkish and Vietnamese.** A profile set to one of them follows the system language.
- Three lyrics settings that did nothing (saving lyrics to .lrc files and their folder). Found lyrics are kept in the library anyway.

### Upgrading from 2.0.1

- 2.0.1 offers the update itself. Your library, statistics, playlists, tierlists and settings carry over.
- Nemora updates the library database on the first start. Before that it saves a copy in `%APPDATA%\Nemora\backups`.
- Going back to 2.x or 1.x is not supported. Their files are left untouched.

## 2.0.1 · 2026-10-19

### Fixed

- Song lists no longer show track numbers in front of songs.
- Newest and Oldest sorting were swapped. Recently Added shows the newest songs again.

## 2.0.0 · 2026-10-19

- Nemora plays through its own audio engine, bit-perfect at full volume.
- Gapless playback between tracks.
- Playback speed keeps the pitch, and speed changes apply without a restart.
- Seeking lands on the exact moment.
- Library and statistics live in one database, imported from 1.x on the first start.
- Songs keep their statistics through tag edits, renames and moves.

### Fixed

- Importing a stats export from the same install no longer doubles ratings.
- An empty playlist no longer shows the songs of the previous page.
