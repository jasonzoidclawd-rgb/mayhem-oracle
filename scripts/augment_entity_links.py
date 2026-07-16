"""Load source-owned canonical augment-to-entity relationships."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from data_paths import INTERNAL_DATA_DIR


class AugmentEntityLinkError(ValueError):
    """A canonical cross-entity relationship is malformed or ambiguous."""


def load_augment_entity_links(path: Path | None = None) -> list[dict[str, Any]]:
    source = path or (INTERNAL_DATA_DIR / "augment-entity-links.json")
    if not source.exists():
        return []
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AugmentEntityLinkError(f"malformed augment relationship file: {source}") from exc
    relationships = payload.get("relationships") if isinstance(payload, dict) else None
    if not isinstance(relationships, list):
        raise AugmentEntityLinkError("augment relationship file has no relationships list")
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for relationship in relationships:
        if not isinstance(relationship, dict):
            raise AugmentEntityLinkError("augment relationship must be an object")
        augment_id = str(relationship.get("augment_id") or "").strip()
        item_id = str(relationship.get("item_id") or "").strip()
        kind = str(relationship.get("kind") or "").strip()
        provenance = str(relationship.get("provenance") or "").strip()
        if not augment_id or not item_id or not kind or not provenance:
            raise AugmentEntityLinkError("augment relationship requires IDs, kind, and provenance")
        key = (augment_id, item_id)
        if key in seen:
            raise AugmentEntityLinkError(f"duplicate augment relationship: {augment_id}->{item_id}")
        seen.add(key)
        result.append({
            "augment_id": augment_id,
            "item_id": item_id,
            "kind": kind,
            "provenance": provenance,
        })
    return sorted(result, key=lambda row: (row["augment_id"], row["item_id"], row["kind"]))
