#!/usr/bin/env python3
"""Build the internal LoL Wiki augment feed keyed by CDragon augmentNameId."""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen

from augment_identity_resolver import normalize_identity_key
from data_paths import INTERNAL_DATA_DIR


WIKI_PAGE_TITLE = "ARAM:_Mayhem/Augments"
WIKI_PAGE_URL = "https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augments"
WIKI_API = "https://wiki.leagueoflegends.com/api.php"
HEADERS = {"User-Agent": "MayhemOracleBot/1.0 (https://github.com/mayhem-oracle)"}

IDENTITY_MAP_PATH = INTERNAL_DATA_DIR / "augment-identity-map.json"
BASE_CATALOG_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"
WIKI_FEED_PATH = INTERNAL_DATA_DIR / "augment-wiki-feed.json"
WIKI_ONLY_REPORT_PATH = INTERNAL_DATA_DIR / "augment-wiki-only-report.json"
WIKI_UNMATCHED_REPORT_PATH = INTERNAL_DATA_DIR / "augment-wiki-unmatched-report.json"
WIKI_CONTRADICTIONS_REPORT_PATH = INTERNAL_DATA_DIR / "augment-wiki-contradictions-report.json"

IDENTITY_KEY = "CDragon augmentNameId"
SOURCE = "lol_wiki"

_RARITIES = ("silver", "gold", "prismatic")
_BLOCK_TAGS = {
    "br",
    "div",
    "li",
    "p",
    "td",
    "th",
    "tr",
    "ul",
}
_AVAILABILITY_SENTENCE_RE = re.compile(
    r"(?i)(?:^|(?<=[.!?])\s+)"
    r"(This augment[^.!?]*(?:currently disabled|disabled|available|offered|not offered)[^.!?]*[.!?])"
)
_NOTE_ICON_TITLE_RE = re.compile(
    r'title="An icon for the (?:ARAM:? Mayhem|Arena) augment ([^"]+)"',
    flags=re.IGNORECASE,
)
_NOTE_FILE_RE = re.compile(r"(?:File:|/)([^\"/<>]+?)_mayhem_augment\.png", flags=re.IGNORECASE)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class _TextStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        return normalize_text("".join(self.parts))


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(value)).strip()


def strip_html(value: str) -> str:
    parser = _TextStripper()
    parser.feed(value)
    return parser.text()


def _start_tag(tag: str, attrs: list[tuple[str, str | None]]) -> str:
    attr_text = "".join(
        f' {name}="{html_lib.escape(value or "", quote=True)}"'
        for name, value in attrs
    )
    return f"<{tag}{attr_text}>"


class _FirstWikiTableParser(HTMLParser):
    """Collect top-level cells from the first sortable wikitable."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.rows: list[list[str]] = []
        self._in_target = False
        self._done = False
        self._table_depth = 0
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        class_value = " ".join(value or "" for name, value in attrs if name == "class")
        if tag == "table":
            if not self._in_target and not self._done and "wikitable" in class_value:
                self._in_target = True
                self._table_depth = 1
                return
            if self._in_target:
                if self._cell is not None:
                    self._cell.append(_start_tag(tag, attrs))
                self._table_depth += 1
                return

        if not self._in_target:
            return

        if self._table_depth == 1 and tag == "tr":
            self._row = []
            return

        if self._table_depth == 1 and tag in {"td", "th"} and self._row is not None and self._cell is None:
            self._cell = []
            return

        if self._cell is not None:
            self._cell.append(_start_tag(tag, attrs))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._in_target and self._cell is not None:
            self._cell.append(_start_tag(tag.lower(), attrs))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if not self._in_target:
            return

        if tag == "table":
            if self._cell is not None and self._table_depth > 1:
                self._cell.append(f"</{tag}>")
            self._table_depth -= 1
            if self._table_depth == 0:
                self._in_target = False
                self._done = True
            return

        if self._table_depth == 1 and tag in {"td", "th"} and self._row is not None and self._cell is not None:
            self._row.append("".join(self._cell))
            self._cell = None
            return

        if self._table_depth == 1 and tag == "tr":
            if self._row:
                self.rows.append(self._row)
            self._row = None
            return

        if self._cell is not None:
            self._cell.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self._in_target and self._cell is not None:
            self._cell.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._in_target and self._cell is not None:
            self._cell.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self._in_target and self._cell is not None:
            self._cell.append(f"&#{name};")


def _remove_tables(value: str) -> str:
    previous = None
    current = value
    while previous != current:
        previous = current
        current = re.sub(r"<table\b.*?</table>", " ", current, flags=re.DOTALL | re.IGNORECASE)
    return current


def _wiki_name_from_cell(cell_html: str) -> str:
    title_match = re.search(
        r'title="An icon for the ARAM:? Mayhem augment ([^"]+)"',
        cell_html,
        flags=re.IGNORECASE,
    )
    if title_match:
        return normalize_text(title_match.group(1))
    return strip_html(cell_html)


def _wiki_rarity_from_cell(cell_html: str) -> str | None:
    text = strip_html(cell_html).lower()
    for rarity in _RARITIES:
        if rarity in text:
            return rarity
    return None


def _extract_availability_notes(effect_text: str) -> list[str]:
    notes: list[str] = []
    seen: set[str] = set()
    for match in _AVAILABILITY_SENTENCE_RE.finditer(effect_text):
        note = normalize_text(match.group(1))
        key = note.lower()
        if note and key not in seen:
            notes.append(note)
            seen.add(key)
    return notes


def _description_without_availability(effect_html: str) -> tuple[str, list[str]]:
    text = strip_html(_remove_tables(effect_html))
    availability_notes = _extract_availability_notes(text)
    for note in availability_notes:
        text = normalize_text(text.replace(note, " "))
    return text, availability_notes


def extract_wiki_augments(html: str) -> list[dict[str, Any]]:
    parser = _FirstWikiTableParser()
    parser.feed(html)

    rows: list[dict[str, Any]] = []
    for cells in parser.rows:
        if len(cells) < 3:
            continue
        if strip_html(cells[0]).lower() == "augment":
            continue

        name = _wiki_name_from_cell(cells[0])
        description, availability_notes = _description_without_availability(cells[1])
        rarity = _wiki_rarity_from_cell(cells[2])
        if not name or not description:
            continue

        row: dict[str, Any] = {
            "sourceKey": name,
            "name": name,
            "wikiDescription": description,
            "wikiAvailabilityNotes": availability_notes,
        }
        if rarity:
            row["wikiRarity"] = rarity
        rows.append(row)
    return rows


def _notes_section(html: str) -> str:
    marker = re.search(r'id="Notes"', html, flags=re.IGNORECASE)
    if not marker:
        return ""
    start = marker.start()
    next_heading = re.search(r'<h2\b[^>]*id="(Trivia|References)"', html[start:], flags=re.IGNORECASE)
    if next_heading:
        return html[start:start + next_heading.start()]
    return html[start:]


def _note_reference_names(note_html: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    for match in _NOTE_ICON_TITLE_RE.finditer(note_html):
        name = normalize_text(match.group(1))
        key = normalize_identity_key(name)
        if key and key not in seen:
            names.append(name)
            seen.add(key)

    for match in _NOTE_FILE_RE.finditer(note_html):
        name = unquote(match.group(1))
        name = re.sub(r"^.*File:", "", name)
        name = name.rsplit("/", 1)[-1]
        name = re.sub(r"^\d+px-", "", name)
        name = normalize_text(name.replace("_", " "))
        key = normalize_identity_key(name)
        if key and key not in seen:
            names.append(name)
            seen.add(key)

    return names


def extract_page_note_entries(html: str) -> list[dict[str, Any]]:
    section = _notes_section(html)
    if not section:
        return []
    ul_match = re.search(r"<ul>(.*?)</ul>", section, flags=re.DOTALL | re.IGNORECASE)
    if not ul_match:
        return []

    notes: list[dict[str, Any]] = []
    for li in re.findall(r"<li>(.*?)(?:</li>|(?=<li>))", ul_match.group(1), flags=re.DOTALL | re.IGNORECASE):
        text = strip_html(li)
        if text:
            notes.append({"text": text, "referenceNames": _note_reference_names(li)})
    return notes


def extract_page_notes(html: str) -> list[str]:
    return [entry["text"] for entry in extract_page_note_entries(html)]


def _augment_id(augment: dict[str, Any]) -> str:
    return augment.get("augmentId") or augment.get("augmentNameId") or augment.get("nameId") or ""


def _catalog_variants(augment: dict[str, Any]) -> list[Any]:
    cdragon = augment.get("cdragon") if isinstance(augment.get("cdragon"), dict) else {}
    names = augment.get("names") if isinstance(augment.get("names"), dict) else {}
    augment_id = _augment_id(augment)
    variants: list[Any] = [
        augment_id,
        augment_id.removeprefix("ARAM_"),
        augment.get("name"),
        cdragon.get("augmentNameId"),
        cdragon.get("arenaApiName"),
    ]
    variants.extend(names.values())
    return variants


def _add_lookup_token(lookup: dict[str, set[str]], token_value: Any, augment_id: str) -> None:
    token = normalize_identity_key(token_value)
    if token and augment_id:
        lookup.setdefault(token, set()).add(augment_id)


def _identity_lookup(identity_map: dict[str, Any], base_catalog: dict[str, Any]) -> dict[str, set[str]]:
    lookup: dict[str, set[str]] = {}
    for augment in base_catalog.get("augments", []):
        augment_id = _augment_id(augment)
        for variant in _catalog_variants(augment):
            _add_lookup_token(lookup, variant, augment_id)

    for mapping in identity_map.get("mappings", []):
        augment_id = mapping.get("augmentId")
        cdragon = mapping.get("cdragon") if isinstance(mapping.get("cdragon"), dict) else {}
        for variant in (augment_id, cdragon.get("name"), cdragon.get("slug")):
            _add_lookup_token(lookup, variant, augment_id)
        sources = mapping.get("sources") if isinstance(mapping.get("sources"), dict) else {}
        for source in sources.get("wiki", []):
            for field in ("sourceKey", "name", "slug"):
                _add_lookup_token(lookup, source.get(field), augment_id)
    return lookup


def _alias_hits(identity_map: dict[str, Any], token: str) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for entry in identity_map.get("alias_entries", []):
        applies_to = entry.get("applies_to") or []
        if "all" not in applies_to and "wiki" not in applies_to:
            continue
        if token in (entry.get("tokens") or []):
            hits.append(entry)
    return hits


def _resolve_wiki_row(
    row: dict[str, Any],
    lookup: dict[str, set[str]],
    identity_map: dict[str, Any],
) -> dict[str, Any]:
    tokens = []
    seen: set[str] = set()
    for field in ("sourceKey", "name"):
        token = normalize_identity_key(row.get(field))
        if token and token not in seen:
            tokens.append({"field": field, "value": row.get(field), "token": token})
            seen.add(token)

    direct: dict[str, str] = {}
    for token in tokens:
        for augment_id in lookup.get(token["token"], set()):
            direct[augment_id] = token["token"]
    if len(direct) == 1:
        augment_id, token = next(iter(direct.items()))
        return {"status": "matched", "augmentId": augment_id, "method": "normalized", "token": token}
    if len(direct) > 1:
        return {"status": "ambiguous", "candidateAugmentIds": sorted(direct), "tokens": tokens}

    aliases: dict[str, dict[str, Any]] = {}
    for token in tokens:
        for entry in _alias_hits(identity_map, token["token"]):
            augment_id = entry.get("augmentNameId") or entry.get("nameId")
            if augment_id:
                aliases[augment_id] = {"entry": entry, "token": token["token"]}
    if len(aliases) == 1:
        augment_id, hit = next(iter(aliases.items()))
        return {
            "status": "matched",
            "augmentId": augment_id,
            "method": "alias",
            "token": hit["token"],
            "alias": hit["entry"],
        }
    if len(aliases) > 1:
        return {"status": "ambiguous_alias", "candidateAugmentIds": sorted(aliases), "tokens": tokens}
    return {"status": "unmatched", "tokens": tokens}


def _notes_by_augment_id(
    note_entries: list[dict[str, Any]],
    lookup: dict[str, set[str]],
    identity_map: dict[str, Any],
) -> dict[str, list[str]]:
    notes: dict[str, list[str]] = {}
    for entry in note_entries:
        for name in entry.get("referenceNames", []):
            resolution = _resolve_wiki_row({"sourceKey": name, "name": name}, lookup, identity_map)
            if resolution.get("status") == "matched":
                notes.setdefault(resolution["augmentId"], []).append(entry["text"])
    return notes


def _base_by_id(base_catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        _augment_id(augment): augment
        for augment in base_catalog.get("augments", [])
        if _augment_id(augment)
    }


def _unmatched_row(row: dict[str, Any], resolution: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sourceKey": row.get("sourceKey", ""),
        "name": row.get("name", ""),
        "status": resolution.get("status", ""),
        "tokens": resolution.get("tokens", []),
    }
    if row.get("wikiRarity"):
        payload["wikiRarity"] = row["wikiRarity"]
    if resolution.get("candidateAugmentIds"):
        payload["candidateAugmentIds"] = resolution["candidateAugmentIds"]
    return payload


def build_augment_wiki_outputs(
    *,
    html: str,
    identity_map: dict[str, Any],
    base_catalog: dict[str, Any],
    fetched_at: str | None = None,
    source_url: str = WIKI_PAGE_URL,
) -> dict[str, Any]:
    fetched_at = fetched_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    rows = extract_wiki_augments(html)
    page_note_entries = extract_page_note_entries(html)
    page_notes = [entry["text"] for entry in page_note_entries]
    lookup = _identity_lookup(identity_map, base_catalog)
    notes_by_augment_id = _notes_by_augment_id(page_note_entries, lookup, identity_map)
    cdragon_by_id = _base_by_id(base_catalog)

    feed_augments: dict[str, dict[str, Any]] = {}
    unmatched_rows: list[dict[str, Any]] = []
    matched_rows: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    for row in rows:
        resolution = _resolve_wiki_row(row, lookup, identity_map)
        if resolution["status"] != "matched":
            unmatched_rows.append(_unmatched_row(row, resolution))
            continue

        augment_id = resolution["augmentId"]
        entry: dict[str, Any] = {
            "wikiDescription": row["wikiDescription"],
            "wikiNotes": notes_by_augment_id.get(augment_id, []),
            "wikiAvailabilityNotes": row["wikiAvailabilityNotes"],
            "wikiFetchedAt": fetched_at,
        }
        if row.get("wikiRarity"):
            entry["wikiRarity"] = row["wikiRarity"]
        feed_augments[augment_id] = entry
        matched_rows.append((augment_id, row, resolution))

    for augment_id, notes in sorted(notes_by_augment_id.items()):
        if augment_id in feed_augments or augment_id not in cdragon_by_id:
            continue
        feed_augments[augment_id] = {
            "wikiNotes": notes,
            "wikiAvailabilityNotes": [],
            "wikiFetchedAt": fetched_at,
        }

    matched_ids = set(feed_augments)
    cdragon_ids = set(cdragon_by_id)
    cdragon_only = sorted(cdragon_ids - matched_ids)

    wiki_only_rows = unmatched_rows
    existence = [
        {
            "kind": "wiki_only",
            "source": SOURCE,
            "sourceKey": row.get("sourceKey", ""),
            "name": row.get("name", ""),
            "wikiRarity": row.get("wikiRarity", ""),
            "status": row.get("status", ""),
        }
        for row in wiki_only_rows
    ]
    existence.extend(
        {
            "kind": "cdragon_only",
            "source": "cdragon",
            "augmentId": augment_id,
            "name": cdragon_by_id[augment_id].get("name", ""),
            "rarity": cdragon_by_id[augment_id].get("rarity", ""),
        }
        for augment_id in cdragon_only
    )

    rarity = []
    availability = []
    for augment_id, row, resolution in matched_rows:
        cdragon = cdragon_by_id.get(augment_id, {})
        wiki_rarity = row.get("wikiRarity")
        cdragon_rarity = cdragon.get("rarity")
        if wiki_rarity and cdragon_rarity and wiki_rarity != cdragon_rarity:
            rarity.append({
                "source": SOURCE,
                "augmentId": augment_id,
                "name": row.get("name", ""),
                "wikiRarity": wiki_rarity,
                "cdragonRarity": cdragon_rarity,
                "note": "CDragon remains rarity authority; this report is evidence only.",
            })
        if row.get("wikiAvailabilityNotes"):
            availability.append({
                "source": SOURCE,
                "augmentId": augment_id,
                "name": row.get("name", ""),
                "signal": "wiki_availability_note_with_cdragon_registry_presence",
                "wikiAvailabilityNotes": row["wikiAvailabilityNotes"],
                "note": "Registry presence is definition only; Step 4 records wiki evidence and does not resolve availability.",
            })

    feed = {
        "schemaVersion": 1,
        "identity_key": IDENTITY_KEY,
        "source": SOURCE,
        "sourceUrl": source_url,
        "wikiFetchedAt": fetched_at,
        "counts": {
            "wikiRows": len(rows),
            "matchedAugmentIds": len(feed_augments),
            "withWikiDescription": sum(1 for row in feed_augments.values() if row.get("wikiDescription")),
            "withWikiNotes": sum(1 for row in feed_augments.values() if row.get("wikiNotes")),
            "withWikiAvailabilityNotes": sum(1 for row in feed_augments.values() if row.get("wikiAvailabilityNotes")),
            "withWikiRarity": sum(1 for row in feed_augments.values() if row.get("wikiRarity")),
            "pageNotes": len(page_notes),
        },
        "pageNotes": page_notes,
        "notes": [
            "Wiki Notes and availability notes are evidence signals only.",
            "Downstream availability and lifecycle resolution remains Step 5 work.",
        ],
        "augments": dict(sorted(feed_augments.items())),
    }

    reports = {
        "wiki_only": {
            "schemaVersion": 1,
            "identity_key": IDENTITY_KEY,
            "source": SOURCE,
            "sourceUrl": source_url,
            "counts": {"wikiOnlyRows": len(wiki_only_rows)},
            "wikiOnly": wiki_only_rows,
            "notes": ["Wiki-only rows are report-only and are not added to the CDragon-keyed feed."],
        },
        "unmatched": {
            "schemaVersion": 1,
            "identity_key": IDENTITY_KEY,
            "source": SOURCE,
            "sourceUrl": source_url,
            "counts": {
                "wikiRows": len(rows),
                "matchedAugmentIds": len(feed_augments),
                "unmatchedWikiRows": len(unmatched_rows),
            },
            "sources": {"wiki": unmatched_rows},
        },
        "contradictions": {
            "schemaVersion": 1,
            "identity_key": IDENTITY_KEY,
            "source": SOURCE,
            "sourceUrl": source_url,
            "counts": {
                "existence": len(existence),
                "rarity": len(rarity),
                "availability": len(availability),
            },
            "existence": existence,
            "rarity": rarity,
            "availability": availability,
            "notes": [
                "Contradictions are report-only for Claude review.",
                "CDragon wins definition and rarity; availability is resolved in Step 5 from all signals.",
            ],
        },
    }

    return {"feed": feed, "reports": reports}


def fetch_wiki_html(page_title: str = WIKI_PAGE_TITLE) -> str:
    params = urlencode({
        "action": "parse",
        "page": page_title,
        "prop": "text",
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
    })
    req = Request(f"{WIKI_API}?{params}", headers=HEADERS)
    try:
        with urlopen(req, timeout=30) as response:
            data = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"failed to fetch wiki page: {exc}") from exc
    if "error" in data:
        raise RuntimeError(f"wiki API error: {data['error'].get('info', data['error'])}")
    html = data.get("parse", {}).get("text")
    if not isinstance(html, str) or not html:
        raise RuntimeError("wiki API response did not contain parsed HTML")
    return html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity-map", type=Path, default=IDENTITY_MAP_PATH)
    parser.add_argument("--base-catalog", type=Path, default=BASE_CATALOG_PATH)
    parser.add_argument("--html", type=Path, help="Read wiki HTML from a fixture instead of fetching.")
    parser.add_argument("--fetched-at", help="Override wikiFetchedAt for deterministic test artifacts.")
    parser.add_argument("--feed-out", type=Path, default=WIKI_FEED_PATH)
    parser.add_argument("--wiki-only-out", type=Path, default=WIKI_ONLY_REPORT_PATH)
    parser.add_argument("--unmatched-out", type=Path, default=WIKI_UNMATCHED_REPORT_PATH)
    parser.add_argument("--contradictions-out", type=Path, default=WIKI_CONTRADICTIONS_REPORT_PATH)
    args = parser.parse_args()

    html = args.html.read_text(encoding="utf-8") if args.html else fetch_wiki_html()
    outputs = build_augment_wiki_outputs(
        html=html,
        identity_map=load_json(args.identity_map),
        base_catalog=load_json(args.base_catalog),
        fetched_at=args.fetched_at,
    )

    write_json(args.feed_out, outputs["feed"])
    write_json(args.wiki_only_out, outputs["reports"]["wiki_only"])
    write_json(args.unmatched_out, outputs["reports"]["unmatched"])
    write_json(args.contradictions_out, outputs["reports"]["contradictions"])

    counts = outputs["feed"]["counts"]
    contradictions = outputs["reports"]["contradictions"]["counts"]
    print(
        "augment wiki feed: "
        f"{counts['matchedAugmentIds']} matched augmentIds; "
        f"{counts['withWikiNotes']} with notes; "
        f"{counts['withWikiAvailabilityNotes']} with availability notes; "
        f"wiki-only={outputs['reports']['wiki_only']['counts']['wikiOnlyRows']}; "
        f"contradictions={contradictions}"
    )


if __name__ == "__main__":
    main()
