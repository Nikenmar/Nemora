//! Window geometry, including the monitor-straddle clamp.
//!
//! All coordinates in this module are physical pixels. Mixing logical and
//! physical units is precisely what makes restored mixed-DPI geometry unsafe.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A monitor's usable desktop rectangle in physical pixels.
///
/// `scale_factor` is retained with the plain geometry so callers cannot
/// accidentally convert an already-physical rectangle a second time. The
/// clamp intentionally does not scale either rectangle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorRect {
    pub work_area: Rect,
    pub scale_factor: f64,
}

fn right(rect: Rect) -> i64 {
    i64::from(rect.x) + i64::from(rect.width)
}

fn bottom(rect: Rect) -> i64 {
    i64::from(rect.y) + i64::from(rect.height)
}

fn intersection_area(a: Rect, b: Rect) -> u64 {
    let width = (right(a).min(right(b)) - i64::from(a.x).max(i64::from(b.x))).max(0);
    let height = (bottom(a).min(bottom(b)) - i64::from(a.y).max(i64::from(b.y))).max(0);
    u64::try_from(width)
        .unwrap_or(0)
        .saturating_mul(u64::try_from(height).unwrap_or(0))
}

/// Squared distance from the candidate centre to a work-area rectangle.
/// Coordinates are doubled so half-pixel centres remain exact integers.
fn centre_distance_squared(candidate: Rect, work_area: Rect) -> i128 {
    let centre_x = i128::from(candidate.x) * 2 + i128::from(candidate.width);
    let centre_y = i128::from(candidate.y) * 2 + i128::from(candidate.height);
    let left = i128::from(work_area.x) * 2;
    let top = i128::from(work_area.y) * 2;
    let right = i128::from(right(work_area)) * 2;
    let bottom = i128::from(bottom(work_area)) * 2;

    let dx = if centre_x < left {
        left - centre_x
    } else if centre_x > right {
        centre_x - right
    } else {
        0
    };
    let dy = if centre_y < top {
        top - centre_y
    } else if centre_y > bottom {
        centre_y - bottom
    } else {
        0
    };
    dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
}

fn contains(outer: Rect, inner: Rect) -> bool {
    i64::from(inner.x) >= i64::from(outer.x)
        && i64::from(inner.y) >= i64::from(outer.y)
        && right(inner) <= right(outer)
        && bottom(inner) <= bottom(outer)
}

fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

fn to_i32_saturating(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// Returns a rectangle wholly inside one monitor work area.
///
/// The monitor with the largest intersection wins. If the candidate is fully
/// off-screen, the nearest work area to its centre wins. Ties preserve monitor
/// enumeration order, which makes a true 50/50 straddle deterministic.
pub fn clamp_rect(rect: Rect, monitors: &[MonitorRect]) -> Option<Rect> {
    if monitors.is_empty() {
        return None;
    }

    if monitors
        .iter()
        .any(|monitor| contains(monitor.work_area, rect))
    {
        return Some(rect);
    }

    let mut selected = 0usize;
    let mut best_area = intersection_area(rect, monitors[0].work_area);
    for (index, monitor) in monitors.iter().enumerate().skip(1) {
        let area = intersection_area(rect, monitor.work_area);
        if area > best_area {
            selected = index;
            best_area = area;
        }
    }

    if best_area == 0 {
        let mut best_distance = centre_distance_squared(rect, monitors[0].work_area);
        selected = 0;
        for (index, monitor) in monitors.iter().enumerate().skip(1) {
            let distance = centre_distance_squared(rect, monitor.work_area);
            if distance < best_distance {
                selected = index;
                best_distance = distance;
            }
        }
    }

    let work = monitors[selected].work_area;
    let width = rect.width.min(work.width);
    let height = rect.height.min(work.height);
    let min_x = i64::from(work.x);
    let min_y = i64::from(work.y);
    let max_x = right(work) - i64::from(width);
    let max_y = bottom(work) - i64::from(height);

    Some(Rect {
        x: to_i32_saturating(clamp_i64(i64::from(rect.x), min_x, max_x)),
        y: to_i32_saturating(clamp_i64(i64::from(rect.y), min_y, max_y)),
        width,
        height,
    })
}

#[cfg(windows)]
mod platform {
    use super::{MonitorRect, Rect};
    use std::mem::size_of;
    use windows::{
        core::BOOL,
        Win32::{
            Foundation::{HWND, LPARAM, RECT},
            Graphics::Gdi::{
                EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR,
                MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
            },
        },
    };

    unsafe fn work_area(hmonitor: HMONITOR) -> Option<MonitorRect> {
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(hmonitor, &mut info).as_bool() {
            return None;
        }
        let RECT {
            left,
            top,
            right,
            bottom,
        } = info.rcWork;
        if right <= left || bottom <= top {
            return None;
        }
        Some(MonitorRect {
            work_area: Rect {
                x: left,
                y: top,
                width: u32::try_from(i64::from(right) - i64::from(left)).ok()?,
                height: u32::try_from(i64::from(bottom) - i64::from(top)).ok()?,
            },
            // `rcWork` is already expressed in physical desktop pixels. No
            // scale conversion is required or permitted here.
            scale_factor: 1.0,
        })
    }

    unsafe extern "system" fn enumerate_monitor(
        monitor: HMONITOR,
        _dc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(data.0 as *mut Vec<MonitorRect>);
        if let Some(area) = work_area(monitor) {
            monitors.push(area);
        }
        true.into()
    }

    pub fn monitor_work_areas(hwnd: HWND) -> Result<Vec<MonitorRect>, String> {
        let mut monitors = Vec::new();
        let ok = unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(enumerate_monitor),
                LPARAM((&mut monitors as *mut Vec<MonitorRect>) as isize),
            )
        };
        if ok.as_bool() && !monitors.is_empty() {
            return Ok(monitors);
        }

        // Enumeration failure is rare, but a primary-monitor fallback keeps a
        // recoverable saved rectangle from becoming an unbounded one.
        let primary = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY) };
        unsafe { work_area(primary) }
            .map(|monitor| vec![monitor])
            .ok_or_else(|| "Windows did not return a usable monitor work area".to_owned())
    }
}

/// Returns a rectangle fully contained in one current monitor's work area.
#[tauri::command]
pub async fn clamp_rect_to_single_monitor(
    window: tauri::Window,
    rect: Rect,
) -> Result<Rect, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let monitors = platform::monitor_work_areas(hwnd)?;
        return clamp_rect(rect, &monitors)
            .ok_or_else(|| "no usable monitor work area was found".to_owned());
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(rect)
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_rect, MonitorRect, Rect};

    fn monitor(x: i32, y: i32, width: u32, height: u32, scale_factor: f64) -> MonitorRect {
        MonitorRect {
            work_area: Rect {
                x,
                y,
                width,
                height,
            },
            scale_factor,
        }
    }

    #[test]
    fn leaves_a_rect_fully_inside_one_work_area_unchanged() {
        let rect = Rect {
            x: -1700,
            y: 120,
            width: 1200,
            height: 700,
        };
        let monitors = [
            monitor(-1920, 0, 1920, 1040, 1.25),
            monitor(0, 0, 2560, 1400, 1.5),
        ];
        assert_eq!(clamp_rect(rect, &monitors), Some(rect));
    }

    #[test]
    fn fixes_the_observed_minus_1928_overhang() {
        let rect = Rect {
            x: -1928,
            y: 100,
            width: 1280,
            height: 700,
        };
        let monitors = [
            monitor(-1920, 0, 1920, 1040, 1.0),
            monitor(0, 0, 1920, 1040, 1.0),
        ];
        assert_eq!(clamp_rect(rect, &monitors), Some(Rect { x: -1920, ..rect }));
    }

    #[test]
    fn chooses_the_monitor_with_the_largest_intersection() {
        let rect = Rect {
            x: -300,
            y: 50,
            width: 1000,
            height: 700,
        };
        let monitors = [
            monitor(-1920, 0, 1920, 1040, 1.0),
            monitor(0, 0, 1920, 1040, 1.5),
        ];
        assert_eq!(clamp_rect(rect, &monitors), Some(Rect { x: 0, ..rect }));
    }

    #[test]
    fn respects_the_work_area_instead_of_full_monitor_bounds() {
        let rect = Rect {
            x: 100,
            y: 500,
            width: 1000,
            height: 600,
        };
        let monitors = [monitor(0, 0, 1920, 1040, 1.0)];
        assert_eq!(clamp_rect(rect, &monitors), Some(Rect { y: 440, ..rect }));
    }

    #[test]
    fn shrinks_a_rect_larger_than_the_target_work_area() {
        let rect = Rect {
            x: -2500,
            y: -500,
            width: 4000,
            height: 2200,
        };
        let monitors = [monitor(-1920, 0, 1920, 1040, 1.25)];
        assert_eq!(
            clamp_rect(rect, &monitors),
            Some(Rect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040,
            })
        );
    }

    #[test]
    fn chooses_the_nearest_monitor_for_a_fully_offscreen_rect() {
        let rect = Rect {
            x: 5000,
            y: 200,
            width: 800,
            height: 600,
        };
        let monitors = [
            monitor(-1920, 0, 1920, 1040, 1.0),
            monitor(0, 0, 1920, 1040, 1.0),
        ];
        assert_eq!(
            clamp_rect(rect, &monitors),
            Some(Rect {
                x: 1120,
                y: 200,
                ..rect
            })
        );
    }

    #[test]
    fn handles_a_monitor_above_the_primary() {
        let rect = Rect {
            x: 200,
            y: -1300,
            width: 900,
            height: 700,
        };
        let monitors = [
            monitor(0, 0, 1920, 1040, 1.0),
            monitor(0, -1200, 1920, 1160, 1.5),
        ];
        assert_eq!(clamp_rect(rect, &monitors), Some(Rect { y: -1200, ..rect }));
    }

    #[test]
    fn mixed_dpi_factors_do_not_rescale_physical_rectangles() {
        let rect = Rect {
            x: 1950,
            y: 100,
            width: 1200,
            height: 700,
        };
        let monitors = [
            monitor(0, 0, 1920, 1040, 1.0),
            monitor(1920, 0, 2560, 1400, 2.0),
        ];
        assert_eq!(clamp_rect(rect, &monitors), Some(rect));
    }

    #[test]
    fn a_true_fifty_fifty_straddle_uses_enumeration_order() {
        let rect = Rect {
            x: -400,
            y: 100,
            width: 800,
            height: 600,
        };
        let monitors = [
            monitor(-1920, 0, 1920, 1040, 1.0),
            monitor(0, 0, 1920, 1040, 1.0),
        ];
        assert_eq!(clamp_rect(rect, &monitors), Some(Rect { x: -800, ..rect }));
    }

    #[test]
    fn reports_absent_monitor_geometry() {
        let rect = Rect {
            x: 10,
            y: 20,
            width: 800,
            height: 600,
        };
        assert_eq!(clamp_rect(rect, &[]), None);
    }
}
