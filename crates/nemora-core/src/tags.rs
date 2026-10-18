//! Reading tags into what a library row shows.
//!
//! The rules are 1.1.9's, so a library looks the same after the move: the title falls back to the
//! file name, artists and album artists are split on commas, genres on `,` `;` `/`, and the year is
//! the first four digits of the year or recording date. One deliberate change: every value of a
//! multi-valued artist field is read, where 1.1.9 read only the first.

use std::path::Path;

use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedPicture {
    pub mime: Option<String>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackTags {
    pub title: String,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    pub album: Option<String>,
    pub genres: Vec<String>,
    pub year: Option<i64>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub duration_ms: u64,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub channels: Option<u8>,
    pub bitrate_kbps: Option<u32>,
    /// The front cover if the file names one, else the first non-empty picture.
    pub cover: Option<EmbeddedPicture>,
    /// Shown in the tag editor; not part of the library row.
    pub composer: Option<String>,
}

impl TrackTags {
    /// BLAKE3 over the display tags, each trimmed, joined with NUL in the order of
    /// `spec/schema-v1.md`. Two files of one song with equal signatures are one library row.
    pub fn signature(&self) -> String {
        let mut hasher = blake3::Hasher::new();
        let mut field = |value: &str| {
            hasher.update(value.trim().as_bytes());
            hasher.update(&[0]);
        };
        field(&self.title);
        field(&self.artists.join("\u{1f}"));
        field(&self.album_artists.join("\u{1f}"));
        field(self.album.as_deref().unwrap_or(""));
        field(&self.genres.join("\u{1f}"));
        field(&self.year.map(|y| y.to_string()).unwrap_or_default());
        field(&self.track_no.map(|n| n.to_string()).unwrap_or_default());
        field(&self.disc_no.map(|n| n.to_string()).unwrap_or_default());
        hasher.finalize().to_hex().to_string()
    }
}

/// Reads the tags of a file. Parsing is relaxed: a tag slightly out of spec is common in real
/// libraries, and refusing the file would lose a song over a detail nobody hears.
pub fn read_tags(path: &Path) -> Result<TrackTags> {
    let tagged = Probe::open(path)
        .and_then(|p| p.options(ParseOptions::new().read_properties(true).parsing_mode(ParsingMode::Relaxed)).read())
        .map_err(|e| Error::Tags(format!("{}: {e}", path.display())))?;
    let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

    let properties = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    Ok(TrackTags {
        title: title(tag, &file_name),
        artists: tag.map(|t| split_list(t.get_strings(ItemKey::TrackArtist), &[','])).unwrap_or_default(),
        album_artists: tag.map(|t| split_list(t.get_strings(ItemKey::AlbumArtist), &[','])).unwrap_or_default(),
        album: tag.and_then(|t| t.album()).map(|a| a.trim().to_owned()).filter(|a| !a.is_empty()),
        genres: tag.map(|t| split_list(t.get_strings(ItemKey::Genre), &[',', ';', '/'])).unwrap_or_default(),
        year: tag.and_then(year),
        track_no: tag.and_then(|t| t.track()),
        disc_no: tag.and_then(|t| t.disk()),
        duration_ms: properties.duration().as_millis() as u64,
        sample_rate: properties.sample_rate(),
        bit_depth: properties.bit_depth(),
        channels: properties.channels(),
        bitrate_kbps: properties.audio_bitrate(),
        cover: tag.and_then(cover),
        composer: tag
            .and_then(|t| t.get_string(ItemKey::Composer))
            .map(|c| c.trim().to_owned())
            .filter(|c| !c.is_empty()),
    })
}

/// A tag edit from the tag editor. Lists are written joined with ", ", as 1.x wrote them; `None`
/// and empty values remove the field.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TagEdit {
    pub title: String,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    pub album: Option<String>,
    pub genres: Vec<String>,
    pub year: Option<i64>,
    pub track_no: Option<u32>,
    pub composer: Option<String>,
    /// A new front cover; `None` keeps the current pictures.
    pub cover: Option<Vec<u8>>,
}

/// Writes a tag edit into the file. The audio is untouched, so the song keeps its id; the next scan
/// sees the new tags as a new row of the same song.
pub fn write_tags(path: &Path, edit: &TagEdit) -> Result<()> {
    use lofty::config::WriteOptions;
    use lofty::picture::{MimeType, Picture};

    let fail = |e: &dyn std::fmt::Display| Error::Tags(format!("{}: {e}", path.display()));
    let mut file = Probe::open(path)
        .and_then(|p| p.options(ParseOptions::new().parsing_mode(ParsingMode::Relaxed)).read())
        .map_err(|e| fail(&e))?;
    if file.primary_tag_mut().is_none() {
        let tag_type = file.primary_tag_type();
        file.insert_tag(Tag::new(tag_type));
    }
    let tag = file.primary_tag_mut().expect("a primary tag was just ensured");
    let mut text = |key: ItemKey, value: Option<String>| match value.filter(|v| !v.trim().is_empty()) {
        Some(v) => {
            tag.insert_text(key, v.trim().to_owned());
        }
        None => tag.remove_key(key),
    };
    let joined =
        |list: &[String]| Some(list.iter().map(|v| v.trim()).filter(|v| !v.is_empty()).collect::<Vec<_>>().join(", "));
    text(ItemKey::TrackTitle, Some(edit.title.clone()));
    text(ItemKey::TrackArtist, joined(&edit.artists));
    text(ItemKey::AlbumArtist, joined(&edit.album_artists));
    text(ItemKey::AlbumTitle, edit.album.clone());
    text(ItemKey::Genre, joined(&edit.genres));
    text(ItemKey::Composer, edit.composer.clone());
    text(ItemKey::Year, edit.year.map(|y| y.to_string()));
    text(ItemKey::RecordingDate, edit.year.map(|y| y.to_string()));
    match edit.track_no {
        Some(n) if n > 0 => tag.set_track(n),
        _ => tag.remove_track(),
    }
    if let Some(data) = &edit.cover {
        let mime = match data.as_slice() {
            [0x89, b'P', b'N', b'G', ..] => MimeType::Png,
            [0xff, 0xd8, ..] => MimeType::Jpeg,
            [b'G', b'I', b'F', ..] => MimeType::Gif,
            [b'B', b'M', ..] => MimeType::Bmp,
            _ => MimeType::Unknown("image/webp".to_owned()),
        };
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(Picture::unchecked(data.clone()).pic_type(PictureType::CoverFront).mime_type(mime).build());
    }
    file.save_to_path(path, WriteOptions::default()).map_err(|e| fail(&e))?;
    Ok(())
}

fn title(tag: Option<&Tag>, file_name: &str) -> String {
    if let Some(title) = tag.and_then(|t| t.title()).map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()) {
        return title;
    }
    let stem = match file_name.rfind('.') {
        Some(dot) if dot > 0 => &file_name[..dot],
        _ => file_name,
    };
    if stem.is_empty() { "Unknown Title".to_owned() } else { stem.to_owned() }
}

fn split_list<'a>(values: impl Iterator<Item = &'a str>, separators: &[char]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        for part in value.split(separators) {
            let part = part.trim();
            if !part.is_empty() && !out.iter().any(|existing| existing == part) {
                out.push(part.to_owned());
            }
        }
    }
    out
}

fn year(tag: &Tag) -> Option<i64> {
    tag.get_string(ItemKey::Year)
        .or_else(|| tag.get_string(ItemKey::RecordingDate))
        .and_then(|value| value.get(..4))
        .and_then(|year| year.parse().ok())
}

fn cover(tag: &Tag) -> Option<EmbeddedPicture> {
    let pictures = tag.pictures();
    let chosen = pictures
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront && !p.data().is_empty())
        .or_else(|| pictures.iter().find(|p| !p.data().is_empty()))?;
    Some(EmbeddedPicture { mime: chosen.mime_type().map(|m| m.to_string()), data: chosen.data().to_vec() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_split_trim_and_drop_duplicates() {
        let values = ["A, B", " B ;C", "", "D/E"];
        assert_eq!(split_list(values.into_iter(), &[',']), ["A", "B", "B ;C", "D/E"]);
        assert_eq!(split_list(values.into_iter(), &[',', ';', '/']), ["A", "B", "C", "D", "E"]);
    }

    #[test]
    fn title_falls_back_to_the_file_name() {
        assert_eq!(title(None, "01. Song.flac"), "01. Song");
        assert_eq!(title(None, ".flac"), ".flac");
        assert_eq!(title(None, ""), "Unknown Title");
    }
}
