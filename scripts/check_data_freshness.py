#!/usr/bin/env python3
"""Compare the published arammayhem statistics-feed patch against its live patch.

This does not prove Riot catalog or mechanics freshness. ``meta.catalog_patch``
must not be substituted for the arammayhem feed authority in ``meta.patch``.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path
from typing import Any

from scrape_arammayhem import extract_patch, fetch


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_META_PATH = ROOT / "public" / "data" / "meta.json"


def patch_key(patch: str) -> tuple[int, int]:
    parts = patch.split(".")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise ValueError(f"Unsupported patch format: {patch!r}")
    return int(parts[0]), int(parts[1])


def compare_patches(left: str, right: str) -> int:
    left_key = patch_key(left)
    right_key = patch_key(right)
    return (left_key > right_key) - (left_key < right_key)


def resolve_upstream_patch(search_index: dict[str, Any] | None, page_htmls: list[str]) -> str | None:
    candidates: list[str] = []
    search_patch = (search_index or {}).get("patch")
    if isinstance(search_patch, str) and search_patch:
        candidates.append(search_patch)
    page_patch = extract_patch(*page_htmls)
    if page_patch:
        candidates.append(page_patch)
    if not candidates:
        return None
    return max(candidates, key=patch_key)


def freshness_status(published_patch: str | None, upstream_patch: str | None) -> str:
    if not published_patch or not upstream_patch:
        return "unknown"
    return "stale" if compare_patches(published_patch, upstream_patch) < 0 else "fresh"


def load_published_patch(meta_path: Path) -> str | None:
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    # meta.patch is the arammayhem statistics-feed authority; catalog_patch is Riot-owned.
    patch = data.get("patch")
    return patch if isinstance(patch, str) else None


def fetch_upstream_patch() -> str | None:
    search_index = json.loads(fetch("/search-index.json"))
    tier_html = fetch("/tier-list/")
    augments_html = fetch("/augments/")
    return resolve_upstream_patch(search_index, [tier_html, augments_html])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--published-meta", type=Path, default=PUBLIC_META_PATH)
    parser.add_argument("--published-patch")
    parser.add_argument("--upstream-patch")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    published_error = None
    upstream_error = None
    try:
        published_patch = args.published_patch or load_published_patch(args.published_meta)
    except Exception as exc:
        published_patch = None
        published_error = str(exc)
    try:
        if args.upstream_patch:
            upstream_patch = args.upstream_patch
        elif args.json:
            with contextlib.redirect_stdout(sys.stderr):
                upstream_patch = fetch_upstream_patch()
        else:
            upstream_patch = fetch_upstream_patch()
    except Exception as exc:
        upstream_patch = None
        upstream_error = str(exc)
    status = freshness_status(published_patch, upstream_patch)
    result = {
        "scope": "statistics-feed",
        "status": status,
        "published_patch": published_patch,
        "upstream_patch": upstream_patch,
    }
    if published_error:
        result["published_error"] = published_error
    if upstream_error:
        result["upstream_error"] = upstream_error

    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(
            f"statistics-feed {status}: "
            f"published_feed_patch={published_patch or 'unknown'} "
            f"arammayhem_upstream_patch={upstream_patch or 'unknown'}",
        )

    if status == "stale":
        raise SystemExit(2)
    if status == "unknown":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
