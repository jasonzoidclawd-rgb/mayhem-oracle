use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeMatchExport {
    pub schema_version: u8,
    pub game_hash: String,
    pub patch: String,
    pub queue_id: u16,
    pub duration_seconds: u64,
    pub collected_at: String,
    pub source: MatchSource,
    pub participants: Vec<SafeParticipant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contributor_rounds: Option<Vec<ContributorRound>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchSource {
    OwnedHistory,
    Snowball,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeParticipant {
    pub slot: String,
    pub team: u16,
    pub champion_slug: String,
    pub augment_slugs: Vec<String>,
    pub item_ids: Vec<u64>,
    pub won: bool,
    pub stats: SafeStats,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeStats {
    pub kills: u64,
    pub deaths: u64,
    pub assists: u64,
    pub damage_to_champions: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorRound {
    pub round: u8,
    pub offered_augment_slugs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_augment_slug: Option<String>,
    pub ocr_confidence: f64,
}

pub fn sanitize_match(
    _raw: &serde_json::Value,
    _source: MatchSource,
    _contributor_rounds: Option<Vec<ContributorRound>>,
) -> Result<SafeMatchExport, String> {
    Err("sanitizer not implemented".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn mayhem_match() -> Value {
        serde_json::from_str(include_str!("../fixtures/lcu_match_2400.json")).unwrap()
    }

    #[test]
    fn sanitizer_outputs_only_safe_match_export_fields() {
        let safe = sanitize_match(&mayhem_match(), MatchSource::OwnedHistory, None).unwrap();
        let serialized = serde_json::to_value(safe).unwrap();

        assert_eq!(
            serialized.as_object().unwrap().keys().cloned().collect::<Vec<_>>(),
            vec![
                "collectedAt",
                "durationSeconds",
                "gameHash",
                "participants",
                "patch",
                "queueId",
                "schemaVersion",
                "source",
            ]
        );
        let text = serialized.to_string();
        for forbidden in [
            "participantId",
            "participantIdentities",
            "puuid",
            "summonerName",
            "riotId",
            "chat",
            "Forbidden",
        ] {
            assert!(!text.contains(forbidden), "found forbidden field/value: {forbidden}");
        }

        assert_eq!(
            serialized["participants"][0],
            json!({
                "slot": serialized["participants"][0]["slot"],
                "team": 100,
                "championSlug": "aatrox",
                "augmentSlugs": ["deathtouch", "mad-scientist"],
                "itemIds": [3071, 3111],
                "won": true,
                "stats": {
                    "kills": 12,
                    "deaths": 7,
                    "assists": 18,
                    "damageToChampions": 34567
                }
            })
        );
    }

    #[test]
    fn participant_slots_are_random_per_match() {
        let first = sanitize_match(&mayhem_match(), MatchSource::OwnedHistory, None).unwrap();
        let mut next_match = mayhem_match();
        next_match["gameId"] = json!(991240002);
        let second = sanitize_match(&next_match, MatchSource::Snowball, None).unwrap();

        assert_ne!(first.participants[0].slot, second.participants[0].slot);
        assert!(!first.participants[0].slot.contains('1'));
        assert!(!second.participants[0].slot.contains('1'));
    }

    #[test]
    fn rejects_non_mayhem_queue() {
        let raw: Value =
            serde_json::from_str(include_str!("../fixtures/lcu_match_non_mayhem.json")).unwrap();

        assert!(sanitize_match(&raw, MatchSource::OwnedHistory, None).is_err());
    }
}
