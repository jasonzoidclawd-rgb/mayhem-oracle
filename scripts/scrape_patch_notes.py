"""
Mayhem Oracle — Patch Notes Scraper
====================================
Fetches ARAM: Mayhem patch notes from the official League of Legends site
(https://www.leagueoflegends.com) for en/zh-tw/ja-jp/ko-kr locales.

Significantly more timely than wiki-sourced data — the official page is
published on patch day, while the wiki can lag by several days.

After scraping, also writes recentChanges to public/data/augments.json
so augment detail pages reflect same-day stat updates even if
wikiDescription hasn't caught up yet.

Usage:
    python3 scripts/scrape_patch_notes.py

Output:
    public/data/patch-notes.json   – structured change feed
    public/data/augments.json       – recentChanges field updated in-place
"""

from __future__ import annotations
import html as html_module
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE_URL = "https://www.leagueoflegends.com"
NEWS_PATH = "/en-us/news/game-updates/"
SCRAPE_N_PATCHES = 6

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
OUT_DIR = Path(__file__).parent.parent / "public" / "data"

# Our locale keys → LoL site URL locale prefixes.
# zh-cn: global site redirects to a 404; use zh-tw content under zh-cn key
# for backward-compatibility with existing patch-notes.json consumers.
LOCALE_PREFIXES: dict[str, str] = {
    "zh-cn": "zh-tw",
    "ja-jp": "ja-jp",
    "ko-kr": "ko-kr",
}

# h4 sub-section headings inside ARAM: Mayhem → canonical section ids
MAYHEM_SUBSECTION_MAP: dict[str, str] = {
    "Champions": "champions",
    "Augments":  "augments",
    "Systems":   "general",
    "Items":     "new_items",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE  = re.compile(r"\s+")
_PATCH_URL_RE = re.compile(
    r'href="(/en-us/news/game-updates/league-of-legends-patch-[\w-]+-notes/?)"'
)
_PATCH_VER_RE = re.compile(r"patch-(\d+)-(\d+[a-z]?)-notes")
_ALL_H2_RE    = re.compile(r"<h2[^>]*>(.*?)</h2>", re.DOTALL)
_H4_BLOCK_RE  = re.compile(r"<h4[^>]*>(.*?)</h4>(.*?)(?=<h4[^>]*>|$)", re.DOTALL)
_UL_RE        = re.compile(r"<ul[^>]*>(.*?)</ul>", re.DOTALL)
_LI_RE        = re.compile(r"<li[^>]*>(.*?)</li>", re.DOTALL)
_STRONG_RE    = re.compile(r"<strong[^>]*>(.*?)</strong>", re.DOTALL)
_TIME_RE = re.compile(r'<time[^>]+datetime="([^"T]+)')
_META_DATE_RE = re.compile(
    r'<meta[^>]+(?:name|property)="(?:article:published_time|date)"[^>]+content="([^"T]+)'
)


# ── HTML helpers ───────────────────────────────────────────────────────────

def fetch(path_or_url: str) -> str:
    url = path_or_url if path_or_url.startswith("http") else BASE_URL + path_or_url
    print(f"  Fetching {url} ...")
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def strip_tags(s: str) -> str:
    return _WS_RE.sub(" ", html_module.unescape(_TAG_RE.sub(" ", s))).strip()


# ── URL discovery ──────────────────────────────────────────────────────────

def discover_patch_paths(n: int = SCRAPE_N_PATCHES) -> list[str]:
    """Return up to n most-recent patch note paths from the news listing."""
    html = fetch(NEWS_PATH)
    seen: set[str] = set()
    paths: list[str] = []
    for m in _PATCH_URL_RE.finditer(html):
        p = m.group(1).rstrip("/")
        if p not in seen:
            seen.add(p)
            paths.append(p)
            if len(paths) >= n:
                break
    return paths


def locale_path(en_path: str, locale_key: str) -> str:
    prefix = LOCALE_PREFIXES.get(locale_key, "en-us")
    return re.sub(r"^/en-us/", f"/{prefix}/", en_path)


# ── Page parsing ───────────────────────────────────────────────────────────

# Known locale translations of "ARAM: Mayhem" used as h2 section headings.
_ARAM_MAYHEM_H2_TITLES: frozenset[str] = frozenset({
    "aram: mayhem",
    "隨機單中：大混戰",      # zh-tw
    "ランダムミッド：メイヘム",  # ja-jp
    "aram: 무작위 혼전",      # ko-kr (common form; falls back to EN if absent)
    "aram: 대혼전",           # ko-kr alt
})


def _extract_h2_section(html: str, title: str) -> str | None:
    """Return HTML content between a named <h2> and the next <h2>.

    For 'ARAM: Mayhem', also matches known locale translations so locale
    pages parse correctly without requiring the English heading.
    """
    target = title.lower().strip()
    use_locale_set = target == "aram: mayhem"
    h2s = list(_ALL_H2_RE.finditer(html))
    for i, m in enumerate(h2s):
        heading = strip_tags(m.group(1)).lower().strip()
        if heading == target or (use_locale_set and heading in _ARAM_MAYHEM_H2_TITLES):
            start = m.end()
            end = h2s[i + 1].start() if i + 1 < len(h2s) else len(html)
            return html[start:end]
    return None


def _resolve_section_id(h4_title: str, subsection_map: dict[str, str]) -> str | None:
    """Case-insensitive and prefix-tolerant h4 → section id lookup."""
    lower = h4_title.lower().strip()
    for k, v in subsection_map.items():
        if k.lower() == lower:
            return v
    # Prefix match: "Augments and Set Changes" → "Augments"
    for k, v in subsection_map.items():
        if lower.startswith(k.lower()):
            return v
    # Keyword fallback
    if "champion" in lower:
        return subsection_map.get("Champions")
    if "augment" in lower:
        return subsection_map.get("Augments")
    if "system" in lower or "general" in lower:
        return subsection_map.get("Systems")
    return None


def _extract_subject_ul_pairs(body: str) -> list[tuple[str, str]]:
    """Return (subject_text, ul_html) pairs from an h4 section body.

    Handles two HTML formats used by the official patch notes:
    - Modern: <p><strong>Subject</strong></p>\\n<ul>...</ul>
    - Legacy: <strong>Subject</strong>\\n<ul>...</ul>  (no <p> wrapper)
    """
    # Modern format: <p><strong>Subject</strong></p> immediately before <ul>
    modern_re = re.compile(
        r"<p[^>]*>\s*<strong[^>]*>(.*?)</strong>\s*</p>\s*(<ul[^>]*>.*?</ul>)",
        re.DOTALL,
    )
    pairs = [(strip_tags(m.group(1)), m.group(2)) for m in modern_re.finditer(body)]
    if pairs:
        return pairs

    # Legacy format: look backwards from each <ul> to find the subject <strong>.
    # The subject <strong> is NOT inside a <li> (no </li> between it and the <ul>).
    for ul_m in _UL_RE.finditer(body):
        preceding = body[:ul_m.start()]
        # Walk all <strong> elements in preceding text; keep the last one with
        # no </li> between it and the <ul> start.
        subject_m = None
        for sm in _STRONG_RE.finditer(preceding):
            tail = preceding[sm.end():]
            if "</li>" not in tail:
                subject_m = sm
        if subject_m:
            subject = strip_tags(subject_m.group(1))
            if subject:
                pairs.append((subject, ul_m.group(0)))
    return pairs


def _parse_section_html(
    section_html: str,
    subsection_map: dict[str, str],
    *,
    locale_mode: bool = False,
) -> list[dict]:
    """Parse h4-delimited sub-sections into change lists.

    locale_mode=True: skip the subsection_map filter and return ALL h4 blocks in
    order. Used for non-English pages where h4 titles are translated — the caller
    (stitch_locales) matches locale sections to EN sections positionally.
    """
    sections: list[dict] = []
    for h4_m in _H4_BLOCK_RE.finditer(section_html):
        h4_title = strip_tags(h4_m.group(1))
        if locale_mode:
            section_id = h4_title  # placeholder; positional stitching ignores it
        else:
            section_id = _resolve_section_id(h4_title, subsection_map)
            if not section_id:
                continue
        body = h4_m.group(2)
        changes: list[dict] = []
        for subject, ul_html in _extract_subject_ul_pairs(body):
            for li in _LI_RE.finditer(ul_html):
                raw = strip_tags(li.group(1))
                text = re.sub(r"\s*⇒\s*", " ⇒ ", raw)
                text = re.sub(r"\s+:", ":", text).strip()
                if not text:
                    continue
                ch: dict = {"subject": subject, "text": text}
                if not locale_mode and section_id == "champions":
                    ch["subjectSlug"] = re.sub(r"[^a-z0-9-]", "", subject.lower().replace(" ", "-"))
                changes.append(ch)
        if changes:
            sections.append({"id": section_id, "title": h4_title, "changes": changes})
    return sections


def parse_patch_page(html: str, en_path: str, *, locale_mode: bool = False) -> dict:
    """Parse one full patch page into our intermediate patch dict.

    locale_mode=True for non-English pages: all h4 sub-sections are returned in
    order without canonical-ID filtering so stitch_locales can match them
    positionally to the EN structure.
    """
    vm = _PATCH_VER_RE.search(en_path)
    version = f"{vm.group(1)}.{vm.group(2)}" if vm else "unknown"

    tm = _TIME_RE.search(html) or _META_DATE_RE.search(html)
    released = tm.group(1).strip() if tm else ""

    sections: list[dict] = []

    mayhem_html = _extract_h2_section(html, "ARAM: Mayhem")
    if mayhem_html:
        sections.extend(_parse_section_html(mayhem_html, MAYHEM_SUBSECTION_MAP, locale_mode=locale_mode))

    if not locale_mode:
        # Also capture generic ARAM section changes not already in Mayhem section.
        aram_html = _extract_h2_section(html, "ARAM")
        if aram_html:
            existing = {s["id"] for s in sections}
            aram_map = {k: v for k, v in MAYHEM_SUBSECTION_MAP.items() if v not in existing}
            for sec in _parse_section_html(aram_html, aram_map):
                sections.append(sec)

    return {"version": version, "title": f"Patch {version} Notes", "released": released, "sections": sections}


# ── Classification (cerebras-batch primary, regex fallback) ───────────────

ARROW = "⇒"
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")
_INVERTED_TERMS = re.compile(
    r"\b(cooldown|recharge|delay|cost|duration\s+to|seconds?\s+to)\b",
    re.IGNORECASE,
)
_NERF_HINTS = re.compile(r"\b(no longer|reduced)\b", re.IGNORECASE)
_BUFF_HINTS = re.compile(r"\b(now also|additional|increased)\b", re.IGNORECASE)


def classify_fallback(text: str) -> str:
    if ARROW not in text:
        if _NERF_HINTS.search(text):
            return "nerfed"
        if _BUFF_HINTS.search(text):
            return "buffed"
        return "changed"
    left, right = text.split(ARROW, 1)
    lnums = [float(x) for x in _NUM_RE.findall(left)]
    rnums = [float(x) for x in _NUM_RE.findall(right)]
    if not lnums or not rnums:
        return "changed"
    avg_l = sum(lnums) / len(lnums)
    avg_r = sum(rnums) / len(rnums)
    if avg_l == avg_r:
        return "changed"
    increased = avg_r > avg_l
    inverted = bool(_INVERTED_TERMS.search(text))
    if inverted:
        return "nerfed" if increased else "buffed"
    return "buffed" if increased else "nerfed"


CLASSIFIER_PROMPT_TEMPLATE = """You classify League of Legends ARAM Mayhem patch-note changes.

For each input row, output exactly one of: "buffed", "nerfed", "changed".
- "buffed"  = stronger (more damage, lower cooldown, more healing, etc).
- "nerfed"  = weaker (less damage, higher cooldown, restrictions added).
- "changed" = neutral / mixed / bug fix / rework where direction is unclear.

Return STRICT JSON ONLY. No prose, no fences. Schema:
{{"kinds": ["...", "..."]}}

The "kinds" array MUST have EXACTLY {n} entries — one per input row, same order.
Do NOT output extra entries. Do NOT skip rows.

Input ({n} rows):
{payload}
"""

CHUNK_SIZE = 20


def _classify_chunk(chunk: list[dict], llm_ask: Path, timeout: int) -> list[str] | None:
    payload = json.dumps(
        [{"subject": c.get("subject", ""), "text": c["text"]} for c in chunk],
        ensure_ascii=False,
    )
    prompt = CLASSIFIER_PROMPT_TEMPLATE.format(n=len(chunk), payload=payload)
    try:
        result = subprocess.run(
            [str(llm_ask), "cerebras-batch"],
            input=prompt, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        print(f"    cerebras-batch timed out on chunk of {len(chunk)}")
        return None
    if result.returncode != 0:
        print(f"    cerebras-batch rc={result.returncode}: {result.stderr.strip()[:160]}")
        return None
    raw = result.stdout.strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        obj_m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not obj_m:
            print(f"    cerebras-batch non-JSON: {raw[:160]}")
            return None
        try:
            parsed = json.loads(obj_m.group(0))
        except json.JSONDecodeError:
            return None
    kinds = parsed.get("kinds") if isinstance(parsed, dict) else None
    if not isinstance(kinds, list) or len(kinds) != len(chunk):
        got = len(kinds) if isinstance(kinds, list) else "n/a"
        print(f"    cerebras-batch length mismatch: got {got}, expected {len(chunk)}")
        return None
    valid = {"buffed", "nerfed", "changed"}
    return [k if k in valid else "changed" for k in kinds]


def classify_batch_via_llm(changes: list[dict], timeout: int = 60) -> list[str] | None:
    if not changes:
        return []
    llm_ask = Path.home() / "bin" / "llm-ask"
    if not llm_ask.exists():
        print("    cerebras-batch unavailable (~/bin/llm-ask missing)")
        return None
    out: list[str] = []
    for i in range(0, len(changes), CHUNK_SIZE):
        chunk = changes[i : i + CHUNK_SIZE]
        kinds = _classify_chunk(chunk, llm_ask, timeout)
        if kinds is None:
            time.sleep(2)
            kinds = _classify_chunk(chunk, llm_ask, timeout)
        if kinds is None:
            return None
        out.extend(kinds)
        time.sleep(0.4)
    return out


def classify_patch(patch: dict) -> None:
    flat = [ch for sec in patch["sections"] for ch in sec["changes"]]
    if not flat:
        return
    kinds = classify_batch_via_llm(flat)
    if kinds is None:
        kinds = [classify_fallback(c["text"]) for c in flat]
        source = "regex-fallback"
    else:
        source = "cerebras-batch"
    for ch, k in zip(flat, kinds):
        ch["kind"] = k
    print(f"    classified {len(flat)} changes via {source}")


# ── Locale stitching ──────────────────────────────────────────────────────

def stitch_locales(en_patches: list[dict], by_locale: dict[str, list[dict]]) -> list[dict]:
    """Positional stitch of locale text onto classified EN patches.

    If section/change counts mismatch for a locale on a given patch,
    that locale falls back to EN text for the whole patch.
    """
    en_by_version = {p["version"]: p for p in en_patches}
    locale_lookup: dict[str, dict[str, dict]] = {
        loc: {p["version"]: p for p in patches}
        for loc, patches in by_locale.items()
    }

    out: list[dict] = []
    for version, en_patch in en_by_version.items():
        merged_sections: list[dict] = []
        for sec_idx, sec in enumerate(en_patch["sections"]):
            merged_changes: list[dict] = []
            for ch_idx, ch in enumerate(sec["changes"]):
                texts = {"en": ch["text"]}
                subjects = {"en": ch.get("subject", "")}
                for loc, patches in locale_lookup.items():
                    p = patches.get(version)
                    if not p or sec_idx >= len(p["sections"]):
                        texts[loc] = ch["text"]
                        subjects[loc] = ch.get("subject", "")
                        continue
                    loc_sec = p["sections"][sec_idx]
                    if ch_idx >= len(loc_sec["changes"]):
                        texts[loc] = ch["text"]
                        subjects[loc] = ch.get("subject", "")
                        continue
                    loc_ch = loc_sec["changes"][ch_idx]
                    texts[loc] = loc_ch["text"]
                    subjects[loc] = loc_ch.get("subject", "") or ch.get("subject", "")
                merged: dict = {
                    "subject": subjects,
                    "text": texts,
                    "kind": ch["kind"],
                }
                if "subjectSlug" in ch:
                    merged["subjectSlug"] = ch["subjectSlug"]
                merged_changes.append(merged)
            merged_sections.append({"id": sec["id"], "title": sec["title"], "changes": merged_changes})
        out.append({
            "version": en_patch["version"],
            "title": en_patch["title"],
            "released": en_patch["released"],
            "sections": merged_sections,
        })
    return out


# ── Augment-name enrichment ───────────────────────────────────────────────

_AUGMENT_LOCALE_FIELDS = {
    "zh-tw": "name_zh_TW",
    "zh-cn": "name_zh_CN",
    "ja-jp": "name_ja",
    "ko-kr": "name_ko",
}


def _load_augment_name_map() -> dict[str, dict[str, str]]:
    path = OUT_DIR / "augments.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    augments = raw["augments"] if isinstance(raw, dict) and "augments" in raw else raw
    out: dict[str, dict[str, str]] = {}
    for a in augments:
        en = a.get("name")
        if not en:
            continue
        translations = {
            loc: a[field]
            for loc, field in _AUGMENT_LOCALE_FIELDS.items()
            if a.get(field)
        }
        if translations:
            out[en] = translations
    return out


def enrich_augment_subjects(merged_patches: list[dict]) -> int:
    name_map = _load_augment_name_map()
    if not name_map:
        return 0
    hits = 0
    for patch in merged_patches:
        for sec in patch["sections"]:
            if sec["id"] != "augments":
                continue
            for ch in sec["changes"]:
                en_subject = ch["subject"].get("en", "").strip()
                if not en_subject:
                    continue
                translations = name_map.get(en_subject)
                if not translations:
                    continue
                for loc, name in translations.items():
                    ch["subject"][loc] = name
                    hits += 1
    return hits


# ── Write recentChanges back to augments.json ─────────────────────────────

def update_augment_recent_changes(merged_patches: list[dict]) -> None:
    """For the latest patch, write recentChanges into augments.json.

    Gives augment detail pages same-day accuracy for stat changes even
    when wikiDescription hasn't been updated by the wiki editors yet.
    """
    if not merged_patches:
        return
    latest = merged_patches[0]
    aug_changes = next(
        (sec["changes"] for sec in latest["sections"] if sec["id"] == "augments"),
        [],
    )
    if not aug_changes:
        return

    aug_path = OUT_DIR / "augments.json"
    if not aug_path.exists():
        return

    data = json.loads(aug_path.read_text("utf-8"))
    augments: list[dict] = data.get("augments", [])
    by_name = {a["name"].lower().strip(): a for a in augments}

    applied = 0
    missing: list[str] = []
    for change in aug_changes:
        en_subject = change["subject"].get("en", "").strip()
        if not en_subject:
            continue
        aug = by_name.get(en_subject.lower())
        en_text = change["text"].get("en", "") if isinstance(change["text"], dict) else change["text"]
        if aug is not None:
            existing = aug.get("recentChanges", {})
            # Accumulate multiple changes in the same patch, avoid duplicates.
            if existing.get("patch") == latest["version"]:
                if en_text not in existing["changes"]:
                    existing["changes"].append(en_text)
            else:
                aug["recentChanges"] = {"patch": latest["version"], "changes": [en_text]}
            applied += 1
        else:
            missing.append(en_subject)

    if missing:
        print(f"  recentChanges: {len(missing)} augments not in augments.json (may be new): {missing[:5]}")
    if applied > 0:
        aug_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  Updated recentChanges for {applied} augments in augments.json")


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Discovering patch note URLs from {BASE_URL}{NEWS_PATH} ...")

    en_paths = discover_patch_paths(SCRAPE_N_PATCHES)
    if not en_paths:
        raise SystemExit("No patch note URLs found — aborting.")
    print(f"  Found {len(en_paths)} patches: {[p.split('/')[-1] for p in en_paths]}")

    # Fetch and parse EN pages
    print("\nFetching and parsing EN patch pages...")
    en_patches: list[dict] = []
    for i, path in enumerate(en_paths):
        if i > 0:
            time.sleep(0.8)
        try:
            html = fetch(path)
        except (URLError, OSError) as e:
            print(f"  {path}: skipped ({e})")
            continue
        patch = parse_patch_page(html, path)
        total = sum(len(s["changes"]) for s in patch["sections"])
        print(f"  {patch['version']}: {len(patch['sections'])} sections, {total} changes")
        if not patch["sections"]:
            print(f"    WARNING: no ARAM: Mayhem content found — check h2 selector")
        en_patches.append(patch)

    if not en_patches:
        raise SystemExit("No EN patches parsed — aborting.")

    # Classify
    print("\nClassifying changes (cerebras-batch primary)...")
    for patch in en_patches:
        print(f"  Patch {patch['version']}:")
        classify_patch(patch)

    # Fetch locale pages
    print("\nFetching locale pages...")
    by_locale: dict[str, list[dict]] = {}
    for loc_key in LOCALE_PREFIXES:
        loc_patches: list[dict] = []
        for i, en_path in enumerate(en_paths):
            if i > 0:
                time.sleep(0.6)
            lpath = locale_path(en_path, loc_key)
            try:
                html = fetch(lpath)
            except (URLError, OSError) as e:
                print(f"  {loc_key} {en_path}: skipped ({e})")
                continue
            loc_patches.append(parse_patch_page(html, en_path, locale_mode=True))
        by_locale[loc_key] = loc_patches
        print(f"  {loc_key}: {len(loc_patches)} patches")

    # Stitch locales
    print("\nStitching locales...")
    merged = stitch_locales(en_patches, by_locale)

    # Enrich augment subject names from augments.json
    print("\nEnriching augment subject names from augments.json...")
    enriched = enrich_augment_subjects(merged)
    print(f"  augment subject translations applied: {enriched}")

    # Write recentChanges back to augments.json
    print("\nUpdating augments.json recentChanges...")
    update_augment_recent_changes(merged)

    current_patch = merged[0]["version"] if merged else None
    out = {
        "patch": current_patch,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "source": BASE_URL + NEWS_PATH,
        "patches": merged,
    }

    out_path = OUT_DIR / "patch-notes.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    total_changes = sum(len(s["changes"]) for p in merged for s in p["sections"])
    print(f"\nDone. Wrote {out_path}")
    print(f"  patches:       {len(merged)}")
    print(f"  total changes: {total_changes}")
    print(f"  current patch: {current_patch}")


if __name__ == "__main__":
    main()
