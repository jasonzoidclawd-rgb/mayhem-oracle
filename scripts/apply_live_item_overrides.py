#!/usr/bin/env python3
"""Apply curated live item availability overrides.

Third-party item pages can lag live ARAM Mayhem shop availability. These
overrides keep the item in the historical catalog, but mark it removed so active
item surfaces and tools can automatically exclude it until a deterministic
source confirms it is available again.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR, ROOT

OVERRIDES_PATH = ROOT / "data" / "curated" / "live-item-overrides.json"
ITEMS_PATH = INTERNAL_DATA_DIR / "items.json"
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


def all_items(data: dict) -> list[dict]:
    return [*(data.get("mayhemExclusive") or []), *(data.get("items") or [])]


def localized_names(item: dict) -> dict[str, str]:
    fallback = item.get("name") or item.get("slug") or "Unknown item"
    return {
        locale: item.get(field) or fallback
        for locale, field in LOCALE_FIELDS.items()
    }


def item_change(override: dict, item: dict) -> dict:
    return {
        "entity": "item",
        "slug": override["slug"],
        "names": localized_names(item),
        "type": "removed",
        "source": override["source"],
    }


def main() -> None:
    if not OVERRIDES_PATH.exists():
        print("No live item overrides configured.")
        return

    overrides = read_json(OVERRIDES_PATH).get("overrides", [])
    active = [
        override
        for override in overrides
        if override.get("slug") and override.get("status") == "removed"
    ]
    if not active:
        print("No active live item overrides.")
        return

    items_data = read_json(ITEMS_PATH)
    items_by_slug = {item.get("slug"): item for item in all_items(items_data) if item.get("slug")}

    hotfixes = read_json(HOTFIX_PATH) if HOTFIX_PATH.exists() else {"events": []}
    hotfixes["generated_at"] = datetime.now(timezone.utc).isoformat()
    event_by_date = {event.get("date"): event for event in hotfixes.get("events", [])}

    applied = 0
    for override in active:
        slug = override["slug"]
        item = items_by_slug.get(slug)
        if not item:
            print(f"  [live-item] missing item {slug}; skipped")
            continue

        item.setdefault("flags", {}).update({
            "lifecycle": "removed",
            "availability_source": override["source"],
            "availability_observed_at": override["observed_at"],
            "availability_reason": override.get("reason", ""),
            "availability_remove_when": override.get("remove_when", ""),
        })

        event = event_by_date.setdefault(
            override["observed_at"],
            {
                "detected_at": f"{override['observed_at']}T00:00:00+00:00",
                "patch": hotfixes.get("patch", "unknown"),
                "date": override["observed_at"],
                "changes": [],
            },
        )
        event["patch"] = hotfixes.get("patch", event.get("patch", "unknown"))
        event["changes"] = [
            change
            for change in event.get("changes", [])
            if not (change.get("entity") == "item" and change.get("slug") == slug)
        ] + [item_change(override, item)]
        applied += 1

    hotfixes["events"] = sorted(event_by_date.values(), key=lambda e: e["detected_at"], reverse=True)

    write_json(ITEMS_PATH, items_data)
    write_json(HOTFIX_PATH, hotfixes)
    print(f"Applied {applied} live item override(s).")


if __name__ == "__main__":
    main()
