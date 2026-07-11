"""Explicit CDragon entity adapters around the shared snapshot primitives."""

from __future__ import annotations

import copy
import re
from typing import Any


class AdapterError(ValueError):
    """CDragon changed shape in a way that cannot be normalized truthfully."""


def _slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def _names(row: dict[str, Any], fallback: str) -> dict[str, str]:
    names = row.get("names")
    if isinstance(names, dict):
        cleaned = {str(key): str(value) for key, value in names.items() if isinstance(value, str) and value}
        if cleaned:
            cleaned.setdefault("en", fallback)
            return cleaned
    return {"en": fallback}


def _sorted(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids: set[str] = set()
    for row in rows:
        if row["id"] in ids:
            raise AdapterError(f"duplicate canonical id: {row['id']}")
        ids.add(row["id"])
    return sorted(rows, key=lambda row: (row["id"], row["slug"]))


def normalize_augment_entities(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adapt the established Mayhem augment extractor without changing its ids."""
    normalized = []
    for row in rows:
        canonical_id = row.get("nameId") or row.get("augmentId")
        name = str(row.get("name") or canonical_id or "")
        slug = str(row.get("slug") or _slug(name))
        if not canonical_id or not name or not slug:
            raise AdapterError("augment missing stable id, name, or slug")
        normalized.append({
            "id": str(canonical_id),
            "slug": slug,
            "names": _names(row, name),
            "fields": {
                "name": name,
                "rarity": row.get("rarity", ""),
                "tooltip": row.get("tooltip", ""),
            },
        })
    return _sorted(normalized)


def _named_array(spell: dict[str, Any], field: str, data_values: list[dict[str, Any]]) -> dict[str, Any] | None:
    value = spell.get(field)
    if value in (None, [], {}):
        return None
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if not isinstance(value, list):
        raise AdapterError(f"unexpected {field} shape")
    named: dict[str, Any] = {}
    if all(isinstance(entry, dict) and entry.get("name") for entry in value):
        for entry in value:
            named[str(entry["name"])] = copy.deepcopy(entry.get("values", entry.get("value")))
        return named
    names = [entry.get("name") for entry in data_values if isinstance(entry, dict) and entry.get("name")]
    if len(names) == len(value) and len(names) == len(data_values):
        return {str(name): copy.deepcopy(item) for name, item in zip(names, value)}
    raise AdapterError(f"unmapped positional {field}; refusing a noisy structural diff")


def _champion_base_stats(detail: dict[str, Any]) -> dict[str, Any]:
    if isinstance(detail.get("baseStats"), dict):
        return copy.deepcopy(detail["baseStats"])
    keys = (
        "health", "healthPerLevel", "mana", "manaPerLevel", "armor", "armorPerLevel",
        "magicResistance", "magicResistancePerLevel", "attackDamage", "attackDamagePerLevel",
        "movespeed", "attackRange",
    )
    return {key: detail[key] for key in keys if key in detail}


def normalize_champion_entities(
    summary_rows: list[dict[str, Any]],
    details_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Normalize CDragon champion summaries and named ability fields.

    Positional effect arrays are accepted only when CDragon supplies a matching
    `mDataValues` name map.  Anything else aborts the acquisition rather than
    publishing a misleading index-based diff.
    """
    normalized = []
    for summary in summary_rows:
        raw_id = summary.get("id")
        if not isinstance(raw_id, (int, str)) or str(raw_id) in {"", "0", "-1"}:
            continue
        canonical_id = str(raw_id)
        detail = details_by_id.get(canonical_id)
        if not isinstance(detail, dict):
            raise AdapterError(f"missing champion detail for canonical id {canonical_id}")
        name = str(detail.get("name") or summary.get("name") or summary.get("alias") or "")
        alias = str(summary.get("alias") or detail.get("alias") or name)
        if not name or not alias:
            raise AdapterError(f"champion {canonical_id} missing name or alias")
        abilities: dict[str, Any] = {}
        for index, spell in enumerate(detail.get("spells", [])[:4]):
            if not isinstance(spell, dict):
                raise AdapterError(f"champion {canonical_id} has malformed spell")
            ability: dict[str, Any] = {}
            for source, destination in (
                ("cost", "cost"),
                ("cooldown", "cooldown"),
                ("range", "range"),
                ("castRange", "range"),
            ):
                if source in spell and destination not in ability:
                    ability[destination] = copy.deepcopy(spell[source])
            data_values = spell.get("mDataValues", spell.get("dataValues", []))
            if not isinstance(data_values, list):
                raise AdapterError(f"champion {canonical_id} has malformed mDataValues")
            effects = _named_array(spell, "effectAmounts", data_values)
            coefficients = _named_array(spell, "coefficients", data_values)
            if effects is not None:
                ability["effect_amounts"] = effects
            if coefficients is not None:
                ability["coefficients"] = coefficients
            if ability:
                abilities["QWER"[index]] = ability
        fields: dict[str, Any] = {"abilities": abilities}
        base_stats = _champion_base_stats(detail)
        if base_stats:
            fields["base_stats"] = base_stats
        normalized.append({
            "id": canonical_id,
            "slug": _slug(alias),
            "names": _names(summary, name),
            "fields": fields,
        })
    return _sorted(normalized)


def normalize_item_entities(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize direct CDragon item fields without prose-derived semantics."""
    normalized = []
    for row in rows:
        raw_id = row.get("id")
        name = str(row.get("name") or "")
        if raw_id is None or not name:
            continue
        fields: dict[str, Any] = {}
        if "priceTotal" in row:
            fields["cost"] = row["priceTotal"]
        elif "cost" in row:
            fields["cost"] = row["cost"]
        for source, destination in (
            ("stats", "stats"),
            ("mythicPassive", "mythic_passive"),
            ("passive", "mythic_passive"),
            ("active", "active_effects"),
            ("activeEffects", "active_effects"),
            ("description", "description"),
            ("categories", "categories"),
        ):
            if source in row and destination not in fields:
                fields[destination] = copy.deepcopy(row[source])
        normalized.append({
            "id": str(raw_id),
            "slug": str(row.get("slug") or _slug(name)),
            "names": _names(row, name),
            "fields": fields,
        })
    return _sorted(normalized)
