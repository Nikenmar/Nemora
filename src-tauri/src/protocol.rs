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
//!
//! A third rule was added later, and it is the reason this file is careful:
//! **an HTTP answer that is merely wrong is indistinguishable, from the
//! renderer, from a corrupt song.** Chromium reports every one of them as
//! `DEMUXER_ERROR_COULD_NOT_OPEN`, the same message a genuinely broken file
//! produces, so a bug here is read by the user as "my music is damaged". Each
//! response below is therefore either correct or an explicit refusal that says
//! "not now, ask again" - never a plausible-looking body the demuxer will
//! choke on.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::time::Duration;

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

/// How long to keep trying a file another process is holding open.
///
/// Windows refuses a read outright while a writer holds the file without
/// `FILE_SHARE_READ`, and the writers in question are ordinary: a music file
/// still being copied into the folder, an antivirus scanning what just landed,
/// another tagger saving. All of them let go in milliseconds. Giving up on the
/// first refusal turns a moment's contention into an error dialog, so the open
/// is retried briefly - and only ever on the failing path, where the
/// alternative is failing anyway.
const OPEN_RETRIES: u32 = 5;
const OPEN_RETRY_DELAY: Duration = Duration::from_millis(40);

/// What the `Range` header asked for, once checked against the real file size.
///
/// The three cases must stay distinct all the way to the response. Collapsing
/// "no `Range` header" together with "a `Range` we cannot satisfy" is what made
/// an unsatisfiable range answer `200 OK` carrying the WHOLE file: a media
/// element that has already been told `206` reads a sudden `200` as the
/// resource having changed underneath it and tears the pipeline down, which
/// reaches the user as `DEMUXER_ERROR_COULD_NOT_OPEN` on a file that is
/// perfectly fine.
#[derive(Debug, PartialEq, Eq)]
enum RangeRequest {
    /// No `Range` header at all: serve the whole file with `200`.
    Absent,
    /// An inclusive byte range, already clamped to the file.
    Satisfiable(u64, u64),
    /// A `Range` header we cannot honour: `416`, and never a body.
    Unsatisfiable,
}

/// Parses a single-range `Range` header. Media elements never send multi-range.
fn parse_range(raw: &str, size: u64) -> RangeRequest {
    // Nothing is satisfiable in an empty file, and `size - 1` below would wrap.
    if size == 0 {
        return RangeRequest::Unsatisfiable;
    }

    let Some(spec) = raw.strip_prefix("bytes=") else {
        return RangeRequest::Unsatisfiable;
    };
    // A multi-range request needs a multipart body we do not build. Refusing it
    // is correct; quietly answering with the first range is not, and the
    // element would then read the wrong bytes as if they were the right ones.
    if spec.contains(',') {
        return RangeRequest::Unsatisfiable;
    }
    let Some((start_s, end_s)) = spec.split_once('-') else {
        return RangeRequest::Unsatisfiable;
    };

    if start_s.is_empty() {
        // Suffix form `bytes=-N`: the last N bytes.
        let Ok(n) = end_s.trim().parse::<u64>() else {
            return RangeRequest::Unsatisfiable;
        };
        if n == 0 {
            return RangeRequest::Unsatisfiable;
        }
        let n = n.min(size);
        return RangeRequest::Satisfiable(size - n, size - 1);
    }

    let Ok(start) = start_s.trim().parse::<u64>() else {
        return RangeRequest::Unsatisfiable;
    };
    if start >= size {
        return RangeRequest::Unsatisfiable;
    }

    let end = if end_s.trim().is_empty() {
        // Open-ended: serve a bounded chunk rather than the rest of the file.
        start
            .saturating_add(MAX_OPEN_RANGE_CHUNK)
            .min(size)
            .saturating_sub(1)
            .max(start)
    } else {
        let Ok(end) = end_s.trim().parse::<u64>() else {
            return RangeRequest::Unsatisfiable;
        };
        end
    };

    if start > end {
        return RangeRequest::Unsatisfiable;
    }
    RangeRequest::Satisfiable(start, end.min(size - 1))
}

/// True for a failure that says "someone else has it right now", not "it is
/// broken". Only these are worth waiting on.
fn is_transient_open_failure(error: &io::Error) -> bool {
    // 32 ERROR_SHARING_VIOLATION, 33 ERROR_LOCK_VIOLATION. Rust maps neither to
    // a distinct ErrorKind, so they are matched by number; PermissionDenied
    // covers the same contention as reported on other platforms.
    matches!(error.raw_os_error(), Some(32) | Some(33))
        || error.kind() == io::ErrorKind::PermissionDenied
}

fn open_with_retry(path: &str) -> io::Result<File> {
    let mut attempt = 0;
    loop {
        match File::open(path) {
            Ok(file) => return Ok(file),
            Err(error) if attempt < OPEN_RETRIES && is_transient_open_failure(&error) => {
                attempt += 1;
                std::thread::sleep(OPEN_RETRY_DELAY);
            }
            Err(error) => return Err(error),
        }
    }
}

/// Reads up to `len` bytes from `start`, tolerating a file that ends earlier
/// than its own metadata just claimed.
///
/// `read_exact` answers `UnexpectedEof` for that case, which used to become a
/// `500` and then a dead player. A file can legitimately be shorter than the
/// size we stated a microsecond ago - it is being written - and the honest
/// response is to say how much there really was, not to fail.
fn read_span(file: &mut File, start: u64, len: u64) -> io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; len as usize];
    let mut filled = 0usize;
    while filled < buf.len() {
        match file.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(ref error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    buf.truncate(filled);
    Ok(buf)
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

/// `416` for a range we cannot serve.
///
/// The empty body and the `bytes */size` form are both required: they are what
/// tell a media element to ask again within the file instead of treating the
/// answer as the media itself.
fn range_not_satisfiable(size: u64, detail: &str) -> Response<Vec<u8>> {
    eprintln!("[nemora://] 416 Range Not Satisfiable: {detail}");
    cors::<()>(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE))
        .header(header::CONTENT_RANGE, format!("bytes */{size}"))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, "0")
        .body(Vec::new())
        .unwrap()
}

/// `503` for a file that exists but has nothing usable to give YET.
///
/// Distinct from `404` on purpose. A track being copied into the library, or
/// rewritten by a tag editor, is not missing and not corrupt - it is busy, and
/// the correct answer is one the renderer can retry. The recovery ladder in
/// `playbackRecovery.ts` is the other half of this contract.
fn temporarily_unavailable(detail: &str) -> Response<Vec<u8>> {
    eprintln!("[nemora://] 503: {detail}");
    cors::<()>(Response::builder().status(StatusCode::SERVICE_UNAVAILABLE))
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(detail.as_bytes().to_vec())
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

    let mut file = match open_with_retry(&file_path) {
        Ok(f) => f,
        Err(e) if is_transient_open_failure(&e) => {
            // Held by someone else for longer than we waited. Not missing, not
            // broken: worth another attempt from the renderer.
            return temporarily_unavailable(&format!(
                "locked by another process: {file_path}: {e}"
            ));
        }
        Err(e) => return error(StatusCode::NOT_FOUND, &format!("open failed: {e}")),
    };
    let size = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    // A zero-byte file is not media. Answering `200 OK` with an empty body -
    // which is what the old code did, because every range against a zero-length
    // file parsed as "no range" - hands the demuxer nothing to open and it says
    // so in the only words it has: DEMUXER_ERROR_COULD_NOT_OPEN. This is the
    // shape of a track played while it is still being copied in.
    if size == 0 {
        return temporarily_unavailable(&format!("file is still empty: {file_path}"));
    }

    let ctype = content_type_for(&file_path);
    let raw_range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    let range = match raw_range {
        Some(raw) => parse_range(raw, size),
        None => RangeRequest::Absent,
    };

    if trace {
        eprintln!(
            "[trace] {} range={:?} size={}",
            file_path.rsplit('\\').next().unwrap_or(&file_path),
            raw_range.unwrap_or("none"),
            size
        );
    }

    match range {
        RangeRequest::Unsatisfiable => range_not_satisfiable(
            size,
            &format!(
                "{} asked for {} of {size} bytes",
                file_path.rsplit('\\').next().unwrap_or(&file_path),
                raw_range.unwrap_or("(malformed)")
            ),
        ),
        RangeRequest::Satisfiable(start, end) => {
            let requested = end - start + 1;
            let buf = match read_span(&mut file, start, requested) {
                Ok(buf) => buf,
                Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
            };
            if buf.is_empty() {
                return temporarily_unavailable(&format!(
                    "nothing to read at byte {start} of {file_path}"
                ));
            }
            // The denominator of `Content-Range` is a promise about the whole
            // resource. If the file was rewritten under us - a tag edit, a
            // re-encode, our own picture repair - that promise is already
            // broken and every subsequent chunk would be read from a different
            // file than the one the demuxer opened. Say so instead of serving
            // the mixture.
            match file.metadata() {
                Ok(m) if m.len() != size => {
                    return temporarily_unavailable(&format!(
                        "{file_path} changed while it was being served ({size} -> {})",
                        m.len()
                    ))
                }
                _ => {}
            }
            let served_end = start + buf.len() as u64 - 1;
            let len = buf.len();
            if trace {
                eprintln!("[trace]   served {} bytes in {:?}", len, started.elapsed());
            }
            cors::<()>(Response::builder().status(StatusCode::PARTIAL_CONTENT))
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{served_end}/{size}"),
                )
                .header(header::CONTENT_LENGTH, len.to_string())
                .body(buf)
                .unwrap()
        }
        RangeRequest::Absent => {
            let mut buf = Vec::with_capacity(size as usize);
            if let Err(e) = file.read_to_end(&mut buf) {
                return error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            if buf.is_empty() {
                return temporarily_unavailable(&format!("read nothing from {file_path}"));
            }
            let len = buf.len();
            cors::<()>(Response::builder().status(StatusCode::OK))
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, len.to_string())
                .body(buf)
                .unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_range, read_span, RangeRequest};

    #[test]
    fn a_small_open_ended_range_reaches_the_end() {
        assert_eq!(
            parse_range("bytes=100-", 1000),
            RangeRequest::Satisfiable(100, 999)
        );
    }

    #[test]
    fn a_large_open_ended_range_is_capped_to_one_chunk() {
        // A 50 MB track opened with `bytes=0-` must not be read whole before
        // the first sample plays.
        let size = 50 * 1024 * 1024;
        assert_eq!(
            parse_range("bytes=0-", size),
            RangeRequest::Satisfiable(0, super::MAX_OPEN_RANGE_CHUNK - 1)
        );
    }

    #[test]
    fn closed_range_is_clamped_to_the_file() {
        assert_eq!(
            parse_range("bytes=0-5000", 1000),
            RangeRequest::Satisfiable(0, 999)
        );
    }

    #[test]
    fn suffix_range_returns_the_tail() {
        assert_eq!(
            parse_range("bytes=-200", 1000),
            RangeRequest::Satisfiable(800, 999)
        );
    }

    #[test]
    fn start_past_the_end_is_unsatisfiable_rather_than_a_whole_file() {
        // The distinction this test defends: answering `200` with the entire
        // file here is what a media element reads as "the resource changed",
        // and it reports that as DEMUXER_ERROR_COULD_NOT_OPEN.
        assert_eq!(
            parse_range("bytes=2000-", 1000),
            RangeRequest::Unsatisfiable
        );
    }

    #[test]
    fn garbage_is_unsatisfiable() {
        assert_eq!(parse_range("items=0-10", 1000), RangeRequest::Unsatisfiable);
        assert_eq!(
            parse_range("bytes=abc-def", 1000),
            RangeRequest::Unsatisfiable
        );
        assert_eq!(
            parse_range("bytes=0-abc", 1000),
            RangeRequest::Unsatisfiable
        );
        assert_eq!(parse_range("bytes=", 1000), RangeRequest::Unsatisfiable);
    }

    #[test]
    fn multi_range_is_refused_rather_than_half_answered() {
        assert_eq!(
            parse_range("bytes=0-99,200-299", 1000),
            RangeRequest::Unsatisfiable
        );
    }

    #[test]
    fn an_empty_file_satisfies_nothing() {
        // Every range against a zero-length file used to parse as "no range",
        // which served `200 OK` with an empty body - a file still being copied
        // into the library, reported to the user as a corrupt song.
        assert_eq!(parse_range("bytes=0-", 0), RangeRequest::Unsatisfiable);
        assert_eq!(parse_range("bytes=-100", 0), RangeRequest::Unsatisfiable);
    }

    #[test]
    fn a_zero_length_suffix_is_unsatisfiable() {
        assert_eq!(parse_range("bytes=-0", 1000), RangeRequest::Unsatisfiable);
    }

    #[test]
    fn a_short_file_serves_what_it_has_instead_of_failing() {
        use std::io::Write;
        let path = std::env::temp_dir().join("nemora-protocol-short-read.bin");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(&[7u8; 100]).unwrap();
        drop(file);

        let mut file = std::fs::File::open(&path).unwrap();
        // Ask for more than exists: `read_exact` would answer UnexpectedEof and
        // the old code turned that into a 500.
        let buf = read_span(&mut file, 50, 500).unwrap();
        assert_eq!(buf.len(), 50);
        assert!(buf.iter().all(|byte| *byte == 7));

        drop(file);
        let _ = std::fs::remove_file(&path);
    }
}
