#!/usr/bin/env python3
"""Fetch Riot patch-note prose metadata without deriving entity changes.

CommunityDragon snapshots and diffs are the sole structural authority for
champion, item, augment, addition/removal, and hotfix records.  Riot's article
remains useful for its title, publication date, canonical URL, attribution, and
optional top-level introduction only.
"""

from __future__ import annotations

import argparse
import html as html_module
import json
import re
from pathlib import Path
from typing import Callable
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR
from safe_http import read_limited_response


BASE_URL = "https://www.leagueoflegends.com"
NEWS_PATH = "/en-us/news/game-updates/"
SCRAPE_N_PATCHES = 6
OUT_DIR = INTERNAL_DATA_DIR
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Mayhem-Oracle-Patch-Metadata/1.0)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_PATCH_URL_RE = re.compile(
    r'href="(/en-us/news/game-updates/league-of-legends-patch-[\w-]+-notes/?)"',
)
_PATCH_VER_RE = re.compile(r"patch-(\d+)-(\d+[a-z]?)-notes")
_TIME_RE = re.compile(r'<time[^>]+date(?:T|t)ime="([^"]+)"')
_TITLE_RE = re.compile(r'<h1[^>]*data-testid="title"[^>]*>(.*?)</h1>', re.DOTALL)
_AUTHORS_RE = re.compile(r'<div class="authors">\s*<span>(.*?)</span>', re.DOTALL)
_META_DATE_RE = re.compile(
    r'<meta[^>]+(?:name|property)="(?:article:published_time|date)"[^>]+content="([^"T]+)',
)
_INTRO_RE = re.compile(
    r'<blockquote[^>]*class="[^"]*context[^"]*"[^>]*>(.*?)</blockquote>',
    re.DOTALL,
)


def fetch(path_or_url: str) -> str:
    url = path_or_url if path_or_url.startswith("http") else BASE_URL + path_or_url
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=30) as response:
        return read_limited_response(response).decode("utf-8", errors="replace")


def strip_tags(value: str) -> str:
    return _WS_RE.sub(" ", html_module.unescape(_TAG_RE.sub(" ", value))).strip()


def source_url(path_or_url: str) -> str:
    return path_or_url if path_or_url.startswith("http") else BASE_URL + path_or_url


def patch_version(path_or_url: str) -> str:
    match = _PATCH_VER_RE.search(path_or_url)
    if not match:
        raise ValueError(f"could not identify patch version from URL: {path_or_url}")
    return f"{match.group(1)}.{match.group(2)}"


def extract_article_metadata(html: str, en_path: str) -> dict[str, object]:
    title = _TITLE_RE.search(html)
    published = _TIME_RE.search(html) or _META_DATE_RE.search(html)
    authors = _AUTHORS_RE.search(html)
    intro = _INTRO_RE.search(html)
    return {
        "version": patch_version(en_path),
        "articleTitle": strip_tags(title.group(1)) if title else "",
        "publishedAt": published.group(1).strip() if published else "",
        "sourceUrl": source_url(en_path),
        "authors": [
            author.strip()
            for author in re.split(",\\s*", strip_tags(authors.group(1)) if authors else "")
            if author.strip()
        ],
        "intro": strip_tags(intro.group(1)) if intro else "",
    }


def discover_patch_paths(n: int = SCRAPE_N_PATCHES) -> list[str]:
    html = fetch(NEWS_PATH)
    paths: list[str] = []
    seen: set[str] = set()
    for match in _PATCH_URL_RE.finditer(html):
        path = match.group(1).rstrip("/")
        if path in seen:
            continue
        seen.add(path)
        paths.append(path)
        if len(paths) == n:
            break
    return paths


def build_metadata_document(
    paths: list[str],
    *,
    fetcher: Callable[[str], str] | None = None,
) -> dict[str, object]:
    """Create deterministic metadata only; this function never sees entity data."""
    fetcher = fetcher or fetch
    patches = [extract_article_metadata(fetcher(path), path) for path in paths]
    if not patches:
        raise RuntimeError("Riot patch metadata discovery returned no patch articles")
    return {
        "schema_version": 1,
        "source": "Riot Games prose metadata only",
        "patch": patches[0]["version"],
        "scraped_at": patches[0]["publishedAt"],
        "patches": patches,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--count", type=int, default=SCRAPE_N_PATCHES)
    args = parser.parse_args()
    document = build_metadata_document(discover_patch_paths(args.count))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    output = args.out_dir / "patch-metadata.json"
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Patch prose metadata: {len(document['patches'])} articles → {output.name}")


if __name__ == "__main__":
    main()
