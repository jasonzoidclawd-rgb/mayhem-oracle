use serde::{Deserialize, Serialize};

pub const LEAGUE_GAME_BUNDLE_ID: &str = "com.riotgames.LeagueofLegends.GameClient";
pub const LEAGUE_CLIENT_UX_BUNDLE_ID: &str = "com.riotgames.LeagueofLegends.LeagueClientUx";
pub const RIOT_CLIENT_BUNDLE_ID: &str = "com.riotgames.RiotGames.RiotClient";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundState {
    pub game_window_foreground: bool,
    pub league_client_foreground: bool,
    pub riot_client_foreground: bool,
    pub game_running: bool,
    pub game_window_detected: bool,
    pub foreground_app_name: Option<String>,
    pub foreground_bundle_identifier: Option<String>,
    pub foreground_owner_name: Option<String>,
    pub foreground_window_title: Option<String>,
    pub foreground_executable_path: Option<String>,
    pub foreground_window_handle: Option<u64>,
}

pub struct ForegroundObservation<'a> {
    pub app_name: Option<&'a str>,
    pub bundle_identifier: Option<&'a str>,
    pub owner_name: Option<&'a str>,
    pub window_title: Option<&'a str>,
    pub executable_path: Option<&'a str>,
    pub window_handle: Option<u64>,
    pub game_running: bool,
    pub game_window_detected: bool,
}

pub fn classify_foreground(observation: ForegroundObservation<'_>) -> ForegroundState {
    let app_name = observation.app_name.map(normalize_identity);
    let game_bundle = observation
        .bundle_identifier
        .is_some_and(|bundle| bundle.eq_ignore_ascii_case(LEAGUE_GAME_BUNDLE_ID));
    let riot_client_bundle = observation
        .bundle_identifier
        .is_some_and(|bundle| bundle.eq_ignore_ascii_case(RIOT_CLIENT_BUNDLE_ID));
    let league_client_ux_bundle = observation
        .bundle_identifier
        .is_some_and(|bundle| bundle.eq_ignore_ascii_case(LEAGUE_CLIENT_UX_BUNDLE_ID));
    let riot_client_app = app_name.as_deref() == Some("riotclient");
    let league_client_ux_app = app_name.as_deref() == Some("leagueclientux");
    // When the OS gives us an executable path, it is authoritative. A generic
    // "League of Legends" application name must not override a known client
    // executable during the postgame/client transition.
    let game_process = observation
        .executable_path
        .map(|path| is_actual_game_process("", Some(path)))
        .unwrap_or_else(|| {
            observation
                .app_name
                .is_some_and(|name| is_actual_game_process(name, None))
        });
    let riot_client_process = observation
        .executable_path
        .map(|path| is_riot_client_process("", Some(path)))
        .unwrap_or_else(|| {
            observation
                .app_name
                .is_some_and(|name| is_riot_client_process(name, None))
        });
    let league_client_ux_process = observation
        .executable_path
        .map(|path| is_league_client_ux_process("", Some(path)))
        .unwrap_or_else(|| {
            observation
                .app_name
                .is_some_and(|name| is_league_client_ux_process(name, None))
        });
    let game_window = observation
        .owner_name
        .zip(observation.window_title)
        .is_some_and(|(owner, title)| is_actual_game_window(owner, title));
    let riot_client_window = observation
        .owner_name
        .is_some_and(|owner| normalize_identity(owner) == "riotclient");
    let league_client_foreground = league_client_ux_bundle
        || league_client_ux_app
        || league_client_ux_process
        || riot_client_bundle
        || riot_client_app
        || riot_client_process
        || riot_client_window;

    ForegroundState {
        game_window_foreground: (game_bundle || game_window || game_process)
            && !riot_client_bundle
            && !league_client_ux_bundle
            && !riot_client_app
            && !league_client_ux_app
            && !riot_client_window
            && !riot_client_process
            && !league_client_ux_process,
        league_client_foreground,
        riot_client_foreground: riot_client_bundle
            || riot_client_app
            || riot_client_process
            || riot_client_window,
        game_running: observation.game_running,
        game_window_detected: observation.game_window_detected,
        foreground_app_name: observation.app_name.map(str::to_string),
        foreground_bundle_identifier: observation.bundle_identifier.map(str::to_string),
        foreground_owner_name: observation.owner_name.map(str::to_string),
        foreground_window_title: observation.window_title.map(str::to_string),
        foreground_executable_path: observation.executable_path.map(str::to_string),
        foreground_window_handle: observation.window_handle,
    }
}

/// Effective frontmost PID on macOS.
///
/// `NSWorkspace.frontmostApplication` read outside the main thread can return
/// a value that is seconds STALE (observed: it kept reporting the game process
/// 18s after Terminal took focus, leaving every overlay surface visible over
/// the desktop). The z-order topmost layer-0 window from `CGWindowList` is
/// always fresh and thread-safe, so it is the authority whenever such a window
/// exists; the workspace value is only a fallback for a fullscreen game
/// surface that owns no layer-0 window.
pub fn effective_frontmost_pid(
    topmost_layer0_pid: Option<u32>,
    workspace_frontmost_pid: Option<u32>,
) -> Option<u32> {
    topmost_layer0_pid.or(workspace_frontmost_pid)
}

pub fn is_actual_game_window(owner_name: &str, title: &str) -> bool {
    let owner = normalize_identity(owner_name);
    let title = normalize_identity(title);

    (owner == "leagueoflegends" || owner == "leagueoflegendsgameclient")
        && title.contains("leagueoflegends")
        && title.contains("client")
        && !title.contains("leagueclientux")
}

pub fn is_actual_game_process(name: &str, executable_path: Option<&str>) -> bool {
    if let Some(path) = executable_path {
        let path = path.replace('\\', "/").to_lowercase();
        return path.contains("/game/leagueoflegends.app/contents/macos/leagueoflegends")
            || path.ends_with("/game/league of legends.exe");
    }

    let normalized_name = normalize_identity(name);
    normalized_name == "leagueoflegends" || normalized_name == "leagueoflegendsexe"
}

pub fn is_riot_client_process(name: &str, executable_path: Option<&str>) -> bool {
    if let Some(path) = executable_path {
        let path = path.replace('\\', "/").to_lowercase();
        return path.contains("/riot client.app/contents/macos/riotclient")
            || path.ends_with("/riotclientservices.exe");
    }

    let normalized_name = normalize_identity(name);
    normalized_name == "riotclientservices" || normalized_name == "riotclientservicesexe"
}

pub fn is_league_client_ux_process(name: &str, executable_path: Option<&str>) -> bool {
    if let Some(path) = executable_path {
        let path = path.replace('\\', "/").to_lowercase();
        return path.contains("/leagueclientux.app/contents/macos/leagueclientux")
            || path.ends_with("/leagueclientux.exe");
    }

    let normalized_name = normalize_identity(name);
    normalized_name == "leagueclientux" || normalized_name == "leagueclientuxexe"
}

fn normalize_identity(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        classify_foreground, effective_frontmost_pid, is_actual_game_process,
        is_actual_game_window, is_league_client_ux_process, is_riot_client_process,
        ForegroundObservation, LEAGUE_CLIENT_UX_BUNDLE_ID, LEAGUE_GAME_BUNDLE_ID,
        RIOT_CLIENT_BUNDLE_ID,
    };

    fn observation<'a>(
        app_name: &'a str,
        bundle_identifier: &'a str,
        owner_name: &'a str,
        window_title: &'a str,
        game_running: bool,
    ) -> ForegroundObservation<'a> {
        ForegroundObservation {
            app_name: Some(app_name),
            bundle_identifier: Some(bundle_identifier),
            owner_name: Some(owner_name),
            window_title: Some(window_title),
            executable_path: None,
            window_handle: None,
            game_running,
            game_window_detected: game_running,
        }
    }

    #[test]
    fn actual_game_bundle_is_the_only_league_bundle_that_grants_focus() {
        let state = classify_foreground(observation(
            "League Of Legends",
            LEAGUE_GAME_BUNDLE_ID,
            "League Of Legends",
            "League of Legends (TM) Client",
            true,
        ));

        assert!(state.game_window_foreground);
        assert!(!state.riot_client_foreground);
        assert!(!state.league_client_foreground);
    }

    #[test]
    fn fullscreen_game_bundle_grants_focus_without_a_regular_window() {
        let state = classify_foreground(ForegroundObservation {
            app_name: Some("League Of Legends"),
            bundle_identifier: Some(LEAGUE_GAME_BUNDLE_ID),
            owner_name: None,
            window_title: None,
            executable_path: None,
            window_handle: None,
            game_running: true,
            game_window_detected: false,
        });

        assert!(state.game_window_foreground);
        assert!(!state.riot_client_foreground);
        assert!(!state.game_window_detected);
    }

    #[test]
    fn league_client_ux_is_not_the_game_foreground() {
        let state = classify_foreground(observation(
            "League of Legends",
            "com.riotgames.LeagueofLegends.LeagueClientUx",
            "League of Legends",
            "",
            true,
        ));

        assert!(!state.game_window_foreground);
        assert!(!state.riot_client_foreground);
        assert!(state.league_client_foreground);
        assert!(state.game_running);
    }

    #[test]
    fn riot_client_is_never_game_foreground_even_when_game_is_running() {
        let state = classify_foreground(observation(
            "Riot Client",
            RIOT_CLIENT_BUNDLE_ID,
            "Riot Client",
            "Riot Client",
            true,
        ));

        assert!(!state.game_window_foreground);
        assert!(state.riot_client_foreground);
        assert!(state.game_running);
    }

    #[test]
    fn unrelated_frontmost_apps_are_not_game_foreground() {
        for (name, bundle) in [
            ("Finder", "com.apple.finder"),
            ("Safari", "com.apple.Safari"),
            ("Terminal", "com.apple.Terminal"),
        ] {
            let state = classify_foreground(observation(name, bundle, name, name, true));
            assert!(!state.game_window_foreground, "{name} must stay hidden");
            assert!(!state.riot_client_foreground, "{name} is not Riot Client");
        }
    }

    #[test]
    fn zorder_topmost_window_overrides_a_stale_workspace_frontmost() {
        // Regression pin for the 13:33:54 leak: NSWorkspace kept returning the
        // game PID while Terminal's window was in front. The z-order topmost
        // layer-0 window is the authority whenever one exists.
        let game_pid = Some(4242);
        let terminal_pid = Some(7001);
        assert_eq!(effective_frontmost_pid(terminal_pid, game_pid), terminal_pid);
        assert_eq!(effective_frontmost_pid(game_pid, terminal_pid), game_pid);
    }

    #[test]
    fn workspace_frontmost_is_only_a_fallback_for_fullscreen_surfaces() {
        // A fullscreen Metal game owns no layer-0 CG window; only then does
        // the (possibly stale) workspace value decide.
        assert_eq!(effective_frontmost_pid(None, Some(4242)), Some(4242));
        assert_eq!(effective_frontmost_pid(None, None), None);
    }

    #[test]
    fn stale_game_process_metadata_never_survives_a_desktop_frontmost() {
        // End-to-end: once the z-order authority swaps the observation to the
        // desktop app, game_running=true alone must never keep surfaces
        // visible — for every desktop/client app we classify.
        for (name, bundle) in [
            ("Terminal", "com.apple.Terminal"),
            ("Finder", "com.apple.finder"),
            ("Safari", "com.apple.Safari"),
            ("Riot Client", RIOT_CLIENT_BUNDLE_ID),
            ("League Client UX", LEAGUE_CLIENT_UX_BUNDLE_ID),
        ] {
            let state = classify_foreground(ForegroundObservation {
                app_name: Some(name),
                bundle_identifier: Some(bundle),
                owner_name: Some(name),
                window_title: Some(name),
                executable_path: None,
                window_handle: None,
                game_running: true,
                game_window_detected: true,
            });
            assert!(
                !state.game_window_foreground,
                "{name} in front must hide every overlay surface",
            );
        }
    }

    #[test]
    fn game_window_title_can_confirm_game_when_bundle_metadata_is_missing() {
        assert!(is_actual_game_window(
            "League Of Legends",
            "League of Legends (TM) Client",
        ));
        assert!(!is_actual_game_window("League of Legends", ""));
    }

    #[test]
    fn game_process_detection_does_not_accept_the_client_process() {
        assert!(is_actual_game_process("LeagueofLegends", None));
        assert!(is_actual_game_process(
            "unknown",
            Some("/Applications/League of Legends.app/Contents/LoL/Game/LeagueofLegends.app/Contents/MacOS/LeagueofLegends"),
        ));
        assert!(!is_actual_game_process("LeagueClientUx", None));
        assert!(is_actual_game_process(
            "unknown",
            Some(r"C:\Riot Games\League of Legends\Game\League of Legends.exe"),
        ));
        assert!(!is_actual_game_process(
            "unknown",
            Some(r"C:\Riot Games\League of Legends\LeagueClientUx.exe"),
        ));
        assert!(!is_actual_game_process(
            "League Of Legends",
            Some(r"C:\Riot Games\League of Legends\LeagueClientUx.exe"),
        ));
        assert!(is_riot_client_process(
            "unknown",
            Some(r"C:\Riot Games\Riot Client\RiotClientServices.exe"),
        ));
        assert!(is_league_client_ux_process(
            "unknown",
            Some(r"C:\Riot Games\League of Legends\LeagueClientUx.exe"),
        ));
        assert!(is_riot_client_process(
            "Riot Client",
            Some("/Applications/Riot Client.app/Contents/MacOS/RiotClient"),
        ));
        assert!(is_league_client_ux_process(
            "League Of Legends",
            Some(
                "/Applications/League of Legends.app/Contents/LoL/LeagueClientUx.app/Contents/MacOS/LeagueClientUx",
            ),
        ));
    }

    #[test]
    fn known_client_executable_overrides_a_generic_league_app_name() {
        let state = classify_foreground(ForegroundObservation {
            app_name: Some("League Of Legends"),
            bundle_identifier: None,
            owner_name: Some("League Of Legends"),
            window_title: Some("League of Legends (TM) Client"),
            executable_path: Some(
                "/Applications/League of Legends.app/Contents/LoL/LeagueClientUx.app/Contents/MacOS/LeagueClientUx",
            ),
            window_handle: None,
            game_running: true,
            game_window_detected: true,
        });

        assert!(!state.game_window_foreground);
        assert!(state.league_client_foreground);
    }

    #[test]
    fn known_non_game_bundle_overrides_misleading_window_metadata() {
        let state = classify_foreground(observation(
            "Riot Client",
            RIOT_CLIENT_BUNDLE_ID,
            "League Of Legends",
            "League of Legends (TM) Client",
            true,
        ));
        assert!(!state.game_window_foreground);

        let state = classify_foreground(observation(
            "Riot Client",
            LEAGUE_GAME_BUNDLE_ID,
            "League Of Legends",
            "League of Legends (TM) Client",
            true,
        ));
        assert!(!state.game_window_foreground);
        assert!(state.riot_client_foreground);

        let state = classify_foreground(observation(
            "Riot Client",
            LEAGUE_GAME_BUNDLE_ID,
            "Riot Client",
            "Riot Client",
            true,
        ));
        assert!(!state.game_window_foreground);

        let state = classify_foreground(observation(
            "League Client UX",
            LEAGUE_CLIENT_UX_BUNDLE_ID,
            "League Of Legends",
            "League of Legends (TM) Client",
            true,
        ));
        assert!(!state.game_window_foreground);
    }
}
