"""Normalize gameplay-bearing entity fields before comparing snapshots.

CommunityDragon exposes some mechanics as structured values and others as
lightly marked-up descriptions.  This module keeps those representations in a
single comparison surface so formatting, ordering, and source metadata cannot
turn into gameplay events.
"""

from __future__ import annotations

import copy
import html
import json
import re
from typing import Any


_TAG_RE = re.compile(r"<[^>]+>")
_SEMANTIC_BLOCK_RE = re.compile(
    r"<(passive|active|mechanic|effect)>(.*?)</\1>",
    re.IGNORECASE | re.DOTALL,
)
_LOCALE_KEYS = frozenset({
    "en", "en-us", "en_us", "zh", "zh-tw", "zh_tw", "zh-cn", "zh_cn",
    "ja", "ja-jp", "ja_jp", "ko", "ko-kr", "ko_kr", "fr-fr", "de-de",
    "es-es", "es-mx", "it-it", "pt-br", "ru-ru", "pl-pl", "tr-tr",
    "cs-cz", "hu-hu", "ro-ro", "ar-ae", "th-th", "vi-vn", "id-id",
})
_IGNORED_KEYS = frozenset({
    "timestamp",
    "source_timestamp",
    "observed_at",
    "updated_at",
    "localized",
    "localizations",
    "names",
})
_SEMANTIC_ROOTS = {
    "passives": "passive",
    "passive": "passive",
    "actives": "active",
    "active": "active",
    "active_effects": "active",
    "mechanics": "mechanic",
    "mechanic": "mechanic",
    "effects": "structured-effect",
    "structured_effects": "structured-effect",
    "quest_rewards": "quest-reward-transformation",
    "quest_reward": "quest-reward-transformation",
    "transformations": "quest-reward-transformation",
    "linked_entities": "canonical-linked-entity",
}


def clean_text(value: Any) -> str:
    """Return stable display text with markup and whitespace normalized."""
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = _TAG_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _entry(name: Any, description: Any = "", value: Any = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": clean_text(name),
        "description": clean_text(description),
    }
    if value is not None:
        result["value"] = _stable_semantic(value)
    return result


def _stable_semantic(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _stable_semantic(value[key])
            for key in sorted(value)
            if str(key) not in _IGNORED_KEYS and str(key).lower() not in _LOCALE_KEYS
        }
    if isinstance(value, list):
        return [_stable_semantic(entry) for entry in value]
    if isinstance(value, str):
        return clean_text(value)
    return copy.deepcopy(value)


def _entries_for_value(value: Any) -> list[dict[str, Any]]:
    if value in (None, False, "", [], {}):
        return []
    if isinstance(value, dict):
        if any(key in value for key in ("name", "id", "key", "description", "text", "value")):
            values = [value]
        else:
            values = [{"name": key, "value": item} for key, item in value.items()]
    elif isinstance(value, list):
        values = value
    else:
        values = [{"name": "", "value": value}]

    entries: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, dict):
            name = item.get("name") or item.get("id") or item.get("key") or ""
            description = item.get("description") or item.get("text") or ""
            payload = {
                key: item[key]
                for key in sorted(item)
                if key not in {"name", "id", "key", "description", "text"}
            }
            entries.append(_entry(name, description, payload or None))
        else:
            entries.append(_entry("", "", item))
    return sorted(entries, key=lambda item: (item["name"], json.dumps(item, ensure_ascii=False, sort_keys=True)))


def _description_entries(description: Any) -> dict[str, list[dict[str, Any]]]:
    if not isinstance(description, str):
        return {}
    matches = list(_SEMANTIC_BLOCK_RE.finditer(description))
    if not matches:
        return {}
    result: dict[str, list[dict[str, Any]]] = {}
    for index, match in enumerate(matches):
        category = match.group(1).lower()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(description)
        detail = clean_text(description[match.end():end])
        result.setdefault(f"{category}s", []).append(_entry(match.group(2), detail))
    return result


def gameplay_semantics(fields: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Extract canonical, order-independent gameplay collections."""
    result: dict[str, list[dict[str, Any]]] = {}
    explicit = fields.get("semantic") if isinstance(fields.get("semantic"), dict) else {}
    sources = {**fields, **explicit}
    for root, category in _SEMANTIC_ROOTS.items():
        if root not in sources:
            continue
        entries = _entries_for_value(sources[root])
        if entries:
            result[root] = entries
    for root, entries in _description_entries(fields.get("description")).items():
        if root not in result:
            result[root] = entries
    return result


def normalized_generic_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Return non-gameplay fields with formatting-only churn removed."""
    semantics = gameplay_semantics(fields)
    excluded = set(_SEMANTIC_ROOTS) | {"semantic"}
    if semantics:
        excluded.add("description")

    def normalize(value: Any, key: str = "") -> Any:
        if isinstance(value, dict):
            return {
                str(child_key): normalize(child_value, str(child_key))
                for child_key, child_value in sorted(value.items())
                if str(child_key) not in _IGNORED_KEYS
                and str(child_key).lower() not in _LOCALE_KEYS
            }
        if isinstance(value, list):
            normalized = [normalize(item, key) for item in value]
            if key in {"categories", "tags", "labels", "keywords"}:
                return sorted(normalized, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
            return normalized
        if isinstance(value, str):
            return clean_text(value) if key in {"description", "tooltip", "name"} else value
        return copy.deepcopy(value)

    return {
        str(key): normalize(value, str(key))
        for key, value in sorted(fields.items())
        if str(key) not in excluded and str(key) not in _IGNORED_KEYS
    }


def semantic_changes(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """Return gameplay additions, removals, and changes in stable order."""
    old = gameplay_semantics(before)
    new = gameplay_semantics(after)
    changes: list[dict[str, Any]] = []
    for root in sorted(set(old) | set(new)):
        category = _SEMANTIC_ROOTS.get(root, root.rstrip("s"))
        old_by_key = {
            (entry.get("name") or json.dumps(entry, ensure_ascii=False, sort_keys=True)): entry
            for entry in old.get(root, [])
        }
        new_by_key = {
            (entry.get("name") or json.dumps(entry, ensure_ascii=False, sort_keys=True)): entry
            for entry in new.get(root, [])
        }
        for key in sorted(new_by_key.keys() - old_by_key.keys()):
            entry = new_by_key[key]
            changes.append({
                "category": f"{category}-added",
                "name": entry.get("name", ""),
                "description": entry.get("description", ""),
                "before": {},
                "after": copy.deepcopy(entry),
                "field": f"semantic.{root}.{key}",
            })
        for key in sorted(old_by_key.keys() - new_by_key.keys()):
            entry = old_by_key[key]
            changes.append({
                "category": f"{category}-removed",
                "name": entry.get("name", ""),
                "description": entry.get("description", ""),
                "before": copy.deepcopy(entry),
                "after": {},
                "field": f"semantic.{root}.{key}",
            })
        for key in sorted(old_by_key.keys() & new_by_key.keys()):
            old_entry = old_by_key[key]
            new_entry = new_by_key[key]
            if old_entry == new_entry:
                continue
            if old_entry.get("description") != new_entry.get("description"):
                change_category = f"{category}-description-changed"
            else:
                change_category = f"{category}-changed"
            changes.append({
                "category": change_category,
                "name": new_entry.get("name") or old_entry.get("name", ""),
                "description": new_entry.get("description") or old_entry.get("description", ""),
                "before": copy.deepcopy(old_entry),
                "after": copy.deepcopy(new_entry),
                "field": f"semantic.{root}.{key}",
            })
    return sorted(changes, key=lambda item: (item["category"], item["name"], item["field"]))
