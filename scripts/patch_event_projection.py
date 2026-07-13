#!/usr/bin/env python3
"""Public/presentation projections for CDragon patch-event archives."""

from __future__ import annotations

import copy
import html
import re
from typing import Any


SECTION_BY_ENTITY = {
    "champion": "champions",
    "item": "new_items",
    "augment": "augments",
}
_TAG_RE = re.compile(r"<[^>]+>")
_TOKEN_RE = re.compile(r"@[^@]+@|%[^%]+%")
PUBLIC_EVENT_FIELDS = (
    "entity_type",
    "canonical_id",
    "slug",
    "names",
    "branch",
    "lane",
    "change_kind",
    "fields_changed",
    "before",
    "after",
    "detected_at",
    "source_patch_label",
    "landed",
    "is_hotfix",
    "known",
    "href",
)


def _locale_names(names: dict[str, Any]) -> dict[str, str]:
    return {
        "en": str(names.get("en") or ""),
        "zh-tw": str(names.get("zh-TW") or names.get("zh-tw") or names.get("en") or ""),
        "zh-cn": str(names.get("zh-CN") or names.get("zh-cn") or names.get("en") or ""),
        "ja-jp": str(names.get("ja") or names.get("ja-jp") or names.get("en") or ""),
        "ko-kr": str(names.get("ko") or names.get("ko-kr") or names.get("en") or ""),
    }


def _display(value: Any) -> str:
    if isinstance(value, str):
        text = _TOKEN_RE.sub(
            " ",
            _TAG_RE.sub(
                " ",
                html.unescape(value).replace("<br>", " ").replace("<br/>", " "),
            ),
        )
        return re.sub(r"\s+", " ", text).strip()
    return repr(value)


def _change_text(event: dict[str, Any]) -> str:
    kind = event.get("change_kind")
    if kind == "added":
        return "Added in the CommunityDragon snapshot."
    if kind == "removed":
        return "Removed in the CommunityDragon snapshot."
    fields = event.get("fields_changed", [])
    before = event.get("before", {})
    after = event.get("after", {})
    return "; ".join(
        f"{field}: {_display(before.get(field))} → {_display(after.get(field))}"
        for field in fields
    ) or "Changed in the CommunityDragon snapshot."


def _kind(event: dict[str, Any]) -> str:
    if event.get("change_kind") in {"added", "removed"}:
        return str(event["change_kind"])
    return "changed"


def _href(
    event: dict[str, Any],
    known: dict[str, set[str]],
    entity_records: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> tuple[bool, str | None]:
    entity_type = str(event.get("entity_type") or "")
    slug = str(event.get("slug") or "")
    canonical_id = str(event.get("canonical_id") or "")
    record = (entity_records or {}).get(entity_type, {}).get(canonical_id, {})
    if "route_identifier" in record or "known" in record:
        route_identifier = str(record.get("route_identifier") or "")
        is_known = record.get("known") is True and bool(route_identifier)
    else:
        # Compatibility for older fixture records; generated projections
        # always take the strict route contract above.
        route_identifier = canonical_id if entity_type == "item" else str(record.get("slug") or slug)
        is_known = route_identifier in known.get(entity_type, set())
    if not is_known:
        return False, None
    route = {"champion": "champions", "item": "items", "augment": "augments"}.get(entity_type)
    return (True, f"/{route}/{route_identifier}") if route else (False, None)


def _event_to_change(
    event: dict[str, Any],
    known: dict[str, set[str]],
    entity_records: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    entity_type = str(event.get("entity_type") or "unknown")
    canonical_id = str(event.get("canonical_id") or "")
    names = _locale_names(event.get("names", {}))
    is_known, href = _href(event, known, entity_records)
    record = (entity_records or {}).get(entity_type, {}).get(canonical_id, {})
    canonical_slug = str(record.get("slug") or event.get("slug") or "")
    target = {
        "type": entity_type,
        "id": canonical_id,
        "canonicalId": canonical_id,
        "slug": canonical_slug,
        "routeIdentifier": str(record.get("route_identifier") or ""),
        "localizedName": names["en"],
        "iconUrl": str(record.get("icon") or ""),
        "name": names["en"],
        "known": is_known,
        "names": {key: value for key, value in names.items() if key != "en" and value},
    }
    if record.get("icon"):
        target["icon"] = record["icon"]
    if record.get("lifecycle", {}).get("state"):
        target["lifecycle"] = record["lifecycle"]["state"]
    if href:
        target["href"] = href
    return {
        "subject": {key: value for key, value in names.items() if value},
        "text": {"en": _change_text(event)},
        "kind": _kind(event),
        "detectedAt": event.get("detected_at"),
        "isHotfix": bool(event.get("is_hotfix")),
        "landedFromPbe": bool(event.get("landed_from_pbe")),
        "targets": [target],
        "relatedEntities": [],
        "metrics": [
            {
                "label": field,
                "before": _display(event.get("before", {}).get(field)),
                "after": _display(event.get("after", {}).get(field)),
            }
            for field in event.get("fields_changed", [])
        ],
        "labels": list(event.get("fields_changed", [])),
        "impact": {"damageRelevant": False, "modelSignals": [], "engineRefs": []},
    }


def _empty_summary() -> dict[str, Any]:
    return {
        "totalChanges": 0,
        "byKind": {},
        "byEntityType": {},
        "byLabel": {},
        "damageRelevant": 0,
    }


def _summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    summary = _empty_summary()
    summary["totalChanges"] = len(events)
    for event in events:
        kind = _kind(event)
        entity_type = str(event.get("entity_type") or "unknown")
        summary["byKind"][kind] = summary["byKind"].get(kind, 0) + 1
        summary["byEntityType"][entity_type] = summary["byEntityType"].get(entity_type, 0) + 1
    return summary


def _metadata_patch(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": metadata.get("version", "unknown"),
        "title": metadata.get("articleTitle", ""),
        "released": str(metadata.get("publishedAt", ""))[:10],
        "sourceUrl": metadata.get("sourceUrl", ""),
        "publishedAt": metadata.get("publishedAt", ""),
        "authors": metadata.get("authors", []),
        "intro": metadata.get("intro", ""),
        "summary": _empty_summary(),
        "sections": [],
    }


def build_patch_notes_projection(
    patch_events: dict[str, Any] | None,
    metadata: dict[str, Any] | None,
    *,
    known: dict[str, set[str]] | None = None,
    pbe_archive: dict[str, Any] | None = None,
    entity_records: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Build legacy-compatible cards solely from current CDragon live events."""
    patch_events = patch_events or {}
    metadata = metadata or {}
    known = known or {"champion": set(), "item": set(), "augment": set()}
    current_cycle = str(patch_events.get("current_open_cycle") or metadata.get("patch") or "unknown")
    landed_preview_keys = {
        (
            event.get("entity_type"),
            event.get("canonical_id"),
            event.get("slug"),
            event.get("change_kind"),
            repr(event.get("after", {})),
        )
        for event in (pbe_archive or {}).get("events", [])
        if isinstance(event, dict) and event.get("lifecycle") == "landed"
    }
    current_events = [
        event for event in patch_events.get("events", [])
        if isinstance(event, dict) and event.get("source_patch_label") == current_cycle
    ]
    current_events = [
        event for event in current_events
        if not (
            event.get("change_kind") == "removed"
            and (entity_records or {})
            .get(str(event.get("entity_type") or ""), {})
            .get(str(event.get("canonical_id") or ""), {})
            .get("lifecycle", {})
            .get("state") in {"active", "added"}
        )
    ]
    current_events = [
        {
            **event,
            "landed_from_pbe": (
                event.get("entity_type"),
                event.get("canonical_id"),
                event.get("slug"),
                event.get("change_kind"),
                repr(event.get("after", {})),
            ) in landed_preview_keys,
        }
        for event in current_events
    ]
    current_events.sort(key=lambda event: (
        str(event.get("entity_type", "")),
        str(event.get("slug", "")),
        tuple(event.get("fields_changed", [])),
    ))
    current_metadata = next(
        (entry for entry in metadata.get("patches", []) if entry.get("version") == current_cycle),
        {},
    )
    groups: dict[str, list[dict[str, Any]]] = {}
    for event in current_events:
        section = SECTION_BY_ENTITY.get(event.get("entity_type"), "general")
        groups.setdefault(section, []).append(_event_to_change(event, known, entity_records))
    current = _metadata_patch(current_metadata)
    current.update({
        "version": current_cycle,
        "title": current_metadata.get("articleTitle") or f"League of Legends Patch {current_cycle}",
        "released": str(current_metadata.get("publishedAt") or patch_events.get("observed_at") or "")[:10],
        "publishedAt": current_metadata.get("publishedAt") or patch_events.get("observed_at") or "",
        "sections": [
            {"id": section, "title": section.replace("_", " ").title(), "changes": changes}
            for section, changes in sorted(groups.items())
        ],
        "summary": _summary(current_events),
    })
    history = [
        _metadata_patch(entry)
        for entry in metadata.get("patches", [])
        if entry.get("version") != current_cycle
    ]
    return {
        "schema_version": 2,
        "patch": current_cycle,
        "source": "CommunityDragon snapshot diffs",
        "sourceKind": "cdragon-structured-diff-v1",
        "status": patch_events.get("status", "unavailable"),
        "sourceUrl": current.get("sourceUrl", ""),
        "scraped_at": patch_events.get("observed_at", ""),
        "patches": [current, *history],
    }


def build_preview_projection(
    archive: dict[str, Any] | None,
    known: dict[str, set[str]],
    entity_records: dict[str, dict[str, dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Expose only active PBE entries, with links restricted to live entities."""
    if not archive:
        return {"schema_version": 1, "branch": "pbe", "lane": "preview", "status": "unavailable", "events": []}
    events = []
    for event in archive.get("events", []):
        if not isinstance(event, dict) or event.get("landed") or event.get("lifecycle") in {"landed", "aged_out"}:
            continue
        if event.get("source_patch_label") != archive.get("source_patch_label"):
            continue
        projection = {field: copy.deepcopy(event[field]) for field in PUBLIC_EVENT_FIELDS if field in event}
        record = (entity_records or {}).get(str(event.get("entity_type") or ""), {}).get(str(event.get("canonical_id") or ""), {})
        is_known, href = _href(event, known, entity_records)
        projection["known"] = is_known
        projection["canonicalId"] = str(event.get("canonical_id") or "")
        projection["id"] = projection["canonicalId"]
        projection["routeIdentifier"] = str(record.get("route_identifier") or "")
        projection["localizedName"] = str(record.get("names", {}).get("en") or event.get("names", {}).get("en") or "")
        projection["iconUrl"] = str(record.get("icon") or "")
        if record.get("slug"):
            projection["slug"] = record["slug"]
        if record.get("icon"):
            projection["icon"] = record["icon"]
        if href:
            projection["href"] = href
        events.append(projection)
    events.sort(key=lambda event: (
        str(event.get("entity_type", "")), str(event.get("slug", "")), tuple(event.get("fields_changed", [])),
    ))
    return {
        "schema_version": 1,
        "branch": "pbe",
        "lane": "preview",
        "status": archive.get("status", "unavailable"),
        "source_patch_label": archive.get("source_patch_label", ""),
        "observed_at": archive.get("observed_at", ""),
        "events": events,
    }
