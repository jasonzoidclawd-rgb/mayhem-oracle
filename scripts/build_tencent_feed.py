#!/usr/bin/env python3
"""Build the official Tencent 26.12 corroboration feed.

The official Tencent/QQ patch-notes page is the authoritative list of augments
currently in the 26.12 Mayhem mode (https://lol.qq.com/gicp/news/410/37088140.html,
section #n3). It carries no win-rates (Riot policy) but IS the official "is this
augment current" source — exactly the corroboration the spec (§2.6) named.

This emits section-aware corroboration signals. Names in the Mayhem added or
adjusted sections are marked `live`; names in the Mayhem removed/disabled
sections are marked `removed`/`disabled`; names appearing only in unrelated
bugfix prose are ignored. Absence is inconclusive (name variant / untranslated).

Network step (run in update-data); assemble_augments.py reads the committed
feed for deterministic, no-network CI. On fetch failure the committed feed is
kept untouched so CI stays reproducible.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR

TENCENT_URL = "https://lol.qq.com/gicp/news/410/37088140.html"  # 26.12 patch notes (#n3 = Mayhem augments)
BASE_CATALOG_PATH = INTERNAL_DATA_DIR / "augment-base-catalog.json"
AUGMENTS_PATH = INTERNAL_DATA_DIR / "augments.json"
FEED_PATH = INTERNAL_DATA_DIR / "augment-tencent-feed.json"
FIXTURE_PATH = INTERNAL_DATA_DIR.parent / "fixtures" / "tencent-26.12.txt"

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
HAS_CJK = re.compile(r"[一-鿿]")

MAYHEM_START = "海克斯大乱斗"
MAYHEM_END = "斗魂竞技场"
REMOVED_START = "已移除的强化符文"
ADDED_START = "新增的强化符文"
ADJUSTED_START = "强化符文调整"
DISABLED_START = "已禁用的强化符文"
SYSTEM_START = "地图与系统更新"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_page_text() -> str | None:
    """Fetch + GBK-decode + strip tags. Returns plain text, or None on failure."""
    try:
        req = Request(TENCENT_URL, headers=HEADERS)
        with urlopen(req, timeout=40) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001 - network is best-effort
        print(f"  Tencent fetch failed ({exc}); keeping committed feed.", file=sys.stderr)
        return None
    html = raw.decode("gbk", errors="ignore")
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&[a-z]+;", " ", text)
    return text


def _slice_between(text: str, start_marker: str, end_markers: list[str]) -> str:
    start = text.find(start_marker)
    if start < 0:
        return ""
    end_candidates = [
        pos for marker in end_markers
        if (pos := text.find(marker, start + len(start_marker))) >= 0
    ]
    end = min(end_candidates) if end_candidates else len(text)
    return text[start:end]


def _mayhem_section(page_text: str) -> str:
    return _slice_between(page_text, MAYHEM_START, [MAYHEM_END])


def _tencent_sections(page_text: str) -> dict[str, str]:
    mayhem = _mayhem_section(page_text)
    return {
        "removed": _slice_between(mayhem, REMOVED_START, [ADDED_START]),
        "live": " ".join([
            _slice_between(mayhem, ADDED_START, [ADJUSTED_START]),
            _slice_between(mayhem, ADJUSTED_START, [DISABLED_START, SYSTEM_START]),
        ]),
        "disabled": _slice_between(mayhem, DISABLED_START, [SYSTEM_START]),
    }


def classify_tencent_status(page_text: str, names: list[str]) -> dict:
    sections = _tencent_sections(page_text)
    matched: dict[str, list[str]] = {}
    for section, body in sections.items():
        hits = [name for name in names if name and name in body]
        if hits:
            matched[section] = hits

    if "disabled" in matched:
        status = "disabled"
    elif "removed" in matched:
        status = "removed"
    elif "live" in matched:
        status = "live"
    else:
        status = None

    return {
        "tencent_status": status,
        "matchedNames": sorted({name for hits in matched.values() for name in hits}),
        "matchedSections": matched,
    }


def localized_names(augment: dict) -> list[str]:
    names = augment.get("names") if isinstance(augment.get("names"), dict) else {}
    candidates = [
        augment.get("name_zh_CN"),
        augment.get("name_zh_TW"),
        names.get("zh_cn"),
        names.get("zh_tw"),
    ]
    return [n for n in candidates if isinstance(n, str) and HAS_CJK.search(n) and len(n) >= 2]


def main() -> None:
    fixture_arg: Path | None = None
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture":
        fixture_arg = Path(sys.argv[2])
    elif len(sys.argv) != 1:
        raise SystemExit("usage: build_tencent_feed.py [--fixture data/fixtures/tencent-26.12.txt]")

    page_text = fixture_arg.read_text(encoding="utf-8") if fixture_arg else fetch_page_text()
    if page_text is None:
        if FEED_PATH.exists():
            print("Kept existing Tencent feed (no network).")
            return
        # First build with no network: emit an empty-but-valid feed.
        FEED_PATH.write_text(
            json.dumps(
                {"patch": "26.12", "source": TENCENT_URL, "augments": {}}, ensure_ascii=False, indent=2
            )
            + "\n",
            encoding="utf-8",
        )
        print("No network and no committed feed; wrote empty Tencent feed.")
        return

    # Cache the decoded text as a fixture for the regenerator's determinism / review.
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(page_text, encoding="utf-8")

    base = read_json(BASE_CATALOG_PATH).get("augments", [])
    existing = read_json(AUGMENTS_PATH).get("augments", [])

    feed: dict[str, dict] = {}
    matched = 0

    # Key by augmentId where available (base catalog + existing rows carrying augmentId),
    # else by slug, so assemble can look up either way.
    def record(key: str, augment: dict) -> None:
        nonlocal matched
        if not key or key in feed:
            return
        names = localized_names(augment)
        classification = classify_tencent_status(page_text, names)
        if classification["tencent_status"]:
            matched += 1
        feed[key] = classification

    for row in base:
        record(row.get("augmentId", ""), row)
    for row in existing:
        key = row.get("augmentId") or row.get("slug", "")
        record(key, row)

    counts_by_status: dict[str, int] = {}
    for row in feed.values():
        status = row.get("tencent_status") or "no_signal"
        counts_by_status[status] = counts_by_status.get(status, 0) + 1

    FEED_PATH.write_text(
        json.dumps(
            {
                "patch": "26.12",
                "source": TENCENT_URL,
                "note": "Section-aware corroboration: Mayhem added/adjusted => live; removed/disabled sections => non-current; unrelated prose is ignored.",
                "counts": {"keys": len(feed), **dict(sorted(counts_by_status.items()))},
                "augments": feed,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Tencent feed: {counts_by_status} / {len(feed)} keys.")


if __name__ == "__main__":
    main()
