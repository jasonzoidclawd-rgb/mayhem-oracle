#!/usr/bin/env python3
"""Build the public-safe, patch-sensitive entity presentation catalog.

The CDragon snapshots are the only source for canonical IDs and structured
values.  Existing catalog rows contribute presentation-only fields such as
localized names, icons, and neutral descriptions.  This module deliberately
does not parse descriptions or tooltips for numbers.
"""

from __future__ import annotations

import copy
import html
import re
from typing import Any


ENTITY_TYPES = ("augment", "champion", "item")
_TAG_RE = re.compile(r"<[^>]+>")
_TOKEN_RE = re.compile(r"@[^@]+@|%[^%]+%")

# The Mayhem-only item catalog is authored separately from the CDragon item
# endpoint and historically lacked IDs.  These IDs are the stable CDragon
# records selected for those seven named catalog rows; the public exporter
# attaches them before resolving EntityRefs.  Keeping the mapping here makes
# the alias decision explicit and deterministic instead of guessing from prose.
MAYHEM_CANONICAL_ITEM_IDS = {
    "atmas-reckoning": "223039",
    "rite-of-ruin": "3430",
    "sword-of-blossoming-dawn": "4011",
    "the-golden-spatula": "4403",
    "stormrazor": "223095",
    "heartsteel": "223084",
    "wooglets-witchcap": "228002",
}

# Forged By The Master is a retained historical catalog row whose old source
# omitted the numeric CDragon ID. The ID is part of the approved regression
# contract and is used only to reconcile that row when CDragon promotes it
# back into the latest snapshot.
CANONICAL_AUGMENT_IDS = {
    "forged-by-the-master": "2127",
}


# The semantic direction is explicit because lower values are beneficial for
# cooldown/cost fields while higher values are beneficial for most combat stats.
STAT_DEFINITIONS: dict[str, dict[str, dict[str, str]]] = {
    "champion": {
        "base_stats.health": {"key": "base_health", "label_key": "stats.baseHealth", "unit": "flat", "direction": "higher"},
        "base_stats.healthPerLevel": {"key": "health_per_level", "label_key": "stats.healthPerLevel", "unit": "flat", "direction": "higher"},
        "base_stats.mana": {"key": "base_mana", "label_key": "stats.baseMana", "unit": "flat", "direction": "higher"},
        "base_stats.manaPerLevel": {"key": "mana_per_level", "label_key": "stats.manaPerLevel", "unit": "flat", "direction": "higher"},
        "base_stats.armor": {"key": "base_armor", "label_key": "stats.baseArmor", "unit": "flat", "direction": "higher"},
        "base_stats.armorPerLevel": {"key": "armor_per_level", "label_key": "stats.armorPerLevel", "unit": "flat", "direction": "higher"},
        "base_stats.magicResistance": {"key": "base_magic_resist", "label_key": "stats.baseMagicResist", "unit": "flat", "direction": "higher"},
        "base_stats.magicResistancePerLevel": {"key": "magic_resist_per_level", "label_key": "stats.magicResistPerLevel", "unit": "flat", "direction": "higher"},
        "base_stats.attackDamage": {"key": "base_attack_damage", "label_key": "stats.baseAttackDamage", "unit": "flat", "direction": "higher"},
        "base_stats.attackDamagePerLevel": {"key": "attack_damage_per_level", "label_key": "stats.attackDamagePerLevel", "unit": "flat", "direction": "higher"},
        "base_stats.attackSpeed": {"key": "base_attack_speed", "label_key": "stats.baseAttackSpeed", "unit": "multiplier", "direction": "higher"},
        "base_stats.attackSpeedPerLevel": {"key": "attack_speed_per_level", "label_key": "stats.attackSpeedPerLevel", "unit": "percent", "direction": "higher"},
        "base_stats.attackRange": {"key": "attack_range", "label_key": "stats.attackRange", "unit": "flat", "direction": "higher"},
        "base_stats.moveSpeed": {"key": "move_speed", "label_key": "stats.moveSpeed", "unit": "flat", "direction": "higher"},
        "base_stats.healthRegen": {"key": "health_regen", "label_key": "stats.healthRegen", "unit": "per5", "direction": "higher"},
        "base_stats.healthRegenPerLevel": {"key": "health_regen_per_level", "label_key": "stats.healthRegenPerLevel", "unit": "per5", "direction": "higher"},
    },
    "item": {
        "cost": {"key": "cost", "label_key": "stats.cost", "unit": "gold", "direction": "lower"},
        "stats.attackDamage": {"key": "attack_damage", "label_key": "stats.attackDamage", "unit": "flat", "direction": "higher"},
        "stats.abilityPower": {"key": "ability_power", "label_key": "stats.abilityPower", "unit": "flat", "direction": "higher"},
        "stats.health": {"key": "health", "label_key": "stats.health", "unit": "flat", "direction": "higher"},
        "stats.armor": {"key": "armor", "label_key": "stats.armor", "unit": "flat", "direction": "higher"},
        "stats.magicResist": {"key": "magic_resist", "label_key": "stats.magicResist", "unit": "flat", "direction": "higher"},
        "stats.attackSpeed": {"key": "attack_speed", "label_key": "stats.attackSpeed", "unit": "percent", "direction": "higher"},
        "stats.abilityHaste": {"key": "ability_haste", "label_key": "stats.abilityHaste", "unit": "flat", "direction": "higher"},
        "stats.movementSpeed": {"key": "movement_speed", "label_key": "stats.movementSpeed", "unit": "flat", "direction": "higher"},
        "stats.criticalStrikeChance": {"key": "critical_strike_chance", "label_key": "stats.criticalStrikeChance", "unit": "percent", "direction": "higher"},
        "stats.lifeSteal": {"key": "life_steal", "label_key": "stats.lifeSteal", "unit": "percent", "direction": "higher"},
    },
    "augment": {
        "rarity": {"key": "rarity", "label_key": "stats.rarity", "unit": "label", "direction": "unknown"},
    },
}


def _stable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _stable(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_stable(entry) for entry in value]
    return copy.deepcopy(value)


def _catalog_id(entity_type: str, row: dict[str, Any]) -> str | None:
    value = row.get("canonical_id") or row.get("canonicalId")
    if value is None and entity_type == "augment":
        value = row.get("augmentId")
        if value is None:
            value = CANONICAL_AUGMENT_IDS.get(str(row.get("slug") or "").strip())
    if value is None and entity_type == "item":
        value = row.get("id")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _catalog_indexes(entity_type: str, rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_slug: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        canonical_id = _catalog_id(entity_type, row)
        slug = str(row.get("slug") or "").strip()
        if canonical_id:
            if canonical_id in by_id and by_id[canonical_id] is not row:
                existing = by_id[canonical_id]
                # Prefer an explicit Mayhem/catalog slug over the older
                # generated row that carries only an ID.  If both rows have
                # competing slugs, remove the ID and fail closed.
                if not existing.get("slug") and slug:
                    # Preserve localized presentation fields from the older
                    # generated row while letting the explicit row provide
                    # the canonical route and mode-specific metadata.
                    by_id[canonical_id] = {**existing, **row}
                elif existing.get("slug") and not slug:
                    pass
                else:
                    by_id.pop(canonical_id, None)
            elif canonical_id not in by_id:
                by_id[canonical_id] = row
        if slug:
            if slug in by_slug and by_slug[slug] is not row:
                # A duplicate slug is not safe to resolve by presentation name.
                raise ValueError(f"duplicate catalog slug: {entity_type}:{slug}")
            by_slug[slug] = row
    return by_id, by_slug


def _names(snapshot_row: dict[str, Any], catalog_row: dict[str, Any] | None) -> dict[str, str]:
    values: dict[str, str] = {}
    for source in (snapshot_row.get("names"), (catalog_row or {}).get("names")):
        if isinstance(source, dict):
            for key, value in source.items():
                if isinstance(value, str) and value.strip():
                    values[str(key)] = value.strip()
    if catalog_row:
        for key, value in catalog_row.items():
            if key.startswith("name_") and isinstance(value, str) and value.strip():
                values[key.removeprefix("name_").replace("_", "-")] = value.strip()
    fallback = str((catalog_row or {}).get("name") or values.get("en") or snapshot_row.get("slug") or "").strip()
    if fallback:
        values.setdefault("en", fallback)
    return {key: values[key] for key in sorted(values)}


def _direction(before: Any, after: Any, semantic: str) -> str:
    if semantic == "unknown" or not isinstance(before, (int, float)) or not isinstance(after, (int, float)):
        return "changed"
    if after == before:
        return "changed"
    delta = after - before
    if semantic == "lower":
        delta = -delta
    return "buff" if delta > 0 else "nerf"


def _neutral_description(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = _TOKEN_RE.sub(" ", _TAG_RE.sub(" ", html.unescape(value)))
    return re.sub(r"\s+", " ", text).strip()


def _stat_definition(entity_type: str, field: str) -> dict[str, str] | None:
    definition = STAT_DEFINITIONS.get(entity_type, {}).get(field)
    if definition:
        return definition
    if entity_type == "champion":
        parts = field.split(".")
        if len(parts) >= 3 and parts[0] == "abilities" and parts[1] in {"Q", "W", "E", "R"}:
            ability = parts[1]
            metric = parts[2]
            ability_meta = {
                "cost_coefficients": ("ability_cost", "stats.abilityCost", "flat", "lower"),
                "cooldown_coefficients": ("ability_cooldown", "stats.abilityCooldown", "seconds", "lower"),
                "range": ("ability_range", "stats.abilityRange", "units", "higher"),
                "effect_amounts": ("ability_effect", "stats.abilityEffect", "flat", "unknown"),
                "coefficients": ("ability_coefficient", "stats.abilityCoefficient", "multiplier", "unknown"),
            }.get(metric)
            # CDragon's cost/cooldown display strings contain unresolved
            # template tokens; only the numeric coefficient/effect fields are
            # safe balancing values for this presentation layer.
            if ability_meta:
                key, label_key, unit, direction = ability_meta
                context = f"{ability}"
                if len(parts) > 3:
                    context = f"{ability} · {'.'.join(parts[3:])}"
                return {
                    "key": f"{key}_{ability}_{'.'.join(parts[3:])}" if len(parts) > 3 else f"{key}_{ability}",
                    "label_key": label_key,
                    "unit": unit,
                    "direction": direction,
                    "context": context,
                    "numeric": "true",
                }
    # Item stat keys from source adapters are normalized as stats.<key>. Do not
    # guess semantics for unknown keys; the caller will omit them.
    return None


def _numeric_value(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, list):
        return bool(value) and all(_numeric_value(entry) for entry in value)
    if isinstance(value, dict):
        return bool(value) and all(_numeric_value(entry) for entry in value.values())
    return False


def _all_zero(value: Any) -> bool:
    if isinstance(value, (int, float)):
        return value == 0
    if isinstance(value, list):
        return bool(value) and all(_all_zero(entry) for entry in value)
    if isinstance(value, dict):
        return bool(value) and all(_all_zero(entry) for entry in value.values())
    return False


def _current_stats(entity_type: str, fields: dict[str, Any], source_version: str, patch: str, lane: str) -> list[dict[str, Any]]:
    flattened: dict[str, Any] = {}

    def flatten(value: Any, prefix: str = "") -> None:
        if isinstance(value, dict):
            for key in sorted(value):
                flatten(value[key], f"{prefix}.{key}" if prefix else str(key))
        elif prefix:
            flattened[prefix] = value

    flatten(fields)
    stats: list[dict[str, Any]] = []
    for path, value in flattened.items():
        definition = _stat_definition(entity_type, path)
        if not definition:
            continue
        if definition.get("numeric") == "true":
            if not _numeric_value(value) or _all_zero(value):
                continue
        elif not isinstance(value, (int, float, str)):
            continue
        stat = {
            "key": definition["key"],
            "label_key": definition["label_key"],
            "value": value,
            "unit": definition["unit"],
            "source_path": f"fields.{path}",
            "source_version": source_version,
            "patch": patch,
            "lane": lane,
        }
        if definition.get("context"):
            stat["context"] = definition["context"]
        stats.append(stat)
    return sorted(stats, key=lambda stat: (stat["key"], stat["source_path"]))


def _change_stats(entity_type: str, event: dict[str, Any]) -> list[dict[str, Any]]:
    before = event.get("before") if isinstance(event.get("before"), dict) else {}
    after = event.get("after") if isinstance(event.get("after"), dict) else {}
    comparison = event.get("comparison") if isinstance(event.get("comparison"), dict) else {}
    source_version = str(comparison.get("target_version") or event.get("source_version") or "")
    patch = str(event.get("source_patch_label") or "")
    lane = str(event.get("lane") or ("preview" if event.get("branch") == "pbe" else "live"))
    changes: list[dict[str, Any]] = []
    for field in event.get("fields_changed", []):
        definition = _stat_definition(entity_type, str(field))
        if not definition:
            continue
        old = before.get(field)
        new = after.get(field)
        if definition.get("numeric") == "true" and (not _numeric_value(old) or not _numeric_value(new)):
            continue
        if not isinstance(old, (int, float, str, list, dict)) or not isinstance(new, (int, float, str, list, dict)):
            continue
        change = {
            "key": definition["key"],
            "label_key": definition["label_key"],
            "before": old,
            "after": new,
            "unit": definition["unit"],
            "source_path": f"fields.{field}",
            "source_version": source_version,
            "patch": patch,
            "lane": lane,
            "lifecycle": "landed" if event.get("landed_from_pbe") or event.get("landed") else ("preview" if lane == "preview" else "live"),
            "is_hotfix": bool(event.get("is_hotfix")),
            "direction": _direction(old, new, definition["direction"]),
        }
        if definition.get("context"):
            change["context"] = definition["context"]
        changes.append(change)
    return changes


def _event_matches(record: dict[str, Any], event: dict[str, Any]) -> bool:
    return (
        record.get("type") == event.get("entity_type")
        and record.get("canonical_id") == str(event.get("canonical_id") or "")
    )


def _field_value(fields: dict[str, Any], path: str) -> Any:
    value: Any = fields
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _preview_target_matches_snapshot(event: dict[str, Any], snapshot_row: dict[str, Any]) -> bool:
    """Reject a stale/no-op preview event whose normalized target is live."""

    changed = event.get("fields_changed")
    after = event.get("after")
    fields = snapshot_row.get("fields")
    if not isinstance(changed, list) or not changed or not isinstance(after, dict) or not isinstance(fields, dict):
        return False
    return all(
        _field_value(fields, str(field)) == after.get(str(field))
        for field in changed
    )


def _record(
    entity_type: str,
    snapshot_row: dict[str, Any],
    catalog_row: dict[str, Any] | None,
    snapshot: dict[str, Any],
    live_events: list[dict[str, Any]],
    pbe_events: list[dict[str, Any]],
    present_in_snapshot: bool = True,
    route_catalog_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    canonical_id = str(snapshot_row["id"])
    # A same-slug CDragon variant may borrow safe display metadata (names,
    # icon, neutral description) from the catalog, but it must never inherit
    # route ownership. Route ownership is selected by exact canonical ID;
    # `catalog_row` may still be a slug-only presentation match.
    display_catalog_row = catalog_row or {}
    route_catalog_row = route_catalog_row if route_catalog_row is not None else display_catalog_row
    flags = route_catalog_row.get("flags") if isinstance(route_catalog_row.get("flags"), dict) else {}
    lifecycle = "active" if present_in_snapshot else str(flags.get("lifecycle") or "unknown")
    if entity_type == "item":
        # Regular item pages accept numeric IDs. Mayhem-exclusive rows carry
        # an explicit route identifier from the exporter because their static
        # pages accept the curated slug instead.
        route_identifier = str(
            route_catalog_row.get("_route_identifier")
            or (route_catalog_row.get("id") if route_catalog_row.get("id") is not None else "")
        ).strip()
    else:
        # Champion and augment routes are generated from the public catalog;
        # a CDragon-only row (for example Locke) intentionally remains
        # unlinked until that catalog generates a real page.
        route_identifier = str(route_catalog_row.get("slug") or "").strip()
    known = bool(route_identifier and route_catalog_row)
    record = {
        "type": entity_type,
        "canonical_id": canonical_id,
        # Catalog slugs are the public canonical route.  CDragon slugs are
        # still useful for matching additions, but must not silently replace a
        # stable localized detail URL (for example ADAPt → /augments/adapt).
        "slug": str(display_catalog_row.get("slug") or snapshot_row.get("slug") or ""),
        "route_identifier": route_identifier,
        "known": known,
        "names": _names(snapshot_row, display_catalog_row),
        "icon": str(display_catalog_row.get("icon") or ""),
        "description": _neutral_description(display_catalog_row.get("wikiDescription") or display_catalog_row.get("description") or ""),
        "lifecycle": {
            "state": lifecycle,
            "patch": str(flags.get("lifecycle_patch") or ""),
        },
        "stats": _current_stats(
            entity_type,
            snapshot_row.get("fields") if isinstance(snapshot_row.get("fields"), dict) else {},
            str(snapshot.get("source_version") or ""),
            str(snapshot.get("source_patch_label") or ""),
            str(snapshot.get("lane") or ""),
        ),
        "patch_changes": [],
    }
    changes = [
        event for event in [*live_events, *pbe_events]
        if _event_matches(record, event)
        # A currently-present normalized entity is authoritative over a stale
        # legacy removal tombstone. The tombstone must not reappear as a
        # current-cycle stat change or removal card.
        and not (present_in_snapshot and event.get("change_kind") == "removed")
        and not (
            event.get("lane") == "preview"
            and event.get("lifecycle") != "landed"
            and event.get("landed") is not True
            and _preview_target_matches_snapshot(event, snapshot_row)
        )
    ]
    deduped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for event in changes:
        for change in _change_stats(entity_type, event):
            key = (change["key"], change["patch"], change["lane"], repr(change["before"]), repr(change["after"]))
            deduped[key] = change
    record["patch_changes"] = sorted(
        deduped.values(),
        key=lambda change: (str(change.get("patch", "")), str(change.get("lane", "")), str(change.get("key", "")), repr(change.get("after"))),
    )
    return record


def build_entity_presentation(
    *,
    snapshots: dict[str, dict[str, Any]],
    catalogs: dict[str, dict[str, Any]],
    patch_events: dict[str, Any] | None = None,
    pbe_archive: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a deterministic current-cycle public entity presentation file."""
    patch_events = patch_events or {}
    pbe_archive = pbe_archive or {}
    live_events = [event for event in patch_events.get("events", []) if isinstance(event, dict)]
    current_cycle = str(patch_events.get("current_open_cycle") or "")
    if current_cycle:
        live_events = [event for event in live_events if event.get("source_patch_label") == current_cycle]
    pbe_cycle = str(pbe_archive.get("source_patch_label") or "")
    pbe_events = [event for event in pbe_archive.get("events", []) if isinstance(event, dict)]
    if pbe_cycle:
        pbe_events = [event for event in pbe_events if event.get("source_patch_label") == pbe_cycle]
    pbe_events = [event for event in pbe_events if event.get("lifecycle") not in {"aged_out"}]

    rows: list[dict[str, Any]] = []
    for entity_type in ENTITY_TYPES:
        snapshot = snapshots.get(entity_type) or {}
        snapshot_rows = [row for row in snapshot.get("entities", []) if isinstance(row, dict) and row.get("id")]
        by_id, by_slug = _catalog_indexes(entity_type, catalogs.get(entity_type, {}).get("rows", []))
        seen: set[str] = set()
        for snapshot_row in snapshot_rows:
            canonical_id = str(snapshot_row["id"])
            route_catalog_row = by_id.get(canonical_id)
            slug_catalog_row = by_slug.get(str(snapshot_row.get("slug") or ""))
            # The champion roster's public route source is slug-keyed and does
            # not publish the CDragon numeric ID. Slug matching is therefore
            # the authoritative route join for champions only. Items and
            # augments must have an exact canonical-ID catalog row.
            if route_catalog_row is None and entity_type == "champion":
                route_catalog_row = slug_catalog_row
            display_catalog_row = route_catalog_row or slug_catalog_row
            rows.append(_record(
                entity_type,
                snapshot_row,
                display_catalog_row,
                snapshot,
                live_events,
                pbe_events,
                # An empty route row is intentional for a CDragon-only
                # variant that only matched the catalog by slug.
                route_catalog_row=route_catalog_row or {},
            ))
            seen.add(canonical_id)
        # Retain removed historical entities when their catalog has a stable ID.
        for canonical_id, catalog_row in by_id.items():
            if canonical_id in seen or not isinstance(catalog_row, dict):
                continue
            flags = catalog_row.get("flags") if isinstance(catalog_row.get("flags"), dict) else {}
            if flags.get("lifecycle") != "removed":
                continue
            historical_snapshot = {
                "id": canonical_id,
                "slug": catalog_row.get("slug", ""),
                "names": catalog_row.get("names", {}),
                "fields": {},
            }
            rows.append(_record(
                entity_type,
                historical_snapshot,
                catalog_row,
                snapshot,
                live_events,
                pbe_events,
                present_in_snapshot=False,
            ))

    rows.sort(key=lambda row: (row["type"], row["canonical_id"], row["slug"]))
    observed = sorted(
        str(value.get("observed_at"))
        for value in [*snapshots.values(), patch_events, pbe_archive]
        if isinstance(value, dict) and value.get("observed_at")
    )
    return {
        "schema_version": 1,
        "source": "CommunityDragon normalized entity snapshots",
        "status": patch_events.get("status", "unavailable"),
        "patch": current_cycle,
        "pbe_patch": pbe_cycle,
        "observed_at": observed[-1] if observed else "",
        "entities": rows,
    }
