//! Vision OCR regression test against the committed card-name corpus.
//! macOS-only: the corpus crops are zh-TW captures and CI for Windows OCR is
//! covered by the manual Windows checklist instead.
#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::path::Path;

use mayhem_oracle_lib::ocr::{read_card_text, GameLocale};

#[derive(serde::Deserialize)]
struct CatalogAugment {
    slug: String,
    #[serde(rename = "name_zh_TW")]
    name_zh_tw: Option<String>,
}

#[derive(serde::Deserialize)]
struct Catalog {
    augments: Vec<CatalogAugment>,
}

fn normalized(value: &str) -> String {
    value.chars().filter(|c| !c.is_whitespace()).collect()
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut current = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(ca != cb);
            current.push(substitution.min(previous[j + 1] + 1).min(current[j] + 1));
        }
        previous = current;
    }
    previous[b.len()]
}

/// Mirrors the frontend matcher's tolerance: exact, containment either way,
/// or levenshtein within 30% of the shorter string.
fn matches(ocr_text: &str, expected: &str) -> bool {
    if ocr_text.is_empty() {
        return false;
    }
    if ocr_text.contains(expected) || expected.contains(ocr_text) {
        return true;
    }
    let a: Vec<char> = ocr_text.chars().collect();
    let b: Vec<char> = expected.chars().collect();
    let threshold = (a.len().min(b.len()) as f64 * 0.3).ceil() as usize;
    levenshtein(&a, &b) <= threshold
}

#[test]
fn vision_reads_corpus_card_names() {
    let overlay_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("overlay root");

    let ground_truth: HashMap<String, HashMap<String, String>> = serde_json::from_str(
        &std::fs::read_to_string(overlay_root.join("corpus/ground_truth.json"))
            .expect("corpus/ground_truth.json"),
    )
    .expect("parse ground truth");

    let catalog: Catalog = serde_json::from_str(
        &std::fs::read_to_string(overlay_root.join("public/data/augments.json"))
            .expect("public/data/augments.json"),
    )
    .expect("parse augments");
    let names: HashMap<&str, String> = catalog
        .augments
        .iter()
        .filter_map(|augment| {
            augment
                .name_zh_tw
                .as_deref()
                .map(|name| (augment.slug.as_str(), normalized(name)))
        })
        .collect();

    let mut total = 0usize;
    let mut matched = 0usize;
    let mut misses = Vec::new();

    for (screenshot, regions) in &ground_truth {
        for (region, slug) in regions {
            let index = region.strip_prefix("region_").unwrap_or(region);
            let crop_path =
                overlay_root.join(format!("corpus/crops/region_{}_{}.png", screenshot, index));
            if !crop_path.exists() {
                continue;
            }
            // Slugs can rotate out of the current patch catalog; skip those.
            let Some(expected) = names.get(slug.as_str()) else {
                continue;
            };

            let crop = image::open(&crop_path).expect("open crop");
            let text = read_card_text(&crop, Some(GameLocale::ZhTw), &[])
                .expect("vision ocr")
                .unwrap_or_default();

            total += 1;
            if matches(&text, expected) {
                matched += 1;
            } else {
                misses.push(format!(
                    "{} {}: expected {:?}, got {:?}",
                    screenshot, region, expected, text
                ));
            }
        }
    }

    assert!(
        total >= 10,
        "corpus too small to be meaningful: {} samples",
        total
    );

    let rate = matched as f64 / total as f64;
    eprintln!(
        "vision corpus: {}/{} matched ({:.0}%)",
        matched,
        total,
        rate * 100.0
    );
    for miss in &misses {
        eprintln!("MISS {}", miss);
    }
    assert!(
        rate >= 0.85,
        "vision corpus match rate {:.2} below 0.85 ({}/{} matched)",
        rate,
        matched,
        total
    );
}
