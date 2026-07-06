use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Arc;
use sysinfo::System;

pub mod calibration;
mod collector;
mod lcu;
pub mod member;
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

// ─── OCR Commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn check_tesseract() -> bool {
    std::process::Command::new("tesseract")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn preferred_tesseract_languages() -> String {
    let installed = std::process::Command::new("tesseract")
        .arg("--list-langs")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_default();
    let installed: std::collections::HashSet<&str> = installed.lines().map(str::trim).collect();

    let sys = System::new_all();
    let game_locale = sys
        .processes()
        .values()
        .filter(|process| {
            let name = process
                .name()
                .to_string_lossy()
                .to_lowercase()
                .replace(' ', "");
            name.contains("leagueoflegends") || name.contains("leagueclient")
        })
        .flat_map(|process| process.cmd())
        .map(|arg| arg.to_string_lossy())
        .find_map(|arg| {
            arg.strip_prefix("-Locale=")
                .or_else(|| arg.strip_prefix("--locale="))
                .map(str::to_string)
        });

    let locale_language = game_locale.as_deref().and_then(|locale| match locale {
        locale if locale.starts_with("zh_TW") => Some("chi_tra"),
        locale if locale.starts_with("zh_CN") => Some("chi_sim"),
        locale if locale.starts_with("ja_") => Some("jpn"),
        locale if locale.starts_with("ko_") => Some("kor"),
        locale if locale.starts_with("en_") => Some("eng"),
        _ => None,
    });
    if let Some(language) = locale_language.filter(|language| installed.contains(language)) {
        return language.to_string();
    }

    let preferred = ["eng", "chi_tra", "chi_sim", "jpn", "kor"];
    let langs: Vec<&str> = preferred
        .into_iter()
        .filter(|lang| installed.contains(lang))
        .collect();

    if langs.is_empty() {
        "chi_tra".to_string()
    } else {
        langs.join("+")
    }
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
        x: monitor.x().map_err(|e| format!("Monitor x failed: {}", e))?,
        y: monitor.y().map_err(|e| format!("Monitor y failed: {}", e))?,
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
        if !looks_like_league_window(&app_name, &title) {
            continue;
        }

        let (Ok(x), Ok(y), Ok(width), Ok(height)) = (
            window.x(),
            window.y(),
            window.width(),
            window.height(),
        ) else {
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
        let focus_bonus = if window.is_focused().unwrap_or(false) {
            area / 2
        } else {
            0
        };
        candidates.push((area + focus_bonus, rect));
    }

    candidates
        .into_iter()
        .max_by_key(|(score, _)| *score)
        .map(|(_, rect)| rect)
}

fn looks_like_league_window(app_name: &str, title: &str) -> bool {
    let haystack = format!("{} {}", app_name, title)
        .to_lowercase()
        .replace(' ', "");

    haystack.contains("leagueoflegends") || haystack.contains("leagueclient")
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

fn run_tesseract(
    crop: image::DynamicImage,
    idx: usize,
    ocr_languages: String,
    user_words_path: Option<Arc<tempfile::TempPath>>,
) -> Result<Option<DetectedAugment>, String> {
    let scaled = image::imageops::resize(
        &crop,
        crop.width() * 2,
        crop.height() * 2,
        image::imageops::FilterType::Lanczos3,
    );

    let tmp_file = tempfile::Builder::new()
        .prefix("mayhem_ocr_")
        .suffix(".png")
        .tempfile()
        .map_err(|e| format!("Temp file failed: {}", e))?;
    scaled
        .save(tmp_file.path())
        .map_err(|e| format!("Save failed: {}", e))?;

    let mut texts = Vec::new();
    for psm in ["11", "6"] {
        let mut command = std::process::Command::new("tesseract");
        command
            .arg(tmp_file.path())
            .arg("stdout")
            .arg("-l")
            .arg(&ocr_languages)
            .arg("--psm")
            .arg(psm);

        if let Some(file) = &user_words_path {
            command.arg("--user-words").arg(file.as_ref().as_os_str());
        }

        let output = command
            .output()
            .map_err(|e| format!("Tesseract failed: {}", e))?;

        let text = String::from_utf8_lossy(&output.stdout)
            .trim()
            .replace(' ', "")
            .replace('\n', "");
        if !text.is_empty() && !texts.contains(&text) {
            texts.push(text);
        }
    }
    let text = texts.join("");
    Ok((!text.is_empty()).then_some(DetectedAugment {
        text,
        region_index: idx,
    }))
}

fn capture_card_name_crops() -> Result<Vec<(usize, image::DynamicImage)>, String> {
    let monitors = monitor_snapshots()?;
    let game_window = find_league_window();
    let monitor_index = selected_monitor_index(&monitors, game_window.as_ref());
    let monitor = &monitors[monitor_index];
    let calibration = calibration::select_viewport(&monitor.info, game_window.as_ref());
    let screenshot = monitor
        .monitor
        .capture_image()
        .map_err(|e| format!("Capture failed: {}", e))?;

    let mut crops = Vec::with_capacity(calibration::CARD_NAME_REGIONS.len());

    for (i, region) in calibration::CARD_NAME_REGIONS.iter().enumerate() {
        let rect = calibration::physical_rect_for_region(region, &calibration.viewport);
        let px = rect.x - monitor.info.x;
        let py = rect.y - monitor.info.y;

        if px < 0 || py < 0 {
            continue;
        }

        let px = px as u32;
        let py = py as u32;
        let pw = rect.width;
        let ph = rect.height;

        if px + pw > screenshot.width() || py + ph > screenshot.height() {
            continue;
        }

        crops.push((
            i,
            image::DynamicImage::ImageRgba8(screenshot.view(px, py, pw, ph).to_image()),
        ));
    }

    Ok(crops)
}

#[tauri::command]
async fn detect_augment_names(
    known_names: Option<Vec<String>>,
) -> Result<Vec<DetectedAugment>, String> {
    if !is_league_foreground() {
        return Err("League of Legends is not the foreground application".to_string());
    }

    let crops = capture_card_name_crops()?;
    let ocr_languages = preferred_tesseract_languages();

    let mut user_words_file = None;

    if let Some(names) = known_names {
        if !names.is_empty() {
            let mut file = tempfile::Builder::new()
                .prefix("mayhem_ocr_words_")
                .suffix(".txt")
                .tempfile()
                .map_err(|e| format!("User words file failed: {}", e))?;

            for name in names {
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    writeln!(file, "{}", trimmed)
                        .map_err(|e| format!("User words write failed: {}", e))?;
                }
            }

            file.flush()
                .map_err(|e| format!("User words flush failed: {}", e))?;
            user_words_file = Some(Arc::new(file.into_temp_path()));
        }
    }

    let mut handles = Vec::with_capacity(crops.len());
    for (i, crop) in crops {
        let languages = ocr_languages.clone();
        let words = user_words_file.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            run_tesseract(crop, i, languages, words)
        }));
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(Ok(Some(result))) => results.push(result),
            Ok(Ok(None)) => {}
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(format!("OCR worker failed: {}", error)),
        }
    }
    Ok(results)
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

/// Returns true if League of Legends is the frontmost application
#[tauri::command]
fn is_league_foreground() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        use std::ffi::CStr;
        let workspace: cocoa::base::id =
            objc::msg_send![objc::class!(NSWorkspace), sharedWorkspace];
        let frontmost: cocoa::base::id = objc::msg_send![workspace, frontmostApplication];
        if frontmost.is_null() {
            return false;
        }
        let bundle_id: cocoa::base::id = objc::msg_send![frontmost, bundleIdentifier];
        if bundle_id.is_null() {
            return false;
        }
        let ptr = cocoa::foundation::NSString::UTF8String(bundle_id);
        if ptr.is_null() {
            return false;
        }
        let s = CStr::from_ptr(ptr).to_str().unwrap_or("").to_lowercase();
        s.replace(' ', "").contains("leagueoflegends")
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
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
            check_tesseract,
            check_screen_capture_available,
            detect_augment_names,
            get_overlay_calibration,
            probe_augment_api,
            set_dock_visible,
            set_click_through,
            open_screen_recording_settings,
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

            std::thread::spawn(|| {
                let _ = std::process::Command::new("tesseract")
                    .arg("--list-langs")
                    .output();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
