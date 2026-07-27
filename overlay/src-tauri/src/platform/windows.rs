//! Win32 implementation of the native-window boundary.
//!
//! Capture remains on the repository's existing `xcap` backend. These APIs only
//! establish authority and a physical client-area target. `xcap` capture and
//! Windows.Media.Ocr are synchronous OS calls: `spawn_blocking` keeps them off
//! the async runtime but does not cancel them. Logical timeouts therefore
//! publish uncertainty while native ownership remains bounded until settlement.

use super::{
    discover_game_capture_target, observe_foreground, CaptureTarget, MonitorObservation,
    NativeWindowAdapter, PlatformFailureReason, PlatformForegroundObservation, WindowObservation,
};
use crate::{calibration::Rect, foreground};
use std::{ffi::c_void, path::Path};
use windows::{
    core::{BOOL, PWSTR},
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Gdi::{
                ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO,
                MONITOR_DEFAULTTONEAREST,
            },
        },
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::{
            HiDpi::GetDpiForWindow,
            WindowsAndMessaging::{
                EnumWindows, GetClientRect, GetForegroundWindow, GetWindowThreadProcessId,
                IsIconic, IsWindow, IsWindowVisible,
            },
        },
    },
};

pub struct Win32WindowAdapter;

fn raw_handle(hwnd: HWND) -> u64 {
    hwnd.0 as usize as u64
}

fn hwnd_from_raw(handle: u64) -> HWND {
    HWND(handle as usize as *mut c_void)
}

fn process_path(process_id: u32) -> Option<String> {
    let process =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
    let mut buffer = [0u16; 32_768];
    let mut length = buffer.len() as u32;
    let ok = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
        .is_ok()
    };
    unsafe {
        let _ = CloseHandle(process);
    }
    ok.then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

fn client_rect(hwnd: HWND) -> Option<Rect> {
    let mut client = RECT::default();
    unsafe { GetClientRect(hwnd, &mut client) }.ok()?;
    let mut origin = POINT {
        x: client.left,
        y: client.top,
    };
    if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
        return None;
    }
    let width = client.right.checked_sub(client.left)?.try_into().ok()?;
    let height = client.bottom.checked_sub(client.top)?.try_into().ok()?;
    Some(Rect {
        x: origin.x,
        y: origin.y,
        width,
        height,
    })
}

fn monitor(hwnd: HWND) -> Option<MonitorObservation> {
    let handle = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if handle.is_invalid() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(handle, &mut info) }.as_bool() {
        return None;
    }
    let rect = info.rcMonitor;
    Some(MonitorObservation {
        handle: handle.0 as usize as u64,
        rect: Rect {
            x: rect.left,
            y: rect.top,
            width: rect.right.checked_sub(rect.left)?.try_into().ok()?,
            height: rect.bottom.checked_sub(rect.top)?.try_into().ok()?,
        },
    })
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    }
    .is_ok()
        && cloaked != 0
}

fn snapshot(hwnd: HWND) -> WindowObservation {
    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }
    let executable_path = (process_id != 0)
        .then(|| process_path(process_id))
        .flatten();
    let process_name = executable_path
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    WindowObservation {
        handle: raw_handle(hwnd),
        process_id,
        is_game_process: process_id != 0
            && foreground::is_actual_game_process(process_name, executable_path.as_deref()),
        is_league_client_process: process_id != 0
            && foreground::is_league_client_ux_process(process_name, executable_path.as_deref()),
        is_riot_client_process: process_id != 0
            && foreground::is_riot_client_process(process_name, executable_path.as_deref()),
        valid: unsafe { IsWindow(Some(hwnd)) }.as_bool(),
        visible: unsafe { IsWindowVisible(hwnd) }.as_bool(),
        minimized: unsafe { IsIconic(hwnd) }.as_bool(),
        cloaked: is_cloaked(hwnd),
        client_rect: client_rect(hwnd),
        monitor: monitor(hwnd),
        dpi: {
            let dpi = unsafe { GetDpiForWindow(hwnd) };
            (dpi > 0).then_some(dpi)
        },
    }
}

impl NativeWindowAdapter for Win32WindowAdapter {
    fn foreground_handle(&self) -> Option<u64> {
        let hwnd = unsafe { GetForegroundWindow() };
        (!hwnd.0.is_null()).then(|| raw_handle(hwnd))
    }

    fn enumerate_windows(&self) -> Result<Vec<WindowObservation>, PlatformFailureReason> {
        unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let observations = unsafe { &mut *(lparam.0 as *mut Vec<WindowObservation>) };
            observations.push(snapshot(hwnd));
            BOOL(1)
        }

        let mut observations = Vec::new();
        unsafe {
            EnumWindows(
                Some(callback),
                LPARAM((&mut observations as *mut Vec<WindowObservation>) as isize),
            )
        }
        .map_err(|_| PlatformFailureReason::NativeEnumerationFailed)?;
        Ok(observations)
    }
}

pub fn foreground_observation() -> PlatformForegroundObservation {
    observe_foreground(&Win32WindowAdapter)
}

pub fn foreground_capture_target() -> Result<CaptureTarget, PlatformFailureReason> {
    let observation = foreground_observation();
    observation.target.ok_or_else(|| {
        observation
            .failure
            .unwrap_or(PlatformFailureReason::ForegroundNotGame)
    })
}

pub fn discover_capture_target() -> Result<CaptureTarget, PlatformFailureReason> {
    discover_game_capture_target(&Win32WindowAdapter)
}

pub fn capture_target_is_current(generation: &str) -> bool {
    foreground_capture_target()
        .map(|target| target.generation() == generation)
        .unwrap_or(false)
}

#[allow(dead_code)]
fn _round_trip_hwnd_for_type_check(handle: u64) -> HWND {
    hwnd_from_raw(handle)
}
