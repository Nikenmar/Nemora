//! The `nemora://` custom scheme.
//!
//! Ported from the spike (`spike/tauri-audio/`), which proved on real 51 MB FLAC
//! files that WebView2 issues proper `Range` requests against it and that
//! `MediaElementSource` receives audio through it once CORS is allowed.
//!
//! Two rules learned there and encoded here:
//!   * On Windows the scheme is reachable only as `http://nemora.localhost/<path>`.
//!     The renderer MUST build URLs with `convertFileSrc(path, "nemora")`; a
//!     bare `nemora://localfiles/<path>` resolves to nothing.
//!   * `Access-Control-Allow-Origin` must be permissive, because the dev origin
//!     (`http://localhost:<port>`) and the production origin
//!     (`http://tauri.localhost`) differ.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, Request, Response, StatusCode};

/// Media types we serve. Anything else is a download, not a playback source.
fn content_type_for(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "m4a" | "m4r" | "aac" => "audio/mp4",
        "ogg" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

/// How much of an open-ended range (`bytes=N-`) to serve at once.
///
/// A media element opens playback with `Range: bytes=0-`, meaning "from here to
/// the end". Honouring that literally means reading an entire 50 MB FLAC into
/// memory and shipping it before the first sample can play, which is audible as
/// a long pause before a track starts. A server may legally return less, so we
/// serve a chunk and let the element ask for more as it needs it.
const MAX_OPEN_RANGE_CHUNK: u64 = 2 * 1024 * 1024;

/// Parses a single-range `Range` header. Media elements never send multi-range.
/// Returns an inclusive `(start, end)` pair clamped to the file size.
fn parse_range(raw: &str, size: u64) -> Option<(u64, u64)> {
    let spec = raw.strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;

    if start_s.is_empty() {
        // Suffix form `bytes=-N`: the last N bytes.
        let n: u64 = end_s.trim().parse().ok()?;
        let n = n.min(size);
        return Some((size.saturating_sub(n), size.saturating_sub(1)));
    }

    let start: u64 = start_s.trim().parse().ok()?;
    let end: u64 = if end_s.trim().is_empty() {
        // Open-ended: serve a bounded chunk rather than the rest of the file.
        start
            .saturating_add(MAX_OPEN_RANGE_CHUNK)
            .min(size)
            .saturating_sub(1)
            .max(start)
    } else {
        end_s.trim().parse().ok()?
    };

    if start > end || start >= size {
        return None;
    }
    Some((start, end.min(size.saturating_sub(1))))
}

fn cors<T>(builder: tauri::http::response::Builder) -> tauri::http::response::Builder
where
    T: Sized,
{
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Accept-Ranges, Content-Length",
        )
}

fn error(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    // A failure here is invisible from the renderer: a missing cover renders as
    // the default artwork and unplayable audio surfaces only as a generic
    // MediaError, neither of which says which path was refused or why. Without
    // this line, diagnosing "the artwork is gone" means guessing.
    eprintln!("[nemora://] {status}: {msg}");
    cors::<()>(Response::builder().status(status))
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

/// Serves one request. Runs on a worker thread, never on the main thread.
pub fn serve(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Set NEMORA_PROTOCOL_TRACE=1 to print every request. How often a media
    // element comes back, and for which ranges, is invisible from the renderer
    // and is the only way to tell "one lazy stream" from "a request per chunk".
    let trace = std::env::var_os("NEMORA_PROTOCOL_TRACE").is_some();
    let started = std::time::Instant::now();

    let raw_path = request.uri().path().trim_start_matches('/');
    let decoded = match percent_encoding::percent_decode_str(raw_path).decode_utf8() {
        Ok(p) => p.to_string(),
        Err(e) => return error(StatusCode::BAD_REQUEST, &format!("bad path: {e}")),
    };

    // Tolerate the legacy `localfiles/` namespace so old persisted URLs, if any
    // ever reach us, still resolve.
    let file_path = decoded
        .strip_prefix("localfiles/")
        .unwrap_or(&decoded)
        .to_string();

    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(e) => return error(StatusCode::NOT_FOUND, &format!("open failed: {e}")),
    };
    let size = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let ctype = content_type_for(&file_path);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|r| parse_range(r, size));

    if trace {
        eprintln!(
            "[trace] {} range={:?} size={}",
            file_path.rsplit('\\').next().unwrap_or(&file_path),
            request
                .headers()
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("none"),
            size
        );
    }

    match range {
        Some((start, end)) => {
            let len = end - start + 1;
            let mut buf = vec![0u8; len as usize];
            if let Err(e) = file.seek(SeekFrom::Start(start)) {
                return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            if let Err(e) = file.read_exact(&mut buf) {
                return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            if trace { eprintln!("[trace]   served {} bytes in {:?}", len, started.elapsed()); }
            cors::<()>(Response::builder().status(StatusCode::PARTIAL_CONTENT))
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
                .header(header::CONTENT_LENGTH, len.to_string())
                .body(buf)
                .unwrap()
        }
        None => {
            let mut buf = Vec::with_capacity(size as usize);
            if let Err(e) = file.read_to_end(&mut buf) {
                return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            cors::<()>(Response::builder().status(StatusCode::OK))
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, size.to_string())
                .body(buf)
                .unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn a_small_open_ended_range_reaches_the_end() {
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
    }

    #[test]
    fn a_large_open_ended_range_is_capped_to_one_chunk() {
        // A 50 MB track opened with `bytes=0-` must not be read whole before
        // the first sample plays.
        let size = 50 * 1024 * 1024;
        assert_eq!(
            parse_range("bytes=0-", size),
            Some((0, super::MAX_OPEN_RANGE_CHUNK - 1))
        );
    }

    #[test]
    fn closed_range_is_clamped_to_the_file() {
        assert_eq!(parse_range("bytes=0-5000", 1000), Some((0, 999)));
    }

    #[test]
    fn suffix_range_returns_the_tail() {
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn start_past_the_end_is_rejected() {
        assert_eq!(parse_range("bytes=2000-", 1000), None);
    }

    #[test]
    fn garbage_is_rejected() {
        assert_eq!(parse_range("items=0-10", 1000), None);
        assert_eq!(parse_range("bytes=abc-def", 1000), None);
    }
}
