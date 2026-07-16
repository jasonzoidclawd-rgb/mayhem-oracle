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
_TOKEN_RE = re.compile(r"@[^@]+@|%[A-Za-z][A-Za-z0-9_:.*-]*%|\{\{[^{}]+\}\}")
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
    "affected_entities",
    "change",
)


def _locale_names(names: dict[str, Any]) -> dict[str, str]:
    return {
        "en": str(names.get("en") or ""),
        "zh-tw": str(names.get("zh-TW") or names.get("zh-tw") or names.get("en") or ""),
        "zh-cn": str(names.get("zh-CN") or names.get("zh-cn") or names.get("en") or ""),
        "ja-jp": str(names.get("ja") or names.get("ja-jp") or names.get("en") or ""),
        "ko-kr": str(names.get("ko") or names.get("ko-kr") or names.get("en") or ""),
    }


def _presentation_names(
    event: dict[str, Any],
    record: dict[str, Any],
) -> dict[str, str]:
    """Merge event labels with catalog-localized presentation names.

    CDragon diff events commonly carry only an English label. The bounded
    entity record is the public presentation authority for localized names;
    event labels remain the fallback for source-only entities.
    """
    values: dict[str, Any] = {}
    event_names = event.get("names")
    if isinstance(event_names, dict):
        values.update(event_names)
    record_names = record.get("names")
    if isinstance(record_names, dict):
        values.update(record_names)
    return _locale_names(values)


def _display(value: Any) -> str:
    if isinstance(value, str):
        text = _TOKEN_RE.sub(
            " — ",
            _TAG_RE.sub(
                " ",
                html.unescape(value).replace("<br>", " ").replace("<br/>", " "),
            ),
        )
        return re.sub(r"\s+", " ", text).strip()
    return repr(value)


FIELD_LABELS = {
    "base_stats.health": {"en": "Health", "zh-tw": "生命值", "zh-cn": "生命值", "ja-jp": "体力", "ko-kr": "체력"},
    "base_stats.armor": {"en": "Armor", "zh-tw": "護甲", "zh-cn": "护甲", "ja-jp": "アーマー", "ko-kr": "방어력"},
    "base_stats.magicResistance": {"en": "Magic resist", "zh-tw": "魔法抗性", "zh-cn": "魔法抗性", "ja-jp": "魔法耐性", "ko-kr": "마법 저항력"},
    "cost": {"en": "Cost", "zh-tw": "花費", "zh-cn": "费用", "ja-jp": "コスト", "ko-kr": "비용"},
    "tooltip": {"en": "Description", "zh-tw": "描述", "zh-cn": "描述", "ja-jp": "説明", "ko-kr": "설명"},
}


GENERIC_CHANGE_TEXT = {
    "added": {
        "en": "Added in the CommunityDragon snapshot.",
        "zh-tw": "已在 CommunityDragon 快照中新增。",
        "zh-cn": "已在 CommunityDragon 快照中新增。",
        "ja-jp": "CommunityDragon スナップショットに追加。",
        "ko-kr": "CommunityDragon 스냅샷에 추가되었습니다.",
    },
    "removed": {
        "en": "Removed in the CommunityDragon snapshot.",
        "zh-tw": "已在 CommunityDragon 快照中移除。",
        "zh-cn": "已在 CommunityDragon 快照中移除。",
        "ja-jp": "CommunityDragon スナップショットから削除。",
        "ko-kr": "CommunityDragon 스냅샷에서 제거되었습니다.",
    },
    "changed": {
        "en": "Changed in the CommunityDragon snapshot.",
        "zh-tw": "CommunityDragon 快照已變更。",
        "zh-cn": "CommunityDragon 快照已变更。",
        "ja-jp": "CommunityDragon スナップショットで変更。",
        "ko-kr": "CommunityDragon 스냅샷에서 변경되었습니다.",
    },
}

SEMANTIC_CATEGORY_LABELS = {
    "passive-added": {"en": "Passive added", "zh-tw": "新增被動效果", "zh-cn": "新增被动效果", "ja-jp": "パッシブ追加", "ko-kr": "패시브 추가"},
    "passive-removed": {"en": "Passive removed", "zh-tw": "移除被動效果", "zh-cn": "移除被动效果", "ja-jp": "パッシブ削除", "ko-kr": "패시브 제거"},
    "passive-description-changed": {"en": "Passive changed", "zh-tw": "被動效果變更", "zh-cn": "被动效果变更", "ja-jp": "パッシブ変更", "ko-kr": "패시브 변경"},
}


def _field_label(field: Any, locale: str = "en") -> str:
    key = str(field or "")
    localized = FIELD_LABELS.get(key, {}).get(locale)
    if localized:
        return localized
    # Ability paths are structured source fields, but the UI should receive a
    # human label rather than a raw dotted key.
    parts = [part for part in key.split(".") if part]
    if parts and parts[0] == "abilities" and len(parts) >= 3:
        ability = parts[1]
        metric = {
            "en": {"cooldown": "Cooldown", "cost": "Cost", "cooldown_coefficients": "Cooldown", "cost_coefficients": "Cost", "effect_amounts": "Effect", "range": "Range"},
            "zh-tw": {"cooldown": "冷卻時間", "cost": "消耗", "cooldown_coefficients": "冷卻時間", "cost_coefficients": "消耗", "effect_amounts": "效果", "range": "距離"},
            "zh-cn": {"cooldown": "冷却时间", "cost": "消耗", "cooldown_coefficients": "冷却时间", "cost_coefficients": "消耗", "effect_amounts": "效果", "range": "距离"},
            "ja-jp": {"cooldown": "クールダウン", "cost": "コスト", "cooldown_coefficients": "クールダウン", "cost_coefficients": "コスト", "effect_amounts": "効果", "range": "射程"},
            "ko-kr": {"cooldown": "재사용 대기시간", "cost": "소모", "cooldown_coefficients": "재사용 대기시간", "cost_coefficients": "소모", "effect_amounts": "효과", "range": "사거리"},
        }.get(locale, {}).get(parts[-1])
        return f"{ability} {metric or parts[-1].replace('_', ' ').title()}"
    return (parts[-1] if parts else "Change").replace("_", " ").title()


def _change_texts(event: dict[str, Any]) -> dict[str, str]:
    semantic = event.get("change")
    if isinstance(semantic, dict):
        category = str(semantic.get("category") or "")
        name = str(semantic.get("name") or "").strip()
        description = _display(semantic.get("description"))
        labels = SEMANTIC_CATEGORY_LABELS.get(category)
        if labels:
            return {
                locale: f"{labels[locale]}: {name}. {description}".strip()
                for locale in ("en", "zh-tw", "zh-cn", "ja-jp", "ko-kr")
            }
        return {
            locale: f"Gameplay change: {name}. {description}".strip()
            for locale in ("en", "zh-tw", "zh-cn", "ja-jp", "ko-kr")
        }
    kind = event.get("change_kind")
    if kind in {"added", "removed"}:
        return dict(GENERIC_CHANGE_TEXT[str(kind)])
    fields = event.get("fields_changed", [])
    before = event.get("before", {})
    after = event.get("after", {})
    if not fields:
        return dict(GENERIC_CHANGE_TEXT["changed"])
    return {
        locale: "; ".join(
            f"{_field_label(field, locale)}: {_display(before.get(field))} → {_display(after.get(field))}"
            for field in fields
        )
        for locale in ("en", "zh-tw", "zh-cn", "ja-jp", "ko-kr")
    }


def _kind(event: dict[str, Any]) -> str:
    if event.get("change_kind") in {"added", "removed"}:
        return str(event["change_kind"])
    if event.get("change_kind") == "mechanism":
        return "mechanism"
    return "changed"


def _related_entity(
    related: dict[str, Any],
    known: dict[str, set[str]],
    entity_records: dict[str, dict[str, dict[str, Any]]] | None,
) -> dict[str, Any] | None:
    entity_type = str(related.get("entity_type") or "")
    canonical_id = str(related.get("canonical_id") or "")
    if entity_type not in {"champion", "augment", "item"} or not canonical_id:
        return None
    record = (entity_records or {}).get(entity_type, {}).get(canonical_id, {})
    names = _presentation_names(related, record)
    synthetic = {
        "entity_type": entity_type,
        "canonical_id": canonical_id,
        "slug": str(record.get("slug") or related.get("slug") or ""),
    }
    is_known, href = _href(synthetic, known, entity_records)
    result = {
        "type": entity_type,
        "id": canonical_id,
        "canonicalId": canonical_id,
        "slug": synthetic["slug"],
        "routeIdentifier": str(record.get("route_identifier") or ""),
        "localizedName": names["en"],
        "iconUrl": str(record.get("icon") or ""),
        "name": names["en"],
        "known": is_known,
        "names": {key: value for key, value in names.items() if key != "en" and value},
    }
    if href:
        result["href"] = href
    if record.get("icon"):
        result["icon"] = record["icon"]
    return result


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
    record = (entity_records or {}).get(entity_type, {}).get(canonical_id, {})
    names = _presentation_names(event, record)
    is_known, href = _href(event, known, entity_records)
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
    related = [
        projected
        for item in event.get("affected_entities", [])
        if isinstance(item, dict)
        for projected in [_related_entity(item, known, entity_records)]
        if projected is not None
    ]
    semantic = event.get("change") if isinstance(event.get("change"), dict) else None
    metrics = []
    labels = list(event.get("fields_changed", []))
    if semantic:
        category = str(semantic.get("category") or "gameplay-change")
        metrics = [{
            "label": str(semantic.get("name") or category),
            "before": "",
            "after": _display(semantic.get("description")),
        }]
        labels = [category]
    return {
        "subject": {key: value for key, value in names.items() if value},
        "text": _change_texts(event),
        "kind": _kind(event),
        "detectedAt": event.get("detected_at"),
        "isHotfix": bool(event.get("is_hotfix")),
        "landedFromPbe": bool(event.get("landed_from_pbe")),
        "targets": [target],
        "relatedEntities": related,
        "metrics": metrics or [
            {
                "label": _field_label(field),
                "before": _display(event.get("before", {}).get(field)),
                "after": _display(event.get("after", {}).get(field)),
            }
            for field in event.get("fields_changed", [])
        ],
        "labels": labels,
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
        # Keep the public patch-note last-modified value tied to the Riot
        # metadata fetch, not the CDragon polling time. Structural snapshots
        # can refresh many times without making the prose article newer.
        "scraped_at": metadata.get("scraped_at") or current_metadata.get("publishedAt") or patch_events.get("observed_at", ""),
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
        names = _presentation_names(event, record)
        is_known, href = _href(event, known, entity_records)
        projection["names"] = {
            "en": names["en"],
            "zh-TW": names["zh-tw"],
            "zh-CN": names["zh-cn"],
            "ja": names["ja-jp"],
            "ko": names["ko-kr"],
        }
        projection["known"] = is_known
        projection["canonicalId"] = str(event.get("canonical_id") or "")
        projection["id"] = projection["canonicalId"]
        projection["routeIdentifier"] = str(record.get("route_identifier") or "")
        projection["localizedName"] = names["en"]
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
