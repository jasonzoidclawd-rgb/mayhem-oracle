use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use sysinfo::System;
use image::GenericImageView;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LeagueClientInfo {
    pub port: u16,
    pub auth_token: String,
    pub pid: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LivePlayerData {
    pub champion: String,
    pub summoner_name: String,
    pub level: u32,
    pub is_dead: bool,
    pub game_time: f64,
    pub game_mode: String,
}

// ─── Lockfile Discovery ─────────────────────────────────────────────────────

fn find_lockfile_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let paths = [
            "/Applications/League of Legends.app/Contents/LoL/lockfile",
        ];
        for p in &paths {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }
        // Fallback: scan processes for install directory
        let sys = System::new_all();
        for proc in sys.processes().values() {
            let name = proc.name().to_string_lossy().to_string();
            if name.contains("LeagueClient") {
                if let Some(exe) = proc.exe() {
                    let mut dir = exe.to_path_buf();
                    dir.pop(); // remove binary name
                    dir.push("lockfile");
                    if dir.exists() {
                        return Some(dir);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let paths = [
            r"C:\Riot Games\League of Legends\lockfile",
            r"D:\Riot Games\League of Legends\lockfile",
        ];
        for p in &paths {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }
        let sys = System::new_all();
        for proc in sys.processes().values() {
            let name = proc.name().to_string_lossy().to_string();
            if name.contains("LeagueClient") {
                if let Some(exe) = proc.exe() {
                    let mut dir = exe.to_path_buf();
                    dir.pop();
                    dir.push("lockfile");
                    if dir.exists() {
                        return Some(dir);
                    }
                }
            }
        }
    }

    None
}

fn parse_lockfile(path: &PathBuf) -> Option<LeagueClientInfo> {
    let content = std::fs::read_to_string(path).ok()?;
    // Format: LeagueClient:pid:port:password:https
    let parts: Vec<&str> = content.trim().split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    Some(LeagueClientInfo {
        pid: parts[1].parse().ok()?,
        port: parts[2].parse().ok()?,
        auth_token: parts[3].to_string(),
    })
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn detect_league_client() -> Option<LeagueClientInfo> {
    let path = find_lockfile_path()?;
    parse_lockfile(&path)
}

#[tauri::command]
async fn get_game_phase(port: u16, auth_token: String) -> Option<String> {
    let url = format!("https://127.0.0.1:{}/lol-gameflow/v1/gameflow-phase", port);
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .ok()?;

    let resp = client
        .get(&url)
        .basic_auth("riot", Some(&auth_token))
        .send()
        .await
        .ok()?;

    let text = resp.text().await.ok()?;
    // Response is a JSON string like "InProgress"
    serde_json::from_str::<String>(&text).ok()
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

    let summoner_name = active.get("riotId")
        .or_else(|| active.get("summonerName"))
        .and_then(|v| v.as_str())?
        .to_string();

    let level = active
        .get("level")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;

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
    let champion = me.get("rawChampionName")
        .and_then(|v| v.as_str())
        .map(|s| {
            // rawChampionName format: "game_character_displayname_Varus"
            // Strip the prefix to get just the champion name
            s.rsplit('_').next().unwrap_or(s).to_string()
        })
        .unwrap_or_else(|| me.get("championName").and_then(|v| v.as_str()).unwrap_or("").to_string());
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
        summoner_name,
        level,
        is_dead,
        game_time,
        game_mode,
    })
}

// ─── OCR Types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CardRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

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

#[tauri::command]
async fn detect_augment_names(regions: Vec<CardRegion>) -> Result<Vec<DetectedAugment>, String> {
    // Capture the primary screen
    let screens = xcap::Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = screens.into_iter().next().ok_or("No monitor found")?;
    let screenshot = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;

    let screen_w = screenshot.width() as f64;
    let screen_h = screenshot.height() as f64;

    let mut results = Vec::new();

    for (i, region) in regions.iter().enumerate() {
        // Convert fractional coordinates to pixels
        let px = (region.x * screen_w) as u32;
        let py = (region.y * screen_h) as u32;
        let pw = (region.w * screen_w) as u32;
        let ph = (region.h * screen_h) as u32;

        // Bounds check
        if px + pw > screenshot.width() || py + ph > screenshot.height() {
            continue;
        }

        // Crop to the card name region
        let cropped = screenshot.view(px, py, pw, ph).to_image();

        // Write to temp file for tesseract
        let tmp_path = std::env::temp_dir().join(format!("mayhem_ocr_{}.png", i));
        cropped.save(&tmp_path).map_err(|e| format!("Save failed: {}", e))?;

        // Run tesseract with chi_tra (Traditional Chinese)
        let output = std::process::Command::new("tesseract")
            .arg(&tmp_path)
            .arg("stdout")
            .arg("-l")
            .arg("chi_tra")
            .arg("--psm")
            .arg("7")  // single text line
            .output()
            .map_err(|e| format!("Tesseract failed: {}", e))?;

        let text = String::from_utf8_lossy(&output.stdout)
            .trim()
            .replace(' ', "")
            .replace('\n', "");

        // Clean up temp file
        let _ = std::fs::remove_file(&tmp_path);

        if !text.is_empty() {
            results.push(DetectedAugment {
                text,
                region_index: i,
            });
        }
    }

    Ok(results)
}

// ─── API Probe (check if augment data available via Live Client) ────────────

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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            detect_league_client,
            get_game_phase,
            get_live_player_data,
            check_tesseract,
            detect_augment_names,
            probe_augment_api,
            set_dock_visible,
            set_click_through,
            open_screen_recording_settings,
        ])
        .setup(|app| {
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

                // Initial setup — borderless overlay covering full screen
                unsafe {
                    use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
                    let ns_win = ns_win_ptr as cocoa::base::id;

                    // Borderless (no title bar / traffic lights)
                    ns_win.setStyleMask_(NSWindowStyleMask::NSBorderlessWindowMask);

                    // Cover the full screen without native fullscreen
                    let main_screen: cocoa::base::id = msg_send![objc::class!(NSScreen), mainScreen];
                    let frame: cocoa::foundation::NSRect = msg_send![main_screen, frame];
                    ns_win.setFrame_display_(frame, cocoa::base::YES);

                    ns_win.setLevel_(1000);
                    ns_win.setCollectionBehavior_(
                        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
                    );
                    ns_win.setIgnoresMouseEvents_(cocoa::base::YES);
                    ns_win.setHidesOnDeactivate_(cocoa::base::NO);
                }

                // Periodically re-assert window to front via main thread
                let ns_win_addr = ns_win_ptr as usize;
                let win = app.get_webview_window("overlay").unwrap();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(1));
                        let addr = ns_win_addr;
                        let _ = win.run_on_main_thread(move || {
                            unsafe {
                                use cocoa::appkit::NSWindow;
                                let ns_win = addr as cocoa::base::id;
                                ns_win.setLevel_(1000);
                                let _: () = objc::msg_send![ns_win, orderFrontRegardless];
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
