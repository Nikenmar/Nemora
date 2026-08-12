// Spike: nora:// custom protocol on Tauri v2 / WebView2.
// Goal: prove 206 Partial Content + CORS work well enough for
// (1) seeking in a large FLAC and (2) MediaElementSource + GainNode declick.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;

use tauri::http::{header, Response, StatusCode};
use tauri::Manager;

/// Every request the protocol handler served, so the frontend can prove that
/// the webview really issued Range requests instead of pulling whole files.
#[derive(Default)]
struct RangeLog(Mutex<Vec<String>>);

#[tauri::command]
fn get_range_log(state: tauri::State<'_, RangeLog>) -> Vec<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn clear_range_log(state: tauri::State<'_, RangeLog>) {
    state.0.lock().unwrap().clear();
}

/// Read `len` bytes at `offset`. Used by the "smart" benchmark arm: tag headers
/// live at the start of the file, so a scan should never read 18 MB per track.
#[tauri::command]
fn read_head(path: String, len: u64) -> Result<Vec<u8>, String> {
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let to_read = len.min(size) as usize;
    let mut buf = vec![0u8; to_read];
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

#[tauri::command]
fn read_whole(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Lets the headless run dump its findings next to the spike instead of
/// leaving them in a devtools console nobody will read.
#[tauri::command]
fn write_results(text: String) -> Result<(), String> {
    std::fs::write("../results.txt", text).map_err(|e| e.to_string())
}

#[tauri::command]
fn finish(app: tauri::AppHandle) {
    app.exit(0);
}

fn content_type_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" | "m4r" => "audio/mp4",
        "ogg" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Parses `bytes=start-end`. Returns (start, end_inclusive).
fn parse_range(raw: &str, size: u64) -> Option<(u64, u64)> {
    let spec = raw.strip_prefix("bytes=")?;
    // Only single-range requests; that is all a media element ever sends.
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        // suffix form: bytes=-N  → last N bytes
        let n: u64 = end_s.trim().parse().ok()?;
        let n = n.min(size);
        return Some((size.saturating_sub(n), size.saturating_sub(1)));
    }
    let start: u64 = start_s.trim().parse().ok()?;
    let end: u64 = if end_s.trim().is_empty() {
        size.saturating_sub(1)
    } else {
        end_s.trim().parse().ok()?
    };
    if start > end || start >= size {
        return None;
    }
    Some((start, end.min(size.saturating_sub(1))))
}

fn error_response(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, "text/plain")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn serve(request: &tauri::http::Request<Vec<u8>>, log: &RangeLog) -> Response<Vec<u8>> {
    // Windows serves the scheme as http://nora.localhost/<path>, so the real
    // file path arrives percent-encoded in the URI path.
    let raw_path = request.uri().path().trim_start_matches('/');
    let decoded = match percent_encoding::percent_decode_str(raw_path).decode_utf8() {
        Ok(p) => p.to_string(),
        Err(e) => return error_response(StatusCode::BAD_REQUEST, &format!("bad path: {e}")),
    };
    // strip the "localfiles/" namespace used by Nora's nora:// URLs
    let file_path = decoded
        .strip_prefix("localfiles/")
        .unwrap_or(&decoded)
        .to_string();

    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    log.0.lock().unwrap().push(format!(
        "{} uri={} | decoded={} | Range: {} | Origin: {}",
        request.method(),
        request.uri(),
        file_path,
        range_header.clone().unwrap_or_else(|| "<none>".into()),
        request
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("<none>")
    ));

    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(e) => return error_response(StatusCode::NOT_FOUND, &format!("open failed: {e}")),
    };
    let size = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    let ctype = content_type_for(&file_path);

    match range_header.as_deref().and_then(|r| parse_range(r, size)) {
        Some((start, end)) => {
            let len = end - start + 1;
            let mut buf = vec![0u8; len as usize];
            if let Err(e) = file.seek(SeekFrom::Start(start)) {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            if let Err(e) = file.read_exact(&mut buf) {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
                .header(header::CONTENT_LENGTH, len.to_string())
                // CORS: required for MediaElementSource on a cross-origin stream.
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges, Content-Length")
                .body(buf)
                .unwrap()
        }
        None => {
            let mut buf = Vec::with_capacity(size as usize);
            if let Err(e) = file.read_to_end(&mut buf) {
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
            }
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, ctype)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, size.to_string())
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges, Content-Length")
                .body(buf)
                .unwrap()
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(RangeLog::default())
        .invoke_handler(tauri::generate_handler![
            get_range_log,
            clear_range_log,
            read_head,
            read_whole,
            write_results,
            finish
        ])
        .register_asynchronous_uri_scheme_protocol("nora", |ctx, request, responder| {
            let log_state = ctx.app_handle().state::<RangeLog>();
            // Cloning out of the state guard is not possible, so serve inline on
            // the spawned thread using a fresh handle.
            let app = ctx.app_handle().clone();
            drop(log_state);
            std::thread::spawn(move || {
                let log = app.state::<RangeLog>();
                let response = serve(&request, &log);
                responder.respond(response);
            });
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
