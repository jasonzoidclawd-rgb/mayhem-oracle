use std::io::Write;
use std::path::{Path, PathBuf};

use crate::sanitize::SafeMatchExport;
use flate2::{write::GzEncoder, Compression};
use rand::Rng;
use serde::{Deserialize, Serialize};

pub const CONTENT_TYPE: &str = "application/json";
pub const CONTENT_ENCODING: &str = "gzip";
pub const SCHEMA_VERSION_HEADER: &str = "x-mayhem-schema-version";

#[derive(Clone, Debug)]
pub struct UploadQueue {
    directory: PathBuf,
}

impl UploadQueue {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        Ok(Self { directory })
    }

    pub fn enqueue_batch(&self, matches: &[SafeMatchExport]) -> Result<PathBuf, String> {
        if matches.is_empty() {
            return Err("cannot queue an empty batch".to_string());
        }
        let batch = Batch {
            schema_version: 1,
            matches,
        };
        let json = serde_json::to_vec(&batch).map_err(|error| error.to_string())?;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(&json)
            .map_err(|error| error.to_string())?;
        let compressed = encoder.finish().map_err(|error| error.to_string())?;
        let path = self.directory.join(format!(
            "batch-{}-{:08x}.json.gz",
            chrono::Utc::now().timestamp_millis(),
            rand::thread_rng().gen::<u32>()
        ));
        std::fs::write(&path, compressed).map_err(|error| error.to_string())?;
        self.write_retry_metadata(&path, &RetryMetadata::default())?;
        Ok(path)
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn queued_count(&self) -> usize {
        self.batch_paths().map(|paths| paths.len()).unwrap_or(0)
    }

    pub fn due_batches(&self, now_epoch_seconds: i64) -> Result<Vec<PathBuf>, String> {
        Ok(self
            .batch_paths()?
            .into_iter()
            .filter(|path| {
                self.read_retry_metadata(path)
                    .map(|metadata| metadata.next_attempt_epoch_seconds <= now_epoch_seconds)
                    .unwrap_or(false)
            })
            .collect())
    }

    pub fn mark_failure(&self, batch_path: &Path, now_epoch_seconds: i64) -> Result<(), String> {
        let mut metadata = self.read_retry_metadata(batch_path)?;
        metadata.attempts += 1;
        metadata.next_attempt_epoch_seconds =
            now_epoch_seconds + retry_delay_seconds(metadata.attempts - 1) as i64;
        self.write_retry_metadata(batch_path, &metadata)
    }

    pub fn mark_success(&self, batch_path: &Path) -> Result<(), String> {
        if batch_path.exists() {
            std::fs::remove_file(batch_path).map_err(|error| error.to_string())?;
        }
        let metadata_path = metadata_path(batch_path);
        if metadata_path.exists() {
            std::fs::remove_file(metadata_path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub async fn upload_due(
        &self,
        endpoint: &str,
        device_token: &str,
        now_epoch_seconds: i64,
    ) -> Result<usize, String> {
        let client = reqwest::Client::new();
        let mut uploaded = 0;
        for path in self.due_batches(now_epoch_seconds)? {
            let body = std::fs::read(&path).map_err(|error| error.to_string())?;
            let result = client
                .post(endpoint)
                .bearer_auth(device_token)
                .header(reqwest::header::CONTENT_TYPE, CONTENT_TYPE)
                .header(reqwest::header::CONTENT_ENCODING, CONTENT_ENCODING)
                .header(SCHEMA_VERSION_HEADER, "1")
                .body(body)
                .send()
                .await;
            match result {
                Ok(response) if response.status().is_success() => {
                    self.mark_success(&path)?;
                    uploaded += 1;
                }
                _ => self.mark_failure(&path, now_epoch_seconds)?,
            }
        }
        Ok(uploaded)
    }

    fn batch_paths(&self) -> Result<Vec<PathBuf>, String> {
        let mut paths = std::fs::read_dir(&self.directory)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.ends_with(".json.gz"))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        paths.sort();
        Ok(paths)
    }

    fn read_retry_metadata(&self, batch_path: &Path) -> Result<RetryMetadata, String> {
        let path = metadata_path(batch_path);
        if !path.exists() {
            return Ok(RetryMetadata::default());
        }
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())
    }

    fn write_retry_metadata(
        &self,
        batch_path: &Path,
        metadata: &RetryMetadata,
    ) -> Result<(), String> {
        let bytes = serde_json::to_vec(metadata).map_err(|error| error.to_string())?;
        std::fs::write(metadata_path(batch_path), bytes).map_err(|error| error.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Batch<'a> {
    schema_version: u8,
    matches: &'a [SafeMatchExport],
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RetryMetadata {
    attempts: u32,
    next_attempt_epoch_seconds: i64,
}

fn metadata_path(batch_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.meta.json", batch_path.display()))
}

pub fn retry_delay_seconds(attempt: u32) -> u64 {
    30_u64
        .saturating_mul(2_u64.saturating_pow(attempt))
        .min(21_600)
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use flate2::read::GzDecoder;
    use serde_json::Value;

    use super::*;
    use crate::sanitize::{sanitize_match, MatchSource};

    #[test]
    fn queues_a_gzip_batch_containing_only_safe_exports() {
        let temp = tempfile::tempdir().unwrap();
        let queue = UploadQueue::new(temp.path().to_path_buf()).unwrap();
        let raw: Value =
            serde_json::from_str(include_str!("../fixtures/lcu_match_2400.json")).unwrap();
        let safe = sanitize_match(&raw, MatchSource::OwnedHistory, None).unwrap();

        let batch_path = queue.enqueue_batch(&[safe]).unwrap();
        if let Ok(destination) = std::env::var("M3A_FIXTURE_PATH") {
            std::fs::copy(&batch_path, destination).unwrap();
        }
        assert_eq!(
            batch_path.extension().and_then(|value| value.to_str()),
            Some("gz")
        );

        let mut json = String::new();
        GzDecoder::new(std::fs::File::open(batch_path).unwrap())
            .read_to_string(&mut json)
            .unwrap();
        let batch: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(batch["schemaVersion"], 1);
        assert_eq!(batch["matches"].as_array().unwrap().len(), 1);
        assert!(!json.contains("puuid"));
        assert!(!json.contains("summonerName"));
        assert!(!json.contains("riotId"));
    }

    #[test]
    fn retry_delay_uses_bounded_exponential_backoff() {
        assert_eq!(retry_delay_seconds(0), 30);
        assert_eq!(retry_delay_seconds(1), 60);
        assert_eq!(retry_delay_seconds(5), 960);
        assert_eq!(retry_delay_seconds(20), 21_600);
    }

    #[test]
    fn failed_batches_are_not_due_until_backoff_expires() {
        let temp = tempfile::tempdir().unwrap();
        let queue = UploadQueue::new(temp.path().to_path_buf()).unwrap();
        let raw: Value =
            serde_json::from_str(include_str!("../fixtures/lcu_match_2400.json")).unwrap();
        let safe = sanitize_match(&raw, MatchSource::OwnedHistory, None).unwrap();
        let batch_path = queue.enqueue_batch(&[safe]).unwrap();

        queue.mark_failure(&batch_path, 1_000).unwrap();

        assert!(queue.due_batches(1_029).unwrap().is_empty());
        assert_eq!(queue.due_batches(1_030).unwrap(), vec![batch_path]);
    }
}
