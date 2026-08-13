//! Paints the strip Windows exposes while WebView2 is still catching up.
//!
//! Dragging a window edge moves the frame immediately; the WebView2 surface is
//! composited by another process and arrives a frame or more later. Whatever
//! the user drags past is therefore the window's own client area, and what it
//! shows depends entirely on who paints it:
//!
//!   * nobody, on an opaque window  -> black, which is what this fixes;
//!   * nobody, on a transparent one -> a hole with the desktop behind it;
//!   * this module                  -> the application's own background.
//!
//! Everything reachable from Tauri was tried first and none of it lands here.
//! `backgroundColor` in `tauri.conf.json` colours the window object,
//! `WebviewWindow::set_background_color` returns `Ok` and colours the window
//! and webview layers - the strip stayed black through all of it, because it is
//! painted in answer to `WM_ERASEBKGND`, a message Tauri does not expose.
//!
//! Windows is the right place for this and not a new place: `taskbar.rs`
//! already subclasses this same window for its thumbbar buttons. This uses its
//! own subclass id, so the two chain instead of fighting.

#[cfg(windows)]
mod windows_impl {
    use std::sync::OnceLock;

    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateSolidBrush, FillRect, HBRUSH, HDC};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
    use windows::Win32::UI::WindowsAndMessaging::WM_ERASEBKGND;

    /// Distinct from the taskbar subclass on the same window.
    const SUBCLASS_ID: usize = 0x4e454d31; // "NEM1"

    /// The brush outlives the window deliberately.
    ///
    /// It is created once and never destroyed: it is referenced by a window
    /// procedure that can run at any time until the process ends, and freeing a
    /// GDI object that a paint is still using is a far worse bug than one brush
    /// held for the life of the app.
    static BRUSH: OnceLock<usize> = OnceLock::new();

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _data: usize,
    ) -> LRESULT {
        if message == WM_ERASEBKGND {
            if let Some(brush) = BRUSH.get() {
                let mut rect = RECT::default();
                if GetClientRect(hwnd, &mut rect).is_ok() {
                    // wParam of WM_ERASEBKGND is the device context to paint in.
                    let hdc = HDC(wparam.0 as *mut core::ffi::c_void);
                    FillRect(hdc, &rect, HBRUSH(*brush as *mut core::ffi::c_void));
                }
            }
            // Non-zero means "erased"; returning 0 would let the default
            // procedure paint over it with the class brush.
            return LRESULT(1);
        }

        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    /// `colour` is 0xRRGGBB, as it is written in the stylesheet.
    pub fn install(hwnd: HWND, colour: u32) -> Result<(), String> {
        // COLORREF is 0x00BBGGRR, the reverse of the CSS byte order.
        let red = (colour >> 16) & 0xff;
        let green = (colour >> 8) & 0xff;
        let blue = colour & 0xff;
        let brush = unsafe { CreateSolidBrush(COLORREF(blue << 16 | green << 8 | red)) };
        if brush.is_invalid() {
            return Err("could not create the window background brush".to_owned());
        }
        let _ = BRUSH.set(brush.0 as usize);

        let installed =
            unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) }.as_bool();
        if !installed {
            return Err("SetWindowSubclass failed for the window backdrop".to_owned());
        }
        Ok(())
    }
}

/// Paints the window's own background so a resize never shows bare black.
///
/// A no-op off Windows, where the artefact does not exist.
pub fn install(window: &tauri::WebviewWindow, colour: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window
            .hwnd()
            .map_err(|error| format!("no window handle: {error}"))?;
        windows_impl::install(hwnd, colour)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, colour);
        Ok(())
    }
}
