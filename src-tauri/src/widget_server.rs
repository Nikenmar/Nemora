//! The localhost HTTP server behind the OBS "now playing" widget.
//!
//! OBS cannot read anything out of Nemora on its own: a Browser Source is a
//! plain web page, and the only externally visible signal the app had was
//! Discord Rich Presence, which speaks a named pipe to Discord and nothing
//! else. So the shell grows one more thing a webview cannot do for itself -
//! listening on a socket - and serves the widget over it.
//!
//! Three rules shaped this file:
//!
//!   * **Bind loopback only.** `127.0.0.1` is not a convenience, it is the
//!     whole security story: the widget exposes what the user is listening to
//!     and the artwork file paths on their disk, and `0.0.0.0` would hand that
//!     to the local network.
//!   * **A fixed port or nothing.** The OBS source stores a URL. Falling back
//!     to "the next free port" would silently point that URL at nothing, so a
//!     taken port is reported and the feature simply stays off.
//!   * **No artwork bytes over IPC.** The renderer holds artwork as a
//!     `http://nemora.localhost/<percent-encoded path>` URL, so it sends the
//!     URL and this server reads the file. Shipping the image through `invoke`
//!     would mean a JSON array of ~200 000 numbers on every song change.

use std::{
    collections::VecDeque,
    fs,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tiny_http::{Header, Request, Response, Server};

/// Loopback port the widget is served on.
///
/// Picked to be unremarkable: no registered service claims it, and it sits
/// below the Windows dynamic range (49152+), so it can never collide with an
/// ephemeral port the OS hands out. `NEMORA_WIDGET_PORT` overrides it.
const DEFAULT_PORT: u16 = 41237;

/// The page itself, embedded rather than installed next to the binary: an
/// asset on disk is one more thing the installer can get wrong, and the widget
/// has to work from a fresh install with no user intervention beyond pasting a
/// URL into OBS.
const WIDGET_HTML: &str = include_str!("../widget/index.html");
const POPPINS_REGULAR: &[u8] =
    include_bytes!("../../src/renderer/src/assets/fonts/Poppins-Regular.woff2");
const POPPINS_MEDIUM: &[u8] =
    include_bytes!("../../src/renderer/src/assets/fonts/Poppins-Medium.woff2");

/// What the renderer pushes on every change worth showing.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetStateInput {
    pub title: Option<String>,
    /// Already joined by the renderer: the widget shows one line, and who
    /// counts as an artist (and in what order) is a renderer decision.
    pub artists: Option<String>,
    pub playing: bool,
    /// Present exactly while the in-app "UP NEXT" popup is on screen, so the
    /// widget pops it up at the same moments the player does.
    pub up_next: Option<UpNext>,
    /// The renderer's `artworkPath`: a `http://nemora.localhost/...` URL for a
    /// local file, a remote `https://` URL for online artwork, or nothing.
    pub art: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpNext {
    pub title: String,
    pub artist: Option<String>,
    /// "+1" after the artist name, exactly as the popup renders it.
    #[serde(default)]
    pub extra: u32,
}

/// How the widget should fetch the cover.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
enum ArtSource {
    #[default]
    None,
    /// A file on disk, served by `/art`.
    File(String),
    /// Already reachable by the browser; handed over untouched.
    Remote(String),
}

#[derive(Debug, Default)]
struct ServerState {
    version: u64,
    title: Option<String>,
    artists: Option<String>,
    playing: bool,
    up_next: Option<UpNext>,
    art: ArtSource,
    /// Bumped only when the artwork itself changes.
    art_version: u64,
    /// The last few artworks, each under the token its URL carries.
    ///
    /// Serving `/art` from `art` alone looked equivalent and was not: the
    /// widget asks for a cover and the song can change before that request is
    /// answered, so the reply carried the next song's picture - and, being
    /// `immutable`, the browser then kept it under that URL for good. Covers
    /// are therefore answered by the token that was asked for.
    art_history: VecDeque<(String, ArtSource)>,
}

/// How many past covers stay answerable. Anything older than a handful of
/// skips is long gone from the widget, and the point is to survive a request
/// in flight, not to be an archive.
const ART_HISTORY: usize = 8;

/// Identifies THIS run of the app in every artwork URL.
///
/// Without it the counter alone named the cover, and the counter starts again
/// at one on every launch - so `/art?v=1` meant a different picture after a
/// restart while the browser, told the answer was `immutable`, kept showing
/// the previous session's cover next to the current song's title. The token
/// makes a URL from an older run simply unknown, which the handler answers
/// with the current cover rather than a stale one.
fn boot_token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or_default();
        format!("{millis:x}")
    })
}

fn art_token(version: u64) -> String {
    format!("{}-{version}", boot_token())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload<'a> {
    version: u64,
    title: Option<&'a String>,
    artists: Option<&'a String>,
    playing: bool,
    up_next: Option<&'a UpNext>,
    art: Option<String>,
}

impl ServerState {
    fn payload(&self) -> StatePayload<'_> {
        StatePayload {
            version: self.version,
            title: self.title.as_ref(),
            artists: self.artists.as_ref(),
            playing: self.playing,
            up_next: self.up_next.as_ref(),
            art: match &self.art {
                ArtSource::None => None,
                ArtSource::File(_) => Some(format!("/art?v={}", art_token(self.art_version))),
                ArtSource::Remote(url) => Some(url.clone()),
            },
        }
    }
}

fn state() -> &'static Mutex<ServerState> {
    static STATE: OnceLock<Mutex<ServerState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(ServerState::default()))
}

/// Turns the renderer's artwork URL into something this server can act on.
///
/// `convertFileSrc(path, "nemora")` is the only shape a local cover ever has,
/// and it is percent-encoded; anything else is either already a browser-
/// reachable URL or not artwork at all.
fn art_source_from(url: Option<String>) -> ArtSource {
    let Some(url) = url.map(|u| u.trim().to_owned()).filter(|u| !u.is_empty()) else {
        return ArtSource::None;
    };

    // A local cover first: its URL is `http://` too, so the generic branch
    // below would otherwise swallow it.
    if let Some(path) = crate::protocol::local_path_from_asset_url(&url) {
        return ArtSource::File(path);
    }

    if url.starts_with("http://") || url.starts_with("https://") {
        return ArtSource::Remote(url);
    }
    // A bundled asset (the default cover) or a bare path: the widget carries
    // its own placeholder, which is better than a broken image.
    ArtSource::None
}

/// Accepts a state push from the renderer.
///
/// Everything is compared before `version` moves, because the widget polls
/// `version` to decide whether to re-render, and a song that "changed" into
/// itself would restart the entrance animation on every push.
#[tauri::command]
pub async fn widget_set_state(state: WidgetStateInput) -> Result<(), String> {
    apply_state(state)
}

/// The body of the command, separate so the tests can drive it directly rather
/// than standing up an async executor for what is a mutex and five compares.
fn apply_state(state: WidgetStateInput) -> Result<(), String> {
    let art = art_source_from(state.art);
    let mut current = self::state()
        .lock()
        .map_err(|_| "widget state poisoned".to_owned())?;

    let art_changed = current.art != art;
    let changed = art_changed
        || current.title != state.title
        || current.artists != state.artists
        || current.playing != state.playing
        || current.up_next != state.up_next;

    if !changed {
        return Ok(());
    }

    if art_changed {
        current.art_version += 1;
        current.art = art;
        let token = art_token(current.art_version);
        let recorded = current.art.clone();
        current.art_history.push_back((token, recorded));
        while current.art_history.len() > ART_HISTORY {
            current.art_history.pop_front();
        }
    }
    current.title = state.title;
    current.artists = state.artists;
    current.playing = state.playing;
    current.up_next = state.up_next;
    current.version += 1;
    Ok(())
}

fn header(name: &str, value: &str) -> Header {
    // Both sides are ASCII literals from this file; a failure here is a
    // programming error, not a runtime condition.
    Header::from_bytes(name.as_bytes(), value.as_bytes())
        .expect("widget server header must be valid ASCII")
}

fn respond(request: Request, status: u16, content_type: &str, body: Vec<u8>, cache: &str) {
    let response = Response::from_data(body)
        .with_status_code(status)
        .with_header(header("Content-Type", content_type))
        .with_header(header("Cache-Control", cache))
        // The page is same-origin with the server, but a user pointing a
        // different tool at it (or OBS with a custom docked page) should not
        // hit an opaque CORS failure for a read-only feed.
        .with_header(header("Access-Control-Allow-Origin", "*"));
    let _ = request.respond(response);
}

fn not_found(request: Request) {
    respond(
        request,
        404,
        "text/plain; charset=utf-8",
        b"not found".to_vec(),
        "no-store",
    );
}

fn image_content_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        _ => "image/jpeg",
    }
}

/// Reads `v` out of a query string such as `v=18f2c1b9e40-5`.
fn requested_token(query: &str) -> Option<&str> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("v="))
        .filter(|token| !token.is_empty())
}

fn handle(request: Request) {
    let url = request.url().to_owned();
    let (path, query) = match url.split_once('?') {
        Some((path, query)) => (path.to_owned(), query.to_owned()),
        None => (url, String::new()),
    };

    match path.as_str() {
        "/" | "/index.html" => respond(
            request,
            200,
            "text/html; charset=utf-8",
            WIDGET_HTML.as_bytes().to_vec(),
            "no-store",
        ),
        "/state" => {
            let body = match state().lock() {
                Ok(current) => serde_json::to_vec(&current.payload())
                    .unwrap_or_else(|_| b"{\"version\":0}".to_vec()),
                Err(_) => b"{\"version\":0}".to_vec(),
            };
            respond(request, 200, "application/json", body, "no-store")
        }
        "/art" => {
            let wanted = requested_token(&query);
            let source = state().lock().ok().map(|current| {
                wanted
                    .and_then(|token| {
                        current
                            .art_history
                            .iter()
                            .find(|(recorded, _)| recorded == token)
                            .map(|(_, art)| art.clone())
                    })
                    // Nothing asked for, a token from an earlier run, or one
                    // older than the history keeps: the current cover is the
                    // best answer left, and it is at least not stale.
                    .unwrap_or_else(|| current.art.clone())
            });
            match source {
                Some(ArtSource::File(file)) => match fs::read(&file) {
                    Ok(bytes) => respond(
                        request,
                        200,
                        image_content_type(&file),
                        bytes,
                        // The URL carries `art_version`, so a hit can never be
                        // stale and a miss is a new URL.
                        "public, max-age=31536000, immutable",
                    ),
                    Err(_) => not_found(request),
                },
                _ => not_found(request),
            }
        }
        "/font/poppins-regular.woff2" => respond(
            request,
            200,
            "font/woff2",
            POPPINS_REGULAR.to_vec(),
            "public, max-age=31536000, immutable",
        ),
        "/font/poppins-medium.woff2" => respond(
            request,
            200,
            "font/woff2",
            POPPINS_MEDIUM.to_vec(),
            "public, max-age=31536000, immutable",
        ),
        _ => not_found(request),
    }
}

/// A bound server and the thread answering on it.
///
/// The thread handle is kept for one reason: switching the preference off has
/// to leave the port genuinely free before it returns. Without the join, "off"
/// only *asks* the worker to stop, and a user who unticks the box and ticks it
/// straight back gets "address in use" from a socket that was still closing.
struct Running {
    server: Arc<Server>,
    worker: thread::JoinHandle<()>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static SERVER: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    SERVER.get_or_init(|| Mutex::new(None))
}

fn port() -> u16 {
    std::env::var("NEMORA_WIDGET_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Opens or closes the socket, following the `enableObsWidget` preference.
///
/// Off by default, and off means the port is never bound at all rather than
/// bound and silent: this feature publishes what the user is listening to, and
/// a listening socket nobody asked for is not something to leave running.
///
/// Both directions are idempotent - the renderer re-asserts the preference on
/// every launch, and a second "on" must not bind a second time.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let mut slot = running()
        .lock()
        .map_err(|_| "widget server state poisoned".to_owned())?;

    if !enabled {
        if let Some(Running { server, worker }) = slot.take() {
            // `unblock` ends `incoming_requests`; dropping both references
            // closes the socket. Joining is what makes that ordering a
            // guarantee rather than a race with the next "on".
            server.unblock();
            drop(server);
            let _ = worker.join();
        }
        return Ok(());
    }

    if slot.is_some() {
        return Ok(());
    }

    let port = port();
    let server = Arc::new(
        Server::http(("127.0.0.1", port))
            .map_err(|error| format!("could not bind 127.0.0.1:{port}: {error}"))?,
    );

    let owned = Arc::clone(&server);
    let worker = thread::Builder::new()
        .name("nemora-widget-server".to_owned())
        .spawn(move || {
            for request in owned.incoming_requests() {
                handle(request);
            }
        })
        .map_err(|error| format!("could not start the widget server thread: {error}"))?;

    *slot = Some(Running { server, worker });
    Ok(())
}

#[tauri::command]
pub async fn widget_set_enabled(enabled: bool) -> Result<(), String> {
    set_enabled(enabled)
}

#[cfg(test)]
mod tests {
    use super::{apply_state, art_source_from, set_enabled, ArtSource, UpNext, WidgetStateInput};
    use std::{
        io::{Read, Write},
        net::TcpStream,
        thread,
        time::Duration,
    };

    #[test]
    fn local_artwork_urls_decode_back_to_paths() {
        assert_eq!(
            art_source_from(Some(
                "http://nemora.localhost/E%3A%5CMusic%5Ccover%20art.jpg".to_owned()
            )),
            ArtSource::File("E:\\Music\\cover art.jpg".to_owned())
        );
    }

    #[test]
    fn remote_artwork_is_handed_to_the_browser_untouched() {
        assert_eq!(
            art_source_from(Some("https://e-cdns-images.dzcdn.net/cover.jpg".to_owned())),
            ArtSource::Remote("https://e-cdns-images.dzcdn.net/cover.jpg".to_owned())
        );
    }

    #[test]
    fn bundled_and_empty_artwork_fall_back_to_the_widget_placeholder() {
        assert_eq!(art_source_from(None), ArtSource::None);
        assert_eq!(art_source_from(Some("  ".to_owned())), ArtSource::None);
        assert_eq!(
            art_source_from(Some("/assets/song_cover_default.webp".to_owned())),
            ArtSource::None
        );
    }

    /// One raw HTTP/1.1 GET, because the point of this test is what a Browser
    /// Source would actually receive off the socket.
    fn get(port: u16, path: &str) -> (String, Vec<u8>) {
        let mut last_error = String::new();
        for _ in 0..50 {
            match TcpStream::connect(("127.0.0.1", port)) {
                Ok(mut socket) => {
                    socket
                        .write_all(
                            format!(
                                "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
                            )
                            .as_bytes(),
                        )
                        .expect("request must be writable");
                    let mut raw = Vec::new();
                    socket
                        .read_to_end(&mut raw)
                        .expect("response must be readable");
                    let split = raw
                        .windows(4)
                        .position(|window| window == b"\r\n\r\n")
                        .expect("response must have a header/body boundary");
                    return (
                        String::from_utf8_lossy(&raw[..split]).into_owned(),
                        raw[split + 4..].to_vec(),
                    );
                }
                Err(error) => {
                    // The server binds on its own thread; a first connection
                    // can beat it to the socket.
                    last_error = error.to_string();
                    thread::sleep(Duration::from_millis(20));
                }
            }
        }
        panic!("widget server never accepted a connection: {last_error}");
    }

    /// End-to-end over a real socket: the page, the state feed, and a cover
    /// read back off disk, which together are everything OBS asks for.
    #[test]
    fn serves_the_page_the_state_and_the_cover() {
        let port = 41239;
        std::env::set_var("NEMORA_WIDGET_PORT", port.to_string());
        set_enabled(true).expect("the server must bind the test port");

        let (headers, body) = get(port, "/");
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        assert!(headers.contains("text/html"), "{headers}");
        assert!(String::from_utf8_lossy(&body).contains("id=\"line2\""));

        let cover = std::env::temp_dir().join("nemora-widget-test-cover.png");
        std::fs::write(&cover, b"not really a png, but bytes are bytes")
            .expect("temp cover must be writable");
        let encoded = percent_encoding::utf8_percent_encode(
            &cover.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();

        apply_state(WidgetStateInput {
            title: Some("Going Back".to_owned()),
            artists: Some("Monroe".to_owned()),
            playing: true,
            up_next: Some(UpNext {
                title: "SLEEPLESS".to_owned(),
                artist: Some("enable secret".to_owned()),
                extra: 0,
            }),
            art: Some(format!("http://nemora.localhost/{encoded}")),
        })
        .expect("state push must be accepted");

        let (headers, body) = get(port, "/state");
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        let state: serde_json::Value = serde_json::from_slice(&body).expect("state must be JSON");
        assert_eq!(state["title"], "Going Back");
        assert_eq!(state["artists"], "Monroe");
        assert_eq!(state["upNext"]["title"], "SLEEPLESS");
        assert_eq!(state["upNext"]["artist"], "enable secret");
        let first_art = state["art"]
            .as_str()
            .expect("a local cover must be offered through /art")
            .to_owned();
        // The URL names this run, not just a counter: a counter alone restarts
        // at one on every launch, and the browser - told the answer is
        // immutable - then reuses the PREVIOUS session's picture under it.
        assert!(first_art.starts_with("/art?v="), "{first_art}");
        assert!(first_art.ends_with("-1"), "{first_art}");
        let version = state["version"].as_u64().expect("version must be a number");

        // A push that changes nothing must not move `version`, or the widget
        // replays its entrance animation on every poll.
        apply_state(WidgetStateInput {
            title: Some("Going Back".to_owned()),
            artists: Some("Monroe".to_owned()),
            playing: true,
            up_next: Some(UpNext {
                title: "SLEEPLESS".to_owned(),
                artist: Some("enable secret".to_owned()),
                extra: 0,
            }),
            art: Some(format!("http://nemora.localhost/{encoded}")),
        })
        .expect("state push must be accepted");
        let (_, body) = get(port, "/state");
        let repeat: serde_json::Value = serde_json::from_slice(&body).expect("state must be JSON");
        assert_eq!(repeat["version"].as_u64(), Some(version));

        let (headers, body) = get(port, &first_art);
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        assert!(headers.contains("image/png"), "{headers}");
        assert_eq!(body, b"not really a png, but bytes are bytes");

        // A cover is answered by the version that was ASKED for, not by
        // whatever is playing when the request lands. Skipping a track while
        // the widget is still fetching the previous cover used to hand it the
        // new picture under the old URL, and `immutable` made that stick.
        let second = std::env::temp_dir().join("nemora-widget-test-cover-2.png");
        std::fs::write(&second, b"the cover of the NEXT song")
            .expect("temp cover must be writable");
        let second_encoded = percent_encoding::utf8_percent_encode(
            &second.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        apply_state(WidgetStateInput {
            title: Some("Overclocked".to_owned()),
            artists: Some("MXRCURY".to_owned()),
            playing: true,
            up_next: None,
            art: Some(format!("http://nemora.localhost/{second_encoded}")),
        })
        .expect("state push must be accepted");

        let (_, body) = get(port, "/state");
        let moved_on: serde_json::Value =
            serde_json::from_slice(&body).expect("state must be JSON");
        let second_art = moved_on["art"]
            .as_str()
            .expect("a local cover must be offered through /art")
            .to_owned();
        assert_ne!(second_art, first_art);

        let (headers, body) = get(port, &first_art);
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        assert_eq!(
            body, b"not really a png, but bytes are bytes",
            "an in-flight request for the previous cover must still get that cover"
        );
        let (_, body) = get(port, &second_art);
        assert_eq!(body, b"the cover of the NEXT song");

        // A URL left in the browser cache by an earlier run of the app must
        // never resolve to whatever happens to sit at that number now. It is
        // unknown, so the answer is the cover that is actually playing.
        let (headers, body) = get(port, "/art?v=0-1");
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        assert_eq!(body, b"the cover of the NEXT song");

        let (headers, _) = get(port, "/nope");
        assert!(headers.starts_with("HTTP/1.1 404"), "{headers}");

        // Turning the preference off has to close the socket, not just stop
        // answering: an open port is exactly what the default-off setting is
        // there to avoid. And it must be closed by the time the call returns,
        // with no grace period, or unticking the box and ticking it straight
        // back fails on a port that is still on its way down.
        set_enabled(false).expect("the server must stop");
        assert!(
            TcpStream::connect(("127.0.0.1", port)).is_err(),
            "the port must be free the moment the widget is disabled"
        );

        // The toggle is the whole feature: off and on again, immediately, with
        // no restart of anything.
        set_enabled(true).expect("the server must bind again");
        set_enabled(true).expect("enabling twice must be harmless");
        let (headers, _) = get(port, "/state");
        assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
        set_enabled(false).expect("the server must stop");
        set_enabled(false).expect("disabling twice must be harmless");

        let _ = std::fs::remove_file(&cover);
        let _ = std::fs::remove_file(&second);
    }
}
