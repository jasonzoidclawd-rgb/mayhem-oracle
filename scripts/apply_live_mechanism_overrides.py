#!/usr/bin/env python3
"""Apply curated observed-live mechanism overrides.

Some Mayhem mechanics can be live in game while third-party scrape metadata
temporarily marks them retired. These overrides keep the original lifecycle
record, but allow the engine/pool/combo pipeline to treat the augment as
currently offerable until Riot-authored hotfix or patch-note data proves
otherwise.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR, ROOT

OVERRIDES_PATH = ROOT / "data" / "curated" / "live-mechanism-overrides.json"
AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"
POOL_RULES_PATH = INTERNAL_DATA_DIR / "pool-rules.json"
HOTFIX_PATH = INTERNAL_DATA_DIR / "mayhem-hotfixes.json"

LOCALE_FIELDS = {
    "en": "name",
    "zh-TW": "name_zh_TW",
    "zh-CN": "name_zh_CN",
    "ja": "name_ja",
    "ko": "name_ko",
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def localized_names(augment: dict) -> dict[str, str]:
    return {
        locale: augment.get(field) or augment.get("name") or augment["slug"]
        for locale, field in LOCALE_FIELDS.items()
    }


def mechanism_change(override: dict, augment: dict) -> dict:
    return {
        "slug": override["slug"],
        "names": localized_names(augment),
        "rarity": augment.get("rarity"),
        "type": "mechanism",
        "status": override["status"],
        "label": override["label"],
        "source": override["source"],
    }


def has_confirming_removal(hotfixes: dict, slug: str, observed_at: str) -> bool:
    """A Riot-authored CDragon removal after observation cancels the override."""
    for event in hotfixes.get("events", []):
        if event.get("date", "") < observed_at:
            continue
        for change in event.get("changes", []):
            if change.get("slug") == slug and change.get("type") == "removed":
                return True
    return False


def main() -> None:
    if not OVERRIDES_PATH.exists():
        print("No live mechanism overrides configured.")
        return

    overrides = read_json(OVERRIDES_PATH).get("overrides", [])
    active = [o for o in overrides if o.get("slug") and o.get("status") == "bug_mechanism"]
    if not active:
        print("No active live mechanism overrides.")
        return

    augments_data = read_json(AUGMENTS_PATH)
    pool_rules = read_json(POOL_RULES_PATH)
    augments_by_slug = {a["slug"]: a for a in augments_data.get("augments", [])}

    observed_live = pool_rules.setdefault("availability_overrides", {}).setdefault("observed_live", {})
    hotfixes = read_json(HOTFIX_PATH) if HOTFIX_PATH.exists() else {"events": []}
    hotfixes["patch"] = pool_rules.get("patch", augments_data.get("patch", "unknown"))
    hotfixes["generated_at"] = datetime.now(timezone.utc).isoformat()

    event_by_date = {event.get("date"): event for event in hotfixes.get("events", [])}

    applied = 0
    for override in active:
        slug = override["slug"]
        augment = augments_by_slug.get(slug)
        if not augment:
            print(f"  [live-mechanism] missing augment {slug}; skipped")
            continue
        if has_confirming_removal(hotfixes, slug, override["observed_at"]):
            flags = augment.setdefault("flags", {})
            for key in (
                "availability_override",
                "availability_label",
                "availability_source",
                "availability_observed_at",
            ):
                flags.pop(key, None)
            observed_live.pop(slug, None)
            print(f"  [live-mechanism] {slug} has a confirming removal hotfix; override skipped")
            continue

        augment.setdefault("flags", {}).update({
            "availability_override": override["status"],
            "availability_label": override["label"],
            "availability_source": override["source"],
            "availability_observed_at": override["observed_at"],
        })
        observed_live[slug] = {
            key: override[key]
            for key in ("status", "label", "observed_at", "source", "score_weight", "remove_when")
            if key in override
        }

        event = event_by_date.setdefault(
            override["observed_at"],
            {
                "detected_at": f"{override['observed_at']}T00:00:00+00:00",
                "patch": hotfixes["patch"],
                "date": override["observed_at"],
                "changes": [],
            },
        )
        event["patch"] = hotfixes["patch"]
        event["changes"] = [
            change for change in event.get("changes", []) if change.get("slug") != slug
        ] + [mechanism_change(override, augment)]
        applied += 1

    hotfixes["events"] = sorted(event_by_date.values(), key=lambda e: e["detected_at"], reverse=True)

    write_json(AUGMENTS_PATH, augments_data)
    write_json(POOL_RULES_PATH, pool_rules)
    write_json(HOTFIX_PATH, hotfixes)
    print(f"Applied {applied} live mechanism override(s).")


if __name__ == "__main__":
    main()
