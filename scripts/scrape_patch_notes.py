"""
Mayhem Oracle — Patch Notes Scraper
====================================
Fetches ARAM: Mayhem patch notes from the official League of Legends site
(https://www.leagueoflegends.com) for en/zh-tw/ja-jp/ko-kr locales.

Significantly more timely than wiki-sourced data — the official page is
published on patch day, while the wiki can lag by several days.

After scraping, also writes recentChanges to data/internal/augments.json
so augment detail pages reflect same-day stat updates even if
wikiDescription hasn't caught up yet.

Usage:
    python3 scripts/scrape_patch_notes.py

Output:
    data/internal/patch-notes.json   – structured change feed
    data/internal/augments.json      – recentChanges field updated in-place
"""

from __future__ import annotations
import html as html_module
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

from data_paths import INTERNAL_DATA_DIR

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
OUT_DIR = INTERNAL_DATA_DIR

# Our locale keys → LoL site URL locale prefixes.
# zh-cn: global site redirects to a 404; use zh-tw content under zh-cn key
# for backward-compatibility with existing patch-notes.json consumers.
LOCALE_PREFIXES: dict[str, str] = {
    "zh-tw": "zh-tw",
    "zh-cn": "zh-tw",
    "ja-jp": "ja-jp",
    "ko-kr": "ko-kr",
}

# h4 sub-section headings inside ARAM: Mayhem -> canonical section ids.
MAYHEM_SUBSECTION_MAP: dict[str, str] = {
    "Champions": "champions",
    "Augments":  "augments",
    "Systems":   "general",
    "Items":     "new_items",
    "Bugfixes":  "bugfixes",
}

# h2 article sections that can affect Mayhem Oracle surfaces. These are
# parsed from the official Riot article in addition to the mode-specific
# ARAM: Mayhem section.
ARTICLE_SECTION_MAP: dict[str, str] = {
    "Champions": "champions",
    "Items": "new_items",
    "ARAM: Mayhem": "augments",
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
_TIME_RE = re.compile(r'<time[^>]+date(?:T|t)ime="([^"]+)"')
_TITLE_RE = re.compile(r'<h1[^>]*data-testid="title"[^>]*>(.*?)</h1>', re.DOTALL)
_AUTHORS_RE = re.compile(r'<div class="authors">\s*<span>(.*?)</span>', re.DOTALL)
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


def normalize_key(s: str) -> str:
    """Stable name matching key for Riot text -> local catalog entities."""
    return re.sub(r"[^a-z0-9]+", "", html_module.unescape(s).lower())


def slugify(s: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def source_url(path_or_url: str) -> str:
    return path_or_url if path_or_url.startswith("http") else BASE_URL + path_or_url


def extract_article_metadata(html: str, en_path: str) -> dict:
    title_m = _TITLE_RE.search(html)
    time_m = _TIME_RE.search(html) or _META_DATE_RE.search(html)
    authors_m = _AUTHORS_RE.search(html)
    intro = ""
    intro_m = re.search(r'<blockquote[^>]*class="[^"]*context[^"]*"[^>]*>(.*?)</blockquote>', html, re.DOTALL)
    if intro_m:
        intro = strip_tags(intro_m.group(1))
    return {
        "sourceUrl": source_url(en_path),
        "articleTitle": strip_tags(title_m.group(1)) if title_m else "",
        "publishedAt": time_m.group(1).strip() if time_m else "",
        "authors": [
            a.strip()
            for a in re.split(r",\s*", strip_tags(authors_m.group(1)) if authors_m else "")
            if a.strip()
        ],
        "intro": intro,
    }


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


def _extract_context(block_html: str) -> str:
    m = re.search(r'<blockquote[^>]*class="[^"]*context[^"]*"[^>]*>(.*?)</blockquote>', block_html, re.DOTALL)
    return strip_tags(m.group(1)) if m else ""


def _li_texts(html: str) -> list[str]:
    out: list[str] = []
    for li in _LI_RE.finditer(html):
        raw = strip_tags(li.group(1))
        text = re.sub(r"\s*⇒\s*", " ⇒ ", raw)
        text = re.sub(r"\s+:", ":", text).strip()
        if text:
            out.append(text)
    return out


def _parse_h2_entity_section(section_html: str, section_id: str, title: str) -> list[dict]:
    """Parse Riot h2 sections whose direct subjects are h3 blocks."""
    changes: list[dict] = []
    h3s = list(re.finditer(r"<h3[^>]*>(.*?)</h3>", section_html, re.DOTALL))
    for idx, h3_m in enumerate(h3s):
        subject = strip_tags(h3_m.group(1))
        if not subject:
            continue
        start = h3_m.end()
        end = h3s[idx + 1].start() if idx + 1 < len(h3s) else len(section_html)
        block = section_html[start:end]
        context = _extract_context(block)

        h4s = list(_H4_BLOCK_RE.finditer(block))
        if h4s:
            for h4_m in h4s:
                detail = strip_tags(h4_m.group(1))
                for text in _li_texts(h4_m.group(2)):
                    ch: dict = {"subject": subject, "text": text}
                    if context:
                        ch["context"] = context
                    if detail:
                        ch["detail"] = detail
                    if section_id == "champions":
                        ch["subjectSlug"] = slugify(subject)
                    changes.append(ch)
        else:
            for text in _li_texts(block):
                ch = {"subject": subject, "text": text}
                if context:
                    ch["context"] = context
                changes.append(ch)

    return [{"id": section_id, "title": title, "changes": changes}] if changes else []


def _parse_new_champion_section(section_html: str, title: str) -> list[dict]:
    """Parse a new-champion article section like 26.13 Locke."""
    changes: list[dict] = []
    context = _extract_context(section_html)
    for h4_m in _H4_BLOCK_RE.finditer(section_html):
        detail = strip_tags(h4_m.group(1))
        for text in _li_texts(h4_m.group(2)):
            ch: dict = {
                "subject": title,
                "text": text,
                "detail": detail,
                "kind": "changed",
                "sourceType": "new_champion_preview",
                "subjectSlug": slugify(title),
            }
            if context:
                ch["context"] = context
            changes.append(ch)
    return [{"id": "champions", "title": "Champions", "changes": changes}] if changes else []


def _parse_mayhem_section(section_html: str) -> list[dict]:
    sections: list[dict] = []
    for h4_m in _H4_BLOCK_RE.finditer(section_html):
        h4_title = strip_tags(h4_m.group(1))
        section_id = _resolve_section_id(h4_title, MAYHEM_SUBSECTION_MAP)
        if not section_id:
            continue
        body = h4_m.group(2)
        changes: list[dict] = []
        pairs = _extract_subject_ul_pairs(body)
        if pairs:
            for subject, ul_html in pairs:
                for text in _li_texts(ul_html):
                    changes.append({"subject": subject, "text": text})
        else:
            for text in _li_texts(body):
                changes.append({"subject": "" if section_id == "bugfixes" else h4_title, "text": text})
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

    metadata = extract_article_metadata(html, en_path)
    released = metadata["publishedAt"][:10] if metadata.get("publishedAt") else ""
    sections: list[dict] = []

    if locale_mode:
        mayhem_html = _extract_h2_section(html, "ARAM: Mayhem")
        if mayhem_html:
            sections.extend(_parse_section_html(mayhem_html, MAYHEM_SUBSECTION_MAP, locale_mode=True))
        return {"version": version, "title": f"Patch {version} Notes", "released": released, "sections": sections}

    h2s = list(_ALL_H2_RE.finditer(html))
    for i, h2_m in enumerate(h2s):
        title = strip_tags(h2_m.group(1))
        start = h2_m.end()
        end = h2s[i + 1].start() if i + 1 < len(h2s) else len(html)
        section_html = html[start:end]
        if title == "ARAM: Mayhem":
            sections.extend(_parse_mayhem_section(section_html))
        elif title in {"Champions", "Items"}:
            section_id = ARTICLE_SECTION_MAP[title]
            sections.extend(_parse_h2_entity_section(section_html, section_id, title))
        elif title not in ARTICLE_SECTION_MAP and _H4_BLOCK_RE.search(section_html):
            # New champion releases are article h2 blocks with ability h4s rather
            # than entries in the Champions h2 section. Keep them as unknown
            # champion targets until the champion catalog catches up.
            if "champion spotlight" in section_html.lower():
                sections.extend(_parse_new_champion_section(section_html, title))

    return {
        "version": version,
        "title": metadata.get("articleTitle") or f"Patch {version} Notes",
        "released": released,
        "sourceUrl": metadata["sourceUrl"],
        "publishedAt": metadata.get("publishedAt", ""),
        "authors": metadata.get("authors", []),
        "intro": metadata.get("intro", ""),
        "sections": sections,
    }


# ── Deterministic classification ──────────────────────────────────────────

ARROW = "⇒"
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")
_INVERTED_TERMS = re.compile(
    r"\b(cooldown|recharge|delay|cost|duration\s+to|seconds?\s+to)\b",
    re.IGNORECASE,
)
_NERF_HINTS = re.compile(r"\b(no longer|reduced)\b", re.IGNORECASE)
_BUFF_HINTS = re.compile(r"\b(now also|additional|increased)\b", re.IGNORECASE)

LABEL_KEYWORDS: list[tuple[str, re.Pattern[str]]] = [
    ("damage", re.compile(r"\bdamage|dmg|lethality|penetration|crit|critical|on-hit\b", re.I)),
    ("cooldown", re.compile(r"\bcooldown|recharge|haste\b", re.I)),
    ("mana", re.compile(r"\bmana|energy|cost\b", re.I)),
    ("health", re.compile(r"\bhealth|hp|durability\b", re.I)),
    ("shield", re.compile(r"\bshield\b", re.I)),
    ("healing", re.compile(r"\bheal(?:ing|s|ed)?\b|life steal|omnivamp|\bvamp\b", re.I)),
    ("movement", re.compile(r"\bmove speed|movement|dash|blink|teleport|slow\b", re.I)),
    ("range", re.compile(r"\brange|area of effect|aoe|radius|size\b", re.I)),
    ("attack_speed", re.compile(r"\battack speed\b", re.I)),
    ("ability_power", re.compile(r"\bability power|\bAP\b", re.I)),
    ("attack_damage", re.compile(r"\battack damage|\bAD\b|total ad|bonus ad\b", re.I)),
    ("armor_magic_resist", re.compile(r"\barmor|magic resist|mr\b", re.I)),
    ("economy", re.compile(r"\bgold|coin|shop|itemization\b", re.I)),
    ("rarity", re.compile(r"\btier|prismatic|gold|silver\b", re.I)),
    ("restriction", re.compile(r"\brestriction|restricted|no longer|removed|disabled\b", re.I)),
    ("offering_pool", re.compile(r"\boffer|offered|augment pool|pool\b", re.I)),
    ("bugfix", re.compile(r"\bbug|fixed|issue|incorrectly|prevented\b", re.I)),
]

RIOT_NAME_ALIASES: dict[str, str] = {
    "youchmycoins": "yowchmycoins",
}

DAMAGE_LABELS = {
    "damage",
    "cooldown",
    "shield",
    "healing",
    "attack_speed",
    "ability_power",
    "attack_damage",
    "armor_magic_resist",
    "range",
}


def canonical_text(change: dict) -> str:
    text = change.get("text", "")
    if isinstance(text, dict):
        return text.get("en", "")
    return str(text)


def canonical_subject(change: dict) -> str:
    subject = change.get("subject", "")
    if isinstance(subject, dict):
        return subject.get("en", "")
    return str(subject)


def wrap_locale_fields(patches: list[dict]) -> list[dict]:
    for patch in patches:
        for section in patch.get("sections", []):
            for change in section.get("changes", []):
                if not isinstance(change.get("subject"), dict):
                    change["subject"] = {"en": change.get("subject", "")}
                if not isinstance(change.get("text"), dict):
                    change["text"] = {"en": change.get("text", "")}
    return patches


def _catalog_ref(entity_type: str, slug: str, name: str, href: str | None, known: bool, extra: dict | None = None) -> dict:
    ref = {
        "type": entity_type,
        "slug": slug,
        "name": name,
        "known": known,
    }
    if href:
        ref["href"] = href
    if extra:
        ref.update(extra)
    return ref


def _add_name(index: dict[str, dict], name: str | None, ref: dict) -> None:
    if not name:
        return
    key = normalize_key(name)
    if key and key not in index:
        index[key] = ref


def load_entity_catalogs() -> dict:
    indexes: dict[str, dict[str, dict]] = {"champion": {}, "item": {}, "augment": {}, "ability": {}}
    scan_refs: list[dict] = []

    champions_path = OUT_DIR / "champions.json"
    if champions_path.exists():
        champions = json.loads(champions_path.read_text(encoding="utf-8")).get("champions", [])
        for champ in champions:
            slug = champ.get("slug") or slugify(champ.get("name", ""))
            ref = _catalog_ref(
                "champion",
                slug,
                champ.get("name", slug),
                f"/champions/{slug}",
                True,
                {"roleTags": champ.get("tags", []), "kitTags": champ.get("kit_tags", [])},
            )
            for name in (champ.get("name"), champ.get("name_zh_TW"), champ.get("name_zh_CN"), champ.get("name_ja"), champ.get("name_ko")):
                _add_name(indexes["champion"], name, ref)
            scan_refs.append(ref)

    items_path = OUT_DIR / "items.json"
    if items_path.exists():
        items = json.loads(items_path.read_text(encoding="utf-8")).get("items", [])
        for item in items:
            ident = str(item.get("id")) if item.get("id") is not None else slugify(item.get("name", ""))
            ref = _catalog_ref(
                "item",
                ident,
                item.get("name", ident),
                f"/items/{ident}" if ident else None,
                True,
                {"categories": item.get("categories", [])},
            )
            for name in (item.get("name"), item.get("slug"), item.get("name_zh_TW"), item.get("name_zh_CN"), item.get("name_ja"), item.get("name_ko")):
                _add_name(indexes["item"], name, ref)
            scan_refs.append(ref)

    augments_path = OUT_DIR / "augments.json"
    if augments_path.exists():
        augments = json.loads(augments_path.read_text(encoding="utf-8")).get("augments", [])
        for aug in augments:
            slug = aug.get("slug") or slugify(aug.get("name", ""))
            availability = aug.get("availability", {}).get("status")
            lifecycle = aug.get("flags", {}).get("lifecycle")
            ref = _catalog_ref(
                "augment",
                slug,
                aug.get("name") or aug.get("displayName") or slug,
                f"/augments/{slug}",
                True,
                {
                    "rarity": aug.get("rarity"),
                    "availability": availability,
                    "lifecycle": lifecycle,
                    "offerable": availability == "confirmed_live" and lifecycle != "removed",
                },
            )
            names = aug.get("names", {}) if isinstance(aug.get("names"), dict) else {}
            for name in (
                aug.get("name"),
                aug.get("displayName"),
                aug.get("slug"),
                names.get("en"),
                names.get("zh_tw"),
                names.get("zh_cn"),
                names.get("ja"),
                names.get("ko"),
            ):
                _add_name(indexes["augment"], name, ref)
            scan_refs.append(ref)

    abilities_path = OUT_DIR / "abilities.json"
    if abilities_path.exists():
        profiles = json.loads(abilities_path.read_text(encoding="utf-8")).get("profiles", {})
        for champion_slug, profile in profiles.items():
            for ability in profile.get("abilities", []):
                key = ability.get("key", "")
                name = ability.get("name", "")
                if not name:
                    continue
                slug = f"{champion_slug}:{key}"
                ref = _catalog_ref(
                    "ability",
                    slug,
                    name,
                    f"/champions/{champion_slug}",
                    True,
                    {"championSlug": champion_slug, "abilityKey": key},
                )
                for loc_name in (name, ability.get("name_zh_TW"), ability.get("name_zh_CN"), ability.get("name_ja"), ability.get("name_ko")):
                    _add_name(indexes["ability"], loc_name, ref)
                scan_refs.append(ref)

    scan_refs.sort(key=lambda r: len(normalize_key(r["name"])), reverse=True)
    return {"indexes": indexes, "scanRefs": scan_refs}


def _unknown_ref(section_id: str, subject: str) -> dict:
    if section_id == "champions":
        entity_type = "champion"
        href = None
    elif section_id == "new_items":
        entity_type = "item"
        href = None
    elif section_id == "augments":
        entity_type = "augment"
        href = None
    else:
        entity_type = "system"
        href = None
    return _catalog_ref(entity_type, slugify(subject or section_id), subject or section_id, href, False)


def _primary_target(section_id: str, subject: str, catalogs: dict) -> dict | None:
    if not subject and section_id in {"general", "bugfixes"}:
        return _catalog_ref("system", section_id, section_id, None, True)
    index_key = {
        "champions": "champion",
        "new_items": "item",
        "augments": "augment",
    }.get(section_id)
    if not index_key:
        return _unknown_ref(section_id, subject)
    key = normalize_key(subject)
    alias_key = RIOT_NAME_ALIASES.get(key, key)
    return catalogs["indexes"][index_key].get(alias_key) or _unknown_ref(section_id, subject)


def _related_entities(change: dict, catalogs: dict, primary: dict | None) -> list[dict]:
    haystack = (str(change.get("context", "")) + " " + canonical_text(change)).lower()
    related: list[dict] = []
    seen = {primary.get("type", "") + ":" + primary.get("slug", "")} if primary else set()
    for ref in catalogs["scanRefs"]:
        if ref["type"] == "ability":
            continue
        key = normalize_key(ref["name"])
        ref_id = ref["type"] + ":" + ref["slug"]
        if len(key) < 6 or ref_id in seen:
            continue
        tokens = [re.escape(t) for t in re.findall(r"[a-z0-9]+", ref["name"].lower())]
        if not tokens:
            continue
        pattern = r"(?<![a-z0-9])" + r"[\W_]+".join(tokens) + r"(?![a-z0-9])"
        if re.search(pattern, haystack):
            related.append(ref)
            seen.add(ref_id)
        if len(related) >= 8:
            break
    return related


def parse_metrics(text: str) -> list[dict]:
    if ARROW not in text:
        return []
    left, right = text.split(ARROW, 1)
    label = ""
    before = left.strip()
    if ":" in left:
        label, before = [p.strip() for p in left.split(":", 1)]
    metric = {
        "label": label or "Value",
        "before": before,
        "after": right.strip(),
    }
    lnums = [float(x) for x in _NUM_RE.findall(before)]
    rnums = [float(x) for x in _NUM_RE.findall(right)]
    if lnums and rnums:
        delta = (sum(rnums) / len(rnums)) - (sum(lnums) / len(lnums))
        metric["numericDirection"] = "increase" if delta > 0 else "decrease" if delta < 0 else "flat"
    return [metric]


def label_change(change: dict) -> list[str]:
    text = str(change.get("context", "")) + " " + canonical_text(change)
    labels = [label for label, pattern in LABEL_KEYWORDS if pattern.search(text)]
    return labels or ["general"]


def impact_for(change: dict, labels: list[str], targets: list[dict]) -> dict:
    target_types = {target.get("type") for target in targets}
    engine_refs: list[str] = []
    if labels and DAMAGE_LABELS.intersection(labels):
        if "champion" in target_types or "ability" in target_types:
            engine_refs.extend([
                "src/lib/scoring/damage-context.ts:computeChampionBaseline",
                "src/lib/scoring/ability-augment-fit.ts:abilityAugmentFit",
            ])
        if "augment" in target_types:
            engine_refs.extend([
                "src/lib/decision/evaluate.ts:evaluateCandidate",
                "src/lib/scoring/damage-context.ts:computeAugmentDamageContext",
            ])
        if "item" in target_types:
            engine_refs.extend([
                "src/lib/data/championStats.ts:stackItemStats",
                "src/lib/decision/evaluate.ts:itemValue",
            ])
    return {
        "damageRelevant": bool(engine_refs),
        "modelSignals": sorted(set(labels).intersection(DAMAGE_LABELS)),
        "engineRefs": list(dict.fromkeys(engine_refs)),
    }


def enrich_patch_entities(patches: list[dict], catalogs: dict) -> None:
    for patch in patches:
        counts: dict[str, int] = {}
        labels_count: dict[str, int] = {}
        for section in patch.get("sections", []):
            section_id = section.get("id", "")
            for change in section.get("changes", []):
                subject = canonical_subject(change)
                primary = _primary_target(section_id, subject, catalogs)
                targets = [primary] if primary else []

                # Ability detail inside a champion block links the concrete ability
                # when the local ability profile has the same name/key.
                if section_id == "champions" and primary and primary.get("known") and change.get("detail"):
                    detail_key = normalize_key(re.sub(r"^[QWERP]\s*-\s*", "", str(change["detail"]), flags=re.I))
                    for ref in catalogs["indexes"]["ability"].values():
                        if ref.get("championSlug") == primary["slug"] and normalize_key(ref["name"]) in detail_key:
                            targets.append(ref)
                            break

                related = _related_entities(change, catalogs, primary)
                metrics = parse_metrics(canonical_text(change))
                labels = label_change(change)
                change["targets"] = targets
                change["relatedEntities"] = related
                change["metrics"] = metrics
                change["labels"] = labels
                change["impact"] = impact_for(change, labels, targets)
                for target in targets:
                    counts[target["type"]] = counts.get(target["type"], 0) + 1
                for label in labels:
                    labels_count[label] = labels_count.get(label, 0) + 1
        flat = [ch for sec in patch.get("sections", []) for ch in sec.get("changes", [])]
        by_kind: dict[str, int] = {}
        for ch in flat:
            by_kind[ch.get("kind", "changed")] = by_kind.get(ch.get("kind", "changed"), 0) + 1
        patch["summary"] = {
            "totalChanges": len(flat),
            "byKind": dict(sorted(by_kind.items())),
            "byEntityType": dict(sorted(counts.items())),
            "byLabel": dict(sorted(labels_count.items())),
            "damageRelevant": sum(1 for ch in flat if ch.get("impact", {}).get("damageRelevant")),
        }


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


def classify_patch(patch: dict) -> None:
    flat = [ch for sec in patch["sections"] for ch in sec["changes"]]
    if not flat:
        return
    for ch in flat:
        ch["kind"] = ch.get("kind") or classify_fallback(canonical_text(ch))
    print(f"    classified {len(flat)} changes via regex")


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
    by_slug = {a["slug"]: a for a in augments if a.get("slug")}

    applied = 0
    missing: list[str] = []
    for change in aug_changes:
        en_subject = change["subject"].get("en", "").strip()
        if not en_subject:
            continue
        target = next(
            (
                t for t in change.get("targets", [])
                if t.get("type") == "augment" and t.get("known") and t.get("slug")
            ),
            None,
        )
        aug = by_slug.get(target["slug"]) if target else by_name.get(en_subject.lower())
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

def relink() -> None:
    """Re-run only the deterministic catalog linking against the existing
    internal patch-notes.json — no network fetch. Use when the entity catalog
    (champions/items/augments) changes but the scraped Riot text has not, e.g.
    after fixing a name alias. enrich_patch_entities is idempotent, so the only
    output that changes is rows whose resolution the catalog change affects."""
    out_path = OUT_DIR / "patch-notes.json"
    if not out_path.exists():
        raise SystemExit(f"{out_path} not found — run a full scrape first.")
    doc = json.loads(out_path.read_text(encoding="utf-8"))
    patches = doc.get("patches", [])

    print("Re-linking patch-note rows to Mayhem Oracle catalogs...")
    catalogs = load_entity_catalogs()
    enrich_patch_entities(patches, catalogs)

    print("Updating augments.json recentChanges...")
    update_augment_recent_changes(patches)

    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. Re-linked {out_path} ({len(patches)} patches).")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--relink",
        action="store_true",
        help="Re-run catalog linking on existing patch-notes.json without scraping.",
    )
    args = parser.parse_args()
    if args.relink:
        relink()
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Discovering patch note URLs from {BASE_URL}{NEWS_PATH} ...")

    en_paths = discover_patch_paths(SCRAPE_N_PATCHES)
    if not en_paths:
        raise SystemExit("No patch note URLs found — aborting.")
    print(f"  Found {len(en_paths)} patches: {[p.split('/')[-1] for p in en_paths]}")

    # Fetch and parse EN pages
    print("\nFetching and parsing EN patch pages...")
    en_patches: list[dict] = []
    parsed_en_paths: list[str] = []
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
        parsed_en_paths.append(path)

    if not en_patches:
        raise SystemExit("No EN patches parsed — aborting.")

    # Fetch localized pages opportunistically; any missing locale falls back to
    # EN text during positional stitching.
    print("\nFetching and parsing localized patch pages...")
    by_locale: dict[str, list[dict]] = {locale_key: [] for locale_key in LOCALE_PREFIXES}
    for locale_key in LOCALE_PREFIXES:
        for path in parsed_en_paths:
            time.sleep(0.8)
            localized_path = locale_path(path, locale_key)
            try:
                html = fetch(localized_path)
            except (URLError, OSError) as e:
                print(f"  {locale_key} {path.split('/')[-1]}: falling back to EN ({e})")
                continue
            patch = parse_patch_page(html, localized_path, locale_mode=True)
            total = sum(len(s["changes"]) for s in patch["sections"])
            print(f"  {locale_key} {patch['version']}: {len(patch['sections'])} sections, {total} changes")
            if not patch["sections"]:
                print(f"    WARNING: no localized ARAM: Mayhem content found — using EN fallback")
            by_locale[locale_key].append(patch)

    # Classify and deterministically link to local catalogs.
    print("\nClassifying changes (deterministic regex)...")
    for patch in en_patches:
        print(f"  Patch {patch['version']}:")
        classify_patch(patch)

    print("\nStitching localized patch-note text...")
    merged = stitch_locales(en_patches, by_locale)
    augmented_subjects = enrich_augment_subjects(merged)
    print(f"  enriched localized augment subjects: {augmented_subjects}")

    print("\nLinking patch-note rows to Mayhem Oracle catalogs...")
    catalogs = load_entity_catalogs()
    enrich_patch_entities(merged, catalogs)
    merged = wrap_locale_fields(merged)

    # Write recentChanges back to augments.json
    print("\nUpdating augments.json recentChanges...")
    update_augment_recent_changes(merged)

    current_patch = merged[0]["version"] if merged else None
    out = {
        "patch": current_patch,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "source": BASE_URL + NEWS_PATH,
        "sourceKind": "official-riot-patch-notes",
        "sourceUrl": merged[0].get("sourceUrl") if merged else "",
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
