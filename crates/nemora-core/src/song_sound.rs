//! Switch version's sound, kept in the song's own file (the user's idea, 2026-11-03): a song played
//! with a version's sound (speed in semitones, keep pitch, reverb and its size) without a second
//! row. It lives in the library (device setting `sound.<song_id>`) and in a field of the file's tag
//! that is Nemora's alone, so it travels with the file to another PC or a reinstall (the field also
//! reaches the phone with the file; the Android app does not apply it yet):
//!
//! - ID3v2 (MP3, and WAV/AIFF with ID3v2): a user text frame `TXXX:NEMORA_SOUND`;
//! - Vorbis comments (FLAC, Ogg Vorbis, Opus): `NEMORA_SOUND=...`;
//! - MP4 (M4A): a freeform atom `----:com.cmrdevs.nemora:sound`.
//!
//! The value is versioned text with the numbers, not the name ("Slowed" is only a label of the
//! speed): `v1;semitones=-2;keepPitch=0;reverb=0.35;size=hall`.
//!
//! Only that one field is written: in FLAC and MP3 at the byte level (`raw_field`), so every other
//! comment, frame and picture stays the bytes it was; in the rest, and in a FLAC or MP3 of a shape
//! `raw_field` leaves alone, through the format's own tag with lofty's conversions off (never its
//! generic `Tag`, which can drop frames it has no mapping for). Neither the song's id (the audio
//! stream, `identity`) nor its row (the display tags' signature, `tags::TrackTags::signature`)
//! depends on the field.

use std::fs::File;
use std::path::{Path, PathBuf};

use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::TagExt;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::error::{Error, Result};

/// The field's name in ID3v2 (`TXXX` description) and Vorbis comments.
pub const FIELD: &str = "NEMORA_SOUND";
const MP4_MEAN: &str = "com.cmrdevs.nemora";
const MP4_NAME: &str = "sound";
const PREFIX: &str = "sound.";

/// A song's own sound (the view's `SongSound` without its display name).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SongSound {
    pub semitones: f64,
    #[serde(default)]
    pub keep_pitch: bool,
    #[serde(default)]
    pub reverb: f64,
    #[serde(default = "hall")]
    pub size: String,
}

fn hall() -> String {
    "hall".into()
}

/// The field's text: versioned, numbers in their shortest exact form.
pub fn encode(sound: &SongSound) -> String {
    let size = match sound.size.as_str() {
        "room" | "vast" => sound.size.as_str(),
        _ => "hall",
    };
    format!(
        "v1;semitones={};keepPitch={};reverb={};size={size}",
        sound.semitones,
        u8::from(sound.keep_pitch),
        sound.reverb
    )
}

/// The sound a field's text holds; `None` for another version or text that is not one.
pub fn decode(text: &str) -> Option<SongSound> {
    let mut parts = text.trim().split(';');
    if parts.next()? != "v1" {
        return None;
    }
    let mut sound = SongSound { semitones: f64::NAN, keep_pitch: false, reverb: 0.0, size: hall() };
    for part in parts {
        let Some((key, value)) = part.split_once('=') else { continue };
        let value = value.trim();
        match key.trim() {
            "semitones" => sound.semitones = value.parse().ok()?,
            "keepPitch" => sound.keep_pitch = value == "1" || value == "true",
            "reverb" => sound.reverb = value.parse::<f64>().ok()?.clamp(0.0, 1.0),
            "size" => sound.size = if matches!(value, "room" | "vast") { value.to_owned() } else { hall() },
            _ => {}
        }
    }
    (sound.semitones.is_finite() && sound.semitones.abs() <= 24.0).then_some(sound)
}

fn tags_error(path: &Path, e: impl std::fmt::Display) -> Error {
    Error::Tags(format!("{}: {e}", path.display()))
}

fn options() -> ParseOptions {
    ParseOptions::new().read_properties(false).parsing_mode(ParsingMode::Relaxed).implicit_conversions(false)
}

/// The field's text in the file, if the file has it. Formats without a place for it answer `None`.
pub fn read_field(path: &Path) -> Result<Option<String>> {
    use lofty::flac::FlacFile;
    use lofty::mp4::{AtomIdent, Mp4File};
    use lofty::mpeg::MpegFile;
    use lofty::ogg::{OpusFile, VorbisFile};

    let file_type = Probe::open(path)
        .map_err(|e| tags_error(path, e))?
        .guess_file_type()
        .map_err(|e| tags_error(path, e))?
        .file_type();
    let mut file = File::open(path)?;
    let text = match file_type {
        Some(FileType::Mpeg) => MpegFile::read_from(&mut file, options())
            .map_err(|e| tags_error(path, e))?
            .id3v2()
            .and_then(|t| t.get_user_text(FIELD).map(str::to_owned)),
        Some(FileType::Flac) => FlacFile::read_from(&mut file, options())
            .map_err(|e| tags_error(path, e))?
            .vorbis_comments()
            .and_then(|t| t.get(FIELD).map(str::to_owned)),
        Some(FileType::Vorbis) => VorbisFile::read_from(&mut file, options())
            .map_err(|e| tags_error(path, e))?
            .vorbis_comments()
            .get(FIELD)
            .map(str::to_owned),
        Some(FileType::Opus) => OpusFile::read_from(&mut file, options())
            .map_err(|e| tags_error(path, e))?
            .vorbis_comments()
            .get(FIELD)
            .map(str::to_owned),
        Some(FileType::Mp4) => {
            let ident = AtomIdent::Freeform { mean: MP4_MEAN.into(), name: MP4_NAME.into() };
            Mp4File::read_from(&mut file, options())
                .map_err(|e| tags_error(path, e))?
                .ilst()
                .and_then(|t| t.get(&ident))
                .and_then(|atom| {
                    atom.data().find_map(|d| match d {
                        lofty::mp4::AtomData::UTF8(text) => Some(text.clone()),
                        _ => None,
                    })
                })
        }
        _ => None,
    };
    Ok(text)
}

/// Writes the field (`Some`) or removes it (`None`), touching nothing else in the file. `Ok(false)`
/// for a format with no place for it (WAV without ID3v2, AIFF, others): the library keeps the sound.
///
/// The user's file is never edited in place, where a crash or a power cut would ruin it: the field
/// goes into a copy beside it, the copy must hold the same song (the audio stream's id) and the
/// field, and only then replaces the original in one rename. On any failure the original stays as
/// it was and the copy is removed. A file that already says this changes nothing.
pub fn write_field(path: &Path, text: Option<&str>) -> Result<bool> {
    if !has_place(path)? {
        return Ok(false);
    }
    if read_field(path)?.as_deref() == text {
        return Ok(true);
    }
    // A rename would replace a read-only file all the same; the user has said it is not to change.
    if std::fs::metadata(path)?.permissions().readonly() {
        return Err(tags_error(path, "the file is read-only; it was left as it was"));
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".nemora-tmp");
    let copy = path.with_file_name(name);
    let done = (|| -> Result<()> {
        std::fs::copy(path, &copy)?;
        write_in_place(&copy, text)?;
        let same_song = crate::identity::identify_path(&copy).map_err(|e| tags_error(path, e))?
            == crate::identity::identify_path(path).map_err(|e| tags_error(path, e))?;
        if !same_song {
            return Err(tags_error(path, "the audio changed while writing the tag; the file was left as it was"));
        }
        if read_field(&copy)?.as_deref() != text {
            return Err(tags_error(path, "the field did not read back; the file was left as it was"));
        }
        // Everything else must be as it was, pictures included, or the original is not replaced.
        if contents(&copy)? != contents(path)? {
            return Err(tags_error(
                path,
                "writing the tag would have changed something else; the file was left as it was",
            ));
        }
        // The power can go at any moment: the copy's bytes reach the disk before its name replaces the
        // file, or a cut right after could leave the name on a file that is not all there.
        File::options().write(true).open(&copy)?.sync_all()?;
        std::fs::rename(&copy, path)?;
        Ok(())
    })();
    if done.is_err() && copy.exists() {
        let _ = std::fs::remove_file(&copy);
    }
    done.map(|()| true)
}

/// All a file's tags hold but the field: each tag's items and the bytes of its pictures, in a fixed
/// order. FLAC's picture blocks count as its tag's here.
fn contents(path: &Path) -> Result<Vec<String>> {
    // By its content: the copy's extension says nothing.
    let tagged = Probe::open(path)
        .map_err(|e| tags_error(path, e))?
        .guess_file_type()
        .map_err(|e| tags_error(path, e))?
        .options(options())
        .read()
        .map_err(|e| tags_error(path, e))?;
    let mut out = Vec::new();
    for tag in tagged.tags() {
        for item in tag.items() {
            let value = format!("{:?}", item.value());
            // The field itself, under whatever key a format's generic view gives it.
            if item.value().text().is_some_and(|text| decode(text).is_some()) {
                continue;
            }
            out.push(format!("{:?} {:?} {value}", tag.tag_type(), item.key()));
        }
        for picture in tag.pictures() {
            out.push(format!(
                "{:?} picture {:?} {:?} {}",
                tag.tag_type(),
                picture.pic_type(),
                picture.mime_type(),
                blake3::hash(picture.data()).to_hex()
            ));
        }
    }
    out.sort();
    Ok(out)
}

/// Whether this file's format has a place for the field.
fn has_place(path: &Path) -> Result<bool> {
    let file_type = Probe::open(path)
        .map_err(|e| tags_error(path, e))?
        .guess_file_type()
        .map_err(|e| tags_error(path, e))?
        .file_type();
    Ok(matches!(file_type, Some(FileType::Mpeg | FileType::Flac | FileType::Vorbis | FileType::Opus | FileType::Mp4)))
}

fn write_in_place(path: &Path, text: Option<&str>) -> Result<()> {
    use lofty::flac::FlacFile;
    use lofty::id3::v2::Id3v2Tag;
    use lofty::mp4::{Atom, AtomData, AtomIdent, Ilst, Mp4File};
    use lofty::mpeg::MpegFile;
    use lofty::ogg::{OpusFile, VorbisFile};

    let file_type = Probe::open(path)
        .map_err(|e| tags_error(path, e))?
        .guess_file_type()
        .map_err(|e| tags_error(path, e))?
        .file_type();
    let done = match file_type {
        Some(FileType::Mpeg) => crate::raw_field::write_id3(path, FIELD, text)?,
        Some(FileType::Flac) => crate::raw_field::write_flac(path, FIELD, text)?,
        _ => false,
    };
    if done {
        return Ok(());
    }
    let mut file = File::open(path)?;
    match file_type {
        Some(FileType::Mpeg) => {
            let mpeg = MpegFile::read_from(&mut file, options()).map_err(|e| tags_error(path, e))?;
            drop(file);
            let mut tag = mpeg.id3v2().cloned().unwrap_or_else(Id3v2Tag::new);
            // The file's ID3v2 version is kept: lofty writes 2.4 unless told, and older software
            // (Windows Explorer among it) reads 2.3 only.
            let v23 = mpeg.id3v2().is_some_and(|t| t.original_version() == lofty::id3::v2::Id3v2Version::V3);
            match text {
                Some(text) => {
                    tag.insert_user_text(FIELD.to_owned(), text.to_owned());
                }
                None => {
                    if tag.remove_user_text(FIELD).is_none() {
                        return Ok(());
                    }
                }
            }
            tag.save_to_path(path, WriteOptions::default().use_id3v23(v23)).map_err(|e| tags_error(path, e))?;
        }
        Some(FileType::Flac) => {
            let mut flac = FlacFile::read_from(&mut file, options()).map_err(|e| tags_error(path, e))?;
            drop(file);
            let mut tag = flac.vorbis_comments().cloned().unwrap_or_default();
            if !vorbis_set(&mut tag, text) {
                return Ok(());
            }
            flac.set_vorbis_comments(tag);
            // Saved through the file, never the tag: FLAC keeps its pictures in blocks of their own,
            // which `FlacFile` holds and a Vorbis comments tag saved alone would erase.
            flac.save_to_path(path, WriteOptions::default()).map_err(|e| tags_error(path, e))?;
        }
        Some(FileType::Vorbis) | Some(FileType::Opus) => {
            let mut tag = if file_type == Some(FileType::Vorbis) {
                VorbisFile::read_from(&mut file, options()).map_err(|e| tags_error(path, e))?.vorbis_comments().clone()
            } else {
                OpusFile::read_from(&mut file, options()).map_err(|e| tags_error(path, e))?.vorbis_comments().clone()
            };
            drop(file);
            if !vorbis_set(&mut tag, text) {
                return Ok(());
            }
            tag.save_to_path(path, WriteOptions::default()).map_err(|e| tags_error(path, e))?;
        }
        Some(FileType::Mp4) => {
            let mp4 = Mp4File::read_from(&mut file, options()).map_err(|e| tags_error(path, e))?;
            drop(file);
            let mut tag = mp4.ilst().cloned().unwrap_or_else(Ilst::default);
            let ident = AtomIdent::Freeform { mean: MP4_MEAN.into(), name: MP4_NAME.into() };
            match text {
                Some(text) => tag.replace_atom(Atom::new(ident, AtomData::UTF8(text.to_owned()))),
                None => {
                    if tag.remove(&ident).next().is_none() {
                        return Ok(());
                    }
                }
            }
            tag.save_to_path(path, WriteOptions::default()).map_err(|e| tags_error(path, e))?;
        }
        _ => {}
    }
    Ok(())
}

/// Sets or removes the field in Vorbis comments; `false` when there was nothing to remove.
fn vorbis_set(tag: &mut lofty::ogg::tag::VorbisComments, text: Option<&str>) -> bool {
    let had = tag.remove(FIELD).count() > 0;
    match text {
        Some(text) => {
            tag.push(FIELD.to_owned(), text.to_owned());
            true
        }
        None => had,
    }
}

// ----- the library's copy -----------------------------------------------------------------------

/// Every song's own sound, by song id.
pub fn all(db: &Db) -> Result<Vec<(String, SongSound)>> {
    Ok(crate::settings::all_device(db)?
        .into_iter()
        .filter_map(|(key, value)| {
            let song = key.strip_prefix(PREFIX)?.to_owned();
            let text = value.as_str()?;
            decode(text).map(|sound| (song, sound))
        })
        .collect())
}

/// Keeps the song's sound in the library (`None` removes it).
pub fn set(db: &Db, song_id: &str, sound: Option<&SongSound>) -> Result<()> {
    let key = format!("{PREFIX}{song_id}");
    match sound {
        Some(sound) => crate::settings::set_device(db, &key, &serde_json::Value::String(encode(sound))),
        None => {
            db.conn().execute("DELETE FROM settings_device WHERE key = ?1", params![key])?;
            Ok(())
        }
    }
}

/// The song's present files, where the field goes.
pub fn files(db: &Db, song_id: &str) -> Result<Vec<PathBuf>> {
    let mut stmt = db.conn().prepare(
        "SELECT DISTINCT l.uri FROM locations l JOIN track_variants v ON v.variant_id = l.variant_id
         WHERE v.song_id = ?1 AND l.missing_since IS NULL ORDER BY l.uri",
    )?;
    let rows = stmt.query_map([song_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?.into_iter().map(PathBuf::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_round_trips_and_names_no_preset() {
        let sound = SongSound { semitones: -2.0, keep_pitch: false, reverb: 0.35, size: "hall".into() };
        assert_eq!(encode(&sound), "v1;semitones=-2;keepPitch=0;reverb=0.35;size=hall");
        assert_eq!(decode(&encode(&sound)), Some(sound));
        let fine = SongSound { semitones: 1.25, keep_pitch: true, reverb: 0.0, size: "vast".into() };
        assert_eq!(decode(&encode(&fine)), Some(fine));
    }

    #[test]
    fn other_text_is_not_a_sound() {
        assert_eq!(decode(""), None);
        assert_eq!(decode("v2;semitones=-2"), None);
        assert_eq!(decode("v1;reverb=0.3"), None, "no speed");
        assert_eq!(decode("v1;semitones=abc"), None);
        assert_eq!(decode("v1;semitones=99"), None, "out of range");
        // Unknown keys are ignored, odd values clamped.
        let read = decode("v1;semitones=3;reverb=2;size=cave;future=1").unwrap();
        assert_eq!((read.semitones, read.reverb, read.size.as_str()), (3.0, 1.0, "hall"));
    }
}
