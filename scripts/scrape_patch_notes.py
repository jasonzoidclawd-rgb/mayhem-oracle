"""
Mayhem Oracle — Patch Notes Scraper
====================================
Fetches /patch-notes for en/zh-cn/ja-jp/ko-kr from arammayhem.com,
parses patch cards into structured changes, and classifies each
change as buffed/nerfed/changed via local LiteLLM cerebras-batch
(falls back to arrow-direction heuristic if proxy unreachable).

Usage:
    python3 scripts/scrape_patch_notes.py

Output:
    public/data/patch-notes.json
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

BASE_URL = "https://arammayhem.com"
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

LOCALES = [
    ("en", "/patch-notes"),
    ("zh-cn", "/zh-cn/patch-notes"),
    ("ja-jp", "/ja-jp/patch-notes"),
    ("ko-kr", "/ko-kr/patch-notes"),
]

# Stable section h3 text → canonical id used in JSON output
SECTION_MAP_EN = {
    "Highlights": "highlights",
    "General Changes": "general",
    "New Items": "new_items",
    "Augment Changes": "augments",
    "Champion Balance Changes": "champions",
    "Bug Fixes": "bugfixes",
}


# ── HTML helpers ───────────────────────────────────────────────────────────

def fetch(path: str) -> str:
    url = BASE_URL + path
    print(f"  Fetching {url} ...")
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def strip_tags(s: str) -> str:
    return _WS_RE.sub(" ", html_module.unescape(_TAG_RE.sub(" ", s))).strip()


# ── Parser ────────────────────────────────────────────────────────────────

# Patch card boundary: <div data-slot="card" ...> ... (next data-slot="card" or end)
_CARD_RE = re.compile(
    r'<div data-slot="card"[^>]*>.*?(?=<div data-slot="card"|</main>)',
    re.DOTALL,
)
_TITLE_RE = re.compile(
    r'data-slot="card-title"[^>]*>\s*(.*?)\s*</div>',
    re.DOTALL,
)
_DATE_RE = re.compile(
    r'data-slot="card-description"[^>]*>\s*(.*?)\s*</div>',
    re.DOTALL,
)
_PATCH_VERSION_RE = re.compile(r"(\d+\.\d+[a-z]?)")


def parse_patches(html: str, locale: str) -> list[dict]:
    """Parse all patch cards from a /patch-notes page."""
    patches: list[dict] = []
    for card_match in _CARD_RE.finditer(html):
        card = card_match.group(0)
        title_m = _TITLE_RE.search(card)
        if not title_m:
            continue
        title = strip_tags(title_m.group(1))
        version_m = _PATCH_VERSION_RE.search(title)
        if not version_m:
            continue
        version = version_m.group(1)

        date_m = _DATE_RE.search(card)
        released = strip_tags(date_m.group(1)) if date_m else ""

        # Sections live in card-content. Split on h3.
        content_m = re.search(
            r'data-slot="card-content"[^>]*>(.*?)(?=</div>\s*</div>\s*</div>\s*$|<div data-slot="card")',
            card,
            re.DOTALL,
        )
        content = content_m.group(1) if content_m else card

        sections = parse_sections(content)
        patches.append({
            "version": version,
            "title": title,
            "released": released,
            "sections": sections,
        })
    return patches


_SECTION_RE = re.compile(
    r'<h3[^>]*text-primary[^>]*>(.*?)</h3>(.*?)(?=<h3[^>]*text-primary|$)',
    re.DOTALL,
)


def parse_sections(content_html: str) -> list[dict]:
    out: list[dict] = []
    for m in _SECTION_RE.finditer(content_html):
        section_title = strip_tags(m.group(1))
        body = m.group(2)
        section_id = SECTION_MAP_EN.get(section_title)
        if not section_id:
            # Locale: section_title is non-English; keyed by position later
            section_id = section_title
        changes = parse_changes(body)
        if not changes:
            continue
        out.append({
            "id": section_id,
            "title": section_title,
            "changes": changes,
        })
    return out


# Subject anchor: either <h4>...</h4> (general/augment) or <a href="/champions/...">name</a>
_SUBJECT_H4_RE = re.compile(
    r'<h4[^>]*>(.*?)</h4>(.*?)(?=<h4[^>]*>|$)',
    re.DOTALL,
)
_CHAMPION_BLOCK_RE = re.compile(
    r'<a[^>]*href="(?:/[a-z-]+)?/champions/([^"]+)"[^>]*>(.*?)</a>(.*?)(?=<a[^>]*href="(?:/[a-z-]+)?/champions/|$)',
    re.DOTALL,
)
_LI_RE = re.compile(r'<li[^>]*>(.*?)</li>', re.DOTALL)
_BADGE_RE = re.compile(r'data-slot="badge"[^>]*>(.*?)</span>', re.DOTALL)
_BADGE_STRIP = re.compile(r'<span[^>]*data-slot="badge"[^>]*>.*?</span>', re.DOTALL)


def parse_changes(body_html: str) -> list[dict]:
    """Extract flat list of changes from a section body."""
    # Champion balance section uses <a href="/champions/..."> as subject anchor
    if 'href="/champions/' in body_html or '/champions/' in body_html:
        return _parse_champion_changes(body_html)
    # Other sections: h4 subjects, then flat list
    h4s = list(_SUBJECT_H4_RE.finditer(body_html))
    if h4s:
        return _parse_h4_subjects(h4s)
    # No h4 subjects → flat list of <li> bullets (Highlights / Bug Fixes)
    return _parse_flat_bullets(body_html)


def _parse_flat_bullets(body_html: str) -> list[dict]:
    changes = []
    for li in _LI_RE.findall(body_html):
        text = strip_tags(li)
        if text:
            changes.append({"subject": "", "text": text})
    return changes


def _parse_h4_subjects(h4_matches) -> list[dict]:
    changes = []
    for m in h4_matches:
        subject = strip_tags(m.group(1))
        bullets = _LI_RE.findall(m.group(2))
        if not bullets:
            # No bullets — emit subject-only entry with whatever inline text remains
            text = strip_tags(m.group(2))
            if text:
                changes.append({"subject": subject, "text": text})
            continue
        for li in bullets:
            text = strip_tags(li)
            if text:
                changes.append({"subject": subject, "text": text})
    return changes


def _parse_champion_changes(body_html: str) -> list[dict]:
    changes = []
    for m in _CHAMPION_BLOCK_RE.finditer(body_html):
        slug = m.group(1)
        champ_name = strip_tags(m.group(2))
        block = m.group(3)
        bullets = _LI_RE.findall(block)
        for li in bullets:
            badge_m = _BADGE_RE.search(li)
            badge = strip_tags(badge_m.group(1)) if badge_m else ""
            rest = _BADGE_STRIP.sub("", li)
            text = strip_tags(rest)
            label = f"{badge}: {text}" if badge else text
            if label:
                changes.append({
                    "subject": champ_name,
                    "subjectSlug": slug,
                    "text": label,
                })
    return changes


# ── Classification (cerebras-batch primary, regex fallback) ───────────────

ARROW = "⇒"
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")
_INVERTED_TERMS = re.compile(
    r"\b(cooldown|recharge|delay|cost|duration\s+to|seconds?\s+to)\b",
    re.IGNORECASE,
)
_NERF_HINTS = re.compile(r"\b(no longer|removed|reduced)\b", re.IGNORECASE)
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
    # Cooldown/cost ↑ = nerf; otherwise ↑ = buff
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
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
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
        print(f"    cerebras-batch length mismatch on chunk: got {got}, expected {len(chunk)}")
        return None
    valid = {"buffed", "nerfed", "changed"}
    return [k if k in valid else "changed" for k in kinds]


def classify_batch_via_llm(changes: list[dict], timeout: int = 60) -> list[str] | None:
    """Call ~/bin/llm-ask cerebras-batch in chunks. Returns None if any chunk fails."""
    if not changes:
        return []
    llm_ask = Path.home() / "bin" / "llm-ask"
    if not llm_ask.exists():
        print("    cerebras-batch unavailable (~/bin/llm-ask missing)")
        return None
    out: list[str] = []
    for i in range(0, len(changes), CHUNK_SIZE):
        chunk = changes[i:i + CHUNK_SIZE]
        kinds = _classify_chunk(chunk, llm_ask, timeout)
        if kinds is None:
            # One retry after a short backoff (Cerebras free tier is bursty).
            time.sleep(2)
            kinds = _classify_chunk(chunk, llm_ask, timeout)
        if kinds is None:
            return None
        out.extend(kinds)
        time.sleep(0.4)
    return out


def classify_patch(patch: dict) -> None:
    """Mutate patch in place: add `kind` to each change."""
    flat: list[dict] = []
    for sec in patch["sections"]:
        for ch in sec["changes"]:
            flat.append(ch)
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
    """For each EN patch, attach localized text per change.

    Positional stitching with parity check. If section/change counts mismatch
    for a locale, fall back to EN text for that locale on that patch.
    """
    en_by_version = {p["version"]: p for p in en_patches}
    locale_lookup: dict[str, dict[str, dict]] = {
        loc: {p["version"]: p for p in patches}
        for loc, patches in by_locale.items()
    }

    out_patches = []
    for version, en_patch in en_by_version.items():
        merged_sections = []
        for sec_idx, sec in enumerate(en_patch["sections"]):
            merged_changes = []
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
                merged = {
                    "subject": subjects,
                    "text": texts,
                    "kind": ch["kind"],
                }
                if "subjectSlug" in ch:
                    merged["subjectSlug"] = ch["subjectSlug"]
                merged_changes.append(merged)
            merged_sections.append({
                "id": sec["id"],
                "title": sec["title"],
                "changes": merged_changes,
            })
        out_patches.append({
            "version": en_patch["version"],
            "title": en_patch["title"],
            "released": en_patch["released"],
            "sections": merged_sections,
        })
    return out_patches


# ── Augment-name enrichment ───────────────────────────────────────────────
# arammayhem.com leaves augment subjects in English on every locale page. We
# already scrape Chinese/Japanese/Korean augment names from CommunityDragon's
# cherry-augments.json into augments.json, so back-fill the missing locale
# subjects from there. Champions.json has no localized names, so champion
# balance subjects stay English (handled separately if/when we add them).

_AUGMENT_LOCALE_FIELDS = {
    "zh-tw": "name_zh_TW",
    "zh-cn": "name_zh_CN",
    "ja-jp": "name_ja",
    "ko-kr": "name_ko",
}


def _load_augment_name_map() -> dict[str, dict[str, str]]:
    """english augment name → {zh-tw, zh-cn, ja-jp, ko-kr} (only present locales)."""
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
    """For every change in 'augments' sections, look up its English subject in
    augments.json and write the localized name into the per-locale subject map.
    Adds a 'zh-tw' key whenever a translation exists. Returns count of subjects
    enriched (across locales, summed)."""
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


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Scraping arammayhem.com patch notes...")

    by_locale: dict[str, list[dict]] = {}
    for i, (loc, path) in enumerate(LOCALES):
        if i > 0:
            time.sleep(0.8)
        try:
            html = fetch(path)
        except (URLError, OSError) as e:
            print(f"  {loc}: skipped ({e})")
            continue
        patches = parse_patches(html, loc)
        print(f"  {loc}: {len(patches)} patches")
        by_locale[loc] = patches

    en_patches = by_locale.pop("en", [])
    if not en_patches:
        raise SystemExit("No EN patches parsed — aborting.")

    print("\nClassifying changes (cerebras-batch primary)...")
    for patch in en_patches:
        print(f"  Patch {patch['version']}:")
        classify_patch(patch)

    print("\nStitching locales...")
    merged = stitch_locales(en_patches, by_locale)

    print("\nEnriching augment subject names from augments.json...")
    enriched = enrich_augment_subjects(merged)
    print(f"  augment subject translations applied: {enriched}")

    current_patch = merged[0]["version"] if merged else None
    scraped_at = datetime.now(timezone.utc).isoformat()
    out = {
        "patch": current_patch,
        "scraped_at": scraped_at,
        "source": BASE_URL,
        "patches": merged,
    }

    out_path = OUT_DIR / "patch-notes.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    total_changes = sum(len(s["changes"]) for p in merged for s in p["sections"])
    print(f"\nDone. Wrote {out_path}")
    print(f"  patches:        {len(merged)}")
    print(f"  total changes:  {total_changes}")
    print(f"  current patch:  {current_patch}")


if __name__ == "__main__":
    main()
