//! Nemora's one field written into a FLAC or MP3 at the byte level: every other comment, frame and
//! picture is carried over as the bytes it was, because a tag library that parses and writes a tag
//! again normalises what it reads (lofty: `tracknumber=4/7` into two fields, an ID3v2.3 `TDRC` into
//! a bare year, empty frames dropped).
//!
//! Padding pays for the field where it can, so the audio does not move. A file of a shape not handled
//! here (no tag yet, unsynchronised, an extended header, a broken frame) answers `false` and nothing
//! has been changed.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::error::Result;

const MAX_FLAC_BLOCK: usize = 0xFF_FFFF;
const MAX_ID3_BODY: usize = 0x0FFF_FFFF;

/// Replaces the head of the file (`old_len` bytes) with `head`: over the old one when the lengths are
/// equal, otherwise through a second copy with the rest of the file behind the new head.
fn replace_head(path: &Path, old_len: u64, head: &[u8]) -> Result<()> {
    if head.len() as u64 == old_len {
        let mut file = File::options().write(true).open(path)?;
        file.write_all(head)?;
        return Ok(());
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    let part = path.with_file_name(name);
    let written = (|| -> io::Result<()> {
        let mut source = File::open(path)?;
        source.seek(SeekFrom::Start(old_len))?;
        let mut target = File::create(&part)?;
        target.write_all(head)?;
        io::copy(&mut source, &mut target)?;
        Ok(())
    })()
    .and_then(|()| std::fs::rename(&part, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    Ok(written?)
}

fn le32(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize)
}

/// The Vorbis comment block with `KEY=` entries of the field removed and `KEY=text` added last.
/// Field names are case-insensitive there. `None`: not a well-formed block.
fn edited_comments(block: &[u8], key: &str, text: Option<&str>) -> Option<Vec<u8>> {
    let vendor_end = 4 + le32(block, 0)?;
    block.get(..vendor_end)?;
    let count = le32(block, vendor_end)?;
    let mut entries: Vec<&[u8]> = Vec::new();
    let mut at = vendor_end + 4;
    for _ in 0..count {
        let len = le32(block, at)?;
        entries.push(block.get(at + 4..at + 4 + len)?);
        at += 4 + len;
    }
    let is_ours =
        |entry: &[u8]| entry.get(key.len()) == Some(&b'=') && entry[..key.len()].eq_ignore_ascii_case(key.as_bytes());
    entries.retain(|entry| !is_ours(entry));
    let ours = text.map(|text| format!("{key}={text}"));
    if let Some(ours) = &ours {
        entries.push(ours.as_bytes());
    }
    let mut out = block[..vendor_end].to_vec();
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for entry in entries {
        out.extend_from_slice(&(entry.len() as u32).to_le_bytes());
        out.extend_from_slice(entry);
    }
    // What follows the entries (a framing byte some writers add) stays.
    out.extend_from_slice(block.get(at..)?);
    Some(out)
}

const FLAC_PADDING: u8 = 1;
const FLAC_COMMENTS: u8 = 4;

/// Writes the field (`None`: removes it) into a FLAC's comment block; `false`: not handled here.
pub(crate) fn write_flac(path: &Path, key: &str, text: Option<&str>) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut magic = [0; 4];
    if file.read_exact(&mut magic).is_err() || &magic != b"fLaC" {
        return Ok(false);
    }
    let mut blocks: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut old_len = 4u64;
    loop {
        let mut header = [0; 4];
        file.read_exact(&mut header)?;
        let len = u32::from_be_bytes([0, header[1], header[2], header[3]]) as usize;
        let mut data = vec![0; len];
        file.read_exact(&mut data)?;
        blocks.push((header[0] & 0x7F, data));
        old_len += 4 + len as u64;
        if header[0] & 0x80 != 0 {
            break;
        }
    }
    drop(file);

    let at = blocks.iter().position(|(kind, _)| *kind == FLAC_COMMENTS);
    let (old_size, new) = match at {
        Some(at) => match edited_comments(&blocks[at].1, key, text) {
            Some(new) => (blocks[at].1.len(), new),
            None => return Ok(false),
        },
        None => {
            // No comment block: a new one after STREAMINFO, the first block by the format.
            if blocks.is_empty() {
                return Ok(false);
            }
            let empty = [0u8; 8];
            let Some(new) = edited_comments(&empty, key, text) else { return Ok(false) };
            blocks.insert(1, (FLAC_COMMENTS, Vec::new()));
            (0, new)
        }
    };
    if new.len() > MAX_FLAC_BLOCK {
        return Ok(false);
    }
    let block = at.unwrap_or(1);
    // The header of a new block costs 4 bytes more.
    let grew = (new.len() + if at.is_none() { 4 } else { 0 }) as i64 - old_size as i64;
    blocks[block].1 = new;
    if let Some((_, padding)) = blocks.iter_mut().find(|(kind, _)| *kind == FLAC_PADDING) {
        if grew < 0 {
            let longer = padding.len() + (-grew) as usize;
            if longer <= MAX_FLAC_BLOCK {
                padding.resize(longer, 0);
            }
        } else if padding.len() >= grew as usize {
            padding.truncate(padding.len() - grew as usize);
        }
    }

    let mut head = b"fLaC".to_vec();
    let last = blocks.len() - 1;
    for (index, (kind, data)) in blocks.iter().enumerate() {
        let len = (data.len() as u32).to_be_bytes();
        head.extend_from_slice(&[if index == last { kind | 0x80 } else { *kind }, len[1], len[2], len[3]]);
        head.extend_from_slice(data);
    }
    replace_head(path, old_len, &head)?;
    Ok(true)
}

fn synchsafe(value: usize) -> [u8; 4] {
    [(value >> 21) as u8 & 0x7F, (value >> 14) as u8 & 0x7F, (value >> 7) as u8 & 0x7F, value as u8 & 0x7F]
}

fn from_synchsafe(bytes: &[u8]) -> usize {
    bytes.iter().fold(0, |value, byte| (value << 7) | (*byte as usize & 0x7F))
}

/// Whether a `TXXX` frame's body (encoding byte, description, value) is under this description.
fn txxx_is(body: &[u8], description: &str) -> bool {
    let Some((encoding, rest)) = body.split_first() else { return false };
    match encoding {
        0 | 3 => rest.split(|byte| *byte == 0).next() == Some(description.as_bytes()),
        1 | 2 => {
            let mut units = rest.as_chunks::<2>().0.iter().copied();
            let mut big_endian = *encoding == 2;
            let mut found = String::new();
            let mut first = true;
            for unit in units.by_ref() {
                if unit == [0, 0] {
                    return found == description;
                }
                if first && *encoding == 1 && (unit == [0xFE, 0xFF] || unit == [0xFF, 0xFE]) {
                    big_endian = unit == [0xFE, 0xFF];
                } else {
                    let value = if big_endian { u16::from_be_bytes(unit) } else { u16::from_le_bytes(unit) };
                    found.push(char::from_u32(value as u32).unwrap_or('\u{FFFD}'));
                }
                first = false;
            }
            false
        }
        _ => false,
    }
}

/// Writes the field (`None`: removes it) as a `TXXX` frame of an MP3's ID3v2.3 or 2.4 tag, keeping
/// the tag's version; `false`: not handled here.
pub(crate) fn write_id3(path: &Path, description: &str, text: Option<&str>) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut header = [0; 10];
    if file.read_exact(&mut header).is_err() || &header[..3] != b"ID3" {
        return Ok(false);
    }
    let major = header[3];
    // Flags mean an unsynchronised tag, an extended header or a footer: lofty's to read.
    if !matches!(major, 3 | 4) || header[5] != 0 || header[6..10].iter().any(|byte| byte & 0x80 != 0) {
        return Ok(false);
    }
    let size = from_synchsafe(&header[6..10]);
    let mut body = vec![0; size];
    if file.read_exact(&mut body).is_err() {
        return Ok(false);
    }
    drop(file);

    let mut kept = Vec::with_capacity(size);
    let mut at = 0;
    while at + 10 <= size && body[at] != 0 {
        let id = &body[at..at + 4];
        if !id.iter().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit()) {
            return Ok(false);
        }
        let bytes = &body[at + 4..at + 8];
        let len = if major == 3 {
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
        } else {
            from_synchsafe(bytes)
        };
        let Some(frame) = body.get(at..at + 10 + len) else { return Ok(false) };
        if !(id == b"TXXX" && txxx_is(&frame[10..], description)) {
            kept.extend_from_slice(frame);
        }
        at += 10 + len;
    }
    if body[at..].iter().any(|byte| *byte != 0) {
        return Ok(false);
    }
    if let Some(text) = text {
        // The description and the sound's text are ASCII: Latin-1, which every version has.
        if !(description.is_ascii() && text.is_ascii()) {
            return Ok(false);
        }
        let len = 1 + description.len() + 1 + text.len();
        kept.extend_from_slice(b"TXXX");
        kept.extend_from_slice(&if major == 3 { (len as u32).to_be_bytes() } else { synchsafe(len) });
        kept.extend_from_slice(&[0, 0, 0]);
        kept.extend_from_slice(description.as_bytes());
        kept.push(0);
        kept.extend_from_slice(text.as_bytes());
    }
    if kept.len() > MAX_ID3_BODY {
        return Ok(false);
    }
    // What was padding stays the tag's: the audio moves only if the frames outgrow the tag.
    let new_size = kept.len().max(size);
    kept.resize(new_size, 0);
    let mut head = header[..6].to_vec();
    head.extend_from_slice(&synchsafe(new_size));
    head.extend_from_slice(&kept);
    replace_head(path, 10 + size as u64, &head)?;
    Ok(true)
}
