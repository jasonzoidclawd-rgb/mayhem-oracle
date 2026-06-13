use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    raw: &serde_json::Value,
    source: MatchSource,
    contributor_rounds: Option<Vec<ContributorRound>>,
) -> Result<SafeMatchExport, String> {
    let queue_id = raw
        .get("queueId")
        .and_then(serde_json::Value::as_u64)
        .ok_or("match is missing queueId")?;
    if queue_id != 2400 {
        return Err(format!("unsupported queueId {queue_id}"));
    }

    let game_id = raw
        .get("gameId")
        .and_then(value_as_string)
        .ok_or("match is missing gameId")?;
    let game_hash = hex::encode(Sha256::digest(game_id.as_bytes()));
    let patch = raw
        .get("gameVersion")
        .and_then(serde_json::Value::as_str)
        .and_then(patch_from_version)
        .ok_or("match is missing a valid gameVersion")?;
    let duration_seconds = raw
        .get("gameDuration")
        .and_then(serde_json::Value::as_u64)
        .ok_or("match is missing gameDuration")?;
    let participants = raw
        .get("participants")
        .and_then(serde_json::Value::as_array)
        .ok_or("match is missing participants")?
        .iter()
        .map(sanitize_participant)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(SafeMatchExport {
        schema_version: 1,
        game_hash,
        patch,
        queue_id: 2400,
        duration_seconds,
        collected_at: chrono::Utc::now().to_rfc3339(),
        source,
        participants,
        contributor_rounds,
    })
}

fn sanitize_participant(raw: &serde_json::Value) -> Result<SafeParticipant, String> {
    let team = raw
        .get("teamId")
        .and_then(serde_json::Value::as_u64)
        .ok_or("participant is missing teamId")?;
    if team != 100 && team != 200 {
        return Err(format!("unsupported participant team {team}"));
    }

    let champion_slug = raw
        .get("championSlug")
        .or_else(|| raw.get("championName"))
        .and_then(serde_json::Value::as_str)
        .map(slugify)
        .filter(|value| !value.is_empty())
        .ok_or("participant is missing champion")?;
    let stats = raw.get("stats").ok_or("participant is missing stats")?;

    Ok(SafeParticipant {
        slot: random_slot(),
        team: team as u16,
        champion_slug,
        augment_slugs: string_array(raw.get("augmentSlugs").or_else(|| raw.get("augments"))),
        item_ids: item_ids(raw, stats),
        won: stats
            .get("win")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        stats: SafeStats {
            kills: u64_field(stats, "kills"),
            deaths: u64_field(stats, "deaths"),
            assists: u64_field(stats, "assists"),
            damage_to_champions: u64_field(stats, "totalDamageDealtToChampions"),
        },
    })
}

fn value_as_string(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn patch_from_version(version: &str) -> Option<String> {
    let mut parts = version.split('.');
    Some(format!("{}.{}", parts.next()?, parts.next()?))
}

fn slugify(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(slugify)
        .filter(|value| !value.is_empty())
        .collect()
}

fn item_ids(raw: &serde_json::Value, stats: &serde_json::Value) -> Vec<u64> {
    if let Some(items) = raw.get("itemIds").and_then(serde_json::Value::as_array) {
        return items
            .iter()
            .filter_map(serde_json::Value::as_u64)
            .filter(|item| *item != 0)
            .collect();
    }

    (0..=6)
        .filter_map(|index| stats.get(format!("item{index}")))
        .filter_map(serde_json::Value::as_u64)
        .filter(|item| *item != 0)
        .collect()
}

fn u64_field(value: &serde_json::Value, field: &str) -> u64 {
    value
        .get(field)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}

fn random_slot() -> String {
    use rand::Rng;

    const ALPHABET: &[u8] = b"abcdefghijkmnopqrstuvwxyz";
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
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
            serialized
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
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
            assert!(
                !text.contains(forbidden),
                "found forbidden field/value: {forbidden}"
            );
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
