use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use sysinfo::System;

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct LeagueClientCredentials {
    port: u16,
    auth_token: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LivePlayerData {
    pub champion: String,
    pub level: u32,
    pub is_dead: bool,
    pub game_time: f64,
    pub game_mode: String,
}

// ─── Lockfile Discovery ─────────────────────────────────────────────────────

fn find_lockfile_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let paths = ["/Applications/League of Legends.app/Contents/LoL/lockfile"];
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

fn parse_lockfile(path: &PathBuf) -> Option<LeagueClientCredentials> {
    let content = std::fs::read_to_string(path).ok()?;
    // Format: LeagueClient:pid:port:password:https
    let parts: Vec<&str> = content.trim().split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    Some(LeagueClientCredentials {
        port: parts[2].parse().ok()?,
        auth_token: parts[3].to_string(),
    })
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn detect_league_client() -> bool {
    let Some(path) = find_lockfile_path() else {
        return false;
    };

    parse_lockfile(&path).is_some()
}

#[tauri::command]
async fn get_game_phase() -> Option<String> {
    let path = find_lockfile_path()?;
    let credentials = parse_lockfile(&path)?;
    let url = format!(
        "https://127.0.0.1:{}/lol-gameflow/v1/gameflow-phase",
        credentials.port
    );
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .ok()?;

    let resp = client
        .get(&url)
        .basic_auth("riot", Some(&credentials.auth_token))
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
pub struct CardRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

const CARD_NAME_REGIONS: [[CardRegion; 2]; 3] = [
    [
        CardRegion {
            x: 0.245,
            y: 0.378,
            w: 0.125,
            h: 0.045,
        },
        CardRegion {
            x: 0.255,
            y: 0.382,
            w: 0.1,
            h: 0.033,
        },
    ],
    [
        CardRegion {
            x: 0.437,
            y: 0.378,
            w: 0.125,
            h: 0.045,
        },
        CardRegion {
            x: 0.45,
            y: 0.382,
            w: 0.1,
            h: 0.033,
        },
    ],
    [
        CardRegion {
            x: 0.631,
            y: 0.378,
            w: 0.125,
            h: 0.045,
        },
        CardRegion {
            x: 0.645,
            y: 0.382,
            w: 0.1,
            h: 0.033,
        },
    ],
];

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

#[tauri::command]
async fn detect_augment_names(
    known_names: Option<Vec<String>>,
) -> Result<Vec<DetectedAugment>, String> {
    if !is_league_foreground() {
        return Err("League of Legends is not the foreground application".to_string());
    }

    // Capture the primary screen
    let screens = xcap::Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = screens.into_iter().next().ok_or("No monitor found")?;
    let screenshot = monitor
        .capture_image()
        .map_err(|e| format!("Capture failed: {}", e))?;

    let screen_w = screenshot.width() as f64;
    let screen_h = screenshot.height() as f64;
    let ocr_languages = preferred_tesseract_languages();

    let mut results = Vec::new();
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

            user_words_file = Some(file);
        }
    }

    for (i, regions) in CARD_NAME_REGIONS.iter().enumerate() {
        for region in regions {
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

            // Write to a securely-created temp file for tesseract.
            let tmp_file = tempfile::Builder::new()
                .prefix("mayhem_ocr_")
                .suffix(".png")
                .tempfile()
                .map_err(|e| format!("Temp file failed: {}", e))?;
            cropped
                .save(tmp_file.path())
                .map_err(|e| format!("Save failed: {}", e))?;

            // Run Tesseract with every supported LoL locale language pack installed locally.
            let mut command = std::process::Command::new("tesseract");
            command
                .arg(tmp_file.path())
                .arg("stdout")
                .arg("-l")
                .arg(&ocr_languages)
                .arg("--psm")
                .arg("7"); // single text line

            if let Some(file) = &user_words_file {
                command.arg("--user-words").arg(file.path());
            }

            let output = command
                .output()
                .map_err(|e| format!("Tesseract failed: {}", e))?;

            let text = String::from_utf8_lossy(&output.stdout)
                .trim()
                .replace(' ', "")
                .replace('\n', "");

            if !text.is_empty() {
                results.push(DetectedAugment {
                    text,
                    region_index: i,
                });
            }
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
            get_live_player_data,
            check_tesseract,
            check_screen_capture_available,
            detect_augment_names,
            probe_augment_api,
            set_dock_visible,
            set_click_through,
            open_screen_recording_settings,
            is_league_foreground,
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

                // Initial setup — overlay covering full screen
                unsafe {
                    use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
                    let ns_win = ns_win_ptr as cocoa::base::id;

                    // Cover the full screen without native fullscreen
                    let main_screen: cocoa::base::id = msg_send![objc::class!(NSScreen), mainScreen];
                    let frame: cocoa::foundation::NSRect = msg_send![main_screen, frame];
                    ns_win.setFrame_display_(frame, cocoa::base::YES);

                    // kCGAssistiveTechHighWindowLevel = 1500; above screen saver (1000)
                    // and most game windows, keeps overlay on top in borderless windowed mode
                    ns_win.setLevel_(1500);
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
                                    ns_win.setLevel_(1500);
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
