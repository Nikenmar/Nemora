//! Dragging a song's file out of the window and into another application.
//!
//! A webview cannot do this. HTML5 drag-and-drop never leaves the browser, and
//! Chromium's `DownloadURL` trick produces a *download* at the drop location,
//! which is not what a sampler or a file manager is waiting for: they want a
//! real OLE drag carrying `CF_HDROP` - the same thing Explorer hands out, and
//! the same thing FL Studio expects when you pull a sample out of its browser.
//! So the shell owns the gesture and the renderer only says "start now".
//!
//! Two things about the platform shape this file:
//!
//!   * **`DoDragDrop` is modal and belongs to the thread that owns the window.**
//!     It runs its own message loop and does not return until the drop (or the
//!     cancel) happens, so the call is dispatched to the main thread and the
//!     command returns immediately - the renderer must not be left awaiting an
//!     IPC reply for as long as the user keeps the mouse down.
//!   * **The drag image goes through WIC**, whose WebP support is an optional
//!     Windows component. Nemora stores every cover as WebP, so handing the
//!     artwork over as a path would leave a large share of machines dragging a
//!     blank ghost. The cover is therefore decoded here and re-encoded as PNG,
//!     which WIC has always understood.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use drag::{DragItem, Image, Options};
use image::{imageops::FilterType, DynamicImage, ImageFormat, Rgba, RgbaImage};
use tauri::{AppHandle, Manager};

/// Edge of the drag ghost, in pixels. Explorer's own drag images sit around
/// this size, and it is what the cover is scaled to.
const DRAG_IMAGE_EDGE: u32 = 128;

/// The ghost shown when a song has no usable cover: the app's own dark square,
/// rather than nothing at all. `start_drag` has no "no image" option, and a
/// failed decode would otherwise drag an empty rectangle.
fn placeholder_image() -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(
        DRAG_IMAGE_EDGE,
        DRAG_IMAGE_EDGE,
        Rgba([0x21, 0x22, 0x26, 0xff]),
    ))
}

/// Builds the PNG bytes for the drag ghost from the renderer's artwork URL.
fn drag_image(artwork: Option<String>) -> Vec<u8> {
    let decoded = artwork
        .as_deref()
        .and_then(crate::protocol::local_path_from_asset_url)
        .and_then(|path| image::open(Path::new(&path)).ok())
        .map(|cover| {
            // `thumbnail` rather than `resize`: covers are large (1200px is
            // normal) and this runs while the user is holding the mouse down.
            cover.thumbnail(DRAG_IMAGE_EDGE, DRAG_IMAGE_EDGE)
        })
        .unwrap_or_else(placeholder_image);

    let mut bytes = Vec::new();
    if decoded
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .is_err()
    {
        bytes.clear();
        let _ = placeholder_image()
            .resize_exact(DRAG_IMAGE_EDGE, DRAG_IMAGE_EDGE, FilterType::Nearest)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png);
    }
    bytes
}

/// Starts a native drag of `paths`, showing `artwork` as the ghost.
///
/// Called from the renderer while the mouse button is still down; the OS takes
/// the gesture over from there.
#[tauri::command]
pub async fn start_file_drag(
    app: AppHandle,
    paths: Vec<String>,
    artwork: Option<String>,
) -> Result<(), String> {
    // A path that no longer exists must not reach `DoDragDrop`: the drop target
    // would be handed a name it cannot open, and the failure would surface in
    // the OTHER application, where it looks like that app's bug.
    let files: Vec<PathBuf> = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .collect();

    if files.is_empty() {
        return Err("no existing file to drag".to_owned());
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "the main window is unavailable".to_owned())?;
    let image = Image::Raw(drag_image(artwork));

    // Dispatched, not awaited: see the module comment. Anything that goes wrong
    // inside is a failed drag, which the user sees as "nothing happened" - the
    // log is the only place it can be reported from here.
    app.run_on_main_thread(move || {
        if let Err(error) = drag::start_drag(
            &window,
            DragItem::Files(files),
            image,
            |_result, _cursor| {},
            Options::default(),
        ) {
            eprintln!("[nemora] dragging the file out failed: {error}");
        }
    })
    .map_err(|error| format!("could not start the drag: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{drag_image, DRAG_IMAGE_EDGE};

    #[test]
    fn a_song_without_a_usable_cover_still_gets_a_ghost() {
        // `start_drag` takes an image, not an option, so every path through
        // here has to produce decodable PNG bytes.
        for artwork in [
            None,
            Some(String::new()),
            Some("https://an-online-cover.example/art.jpg".to_owned()),
            Some("http://nemora.localhost/E%3A%5Cnope%5Cmissing.webp".to_owned()),
        ] {
            let bytes = drag_image(artwork);
            let decoded = image::load_from_memory(&bytes).expect("the ghost must be decodable");
            assert_eq!(decoded.width(), DRAG_IMAGE_EDGE);
            assert_eq!(decoded.height(), DRAG_IMAGE_EDGE);
        }
    }

    #[test]
    fn a_real_cover_is_scaled_down_and_re_encoded_as_png() {
        // WebP in, PNG out: WIC cannot be relied on to decode WebP, which is
        // what every cover in the library is stored as.
        let source = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            600,
            600,
            image::Rgb([10, 200, 90]),
        ));
        let cover = std::env::temp_dir().join("nemora-drag-test-cover.webp");
        source.save(&cover).expect("the cover must be writable");

        let encoded = percent_encoding::utf8_percent_encode(
            &cover.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();

        let bytes = drag_image(Some(format!("http://nemora.localhost/{encoded}")));
        assert_eq!(
            image::guess_format(&bytes).expect("the ghost must have a format"),
            image::ImageFormat::Png
        );
        let decoded = image::load_from_memory(&bytes).expect("the ghost must be decodable");
        assert!(decoded.width() <= DRAG_IMAGE_EDGE && decoded.height() <= DRAG_IMAGE_EDGE);
        assert!(decoded.width() > 1, "the cover must survive the scaling");

        let _ = std::fs::remove_file(&cover);
    }
}
