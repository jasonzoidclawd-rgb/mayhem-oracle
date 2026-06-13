"""
Mayhem Oracle — CommunityDragon first-hand augment source + hotfix detector
===========================================================================
Riot does NOT publish ARAM: Mayhem server-side hotfixes ("不停機更新") on the
English patch-notes page, so the scraper that reads `...-patch-X-Y-notes` pages
is structurally blind to them. The authoritative first-hand source is the live
game data, mirrored by CommunityDragon. ARAM Mayhem's internal codename is
"kiwi" (Arena is "cherry"); its augments live in the shared augment registry
under the `ARAM_` nameId prefix.

This script extracts the canonical Riot augment text + rarity for every Mayhem
augment, writes a snapshot, and — by diffing against the previously committed
snapshot — emits hotfix records when augment text/rarity changes while the
patch number is unchanged. That is the signal a server-side hotfix shipped.

Sources (CommunityDragon `latest`):
    roster + rarity : plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json
                      (filter augmentNameId starting "ARAM_")
    Riot tooltips   : game/en_us/data/menu/en_us/lol.stringtable.json
                      (keys matching kiwi_*_tooltip / _desc / _name)

Usage:
    python3 scripts/scrape_mayhem_augments_cdragon.py

Output:
    data/internal/cdragon-mayhem-augments.json   – canonical snapshot (committed)
    data/internal/mayhem-hotfixes.json           – detected hotfix events (committed)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR

CDRAGON = "https://raw.communitydragon.org/latest"
ROSTER_URL = f"{CDRAGON}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json"
STRINGTABLE_URL = f"{CDRAGON}/game/en_us/data/menu/en_us/lol.stringtable.json"

HEADERS = {"User-Agent": "MayhemOracle/1.0 (data pipeline)"}

RARITY_MAP = {"kSilver": "silver", "kGold": "gold", "kPrismatic": "prismatic"}

SNAPSHOT_PATH = INTERNAL_DATA_DIR / "cdragon-mayhem-augments.json"
HOTFIX_PATH = INTERNAL_DATA_DIR / "mayhem-hotfixes.json"

_NONALNUM = re.compile(r"[^a-z0-9]")
# stringtable key noise stripped before matching to an augment nameId. Mayhem
# augments are keyed kiwi_*; augments converted from Arena keep a shared cherry_*
# tooltip. We index both and prefer kiwi_ (it reflects Mayhem-specific tuning).
_KEY_PREFIX = re.compile(r"^(kiwi|cherry)_(aram_)?(augment_)?")
_KEY_SUFFIX = re.compile(r"_(tooltip|desc)$")


def fetch_json(url: str) -> dict | list:
    print(f"  Fetching {url} ...")
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def norm(s: str) -> str:
    """Collapse a name/key to a comparable alphanumeric token."""
    return _NONALNUM.sub("", s.lower())


def build_tooltip_index(stringtable: dict) -> dict[str, str]:
    """Map normalized augment token → best Riot-authored tooltip/description.

    kiwi_ keys (Mayhem-specific) win over cherry_ keys (Arena shared); within a
    source, the longest text wins (tooltip over a terse desc).
    """
    entries = stringtable.get("entries", stringtable)
    if not isinstance(entries, dict):
        return {}
    # token -> (priority, length, text); higher priority/length replaces.
    best: dict[str, tuple[int, int, str]] = {}
    for key, value in entries.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        low = key.lower()
        if not _KEY_SUFFIX.search(low):
            continue
        m = _KEY_PREFIX.match(low)
        if not m:
            continue
        priority = 1 if m.group(1) == "kiwi" else 0
        token = norm(_KEY_SUFFIX.sub("", _KEY_PREFIX.sub("", low)))
        if not token:
            continue
        cand = (priority, len(value), value.strip())
        if token not in best or cand[:2] > best[token][:2]:
            best[token] = cand
    return {tok: text for tok, (_p, _l, text) in best.items()}


# UI locale key → augments.json localized-name field.
_NAME_FIELDS = {"en": "name", "zh-TW": "name_zh_TW", "zh-CN": "name_zh_CN",
                "ja": "name_ja", "ko": "name_ko"}


def localized_name_index() -> dict[str, dict[str, str]]:
    """norm(slug)/norm(name) → {locale: localized augment name} from augments.json."""
    data = load_json(INTERNAL_DATA_DIR / "augments.json") or {}
    index: dict[str, dict[str, str]] = {}
    for a in data.get("augments", []):
        names = {loc: a[field] for loc, field in _NAME_FIELDS.items() if a.get(field)}
        if not names:
            continue
        for key in (a.get("slug"), a.get("name")):
            if key:
                index.setdefault(norm(key), names)
    return index


def extract_augments(
    roster: dict | list, tooltips: dict[str, str], names_idx: dict[str, dict[str, str]]
) -> list[dict]:
    augs = roster.get("augments", roster) if isinstance(roster, dict) else roster
    out: list[dict] = []
    for a in augs:
        name_id = a.get("augmentNameId", "")
        if not name_id.startswith("ARAM_"):
            continue
        core = name_id[len("ARAM_"):]
        token = norm(core)
        en_name = a.get("nameTRA") or core
        # Join to localized names; fall back to the English name per locale.
        names = dict(names_idx.get(token, {}))
        names.setdefault("en", en_name)
        out.append({
            "nameId": name_id,
            "name": en_name,
            "names": names,
            "slug": re.sub(r"(?<!^)(?=[A-Z])", "-", core).lower(),
            "rarity": RARITY_MAP.get(a.get("rarity", ""), a.get("rarity", "")),
            "tooltip": tooltips.get(token, ""),
        })
    out.sort(key=lambda x: x["nameId"])
    return out


def _change_record(aug: dict, ctype: str, **extra) -> dict:
    """One localized hotfix change row for the UI."""
    rec = {"slug": aug["slug"], "names": aug.get("names", {"en": aug["name"]}),
           "rarity": aug.get("rarity"), "type": ctype}
    rec.update(extra)
    return rec


def build_event(delta: dict, patch: str, when: str) -> dict:
    """Turn a raw augment diff into a localized, structured hotfix event."""
    changes: list[dict] = []
    for a in delta["added"]:
        changes.append(_change_record(a, "added"))
    for a in delta["removed"]:
        changes.append(_change_record(a, "removed"))
    for c in delta["changed"]:
        aug = c["new"]
        if "rarity" in c["fields"]:
            changes.append(_change_record(aug, "rarity",
                                          fromRarity=c["before"].get("rarity"),
                                          toRarity=c["after"].get("rarity")))
        if "tooltip" in c["fields"] or "name" in c["fields"]:
            changes.append(_change_record(aug, "effect"))
    return {"detected_at": when, "patch": patch, "date": when[:10], "changes": changes}


def diff_augments(old: list[dict], new: list[dict]) -> dict[str, list]:
    old_by = {a["nameId"]: a for a in old}
    new_by = {a["nameId"]: a for a in new}
    added = [new_by[k] for k in new_by.keys() - old_by.keys()]
    removed = [old_by[k] for k in old_by.keys() - new_by.keys()]
    changed = []
    for k in old_by.keys() & new_by.keys():
        o, n = old_by[k], new_by[k]
        fields = [f for f in ("rarity", "tooltip", "name") if o.get(f) != n.get(f)]
        if fields:
            changed.append({"nameId": k, "new": n, "fields": fields,
                            "before": {f: o.get(f) for f in fields},
                            "after": {f: n.get(f) for f in fields}})
    return {"added": added, "removed": removed, "changed": changed}


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def main() -> None:
    meta = load_json(INTERNAL_DATA_DIR / "meta.json") or {}
    patch = meta.get("patch", "unknown")

    roster = fetch_json(ROSTER_URL)
    stringtable = fetch_json(STRINGTABLE_URL)
    tooltips = build_tooltip_index(stringtable)
    augments = extract_augments(roster, tooltips, localized_name_index())
    matched = sum(1 for a in augments if a["tooltip"])
    print(f"  Mayhem augments: {len(augments)} ({matched} with Riot tooltip)")

    prev = load_json(SNAPSHOT_PATH)
    now = datetime.now(timezone.utc).isoformat()

    if prev and prev.get("augments"):
        delta = diff_augments(prev["augments"], augments)
        n = len(delta["added"]) + len(delta["removed"]) + len(delta["changed"])
        if n and prev.get("patch") == patch:
            # Same patch, different augment data => server-side hotfix.
            event = build_event(delta, patch, now)
            hotfixes = load_json(HOTFIX_PATH) or {"events": []}
            hotfixes["patch"] = patch
            hotfixes["generated_at"] = now
            hotfixes["events"] = [
                e for e in hotfixes.get("events", []) if e.get("date") != event["date"]
            ] + [event]
            hotfixes["events"].sort(key=lambda e: e["detected_at"], reverse=True)
            HOTFIX_PATH.write_text(
                json.dumps(hotfixes, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"  ⚠ HOTFIX detected on patch {patch}: "
                  f"+{len(delta['added'])} -{len(delta['removed'])} "
                  f"~{len(delta['changed'])} augments → {HOTFIX_PATH.name}")
        elif n:
            print(f"  Patch changed ({prev.get('patch')} → {patch}); "
                  f"{n} augment deltas attributed to the patch, not a hotfix.")
        else:
            print("  No augment changes since last snapshot.")
    else:
        print("  No prior snapshot — establishing hotfix-detection baseline.")

    SNAPSHOT_PATH.write_text(
        json.dumps({"patch": patch, "fetched_at": now, "source": CDRAGON,
                    "augments": augments}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  → {SNAPSHOT_PATH.name} written")


if __name__ == "__main__":
    main()
