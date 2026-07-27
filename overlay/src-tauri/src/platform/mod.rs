//! Narrow native-window boundary used by capture authority and calibration.
//!
//! Shared lifecycle, offer, reroll, OCR-owner, and rendering state machines do
//! not belong here. Platform adapters reduce native windows to these bounded
//! observations; pure selection then decides whether capture is authorized.

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use crate::calibration::Rect;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "windows")]
pub mod windows;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlatformFailureReason {
    NoForegroundWindow,
    ForegroundWindowInvalid,
    ForegroundNotGame,
    WindowHidden,
    WindowMinimized,
    WindowCloaked,
    ClientRectUnavailable,
    EmptyClientArea,
    MonitorUnavailable,
    DpiUnavailable,
    NativeEnumerationFailed,
    CaptureTargetChanged,
}

impl PlatformFailureReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoForegroundWindow => "no-foreground-window",
            Self::ForegroundWindowInvalid => "foreground-window-invalid",
            Self::ForegroundNotGame => "foreground-not-game",
            Self::WindowHidden => "window-hidden",
            Self::WindowMinimized => "window-minimized",
            Self::WindowCloaked => "window-cloaked",
            Self::ClientRectUnavailable => "client-rect-unavailable",
            Self::EmptyClientArea => "empty-client-area",
            Self::MonitorUnavailable => "monitor-unavailable",
            Self::DpiUnavailable => "dpi-unavailable",
            Self::NativeEnumerationFailed => "native-enumeration-failed",
            Self::CaptureTargetChanged => "capture-target-changed",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MonitorObservation {
    /// Native monitor identity. This never leaves Rust un-hashed.
    pub handle: u64,
    /// Physical virtual-desktop coordinates; origins may be negative.
    pub rect: Rect,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WindowObservation {
    /// Native window identity. This never leaves Rust un-hashed.
    pub handle: u64,
    pub process_id: u32,
    pub is_game_process: bool,
    pub is_league_client_process: bool,
    pub is_riot_client_process: bool,
    pub valid: bool,
    pub visible: bool,
    pub minimized: bool,
    pub cloaked: bool,
    /// Client-area bounds in physical virtual-desktop coordinates.
    pub client_rect: Option<Rect>,
    pub monitor: Option<MonitorObservation>,
    pub dpi: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CaptureTarget {
    pub window_handle: u64,
    pub process_id: u32,
    pub client_rect: Rect,
    pub monitor: MonitorObservation,
    pub dpi: u32,
}

impl CaptureTarget {
    pub fn scale_factor(&self) -> f64 {
        self.dpi as f64 / 96.0
    }

    /// Privacy-safe target generation. Raw HWND, PID, monitor handle and
    /// coordinates remain native-only; callers compare this irreversible digest
    /// to invalidate late results after a move, resize, DPI, monitor, or HWND
    /// transition.
    pub fn generation(&self) -> String {
        let mut digest = Sha256::new();
        for value in [
            self.window_handle,
            self.process_id as u64,
            self.client_rect.x as i64 as u64,
            self.client_rect.y as i64 as u64,
            self.client_rect.width as u64,
            self.client_rect.height as u64,
            self.monitor.handle,
            self.monitor.rect.x as i64 as u64,
            self.monitor.rect.y as i64 as u64,
            self.monitor.rect.width as u64,
            self.monitor.rect.height as u64,
            self.dpi as u64,
        ] {
            digest.update(value.to_le_bytes());
        }
        format!("t{}", hex::encode(&digest.finalize()[..12]))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlatformForegroundObservation {
    pub foreground_handle: Option<u64>,
    pub foreground_process_id: Option<u32>,
    pub foreground_is_game_process: bool,
    pub foreground_is_league_client_process: bool,
    pub foreground_is_riot_client_process: bool,
    pub game_window_detected: bool,
    pub target: Option<CaptureTarget>,
    pub failure: Option<PlatformFailureReason>,
}

pub trait NativeWindowAdapter {
    fn foreground_handle(&self) -> Option<u64>;
    fn enumerate_windows(&self) -> Result<Vec<WindowObservation>, PlatformFailureReason>;
}

fn target_from_window(window: &WindowObservation) -> Result<CaptureTarget, PlatformFailureReason> {
    if !window.valid {
        return Err(PlatformFailureReason::ForegroundWindowInvalid);
    }
    if !window.visible {
        return Err(PlatformFailureReason::WindowHidden);
    }
    if window.minimized {
        return Err(PlatformFailureReason::WindowMinimized);
    }
    if window.cloaked {
        return Err(PlatformFailureReason::WindowCloaked);
    }
    let client_rect = window
        .client_rect
        .clone()
        .ok_or(PlatformFailureReason::ClientRectUnavailable)?;
    if client_rect.width == 0 || client_rect.height == 0 {
        return Err(PlatformFailureReason::EmptyClientArea);
    }
    let monitor = window
        .monitor
        .clone()
        .ok_or(PlatformFailureReason::MonitorUnavailable)?;
    let dpi = window
        .dpi
        .filter(|dpi| *dpi > 0)
        .ok_or(PlatformFailureReason::DpiUnavailable)?;

    Ok(CaptureTarget {
        window_handle: window.handle,
        process_id: window.process_id,
        client_rect,
        monitor,
        dpi,
    })
}

pub fn observe_foreground<A: NativeWindowAdapter>(adapter: &A) -> PlatformForegroundObservation {
    let foreground_handle = adapter.foreground_handle();
    let windows = match adapter.enumerate_windows() {
        Ok(windows) => windows,
        Err(failure) => {
            return PlatformForegroundObservation {
                foreground_handle,
                foreground_process_id: None,
                foreground_is_game_process: false,
                foreground_is_league_client_process: false,
                foreground_is_riot_client_process: false,
                game_window_detected: false,
                target: None,
                failure: Some(failure),
            };
        }
    };
    let game_window_detected = windows.iter().any(|window| window.is_game_process);
    let Some(foreground_handle) = foreground_handle else {
        return PlatformForegroundObservation {
            foreground_handle: None,
            foreground_process_id: None,
            foreground_is_game_process: false,
            foreground_is_league_client_process: false,
            foreground_is_riot_client_process: false,
            game_window_detected,
            target: None,
            failure: Some(PlatformFailureReason::NoForegroundWindow),
        };
    };
    let Some(foreground) = windows
        .iter()
        .find(|window| window.handle == foreground_handle)
    else {
        return PlatformForegroundObservation {
            foreground_handle: Some(foreground_handle),
            foreground_process_id: None,
            foreground_is_game_process: false,
            foreground_is_league_client_process: false,
            foreground_is_riot_client_process: false,
            game_window_detected,
            target: None,
            failure: Some(PlatformFailureReason::ForegroundWindowInvalid),
        };
    };
    if !foreground.is_game_process {
        return PlatformForegroundObservation {
            foreground_handle: Some(foreground_handle),
            foreground_process_id: Some(foreground.process_id),
            foreground_is_game_process: false,
            foreground_is_league_client_process: foreground.is_league_client_process,
            foreground_is_riot_client_process: foreground.is_riot_client_process,
            game_window_detected,
            target: None,
            failure: Some(PlatformFailureReason::ForegroundNotGame),
        };
    }

    match target_from_window(foreground) {
        Ok(target) => PlatformForegroundObservation {
            foreground_handle: Some(foreground_handle),
            foreground_process_id: Some(foreground.process_id),
            foreground_is_game_process: true,
            foreground_is_league_client_process: false,
            foreground_is_riot_client_process: false,
            game_window_detected,
            target: Some(target),
            failure: None,
        },
        Err(failure) => PlatformForegroundObservation {
            foreground_handle: Some(foreground_handle),
            foreground_process_id: Some(foreground.process_id),
            foreground_is_game_process: true,
            foreground_is_league_client_process: false,
            foreground_is_riot_client_process: false,
            game_window_detected,
            target: None,
            failure: Some(failure),
        },
    }
}

/// Discover the largest capturable game client for calibration while preserving
/// the stronger rule that only `observe_foreground(...).target` authorizes an
/// actual capture.
pub fn discover_game_capture_target<A: NativeWindowAdapter>(
    adapter: &A,
) -> Result<CaptureTarget, PlatformFailureReason> {
    let windows = adapter.enumerate_windows()?;
    windows
        .iter()
        .filter(|window| window.is_game_process)
        .filter_map(|window| target_from_window(window).ok())
        .max_by_key(|target| target.client_rect.width as u64 * target.client_rect.height as u64)
        .ok_or(PlatformFailureReason::ForegroundWindowInvalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    struct MockAdapter {
        foreground: Option<u64>,
        windows: Result<Vec<WindowObservation>, PlatformFailureReason>,
    }

    impl NativeWindowAdapter for MockAdapter {
        fn foreground_handle(&self) -> Option<u64> {
            self.foreground
        }

        fn enumerate_windows(&self) -> Result<Vec<WindowObservation>, PlatformFailureReason> {
            self.windows.clone()
        }
    }

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn window(handle: u64, game: bool) -> WindowObservation {
        WindowObservation {
            handle,
            process_id: handle as u32 + 100,
            is_game_process: game,
            is_league_client_process: false,
            is_riot_client_process: false,
            valid: true,
            visible: true,
            minimized: false,
            cloaked: false,
            client_rect: Some(rect(-1920, 120, 1280, 720)),
            monitor: Some(MonitorObservation {
                handle: 99,
                rect: rect(-1920, 0, 1920, 1080),
            }),
            dpi: Some(120),
        }
    }

    #[test]
    fn league_foreground_and_matching_process_authorize_capture() {
        let observation = observe_foreground(&MockAdapter {
            foreground: Some(7),
            windows: Ok(vec![window(7, true)]),
        });
        let target = observation.target.expect("capture authority");
        assert_eq!(target.client_rect, rect(-1920, 120, 1280, 720));
        assert_eq!(target.scale_factor(), 1.25);
        assert_eq!(observation.failure, None);
    }

    #[test]
    fn process_presence_with_another_foreground_window_never_authorizes() {
        let observation = observe_foreground(&MockAdapter {
            foreground: Some(8),
            windows: Ok(vec![window(7, true), window(8, false)]),
        });
        assert!(observation.game_window_detected);
        assert!(observation.target.is_none());
        assert_eq!(
            observation.failure,
            Some(PlatformFailureReason::ForegroundNotGame)
        );
    }

    #[test]
    fn stale_foreground_handle_is_invalidated() {
        let observation = observe_foreground(&MockAdapter {
            foreground: Some(404),
            windows: Ok(vec![window(7, true)]),
        });
        assert!(observation.target.is_none());
        assert_eq!(
            observation.failure,
            Some(PlatformFailureReason::ForegroundWindowInvalid)
        );
    }

    #[test]
    fn minimized_and_cloaked_windows_are_rejected() {
        for (mut candidate, expected) in [
            (window(7, true), PlatformFailureReason::WindowMinimized),
            (window(7, true), PlatformFailureReason::WindowCloaked),
        ] {
            match expected {
                PlatformFailureReason::WindowMinimized => candidate.minimized = true,
                PlatformFailureReason::WindowCloaked => candidate.cloaked = true,
                _ => unreachable!(),
            }
            let observation = observe_foreground(&MockAdapter {
                foreground: Some(7),
                windows: Ok(vec![candidate]),
            });
            assert!(observation.target.is_none());
            assert_eq!(observation.failure, Some(expected));
        }
    }

    #[test]
    fn monitor_or_resolution_transition_changes_target_generation() {
        let first = window(7, true);
        let mut moved = first.clone();
        moved.client_rect = Some(rect(0, -1440, 2560, 1440));
        moved.monitor = Some(MonitorObservation {
            handle: 101,
            rect: rect(0, -1440, 2560, 1440),
        });
        moved.dpi = Some(168);
        let first = target_from_window(&first).unwrap();
        let moved = target_from_window(&moved).unwrap();
        assert_ne!(first.generation(), moved.generation());
    }

    #[test]
    fn common_windows_dpi_values_map_to_expected_scale() {
        for (dpi, scale) in [(96, 1.0), (120, 1.25), (144, 1.5), (168, 1.75), (192, 2.0)] {
            let mut candidate = window(7, true);
            candidate.dpi = Some(dpi);
            let target = target_from_window(&candidate).unwrap();
            assert!((target.scale_factor() - scale).abs() < f64::EPSILON);
        }
    }
}
