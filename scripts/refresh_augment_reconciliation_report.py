#!/usr/bin/env python3
"""Refresh the deterministic augment authority report after assembly.

The report is an internal diagnostic artifact, but its status counts and
unverified lists must stay aligned with the assembled catalog. Keeping this
small refresh in the normal data workflow prevents a source-owned lifecycle
change from leaving a stale review report behind.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR


REPORT_PATH = INTERNAL_DATA_DIR / "augment-reconciliation-report.json"
AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"

STATUS_FIELDS = {
    "unverified_legacy": "unverifiedLegacy",
    "candidate_registry_present": "candidateRegistryPresent",
    "disabled": "disabled",
    "removed": "removed",
}


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def row_entry(row: dict) -> dict:
    availability = row.get("availability") if isinstance(row.get("availability"), dict) else {}
    signals = availability.get("signals") if isinstance(availability.get("signals"), dict) else {}
    return {
        "slug": row.get("slug"),
        "augmentId": row.get("augmentId"),
        "name": row.get("name"),
        "signals": signals,
    }


def refresh_report() -> dict:
    report = read(REPORT_PATH)
    augments = read(AUGMENTS_PATH).get("augments", [])
    rows = [row for row in augments if isinstance(row, dict)]
    previous_status_entries = {
        report_key: list((report.get(report_key) or {}).get("augments", []))
        for report_key in STATUS_FIELDS.values()
    }
    status_by_slug = {
        str(row.get("slug")): row
        for row in rows
        if row.get("slug")
    }
    status_counts = Counter(
        str((row.get("availability") or {}).get("status") or "")
        for row in rows
    )
    valid_statuses = list(report.get("availability", {}).get("validStatuses", []))
    report.setdefault("availability", {})["byStatus"] = {
        status: status_counts.get(status, 0)
        for status in valid_statuses
    }
    conflicts = [row_entry(row) for row in rows if (row.get("availability") or {}).get("status") == "conflict"]
    report["availability"]["conflicts"] = conflicts
    report["availability"]["conflictCount"] = len(conflicts)

    for status, report_key in STATUS_FIELDS.items():
        matching = [row_entry(row) for row in rows if (row.get("availability") or {}).get("status") == status]
        report[report_key] = {"count": len(matching), "augments": matching}

    source_counts = report.setdefault("sourceCounts", {})
    base = read(INTERNAL_DATA_DIR / "augment-base-catalog.json")
    base_counts = base.get("counts", {})
    identity = read(INTERNAL_DATA_DIR / "augment-identity-map.json")
    identity_counts = identity.get("counts", {})
    wiki = read(INTERNAL_DATA_DIR / "augment-wiki-feed.json")
    wiki_counts = wiki.get("counts", {})
    tencent = read(INTERNAL_DATA_DIR / "augment-tencent-feed.json")
    tencent_counts = tencent.get("counts", {})
    source_counts.update({
        "augments": len(rows),
        "assembledAugments": len(rows),
        "cdragonBaseCatalogAugments": len(base.get("augments", [])),
        "baseCatalogAugments": len(base.get("augments", [])),
        "kiwiDefinitionTokens": base_counts.get("kiwiDefinitionTokens", 0),
        "kiwiUnmatchedTokens": base_counts.get("kiwiUnmatchedTokens", 0),
        "kiwiAliasedTokens": base_counts.get("kiwiAliasedTokens", 0),
        "wikiFeedAugments": wiki_counts.get("matchedAugmentIds", 0),
        "wikiRows": wiki_counts.get("wikiRows", 0),
        "wikiAugments": wiki_counts.get("matchedAugmentIds", 0),
        "tencentLive": tencent_counts.get("live", 0),
        "tencentRemoved": tencent_counts.get("removed", 0),
        "tencentDisabled": tencent_counts.get("disabled", 0),
        "identityMapRows": len(identity.get("mappings", [])),
    })

    # Rebuild all status lists from current rows. The previous report contains
    # richer source diagnostics; retain those fields for unchanged rows and
    # only synthesize a compact entry for newly reclassified rows.
    for status, report_key in STATUS_FIELDS.items():
        previous = {
            str(entry.get("slug")): entry
            for entry in previous_status_entries.get(report_key, [])
            if isinstance(entry, dict) and entry.get("slug")
        }
        entries = []
        for row in rows:
            if (row.get("availability") or {}).get("status") != status:
                continue
            entries.append(previous.get(str(row.get("slug")), row_entry(row)))
        report[report_key] = {"count": len(entries), "augments": sorted(entries, key=lambda entry: str(entry.get("slug", "")))}

    return report


def main() -> None:
    REPORT_PATH.write_text(
        json.dumps(refresh_report(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Refreshed {REPORT_PATH}")


if __name__ == "__main__":
    main()
