#!/usr/bin/env python3
"""Resolve Mayhem augment source names to CDragon augmentNameId keys."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

from data_paths import INTERNAL_DATA_DIR


CDRAGON_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"
INTERNAL_AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"
ALIAS_PATH = INTERNAL_DATA_DIR / "augment-identity-aliases.json"
MAPPING_PATH = INTERNAL_DATA_DIR / "augment-identity-map.json"
UNMATCHED_PATH = INTERNAL_DATA_DIR / "augment-identity-unmatched-report.json"
CONTRADICTIONS_PATH = INTERNAL_DATA_DIR / "augment-identity-contradictions-report.json"

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_QUEST_PREFIX = re.compile(r"^\s*quest\s*:\s*", re.IGNORECASE)
_SOURCE_NAMES = ("internal_augments", "wiki", "arammayhem_win_rate")
_PRIMARY_SOURCES = ("internal_augments", "wiki")


def normalize_identity_key(value) -> str:
    """Normalize a source display name or slug for identity matching."""
    if value is None:
        return ""
    text = _QUEST_PREFIX.sub("", str(value).strip().lower())
    return _NON_ALNUM.sub("", text)


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _cdragon_id(augment: dict) -> str:
    cdragon = augment.get("cdragon") if isinstance(augment.get("cdragon"), dict) else {}
    return (
        augment.get("augmentId")
        or augment.get("augmentNameId")
        or augment.get("nameId")
        or cdragon.get("augmentNameId")
        or ""
    )


def _cdragon_payload(augment: dict) -> dict:
    return {
        "augmentNameId": _cdragon_id(augment),
        "name": augment.get("name", ""),
        "slug": augment.get("slug", ""),
        "rarity": augment.get("rarity", ""),
    }


def _cdragon_variants(augment: dict) -> list[str]:
    name_id = _cdragon_id(augment)
    cdragon = augment.get("cdragon") if isinstance(augment.get("cdragon"), dict) else {}
    variants = [
        name_id,
        name_id.removeprefix("ARAM_"),
        cdragon.get("augmentNameId", ""),
        cdragon.get("augmentNameId", "").removeprefix("ARAM_"),
        augment.get("name", ""),
        augment.get("slug", ""),
    ]
    names = augment.get("names")
    if isinstance(names, dict):
        variants.extend(value for value in names.values() if isinstance(value, str))
    seen: set[str] = set()
    out: list[str] = []
    for value in variants:
        token = normalize_identity_key(value)
        if token and token not in seen:
            seen.add(token)
            out.append(value)
    return out


def _build_cdragon_index(cdragon_augments: list[dict]) -> tuple[dict, dict]:
    by_id: dict[str, dict] = {}
    index: dict[str, set[str]] = defaultdict(set)
    for augment in cdragon_augments:
        augment_id = _cdragon_id(augment)
        if not augment_id:
            continue
        by_id[augment_id] = augment
        for value in _cdragon_variants(augment):
            token = normalize_identity_key(value)
            if token:
                index[token].add(augment_id)
    return by_id, index


def _alias_entries(alias_table: dict, cdragon_ids: set[str]) -> list[dict]:
    entries = alias_table.get("aliases", []) if isinstance(alias_table, dict) else []
    normalized: list[dict] = []
    for entry in entries:
        augment_id = entry.get("augmentNameId") or entry.get("nameId")
        if augment_id not in cdragon_ids:
            raise ValueError(f"Alias target is not in CDragon snapshot: {augment_id}")
        aliases = entry.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [aliases]
        tokens = sorted({normalize_identity_key(alias) for alias in aliases if normalize_identity_key(alias)})
        if not tokens:
            raise ValueError(f"Alias entry for {augment_id} has no usable aliases")
        applies_to = entry.get("applies_to") or ["all"]
        normalized.append({
            "augmentNameId": augment_id,
            "aliases": aliases,
            "tokens": tokens,
            "applies_to": applies_to,
            "reason": entry.get("reason", ""),
            "review_note": entry.get("review_note", ""),
        })
    return normalized


def _alias_index(entries: list[dict]) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        for token in entry["tokens"]:
            index[token].append(entry)
    return index


def _applies_to_source(entry: dict, source: str) -> bool:
    applies_to = entry.get("applies_to", [])
    return "all" in applies_to or source in applies_to


def _source_tokens(record: dict, include_slug: bool) -> list[dict]:
    fields = ["name"]
    if include_slug:
        fields.append("slug")
    out: list[dict] = []
    seen: set[str] = set()
    for field in fields:
        value = record.get(field)
        token = normalize_identity_key(value)
        if token and token not in seen:
            seen.add(token)
            out.append({"field": field, "value": value, "token": token})
    return out


def _resolve_record(
    record: dict,
    source: str,
    cdragon_index: dict[str, set[str]],
    alias_by_token: dict[str, list[dict]],
    include_slug: bool,
) -> dict:
    tokens = _source_tokens(record, include_slug)
    direct: dict[str, str] = {}
    for token in tokens:
        for augment_id in cdragon_index.get(token["token"], set()):
            direct[augment_id] = token["token"]

    if len(direct) == 1:
        augment_id, token = next(iter(direct.items()))
        return {"status": "matched", "augmentId": augment_id, "method": "normalized", "token": token}
    if len(direct) > 1:
        return {
            "status": "ambiguous",
            "candidateAugmentIds": sorted(direct),
            "tokens": tokens,
        }

    alias_hits: dict[str, dict] = {}
    for token in tokens:
        for entry in alias_by_token.get(token["token"], []):
            if _applies_to_source(entry, source):
                alias_hits[entry["augmentNameId"]] = {"entry": entry, "token": token["token"]}

    if len(alias_hits) == 1:
        augment_id, hit = next(iter(alias_hits.items()))
        return {
            "status": "matched",
            "augmentId": augment_id,
            "method": "alias",
            "token": hit["token"],
            "alias": hit["entry"],
        }
    if len(alias_hits) > 1:
        return {
            "status": "ambiguous_alias",
            "candidateAugmentIds": sorted(alias_hits),
            "tokens": tokens,
        }
    return {"status": "unmatched", "tokens": tokens}


def _internal_records(internal_catalog: dict) -> list[dict]:
    records: list[dict] = []
    for augment in internal_catalog.get("augments", []):
        flags = augment.get("flags") if isinstance(augment.get("flags"), dict) else {}
        records.append({
            "source": "internal_augments",
            "sourceKey": augment.get("slug") or augment.get("name"),
            "slug": augment.get("slug", ""),
            "name": augment.get("name", ""),
            "rarity": augment.get("rarity", ""),
            "lifecycle": flags.get("lifecycle", ""),
            "hasWikiDescription": bool(augment.get("wikiDescription")),
        })
    return records


def _wiki_records_from_internal(internal_catalog: dict) -> list[dict]:
    records: list[dict] = []
    for augment in internal_catalog.get("augments", []):
        if not augment.get("wikiDescription"):
            continue
        records.append({
            "source": "wiki",
            "sourceKey": augment.get("name") or augment.get("slug"),
            "name": augment.get("name", ""),
            "hasWikiDescription": True,
        })
    return records


def _arammayhem_records_from_internal(internal_catalog: dict) -> list[dict]:
    records: list[dict] = []
    for augment in internal_catalog.get("augments", []):
        win_rate = augment.get("win_rate")
        if not isinstance(win_rate, (int, float)):
            continue
        records.append({
            "source": "arammayhem_win_rate",
            "sourceKey": augment.get("slug") or augment.get("name"),
            "slug": augment.get("slug", ""),
            "name": augment.get("name", ""),
            "win_rate": win_rate,
        })
    return records


def _source_payload(record: dict, resolution: dict) -> dict:
    payload = {
        "sourceKey": record.get("sourceKey", ""),
        "name": record.get("name", ""),
        "match": {
            "method": resolution.get("method"),
            "token": resolution.get("token"),
        },
    }
    for field in ("slug", "rarity", "lifecycle", "win_rate", "hasWikiDescription"):
        if field in record:
            payload[field] = record[field]
    if resolution.get("method") == "alias":
        alias = resolution["alias"]
        payload["match"]["alias"] = {
            "aliases": alias.get("aliases", []),
            "reason": alias.get("reason", ""),
        }
    return payload


def _unmatched_payload(record: dict, resolution: dict) -> dict:
    payload = {
        "sourceKey": record.get("sourceKey", ""),
        "name": record.get("name", ""),
        "status": resolution.get("status"),
        "tokens": resolution.get("tokens", []),
    }
    for field in ("slug", "rarity", "lifecycle", "win_rate", "hasWikiDescription"):
        if field in record:
            payload[field] = record[field]
    if "candidateAugmentIds" in resolution:
        payload["candidateAugmentIds"] = resolution["candidateAugmentIds"]
    return payload


def _identity_disagreement(source: str, record: dict, resolution: dict, cdragon_by_id: dict) -> dict:
    cdragon = cdragon_by_id[resolution["augmentId"]]
    alias = resolution.get("alias", {})
    return {
        "source": source,
        "augmentNameId": resolution["augmentId"],
        "sourceName": record.get("name", ""),
        "cdragonName": cdragon.get("name", ""),
        "method": "alias",
        "aliasToken": resolution.get("token", ""),
        "reason": alias.get("reason", ""),
    }


def _rarity_disagreement(source: str, record: dict, resolution: dict, cdragon_by_id: dict) -> dict | None:
    source_rarity = record.get("rarity")
    if not source_rarity:
        return None
    cdragon = cdragon_by_id[resolution["augmentId"]]
    cdragon_rarity = cdragon.get("rarity")
    if source_rarity == cdragon_rarity:
        return None
    return {
        "source": source,
        "augmentNameId": resolution["augmentId"],
        "name": record.get("name", ""),
        "sourceRarity": source_rarity,
        "cdragonRarity": cdragon_rarity,
    }


def _availability_disagreements(record: dict, resolution: dict | None) -> list[dict]:
    lifecycle = record.get("lifecycle")
    if not lifecycle:
        return []
    if resolution and resolution.get("status") == "matched" and lifecycle == "removed":
        return [{
            "source": "internal_augments",
            "augmentNameId": resolution["augmentId"],
            "name": record.get("name", ""),
            "signal": "internal_removed_but_cdragon_registry_present",
            "note": "Registry presence is definition only; this is reported, not resolved.",
        }]
    if (not resolution or resolution.get("status") != "matched") and lifecycle in {"active", "added"}:
        return [{
            "source": "internal_augments",
            "name": record.get("name", ""),
            "slug": record.get("slug", ""),
            "signal": f"internal_{lifecycle}_but_cdragon_missing",
            "note": "Do not infer live availability from this internal lifecycle flag.",
        }]
    return []


def build_identity_outputs(cdragon_snapshot: dict, internal_catalog: dict, alias_table: dict) -> dict:
    cdragon_augments = cdragon_snapshot.get("augments", [])
    cdragon_by_id, cdragon_index = _build_cdragon_index(cdragon_augments)
    aliases = _alias_entries(alias_table, set(cdragon_by_id))
    alias_by_token = _alias_index(aliases)

    mapping_by_id = {
        augment_id: {
            "augmentId": augment_id,
            "cdragon": _cdragon_payload(augment),
            "sources": {source: [] for source in _SOURCE_NAMES},
        }
        for augment_id, augment in sorted(cdragon_by_id.items())
    }

    source_records = {
        "internal_augments": _internal_records(internal_catalog),
        "wiki": _wiki_records_from_internal(internal_catalog),
        "arammayhem_win_rate": _arammayhem_records_from_internal(internal_catalog),
    }
    include_slug = {
        "internal_augments": True,
        "wiki": False,
        "arammayhem_win_rate": True,
    }

    unmatched_sources: dict[str, list[dict]] = {}
    identity_disagreements: list[dict] = []
    rarity_disagreements: list[dict] = []
    availability_disagreements: list[dict] = []
    matched_primary_ids: set[str] = set()

    for source in _SOURCE_NAMES:
        unmatched_sources[source] = []
        for record in source_records[source]:
            resolution = _resolve_record(
                record,
                source,
                cdragon_index,
                alias_by_token,
                include_slug[source],
            )
            if resolution["status"] == "matched":
                augment_id = resolution["augmentId"]
                mapping_by_id[augment_id]["sources"][source].append(_source_payload(record, resolution))
                if source in _PRIMARY_SOURCES:
                    matched_primary_ids.add(augment_id)
                if resolution.get("method") == "alias":
                    identity_disagreements.append(
                        _identity_disagreement(source, record, resolution, cdragon_by_id)
                    )
                if source == "internal_augments":
                    rarity = _rarity_disagreement(source, record, resolution, cdragon_by_id)
                    if rarity:
                        rarity_disagreements.append(rarity)
                    availability_disagreements.extend(_availability_disagreements(record, resolution))
            else:
                unmatched_sources[source].append(_unmatched_payload(record, resolution))
                if source == "internal_augments":
                    availability_disagreements.extend(_availability_disagreements(record, None))

    cdragon_unmatched = [
        _cdragon_payload(cdragon_by_id[augment_id])
        for augment_id in sorted(set(cdragon_by_id) - matched_primary_ids)
    ]

    existence_disagreements = []
    for augment in cdragon_unmatched:
        existence_disagreements.append({
            "kind": "cdragon_only",
            "source": "cdragon",
            "augmentNameId": augment["augmentNameId"],
            "name": augment["name"],
            "rarity": augment["rarity"],
        })
    for source in _PRIMARY_SOURCES:
        for record in unmatched_sources[source]:
            existence_disagreements.append({
                "kind": "source_only",
                "source": source,
                "sourceKey": record.get("sourceKey", ""),
                "name": record.get("name", ""),
                "rarity": record.get("rarity", ""),
                "status": record.get("status", ""),
            })

    mappings = [
        mapping
        for mapping in mapping_by_id.values()
        if any(mapping["sources"][source] for source in _SOURCE_NAMES)
    ]
    mappings.sort(key=lambda item: item["augmentId"])

    unmatched_counts = {"cdragon": len(cdragon_unmatched)}
    unmatched_counts.update({source: len(unmatched_sources[source]) for source in _SOURCE_NAMES})

    source_match_counts = {
        source: sum(len(mapping["sources"][source]) for mapping in mappings)
        for source in _SOURCE_NAMES
    }

    mapping = {
        "identity_key": "CDragon augmentNameId",
        "normalization": "lowercase, strip non-alphanumerics, strip leading Quest: prefix",
        "counts": {
            "cdragon": len(cdragon_by_id),
            "mapped_augmentIds": len(mappings),
            "aliases": len(aliases),
            "source_matches": source_match_counts,
        },
        "alias_entries": aliases,
        "mappings": mappings,
    }

    unmatched = {
        "identity_key": "CDragon augmentNameId",
        "counts": unmatched_counts,
        "sources": {"cdragon": cdragon_unmatched, **unmatched_sources},
        "notes": [
            "arammayhem_win_rate is best-effort only; unmatched rows do not block identity resolution.",
            "CDragon registry presence is definition only, not live availability.",
        ],
    }

    contradictions = {
        "identity_key": "CDragon augmentNameId",
        "counts": {
            "identity": len(identity_disagreements),
            "existence": len(existence_disagreements),
            "rarity": len(rarity_disagreements),
            "availability": len(availability_disagreements),
        },
        "identity": identity_disagreements,
        "existence": existence_disagreements,
        "rarity": rarity_disagreements,
        "availability": availability_disagreements,
        "wiki_availability": {
            "status": "unavailable_in_committed_step_1_inputs",
            "note": (
                "The committed internal catalog contains wikiDescription rows but no independent "
                "wiki availability-notes snapshot. Step 1 reports that gap instead of guessing."
            ),
        },
        "wiki_rarity": {
            "status": "unavailable_in_committed_step_1_inputs",
            "note": (
                "The committed internal catalog does not preserve an independent wiki rarity field; "
                "rarity disagreements here compare CDragon with existing internal rarity only."
            ),
        },
        "tencent": {
            "status": "not_parsed_in_step_1",
            "note": "Tencent prose is left as a later validation reference; this report focuses on CDragon vs committed wiki/internal signals.",
        },
    }

    return {
        "mapping": mapping,
        "unmatched": unmatched,
        "contradictions": contradictions,
    }


def write_identity_outputs(outputs: dict) -> None:
    _write_json(MAPPING_PATH, outputs["mapping"])
    _write_json(UNMATCHED_PATH, outputs["unmatched"])
    _write_json(CONTRADICTIONS_PATH, outputs["contradictions"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdragon", type=Path, default=CDRAGON_PATH)
    parser.add_argument("--internal", type=Path, default=INTERNAL_AUGMENTS_PATH)
    parser.add_argument("--aliases", type=Path, default=ALIAS_PATH)
    parser.add_argument("--check", action="store_true", help="Build reports without writing files.")
    args = parser.parse_args()

    alias_table = _load_json(args.aliases) if args.aliases.exists() else {"aliases": []}
    outputs = build_identity_outputs(
        cdragon_snapshot=_load_json(args.cdragon),
        internal_catalog=_load_json(args.internal),
        alias_table=alias_table,
    )
    if not args.check:
        write_identity_outputs(outputs)

    print(
        "augment identity resolver: "
        f"{outputs['mapping']['counts']['mapped_augmentIds']} augmentIds mapped; "
        f"unmatched={outputs['unmatched']['counts']}; "
        f"contradictions={outputs['contradictions']['counts']}"
    )


if __name__ == "__main__":
    main()
