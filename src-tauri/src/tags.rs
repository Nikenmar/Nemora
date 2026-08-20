//! Reading and writing audio tags natively.
//!
//! The route this replaces did something quietly extravagant: to read a title,
//! `readTagFile` pulled the ENTIRE audio file through `invoke` into the
//! renderer - 9 587 121 bytes for one FLAC - built a JS-side memory abstraction
//! over it and handed that to a JavaScript port of a C++ tagging library. That
//! library also calls Node's `path` module, which does not exist in a webview,
//! so every TagLib operation failed until a shim was written for it.
//!
//! Here the file stays where it is. Only the fields cross the boundary.
//!
//! ONE THING DELIBERATELY DOES NOT CROSS: embedded picture bytes. `read`
//! reports whether a picture exists and what its type is, not the picture
//! itself - artwork is produced by `artwork_transform_audio`, which reads the
//! same file directly. The TypeScript route still returns the bytes, because
//! its caller has no other way to reach them.

use std::path::Path;

use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};
use serde::{Deserialize, Serialize};

/// Mirrors `MetadataFileData`, minus the picture bytes and the file dates,
/// which the caller already has from `stat`.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TagData {
    pub title: Option<String>,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    pub album: Option<String>,
    pub genres: Vec<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub duration: f64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub number_of_channels: Option<u32>,
    /// The MIME type of the first embedded picture, when there is one. The
    /// bytes stay in the file unless the caller asks for them.
    pub picture_mime_type: Option<String>,
    /// Present only when `include_picture` was set.
    ///
    /// Re-parsing one song needs the bytes, because the caller replaces stored
    /// artwork from them and has no other handle on the picture. A library scan
    /// does not: it points `artwork_transform_audio` at the same file and the
    /// bytes never move. The flag is what keeps one command honest for both.
    pub picture_bytes: Option<Vec<u8>>,
}

/// What a head-limited parse cannot always establish: the shape of the audio.
///
/// A scan reads the first 256 KB of a file, which is where the tags live and,
/// for FLAC, where STREAMINFO already states the duration. MP3 has no such
/// block: duration comes from the first MPEG frame, and a file whose ID3v2 tag
/// is larger than the head - a 3 MB embedded cover is enough - has that frame
/// past the end of what the scanner read. The result was a track showing
/// 00:00 with no bitrate and no sample rate, and a seek bar with nothing to
/// scale against.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioProperties {
    pub duration: f64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub number_of_channels: Option<u32>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TagPatch {
    pub title: Option<String>,
    pub artists: Option<Vec<String>>,
    pub album_artists: Option<Vec<String>>,
    pub album: Option<String>,
    pub genres: Option<Vec<String>>,
    pub composer: Option<String>,
    pub track_number: Option<u32>,
    pub year: Option<u32>,
}

/// The separator the fork's tag writer uses for multi-value fields.
///
/// node-id3 joins with ", " and every song already on disk was written that
/// way, so a different separator here would silently re-split every artist
/// list the first time a file is edited.
const MULTI_VALUE_SEPARATOR: &str = ", ";

fn split_multi(value: Option<String>) -> Vec<String> {
    value
        .map(|value| {
            value
                .split(&[',', ';'][..])
                .map(|part| part.trim().to_string())
                .filter(|part| !part.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn read_impl(path: &str, include_picture: bool) -> Result<TagData, String> {
    let tagged = Probe::open(Path::new(path))
        .map_err(|error| format!("cannot open {path}: {error}"))?
        .read()
        .map_err(|error| format!("cannot read {path}: {error}"))?;

    let properties = tagged.properties();
    let mut data = TagData {
        duration: properties.duration().as_secs_f64(),
        bitrate: properties.audio_bitrate().map(|value| value * 1000),
        sample_rate: properties.sample_rate(),
        number_of_channels: properties.channels().map(u32::from),
        ..TagData::default()
    };

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return Ok(data);
    };

    data.title = tag.title().map(|value| value.to_string());
    data.album = tag.album().map(|value| value.to_string());
    data.year = tag
        .get_string(ItemKey::Year)
        .and_then(|value| value.get(..4).and_then(|year| year.parse::<u32>().ok()));
    data.track_number = tag.track();
    data.disc_number = tag.disk();
    data.artists = split_multi(tag.artist().map(|value| value.to_string()));
    data.album_artists = split_multi(
        tag.get_string(ItemKey::AlbumArtist)
            .map(|value| value.to_string()),
    );
    data.genres = split_multi(tag.genre().map(|value| value.to_string()));
    if let Some(picture) = tag
        .pictures()
        .iter()
        .find(|picture| !picture.data().is_empty())
    {
        // A blank MIME is exactly the defect `heal_picture_mime` fixes, and
        // reporting it honestly is what lets the caller notice.
        data.picture_mime_type = Some(
            picture
                .mime_type()
                .map(MimeType::to_string)
                .unwrap_or_default(),
        );
        if include_picture {
            data.picture_bytes = Some(picture.data().to_vec());
        }
    }

    Ok(data)
}

fn apply_patch(tag: &mut Tag, patch: &TagPatch) {
    if let Some(title) = &patch.title {
        tag.set_title(title.clone());
    }
    if let Some(album) = &patch.album {
        tag.set_album(album.clone());
    }
    if let Some(year) = patch.year {
        // The ecosystem stores this as text under "Year" even when it holds a
        // full date, so it is written the same way rather than as a number.
        tag.insert_text(ItemKey::Year, year.to_string());
    }
    if let Some(track) = patch.track_number {
        tag.set_track(track);
    }
    if let Some(artists) = &patch.artists {
        tag.set_artist(artists.join(MULTI_VALUE_SEPARATOR));
    }
    if let Some(genres) = &patch.genres {
        tag.set_genre(genres.join(MULTI_VALUE_SEPARATOR));
    }
    if let Some(album_artists) = &patch.album_artists {
        tag.insert_text(
            ItemKey::AlbumArtist,
            album_artists.join(MULTI_VALUE_SEPARATOR),
        );
    }
    if let Some(composer) = &patch.composer {
        tag.insert_text(ItemKey::Composer, composer.clone());
    }
}

fn write_impl(path: &str, patch: &TagPatch) -> Result<(), String> {
    let file = Path::new(path);
    let mut tagged = Probe::open(file)
        .map_err(|error| format!("cannot open {path}: {error}"))?
        .read()
        .map_err(|error| format!("cannot read {path}: {error}"))?;

    let tag_type = tagged
        .primary_tag()
        .map(|tag| tag.tag_type())
        .unwrap_or_else(|| tagged.file_type().primary_tag_type());

    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged.tag_mut(tag_type).expect("tag was just inserted");
    apply_patch(tag, patch);

    tagged
        .save_to_path(file, WriteOptions::default())
        .map_err(|error| format!("cannot write tags to {path}: {error}"))
}

/// What the bytes of an embedded picture actually are, read from the bytes and
/// not from the string next to them.
///
/// The declared MIME type is the least trustworthy thing about a picture: it is
/// written by whichever tagger touched the file last, and the failure this
/// module exists to prevent is caused by that string being wrong, not by the
/// image being wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PictureFormat {
    Jpeg,
    Png,
    Gif,
    Bmp,
    Tiff,
    /// A real image, but not one an audio demuxer will accept as an attached
    /// picture. WebP is the common case and it is one this app can produce.
    Foreign,
    /// Not an image at all. Files carrying an XMP packet, a stray text file or
    /// a truncated cover in a picture frame do exist in ordinary libraries.
    NotAnImage,
}

impl PictureFormat {
    /// The MIME type a demuxer recognises for this format, if any.
    fn accepted_mime(self) -> Option<MimeType> {
        match self {
            Self::Jpeg => Some(MimeType::Jpeg),
            Self::Png => Some(MimeType::Png),
            Self::Gif => Some(MimeType::Gif),
            Self::Bmp => Some(MimeType::Bmp),
            Self::Tiff => Some(MimeType::Tiff),
            Self::Foreign | Self::NotAnImage => None,
        }
    }
}

/// Identifies a picture by its magic number.
fn sniff_picture(data: &[u8]) -> PictureFormat {
    const PNG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if data.len() < 12 {
        return PictureFormat::NotAnImage;
    }
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return PictureFormat::Jpeg;
    }
    if data.starts_with(&PNG) {
        return PictureFormat::Png;
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return PictureFormat::Gif;
    }
    if data.starts_with(b"BM") {
        return PictureFormat::Bmp;
    }
    if data.starts_with(&[0x49, 0x49, 0x2A, 0x00]) || data.starts_with(&[0x4D, 0x4D, 0x00, 0x2A]) {
        return PictureFormat::Tiff;
    }
    if data.starts_with(b"RIFF") && data[8..12] == *b"WEBP" {
        return PictureFormat::Foreign;
    }
    // AVIF / HEIC, both `ftyp`-branded, both refused by audio demuxers.
    if data[4..8] == *b"ftyp" {
        return PictureFormat::Foreign;
    }
    PictureFormat::NotAnImage
}

/// Re-encodes a picture a demuxer will not accept into one it will.
///
/// Losing the cover is the alternative, and it is a worse one: the file leaves
/// here still carrying its artwork, just in a format every player can read.
fn transcode_to_jpeg(data: &[u8]) -> Option<Vec<u8>> {
    use image::codecs::jpeg::JpegEncoder;

    let decoded = image::load_from_memory(data).ok()?;
    // JPEG has no alpha channel, and an RGBA buffer handed to the encoder is a
    // hard error rather than a silent flatten.
    let rgb = decoded.to_rgb8();
    let mut out = Vec::with_capacity(data.len());
    JpegEncoder::new_with_quality(&mut out, 90)
        .encode_image(&image::DynamicImage::ImageRgb8(rgb))
        .ok()?;
    Some(out)
}

/// What to do with one picture, decided before anything is touched.
enum PictureAction {
    Keep,
    /// Rewrite it with these bytes and this MIME type.
    Rewrite(Vec<u8>, MimeType),
    /// It cannot be made acceptable; the file is better off without it.
    Remove,
}

fn plan_picture(picture: &Picture) -> PictureAction {
    let data = picture.data();
    if data.is_empty() {
        return PictureAction::Remove;
    }

    let format = sniff_picture(data);
    match format.accepted_mime() {
        Some(canonical) => {
            let declared = picture.mime_type().map(MimeType::to_string);
            let is_correct = declared
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case(&canonical.to_string()));
            if is_correct {
                PictureAction::Keep
            } else {
                // Covers all three ways the string goes wrong: absent, blank,
                // and confidently naming the wrong format.
                PictureAction::Rewrite(data.to_vec(), canonical)
            }
        }
        None => match transcode_to_jpeg(data) {
            Some(jpeg) => PictureAction::Rewrite(jpeg, MimeType::Jpeg),
            None => PictureAction::Remove,
        },
    }
}

/// Makes every embedded picture in one file something a media pipeline will
/// open, and reports how many had to be changed.
///
/// This is the fork's founding defect, widened to the whole family it belongs
/// to. The original case was a picture with an EMPTY MIME type: FFmpeg looks
/// the string up in a table of the picture formats it accepts, finds nothing,
/// and fails the entire container open with `DEMUXER_ERROR_COULD_NOT_OPEN` - so
/// a perfectly good FLAC kills playback because of a cover nobody was looking
/// at. Every other way of missing that table does exactly the same damage, and
/// the narrow repair silently declined all of them:
///
///   * a MIME type that is present but unknown to the table (`image/webp` is
///     the one this app itself can produce, and AVIF is arriving);
///   * a MIME type that is present, known, and WRONG - the old repair stamped
///     `image/jpeg` on every blank picture including the PNGs, which trades an
///     unopenable file for an undecodable cover;
///   * bytes that are not an image at all, which is not hypothetical: a real
///     library here carries an MP3 whose cover frame holds 357 bytes of XML;
///   * an empty picture frame.
///
/// So the bytes decide, never the string. A picture whose bytes are a format
/// the table accepts gets the canonical MIME type for what it really is; one
/// whose bytes are a foreign image is re-encoded to JPEG so the artwork
/// survives; anything that is not an image is removed, because there is nothing
/// to save and its presence costs the user the whole song.
///
/// Returns how many pictures were changed, so a caller can tell "nothing was
/// wrong" from "something was fixed" instead of guessing.
fn heal_impl(path: &str) -> Result<u32, String> {
    let file = Path::new(path);
    let mut tagged = Probe::open(file)
        .map_err(|error| format!("cannot open {path}: {error}"))?
        .read()
        .map_err(|error| format!("cannot read {path}: {error}"))?;

    let mut healed = 0u32;
    let tag_types: Vec<_> = tagged.tags().iter().map(|tag| tag.tag_type()).collect();
    for tag_type in tag_types {
        let Some(tag) = tagged.tag_mut(tag_type) else {
            continue;
        };

        // Planned first, applied second. A removal shifts every later index, so
        // deciding and mutating in one pass would skip pictures or repair the
        // wrong one; applying in reverse index order keeps the plan valid.
        let plan: Vec<(usize, PictureAction)> = tag
            .pictures()
            .iter()
            .enumerate()
            .map(|(index, picture)| (index, plan_picture(picture)))
            .filter(|(_, action)| !matches!(action, PictureAction::Keep))
            .collect();

        for (index, action) in plan.into_iter().rev() {
            match action {
                PictureAction::Keep => {}
                PictureAction::Remove => {
                    tag.remove_picture(index);
                    healed += 1;
                }
                PictureAction::Rewrite(bytes, mime) => {
                    // Pictures are replaced rather than edited in place: lofty
                    // exposes them read-only, and rebuilding the one that is
                    // broken leaves every other picture in the file untouched.
                    let broken = &tag.pictures()[index];
                    let mut builder = Picture::unchecked(bytes)
                        .pic_type(broken.pic_type())
                        .mime_type(mime);
                    if let Some(description) = broken.description() {
                        builder = builder.description(description.to_string());
                    }
                    tag.set_picture(index, builder.build());
                    healed += 1;
                }
            }
        }
    }

    if healed == 0 {
        return Ok(0);
    }

    tagged
        .save_to_path(file, WriteOptions::default())
        .map_err(|error| format!("cannot write repaired pictures to {path}: {error}"))?;
    Ok(healed)
}

/// Reads the stream properties and NOTHING else.
///
/// `read_tags(false)` is the whole point: the files that need this command are
/// exactly the ones carrying a multi-megabyte embedded cover, and parsing their
/// tags would pull that cover into memory to answer a question about duration.
fn properties_impl(path: &str) -> Result<AudioProperties, String> {
    let tagged = Probe::open(Path::new(path))
        .map_err(|error| format!("cannot open {path}: {error}"))?
        .options(
            ParseOptions::new()
                .read_properties(true)
                .read_tags(false)
                .parsing_mode(ParsingMode::Relaxed),
        )
        .read()
        .map_err(|error| format!("cannot read properties of {path}: {error}"))?;

    let properties = tagged.properties();
    Ok(AudioProperties {
        duration: properties.duration().as_secs_f64(),
        bitrate: properties.audio_bitrate().map(|value| value * 1000),
        sample_rate: properties.sample_rate(),
        number_of_channels: properties.channels().map(u32::from),
    })
}

#[tauri::command]
pub async fn audio_properties(path: String) -> Result<AudioProperties, String> {
    tauri::async_runtime::spawn_blocking(move || properties_impl(&path))
        .await
        .map_err(|error| format!("audio properties task failed: {error}"))?
}

#[tauri::command]
pub async fn tags_read(path: String, include_picture: bool) -> Result<TagData, String> {
    tauri::async_runtime::spawn_blocking(move || read_impl(&path, include_picture))
        .await
        .map_err(|error| format!("tag read task failed: {error}"))?
}

#[tauri::command]
pub async fn tags_write(path: String, patch: TagPatch) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_impl(&path, &patch))
        .await
        .map_err(|error| format!("tag write task failed: {error}"))?
}

#[tauri::command]
pub async fn tags_heal_picture_mime(path: String) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || heal_impl(&path))
        .await
        .map_err(|error| format!("tag heal task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lofty::picture::PictureType;

    fn png_bytes() -> Vec<u8> {
        let mut out = Vec::new();
        let image = image::RgbImage::from_pixel(4, 4, image::Rgb([10, 20, 30]));
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    fn webp_bytes() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(8, 8, image::Rgba([200, 30, 40, 255]));
        let encoder = webp::Encoder::from_rgba(image.as_raw(), image.width(), image.height());
        let mut config = webp::WebPConfig::new().unwrap();
        config.quality = 80.0;
        encoder.encode_advanced(&config).unwrap().to_vec()
    }

    fn picture_with(data: Vec<u8>, mime: Option<MimeType>) -> Picture {
        let builder = Picture::unchecked(data).pic_type(PictureType::CoverFront);
        match mime {
            Some(mime) => builder.mime_type(mime).build(),
            None => builder.build(),
        }
    }

    #[test]
    fn every_picture_format_is_identified_by_its_bytes() {
        assert_eq!(
            sniff_picture(&[0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            PictureFormat::Jpeg
        );
        assert_eq!(sniff_picture(&png_bytes()), PictureFormat::Png);
        assert_eq!(sniff_picture(b"GIF89a01234567"), PictureFormat::Gif);
        assert_eq!(sniff_picture(&webp_bytes()), PictureFormat::Foreign);
        // The 357 bytes of XML found sitting in a cover frame in a real library.
        assert_eq!(
            sniff_picture(br#"<?xml version="1.0" encoding="UTF-8"?><x:xmpmeta/>"#),
            PictureFormat::NotAnImage
        );
        assert_eq!(sniff_picture(&[]), PictureFormat::NotAnImage);
    }

    #[test]
    fn a_picture_that_already_says_what_it_is_is_left_alone() {
        let action = plan_picture(&picture_with(png_bytes(), Some(MimeType::Png)));
        assert!(matches!(action, PictureAction::Keep));
    }

    #[test]
    fn a_blank_mime_type_is_replaced_by_what_the_bytes_really_are() {
        // The founding defect. Note the expected type: the old repair stamped
        // `image/jpeg` on every blank picture, so a PNG cover came out of the
        // repair claiming to be a JPEG.
        let action = plan_picture(&picture_with(png_bytes(), None));
        match action {
            PictureAction::Rewrite(_, mime) => assert_eq!(mime, MimeType::Png),
            _ => panic!("a picture with no MIME type must be repaired"),
        }
    }

    #[test]
    fn a_mime_type_that_names_the_wrong_format_is_corrected() {
        let action = plan_picture(&picture_with(png_bytes(), Some(MimeType::Jpeg)));
        match action {
            PictureAction::Rewrite(_, mime) => assert_eq!(mime, MimeType::Png),
            _ => panic!("PNG bytes declared as JPEG must be corrected"),
        }
    }

    #[test]
    fn an_unknown_mime_type_is_treated_as_broken_even_though_it_is_not_blank() {
        let action = plan_picture(&picture_with(
            png_bytes(),
            Some(MimeType::Unknown("image/x-whatever".into())),
        ));
        assert!(matches!(action, PictureAction::Rewrite(_, MimeType::Png)));
    }

    #[test]
    fn a_webp_cover_is_re_encoded_rather_than_thrown_away() {
        // WebP is not in the demuxer's table of attached-picture types, and it
        // is a format this very app produces. Losing the cover would be the
        // easy fix; keeping it as JPEG is the right one.
        let action = plan_picture(&picture_with(
            webp_bytes(),
            Some(MimeType::Unknown("image/webp".into())),
        ));
        match action {
            PictureAction::Rewrite(bytes, mime) => {
                assert_eq!(mime, MimeType::Jpeg);
                assert_eq!(sniff_picture(&bytes), PictureFormat::Jpeg);
            }
            _ => panic!("a WebP cover must survive as JPEG"),
        }
    }

    #[test]
    fn bytes_that_are_not_an_image_are_removed() {
        let action = plan_picture(&picture_with(
            br#"<?xml version="1.0" encoding="UTF-8"?><x:xmpmeta/>"#.to_vec(),
            Some(MimeType::Jpeg),
        ));
        assert!(matches!(action, PictureAction::Remove));
    }

    #[test]
    fn an_empty_picture_frame_is_removed() {
        let action = plan_picture(&picture_with(Vec::new(), Some(MimeType::Jpeg)));
        assert!(matches!(action, PictureAction::Remove));
    }

    /// The repair, run end to end against a real file from a real library.
    ///
    /// Opt-in because it needs one: set `NEMORA_HEAL_FIXTURE` to an audio file
    /// carrying a picture a demuxer would refuse. The file is copied first and
    /// the copy is what gets rewritten, per the isolation rule - a repair test
    /// that damages the only copy of someone's music has failed no matter what
    /// it asserts.
    #[test]
    #[ignore]
    fn repairs_a_real_file_without_breaking_it() {
        let Some(fixture) = std::env::var_os("NEMORA_HEAL_FIXTURE") else {
            println!("set NEMORA_HEAL_FIXTURE to an audio file with a broken embedded picture");
            return;
        };
        let source = std::path::PathBuf::from(fixture);
        let extension = source
            .extension()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "mp3".into());
        let working = std::env::temp_dir().join(format!("nemora-heal-fixture.{extension}"));
        std::fs::copy(&source, &working).expect("fixture must be copyable");
        let path = working.to_string_lossy().to_string();

        let before = Probe::open(&working).unwrap().read().unwrap();
        let broken_before = before
            .tags()
            .iter()
            .flat_map(|tag| tag.pictures())
            .filter(|picture| !matches!(plan_picture(picture), PictureAction::Keep))
            .count();
        let duration_before = before.properties().duration();
        assert!(
            broken_before > 0,
            "the fixture is supposed to carry a picture a demuxer would refuse"
        );

        let healed = heal_impl(&path).expect("the repair must not fail");
        assert_eq!(healed as usize, broken_before);

        let after = Probe::open(&working).unwrap().read().unwrap();
        let broken_after = after
            .tags()
            .iter()
            .flat_map(|tag| tag.pictures())
            .filter(|picture| !matches!(plan_picture(picture), PictureAction::Keep))
            .count();
        assert_eq!(
            broken_after, 0,
            "every picture must be acceptable afterwards"
        );
        // The point of the whole exercise: the song is still a song.
        assert_eq!(
            after.properties().duration(),
            duration_before,
            "the audio must come through the repair untouched"
        );

        // A second run must find nothing left to do, or the repair is not stable.
        assert_eq!(heal_impl(&path).unwrap(), 0);

        let _ = std::fs::remove_file(&working);
    }

    #[test]
    fn splits_multi_value_fields_the_way_the_library_already_stores_them() {
        assert_eq!(
            split_multi(Some("Avenxir, SUNJI".into())),
            vec!["Avenxir".to_string(), "SUNJI".to_string()]
        );
        // Semicolons appear in files written by other taggers.
        assert_eq!(
            split_multi(Some("A; B ;C".into())),
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
        assert!(split_multi(None).is_empty());
        assert!(split_multi(Some("  ".into())).is_empty());
    }

    #[test]
    fn a_patch_only_touches_the_fields_it_carries() {
        let mut tag = Tag::new(lofty::tag::TagType::VorbisComments);
        tag.set_title("original".into());
        tag.set_album("album".into());

        apply_patch(
            &mut tag,
            &TagPatch {
                title: Some("changed".into()),
                ..TagPatch::default()
            },
        );

        assert_eq!(tag.title().as_deref(), Some("changed"));
        assert_eq!(
            tag.album().as_deref(),
            Some("album"),
            "album was not in the patch"
        );
    }

    #[test]
    fn multi_value_fields_are_joined_with_the_separator_already_on_disk() {
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        apply_patch(
            &mut tag,
            &TagPatch {
                artists: Some(vec!["A".into(), "B".into()]),
                genres: Some(vec!["Electro".into(), "Phonk".into()]),
                ..TagPatch::default()
            },
        );

        assert_eq!(tag.artist().as_deref(), Some("A, B"));
        assert_eq!(tag.genre().as_deref(), Some("Electro, Phonk"));
    }

    /// An MP3 whose first audio frame sits past the scanner's 256 KB head.
    ///
    /// This is the shape that produced 00:00 durations in the library: 29 of
    /// 115 MP3s in the test set carried an ID3v2 tag between 256 KB and 3.3 MB,
    /// so the head the scanner reads held only tag. Nothing here is exotic -
    /// one embedded cover at full resolution is enough to get there.
    #[test]
    fn reads_duration_when_the_first_frame_is_past_the_scanner_head() {
        const TAG_BODY: usize = 300 * 1024;
        const FRAME_SIZE: usize = 417; // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
        const FRAMES: usize = 200;

        let mut bytes = Vec::with_capacity(10 + TAG_BODY + FRAMES * FRAME_SIZE);
        bytes.extend_from_slice(b"ID3");
        bytes.extend_from_slice(&[0x04, 0x00, 0x00]);
        // Syncsafe length: seven bits per byte, high bit always clear.
        let size = TAG_BODY as u32;
        bytes.extend_from_slice(&[
            ((size >> 21) & 0x7f) as u8,
            ((size >> 14) & 0x7f) as u8,
            ((size >> 7) & 0x7f) as u8,
            (size & 0x7f) as u8,
        ]);
        bytes.resize(10 + TAG_BODY, 0); // Padding, which ID3v2 permits.
        for _ in 0..FRAMES {
            bytes.extend_from_slice(&[0xff, 0xfb, 0x90, 0x00]);
            bytes.resize(bytes.len() + FRAME_SIZE - 4, 0);
        }

        let path = std::env::temp_dir().join("nemora-late-frame.mp3");
        std::fs::write(&path, &bytes).expect("the fixture is writable");

        let properties = properties_impl(path.to_str().expect("utf-8 temp path"))
            .expect("a file whose frames start late still has properties");
        let _ = std::fs::remove_file(&path);

        assert!(
            bytes.len() > 256 * 1024,
            "the fixture must be past the head to be testing anything"
        );
        // 200 frames of 417 bytes at 128 kbps is a bit over five seconds.
        assert!(
            properties.duration > 4.0 && properties.duration < 7.0,
            "duration was {}",
            properties.duration
        );
        assert_eq!(properties.sample_rate, Some(44_100));
    }

    /// Reads a real track from the library when one is reachable.
    ///
    /// Skipped, never failed, on a machine without that profile: a suite that
    /// depends on one developer's disk is how twelve tests that needed no
    /// fixture once broke CI here.
    #[test]
    fn reads_a_real_track_without_loading_it_into_memory() {
        let Ok(appdata) = std::env::var("APPDATA") else {
            return;
        };
        let songs = Path::new(&appdata).join("Nora").join("songs.json");
        let Ok(raw) = std::fs::read_to_string(&songs) else {
            return;
        };
        let Some(start) = raw.find("\"path\":\"") else {
            return;
        };
        let rest = &raw[start + 8..];
        let Some(end) = rest.find('"') else { return };
        let path = rest[..end].replace("\\\\", "\\");
        if !Path::new(&path).exists() {
            return;
        }

        let data = read_impl(&path, false).expect("a track in the library reads");
        assert!(
            data.picture_bytes.is_none(),
            "bytes are not sent unless asked for"
        );
        assert!(
            data.duration > 0.0,
            "duration is the one field always present"
        );
    }
}
