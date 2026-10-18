# Track identity v1: `nemora-audio-v1`

Status: **DRAFT for review** (2026-10-18). Frozen once the user approves it; after that any change is
a new algorithm with a new tag, never an edit of this one. Implementation:
`crates/nemora-core/src/identity.rs`.

## Rule

A track is identified by its audio stream only. Tags, embedded pictures, the file name and the
folder take no part. A file that is retagged, given a new cover, renamed or moved keeps its id and
its history; the same file has the same id on every device. A re-encode is a different track and is
not detected. One identifier, `songId`, serves every table, document and sync file.

## Algorithm

1. Probe the source with symphonia 0.6 (all metadata readers registered: ID3v1, ID3v2, APE). The file
   extension is only a hint.
2. Take the format reader's default audio track.
3. `codec`: the spec's own name for the track's codec: `flac`, `alac`, `mp1`, `mp2`, `mp3`, `aac`,
   `vorbis`, `opus`, `pcm` (every PCM layout), `other`.
4. `sample_rate`: u32, 0 when unknown. `channels`: u8 count, 0 when unknown.
5. `frame_count`: the track's frame count **only when the container states it exactly**: formats
   `flac`, `isomp4`, `ogg`, `wave`, `aiff`, `matroska`. For every other format (`mp1`, `mp2`, `mp3`,
   `adts`, anything new) it is absent and hashed as 0.
6. Hash with BLAKE3:

   ```
   "nemora-audio-v1" 0x00
   codec (ASCII)     0x00
   sample_rate       u32 little-endian
   channels          u8
   frame_count       u64 little-endian (0 when absent)
   then, for each packet of the track in demux order:
       payload length u32 little-endian
       payload bytes
   ```

   Packets are taken whole until at least `2 MiB` (2 097 152 bytes) of payload have been hashed, or
   the stream ends. Packets of other tracks are skipped. An I/O or decode error, or a chained-stream
   reset, ends the window early; what was read still identifies the file.
7. `songId` = the first 16 bytes of the digest, written as 26 lowercase base32 characters (RFC 4648
   alphabet `a-z2-7`, no padding, the 2 trailing bits zero).

A file with no audio track, no packets or no format reader gets no id and is listed as unsupported.

## Why each choice

- **Demuxed packets, not file bytes.** Taggers rewrite metadata blocks, padding, ID3/APE tags, MP4
  atoms (and their order) and OGG pages (a larger comment header renumbers every later page and
  changes its CRC). The packet payloads are untouched by all of that.
- **Frame count only when exact.** It separates a radio edit from an extended version with an
  identical start. symphonia estimates the length of an MP3 without a Xing/Info/VBRI header from
  `byte_len - start`, which **includes trailing ID3v1 and APE tags** (`estimate_num_mpeg_frames` in
  symphonia-bundle-mp3 0.6.1). Trusting it would let a tag change the id: proved by mutation below.
- **A byte window, not a time window.** Digital silence encodes to tiny FLAC frames, so a long silent
  intro shared by tracks of one album is passed within the window anyway.
- **2 MiB.** About 2 MB is read per new or changed file; unchanged files are never re-read (the scan
  index maps location, size and mtime to the id). Hashing the whole file would make the first scan of
  a large library slow on an HDD or a phone for no practical gain.
- **All metadata readers are required.** Without the ID3v2 reader the probe treats a tag as unknown
  bytes and gives up after its 1 MB probe depth, so an MP3 whose embedded cover is larger than 1 MB is
  "not a supported audio file". Measured: a 1.8 MB cover made the probe fail until `all-meta` was
  enabled.

## Accepted consequences

- Two recordings whose first 2 MiB of packets, codec parameters and exact frame count are identical
  are one track. For MP3 and ADTS, which hash no frame count, two encodes of the same master that
  differ only after the first 2 MiB (about 52 s at 320 kbit/s) are one track.
- MP3Gain and similar tools rewrite the frames' global gain, i.e. the audio itself: a new id.
- The same audio in two files with different tags: one id, shown as separate library rows with one
  statistics (decision of 2026-10-18).

## Evidence (2026-10-18)

- `tests/identity_corpus.rs`, generated with ffmpeg 8.1 and edited with lofty 0.25.4, for MP3 CBR,
  MP3 VBR, MP3 CBR without Xing, FLAC, AAC in M4A, ALAC in M4A, Vorbis in OGG, Opus, WAV: title,
  artist and album changed; a 1.5 MB cover added; every tag removed; renamed and moved; for MP3 also
  ID3v1 appended and an APEv2 tag with a 1.5 MB cover appended -> **same id**. A different recording
  and the same recording 5 s shorter -> **different id**. Every editing case first checks that the file
  on disk actually changed.
- Mutation: adding `mp3` to the exact-frame-count formats makes the corpus fail exactly on the two
  trailing-tag cases of the MP3 without Xing (estimate 882 432 -> 883 584 frames).
- The user's real library (1775 files: 1104 FLAC, 669 MP3, 1 AAC/M4A, 1 Vorbis): all identified,
  0 failures, 1775 distinct ids, 3.4 ms per file in a release build (3.7 GB read in 6 s; the files may
  have been in the OS cache).
- 28 real files (15 MP3, 11 FLAC, the M4A, the OGG) copied, retagged and given a 300 KB cover with
  lofty: 28 of 28 kept their id.

## Open before freezing

- `[OPEN, user]` approve the rule, the 2 MiB window and the accepted consequences.
- Matroska/WebM audio and CAF are probed but not in the corpus (none in the user's library).
