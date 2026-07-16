#![allow(unexpected_cfgs)] // objc 0.2 macros emit cfg(cargo-clippy) on current rustc.

use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub mod calibration;
mod collector;
mod foreground;
mod lcu;
pub mod member;
pub mod ocr;
mod sanitize;
mod upload_queue;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LivePlayerData {
    pub champion: String,
    pub level: u32,
    pub is_dead: bool,
    pub game_time: f64,
    pub game_mode: String,
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn detect_league_client() -> bool {
    lcu::discover_lcu_credentials().is_some()
}

#[tauri::command]
async fn get_game_phase() -> Option<String> {
    let credentials = lcu::discover_lcu_credentials()?;
    lcu::read_gameflow_state(&credentials).await.ok()?.raw_phase
}

#[tauri::command]
async fn get_lcu_gameflow_state() -> Option<lcu::GameflowState> {
    let credentials = lcu::discover_lcu_credentials()?;
    lcu::read_gameflow_state(&credentials).await.ok()
}

#[tauri::command]
async fn get_game_hash() -> Option<String> {
    let credentials = lcu::discover_lcu_credentials()?;
    let url = format!(
        "https://127.0.0.1:{}/lol-gameflow/v1/session",
        credentials.port
    );
    let session: serde_json::Value = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .ok()?
        .get(url)
        .basic_auth("riot", Some(&credentials.auth_token))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let game_id = session
        .pointer("/gameData/gameId")
        .or_else(|| session.get("gameId"))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| value.as_u64().map(|number| number.to_string()))
        })?;
    Some(member::hash_game_id(&game_id))
}

#[tauri::command]
async fn get_live_player_data() -> Option<LivePlayerData> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .ok()?;

    // Get active player name
    let active: serde_json::Value = client
        .get("https://127.0.0.1:2999/liveclientdata/activeplayer")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let summoner_name = active
        .get("riotId")
        .or_else(|| active.get("summonerName"))
        .and_then(|v| v.as_str())?
        .to_string();

    let level = active.get("level").and_then(|v| v.as_u64()).unwrap_or(1) as u32;

    // Get player list to find champion
    let players: Vec<serde_json::Value> = client
        .get("https://127.0.0.1:2999/liveclientdata/playerlist")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let me = players.iter().find(|p| {
        p.get("riotId")
            .or_else(|| p.get("summonerName"))
            .and_then(|v| v.as_str())
            .map_or(false, |n| n == summoner_name)
    })?;

    // Prefer rawChampionName (always English internal ID like "Varus")
    // Fall back to championName (may be localized like "法洛士")
    let champion = me
        .get("rawChampionName")
        .and_then(|v| v.as_str())
        .map(|s| {
            // rawChampionName format: "game_character_displayname_Varus"
            // Strip the prefix to get just the champion name
            s.rsplit('_').next().unwrap_or(s).to_string()
        })
        .unwrap_or_else(|| {
            me.get("championName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        });
    let is_dead = me.get("isDead").and_then(|v| v.as_bool()).unwrap_or(false);

    // Get game data for time and mode
    let game_data: serde_json::Value = client
        .get("https://127.0.0.1:2999/liveclientdata/gamestats")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let game_time = game_data
        .get("gameTime")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let game_mode = game_data
        .get("gameMode")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Some(LivePlayerData {
        champion,
        level,
        is_dead,
        game_time,
        game_mode,
    })
}

// ─── OCR Types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DetectedAugment {
    pub text: String,
    pub region_index: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OcrCardDiagnostic {
    pub region_index: usize,
    pub card_rect: Option<calibration::Rect>,
    pub crop: Option<calibration::Rect>,
    pub capture_succeeded: bool,
    pub raw_text: Option<String>,
    pub error: Option<String>,
    pub capture_width: Option<u32>,
    pub capture_height: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OcrScanResult {
    pub detected: Vec<DetectedAugment>,
    pub diagnostics: Vec<OcrCardDiagnostic>,
    pub capture_attempted: bool,
    pub crop_count: usize,
}

// ─── OCR Commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn check_ocr() -> bool {
    ocr::is_available()
}

#[tauri::command]
fn check_screen_capture_available() -> bool {
    let Ok(monitors) = xcap::Monitor::all() else {
        return false;
    };
    let Some(monitor) = monitors.into_iter().next() else {
        return false;
    };

    monitor.capture_image().is_ok()
}

struct MonitorSnapshot {
    monitor: xcap::Monitor,
    info: calibration::MonitorInfo,
}

fn monitor_info_from_xcap(monitor: &xcap::Monitor) -> Result<calibration::MonitorInfo, String> {
    Ok(calibration::MonitorInfo {
        x: monitor
            .x()
            .map_err(|e| format!("Monitor x failed: {}", e))?,
        y: monitor
            .y()
            .map_err(|e| format!("Monitor y failed: {}", e))?,
        width: monitor
            .width()
            .map_err(|e| format!("Monitor width failed: {}", e))?,
        height: monitor
            .height()
            .map_err(|e| format!("Monitor height failed: {}", e))?,
        scale_factor: monitor.scale_factor().unwrap_or(1.0) as f64,
    })
}

fn monitor_snapshots() -> Result<Vec<MonitorSnapshot>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let mut snapshots = Vec::with_capacity(monitors.len());

    for monitor in monitors {
        let info = monitor_info_from_xcap(&monitor)?;
        snapshots.push(MonitorSnapshot { monitor, info });
    }

    if snapshots.is_empty() {
        return Err("No monitor found".to_string());
    }

    Ok(snapshots)
}

fn find_league_window() -> Option<calibration::Rect> {
    let windows = xcap::Window::all().ok()?;
    let mut candidates: Vec<(u64, calibration::Rect)> = Vec::new();

    for window in windows {
        if window.is_minimized().unwrap_or(false) {
            continue;
        }

        let app_name = window.app_name().unwrap_or_default();
        let title = window.title().unwrap_or_default();
        if !foreground::is_actual_game_window(&app_name, &title) {
            continue;
        }

        let (Ok(x), Ok(y), Ok(width), Ok(height)) =
            (window.x(), window.y(), window.width(), window.height())
        else {
            continue;
        };
        let rect = calibration::Rect {
            x,
            y,
            width,
            height,
        };

        if rect.width < 640 || rect.height < 480 {
            continue;
        }

        let area = rect.width as u64 * rect.height as u64;
        candidates.push((area, rect));
    }

    candidates
        .into_iter()
        .max_by_key(|(score, _)| *score)
        .map(|(_, rect)| rect)
}

fn selected_monitor_index(
    monitors: &[MonitorSnapshot],
    game_window: Option<&calibration::Rect>,
) -> usize {
    if let Some(window) = game_window {
        if let Some((index, _)) = monitors
            .iter()
            .enumerate()
            .map(|(index, monitor)| (index, calibration::overlap_area(window, &monitor.info)))
            .filter(|(_, overlap)| *overlap > 0)
            .max_by_key(|(_, overlap)| *overlap)
        {
            return index;
        }
    }

    monitors
        .iter()
        .position(|snapshot| snapshot.monitor.is_primary().unwrap_or(false))
        .unwrap_or(0)
}

fn detect_overlay_calibration() -> Result<calibration::OverlayCalibration, String> {
    let monitors = monitor_snapshots()?;
    let game_window = find_league_window();
    let monitor_index = selected_monitor_index(&monitors, game_window.as_ref());

    Ok(calibration::select_viewport(
        &monitors[monitor_index].info,
        game_window.as_ref(),
    ))
}

#[cfg(target_os = "windows")]
fn apply_overlay_window_bounds(
    app: &tauri::AppHandle,
    calibration: &calibration::OverlayCalibration,
) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size};

    let Some(window) = app.get_webview_window("overlay") else {
        eprintln!("[overlay-window] reposition skipped — \"overlay\" window not found");
        return Ok(());
    };

    window
        .set_position(Position::Physical(PhysicalPosition {
            x: calibration.viewport.x,
            y: calibration.viewport.y,
        }))
        .map_err(|e| format!("Overlay position failed: {}", e))?;
    window
        .set_size(Size::Physical(PhysicalSize {
            width: calibration.viewport.width,
            height: calibration.viewport.height,
        }))
        .map_err(|e| format!("Overlay size failed: {}", e))?;

    // Window-lifecycle audit log (fix #7). The single "overlay" window is only
    // ever repositioned/resized here (Windows only); no window is created or
    // destroyed to change modes.
    eprintln!(
        "[overlay-window] repositioned single \"overlay\" window to {},{} {}x{}",
        calibration.viewport.x,
        calibration.viewport.y,
        calibration.viewport.width,
        calibration.viewport.height
    );

    Ok(())
}

#[tauri::command]
fn get_overlay_calibration(
    app: tauri::AppHandle,
) -> Result<calibration::OverlayCalibration, String> {
    let calibration = detect_overlay_calibration()?;

    #[cfg(target_os = "windows")]
    apply_overlay_window_bounds(&app, &calibration)?;
    #[cfg(not(target_os = "windows"))]
    let _ = &app;

    Ok(calibration)
}

struct CardCrop {
    region_index: usize,
    image: image::DynamicImage,
}

struct CardCropSet {
    crops: Vec<CardCrop>,
    diagnostics: Vec<OcrCardDiagnostic>,
    capture_attempted: bool,
}

fn capture_card_name_crops() -> Result<CardCropSet, String> {
    let monitors = monitor_snapshots()?;
    let game_window = find_league_window();
    let monitor_index = selected_monitor_index(&monitors, game_window.as_ref());
    let monitor = &monitors[monitor_index];
    let calibration = calibration::select_viewport(&monitor.info, game_window.as_ref());
    let mut diagnostics = Vec::with_capacity(calibration::CARD_NAME_REGIONS.len());
    let screenshot = match monitor.monitor.capture_image() {
        Ok(screenshot) => screenshot,
        Err(error) => {
            let message = format!("Capture failed: {}", error);
            for (region_index, region) in calibration::CARD_NAME_REGIONS.iter().enumerate() {
                diagnostics.push(OcrCardDiagnostic {
                    region_index,
                    card_rect: Some(calibration::physical_rect_for_region(
                        region,
                        &calibration.viewport,
                    )),
                    crop: Some(calibration::physical_rect_for_region(
                        region,
                        &calibration.viewport,
                    )),
                    capture_succeeded: false,
                    raw_text: None,
                    error: Some(message.clone()),
                    capture_width: None,
                    capture_height: None,
                });
            }
            return Ok(CardCropSet {
                crops: Vec::new(),
                diagnostics,
                capture_attempted: true,
            });
        }
    };

    let mut crops = Vec::with_capacity(calibration::CARD_NAME_REGIONS.len());

    for (i, region) in calibration::CARD_NAME_REGIONS.iter().enumerate() {
        let logical_rect = calibration::physical_rect_for_region(region, &calibration.viewport);
        let rect = calibration::capture_rect_for_monitor(
            &logical_rect,
            &monitor.info,
            screenshot.width(),
            screenshot.height(),
        );
        let px = rect.x;
        let py = rect.y;

        if px < 0 || py < 0 {
            diagnostics.push(OcrCardDiagnostic {
                region_index: i,
                card_rect: Some(logical_rect.clone()),
                crop: Some(rect),
                capture_succeeded: false,
                raw_text: None,
                error: Some("crop-origin-outside-monitor".to_string()),
                capture_width: Some(screenshot.width()),
                capture_height: Some(screenshot.height()),
            });
            continue;
        }

        let px = px as u32;
        let py = py as u32;
        let pw = rect.width;
        let ph = rect.height;

        if pw == 0 || ph == 0 || px + pw > screenshot.width() || py + ph > screenshot.height() {
            diagnostics.push(OcrCardDiagnostic {
                region_index: i,
                card_rect: Some(logical_rect.clone()),
                crop: Some(rect),
                capture_succeeded: false,
                raw_text: None,
                error: Some("crop-outside-captured-monitor".to_string()),
                capture_width: Some(screenshot.width()),
                capture_height: Some(screenshot.height()),
            });
            continue;
        }

        crops.push(CardCrop {
            region_index: i,
            image: image::DynamicImage::ImageRgba8(screenshot.view(px, py, pw, ph).to_image()),
        });
        diagnostics.push(OcrCardDiagnostic {
            region_index: i,
            card_rect: Some(logical_rect),
            crop: Some(rect),
            capture_succeeded: true,
            raw_text: None,
            error: None,
            capture_width: Some(screenshot.width()),
            capture_height: Some(screenshot.height()),
        });
    }

    Ok(CardCropSet {
        capture_attempted: true,
        crops,
        diagnostics,
    })
}

#[tauri::command]
async fn detect_augment_names(known_names: Option<Vec<String>>) -> Result<OcrScanResult, String> {
    if !collect_foreground_state().game_window_foreground {
        let reason = "actual-game-window-not-foreground".to_string();
        return Ok(OcrScanResult {
            detected: Vec::new(),
            diagnostics: (0..calibration::CARD_NAME_REGIONS.len())
                .map(|region_index| OcrCardDiagnostic {
                    region_index,
                    card_rect: None,
                    crop: None,
                    capture_succeeded: false,
                    raw_text: None,
                    error: Some(reason.clone()),
                    capture_width: None,
                    capture_height: None,
                })
                .collect(),
            capture_attempted: false,
            crop_count: 0,
        });
    }

    let crop_set = match capture_card_name_crops() {
        Ok(crop_set) => crop_set,
        Err(error) => {
            return Ok(OcrScanResult {
                detected: Vec::new(),
                diagnostics: (0..calibration::CARD_NAME_REGIONS.len())
                    .map(|region_index| OcrCardDiagnostic {
                        region_index,
                        card_rect: None,
                        crop: None,
                        capture_succeeded: false,
                        raw_text: None,
                        error: Some(error.clone()),
                        capture_width: None,
                        capture_height: None,
                    })
                    .collect(),
                capture_attempted: false,
                crop_count: 0,
            });
        }
    };
    let capture_attempted = crop_set.capture_attempted;
    let crop_count = crop_set.crops.len();
    let locale = ocr::detect_game_locale();

    // Vision biases language correction toward these names; the Windows
    // backend ignores them (fuzzy matching happens in the frontend).
    let known_names: Arc<Vec<String>> = Arc::new(
        known_names
            .unwrap_or_default()
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect(),
    );

    let mut handles = Vec::with_capacity(crop_set.crops.len());
    for crop in crop_set.crops {
        let region_index = crop.region_index;
        let known_names = known_names.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            (
                region_index,
                ocr::read_card_text(&crop.image, locale, &known_names),
            )
        }));
    }

    let mut diagnostics = crop_set.diagnostics;
    let mut detected = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok((region_index, Ok(Some(text)))) => {
                if let Some(diagnostic) = diagnostics
                    .iter_mut()
                    .find(|diagnostic| diagnostic.region_index == region_index)
                {
                    diagnostic.raw_text = Some(text.clone());
                }
                detected.push(DetectedAugment { text, region_index });
            }
            Ok((region_index, Ok(None))) => {
                if let Some(diagnostic) = diagnostics
                    .iter_mut()
                    .find(|diagnostic| diagnostic.region_index == region_index)
                {
                    diagnostic.error = Some("no-text-recognized".to_string());
                }
            }
            Ok((region_index, Err(error))) => {
                if let Some(diagnostic) = diagnostics
                    .iter_mut()
                    .find(|diagnostic| diagnostic.region_index == region_index)
                {
                    diagnostic.error = Some(error);
                }
            }
            Err(error) => {
                let message = format!("OCR worker failed: {}", error);
                for diagnostic in &mut diagnostics {
                    if diagnostic.raw_text.is_none() && diagnostic.error.is_none() {
                        diagnostic.error = Some(message.clone());
                    }
                }
            }
        }
    }
    detected.sort_by_key(|result| result.region_index);
    Ok(OcrScanResult {
        detected,
        diagnostics,
        capture_attempted,
        crop_count,
    })
}

// ─── API Probe (check if augment data available via Live Client) ────────────

#[cfg(debug_assertions)]
#[tauri::command]
async fn probe_augment_api() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("{}", e))?;

    let mut out = String::new();

    // Full game data — search for augment-related fields
    if let Ok(resp) = client
        .get("https://127.0.0.1:2999/liveclientdata/allgamedata")
        .send()
        .await
    {
        if let Ok(text) = resp.text().await {
            let lower = text.to_lowercase();
            if lower.contains("augment") || lower.contains("perk") || lower.contains("mayhem") {
                out.push_str("FOUND augment-related data in allgamedata:\n");
                out.push_str(&text);
            } else {
                out.push_str("allgamedata: no augment fields found\n");
                // Still log full runes section if present (augments might be under runes)
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(active) = json.get("activePlayer") {
                        if let Some(runes) = active.get("fullRunes") {
                            out.push_str("activePlayer.fullRunes:\n");
                            out.push_str(&serde_json::to_string_pretty(runes).unwrap_or_default());
                            out.push('\n');
                        }
                    }
                }
            }
        }
    } else {
        out.push_str("Live Client API not reachable (not in game?)\n");
    }

    Ok(out)
}

#[cfg(not(debug_assertions))]
#[tauri::command]
async fn probe_augment_api() -> Result<String, String> {
    Err("Augment API probe is available in debug builds only.".to_string())
}

// ─── Dock & Settings Commands ───────────────────────────────────────────────

/// Hide app from Dock (accessory mode — no Dock icon, no menu bar)
#[tauri::command]
fn set_dock_visible(visible: bool) {
    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::appkit::NSApplicationActivationPolicy;
        let app: cocoa::base::id = objc::msg_send![objc::class!(NSApplication), sharedApplication];
        let policy = if visible {
            NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular
        } else {
            NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory
        };
        let _: () = objc::msg_send![app, setActivationPolicy: policy];
    }
}

/// Toggle mouse event pass-through on the overlay window
#[tauri::command]
fn set_click_through(app: tauri::AppHandle, ignore: bool) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("overlay") {
            let ns_win_ptr = window.ns_window().unwrap();
            unsafe {
                use cocoa::appkit::NSWindow;
                let ns_win = ns_win_ptr as cocoa::base::id;
                ns_win.setIgnoresMouseEvents_(if ignore {
                    cocoa::base::YES
                } else {
                    cocoa::base::NO
                });
            }
        }
    }
}

#[derive(Default)]
struct FrontmostApplication {
    app_name: Option<String>,
    bundle_identifier: Option<String>,
    process_id: Option<u32>,
    executable_path: Option<String>,
    window_handle: Option<u64>,
}

#[cfg(target_os = "macos")]
unsafe fn ns_string_value(value: cocoa::base::id) -> Option<String> {
    use std::ffi::CStr;

    if value.is_null() {
        return None;
    }
    let ptr = cocoa::foundation::NSString::UTF8String(value);
    if ptr.is_null() {
        return None;
    }
    let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
    (!value.is_empty()).then_some(value)
}

#[cfg(target_os = "macos")]
fn running_application(process_id: u32) -> FrontmostApplication {
    unsafe {
        let application: cocoa::base::id = objc::msg_send![
            objc::class!(NSRunningApplication),
            runningApplicationWithProcessIdentifier: process_id as i32
        ];
        if application.is_null() {
            return FrontmostApplication::default();
        }

        let app_name: cocoa::base::id = objc::msg_send![application, localizedName];
        let bundle_identifier: cocoa::base::id = objc::msg_send![application, bundleIdentifier];
        let executable_url: cocoa::base::id = objc::msg_send![application, executableURL];
        let executable_path = if executable_url.is_null() {
            None
        } else {
            let path: cocoa::base::id = objc::msg_send![executable_url, path];
            ns_string_value(path)
        };

        FrontmostApplication {
            app_name: ns_string_value(app_name),
            bundle_identifier: ns_string_value(bundle_identifier),
            process_id: Some(process_id),
            executable_path,
            window_handle: None,
        }
    }
}

#[cfg(target_os = "macos")]
fn workspace_frontmost_application() -> FrontmostApplication {
    unsafe {
        let workspace: cocoa::base::id =
            objc::msg_send![objc::class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return FrontmostApplication::default();
        }

        let application: cocoa::base::id = objc::msg_send![workspace, frontmostApplication];
        if application.is_null() {
            return FrontmostApplication::default();
        }

        let process_id: i32 = objc::msg_send![application, processIdentifier];
        if process_id <= 0 {
            return FrontmostApplication::default();
        }
        running_application(process_id as u32)
    }
}

#[cfg(target_os = "macos")]
unsafe fn cf_dictionary_value(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: &'static str,
) -> *const std::ffi::c_void {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::{CFDictionaryGetValueIfPresent, CFDictionaryRef};
    use core_foundation::string::CFString;

    let key = CFString::from_static_string(key);
    let mut value = std::ptr::null();
    let _ = CFDictionaryGetValueIfPresent(
        dictionary.as_CFTypeRef() as CFDictionaryRef,
        key.as_CFTypeRef() as *const std::ffi::c_void,
        &mut value,
    );
    value
}

#[cfg(target_os = "macos")]
unsafe fn cf_string_dictionary_value(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: &'static str,
) -> Option<String> {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    let value = cf_dictionary_value(dictionary, key);
    (!value.is_null()).then(|| CFString::wrap_under_get_rule(value as CFStringRef).to_string())
}

#[cfg(target_os = "macos")]
unsafe fn cf_i32_dictionary_value(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: &'static str,
) -> Option<i32> {
    use core_foundation::base::TCFType;
    use core_foundation::number::{CFNumber, CFNumberRef};

    let value = cf_dictionary_value(dictionary, key);
    (!value.is_null())
        .then(|| CFNumber::wrap_under_get_rule(value as CFNumberRef).to_i32())
        .flatten()
}

#[cfg(target_os = "macos")]
fn foreground_window_metadata() -> (FrontmostApplication, Option<String>, Option<String>, bool) {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_graphics::window::{
        copy_window_info, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };

    let foreground_application = workspace_frontmost_application();
    let foreground_process_id = foreground_application.process_id;

    let Some(windows) = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        0,
    ) else {
        return (foreground_application, None, None, false);
    };

    let own_process_id = std::process::id();
    let mut foreground_owner_name = None;
    let mut foreground_window_title = None;
    let mut game_window_detected = false;

    // NSWorkspace identifies the actual frontmost process, including a
    // fullscreen Metal game with no regular CoreGraphics window. CoreGraphics
    // only supplies optional owner/title metadata for that process.
    for window_ref in windows.get_all_values() {
        if window_ref.is_null() {
            continue;
        }
        let window = unsafe {
            CFDictionary::<*const std::ffi::c_void, *const std::ffi::c_void>::wrap_under_get_rule(
                window_ref as *const _,
            )
        };
        let owner_name = unsafe { cf_string_dictionary_value(&window, "kCGWindowOwnerName") };
        let title = unsafe { cf_string_dictionary_value(&window, "kCGWindowName") };
        let owner_name_value = owner_name.as_deref().unwrap_or_default();
        let title_value = title.as_deref().unwrap_or_default();
        let process_id = unsafe { cf_i32_dictionary_value(&window, "kCGWindowOwnerPID") }
            .and_then(|value| (value > 0).then_some(value as u32));
        let layer = unsafe { cf_i32_dictionary_value(&window, "kCGWindowLayer") };

        if foreground::is_actual_game_window(owner_name_value, title_value) {
            game_window_detected = true;
        }

        if layer != Some(0) || process_id.is_none() || process_id == Some(own_process_id) {
            continue;
        }

        let process_id = process_id.unwrap();
        let application = running_application(process_id);
        let is_own_window = application
            .bundle_identifier
            .as_deref()
            .is_some_and(|bundle| bundle == "com.mayhem-oracle.overlay");
        if is_own_window {
            continue;
        }

        if Some(process_id) != foreground_process_id {
            continue;
        }

        if foreground_owner_name.is_none() {
            foreground_owner_name = owner_name.filter(|value| !value.is_empty());
            foreground_window_title = title.filter(|value| !value.is_empty());
        }
    }

    (
        foreground_application,
        foreground_owner_name,
        foreground_window_title,
        game_window_detected,
    )
}

#[cfg(target_os = "windows")]
fn windows_foreground_metadata() -> (FrontmostApplication, Option<String>, Option<String>, bool) {
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    fn executable_path(process_id: u32) -> Option<String> {
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
        let mut buffer = [0u16; 32_768];
        let mut length = buffer.len() as u32;
        let result = unsafe {
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
        result.then(|| String::from_utf16_lossy(&buffer[..length as usize]))
    }

    fn window_title(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
        let mut buffer = [0u16; 1_024];
        let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        (length > 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
    }

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return (FrontmostApplication::default(), None, None, false);
    }

    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }
    if process_id == 0 {
        return (
            FrontmostApplication::default(),
            None,
            window_title(hwnd),
            false,
        );
    }

    let executable_path = executable_path(process_id);
    let process_name = executable_path
        .as_deref()
        .and_then(|path| Path::new(path).file_stem())
        .and_then(|name| name.to_str())
        .map(str::to_string);
    let title = window_title(hwnd);
    let game_window_detected = process_name
        .as_deref()
        .is_some_and(|name| foreground::is_actual_game_process(name, executable_path.as_deref()));
    let application = FrontmostApplication {
        app_name: process_name.clone(),
        bundle_identifier: None,
        process_id: Some(process_id),
        executable_path,
        window_handle: Some(hwnd.0 as usize as u64),
    };

    (application, process_name, title, game_window_detected)
}

fn game_process_running() -> bool {
    let system = sysinfo::System::new_all();
    system.processes().values().any(|process| {
        let name = process.name().to_string_lossy();
        let executable_path = process.exe().map(|path| path.to_string_lossy());
        foreground::is_actual_game_process(&name, executable_path.as_deref())
    })
}

fn collect_foreground_state() -> foreground::ForegroundState {
    #[cfg(target_os = "macos")]
    {
        let (frontmost, owner_name, window_title, game_window_detected) =
            foreground_window_metadata();
        return foreground::classify_foreground(foreground::ForegroundObservation {
            app_name: frontmost.app_name.as_deref(),
            bundle_identifier: frontmost.bundle_identifier.as_deref(),
            owner_name: owner_name.as_deref(),
            window_title: window_title.as_deref(),
            executable_path: frontmost.executable_path.as_deref(),
            window_handle: frontmost.window_handle,
            game_running: game_process_running(),
            game_window_detected,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let (frontmost, owner_name, window_title, game_window_detected) =
            windows_foreground_metadata();
        return foreground::classify_foreground(foreground::ForegroundObservation {
            app_name: frontmost.app_name.as_deref(),
            bundle_identifier: frontmost.bundle_identifier.as_deref(),
            owner_name: owner_name.as_deref(),
            window_title: window_title.as_deref(),
            executable_path: frontmost.executable_path.as_deref(),
            window_handle: frontmost.window_handle,
            game_running: game_process_running(),
            game_window_detected,
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        foreground::ForegroundState::default()
    }
}

/// Returns the native foreground app/window classification used for all visual
/// overlay gates. Game-running and game-window-detected are diagnostics only.
#[tauri::command]
fn get_foreground_state() -> foreground::ForegroundState {
    collect_foreground_state()
}

/// Returns true only when the actual League game process/window is foreground.
#[tauri::command]
fn is_league_foreground() -> bool {
    collect_foreground_state().game_window_foreground
}

/// Open macOS System Settings → Privacy → Screen Recording
#[tauri::command]
fn open_screen_recording_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
    }
}

// ─── App Entry ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_league_client,
            get_game_phase,
            get_lcu_gameflow_state,
            get_game_hash,
            get_live_player_data,
            check_ocr,
            check_screen_capture_available,
            detect_augment_names,
            get_overlay_calibration,
            probe_augment_api,
            set_dock_visible,
            set_click_through,
            open_screen_recording_settings,
            get_foreground_state,
            is_league_foreground,
            collector::get_collector_status,
            collector::set_collector_consent,
            collector::set_collector_paused,
            collector::record_contributor_round,
            collector::confirm_contributor_round_selection,
            collector::collector_tick,
            member::member_bootstrap,
            member::member_game_start,
        ])
        .setup(|app| {
            use tauri::Manager;

            let collector_state = collector::CollectorState::new(app.path().app_data_dir()?)
                .map_err(std::io::Error::other)?;
            app.manage(collector_state);
            let member_state = member::MemberState::new(app.path().app_data_dir()?.join("member-models"))
                .map_err(std::io::Error::other)?;
            app.manage(member_state);

            // ─── System Tray Icon ──────────────────────────────────────
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;

                let quit_item = MenuItem::with_id(app, "quit", "Exit Mayhem Oracle", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&quit_item])?;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("Mayhem Oracle\n⌘Q disabled — right-click to exit\nOr ⌘⌥⎋ → Force Quit")
                    .on_menu_event(|app, event| {
                        if event.id.as_ref() == "quit" {
                            app.exit(0);
                        }
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }

                tray_builder.build(app)?;
            }

            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                let window = app.get_webview_window("overlay")
                    .expect("overlay window not found");

                let ns_win_ptr = window.ns_window().unwrap();

                // Hide from Dock — make this a pure background overlay
                unsafe {
                    use cocoa::appkit::NSApplicationActivationPolicy;
                    let app_ptr: cocoa::base::id = objc::msg_send![objc::class!(NSApplication), sharedApplication];
                    let _: () = objc::msg_send![app_ptr, setActivationPolicy: NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory];
                }

                // Initial setup — overlay covering full screen
                unsafe {
                    use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
                    let ns_win = ns_win_ptr as cocoa::base::id;

                    // Cover the full screen without native fullscreen
                    let main_screen: cocoa::base::id = msg_send![objc::class!(NSScreen), mainScreen];
                    let frame: cocoa::foundation::NSRect = msg_send![main_screen, frame];
                    ns_win.setFrame_display_(frame, cocoa::base::YES);

                    // 2147483639 = INT32_MAX - 8; 10 above League fullscreen level (2147483629)
                    // Required for true macOS fullscreen — borderless windowed only needs 1500
                    ns_win.setLevel_(2147483639);
                    ns_win.setCollectionBehavior_(
                        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
                    );
                    ns_win.setIgnoresMouseEvents_(cocoa::base::YES);
                    ns_win.setHidesOnDeactivate_(cocoa::base::NO);
                }

                // Window-lifecycle audit log (fix #7). There is exactly ONE native
                // overlay window: created here from tauri.conf.json and NEVER
                // repositioned, hidden, or destroyed at runtime on macOS. All
                // calibration/collector/badge/debug surfaces are React components
                // inside this single window, so "duplicate" panels or "ghost"
                // badges can only be DOM state, never extra native windows. The
                // window ignores mouse events natively → fully click-through.
                eprintln!(
                    "[overlay-window] created single native window \"overlay\" \
                     (macOS full-screen, level=2147483639, ignoresMouseEvents=YES, \
                     never repositioned/hidden/destroyed at runtime)"
                );

                // Re-assert level every 5s — game windows can temporarily jump above us
                // during mode switches. Fetches ns_window fresh on main thread each time
                // to avoid retaining a stale raw pointer across the thread boundary.
                let win = app.get_webview_window("overlay").unwrap();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        let win_ref = win.clone();
                        let _ = win.run_on_main_thread(move || {
                            if let Ok(ptr) = win_ref.ns_window() {
                                unsafe {
                                    use cocoa::appkit::NSWindow;
                                    let ns_win = ptr as cocoa::base::id;
                                    ns_win.setLevel_(2147483639);
                                    let _: () = objc::msg_send![ns_win, orderFrontRegardless];
                                }
                            }
                        });
                    }
                });

            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
