use serde::{Deserialize, Serialize};

pub const LEAGUE_GAME_BUNDLE_ID: &str = "com.riotgames.LeagueofLegends.GameClient";
pub const LEAGUE_CLIENT_UX_BUNDLE_ID: &str = "com.riotgames.LeagueofLegends.LeagueClientUx";
pub const RIOT_CLIENT_BUNDLE_ID: &str = "com.riotgames.RiotGames.RiotClient";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundState {
    pub game_window_foreground: bool,
    pub riot_client_foreground: bool,
    pub game_running: bool,
    pub game_window_detected: bool,
    pub foreground_app_name: Option<String>,
    pub foreground_bundle_identifier: Option<String>,
    pub foreground_owner_name: Option<String>,
    pub foreground_window_title: Option<String>,
}

pub struct ForegroundObservation<'a> {
    pub app_name: Option<&'a str>,
    pub bundle_identifier: Option<&'a str>,
    pub owner_name: Option<&'a str>,
    pub window_title: Option<&'a str>,
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
    let game_window = observation
        .owner_name
        .zip(observation.window_title)
        .is_some_and(|(owner, title)| is_actual_game_window(owner, title));
    let riot_client_window = observation
        .owner_name
        .is_some_and(|owner| normalize_identity(owner) == "riotclient");

    ForegroundState {
        game_window_foreground: (game_bundle || game_window)
            && !riot_client_bundle
            && !league_client_ux_bundle
            && !riot_client_app
            && !league_client_ux_app
            && !riot_client_window,
        riot_client_foreground: riot_client_bundle || riot_client_app || riot_client_window,
        game_running: observation.game_running,
        game_window_detected: observation.game_window_detected,
        foreground_app_name: observation.app_name.map(str::to_string),
        foreground_bundle_identifier: observation.bundle_identifier.map(str::to_string),
        foreground_owner_name: observation.owner_name.map(str::to_string),
        foreground_window_title: observation.window_title.map(str::to_string),
    }
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
    let normalized_name = normalize_identity(name);
    if normalized_name == "leagueoflegends" {
        return true;
    }

    executable_path
        .map(|path| path.replace('\\', "/").to_lowercase())
        .is_some_and(|path| {
            path.contains("/game/leagueoflegends.app/contents/macos/leagueoflegends")
        })
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
        classify_foreground, is_actual_game_process, is_actual_game_window, ForegroundObservation,
        LEAGUE_CLIENT_UX_BUNDLE_ID, LEAGUE_GAME_BUNDLE_ID, RIOT_CLIENT_BUNDLE_ID,
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
        ] {
            let state = classify_foreground(observation(name, bundle, name, name, true));
            assert!(!state.game_window_foreground, "{name} must stay hidden");
            assert!(!state.riot_client_foreground, "{name} is not Riot Client");
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
